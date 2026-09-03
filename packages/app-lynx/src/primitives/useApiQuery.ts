// ─── useApiQuery helper（ADR-0141 D6 / R1 修订 / T2 foundation）───
//
// 用途：替代直接 useQuery，统一以下三件事：
// 1. queryFn 调 apiClient（持 401/原生桥转发/SSRF 防护契约）
// 2. signal 透传：queryFn 拿到的 AbortSignal 直接传给 apiClient.get/post
// 3. generation-gate 包装：组件 unmount 或参数变化导致旧 query 取消时，
//    旧响应被识别为 stale 并丢弃（不写入缓存）
//
// 实测动机（ADR-0141 R1-3 真机结论）：
// lynx fetch 的 AbortSignal 是可生效的（117ms 真取消），但 Vue Query 的
// cancelQueries 不会主动终止 fetch 调用——它只调 signal.abort()。
// 实测旧 query 仍会走完 resolve。所以 queryFn 内必须监听 signal.abort
// 并在 abort 触发时丢弃响应（generation-gate 模式）。
//
// 设计：caller 传 useQuery 原生 options（强类型，不重复定义字段子集），
// 内部只 wrap queryFn 注入 generation-gate + signal 透传。

import {
  useQuery,
  type QueryKey,
  type QueryFunctionContext,
  type UseQueryOptions,
} from '@tanstack/vue-query'

/**
 * useApiQuery：queryFn 调 apiClient + generation-gate 包装的 useQuery 便捷封装。
 *
 * 类型签名直接继承 useQuery 完整 options（不缩小字段子集），避免 TS 漂移，
 * 但内部 wrap queryFn 注入 generation-gate。
 *
 * 注意：useQuery 5.x 的 useQueryOptions 是 MaybeRef<{...} & ShallowOption> 形态，
 * 直接展开 plain object 会被 TS 推断为非 MaybeRefOrGetter 形态，触发 overload
 * 失败。本 helper 接受 plain options 后包成 () => options 走 MaybeRefOrGetter
 * overload（3rd overload），保证类型与 useQuery 完全一致。
 *
 * @example
 * ```ts
 * const detail = useApiQuery({
 *   queryKey: queryKeys.illusts.detail(illustId),
 *   queryFn: ({ signal }) => apiClient.get(`/v1/illust/detail`, { illust_id: String(illustId) }, signal),
 * })
 * ```
 */
export function useApiQuery<TData = unknown, TError = Error, TQueryKey extends QueryKey = QueryKey>(
  options: UseQueryOptions<TData, TError, TData, TData, TQueryKey>,
) {
  // UseQueryOptions 内部 queryFn 字段是 MaybeRefDeep 形态——访问前先 unwrap
  // 实际 caller 传 plain options 时 queryFn 是直接函数
  const originalQueryFn = (options as { queryFn?: unknown }).queryFn as QueryFn<TData> | undefined
  // 强制走 MaybeRefOrGetter overload（避免 overload 1/2 推断冲突）：
  // 包成 getter 让 TS 匹配 3rd overload（MaybeRefOrGetter<UseQueryOptions>）
  const wrappedOptions = () => ({
    ...options,
    queryFn: originalQueryFn ? wrapWithGenerationGate(originalQueryFn) : undefined,
  })
  // 类型断言：getter 返回值与 MaybeRefOrGetter<UseQueryOptions> 形态兼容
  return (useQuery as (
    options: MaybeRefOrGetter<UseQueryOptions<TData, TError, TData, TData, TQueryKey>>,
  ) => ReturnType<typeof useQuery<TData, TError, TData, TQueryKey>>)(
    wrappedOptions,
  )
}

type QueryFn<T> = (context: QueryFunctionContext<QueryKey>) => T | Promise<T>
type MaybeRefOrGetter<T> = import('vue').MaybeRefOrGetter<T>

/**
 * generation-gate 包装：监听 signal.abort，disposed=true 时 queryFn 抛 'stale'。
 *
 * 设计要点：
 * 1. disposed 标志在 queryFn 闭包内（每次 queryFn 调用独立）
 * 2. signal.addEventListener 只 add 一次（once: true；重复 add 会重复触发回调）
 * 3. resolved 路径上检查 disposed，命中即 throw
 * 4. rejected 路径（fetch reject）也检查 disposed——避免 abort 触发的
 *    AbortError 写回缓存（Vue Query 内部仍可能把 abort 后的错误状态更新）
 *
 * 实测验证（ADR-0141 R1-3）：
 * - lynx 真机：signal.abort 117ms 内触发 → 旧 query 走完 resolve 后被丢
 * - 浏览器：signal.abort 立即 reject + 立即丢
 */
export function wrapWithGenerationGate<TData>(queryFn: QueryFn<TData>) {
  return (context: QueryFunctionContext<QueryKey>): Promise<TData> => {
    let disposed = false
    const onAbort = () => { disposed = true }
    context.signal.addEventListener('abort', onAbort, { once: true })

    // ⚠️ 关键：queryFn 必须同步执行（不通过 microtask），让 queryFn 内部的
    // signal.addEventListener('abort', ...) 早于 caller 的 ac.abort() 注册，
    // 否则 lynx fetch 实测场景下 listener 永远不触发（已 abort 的 signal 不会
    // 再次派发 abort 事件）。
    const innerPromise = Promise.resolve(queryFn(context))

    return innerPromise
      .then((data) => {
        if (disposed) {
          throw new ApiQueryStaleError()
        }
        return data
      })
      .catch((err) => {
        if (disposed) {
          throw new ApiQueryStaleError()
        }
        throw err
      })
      .finally(() => {
        context.signal.removeEventListener('abort', onAbort)
      })
  }
}

/**
 * 标记「响应被 generation-gate 丢弃」的专用错误。
 * Vue Query 默认不写入 cache（queryFn throw + status: error），
 * 但 error 槽位会变成 ApiError。组件层用 isApiQueryStaleError() 过滤掉。
 */
export class ApiQueryStaleError extends Error {
  readonly __apiQueryStale = true
  constructor() {
    super('stale')
    this.name = 'ApiQueryStaleError'
  }
}

/**
 * 辅助函数：判断错误是否为 generation-gate 丢弃错误。
 * 用法：`if (isApiQueryStaleError(error)) return // 静默忽略`
 */
export function isApiQueryStaleError(err: unknown): err is ApiQueryStaleError {
  return err instanceof ApiQueryStaleError
    || (typeof err === 'object' && err !== null && (err as { __apiQueryStale?: boolean }).__apiQueryStale === true)
}
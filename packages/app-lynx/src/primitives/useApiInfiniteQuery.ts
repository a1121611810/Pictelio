// ─── useApiInfiniteQuery helper（ADR-0141 D5 / T2 foundation）───
//
// 用途：替代直接 useInfiniteQuery，统一以下三件事：
// 1. queryFn 调 apiClient（持 401/原生桥转发契约）
// 2. signal 透传 + generation-gate 包装
// 3. ApiError.kind 双错误槽位（first / pagination）
//    - 首屏失败：data === undefined（用 data 槽位判断）
//    - 分页失败：data !== undefined 但 error.kind === 'pagination'
//    组件层根据 kind 决定渲染全屏 banner 还是 inline banner
//
// 为什么不直接用 useInfiniteQuery：
// useInfiniteQuery 的 error 是单槽位——首屏失败和分页失败都映射到同一个 error 字段，
// 组件层无法区分。spec D5 决策：通过 queryFn 内 throw 带 kind 的 ApiError 派生双 banner。

import {
  useInfiniteQuery,
  type QueryKey,
  type QueryFunctionContext,
  type UseInfiniteQueryOptions,
  type InfiniteData,
} from '@tanstack/vue-query'
import { type ApiError, ApiErrorType } from '../api/types'
import { ApiQueryStaleError, isApiQueryStaleError } from './useApiQuery'

export type ApiQueryErrorKind = 'first' | 'pagination'

/**
 * 双错误槽位的 ApiError 包装。
 * - kind: 'first' / 'pagination' — 组件层据此分流 banner
 * - cause: 原始 ApiError（保留 status / type / message）
 */
export class ApiQueryError extends Error {
  readonly __apiQueryError = true
  constructor(
    public readonly kind: ApiQueryErrorKind,
    public readonly cause: ApiError,
  ) {
    super(`[${kind}] ${cause.message}`)
    this.name = 'ApiQueryError'
  }
}

export function isApiQueryError(err: unknown): err is ApiQueryError {
  return err instanceof ApiQueryError
    || (typeof err === 'object' && err !== null && (err as { __apiQueryError?: boolean }).__apiQueryError === true)
}

/**
 * useApiInfiniteQuery：useApiQuery 的无限分页版 + ApiError.kind 派生。
 *
 * 类型签名直接继承 useInfiniteQuery 完整 options，wrap queryFn 注入
 * generation-gate + kind 错误包裹。用 getter overload 绕过 TS overload
 * 推断冲突（与 useApiQuery 同模式）。
 *
 * @param options.inferKindFromPageParam - 根据 pageParam 判定 kind：
 *   - undefined（首屏）→ 'first'
 *   - string/number（next_url）→ 'pagination'
 *   - 默认：靠 pageParam 是否为 null/undefined 判定
 *
 * @example
 * ```ts
 * const feed = useApiInfiniteQuery({
 *   queryKey: queryKeys.illusts.follow('public'),
 *   queryFn: ({ signal, pageParam }) => apiClient.get(
 *     '/v2/illust/follow',
 *     pageParam ? { next_url: pageParam } : { restrict: 'public' },
 *     signal,
 *   ),
 *   initialPageParam: null as string | null,
 *   getNextPageParam: (last) => last.next_url,
 * })
 * const firstError = computed(() =>
 *   feed.error.value && isApiQueryError(feed.error.value) && feed.error.value.kind === 'first'
 *     ? feed.error.value.cause
 *     : null,
 * )
 * const pageError = computed(() =>
 *   feed.error.value && isApiQueryError(feed.error.value) && feed.error.value.kind === 'pagination'
 *     ? feed.error.value.cause
 *     : null,
 * )
 * ```
 */
export function useApiInfiniteQuery<
  TQueryFnData = unknown,
  TError = Error,
  // vue-query 5.x 类型规范：TData 默认 = InfiniteData<TQueryFnData>
  // 显式标注以让 caller 端的 query.data.value 类型正确推断为 InfiniteData<TQueryFnData>（含 pages 字段）
  TData = InfiniteData<TQueryFnData>,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = unknown,
>(
  options: UseInfiniteQueryOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>,
) {
  // UseInfiniteQueryOptions 内部 queryFn 字段是 MaybeRefDeep 形态——访问前先 unwrap
  const originalQueryFn = (options as { queryFn?: unknown }).queryFn as InfiniteQueryFn<TQueryFnData, TPageParam> | undefined
  // 走 MaybeRefOrGetter overload（getter 形式），与 useApiQuery 同策略
  const wrappedOptions = () => ({
    ...options,
    queryFn: originalQueryFn ? wrapWithKindAndGate(originalQueryFn) : undefined,
  })
  return (useInfiniteQuery as (
    options: MaybeRefOrGetter<UseInfiniteQueryOptions<TQueryFnData, TError, TData, TQueryKey, TPageParam>>,
  ) => ReturnType<typeof useInfiniteQuery<TQueryFnData, TError, TData, TQueryKey, TPageParam>>)(
    wrappedOptions,
  )
}

type InfiniteQueryFn<T, TPageParam> = (
  context: QueryFunctionContext<QueryKey, TPageParam>,
) => T | Promise<T>
type MaybeRefOrGetter<T> = import('vue').MaybeRefOrGetter<T>

export function wrapWithKindAndGate<TData, TPageParam>(
  queryFn: InfiniteQueryFn<TData, TPageParam>,
) {
  return (context: QueryFunctionContext<QueryKey, TPageParam>): Promise<TData> => {
    let disposed = false
    const onAbort = () => { disposed = true }
    context.signal.addEventListener('abort', onAbort, { once: true })

    // 判定本次失败是「首屏」还是「分页」：
    // - pageParam 为 null/undefined → 首屏（initial load）
    // - pageParam 为 string/number → 分页（fetchNextPage）
    const isFirstPage = context.pageParam === null || context.pageParam === undefined
    const kind: ApiQueryErrorKind = isFirstPage ? 'first' : 'pagination'

    // ⚠️ queryFn 同步执行（见 useApiQuery wrapWithGenerationGate 注释）
    const innerPromise = Promise.resolve(queryFn(context))

    return innerPromise
      .then((data) => {
        if (disposed) throw new ApiQueryStaleError()
        return data
      })
      .catch((err) => {
        if (disposed) throw new ApiQueryStaleError()
        if (isApiQueryError(err)) throw err
        if (isApiQueryStaleError(err)) throw err
        // 原始 ApiError → 包成 ApiQueryError 携带 kind
        if (err && typeof err === 'object' && 'type' in err) {
          throw new ApiQueryError(kind, err as ApiError)
        }
        // 非 ApiError（fetch reject 等）：仍按 kind 包裹为 generic
        throw new ApiQueryError(kind, {
          type: ApiErrorType.UNKNOWN,
          message: (err as Error)?.message ?? 'unknown',
        })
      })
      .finally(() => {
        context.signal.removeEventListener('abort', onAbort)
      })
  }
}
// 元素矩形批量测量原语（ADR-0149 / spec docs/specs/app-lynx-adaptive-list-tags.md「测试决策」）。
//
// 平台约束（ADR-0149 spike 双端实测）：
// 1. selectAll(...).invoke(...) 双端均不支持 → 回调 { code: 5, data: 'selectAll not supported for invoke method' }；
//    必须逐元素 select('#id')。
// 2. 必须链式 exec()：web-core 的 SelectorQuery.commitTask 会 slice 出新 query 承载 task，
//    先存 const q 再 q.exec() 执行的是空队列（静默无回调）。
// 3. 测量是跨线程异步的；超时/缺失必须显式 warn（AGENTS.md 测试硬约束 #3 禁止静默降级）。
export interface BoundingRect {
  left: number
  top: number
  width: number
  height: number
}

export interface InvokeOptions {
  method: string
  params?: Record<string, unknown>
  success?: (data: unknown) => void
  fail?: (err: unknown) => void
}

/** 链式 SelectorQuery：select().invoke() 累积到同一队列，最后一次 exec() */
export interface NodesRef {
  invoke(options: InvokeOptions): SelectorQuery
}
export interface SelectorQuery {
  select(selector: string): NodesRef
  exec(): void
}
/** 查询工厂（组件传全局 lynx 的取值；单测注入假实现） */
export type SelectorQueryFactory = () => SelectorQuery | undefined

export interface MeasureResult {
  /** 成功拿到的矩形（按 id） */
  rects: Record<string, BoundingRect>
  /** 未拿到矩形的 id */
  missing: string[]
  ok: boolean
  /** 失败原因：no-selector-query / timeout；成功或无缺失时缺省 */
  reason?: 'no-selector-query' | 'timeout'
}

/**
 * 逐元素测量矩形。ids 为空时直接返回 ok（不触碰查询）。
 * @param timeoutMs 回调总超时；到期按已收集结果返回并 warn。
 */
export function measureRects(
  ids: string[],
  createQuery: SelectorQueryFactory,
  timeoutMs = 1500,
): Promise<MeasureResult> {
  if (ids.length === 0) return Promise.resolve({ rects: {}, missing: [], ok: true })

  return new Promise<MeasureResult>((resolve) => {
    const rects: Record<string, BoundingRect> = {}
    let settled = 0
    let finished = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const settle = (reason?: 'no-selector-query' | 'timeout') => {
      if (finished) return
      finished = true
      if (timer !== undefined) clearTimeout(timer)
      const missing = ids.filter((id) => !rects[id])
      const ok = missing.length === 0 && reason === undefined
      if (reason === 'no-selector-query') {
        console.warn('[measureRects] createSelectorQuery 不可用，无法测量元素矩形')
      } else if (reason === 'timeout') {
        console.warn('[measureRects] 测量超时（' + timeoutMs + 'ms），missing=' + missing.length + '/' + ids.length)
      } else if (missing.length > 0) {
        console.warn('[measureRects] 部分元素未返回矩形，missing=' + missing.length + '/' + ids.length)
      }
      resolve({ rects, missing, ok, reason })
    }

    const query = createQuery()
    if (!query) {
      settle('no-selector-query')
      return
    }

    let chain: SelectorQuery = query
    for (const id of ids) {
      chain = chain.select('#' + id).invoke({
        method: 'boundingClientRect',
        params: {},
        success: (data) => {
          const r = data as Partial<BoundingRect> | null
          if (r) {
            rects[id] = { left: r.left ?? 0, top: r.top ?? 0, width: r.width ?? 0, height: r.height ?? 0 }
          }
          if (++settled >= ids.length) settle()
        },
        fail: () => {
          if (++settled >= ids.length) settle()
        },
      })
    }
    chain.exec()
    timer = setTimeout(() => settle('timeout'), timeoutMs)
  })
}

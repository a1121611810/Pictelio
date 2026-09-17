// 选中范围矩形测量原语（spec docs/specs/app-lynx-novel-text-selection.md §ID 5）。
//
// 平台约束与 measureRects 同源（ADR-0149 实测）：必须逐元素 select('#id')（selectAll 不支持 invoke）；
// exec() 必须链在 select().invoke() 的返回值上（先存 const q 再 q.exec() 执行空队列、静默无回调）；
// 跨线程异步 → 超时/失败**必须显式 warn**（AGENTS.md 测试硬约束 #3 禁静默降级）。
//
// 与 measureRects 的差异：本方法为 getTextBoundingRect，**必须给真实 range**
// （全量 range 会 fail code=1，设备实证），成功载荷为 { boundingRect }（单位 = 内容区 dp）。
import type { BoundingRect, SelectorQueryFactory } from './measureRects'

export type TextRectFailure = 'no-selector-query' | 'bad-range' | 'timeout'

export type TextRectResult = { ok: true; rect: BoundingRect } | { ok: false; reason: TextRectFailure }

/**
 * 测量某节点 [start, end) 的文本范围矩形（内容区 dp）。
 * @param timeoutMs 回调超时；到期按失败返回并 warn。
 */
export function measureTextRect(
  nodeId: string,
  start: number,
  end: number,
  createQuery: SelectorQueryFactory,
  timeoutMs = 1500,
): Promise<TextRectResult> {
  return new Promise<TextRectResult>((resolve) => {
    let finished = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const settle = (result: TextRectResult): void => {
      if (finished) return
      finished = true
      if (timer !== undefined) clearTimeout(timer)
      resolve(result)
    }

    const query = createQuery()
    if (!query) {
      console.warn('[measureTextRect] createSelectorQuery 不可用，无法测量选中范围')
      settle({ ok: false, reason: 'no-selector-query' })
      return
    }

    query.select('#' + nodeId).invoke({
      method: 'getTextBoundingRect',
      params: { start, end },
      success: (data) => {
        const rect = (data as { boundingRect?: Partial<BoundingRect> } | null)?.boundingRect
        if (!rect || typeof rect.left !== 'number') {
          console.warn('[measureTextRect] getTextBoundingRect 未返回矩形', nodeId, start, end)
          settle({ ok: false, reason: 'bad-range' })
          return
        }
        settle({
          ok: true,
          rect: {
            left: rect.left,
            top: rect.top ?? 0,
            width: rect.width ?? 0,
            height: rect.height ?? 0,
          },
        })
      },
      fail: (err) => {
        console.warn('[measureTextRect] getTextBoundingRect 失败', nodeId, err)
        settle({ ok: false, reason: 'bad-range' })
      },
    }).exec()

    timer = setTimeout(() => {
      console.warn('[measureTextRect] 选中范围测量超时', timeoutMs, nodeId)
      settle({ ok: false, reason: 'timeout' })
    }, timeoutMs)
  })
}

// 入口大卡状态纯函数（spec docs/specs/ranking.md §5.1/§5.2/§5.4；#519）。
// oracle：spec「收起当次隐藏、刷新/重进恢复」「成功空返回不静默降级（不永久骨架）」「失败不误导」。
import { describe, expect, it } from "vitest"
import { isEntryVisible, shouldResetDismissed } from "./rankingEntryState"

describe("rankingEntryState", () => {
  it("isEntryVisible：收起或加载失败 → 隐藏", () => {
    expect(isEntryVisible({ dismissed: false, hasError: false, settled: false, itemCount: 0 })).toBe(true)
    expect(isEntryVisible({ dismissed: true, hasError: false, settled: true, itemCount: 3 })).toBe(false)
    expect(isEntryVisible({ dismissed: false, hasError: true, settled: false, itemCount: 0 })).toBe(false)
  })

  it("isEntryVisible：已落定且空 → 隐藏（骨架只属加载中，spec §5.4）", () => {
    expect(isEntryVisible({ dismissed: false, hasError: false, settled: true, itemCount: 0 })).toBe(false)
    expect(isEntryVisible({ dismissed: false, hasError: false, settled: true, itemCount: 1 })).toBe(true)
    // 未落定（加载中）空 → 仍显示骨架
    expect(isEntryVisible({ dismissed: false, hasError: false, settled: false, itemCount: 0 })).toBe(true)
  })

  it("shouldResetDismissed：refreshEpoch 变化才复位（首次不重置）", () => {
    expect(shouldResetDismissed(undefined, 0)).toBe(false)
    expect(shouldResetDismissed(0, 0)).toBe(false)
    expect(shouldResetDismissed(0, 1)).toBe(true)
  })
})

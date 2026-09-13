// 入口大卡状态纯函数（spec docs/specs/ranking.md §5.1/§5.2；#519）。
// oracle：spec「收起当次隐藏、刷新/重进恢复」「失败不误导」——行为级断言。
import { describe, expect, it } from "vitest"
import { isEntryVisible, shouldResetDismissed } from "./rankingEntryState"

describe("rankingEntryState", () => {
  it("isEntryVisible：收起或加载失败 → 隐藏；否则显示", () => {
    expect(isEntryVisible({ dismissed: false, hasError: false, itemCount: 3 })).toBe(true)
    expect(isEntryVisible({ dismissed: true, hasError: false, itemCount: 3 })).toBe(false)
    expect(isEntryVisible({ dismissed: false, hasError: true, itemCount: 0 })).toBe(false)
  })

  it("shouldResetDismissed：refreshEpoch 变化才复位（首次不重置）", () => {
    expect(shouldResetDismissed(undefined, 0)).toBe(false)
    expect(shouldResetDismissed(0, 0)).toBe(false)
    expect(shouldResetDismissed(0, 1)).toBe(true)
  })
})

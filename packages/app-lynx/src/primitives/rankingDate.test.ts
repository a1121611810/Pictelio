// 榜单日期「今日」判定（spec docs/specs/ranking.md §5.3；#518）。
// oracle：spec「今日时后一天禁用」——纯函数行为级断言（非源码字符串）。
import { describe, expect, it } from "vitest"
import { canShiftForward, isTodayDate } from "./rankingDate"

describe("rankingDate", () => {
  it("isTodayDate：null=今日；显式今日=今日；历史日期不是", () => {
    expect(isTodayDate(null, "2026-09-13")).toBe(true)
    expect(isTodayDate("2026-09-13", "2026-09-13")).toBe(true)
    expect(isTodayDate("2026-09-12", "2026-09-13")).toBe(false)
  })

  it("canShiftForward：今日不可前进（不请求未来）；历史日期可", () => {
    expect(canShiftForward(null, "2026-09-13")).toBe(false)
    expect(canShiftForward("2026-09-13", "2026-09-13")).toBe(false)
    expect(canShiftForward("2026-09-12", "2026-09-13")).toBe(true)
  })
})

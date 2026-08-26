// oracle：docs/specs/app-lynx-novel-series-watchlist.md §US7（createWatchlistToggle
// 镜像 createBookmarkToggle：deps 注入 add/remove + busy 锁 + error 槽 + 失败回滚；
// 成功后写 watchlistStore.setWatchState 由页面层 onChange 承接）
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createWatchlistToggle } from "./createWatchlistToggle"

describe("createWatchlistToggle", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("取消追更成功：added 翻转 + remove 被调 + onChange(false)", async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    const onChange = vi.fn()
    const t = createWatchlistToggle(42, true, { add: vi.fn(), remove, onChange })
    expect(t.added).toBe(true)
    await t.toggle()
    expect(remove).toHaveBeenCalledWith(42)
    expect(t.added).toBe(false)
    expect(onChange).toHaveBeenCalledWith(false)
    expect(t.errorMsg).toBe("")
  })

  it("重新追更成功：added=false 起步 → add 被调 + onChange(true)", async () => {
    const add = vi.fn().mockResolvedValue(undefined)
    const onChange = vi.fn()
    const t = createWatchlistToggle(7, false, { add, remove: vi.fn(), onChange })
    await t.toggle()
    expect(add).toHaveBeenCalledWith(7)
    expect(t.added).toBe(true)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it("busy 锁：请求在飞期间重复 toggle 被忽略（防连点并发提交）", async () => {
    let resolveRemove!: () => void
    const remove = vi.fn().mockImplementation(
      () => new Promise<void>((res) => (resolveRemove = res)),
    )
    const t = createWatchlistToggle(1, true, { add: vi.fn(), remove })
    const p1 = t.toggle()
    expect(t.busy).toBe(true)
    await t.toggle() // 应被 busy 锁吞掉
    expect(remove).toHaveBeenCalledTimes(1)
    resolveRemove()
    await p1
    expect(t.busy).toBe(false)
  })

  it("失败静息回滚：added 复位 + errorMsg 置「操作失败」+ warn 带模块前缀", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const remove = vi.fn().mockRejectedValue(new Error("network"))
    const onChange = vi.fn()
    const t = createWatchlistToggle(9, true, { add: vi.fn(), remove, onChange })
    await t.toggle()
    expect(t.added).toBe(true) // 回滚
    // oracle = spec §US7 行为契约（error 槽非空 + 可重试 + 不静默）；文案字面值非 spec 契约，不锁定
    expect(t.errorMsg).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[createWatchlistToggle]"),
      expect.anything(),
    )
  })

  it("失败后可重试：busy 复位，再次 toggle 重新发请求", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const remove = vi.fn().mockRejectedValueOnce(new Error("500")).mockResolvedValueOnce(undefined)
    const t = createWatchlistToggle(3, true, { add: vi.fn(), remove })
    await t.toggle()
    expect(t.errorMsg).toBeTruthy()
    await t.toggle()
    expect(remove).toHaveBeenCalledTimes(2)
    expect(t.added).toBe(false)
    expect(t.errorMsg).toBe("")
  })
})

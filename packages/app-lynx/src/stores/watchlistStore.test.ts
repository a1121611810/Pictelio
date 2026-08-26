// oracle：docs/specs/app-lynx-novel-series-watchlist.md §US6 / 决策 D2
// - dismissed 为会话级内存 Set，不持久化
// - watchState 缓存 undefined = 未知
import { describe, it, expect, beforeEach } from "vitest"
import {
  markDismissed,
  isDismissed,
  setWatchState,
  getWatchState,
  resetWatchlistStoreForTest,
} from "./watchlistStore"

describe("watchlistStore", () => {
  beforeEach(() => {
    resetWatchlistStoreForTest()
  })

  describe("dismissed 会话记忆（D2）", () => {
    it("未标记的系列返回 false", () => {
      expect(isDismissed(101)).toBe(false)
    })

    it("标记后同系列返回 true", () => {
      markDismissed(101)
      expect(isDismissed(101)).toBe(true)
    })

    it("标记不影响其他系列", () => {
      markDismissed(101)
      expect(isDismissed(202)).toBe(false)
    })

    it("重复标记幂等", () => {
      markDismissed(101)
      markDismissed(101)
      expect(isDismissed(101)).toBe(true)
    })
  })

  describe("watch 状态缓存", () => {
    it("未写入时返回 undefined（未知）", () => {
      expect(getWatchState(101)).toBeUndefined()
    })

    it("写入 true 后可读回", () => {
      setWatchState(101, true)
      expect(getWatchState(101)).toBe(true)
    })

    it("写入 false 后可读回（与 undefined 区分）", () => {
      setWatchState(101, false)
      expect(getWatchState(101)).toBe(false)
    })

    it("覆盖写后读回最新值（列表页取消 → 详情页标记联动）", () => {
      setWatchState(101, true)
      setWatchState(101, false)
      expect(getWatchState(101)).toBe(false)
    })

    it("不同系列互不影响", () => {
      setWatchState(101, true)
      expect(getWatchState(202)).toBeUndefined()
    })
  })
})

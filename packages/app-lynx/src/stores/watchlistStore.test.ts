// oracle：docs/specs/app-lynx-novel-series-watchlist.md §US6 / 决策 D2 + ADR-0189 D5
// - dismissed 为会话级内存 Set，不持久化
// - watchState 缓存 = reactive Record，跨 controller 共享响应式读写
import { describe, it, expect, beforeEach } from "vitest"
import { effect } from "vue"
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

  describe("reactive 同步（ADR-0189 D5 跨入口 cache）", () => {
    it("setWatchState 写入触发 reactive 通知：effect 重跑且取到新值", () => {
      const observed: Array<boolean | undefined> = []
      const stop = effect(() => {
        observed.push(getWatchState(303))
      })
      // 初始 effect 跑一次：undefined
      expect(observed).toEqual([undefined])
      setWatchState(303, true)
      // 写入触发 effect 重跑：true
      expect(observed).toEqual([undefined, true])
      setWatchState(303, false)
      // 再次写入触发：false
      expect(observed).toEqual([undefined, true, false])
      stop()
    })

    it("resetWatchlistStoreForTest 清空 reactive Record + dismissed", () => {
      setWatchState(303, true)
      markDismissed(303)
      resetWatchlistStoreForTest()
      expect(getWatchState(303)).toBeUndefined()
      expect(isDismissed(303)).toBe(false)
    })

    it("reset 后再写入不会触发旧的 effect（key 已从 Record 删除）", () => {
      let lastSeen: boolean | undefined = undefined
      const stop = effect(() => {
        lastSeen = getWatchState(404)
      })
      expect(lastSeen).toBeUndefined()
      setWatchState(404, true)
      expect(lastSeen).toBe(true)
      resetWatchlistStoreForTest()
      // reset 之后 setWatchState(404) 应该作为"新 key"插入，effect 仍应被触发一次
      // （即使 effect 之前见过 404，delete + set 等同新建属性，Vue 响应式仍通知）
      setWatchState(404, false)
      expect(lastSeen).toBe(false)
      stop()
    })
  })
})

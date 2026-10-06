// 触达探测落点：广播去重 + 点击计数（spec notification-delivery-probe / #940）
//
// oracle：去重语义来自「冷启动要广播 4 次对抗渲染竞态，而计数不幂等」这条约束本身
// （见 deliveryProbeLanding 的文件注释与 LynxActivity 的 4 次广播），不是从实现反推。
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"

const recordClicked = vi.fn()
vi.mock("../stores/deliveryProbeStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../stores/deliveryProbeStore")>()
  return {
    ...actual,
    useDeliveryProbeStore: () => ({ recordClicked }),
  }
})

const { acceptClick, handleNotificationTarget, EVENT_NOTIFICATION_TARGET } = await import(
  "./deliveryProbeLanding"
)

beforeEach(() => {
  setActivePinia(createPinia())
  recordClicked.mockReset()
  recordClicked.mockResolvedValue(undefined)
})

describe("触达探测 · 通知落点（#940）", () => {
  describe("广播去重（冷启动 4 次广播 vs 幂等的计数）", () => {
    it("同一 clickId 只有第一次算点击，后 3 次不算", () => {
      const state = { seen: new Set<number>() }
      const results = [100, 100, 100, 100].map((id) => acceptClick(state, id))
      expect(results, "一次点击被记 4 次 ⇒ 点击率虚高 4 倍").toEqual([true, false, false, false])
    })

    it("不同 clickId 各算一次（两次真实点击不得被合并）", () => {
      const state = { seen: new Set<number>() }
      expect([acceptClick(state, 100), acceptClick(state, 200)]).toEqual([true, true])
      expect(state.seen.size).toBe(2)
    })

    it("窗口有界：长期运行不得让 Set 无限增长", () => {
      const state = { seen: new Set<number>() }
      for (let i = 0; i < 200; i++) acceptClick(state, i)
      expect(state.seen.size, "seen 无限增长 = 内存泄漏").toBeLessThanOrEqual(33)
      // 窗口外的老 id 会被判成新点击 —— 这是有意的取舍（老点击不该再来第二次）
      expect(acceptClick(state, 0)).toBe(true)
    })
  })

  describe("点击计数入账", () => {
    it("重复广播不重复入账（去重发生在入账**之前**）", async () => {
      const state = { seen: new Set<number>() }
      const first = await handleNotificationTarget(state, 9)
      const second = await handleNotificationTarget(state, 9)
      expect([first, second]).toEqual([true, false])
      expect(recordClicked, "一次点击记了两笔").toHaveBeenCalledTimes(1)
    })

    it("点击只记总数：冷热在进程内不可判定，不留会误导的分类字段", async () => {
      const state = { seen: new Set<number>() }
      await handleNotificationTarget(state, 11)
      await handleNotificationTarget(state, 12)
      expect(recordClicked).toHaveBeenCalledTimes(2)
      // 不得向 store 传冷/热 —— 四种候选信号都被点击本身污染（详见 store.recordClicked）
      expect(recordClicked.mock.calls.every((c) => c.length === 0)).toBe(true)
    })
  })

  describe("跨端事件名", () => {
    it("落点事件名已导出（供 router 订阅 + 契约门禁两侧比对）", async () => {
      expect(EVENT_NOTIFICATION_TARGET).not.toBe("")
      // 非 bench 前缀：benchNav 整条链被 BuildConfig.DEBUG / __BENCH_NAV__ 门死，
      // 正式包不可用；落点必须在 release 可用。
      expect(EVENT_NOTIFICATION_TARGET.startsWith("pictelioBenchNav")).toBe(false)
      // ⚠️ 不得再有「热启动专用事件名」：冷热在进程内不可判定，两个事件名会让 JS 侧
      //   看起来像能区分，其实只换了广播次数（#940 实施期结论）。
      const ns = (await import("./deliveryProbeLanding")) as Record<string, unknown>
      expect(Object.keys(ns)).not.toContain("EVENT_NOTIFICATION_TARGET_WARM")
    })
  })
})

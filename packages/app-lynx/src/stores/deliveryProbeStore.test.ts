// 送达通道 · 触达探测的**计数语义**单测（spec notification-delivery-probe / ADR-0220 决策 12/13）。
//
// seam = **JS 侧存储与判定的纯逻辑**（跨端接得上由 deliveryProbeContract.test.ts 负责；
// 宿主侧「该发/不该发」由 JVM 单测负责——三者不重复）。
//
// 期望值溯源：口径来自 ADR-0220 决策 12（重置**只清计数、保开始时间**）与决策 6
// （一次轮询 = 一个发出样本，不论该批有几条更新），不是从实现反推。
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPinia, setActivePinia } from "pinia"

import {
  DELIVERY_PROBE_KEY,
  QUIET_PERIOD_MS,
  decideProbe,
  emptyCounts,
  parseCounts,
  useDeliveryProbeStore,
} from "./deliveryProbeStore"

/** 可控偏好存储（形态对齐 stores/notificationStore.test.ts 的先例） */
const store = vi.hoisted(() => {
  const map = new Map<string, string>()
  return { map }
})

vi.mock("../utils/idbKV", () => ({
  idbGet: async (key: string) => store.map.get(key) ?? null,
  idbSet: async (key: string, value: string) => {
    store.map.set(key, value)
  },
}))

/** 原生模块不可用 ⇒ 走 dev adapter（idb 桩） */
vi.mock("../api/client", () => ({ getNativeModules: () => undefined }))

beforeEach(() => {
  setActivePinia(createPinia())
  store.map.clear()
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("deliveryProbe · 计数语义", () => {
  describe("解析（禁静默降级）", () => {
    it("键缺失 ⇒ 首轮未探测（三个字段归零/空）", () => {
      expect(parseCounts(null)).toEqual(emptyCounts())
      expect(parseCounts("")).toEqual(emptyCounts())
    })

    it("畸形 JSON ⇒ 首轮未探测**且显式告警**（不静默当成「0 次发出」）", () => {
      expect(parseCounts("{不是json")).toEqual(emptyCounts())
      expect(console.warn).toHaveBeenCalled()
    })

    it("字段类型不对 ⇒ 逐字段回退，不整体丢弃", () => {
      // 只坏 clicked，其余应保留 —— 「整体丢弃」会把有效的 sent 一并抹掉
      const r = parseCounts(JSON.stringify({ sent: 3, clicked: "x", startedAt: 1700 }))
      expect(r.sent).toBe(3)
      expect(r.clicked).toBe(0)
      expect(r.startedAt).toBe(1700)
    })
  })

  describe("重置（ADR-0220 决策 12）", () => {
    it("只清 sent/clicked，**保留 startedAt** ⇒ 多轮时间线连续", async () => {
      const s = useDeliveryProbeStore()
      await s.load()
      await s.recordSent()
      await s.recordSent()
      await s.recordClicked("cold")
      const startedAt = s.counts.startedAt
      expect(startedAt).not.toBeNull()

      await s.resetRound()
      expect(s.counts.sent, "重置未清发出数").toBe(0)
      expect(s.counts.clicked, "重置未清点击数").toBe(0)
      expect(s.counts.startedAt, "重置把开始时间也清了 ⇒ 多轮时间线断裂").toBe(startedAt)
    })
  })

  describe("发出/点击计数", () => {
    it("首次发出时才写 startedAt（空轮次不污染时间线）", async () => {
      const s = useDeliveryProbeStore()
      await s.load()
      expect(s.counts.startedAt).toBeNull()
      await s.recordSent()
      expect(s.counts.startedAt).not.toBeNull()
    })

    it("落盘的是同一个 JSON 值（三字段同版本，不会各自漂移）", async () => {
      const s = useDeliveryProbeStore()
      await s.load()
      await s.recordSent()
      await s.recordClicked("cold")
      const raw = store.map.get(DELIVERY_PROBE_KEY)
      expect(raw).toBeTruthy()
      const v = JSON.parse(raw!)
      expect(v.sent).toBe(1)
      expect(v.clicked).toBe(1)
      expect(typeof v.startedAt).toBe("number")
    })

    it("跨会话读回：重启后计数仍在（不是内存态）", async () => {
      const first = useDeliveryProbeStore()
      await first.load()
      await first.recordSent()
      await first.recordClicked("warm")

      setActivePinia(createPinia())
      const second = useDeliveryProbeStore()
      await second.load()
      expect(second.counts.sent).toBe(1)
      expect(second.counts.clicked).toBe(1)
    })

    it("load 幂等：重复调用不重复读盘", async () => {
      const s = useDeliveryProbeStore()
      await s.load()
      await s.recordSent()
      await s.load()
      expect(s.counts.sent, "重复 load 覆盖了内存计数").toBe(1)
    })
  })

  describe("点击样本的冷/热拆分（#940：App 存活时的点击不构成「被通知叫回来」）", () => {
    it("clicked 恒等于冷+热（保持 D12 的分子语义，不改既有字段含义）", async () => {
      const s = useDeliveryProbeStore()
      await s.recordClicked("cold")
      await s.recordClicked("warm")
      await s.recordClicked("warm")
      expect(s.counts.clicked).toBe(3)
      expect(s.counts.clickedCold).toBe(1)
      expect(s.counts.clickedWarm).toBe(2)
    })

    it("重置轮次清掉冷/热拆分、**保留** startedAt（ADR-0220 D12 字段级重置）", async () => {
      const s = useDeliveryProbeStore()
      await s.recordSent()
      await s.recordClicked("cold")
      await s.resetRound()
      expect(s.counts.clicked).toBe(0)
      expect(s.counts.clickedCold).toBe(0)
      expect(s.counts.clickedWarm).toBe(0)
      expect(s.counts.sent).toBe(0)
      expect(s.counts.startedAt, "startedAt 跨轮保留（否则多轮时间线断裂）").not.toBeNull()
    })

    it("存量 JSON 缺冷/热字段 ⇒ 按 0 处理，不得解析失败", () => {
      // 真机上已有旧格式 { sent, clicked, startedAt }；解析炸掉会把旧数据全丢，
      // 探测报告的分母凭空归零。
      const old = parseCounts(JSON.stringify({ sent: 3, clicked: 1, startedAt: 1000 }))
      expect(old.clickedCold).toBe(0)
      expect(old.clickedWarm).toBe(0)
      expect(old.sent, "旧数据本身不能丢").toBe(3)
      expect(old.clicked).toBe(1)
    })

    it("畸形冷/热字段（字符串/null/NaN）⇒ 按 0 处理而非 NaN 污染", () => {
      const bad = parseCounts(
        JSON.stringify({ sent: 1, clicked: 2, clickedCold: "x", clickedWarm: null, startedAt: null }),
      )
      expect(bad.clickedCold).toBe(0)
      expect(bad.clickedWarm).toBe(0)
      expect(bad.clicked).toBe(2)
    })
  })

  describe("判定链（ADR-0220 决策 2）", () => {
    it("静默期未过 ⇒ 不判（用户刚进来，不该被通知轰炸）", () => {
      expect(
        decideProbe({ quietElapsedMs: 0, permissionGranted: true, unreadCount: 9 }),
      ).toBe("quiet-period-not-elapsed")
      expect(
        decideProbe({ quietElapsedMs: QUIET_PERIOD_MS - 1, permissionGranted: true, unreadCount: 9 }),
      ).toBe("quiet-period-not-elapsed")
    })

    it("静默期刚过 + 有权限 + 有未读 ⇒ 该发", () => {
      expect(
        decideProbe({ quietElapsedMs: QUIET_PERIOD_MS, permissionGranted: true, unreadCount: 1 }),
      ).toBe("should-send")
    })

    it("权限未授予 ⇒ 降级到外环角标，**不发**（且优先级高于「有无未读」）", () => {
      expect(
        decideProbe({ quietElapsedMs: QUIET_PERIOD_MS, permissionGranted: false, unreadCount: 5 }),
      ).toBe("permission-not-granted")
    })

    it("无未读 ⇒ 不发（没内容可告知就别打扰）", () => {
      expect(
        decideProbe({ quietElapsedMs: QUIET_PERIOD_MS, permissionGranted: true, unreadCount: 0 }),
      ).toBe("no-unread")
    })

    it("静默期判定**优先于**权限与未读（顺序即语义）", () => {
      // 静默期没过时，无权限/无未读都应报静默期 —— 顺序反了会让
      // 「权限未授予」在用户刚进 App 时就冒出来，掩盖真正的判定阶段
      expect(
        decideProbe({ quietElapsedMs: 0, permissionGranted: false, unreadCount: 0 }),
      ).toBe("quiet-period-not-elapsed")
    })
  })
})

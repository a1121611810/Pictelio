// 本地使用度量 store 单测（接线层，spec §4 P0.5）。
//
// 【为什么必须有这份测试】`hydrate()` 的「缓冲 + 重放」是本轮第二轮 review（P2-1）
//   引入的**最易写错**逻辑，且它防的是一条不可逆的数据损坏：
//   hydrate 期间（prefs 原生 callback 让出执行权）另有三个 record 读点落地
//   —— globalFab 选 tab / 发现页切二级 / 更新页段拉取完成。若 hydrate 结束时
//   整体替换 metrics 实例，那些记录会被**丢弃**；更糟的是它们的 schedulePersist()
//   会把 `lastLaunchAt: null` 写盘，而 hydrate 恰好读到该值 ⇒ 历史 lastLaunchAt 被清空
//   ⇒ recordLaunch 的 `prev !== null` 不再成立 ⇒「相邻两次启动的时间差」**从此断链且不可恢复**。
//   第三轮 Standards 审查 I-5 指出此处零单测（对比同目录 notificationStore / settingsStore 均有）。
//
// 【期望值溯源】不是从实现反推：断言的是 spec §4 P0.5「复访间隔 = 相邻两次启动的时间差分布」
//   的**不变量** ——「历史样本 + 窗口内新样本必须合并存在」，任何丢失其一即为缺陷。
import { beforeEach, describe, expect, it, vi } from "vitest"
import { setActivePinia, createPinia } from "pinia"
import { useUsageMetricsStore, USAGE_METRICS_KEY } from "./usageMetrics"

/** 可控 prefs 假存储（形态对齐 stores/watchLaterStore.test.ts 的先例） */
const prefsState = vi.hoisted(() => {
  const map = new Map<string, string>()
  const control = { failGet: false, failSet: false, getDelayMs: 0 }
  return { map, control }
})

vi.mock("./settingsStore", () => ({
  prefs: () => ({
    get: async (key: string) => {
      if (prefsState.control.getDelayMs > 0) {
        await new Promise((r) => setTimeout(r, prefsState.control.getDelayMs))
      }
      if (prefsState.control.failGet) throw new Error("get failed")
      return prefsState.map.get(key) ?? null
    },
    set: async (key: string, value: string) => {
      if (prefsState.control.failSet) throw new Error("set failed")
      prefsState.map.set(key, value)
    },
  }),
}))

const T0 = 1_700_000_000_000
const T1 = T0 + 3_600_000 // 相邻两次启动隔 1 小时

/** 磁盘上预置一份"上次会话"的快照 */
function seedPersisted(lastLaunchAt: number, intervals: number[]): void {
  prefsState.map.set(
    USAGE_METRICS_KEY,
    JSON.stringify({
      revisitIntervalsMs: intervals,
      lastLaunchAt,
      tabHits: {},
      subTabHits: {},
      sectionSeen: {},
      sectionEmpty: {},
    }),
  )
}

beforeEach(() => {
  setActivePinia(createPinia())
  prefsState.map.clear()
  prefsState.control = { failGet: false, failSet: false, getDelayMs: 0 }
})

describe("usageMetrics store · hydrate 缓冲重放（P2-1）", () => {
  it("hydrate 窗口内的记录不被整体替换吞掉", async () => {
    const store = useUsageMetricsStore()
    prefsState.control.getDelayMs = 20 // 让 hydrate 停在窗口内

    const hydrating = store.hydrate() // 尚未 await，hydrating === true
    store.recordTabVisit("shelf") // 窗口内记录 ⇒ 应被缓冲
    store.recordSubTabUse("novel")
    await hydrating

    expect(store.snap.tabHits.shelf, "窗口内的顶层触达记录被 hydrate 吞掉").toBe(1)
    expect(store.snap.subTabHits.novel, "窗口内的二级使用记录被 hydrate 吞掉").toBe(1)
  })

  it("历史 lastLaunchAt 不被窗口内记录清空（复访间隔不断链）", async () => {
    seedPersisted(T0, [1000, 2000])
    const store = useUsageMetricsStore()
    prefsState.control.getDelayMs = 20

    const hydrating = store.hydrate()
    store.recordTabVisit("me") // 窗口内记录会触发 schedulePersist()
    await hydrating
    // 窗口内那条 persist 写的是 lastLaunchAt: null（此刻尚未 recordLaunch）
    await new Promise((r) => setTimeout(r, 5))

    const onDisk = JSON.parse(prefsState.map.get(USAGE_METRICS_KEY)!)
    expect(onDisk.revisitIntervalsMs, "历史复访样本被窗口内记录写空 ⇒ 间隔断链").toEqual([1000, 2000])
    expect(onDisk.lastLaunchAt, "历史 lastLaunchAt 被窗口内记录清空 ⇒ 此后 recordLaunch 永不记差值").toBe(T0)
  })

  it("hydrate 后的 recordLaunch 仍能与历史 lastLaunchAt 续上间隔（端到端不变量）", async () => {
    seedPersisted(T0, [])
    const store = useUsageMetricsStore()

    await store.hydrate()
    store.recordLaunch(T1)

    expect(store.snap.revisitIntervalsMs, "历史与本次启动未续上间隔").toEqual([3_600_000])
  })

  it("hydrate 之后的记录走正常路径（不缓冲、不重复重放）", async () => {
    const store = useUsageMetricsStore()
    await store.hydrate()
    store.recordTabVisit("me")
    store.recordTabVisit("me")
    expect(store.snap.tabHits.me).toBe(2)
  })

  it("多次 hydrate 不会把同一批记录重放两次", async () => {
    const store = useUsageMetricsStore()
    const h1 = store.hydrate()
    store.recordTabVisit("shelf")
    await h1
    await store.hydrate() // 第二次 hydrate：deferred 已清空

    expect(store.snap.tabHits.shelf, "同一条记录被重放了两次").toBe(1)
  })

  it("读取失败按首次使用处理并显式告警（禁静默降级）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    prefsState.control.failGet = true
    const store = useUsageMetricsStore()

    await store.hydrate()
    expect(store.snap.tabHits.me).toBeUndefined()
    expect(warn.mock.calls.some((c) => String(c[0]).includes("usageMetrics")), "读取失败未告警").toBe(true)
    warn.mockRestore()
  })

  it("落盘失败显式告警且不抛（度量是旁路，不得阻塞用户操作）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const store = useUsageMetricsStore()
    prefsState.control.failSet = true

    expect(() => store.recordTabVisit("me")).not.toThrow()
    await new Promise((r) => setTimeout(r, 5))
    expect(warn.mock.calls.some((c) => String(c[0]).includes("落盘失败")), "落盘失败未告警").toBe(true)
    warn.mockRestore()
  })

  it("隐私：落盘键不带 uid，且度量键不出现于 settingsStore（不进备份域）", async () => {
    expect(USAGE_METRICS_KEY).not.toMatch(/\d{5,}/) // 无 uid 后缀
    const store = useUsageMetricsStore()
    store.recordTabVisit("me")
    await new Promise((r) => setTimeout(r, 5))
    expect(prefsState.map.has(USAGE_METRICS_KEY), "快照未落盘").toBe(true)
  })
})

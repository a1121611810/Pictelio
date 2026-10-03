// 本地使用度量的纯逻辑单测（Spec 审计 P-2）—— spec §4 P0.5 承诺的四个指标的**唯一实现**。
//
// 【缺陷来源】spec §4 P0.5 承诺了四个本地指标（复访间隔 / 顶层触达率 / 二级使用占比 /
//   空段出现率），审计一 read-point 反事实判据：把来源值清零，行为不变 ⇒ **未接线**。
//   两个独立审查轴都把它判为阻塞（含「possible silent misconfiguration」标注）。
//
// 【期望值出处】spec §4 P0.5 四行的口径原文（不是从实现反推）：
//   · 复访间隔 = **相邻两次**启动的时间差分布（⇒ 首次启动不产生样本）
//   · 顶层触达率 = 4 个顶层**各自切入次数**占比（⇒ 分母可由各自分子之和导出）
//   · 二级使用占比 = 发现页三个二级**各被选次数**
//   · 空段出现率 = 「更新」页三段**各自为空的比例**（⇒ 需要"见到该段"与"该段为空"两个计数）
import { describe, it, expect } from "vitest"
import { createUsageMetrics, emptySnapshot, emptySectionRate, tabShare, subTabShare } from "./usageMetrics"

const NOW = 1_700_000_000_000

describe("使用度量纯逻辑（spec §4 P0.5）", () => {
  it("首次启动不产生复访间隔样本（相邻两次 ⇒ 没有上一次）", () => {
    const m = createUsageMetrics(emptySnapshot())
    // record* 返回 metrics 本身（可链式），快照要显式 .snapshot()
    const snap = m.recordLaunch(NOW).snapshot()
    expect(snap.revisitIntervalsMs).toEqual([])
  })

  it("第二次启动产生一条 = 间隔 ms 的样本", () => {
    let m = createUsageMetrics(emptySnapshot())
    m = m.recordLaunch(NOW)
    m = m.recordLaunch(NOW + 3_600_000) // 1 小时后
    expect(m.snapshot().revisitIntervalsMs).toEqual([3_600_000])
  })

  it("时间倒流（设备改时间）不得产生负样本", () => {
    let m = createUsageMetrics(emptySnapshot())
    m = m.recordLaunch(NOW)
    m = m.recordLaunch(NOW - 60_000)
    expect(m.snapshot().revisitIntervalsMs).toEqual([])
  })

  it("复访样本只保留最近 N 条（防止本地无限增长；spec 未规定 N，取 30）", () => {
    let m = createUsageMetrics(emptySnapshot())
    for (let i = 0; i < 40; i++) m = m.recordLaunch(NOW + i * 1000)
    const s = m.snapshot()
    expect(s.revisitIntervalsMs.length).toBe(30)
    // 每次步进都是 +1000ms ⇒ 每条间隔都是 1000；保留的是**最近**的 30 条（首条被挤出）
    expect(s.revisitIntervalsMs.every((d) => d === 1000)).toBe(true)
    // 另用**非均匀**步长验证"取最近"而非"取最早"（均匀步长下每条都相等，证不了这一点）
    // 步长依次为 1,2,3,...,35 分钟 ⇒ 第 k 条间隔 = k 分钟，可据位置反推保留窗口。
    let m2 = createUsageMetrics(emptySnapshot())
    let acc = 0
    for (let i = 1; i <= 35; i++) {
      acc += i * 60_000
      m2 = m2.recordLaunch(NOW + acc)
    }
    const s2 = m2.snapshot()
    expect(s2.revisitIntervalsMs.length).toBe(30)
    // 35 次启动 ⇒ 34 条间隔（第 k 次的间隔 = k 分钟，k=2..35）；保留最近 30 条
    // ⇒ 丢掉最小的 4 条（2,3,4,5 分钟）⇒ 保留 6..35 分钟
    expect(s2.revisitIntervalsMs[0]).toBe(6 * 60_000)
    expect(s2.revisitIntervalsMs.at(-1)).toBe(35 * 60_000)
  })

  it("顶层触达：按 tab 名分桶，重复切入累加", () => {
    const m = createUsageMetrics(emptySnapshot())
    let s = m.recordTabVisit("updates").recordTabVisit("updates").recordTabVisit("shelf").snapshot()
    expect(s.tabHits).toMatchObject({ updates: 2, shelf: 1 })
  })

  it("顶层触达率的分母 = 各 tab 命中数之和（未命中的 tab 计入分母，分子为 0）", () => {
    const m = createUsageMetrics(emptySnapshot())
    const s = m.recordTabVisit("discover").recordTabVisit("discover").snapshot()
    const total = Object.values(s.tabHits).reduce((a, b) => a + b, 0)
    expect(total).toBe(2)
    expect(s.tabHits.me ?? 0).toBe(0)
  })

  it("二级使用：发现页三个二级各自计数", () => {
    const m = createUsageMetrics(emptySnapshot())
    const s = m.recordSubTabUse("illust").recordSubTabUse("illust").recordSubTabUse("novel").snapshot()
    expect(s.subTabHits).toMatchObject({ illust: 2, novel: 1 })
  })

  it("空段率：必须同时有「见到」与「为空」两个计数才能算比例", () => {
    const m = createUsageMetrics(emptySnapshot())
    // 见到 following 段 3 次，其中 1 次为空
    const s = m
      .recordSectionObserved("following")
      .recordSectionObserved("following", true)
      .recordSectionObserved("following")
      .recordSectionObserved("watchlist", true)
      .snapshot()
    expect(s.sectionSeen).toMatchObject({ following: 3, watchlist: 1 })
    expect(s.sectionEmpty).toMatchObject({ following: 1, watchlist: 1 })
    // following 空段率 = 1/3；watchlist = 1/1
    expect(emptySectionRate(s, "following")).toBeCloseTo(1 / 3, 5)
    expect(emptySectionRate(s, "watchlist")).toBe(1)
    // 从未观察到的段不得谎报 0%——分母为 0 必须显式为 null
    expect(emptySectionRate(s, "notifications")).toBeNull()
  })

  it("占比函数：顶层触达率与二级使用占比（分母为 0 返回 null，不谎报 0）", () => {
    const m = createUsageMetrics(emptySnapshot())
    const s = m.recordTabVisit("discover").recordTabVisit("updates").recordSubTabUse("all").recordSubTabUse("illust").snapshot()
    expect(tabShare(s, "discover")).toBe(0.5)
    expect(tabShare(s, "me")).toBe(0) // 计入分母、分子为 0
    expect(subTabShare(s, "all")).toBe(0.5)
    expect(tabShare(emptySnapshot(), "discover")).toBeNull()
    expect(subTabShare(emptySnapshot(), "all")).toBeNull()
  })

  it("不可变：每次记录返回新对象，不就地改传入的快照", () => {
    const base = emptySnapshot()
    const m = createUsageMetrics(base)
    const s = m.recordTabVisit("discover").snapshot()
    expect(base.tabHits).toEqual({}) // 原快照未被污染
    expect(s.tabHits.discover).toBe(1)
  })

  it("非法输入不污染计数（tab 名空白 / 负数间隔）", () => {
    const m = createUsageMetrics(emptySnapshot())
    const s = m.recordTabVisit("   ").recordSubTabUse("").recordSectionObserved("").snapshot()
    expect(Object.keys(s.tabHits)).toEqual([])
    expect(Object.keys(s.subTabHits)).toEqual([])
    expect(Object.keys(s.sectionSeen)).toEqual([])
  })

  it("快照可序列化（本地 prefs 存 JSON 的前提）", () => {
    const m = createUsageMetrics(emptySnapshot())
    const s = m.recordTabVisit("discover").snapshot()
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})

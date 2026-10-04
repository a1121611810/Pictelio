// ─── 本地使用度量（纯逻辑，无 IO 无 Pinia）[维度重构 2026-10-03 新增] ───
//
// 【解决什么】spec §4 P0.5 承诺的四个本地指标，此前**零实现、零读点**——
// 审查审计一 read-point 反事实判据：「把来源值清零，行为会变吗？不会 ⇒ 未接线」，
// 两个审查轴均判为阻塞（Spec P-2，标注 possible silent misconfiguration）。
// 承诺若无读点即 silent misconfiguration（docs/research/review-data-flow-blindspot.md §1/§4）。
//
// 【口径来源】spec §4 P0.5 四行原文，**不是**从实现反推：
//   · 复访间隔     = 相邻两次启动的时间差分布
//   · 顶层触达率   = 4 个顶层各自切入次数占比
//   · 二级使用占比 = 发现页三个二级各被选次数
//   · 空段出现率   = 「更新」页三段各自为空的比例
//
// 【为什么不放 store】本文件是**纯函数状态机**（无 Pinia、无 prefs、无计时器），
// 所以能在 node 下直接单测真语义；接线（prefs 落盘 + 备份域）在 `stores/usageMetrics.ts`。
// 与本仓 `primitives/` 与 `stores/` 的既有分层一致。
//
// 【隐私】决策 5 = A：**只存本地计数与时间戳，不上传任何用户行为**。
// 本文件不产生任何网络出口；落盘键在 stores 层，走既有 prefs seam 与备份通道。
/** 复访样本保留条数（本地容量上界；spec 未规定，取最近 30 次启动） */
export const REVISIT_SAMPLE_LIMIT = 30

export interface UsageMetricsSnapshot {
  /** 相邻两次启动的间隔（ms），只保留最近 REVISIT_SAMPLE_LIMIT 条 */
  revisitIntervalsMs: number[]
  /** 上次启动时间戳（ms）；null = 从未启动过 */
  lastLaunchAt: number | null
  /** 顶层目的地切入次数，按 tab 名 */
  tabHits: Record<string, number>
  /** 「发现」页二级 tab 被选次数 */
  subTabHits: Record<string, number>
  /** **聚合页各段**被观察到的次数（分母）。已接入：`updates`（更新页三段）、
   *  `shelf` 的 `continueReading`（书架段 3，ADR-0219 §2.6 / 票 #926） */
  sectionSeen: Record<string, number>
  /** **聚合页各段为空**的次数（分子） */
  sectionEmpty: Record<string, number>
}

export interface UsageMetrics {
  snapshot(): UsageMetricsSnapshot
  recordLaunch(now: number): UsageMetrics
  recordTabVisit(name: string): UsageMetrics
  recordSubTabUse(key: string): UsageMetrics
  /** observed=该段本次是否为空 */
  recordSectionObserved(name: string, empty?: boolean): UsageMetrics
}

/** 空快照（新用户 / 首次运行） */
export function emptySnapshot(): UsageMetricsSnapshot {
  return {
    revisitIntervalsMs: [],
    lastLaunchAt: null,
    tabHits: {},
    subTabHits: {},
    sectionSeen: {},
    sectionEmpty: {},
  }
}

/** 空白 key 视为无效输入（防 "" / "   " 造成无意义桶） */
function isValidKey(k: string): boolean {
  return typeof k === "string" && k.trim().length > 0
}

function bump(rec: Record<string, number>, key: string): Record<string, number> {
  return { ...rec, [key]: (rec[key] ?? 0) + 1 }
}

export function createUsageMetrics(initial: UsageMetricsSnapshot): UsageMetrics {
  // 归一化一份，避免外部传入的对象被就地改（不可变契约）
  let state: UsageMetricsSnapshot = {
    ...emptySnapshot(),
    ...initial,
    tabHits: { ...(initial.tabHits ?? {}) },
    subTabHits: { ...(initial.subTabHits ?? {}) },
    sectionSeen: { ...(initial.sectionSeen ?? {}) },
    sectionEmpty: { ...(initial.sectionEmpty ?? {}) },
    revisitIntervalsMs: Array.isArray(initial.revisitIntervalsMs) ? [...initial.revisitIntervalsMs] : [],
  }

  const api: UsageMetrics = {
    snapshot: () => JSON.parse(JSON.stringify(state)) as UsageMetricsSnapshot,

    recordLaunch(now: number): UsageMetrics {
      const prev = state.lastLaunchAt
      let intervals = state.revisitIntervalsMs
      if (prev !== null) {
        const delta = now - prev
        // 设备改时间导致倒流 ⇒ 不记负样本（否则分布被污染且无法解释）
        if (delta > 0) {
          intervals = [...intervals, delta].slice(-REVISIT_SAMPLE_LIMIT)
        }
      }
      state = { ...state, lastLaunchAt: now, revisitIntervalsMs: intervals }
      return api
    },

    recordTabVisit(name: string): UsageMetrics {
      if (!isValidKey(name)) return api
      state = { ...state, tabHits: bump(state.tabHits, name) }
      return api
    },

    recordSubTabUse(key: string): UsageMetrics {
      if (!isValidKey(key)) return api
      state = { ...state, subTabHits: bump(state.subTabHits, key) }
      return api
    },

    recordSectionObserved(name: string, empty = false): UsageMetrics {
      if (!isValidKey(name)) return api
      const seen = bump(state.sectionSeen, name)
      const emptyRec = empty ? bump(state.sectionEmpty, name) : state.sectionEmpty
      state = { ...state, sectionSeen: seen, sectionEmpty: emptyRec }
      return api
    },
  }
  return api
}

/** 空段率 = 该段空次数 / 该段被观察次数。从未观察到的段返回 null（**不得谎报 0%**）。 */
export function emptySectionRate(snap: UsageMetricsSnapshot, name: string): number | null {
  const seen = snap.sectionSeen[name] ?? 0
  if (seen === 0) return null
  return (snap.sectionEmpty[name] ?? 0) / seen
}

/** 顶层触达率 = 该 tab 命中数 / 全部命中数之和。分母为 0 返回 null。 */
export function tabShare(snap: UsageMetricsSnapshot, name: string): number | null {
  const total = Object.values(snap.tabHits).reduce((a, b) => a + b, 0)
  if (total === 0) return null
  return (snap.tabHits[name] ?? 0) / total
}

/** 二级使用占比 = 该二级 / 全部二级命中之和。分母为 0 返回 null。 */
export function subTabShare(snap: UsageMetricsSnapshot, key: string): number | null {
  const total = Object.values(snap.subTabHits).reduce((a, b) => a + b, 0)
  if (total === 0) return null
  return (snap.subTabHits[key] ?? 0) / total
}

// ─── 键空间（写入侧与读出侧共用同一份定义）───────────────────────────────
// 【为什么在这里】`subTabHits` / `sectionSeen` 的键由**写入侧**决定（发现页切二级时
//   落 DiscoverTab 值；更新页每段加载完落段名），而**读出侧**（高级页度量面板）
//   要按同样的键去取比率。两边各写一份字面量时，任一侧改键名 ⇒ 分母恒为 0 ⇒
//   比率函数返回 null ⇒ 面板**永久显示「暂无数据」**，无告警、全部门禁仍绿。
//   （第三轮 Standards 审查 I-3 实证的失效形态。）
// ⇒ 键与其展示 label 一并定义在此：**写入侧引用它、读出侧引用它**，改一处即两处同变。

/** 发现页二级 tab 的度量键（'all' = 插画+小说混流） */
export type DiscoverTabKey = 'all' | 'illust' | 'novel'

/** 二级使用占比的行定义：键（落库用）+ 展示 label（i18n） */
export const DISCOVER_SUB_TAB_METRIC_ROWS: ReadonlyArray<{
  key: DiscoverTabKey
  labelKey: 'discover.tab.all' | 'discover.tab.illust' | 'discover.tab.novel'
}> = [
  { key: 'all', labelKey: 'discover.tab.all' },
  { key: 'illust', labelKey: 'discover.tab.illust' },
  { key: 'novel', labelKey: 'discover.tab.novel' },
]

/** 「更新」页三段的度量键（= 段 id） */
export type UpdateSectionKey = 'following' | 'watchlist' | 'notifications'


/**
 * **聚合页分段度量键**（票 #926 / ADR-0219 §2.6 收口）。
 *
 * ⚠️ 为什么收窄成联合类型：此前 `recordSectionObserved(name: string, …)` 接受任意
 * 字符串，于是「写进一个没人看的桶」不会有任何编译期或运行期信号 —— 把
 * `'continueReading'` 拼错，`pnpm check` 不红、面板不变、数据照写
 * （possible silent misconfiguration，docs/research/review-data-flow-blindspot.md §1/§4）。
 * 收窄后新增段名必须同步登记进 `UPDATE_SECTION_METRIC_ROWS`（有消费面），否则拼错在类型层转红。
 */
export type AggregateSectionKey = UpdateSectionKey | 'continueReading'

/**
 * 聚合页分段度量面板行（`AdvancedSettings.vue`「本地使用度量」面板消费）。
 * ⚠️ 新增段名**必须**在此登记，否则桶无消费面（数据照写、永不可见）。
 */
export const UPDATE_SECTION_METRIC_ROWS: ReadonlyArray<{
  key: AggregateSectionKey
  labelKey: 'updates.section.following' | 'updates.section.watchlist' | 'updates.section.notifications' | 'shelf.section.continueReading'
}> = [
  { key: 'following', labelKey: 'updates.section.following' },
  { key: 'watchlist', labelKey: 'updates.section.watchlist' },
  { key: 'notifications', labelKey: 'updates.section.notifications' },
  // 书架段 3「继续读」（票 #926）：小说阅读位置 + （#927 起）插画浏览历史同段混排。
  // 复用已有的 `shelf.section.continueReading` 段标题键，面板不新造文案。
  { key: 'continueReading', labelKey: 'shelf.section.continueReading' },
]

// ─── 本地使用度量 store（接线层）[维度重构 2026-10-03 新增] ───
//
// 【解决什么】spec §4 P0.5 承诺的四个本地指标此前**零实现、零读点**（Spec 审计 P-2 判阻塞，
//  标注 possible silent misconfiguration）。本 store 是该承诺的**读点所在**：
//  纯逻辑在 `primitives/usageMetrics.ts`（可单测），本文件只做 prefs 落盘 + Pinia 暴露。
//
// 【隐私】决策 5 = A：**只存本地，不上传任何用户行为**。本 store 无任何网络出口；
//  落盘走既有 `prefs` seam（原生 PictelioPrefs / web-core idbKV）。
//  ⚠️ 刻意**不进**备份域：使用度量是设备行为、不随账号同步，也不应随备份外传。
//     故键名不带 uid 前缀，且不在 settingsStore 的 BACKUP_DEVICE_KEYS 内。
import { defineStore } from "pinia"
import { ref } from "vue"
import { prefs } from "./settingsStore"
import {
  createUsageMetrics,
  emptySnapshot,
  type UsageMetrics,
  type UsageMetricsSnapshot,
} from "../primitives/usageMetrics"

/** 落盘键（设备级、无 uid 后缀 ⇒ 不进备份域） */
export const USAGE_METRICS_KEY = "usage_metrics_v1"

async function readSnapshot(): Promise<UsageMetricsSnapshot> {
  try {
    // prefs() 是工厂（不是实例），get 是异步 —— 与 watchLaterStore:189 同款用法
    const raw = await prefs().get(USAGE_METRICS_KEY)
    if (!raw) return emptySnapshot()
    return { ...emptySnapshot(), ...(JSON.parse(raw) as Partial<UsageMetricsSnapshot>) }
  } catch (e) {
    // 读取失败不静默：按首次使用处理并告警（测试硬约束 #3 禁静默降级）
    console.warn("[usageMetrics] 快照读取失败（按首次使用处理）", e)
    return emptySnapshot()
  }
}

export const useUsageMetricsStore = defineStore("usageMetrics", () => {
  // ⚠️ metrics 放 ref 而非常量：hydrate 需要**整体替换**实例（纯逻辑是闭包状态机，
  //   外部无法逐字段写入其内部 state）。这也是"为什么不能用 const"的唯一理由。
  const metrics = ref<UsageMetrics>(createUsageMetrics(emptySnapshot()))
  const snap = ref<UsageMetricsSnapshot>(emptySnapshot())

  function refresh(): void {
    snap.value = metrics.value.snapshot()
  }

  /** 落盘是异步旁路，**不 await**（度量绝不能阻塞用户操作）；失败显式告警不静默 */
  function schedulePersist(): void {
    void prefs()
      .set(USAGE_METRICS_KEY, JSON.stringify(metrics.value.snapshot()))
      .catch((e) => {
        console.warn("[usageMetrics] 快照落盘失败", e)
      })
  }

  function commit(fn: (m: UsageMetrics) => UsageMetrics): void {
    if (hydrating) {
      // 窗口内：先记下变换，hydrate 完成后重放，避免被整体替换吞掉
      deferred.push(fn)
      return
    }
    metrics.value = fn(metrics.value)
    refresh()
    schedulePersist()
  }

  /**
   * hydrate 窗口内发生的记录**缓冲起来**，加载完成后重放。
   *
   * ⚠️ 第二轮 review 的 blocking（P2-1）：初版 hydrate 直接
   *   `metrics.value = createUsageMetrics(loaded)` **整体替换**，而 hydrate 期间
   *   prefs().get（原生 callback）会让出执行权 —— 另外三个 record 读点
   *   （globalFab 选 tab / Recommended 切二级 / Updates 段拉取完成）完全可能先落地，
   *   后果有两条：① 那些记录被覆盖丢弃；② 它们的 schedulePersist() 会把
   *   `lastLaunchAt: null` 写盘，若 hydrate 恰好读到该值，**历史 lastLaunchAt 被清空**，
   *   于是 recordLaunch 的 `prev !== null` 不再成立 ⇒「相邻两次启动的时间差」从此断链且不可恢复。
   *   ⇒ 缓冲 + 重放：加载到的历史与窗口内的新记录**合并**，互不覆盖。
   */
  let hydrating = false
  const deferred: Array<(m: UsageMetrics) => UsageMetrics> = []

  async function hydrate(): Promise<void> {
    if (!hydrating) hydrating = true
    const loaded = await readSnapshot()
    let m = createUsageMetrics(loaded)
    for (const replay of deferred) m = replay(m)
    const replayed = deferred.length
    deferred.length = 0
    metrics.value = m
    hydrating = false
    refresh()
    // ⚠️ 有重放就**立刻补一次落盘**。初版漏了这一步：窗口内的记录虽然合进了内存，
    //   但 hydrate 自身从不落盘 ⇒ 冷启动后若再无任何 record*（用户看一眼就走），
    //   那条记录就随进程消失。实测（src/stores/usageMetrics.test.ts
    //   「多次 hydrate 不会把同一批记录重放两次」）正是在第二次 hydrate 读盘时读到空快照。
    if (replayed > 0) schedulePersist()
  }

  /** 记录一次启动（相邻差值即 spec §4 P0.5 的「复访间隔」） */
  function recordLaunch(now: number): void {
    commit((m) => m.recordLaunch(now))
  }
  /** 记录顶层目的地切入（「顶层触达率」的分子） */
  function recordTabVisit(name: string): void {
    commit((m) => m.recordTabVisit(name))
  }
  /** 记录「发现」页二级 tab 被选（「二级使用占比」的分子） */
  function recordSubTabUse(key: string): void {
    commit((m) => m.recordSubTabUse(key))
  }
  /** 记录「更新」页某段被观察到（empty = 该段本次为空，「空段出现率」的分子/分母） */
  function recordSectionObserved(name: string, empty: boolean): void {
    commit((m) => m.recordSectionObserved(name, empty))
  }

  return { snap, hydrate, recordLaunch, recordTabVisit, recordSubTabUse, recordSectionObserved }
})

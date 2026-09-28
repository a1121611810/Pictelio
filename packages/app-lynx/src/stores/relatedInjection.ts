// 相关作品注入行状态机（spec docs/specs/related-injection.md §3/§4，lynx 侧）
// 语义与 app 端 relatedInjectionStore.ts 对齐：
// - pendingAnchor：点击插画卡进详情前记录，页面 onActivated（KeepAlive 回前台）消费，一次性；
// - rows：每个 tab 会话内最多 MAX_RELATED_ANCHORS 行；刷新 / 切 tab 清空；
// - 行带 loading 态：消费即占位，related 成功填充 / 失败移除并 warn；
// - 过滤链：settings.isRestricted + isAiRestricted + isTagMuted（静音标签，ADR-0187 / #732；lynx 无屏蔽列表能力）；
// - 去重：同锚点不重复注入；行内容排除锚点与主列表已展示 id。
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { loadRelated } from '../api/illust'
import { toIllustId } from '../api/id'
import type { PixivIllust } from '../api/types'
import { useSettingsStore } from './settingsStore'

export interface RelatedRow {
  /** 锚点作品 id（行渲染在主列表该 id 卡片之后） */
  anchorId: number
  /** 相关作品（已过滤；loading 期间为空数组） */
  items: PixivIllust[]
  /** related 请求进行中（渲染骨架占位） */
  loading: boolean
}

/** 每个 tab 会话内最多注入的锚点行数 */
export const MAX_RELATED_ANCHORS = 3
/** 单行相关作品上限 */
export const RELATED_ROW_SIZE = 20
/** lynx 卡内展开段网格（spec §5.2 v2，ADR-0162）：4 = 2 行 × 2 列（列宽 48.4vw 内），超出截断 */
export const RELATED_GRID_SIZE = 4
/** related 缓存时长（同一作品反复进出零重复请求） */
const RELATED_CACHE_TTL_MS = 5 * 60_000
/** 缓存容量上限（防长会话无界累积） */
const RELATED_CACHE_MAX = 50

export type RelatedFeedTab = 'recommend' | 'follow'

/** 模块级缓存：anchorId → 过滤后条目（时间戳失效 + 容量上限淘汰） */
const cache = new Map<number, { at: number; items: PixivIllust[] }>()

async function fetchRelatedIllusts(settings: ReturnType<typeof useSettingsStore>, anchorId: number): Promise<PixivIllust[]> {
  const hit = cache.get(anchorId)
  if (hit) {
    if (Date.now() - hit.at < RELATED_CACHE_TTL_MS) return hit.items
    cache.delete(anchorId)
  }
  const res = await loadRelated(toIllustId(anchorId))
  const items = res.illusts
    .filter(
      (i) =>
        !settings.isRestricted(i) && !settings.isAiRestricted(i) && !settings.isTagMuted(i),
    )
    .slice(0, RELATED_ROW_SIZE)
  if (cache.size >= RELATED_CACHE_MAX) {
    // 简单 FIFO 淘汰：删最早写入的 key（Map 迭代序 = 插入序）
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(anchorId, { at: Date.now(), items })
  return items
}

export const useRelatedInjectionStore = defineStore('relatedInjection', () => {
  const pendingAnchor = ref<{ tab: RelatedFeedTab; illustId: number } | null>(null)
  const rowsByTab = ref<Record<RelatedFeedTab, RelatedRow[]>>({ recommend: [], follow: [] })

  function rows(tab: RelatedFeedTab): RelatedRow[] {
    return rowsByTab.value[tab]
  }

  /** 渲染查询（ADR-0162 卡内展开段）：锚点 id → 该卡应展示的行；无则 undefined。
   * 响应性：读 rowsByTab.value，mutateRows 整体替换即触发全部读者 */
  function rowFor(tab: RelatedFeedTab, anchorId: number): RelatedRow | undefined {
    return rowsByTab.value[tab].find((r) => r.anchorId === anchorId)
  }

  /** 点击首页插画卡片进详情前调用（注入行内点击不记录，防循环注入） */
  function recordAnchor(tab: RelatedFeedTab, illustId: number): void {
    pendingAnchor.value = { tab, illustId }
  }

  function mutateRows(tab: RelatedFeedTab, fn: (rows: RelatedRow[]) => void): void {
    const rows = rowsByTab.value[tab]
    fn(rows)
    // ref 内数组原地变更需整体触发（vue-lynx patch 对深层变更的响应不可靠，ADR-0107 D4）
    rowsByTab.value = { ...rowsByTab.value, [tab]: [...rows] }
  }

  /**
   * 页面 onActivated 消费 pendingAnchor（一次性；tab 不匹配时保留给正确的 tab）。
   * mainListIds：主列表当前已展示作品 id（行内容排除重复）。
   * 失败路径不注入行，仅 warn（增强能力失败不影响主列表）。
   *
   * ⚠️ 2026-09-28 #816：**每个提前 return 都必须打日志**（禁静默降级，仓库测试硬约束 3）。
   * 此前 5 个 return 分支全部无声，导致「注入段未渲染」无法区分是
   * 「无锚点 / tab 不匹配 / 开关关 / 已有同锚点行 / 超上限 / 拉到空结果」——
   * 设备实测（benchNav illust → 点卡进详情 → 返回）复现未渲染且 logcat 零命中，
   * 正是这些静默 return 造成的定位盲区。原因码见各处 SKIP_*。
   */
  async function consumeAnchor(tab: RelatedFeedTab, mainListIds: readonly number[]): Promise<void> {
    const anchor = pendingAnchor.value
    if (anchor === null) {
      console.warn(`[relatedInjection] 跳过：SKIP_NO_ANCHOR（无待消费锚点，tab=${tab}）`)
      return
    }
    if (anchor.tab !== tab) {
      // 跨 tab 到达属正常路径（锚点保留给正确的 tab），仅 debug 级说明
      console.warn(
        `[relatedInjection] 跳过：SKIP_TAB_MISMATCH（锚点 tab=${anchor.tab}，当前 tab=${tab}；锚点已保留）`,
      )
      return
    }
    pendingAnchor.value = null
    const settings = useSettingsStore()
    if (!settings.relatedInjection) {
      console.warn(`[relatedInjection] 跳过：SKIP_DISABLED（设置 relatedInjection 关闭，anchor=${anchor.illustId}）`)
      return
    }
    if (rows(tab).some((r) => r.anchorId === anchor.illustId)) {
      console.warn(
        `[relatedInjection] 跳过：SKIP_DUPLICATE（该锚点已有注入行，anchor=${anchor.illustId}）`,
      )
      return
    }
    if (rows(tab).length >= MAX_RELATED_ANCHORS) {
      console.warn(
        `[relatedInjection] 跳过：SKIP_MAX_ANCHORS（已达上限 ${MAX_RELATED_ANCHORS}，anchor=${anchor.illustId}）`,
      )
      return
    }

    const anchorId = anchor.illustId
    mutateRows(tab, (rs) => rs.push({ anchorId, items: [], loading: true }))
    console.log(`[relatedInjection] 开始拉取相关作品（anchor=${anchorId}，tab=${tab}）`)
    try {
      const seen = new Set<number>(mainListIds)
      seen.add(anchorId)
      const items = (await fetchRelatedIllusts(settings, anchorId)).filter((i) => !seen.has(i.id))
      if (items.length === 0) {
        mutateRows(tab, (rs) => {
          const idx = rs.findIndex((r) => r.anchorId === anchorId)
          if (idx >= 0) rs.splice(idx, 1)
        })
        console.warn(
          `[relatedInjection] 跳过：SKIP_EMPTY_RESULT（拉到 0 条可用相关作品，anchor=${anchorId}）`,
        )
        return
      }
      mutateRows(tab, (rs) => {
        const row = rs.find((r) => r.anchorId === anchorId)
        if (row) {
          row.items = items
          row.loading = false
        }
      })
      console.log(`[relatedInjection] 注入完成（anchor=${anchorId}，items=${items.length}）`)
    } catch (err) {
      mutateRows(tab, (rs) => {
        const idx = rs.findIndex((r) => r.anchorId === anchorId)
        if (idx >= 0) rs.splice(idx, 1)
      })
      console.warn(`[relatedInjection] 相关作品加载失败（anchor=${anchorId}）`, err)
    }
  }

  /** 收起按钮：移除单行 */
  function removeRow(tab: RelatedFeedTab, anchorId: number): void {
    mutateRows(tab, (rs) => {
      const idx = rs.findIndex((r) => r.anchorId === anchorId)
      if (idx >= 0) rs.splice(idx, 1)
    })
  }

  /** 刷新 / 切 tab 重建：清空该 tab 会话内全部注入行 */
  function clearRows(tab: RelatedFeedTab): void {
    mutateRows(tab, (rs) => {
      rs.length = 0
    })
  }

  return { pendingAnchor, rowsByTab, rows, rowFor, recordAnchor, consumeAnchor, removeRow, clearRows }
})

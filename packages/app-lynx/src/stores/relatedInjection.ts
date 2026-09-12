// 相关作品注入行状态机（spec docs/specs/related-injection.md §3/§4，lynx 侧）
// 语义与 app 端 relatedInjectionStore.ts 对齐：
// - pendingAnchor：点击插画卡进详情前记录，页面 onActivated（KeepAlive 回前台）消费，一次性；
// - rows：每个 tab 会话内最多 MAX_RELATED_ANCHORS 行；刷新 / 切 tab 清空；
// - 行带 loading 态：消费即占位，related 成功填充 / 失败移除并 warn；
// - 过滤链：settings.isRestricted + isAiRestricted（lynx 无屏蔽列表能力）；
// - 去重：同锚点不重复注入；行内容排除锚点与主列表已展示 id。
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { loadRelated } from '../api/illust'
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
/** related 缓存时长（同一作品反复进出零重复请求） */
const RELATED_CACHE_TTL_MS = 5 * 60_000

export type RelatedFeedTab = 'recommend' | 'follow'

/** 模块级缓存：anchorId → 过滤后条目（时间戳失效） */
const cache = new Map<number, { at: number; items: PixivIllust[] }>()

async function fetchRelatedIllusts(settings: ReturnType<typeof useSettingsStore>, anchorId: number): Promise<PixivIllust[]> {
  const hit = cache.get(anchorId)
  if (hit && Date.now() - hit.at < RELATED_CACHE_TTL_MS) return hit.items
  const res = await loadRelated(anchorId)
  const items = res.illusts
    .filter((i) => !settings.isRestricted(i) && !settings.isAiRestricted(i))
    .slice(0, RELATED_ROW_SIZE)
  cache.set(anchorId, { at: Date.now(), items })
  return items
}

export const useRelatedInjectionStore = defineStore('relatedInjection', () => {
  const pendingAnchor = ref<{ tab: RelatedFeedTab; illustId: number } | null>(null)
  const rowsByTab = ref<Record<RelatedFeedTab, RelatedRow[]>>({ recommend: [], follow: [] })

  function rows(tab: RelatedFeedTab): RelatedRow[] {
    return rowsByTab.value[tab]
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
   */
  async function consumeAnchor(tab: RelatedFeedTab, mainListIds: readonly number[]): Promise<void> {
    const anchor = pendingAnchor.value
    if (anchor === null || anchor.tab !== tab) return
    pendingAnchor.value = null
    const settings = useSettingsStore()
    if (!settings.relatedInjection) return
    if (rows(tab).some((r) => r.anchorId === anchor.illustId)) return
    if (rows(tab).length >= MAX_RELATED_ANCHORS) return

    const anchorId = anchor.illustId
    mutateRows(tab, (rs) => rs.push({ anchorId, items: [], loading: true }))
    try {
      const seen = new Set<number>(mainListIds)
      seen.add(anchorId)
      const items = (await fetchRelatedIllusts(settings, anchorId)).filter((i) => !seen.has(i.id))
      if (items.length === 0) {
        mutateRows(tab, (rs) => {
          const idx = rs.findIndex((r) => r.anchorId === anchorId)
          if (idx >= 0) rs.splice(idx, 1)
        })
        return
      }
      mutateRows(tab, (rs) => {
        const row = rs.find((r) => r.anchorId === anchorId)
        if (row) {
          row.items = items
          row.loading = false
        }
      })
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

  return { pendingAnchor, rowsByTab, rows, recordAnchor, consumeAnchor, removeRow, clearRows }
})

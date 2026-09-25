// ─── 通知中心 store（ADR-0188 D3/D5 / spec docs/specs/notification-center.md）───
// 职责分层：
//   - 纯函数（node 可单测，本文件导出）：
//       countUnreadNotifications  未读推导真值表（created_datetime 经 Date.parse 与
//                                 设备级已读时间戳比较，严格晚于才计；解析失败该条不计 + warn）
//       flattenNotifications      无限分页 accumulate（pages → 单列表，兼容 p.notifications）
//       buildNotificationRows     组头展开「就地插入」行模型（展开单向不收起，spec 边界 9）
//   - Vue Query 消费面：
//       useNotificationsList      列表（useApiInfiniteQuery，queryKeys.notifications.list()，
//                                 next_url 透传；generation-gate / 双错误槽位内建）
//       useNotificationChildren   组头子列表（独立 query 键 ['pictelio','notifications','children',id]，
//                                 由 NotificationChildren 子组件 setup 内调用——Vue 组合式函数
//                                 必须在组件上下文调用，就地插入 = 每个展开组头渲染一个子组件）
//   - Pinia 状态（角标 + 已读推进）：
//       unreadCount               Me 入口行未读圆点数据源
//       refreshUnreadBadge        Me 页挂载静默刷新（fetchInfiniteQuery 首页 1 页；失败 warn 不打扰页面）
//       notifyListLoaded          通知页列表拉取成功后推进已读（失败不推进，spec 边界 10）
//
// 键 `notifications_last_read_time`：设备级、双端逐字同键（ADR-0103 共享介质）、不进备份域
// （设备级体验数据，ADR-0188 D5）。prefs seam 形态对齐 stores/downloadStore（原生 PictelioPrefs /
// dev IndexedDB 双 adapter，stores/settingsStore 的 seam 为其私有实现不外借）。
import { ref } from "vue"
import { defineStore } from "pinia"
import { queryClient } from "../api/queryClient"
import { queryKeys } from "../api/queryKeys"
import { getNativeModules, isNativeMode } from "../api/client"
import { loadNotifications, loadNotificationChildren } from "../api/notification"
import type { PixivNotificationItem, PixivNotificationListResponse } from "../api/types"
import { useApiInfiniteQuery } from "../primitives/useApiInfiniteQuery"
import { idbGet, idbSet } from "../utils/idbKV"
import { unquoteNativeString } from "../utils/tokenStorage"

/** 设备级已读时间戳键（ISO 字符串；与 webview 侧逐字一致，ADR-0188 D5） */
export const NOTIFICATIONS_LAST_READ_KEY = "notifications_last_read_time"

// ─── 纯函数：未读推导（spec 边界 6）───

/** created_datetime → 毫秒；NaN（畸形串）返回 null 由调用方显式处置 */
export function parseCreatedTimeMs(createdDatetime: string): number | null {
  const ms = Date.parse(createdDatetime)
  return Number.isNaN(ms) ? null : ms
}

/**
 * 未读数 = created_datetime 严格晚于 lastReadMs 的条目数（等值不计——「看完那一刻」
 * 产生的通知才算新，ADR-0188 D5）。lastReadMs 为 null（首次使用无键）→ 全部可解析条目计未读。
 * 解析失败该条不计 + console.warn（禁静默降级，测试硬约束 #3）。
 */
export function countUnreadNotifications(
  items: PixivNotificationItem[],
  lastReadMs: number | null,
): number {
  let count = 0
  for (const item of items) {
    const ms = parseCreatedTimeMs(item.created_datetime)
    if (ms === null) {
      // 实参逗号分隔（非模板插值）：直参字符串经 hardcode-gate 的 console 豁免
      console.warn("[notificationStore] 通知时间解析失败，该条不计未读: id=", item.id, "created_datetime=", item.created_datetime)
      continue
    }
    if (lastReadMs === null || ms > lastReadMs) count++
  }
  return count
}

// ─── 纯函数：分页 accumulate 与组头插入行模型 ───

/** 无限分页 accumulate：InfiniteData.pages → 单列表（flatten 兼容 p.notifications 顶层字段） */
export function flattenNotifications(pages: PixivNotificationListResponse[]): PixivNotificationItem[] {
  return pages.flatMap((p) => p.notifications ?? [])
}

/** 组头判定：view_more 非空（spec 术语表「组头」） */
export function isGroupHeader(item: PixivNotificationItem): boolean {
  return item.view_more != null
}

/**
 * 渲染行（ADR-0162 结构规避）：行模型只含两类——
 *   - header：组头行（view_more 非空），expanded 标记该组是否已展开；展开后子列表
 *     （NotificationChildren）**内嵌该行 list-item 根 view 内**条件渲染——独立 children
 *     list-item 会在展开瞬间向原生 <list> 中途插入 item（ADR-0162「插入 = 静默丢弃」），
 *     结构上规避（RelatedInlineSection 卡内展开段先例）。
 *   - item：普通通知行。
 */
export interface NotificationRow {
  kind: "item" | "header"
  item: PixivNotificationItem
  /** header 行：组头是否已展开（子列表内嵌该行内；展开单向不收起） */
  expanded?: boolean
  /** list-item :key（`h-${id}` / `n-${id}`，id 全局唯一 → key 全列表稳定唯一） */
  key: string
}

/**
 * 组头展开行模型：展开状态单向不收起（spec 边界 9）→ expandedHeaders 只增不减；
 * 行顺序恒等于服务端顺序（展开不增删行，只改 header 行的 expanded 标记——原生 <list>
 * 行数不变，规避 ADR-0162 中途插入/移除两类平台陷阱）。
 */
export function buildNotificationRows(
  items: PixivNotificationItem[],
  expandedHeaders: Record<number, boolean>,
): NotificationRow[] {
  const rows: NotificationRow[] = []
  for (const item of items) {
    if (isGroupHeader(item)) {
      rows.push({
        kind: "header",
        item,
        expanded: expandedHeaders[item.id] === true,
        key: `h-${item.id}`,
      })
    } else {
      rows.push({ kind: "item", item, key: `n-${item.id}` })
    }
  }
  return rows
}

// ─── Vue Query 消费面 ───

/**
 * 通知列表（通知页主体）：next_url 透传分页；staleTime 0（queryClient 全局默认）→
 * 每次进入页面 refetchOnMount，对齐「角标刷新时机 = 页面挂载」（ADR-0188 D7 lynx 侧）。
 */
export function useNotificationsList() {
  return useApiInfiniteQuery({
    queryKey: queryKeys.notifications.list(),
    queryFn: ({ pageParam, signal }) => loadNotifications(pageParam ?? undefined, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: PixivNotificationListResponse) => last.next_url,
  })
}

/**
 * 组头摊平子列表（NotificationChildren 子组件 setup 内调用）：
 * 独立 query 键；首屏走 view-more?notification_id=，翻页透传 older_than 游标。
 */
export function useNotificationChildren(headerId: number) {
  return useApiInfiniteQuery({
    queryKey: queryKeys.notifications.children(headerId),
    queryFn: ({ pageParam, signal }) => loadNotificationChildren(headerId, pageParam ?? undefined, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: PixivNotificationListResponse) => last.next_url,
  })
}

// ─── prefs seam（形态对齐 stores/downloadStore：原生 PictelioPrefs / dev IndexedDB）───

interface NativePrefs {
  prefsGet(key: string, callback: (value: string, err: string | null) => void): void
  prefsSet(key: string, value: string, callback: (err: string | null) => void): void
}

function nativeKv() {
  const mod = getNativeModules()?.PictelioPrefs as NativePrefs | undefined
  return {
    get(key: string): Promise<string | null> {
      return new Promise((resolve) => {
        if (!mod) {
          console.warn("[notificationStore] 原生 PictelioPrefs 不可用（按缺失处理）")
          resolve(null)
          return
        }
        mod.prefsGet(key, (value, err) => {
          if (err) {
            console.warn("[notificationStore] 原生读取失败", err)
            resolve(null)
            return
          }
          // lynx Callback 字符串带 JSON 引号（tokenStorage 同款坑）——unquote；缺失映射 null
          resolve(value === "" ? null : unquoteNativeString(value))
        })
      })
    },
    set(key: string, value: string): Promise<void> {
      return new Promise((resolve, reject) => {
        if (!mod) {
          console.warn("[notificationStore] 原生 PictelioPrefs 不可用（写失败）")
          reject(new Error("native prefs unavailable"))
          return
        }
        mod.prefsSet(key, value, (err) => {
          if (err) {
            console.warn("[notificationStore] 原生写入失败", err)
            reject(new Error(err))
          } else {
            resolve()
          }
        })
      })
    },
  }
}

function devKv() {
  return { get: (key: string) => idbGet(key), set: (key: string, value: string) => idbSet(key, value) }
}

function kv() {
  return isNativeMode() ? nativeKv() : devKv()
}

/** 读已读时间戳（毫秒）；键缺失 → null（首次使用，全部计未读）；存储值畸形 → warn + null（不静默） */
export async function loadLastReadMs(): Promise<number | null> {
  let raw: string | null
  try {
    raw = await kv().get(NOTIFICATIONS_LAST_READ_KEY)
  } catch (e) {
    console.warn("[notificationStore] 已读时间戳读取失败（按首次使用处理）", e)
    return null
  }
  if (raw === null) return null
  const ms = Date.parse(raw)
  if (Number.isNaN(ms)) {
    console.warn("[notificationStore] 已读时间戳值畸形，按首次使用处理:", raw)
    return null
  }
  return ms
}

/** Pinia 状态：角标未读数（Me 入口行圆点）+ 已读推进 */
export const useNotificationStore = defineStore("notifications", () => {
  const unreadCount = ref(0)

  /**
   * Me 页挂载静默刷新（ADR-0188 D7 lynx 侧；无前台恢复通道，挂账）：复用列表 query
   * 的键与 queryFn 取首页 1 页（fetchInfiniteQuery pages:1，命中/填充同一缓存条目），
   * 仅更新计数，失败 warn 且不改动页面（保持上次计数，非静默）。
   */
  async function refreshUnreadBadge(): Promise<void> {
    try {
      const data = await queryClient.fetchInfiniteQuery({
        queryKey: queryKeys.notifications.list(),
        queryFn: ({ pageParam, signal }) => loadNotifications(pageParam ?? undefined, signal),
        initialPageParam: null as string | null,
        getNextPageParam: (last: PixivNotificationListResponse) => last.next_url,
        pages: 1,
      })
      const lastReadMs = await loadLastReadMs()
      unreadCount.value = countUnreadNotifications(data.pages[0]?.notifications ?? [], lastReadMs)
    } catch (e) {
      console.warn("[notificationStore] 未读角标静默刷新失败（保留上次计数）", e)
    }
  }

  /**
   * 已读推进（ADR-0188 D5 / spec 边界 10）：仅在列表拉取**成功后**由通知页调用
   * （见 notifyListLoaded）；写当前时刻 + 角标清零。写失败 warn（键保留旧值 → 未读不丢）。
   */
  async function markNotificationsRead(now: Date = new Date()): Promise<void> {
    try {
      await kv().set(NOTIFICATIONS_LAST_READ_KEY, now.toISOString())
      unreadCount.value = 0
    } catch (e) {
      console.warn("[notificationStore] 已读时间戳写入失败（未读保持）", e)
    }
  }

  /** 通知页列表结果接线：失败不推进（spec 边界 10——保证未读不丢），成功才 markNotificationsRead */
  function notifyListLoaded(success: boolean): void {
    if (!success) return
    void markNotificationsRead()
  }

  return { unreadCount, refreshUnreadBadge, markNotificationsRead, notifyListLoaded }
})

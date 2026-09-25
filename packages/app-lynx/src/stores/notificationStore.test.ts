// ─── notificationStore 单测（ADR-0188 D3/D5 / spec 测试决策；#728）───
// 覆盖矩阵（ticket 验收）：
//   - 未读推导真值表：新 / 旧 / 等值 / 解析失败 warn（+ 首次使用无键全计）
//   - 已读推进条件：成功才推进（notifyListLoaded(false) 零写）；写入值为可解析 ISO；
//     写失败 warn 不清角标
//   - 分页 accumulate：flattenNotifications 多页保序（fixture 真实样例）
//   - 组头插入：buildNotificationRows 就地插入 + 展开单向 + key 稳定唯一
// mock 模式对齐 settingsStore.test / searchHistoryStore.test：vi.mock idbKV（node 无 indexedDB）、
// vi.mock api/client（isNativeMode=false → dev KV 路径）、vi.mock api/queryClient（隔离模块级
// setQueryDefaults 副作用）。Pinia 用 setActivePinia 直驱（watchlistStore 同款姿态）。
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { createPinia, setActivePinia } from "pinia"

const { idbGetMock, idbSetMock, fetchInfiniteQueryMock } = vi.hoisted(() => ({
  idbGetMock: vi.fn(),
  idbSetMock: vi.fn(),
  fetchInfiniteQueryMock: vi.fn(),
}))

vi.mock("../utils/idbKV", () => ({
  idbGet: idbGetMock,
  idbSet: idbSetMock,
  idbRemove: vi.fn(),
}))
vi.mock("../api/client", () => ({
  isNativeMode: () => false,
  getNativeModules: () => undefined,
}))
vi.mock("../api/queryClient", () => ({
  queryClient: { fetchInfiniteQuery: fetchInfiniteQueryMock },
}))

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  NOTIFICATIONS_LAST_READ_KEY,
  buildNotificationRows,
  countUnreadNotifications,
  flattenNotifications,
  loadLastReadMs,
  parseCreatedTimeMs,
  useNotificationStore,
} from "./notificationStore"
import type { PixivNotificationItem, PixivNotificationListResponse } from "../api/types"

function loadFixture(name: string): PixivNotificationListResponse {
  return JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../api/__fixtures__/${name}`, import.meta.url)),
      "utf8",
    ),
  ) as PixivNotificationListResponse
}

/** 定向构造一条通知（仅未读推导输入字段） */
function notif(created: string): PixivNotificationItem {
  return {
    id: 1,
    created_datetime: created,
    content: { text: "<b>x</b>" },
    view_more: null,
    target_url: "pixiv://users/1",
    is_read: false,
  }
}

describe("countUnreadNotifications 未读真值表（spec 边界 6）", () => {
  const LAST_READ = parseCreatedTimeMs("2026-09-25T00:00:00+09:00")!

  it("新通知（晚于已读时间戳）→ 计入", () => {
    expect(countUnreadNotifications([notif("2026-09-26T03:38:49+09:00")], LAST_READ)).toBe(1)
  })

  it("旧通知（早于已读时间戳）→ 不计", () => {
    expect(countUnreadNotifications([notif("2026-09-01T00:00:00+09:00")], LAST_READ)).toBe(0)
  })

  it("等值（等于已读时间戳）→ 不计（严格晚于才计，ADR-0188 D5「晚于该键」）", () => {
    expect(countUnreadNotifications([notif("2026-09-25T00:00:00+09:00")], LAST_READ)).toBe(0)
  })

  it("混合集合分别计数", () => {
    const items = [
      notif("2026-09-26T03:38:49+09:00"),
      notif("2026-09-01T00:00:00+09:00"),
      notif("2026-09-26T10:00:00+09:00"),
    ]
    expect(countUnreadNotifications(items, LAST_READ)).toBe(2)
  })

  it("解析失败该条不计 + console.warn（禁静默降级）", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const items = [notif("not-a-date"), notif("2026-09-26T03:38:49+09:00")]
    expect(countUnreadNotifications(items, LAST_READ)).toBe(1)
    // 实参逗号分隔形态（hardcode-gate console 豁免），首参含模块前缀即可
    expect(warnSpy.mock.calls[0]?.[0]).toContain("[notificationStore] 通知时间解析失败")
    warnSpy.mockRestore()
  })

  it("首次使用（已读键缺失 null）→ 全部可解析条目计未读", () => {
    expect(
      countUnreadNotifications([notif("2020-01-01T00:00:00+09:00"), notif("2026-09-26T00:00:00+09:00")], null),
    ).toBe(2)
  })
})

describe("flattenNotifications 分页 accumulate（fixture 真实样例）", () => {
  it("多页顺序拼接（页序 × 页内序，不重排）", () => {
    const page1 = loadFixture("notification-list.json")
    const page2 = loadFixture("notification-viewmore.json")
    const flat = flattenNotifications([page1, page2])
    expect(flat.length).toBe(page1.notifications.length + page2.notifications.length)
    expect(flat[0]).toEqual(page1.notifications[0])
    expect(flat[page1.notifications.length]).toEqual(page2.notifications[0])
  })
})

describe("buildNotificationRows 组头插入（spec §US2 / 边界 9）", () => {
  const list = loadFixture("notification-list.json").notifications
  // fixture[0] 为组头（view_more 非空），fixture[2] 为普通条目
  const header = list[0]!
  const plain = list[2]!

  it("未展开组头：无子区行，顺序不变", () => {
    const rows = buildNotificationRows([header, plain], {})
    expect(rows.map((r) => r.kind)).toEqual(["header", "item"])
    expect(rows[0]!.key).toBe(`h-${header.id}`)
    expect(rows[1]!.key).toBe(`n-${plain.id}`)
  })

  it("展开组头：children 行就地插入组头之后、后续条目之前", () => {
    const rows = buildNotificationRows([plain, header, plain], { [header.id]: true })
    expect(rows.map((r) => r.kind)).toEqual(["item", "header", "children", "item"])
    expect(rows[2]!.headerId).toBe(header.id)
    expect(rows[2]!.key).toBe(`c-${header.id}`)
  })

  it("展开单向不收起：expanded 只增不减（重复构建保持子区）", () => {
    const expanded = { [header.id]: true }
    expect(buildNotificationRows([header], expanded).length).toBe(2)
    expect(buildNotificationRows([header], { ...expanded }).length).toBe(2)
  })

  it("key 稳定唯一（list-item :key 契约）", () => {
    const rows = buildNotificationRows([header, plain], { [header.id]: true })
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })
})

describe("notificationStore（Pinia：已读推进 / 角标）", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    setActivePinia(createPinia())
    idbGetMock.mockReset()
    idbSetMock.mockReset()
    fetchInfiniteQueryMock.mockReset()
    idbSetMock.mockResolvedValue(undefined)
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it("notifyListLoaded(true)：写 notifications_last_read_time（可解析 ISO）+ 角标清零", async () => {
    const store = useNotificationStore()
    store.unreadCount = 3
    store.notifyListLoaded(true)
    await vi.waitFor(() => expect(idbSetMock).toHaveBeenCalledTimes(1))
    expect(idbSetMock).toHaveBeenCalledWith(NOTIFICATIONS_LAST_READ_KEY, expect.any(String))
    const written = idbSetMock.mock.calls[0]![1] as string
    expect(Number.isNaN(Date.parse(written))).toBe(false)
    expect(store.unreadCount).toBe(0)
  })

  it("notifyListLoaded(false)：失败不推进（零写盘，spec 边界 10 未读不丢）", () => {
    const store = useNotificationStore()
    store.unreadCount = 3
    store.notifyListLoaded(false)
    expect(idbSetMock).not.toHaveBeenCalled()
    expect(store.unreadCount).toBe(3)
  })

  it("已读键读取：缺失 → null（首次使用）；畸形 → warn + null（不静默）", async () => {
    idbGetMock.mockResolvedValueOnce(null)
    await expect(loadLastReadMs()).resolves.toBeNull()

    idbGetMock.mockResolvedValueOnce("garbage-timeout")
    await expect(loadLastReadMs()).resolves.toBeNull()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[notificationStore]"), "garbage-timeout")
  })

  it("refreshUnreadBadge：首屏 1 页 fetchInfiniteQuery + 本地已读时间戳推导计数", async () => {
    const fixture = loadFixture("notification-list.json")
    fetchInfiniteQueryMock.mockResolvedValue({ pages: [fixture] })
    // 已读时间戳 = fixture 首条与次条之间 → 未读 = 1（等值/更早不计）
    idbGetMock.mockResolvedValue(new Date("2026-09-06T03:42:48+09:00").toISOString())
    const store = useNotificationStore()
    await store.refreshUnreadBadge()
    expect(fetchInfiniteQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({ pages: 1 }),
    )
    expect(store.unreadCount).toBe(1)
  })

  it("refreshUnreadBadge 失败：warn 保留上次计数、零写盘（失败不影响页面）", async () => {
    fetchInfiniteQueryMock.mockRejectedValue({ type: "NETWORK", message: "网络不可用" })
    const store = useNotificationStore()
    store.unreadCount = 2
    await store.refreshUnreadBadge()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[notificationStore]"), expect.anything())
    expect(store.unreadCount).toBe(2)
    expect(idbSetMock).not.toHaveBeenCalled()
  })

  it("markNotificationsRead 写盘失败：warn 且不清角标（未读不丢）", async () => {
    idbSetMock.mockRejectedValue(new Error("disk full"))
    const store = useNotificationStore()
    store.unreadCount = 5
    store.notifyListLoaded(true)
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[notificationStore]"), expect.anything()))
    expect(store.unreadCount).toBe(5)
  })
})

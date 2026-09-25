// ─── api/notification 契约测试（ADR-0188 D2 / #728）───
// fixture = 2026-09-26 真实抓包脱敏样例（docs/specs/notification-center.md「fixture 脱敏规则」：
// 用户名→假名、id→假 id，保持类型/URL 形状/HTML 结构不变；is_read/view_more/枚举值原样保留）。
// 测试硬约束 #2（真实样例契约）：断言 fixture 结构逐字可被宽容类型解析 + 端点路径 +
// next_url / older_than 游标透传。mock 风格跟随 illust.test.ts（vi.hoisted + vi.mock("./client")）。
// IO 边界（测试硬约束 1）：成功与失败双路径都测。
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi, beforeEach } from "vitest"

const getMock = vi.hoisted(() => vi.fn())

vi.mock("./client", () => ({
  apiClient: { get: getMock, post: vi.fn() },
}))

import { loadNotifications, loadNotificationChildren } from "./notification"
import type { PixivNotificationListResponse } from "./types"

function loadFixture(name: string): PixivNotificationListResponse {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), "utf8"),
  ) as PixivNotificationListResponse
}

describe("契约 fixture（2026-09-26 真实抓包脱敏样例，结构逐字）", () => {
  it("notification-list.json：notifications envelope + content.text 含 <b> + view_more.title + pixiv://users target_url", () => {
    const fixture = loadFixture("notification-list.json")
    expect(Array.isArray(fixture.notifications)).toBe(true)
    expect(fixture.notifications.length).toBeGreaterThan(0)
    expect("next_url" in fixture).toBe(true)

    const first = fixture.notifications[0]!
    // schema 关键字段逐字（ADR-0188 背景节）
    expect(typeof first.id).toBe("number")
    expect(first.created_datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/)
    expect(typeof first.type).toBe("number")
    // content.text 含 <b> HTML（渲染必须经 notificationPlainText 剥离）
    expect(first.content?.text).toContain("<b>")
    expect(first.content?.left_icon === null || typeof first.content?.left_icon === "string").toBe(true)
    // 组头（view_more 非空）
    expect(first.view_more?.title).toBeTruthy()
    expect(typeof first.view_more?.unread_exists).toBe("boolean")
    // target_url 形如 pixiv://users/<num>
    expect(first.target_url).toMatch(/^pixiv:\/\/users\/\d+$/)
    expect(typeof first.is_read).toBe("boolean")
  })

  it("notification-viewmore.json：子条目 view_more 为 null + next_url 携带 older_than 游标", () => {
    const fixture = loadFixture("notification-viewmore.json")
    expect(fixture.notifications.length).toBeGreaterThan(0)
    // 子条目：view_more 恒 null（glossary「摊平子列表」）
    for (const child of fixture.notifications) {
      expect(child.view_more).toBeNull()
    }
    // older_than 游标形态（单页 30 条，透传翻页）
    expect(fixture.next_url).toContain("notification/view-more")
    expect(fixture.next_url).toContain("notification_id=")
    expect(fixture.next_url).toContain("older_than=")
  })
})

describe("api/notification loadNotifications（GET /v1/notification/list）", () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it("成功（首屏）：请求路径 /v1/notification/list，响应原样返回", async () => {
    const fixture = loadFixture("notification-list.json")
    getMock.mockResolvedValue(fixture)
    const result = await loadNotifications()
    expect(getMock).toHaveBeenCalledTimes(1)
    expect(getMock).toHaveBeenCalledWith("/v1/notification/list", undefined, undefined)
    expect(result).toEqual(fixture)
  })

  it("成功（翻页）：next_url 原样透传（含 query，client.rewriteUrl 负责剥域）", async () => {
    const page2 = loadFixture("notification-viewmore.json")
    getMock.mockResolvedValue(page2)
    await loadNotifications("https://app-api.pixiv.net/v1/notification/list?cursor=abc")
    expect(getMock).toHaveBeenCalledWith(
      "https://app-api.pixiv.net/v1/notification/list?cursor=abc",
      undefined,
      undefined,
    )
  })

  it("fixture 经宽容类型解析后关键字段可读（除 id/created_datetime 外全 optional 不破解析）", async () => {
    getMock.mockResolvedValue(loadFixture("notification-list.json"))
    const result = await loadNotifications()
    // 逐字消费面：text 剥离入口 / 组头判定 / 未读推导 / target 解析 的输入形状
    expect(result.notifications[0]!.content?.text).toContain("<b>")
    expect(result.notifications[0]!.view_more).not.toBeNull()
    expect(result.notifications.every((n) => typeof n.created_datetime === "string")).toBe(true)
  })

  it("失败路径：ApiError 上抛（client 归一，不静默吞错）", async () => {
    const apiError = { type: "SERVER", message: "服务器错误 (HTTP 500)" }
    getMock.mockRejectedValue(apiError)
    await expect(loadNotifications()).rejects.toEqual(apiError)
  })
})

describe("api/notification loadNotificationChildren（GET /v1/notification/view-more）", () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it("成功（首屏）：notification_id 字符串化进参数", async () => {
    const fixture = loadFixture("notification-viewmore.json")
    getMock.mockResolvedValue(fixture)
    const result = await loadNotificationChildren(100000000)
    expect(getMock).toHaveBeenCalledWith(
      "/v1/notification/view-more",
      { notification_id: "100000000" },
      undefined,
    )
    expect(result).toEqual(fixture)
  })

  it("翻页：older_than 游标经 next_url 原样透传（fixture 真实游标）", async () => {
    const fixture = loadFixture("notification-viewmore.json")
    getMock.mockResolvedValue(fixture)
    await loadNotificationChildren(100000000, fixture.next_url!)
    expect(getMock).toHaveBeenCalledWith(fixture.next_url, undefined, undefined)
  })

  it("失败路径：ApiError 上抛", async () => {
    const apiError = { type: "UNAUTHORIZED", message: "登录已过期 (HTTP 401)" }
    getMock.mockRejectedValue(apiError)
    await expect(loadNotificationChildren(1)).rejects.toEqual(apiError)
  })
})

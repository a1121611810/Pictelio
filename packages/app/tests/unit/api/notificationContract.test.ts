/**
 * 通知 API 契约测试（测试硬约束 #2：mock 必须来自真实数据源）。
 *
 * fixture = 2026-09-26 真实抓包脱敏样本（/v1/notification/list + /v1/notification/view-more，
 * 脱敏规则见 docs/specs/notification-center.md Further Notes：用户名→假名、≥6 位数字 id→假 id，
 * 保持类型/URL 形状/HTML 结构不变；is_read/view_more/枚举值原样保留）。
 *
 * 断言锚点（oracle = ADR-0188 背景节抓包 schema）：
 * - 端点路径逐字：/v1/notification/list 与 /v1/notification/view-more
 * - envelope 逐字：notifications / next_url 键存在；条目关键字段类型与形态
 *   （content.text 含 <b>、view_more.title 非空、target_url 形如 pixiv://<segment>/<num>）
 * - 宽容解析：fixture 可作为 PixivNotificationListResponse 直接消费（ts强制由 tsc 保证，
 *   本文件做运行时结构断言防 fixture 漂移）
 * - view-more 的 older_than 游标经 loadNotificationChildren(nextUrl) 原样透传
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const mockGet = vi.fn();

vi.mock("@/api/client", () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: vi.fn(),
  },
}));

import type { PixivNotificationListResponse } from "@/api/types";

/** fixture 目录（相对本文件：tests/unit/api/fixtures/，路径解析形态对齐 backupRulesConsistency.test） */
const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): PixivNotificationListResponse {
  const raw = readFileSync(path.join(fixtureDir, name), "utf8");
  return JSON.parse(raw) as PixivNotificationListResponse;
}

/** target_url 形如 pixiv://<segment>/<纯数字 id>（抓包实证 scheme 形态） */
const PIXIV_TARGET_RE = /^pixiv:\/\/[a-z]+\/\d+$/;

describe("通知契约 fixture（真实抓包脱敏样例，ADR-0188 D2）", () => {
  it("list fixture：envelope 键逐字（notifications/next_url）+ 条目关键字段结构", () => {
    const fixture = loadFixture("notification-list.json");
    expect(Object.keys(fixture).toSorted()).toEqual(["next_url", "notifications"]);
    expect(Array.isArray(fixture.notifications)).toBe(true);
    expect(fixture.notifications.length).toBeGreaterThan(0);

    for (const item of fixture.notifications) {
      // 必有字段（schema 钉死）
      expect(typeof item.id).toBe("number");
      expect(typeof item.created_datetime).toBe("string");
      // +09:00 ISO 时间串（Date.parse 可解析）
      expect(Number.isNaN(Date.parse(item.created_datetime))).toBe(false);
      // 宽容字段：抓包样本内均为对象/null 形态
      expect(item.content === null || typeof item.content === "object").toBe(true);
      expect(item.view_more === null || typeof item.view_more === "object").toBe(true);
      expect(typeof item.target_url).toBe("string");
      expect(PIXIV_TARGET_RE.test(item.target_url ?? "")).toBe(true);
      expect(typeof item.is_read).toBe("boolean");
    }

    // content.text 逐字锚点：含 <b> HTML 片段（ADR-0188 背景节「text 含 <b> HTML」）
    const withText = fixture.notifications.find((n) => n.content?.text);
    expect(withText).toBeDefined();
    expect(withText!.content!.text).toContain("<b>");
    expect(withText!.content!.text).toContain("</b>");

    // 组头锚点：view_more.title 非空 + unread_exists 布尔（组头判定 = view_more 非空）
    const header = fixture.notifications.find((n) => n.view_more != null);
    expect(header).toBeDefined();
    expect(typeof header!.view_more!.title).toBe("string");
    expect((header!.view_more!.title ?? "").length).toBeGreaterThan(0);
    expect(typeof header!.view_more!.unread_exists).toBe("boolean");

    // 普通条目锚点：子条目/单条 view_more 为 null（view-more 响应内同构实证）
    expect(fixture.notifications.some((n) => n.view_more === null)).toBe(true);

    // 图片字段锚点：s.pximg.net 公共图标与 i.pximg.net 内容缩略图并存
    // （i.pximg 走 /pixiv-img/ 代理；s.pximg v1 直通——spec 边界 5 订正 + 挂账 #734）
    expect(
      fixture.notifications.some((n) => n.content?.left_icon?.startsWith("https://s.pximg.net/")),
    ).toBe(true);
    expect(
      fixture.notifications.some((n) => n.content?.left_image?.startsWith("https://i.pximg.net/")),
    ).toBe(true);

    // 末页锚点：抓包样本 next_url = null
    expect(fixture.next_url).toBeNull();
  });

  it("view-more fixture：同构 envelope + next_url 携带 older_than 游标", () => {
    const fixture = loadFixture("notification-viewmore.json");
    expect(Object.keys(fixture).toSorted()).toEqual(["next_url", "notifications"]);

    // 子条目 view_more 全为 null（摊平语义）且 is_read 全为 true（展开后服务端翻转）
    for (const item of fixture.notifications) {
      expect(item.view_more).toBeNull();
      expect(item.is_read).toBe(true);
    }

    // older_than 游标锚点（ADR-0188 背景节：?notification_id=…&limit=30&older_than=…）
    expect(fixture.next_url).toContain("/v1/notification/view-more?");
    expect(fixture.next_url).toContain("notification_id=");
    expect(fixture.next_url).toContain("limit=30");
    expect(fixture.next_url).toContain("older_than=");
  });

  it("契约端点路径：loadNotifications 走 /v1/notification/list（用 fixture 作返回值）", async () => {
    vi.resetModules();
    mockGet.mockResolvedValue(loadFixture("notification-list.json"));
    const { loadNotifications } = await import("@/api/notification");

    const result = await loadNotifications();
    expect(mockGet).toHaveBeenCalledWith("/v1/notification/list", undefined, undefined);
    // fixture 可被类型宽容解析（返回结构直接可消费）
    expect(result.notifications.length).toBe(11);
  });

  it("older_than 游标透传：loadNotificationChildren 对 view-more next_url 原样 GET", async () => {
    vi.resetModules();
    mockGet.mockResolvedValue(loadFixture("notification-viewmore.json"));
    const { loadNotificationChildren } = await import("@/api/notification");

    const nextUrl = loadFixture("notification-viewmore.json").next_url!;
    const result = await loadNotificationChildren(100000000, nextUrl);

    // 游标逐字透传（含 older_than），不重拼不剥参
    expect(mockGet).toHaveBeenCalledWith(nextUrl, undefined, undefined);
    expect(result.notifications.length).toBe(5);
  });
});

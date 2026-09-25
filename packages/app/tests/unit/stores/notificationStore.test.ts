/**
 * notificationStore 单测（ADR-0188 D3/D5 / spec 测试决策；#733）。
 *
 * 覆盖矩阵（ticket 验收）：
 *   - 未读推导真值表：新 / 旧 / 等值 / 解析失败 warn（+ 首次使用无键全计）
 *   - 已读推进条件：成功才推进（notifyListLoaded(false) 零写）；写入值为可解析 ISO
 *   - 分页 accumulate：flattenNotifications / useInfiniteQuery 多页保序（fixture 真实样例）
 *   - 组头插入：buildNotificationRows 就地插入 + 展开单向 + key 稳定唯一
 *   - 角标：refreshUnreadBadge 首屏 1 页 + 本地已读推导；失败 warn 保留计数
 *
 * mock 模式对齐 rankingStore.test（vi.mock queryClient getter + 真 QueryClient retry:false
 * + createRoot 包 store 构造）与 lynx 侧 notificationStore.test 语义（未读真值表逐字同构）。
 * settings 以内存 Map 打桩（define 零 IO，写门槛在真实 registry 由 hydrateAll 保证——
 * 通知页/入口动作均发生在 __root hydrated 之后，冷态丢弃路径不属本 store 契约）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { QueryClient } from "@tanstack/solid-query";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ── hoisted mock 状态 ──

const qc = vi.hoisted(() => ({ client: undefined as QueryClient | undefined }));
const settingsValues = vi.hoisted(() => new Map<string, string>());

vi.mock("@/api/queryClient", () => ({
  get queryClient() {
    return qc.client!;
  },
}));

vi.mock("@/settings", () => ({
  settings: {
    define: (def: { key: string; default: string }) => {
      if (!settingsValues.has(def.key)) settingsValues.set(def.key, def.default);
      return {
        key: def.key,
        value: () => settingsValues.get(def.key) ?? def.default,
        set: (v: string) => {
          settingsValues.set(def.key, v);
        },
        hydrate: async () => {},
      };
    },
  },
}));

const loadNotificationsMock = vi.fn();
const loadNotificationChildrenMock = vi.fn();
vi.mock("@/api/notification", () => ({
  loadNotifications: (...a: unknown[]) => loadNotificationsMock(...a),
  loadNotificationChildren: (...a: unknown[]) => loadNotificationChildrenMock(...a),
}));

const isNativeMock = vi.fn(() => false);
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => isNativeMock() },
}));
const addListenerMock = vi.fn();
vi.mock("@capacitor/app", () => ({
  App: { addListener: (...a: unknown[]) => addListenerMock(...a) },
}));

import {
  NOTIFICATIONS_LAST_READ_KEY,
  RESUME_REFRESH_MIN_INTERVAL_MS,
  buildNotificationRows,
  countUnreadNotifications,
  createNotificationChildrenStore,
  createNotificationsListStore,
  flattenNotifications,
  isGroupHeader,
  loadLastReadMs,
  markNotificationsRead,
  notifyListLoaded,
  parseCreatedTimeMs,
  refreshUnreadBadge,
  registerNotificationResumeListener,
  unreadCount,
} from "@/stores/notificationStore";
import type { PixivNotificationItem, PixivNotificationListResponse } from "@/api/types";

// ── fixture / 工具 ──

/** fixture 目录（tests/unit/api/fixtures/，路径解析形态对齐 backupRulesConsistency.test） */
const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../api/fixtures");

function loadFixture(name: string): PixivNotificationListResponse {
  return JSON.parse(
    readFileSync(path.join(fixtureDir, name), "utf8"),
  ) as PixivNotificationListResponse;
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
  };
}

function setup() {
  let dispose!: () => void;
  let store!: ReturnType<typeof createNotificationsListStore>;
  createRoot((d) => {
    dispose = d;
    store = createNotificationsListStore();
  });
  return { store, dispose };
}

beforeEach(() => {
  qc.client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  settingsValues.clear();
  loadNotificationsMock.mockReset();
  loadNotificationChildrenMock.mockReset();
  addListenerMock.mockReset();
  isNativeMock.mockReturnValue(false);
});

describe("parseCreatedTimeMs / countUnreadNotifications 未读真值表（spec 边界 6）", () => {
  const LAST_READ = parseCreatedTimeMs("2026-09-25T00:00:00+09:00")!;

  it("parseCreatedTimeMs：合法 ISO → 毫秒；畸形串 → null", () => {
    expect(parseCreatedTimeMs("2026-09-26T03:38:49+09:00")).toBe(
      Date.parse("2026-09-26T03:38:49+09:00"),
    );
    expect(parseCreatedTimeMs("not-a-date")).toBeNull();
  });

  it("新通知（晚于已读时间戳）→ 计入", () => {
    expect(countUnreadNotifications([notif("2026-09-26T03:38:49+09:00")], LAST_READ)).toBe(1);
  });

  it("旧通知（早于已读时间戳）→ 不计", () => {
    expect(countUnreadNotifications([notif("2026-09-01T00:00:00+09:00")], LAST_READ)).toBe(0);
  });

  it("等值（等于已读时间戳）→ 不计（严格晚于才计，ADR-0188 D5「晚于该键」）", () => {
    expect(countUnreadNotifications([notif("2026-09-25T00:00:00+09:00")], LAST_READ)).toBe(0);
  });

  it("混合集合分别计数", () => {
    const items = [
      notif("2026-09-26T03:38:49+09:00"),
      notif("2026-09-01T00:00:00+09:00"),
      notif("2026-09-26T10:00:00+09:00"),
    ];
    expect(countUnreadNotifications(items, LAST_READ)).toBe(2);
  });

  it("解析失败该条不计 + console.warn（禁静默降级）", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const items = [notif("not-a-date"), notif("2026-09-26T03:38:49+09:00")];
    expect(countUnreadNotifications(items, LAST_READ)).toBe(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("[notificationStore] 通知时间解析失败");
    warnSpy.mockRestore();
  });

  it("首次使用（已读键缺失 null）→ 全部可解析条目计未读", () => {
    expect(
      countUnreadNotifications(
        [notif("2020-01-01T00:00:00+09:00"), notif("2026-09-26T00:00:00+09:00")],
        null,
      ),
    ).toBe(2);
  });
});

describe("flattenNotifications 分页 accumulate（fixture 真实样例）", () => {
  it("多页顺序拼接（页序 × 页内序，不重排）", () => {
    const page1 = loadFixture("notification-list.json");
    const page2 = loadFixture("notification-viewmore.json");
    const flat = flattenNotifications([page1, page2]);
    expect(flat.length).toBe(page1.notifications.length + page2.notifications.length);
    expect(flat[0]).toEqual(page1.notifications[0]);
    expect(flat[page1.notifications.length]).toEqual(page2.notifications[0]);
  });

  it("isGroupHeader：view_more 非空 = 组头；null/undefined = 普通条目", () => {
    const list = loadFixture("notification-list.json").notifications;
    expect(isGroupHeader(list[0]!)).toBe(true); // fixture[0] 为组头
    expect(isGroupHeader(list[2]!)).toBe(false); // fixture[2] view_more 为 null
    expect(isGroupHeader({ id: 1, created_datetime: "2026-01-01T00:00:00+09:00" })).toBe(false);
  });
});

describe("buildNotificationRows 组头插入（spec §US2 / 边界 9）", () => {
  const list = loadFixture("notification-list.json").notifications;
  const header = list[0]!; // 组头（view_more 非空）
  const plain = list[2]!; // 普通条目（view_more null）

  it("未展开组头：无子区行，顺序不变", () => {
    const rows = buildNotificationRows([header, plain], {});
    expect(rows.map((r) => r.kind)).toEqual(["header", "item"]);
    expect(rows[0]!.key).toBe(`h-${header.id}`);
    expect(rows[1]!.key).toBe(`n-${plain.id}`);
  });

  it("展开组头：children 行就地插入组头之后、后续条目之前", () => {
    const rows = buildNotificationRows([plain, header, plain], { [header.id]: true });
    expect(rows.map((r) => r.kind)).toEqual(["item", "header", "children", "item"]);
    expect(rows[2]!.headerId).toBe(header.id);
    expect(rows[2]!.key).toBe(`c-${header.id}`);
  });

  it("展开单向不收起：expanded 只增不减（重复构建保持子区）", () => {
    const expanded = { [header.id]: true };
    expect(buildNotificationRows([header], expanded).length).toBe(2);
    expect(buildNotificationRows([header], { ...expanded }).length).toBe(2);
  });

  it("key 稳定唯一（Solid For keyed 契约）", () => {
    const rows = buildNotificationRows([header, plain], { [header.id]: true });
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });
});

describe("本地已读记忆（设备级键 notifications_last_read_time，双端逐字同键）", () => {
  it("键名与 lynx 侧逐字一致（ADR-0188 D5 / ADR-0103 跨端契约）", () => {
    expect(NOTIFICATIONS_LAST_READ_KEY).toBe("notifications_last_read_time");
  });

  it("loadLastReadMs：键缺失 → null（首次使用）；合法 ISO → 毫秒；畸形 → warn + null", async () => {
    expect(loadLastReadMs()).toBeNull(); // 未写入过

    settingsValues.set(NOTIFICATIONS_LAST_READ_KEY, "2026-09-25T00:00:00+09:00");
    expect(loadLastReadMs()).toBe(Date.parse("2026-09-25T00:00:00+09:00"));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    settingsValues.set(NOTIFICATIONS_LAST_READ_KEY, "garbage");
    expect(loadLastReadMs()).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[notificationStore] 已读时间戳值畸形"),
      "garbage",
    );
    warnSpy.mockRestore();
  });

  it("notifyListLoaded(true)：写 notifications_last_read_time（可解析 ISO）+ 角标清零", () => {
    settingsValues.clear();
    // 直接驱动接线函数：成功 → 推进
    notifyListLoaded(true);
    const written = settingsValues.get(NOTIFICATIONS_LAST_READ_KEY);
    expect(written).toBeDefined();
    expect(Number.isNaN(Date.parse(written!))).toBe(false);
    expect(unreadCount()).toBe(0);
  });

  it("notifyListLoaded(false)：失败不推进（零写盘，spec 边界 10 未读不丢）", () => {
    settingsValues.clear();
    notifyListLoaded(false);
    expect(settingsValues.has(NOTIFICATIONS_LAST_READ_KEY)).toBe(false);
  });

  it("markNotificationsRead：写入当前时刻并清零角标", async () => {
    const before = Date.now();
    markNotificationsRead();
    const written = settingsValues.get(NOTIFICATIONS_LAST_READ_KEY)!;
    expect(Date.parse(written)).toBeGreaterThanOrEqual(before);
  });
});

describe("refreshUnreadBadge（首屏 1 页静默拉取，ADR-0188 D7）", () => {
  it("fetchInfiniteQuery pages:1 + 本地已读时间戳推导计数", async () => {
    const fixture = loadFixture("notification-list.json");
    loadNotificationsMock.mockResolvedValue(fixture);
    // 已读时间戳 = fixture 首条（09-26 03:38:49）与次条（09-06 03:42:48）之间 → 未读 = 1
    settingsValues.set(NOTIFICATIONS_LAST_READ_KEY, "2026-09-20T00:00:00+09:00");

    await refreshUnreadBadge();
    expect(loadNotificationsMock).toHaveBeenCalledTimes(1);
    expect(loadNotificationsMock.mock.calls[0]?.[0]).toBeUndefined();
    expect(unreadCount()).toBe(1);
  });

  it("首次使用（无已读键）→ 首页全量计未读", async () => {
    loadNotificationsMock.mockResolvedValue(loadFixture("notification-list.json"));
    await refreshUnreadBadge();
    expect(unreadCount()).toBe(loadFixture("notification-list.json").notifications.length);
  });

  it("失败：warn 保留上次计数、不写已读键（失败不影响入口展示）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 先建立一次成功计数作为「上次计数」基准
    loadNotificationsMock.mockResolvedValue(loadFixture("notification-list.json"));
    await refreshUnreadBadge();
    const baseline = unreadCount();
    expect(baseline).toBeGreaterThan(0);

    loadNotificationsMock.mockRejectedValue({ type: "NETWORK", message: "网络不可用" });
    await refreshUnreadBadge();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[notificationStore] 未读角标静默刷新失败"),
      expect.anything(),
    );
    expect(unreadCount()).toBe(baseline);
    warnSpy.mockRestore();
  });
});

describe("registerNotificationResumeListener（appStateChange 节流先例，otaService 形态）", () => {
  it("非原生环境（web/dev）显式跳过：addListener 不调用（console.info 可见）", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    registerNotificationResumeListener();
    expect(addListenerMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining("[notificationStore] 非原生环境跳过前台恢复监听"),
    );
    infoSpy.mockRestore();
  });

  it("节流阈值为 ≥5 分钟（ADR-0188 D7）", () => {
    expect(RESUME_REFRESH_MIN_INTERVAL_MS).toBe(5 * 60 * 1000);
  });
});

describe("createNotificationsListStore（useInfiniteQuery：分页 / 错误 / next_url）", () => {
  it("首屏 + fetchMore：多页 accumulate 保序；next_url 尽头收敛 null", async () => {
    const page1 = loadFixture("notification-list.json");
    const page2 = loadFixture("notification-viewmore.json");
    loadNotificationsMock.mockImplementation((nextUrl?: string) =>
      nextUrl ? Promise.resolve(page2) : Promise.resolve(page1),
    );
    const { store, dispose } = setup();
    await store.refresh();
    await Promise.resolve();
    expect(store.items().length).toBe(page1.notifications.length);
    expect(store.nextUrl()).toBeNull(); // fixture list 为末页

    // 人为给 page1 一个 next_url 再验证 accumulate（store 不感知 fixture 差异）
    loadNotificationsMock.mockImplementation((nextUrl?: string) =>
      nextUrl ? Promise.resolve(page2) : Promise.resolve({ ...page1, next_url: page2.next_url }),
    );
    await store.refresh();
    await Promise.resolve();
    await store.fetchMore();
    await Promise.resolve();
    expect(store.items().length).toBe(page1.notifications.length + page2.notifications.length);
    expect(store.items()[0]).toEqual(page1.notifications[0]);
    expect(store.items()[page1.notifications.length]).toEqual(page2.notifications[0]);
    dispose();
  });

  it("首载失败：error 非空、loading 落回 false；refresh 成功后 error 清空", async () => {
    loadNotificationsMock.mockRejectedValue(new Error("boom"));
    const { store, dispose } = setup();
    // enabled:true 挂载自动首取 → 失败落错误态
    await vi.waitFor(() => expect(store.error()).not.toBeNull());
    expect(store.loading()).toBe(false);

    loadNotificationsMock.mockResolvedValue(loadFixture("notification-list.json"));
    await store.refresh();
    await Promise.resolve();
    expect(store.error()).toBeNull();
    expect(store.items().length).toBeGreaterThan(0);
    dispose();
  });

  it("空列表：items 空 + loading false（空态而非永久加载中，spec 边界 1）", async () => {
    loadNotificationsMock.mockResolvedValue({ notifications: [], next_url: null });
    const { store, dispose } = setup();
    await store.refresh();
    await Promise.resolve();
    expect(store.items()).toEqual([]);
    expect(store.loading()).toBe(false);
    expect(store.nextUrl()).toBeNull();
    dispose();
  });
});

describe("createNotificationChildrenStore（组头摊平子列表，older_than 游标分页）", () => {
  it("首屏走 view-more；fetchMore 透传 next_url（older_than 游标）", async () => {
    const page2 = loadFixture("notification-viewmore.json");
    loadNotificationChildrenMock.mockResolvedValue(page2);
    let dispose!: () => void;
    let store!: ReturnType<typeof createNotificationChildrenStore>;
    createRoot((d) => {
      dispose = d;
      store = createNotificationChildrenStore(100000000);
    });
    // enabled:true 挂载自动首取
    await vi.waitFor(() => expect(store.items().length).toBe(page2.notifications.length));
    // 首屏参数：notification_id 必传、pageParam 未定义（signal 由 TanStack 注入，不锚定）
    expect(loadNotificationChildrenMock.mock.calls[0]?.[0]).toBe(100000000);
    expect(loadNotificationChildrenMock.mock.calls[0]?.[1]).toBeUndefined();
    expect(store.nextUrl()).toContain("older_than=");

    await store.fetchMore();
    await vi.waitFor(() => expect(loadNotificationChildrenMock.mock.calls.length).toBe(2));
    // 游标页：next_url（older_than）逐字透传
    expect(loadNotificationChildrenMock.mock.calls[1]?.[0]).toBe(100000000);
    expect(loadNotificationChildrenMock.mock.calls[1]?.[1]).toBe(page2.next_url);
    dispose();
  });
});

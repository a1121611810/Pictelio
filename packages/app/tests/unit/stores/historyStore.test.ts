// @vitest-environment happy-dom
/**
 * historyStore 本地集合测试（ADR-0144 D2：@tanstack/solid-db → 本地实现）。
 *
 * Oracle 溯源：
 * - 磁盘格式样例取自 @tanstack/db@0.6.17 dist/esm/local-storage.js 源码常量：
 *   localStorage[key] = { "s:<key>": { versionKey, data } }（字符串 key 恒 `s:` 前缀，
 *   数字 key 恒 `n:` 前缀——本集合 key 恒为字符串）。
 * - 30 天过期窗口 / 用户隔离复合 key：沿用原 historyStore 模块规格（THIRTY_DAYS 常量）。
 * - 静默降级零容忍：解析/读写失败必须 console.warn（模块前缀）。
 *
 * historyStore 是模块级单例（启动时读一次 localStorage），因此每个用例
 * vi.resetModules() 后动态 import，保证集合状态互不污染。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authUser = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/stores/authStore", () => ({
  get user() {
    return () => authUser.current;
  },
}));

import type { HistoryEntry } from "@/stores/historyStore";

const USER_ID = "42";

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    key: `${USER_ID}_illust_1`,
    userId: USER_ID,
    authorId: 100,
    type: "illust",
    id: 1,
    title: "タイトル",
    userName: "author",
    thumbnailUrl: "https://example.com/t.jpg",
    xRestrict: 0,
    visitedAt: Date.now(),
    visitCount: 1,
    ...overrides,
  };
}

/** 按磁盘契约写入 localStorage（真实样例格式，非手写自洽字段）。 */
function seedStorage(entries: HistoryEntry[]): void {
  const objectData: Record<string, { versionKey: string; data: HistoryEntry }> = {};
  for (const entry of entries) {
    objectData[`s:${entry.key}`] = { versionKey: "0f4dbba7-8e0a-4e5f-9ef3-5f8a6f9f1c00", data: entry };
  }
  window.localStorage.setItem("pictelio-browsing-history", JSON.stringify(objectData));
}

async function loadStore() {
  vi.resetModules();
  return import("@/stores/historyStore");
}

describe("historyStore 本地集合", () => {
  beforeEach(() => {
    window.localStorage.clear();
    authUser.current = { id: USER_ID };
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("加载：读取磁盘契约样例（s: 前缀 + versionKey/data 包装）并还原条目", async () => {
    const entry = makeEntry();
    seedStorage([entry]);
    const mod = await loadStore();
    expect(mod.historyCollection.toArray).toHaveLength(1);
    expect(mod.historyCollection.get(entry.key)).toEqual(entry);
  });

  it("recordVisit 新增：写入磁盘契约格式（s: 前缀 + versionKey/data 包装）", async () => {
    const mod = await loadStore();
    mod.recordVisit(
      {
        id: 7,
        title: "t",
        user: { id: 100, name: "a" },
        image_urls: { square_medium: "u.jpg" },
        x_restrict: 0,
      } as never,
      "illust",
    );
    const raw = window.localStorage.getItem("pictelio-browsing-history");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as Record<string, { versionKey: string; data: HistoryEntry }>;
    const wrapped = parsed[`s:${USER_ID}_illust_7`];
    expect(wrapped).toBeDefined();
    expect(typeof wrapped.versionKey).toBe("string");
    expect(wrapped.data.key).toBe(`${USER_ID}_illust_7`);
    expect(wrapped.data.visitCount).toBe(1);
  });

  it("recordVisit 去重更新：visitCount+1 且不新增条目", async () => {
    const mod = await loadStore();
    const item = {
      id: 1,
      title: "t",
      user: { id: 100, name: "a" },
      image_urls: { square_medium: "u.jpg" },
      x_restrict: 0,
    } as never;
    mod.recordVisit(item, "illust");
    mod.recordVisit(item, "illust");
    const all = mod.historyCollection.toArray;
    expect(all).toHaveLength(1);
    expect(all[0].visitCount).toBe(2);
  });

  it("未登录时 recordVisit 不写入", async () => {
    authUser.current = null;
    const mod = await loadStore();
    mod.recordVisit(
      {
        id: 1,
        title: "t",
        user: { id: 100, name: "a" },
        image_urls: { square_medium: "u.jpg" },
        x_restrict: 0,
      } as never,
      "illust",
    );
    expect(mod.historyCollection.toArray).toHaveLength(0);
    expect(window.localStorage.getItem("pictelio-browsing-history")).toBeNull();
  });

  it("removeHistoryEntry 删除单条并持久化", async () => {
    seedStorage([makeEntry(), makeEntry({ key: `${USER_ID}_illust_2`, id: 2 })]);
    const mod = await loadStore();
    mod.removeHistoryEntry(`${USER_ID}_illust_1`);
    const keys = mod.historyCollection.toArray.map((e) => e.key);
    expect(keys).toEqual([`${USER_ID}_illust_2`]);
  });

  it("clearAllHistory 只清当前用户，保留其他用户条目", async () => {
    seedStorage([makeEntry(), makeEntry({ key: "99_illust_1", userId: "99", id: 1 })]);
    const mod = await loadStore();
    mod.clearAllHistory();
    const remaining = mod.historyCollection.toArray;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userId).toBe("99");
  });

  it("过期清除：visitedAt 超 30 天的条目在写入时被懒清除", async () => {
    const expired = makeEntry({
      key: `${USER_ID}_illust_old`,
      id: 999,
      visitedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
    });
    seedStorage([expired]);
    const mod = await loadStore();
    mod.recordVisit(
      {
        id: 1,
        title: "t",
        user: { id: 100, name: "a" },
        image_urls: { square_medium: "u.jpg" },
        x_restrict: 0,
      } as never,
      "illust",
    );
    expect(mod.historyCollection.get(expired.key)).toBeUndefined();
  });

  it("失败路径：磁盘数据损坏 → warn + 空集合，不崩溃", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.localStorage.setItem("pictelio-browsing-history", "{not-json");
    const mod = await loadStore();
    expect(mod.historyCollection.toArray).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[historyStore]"), expect.anything());
  });

  it("失败路径：localStorage.setItem 抛异常 → warn 不崩溃，内存态仍生效", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwingStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    vi.stubGlobal("localStorage", throwingStorage);
    const mod = await loadStore();
    expect(() =>
      mod.recordVisit(
        {
          id: 1,
          title: "t",
          user: { id: 100, name: "a" },
          image_urls: { square_medium: "u.jpg" },
          x_restrict: 0,
        } as never,
        "illust",
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[historyStore]"), expect.anything());
    // 内存态仍可读（本次会话内浏览历史不丢）
    expect(mod.historyCollection.toArray).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("失败路径：条目包装缺 data 字段（契约破坏）→ warn 并跳过该条目不崩溃", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    window.localStorage.setItem(
      "pictelio-browsing-history",
      JSON.stringify({ [`s:${USER_ID}_illust_1`]: { versionKey: "x" } }),
    );
    const mod = await loadStore();
    expect(mod.historyCollection.toArray).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("损坏条目"));
  });
});

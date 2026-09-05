import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { QueryClient, dehydrate } from "@tanstack/solid-query";
import {
  persistQueryClientRestore,
  persistQueryClientSave,
  type Persister,
} from "@tanstack/query-persist-client-core";
import {
  FEED_PERSIST_BUSTER,
  FEED_PERSIST_MAX_AGE,
  createFeedQueryPersister,
  persistableFeedQuery,
} from "@/api/feedQueryPersist";

/**
 * 期望值出处（oracle）：
 * - 全部参数（buster="tq-feed-v1"、maxAge=7 天、debounce=5000ms、配额 4.5MB、截断梯子 全量→3页→1页）
 *   字面来自 docs/specs/webview-perf-round2.md §1（T4），本文件不做设计决策。
 * - 真实契约：clientState 一律由 new QueryClient() + setQueryData / fetchQuery 构造后经
 *   query-core `dehydrate`（经 persistQueryClientSave 真实保存路径）产出，禁止手写字段
 *   （测试硬约束 2：契约 mock 必须来自真实数据源）。唯二手工字段是 PersistedClient 信封上的
 *   标量 timestamp / buster 与失败注入（queries:[null]、损坏 JSON 串），用于构造故障态。
 * - 排除项 key 形状来自真实源码：queryKeys.userIllusts → ["illust","userWorks",userId,type]、
 *   queryKeys.userNovels → ["novel","userWorks",userId]、queryKeys.followList →
 *   ["user","followList",mode,userId]、userIllustsStore 的 ["__disabled__","illust","userWorks",0]。
 * - 核心语义（query-persist-client-core@5.101.4 persist.ts）：超 maxAge / buster 不匹配 →
 *   removeClient 且不 warn；restore 抛错 → re-throw（生产静默，必须由 restoreFeedCache 补 catch+warn）。
 */

/** spec 定死的写回节流窗口（实现内部常量，测试以字面量对齐 oracle） */
const DEBOUNCE_MS = 5000;

/** 范围内的 key 单一来源（测试内部），与 store 真实 queryKey 一致 */
const K_FEED = ["feed", "recommended_illust"] as const;

/** 内存 Storage（node 环境无 localStorage）：Map 语义与 DOM Storage 一致 */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

/** setItem 超过 fakeQuotaLength 即抛 QuotaExceededError（模拟真实 localStorage 配额） */
class QuotaLimitedStorage extends MemoryStorage {
  constructor(private fakeQuotaLength: number) {
    super();
  }
  override setItem(key: string, value: string): void {
    if (value.length > this.fakeQuotaLength) {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    }
    super.setItem(key, value);
  }
}

/** setItem 直接抛 SecurityError（模拟隐私模式，探测必须失败） */
class BrokenWriteStorage extends MemoryStorage {
  override setItem(): void {
    throw new DOMException("access denied", "SecurityError");
  }
}

/**
 * 构造真实 InfiniteData 形状（pages / pageParams 对齐，next_url 语义同 Pixiv 分页）。
 * pagePad 用于把 page 内容撑到指定大小（测配额梯子）；pageParams 保持短串，保证对齐断言可读。
 */
function makeInfiniteData(pageCount: number, tag: string, pagePad = 0) {
  return {
    pages: Array.from({ length: pageCount }, (_, i) => {
      const item = `${tag}:p${i}`;
      return {
        items: [pagePad > 0 ? item.padEnd(pagePad, "x") : item],
        next_url: i < pageCount - 1 ? `https://example.test/next/${tag}/${i}` : null,
      };
    }),
    pageParams: Array.from({ length: pageCount }, (_, i) =>
      i === 0 ? null : `cursor:${tag}:${i}`,
    ),
  };
}

/** 经核心真实保存路径写入（dehydrate 走 persistableFeedQuery 谓词，与生产同路径） */
async function saveViaCore(
  source: QueryClient,
  persister: Persister,
  buster: string = FEED_PERSIST_BUSTER,
): Promise<void> {
  await persistQueryClientSave({
    queryClient: source,
    persister,
    buster,
    dehydrateOptions: { shouldDehydrateQuery: persistableFeedQuery },
  });
}

/** 经核心真实恢复路径读出 */
function restoreViaCore(target: QueryClient, persister: Persister): Promise<void> {
  return persistQueryClientRestore({
    queryClient: target,
    persister,
    maxAge: FEED_PERSIST_MAX_AGE,
    buster: FEED_PERSIST_BUSTER,
    dehydrateOptions: { shouldDehydrateQuery: persistableFeedQuery },
  });
}

/** 预置一份真实缓存并返回落盘 key（key 从真实行为中发现，不在测试里硬编码内部常量） */
async function seedAndGetKey(mem: MemoryStorage): Promise<string> {
  const source = new QueryClient();
  source.setQueryData([...K_FEED], makeInfiniteData(1, "probe"));
  await saveViaCore(source, createFeedQueryPersister(mem));
  vi.advanceTimersByTime(DEBOUNCE_MS);
  const key = mem.key(0);
  if (!key) throw new Error("seed failed: nothing persisted");
  return key;
}

let warnSpy: MockInstance;
let errorSpy: MockInstance;

beforeEach(() => {
  vi.useFakeTimers();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

function warnTexts(): string[] {
  return warnSpy.mock.calls.map((c) => c.map(String).join(" "));
}

describe("persistableFeedQuery", () => {
  it("谓词：9 个 feed key 命中，页面独有 key 排除", () => {
    const hitKeys: readonly unknown[][] = [
      ["feed", "recommended_illust"],
      ["feed", "recommended_manga"],
      ["feed", "follow_public"],
      ["feed", "follow_private"],
      ["bookmarks", 123, "public"],
      ["novel", "recommended"],
      ["novel", "follow_public"],
      ["novel", "follow_private"],
      ["novel", "bookmarks", 123, "public"],
    ];
    const excludeKeys: readonly unknown[][] = [
      ["illust", "userWorks", 123, "illust"], // userIllustsStore
      ["novel", "userWorks", 123], // userNovels：novel 头但第二段不在集合内
      ["user", "followList", "following", 123], // followListStore
      ["__disabled__", "illust", "userWorks", 0], // userIllustsStore 停用态
    ];

    const qc = new QueryClient();
    for (const key of hitKeys) qc.setQueryData([...key], makeInfiniteData(1, "hit"));
    for (const key of excludeKeys) qc.setQueryData([...key], makeInfiniteData(1, "ex"));

    const included = dehydrate(qc, { shouldDehydrateQuery: persistableFeedQuery }).queries;
    expect(included.map((q) => q.queryKey)).toEqual(expect.arrayContaining([...hitKeys]));
    expect(included).toHaveLength(9);

    const cacheQueries = qc.getQueryCache().getAll();
    for (const key of excludeKeys) {
      const query = cacheQueries.find((q) => JSON.stringify(q.queryKey) === JSON.stringify(key));
      expect(query).toBeTruthy();
      expect(persistableFeedQuery(query!)).toBe(false);
    }
  });

  it("谓词：error 态即使 key 在范围内也不持久化（defaultShouldDehydrateQuery=success）", async () => {
    const qc = new QueryClient();
    await qc
      .fetchQuery({
        queryKey: [...K_FEED],
        queryFn: () => Promise.reject(new Error("boom")),
        retry: false,
      })
      .catch(() => undefined);
    expect(qc.getQueryState([...K_FEED])?.status).toBe("error");
    const query = qc.getQueryCache().getAll()[0]!;
    expect(persistableFeedQuery(query)).toBe(false);
    expect(dehydrate(qc, { shouldDehydrateQuery: persistableFeedQuery }).queries).toHaveLength(0);
  });
});

describe("restore 往返", () => {
  it("真实 save → 注入 Storage → 真实 restore：InfiniteData 往返一致，范围外 key 不出现", async () => {
    const mem = new MemoryStorage();
    const seeded = makeInfiniteData(2, "rt");
    const source = new QueryClient();
    source.setQueryData([...K_FEED], seeded);
    source.setQueryData(["illust", "userWorks", 123, "illust"], makeInfiniteData(1, "excluded"));
    await saveViaCore(source, createFeedQueryPersister(mem));
    vi.advanceTimersByTime(DEBOUNCE_MS);

    const target = new QueryClient();
    await restoreViaCore(target, createFeedQueryPersister(mem));
    expect(target.getQueryData([...K_FEED])).toEqual(seeded);
    expect(target.getQueryData(["illust", "userWorks", 123, "illust"])).toBeUndefined();
  });
});

describe("失败矩阵", () => {
  it("损坏 JSON：删 key + warn，不 hydrate", async () => {
    const mem = new MemoryStorage();
    const key = await seedAndGetKey(mem);
    mem.setItem(key, "{{{not-json");

    const target = new QueryClient();
    await expect(restoreViaCore(target, createFeedQueryPersister(mem))).resolves.toBeUndefined();

    expect(warnTexts().some((t) => t.includes("[feedQueryPersist]"))).toBe(true);
    expect(mem.getItem(key)).toBeNull();
    expect(target.getQueryData([...K_FEED])).toBeUndefined();
  });

  it("超 maxAge：核心自动删除、不 warn（语义=无缓存）", async () => {
    const mem = new MemoryStorage();
    const key = await seedAndGetKey(mem);
    const raw = JSON.parse(mem.getItem(key)!) as { timestamp: number };
    raw.timestamp = Date.now() - FEED_PERSIST_MAX_AGE - 1000;
    mem.setItem(key, JSON.stringify(raw));

    const target = new QueryClient();
    await expect(restoreViaCore(target, createFeedQueryPersister(mem))).resolves.toBeUndefined();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(mem.getItem(key)).toBeNull();
    expect(target.getQueryData([...K_FEED])).toBeUndefined();
  });

  it("buster 不匹配：核心自动删除、不 warn", async () => {
    const mem = new MemoryStorage();
    const source = new QueryClient();
    source.setQueryData([...K_FEED], makeInfiniteData(1, "old"));
    await saveViaCore(source, createFeedQueryPersister(mem), "old-buster");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    const key = mem.key(0)!;

    const target = new QueryClient();
    await expect(restoreViaCore(target, createFeedQueryPersister(mem))).resolves.toBeUndefined();

    expect(warnSpy).not.toHaveBeenCalled();
    expect(mem.getItem(key)).toBeNull();
    expect(target.getQueryData([...K_FEED])).toBeUndefined();
  });

  it("空存储：restore no-op、无 warn、不写 key", async () => {
    const mem = new MemoryStorage();
    const target = new QueryClient();
    await expect(restoreViaCore(target, createFeedQueryPersister(mem))).resolves.toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(mem.length).toBe(0);
    expect(target.getQueryData([...K_FEED])).toBeUndefined();
  });

  it("restore 抛错：restoreFeedCache 外层 catch + warn，不 reject", async () => {
    const mem = new MemoryStorage();
    const key = await seedAndGetKey(mem);
    // 结构合法但 query 条目为 null → hydrate 解构抛 TypeError → 核心 re-throw（生产静默路径）
    mem.setItem(
      key,
      JSON.stringify({
        timestamp: Date.now(),
        buster: FEED_PERSIST_BUSTER,
        clientState: { queries: [null], mutations: [] },
      }),
    );

    vi.stubGlobal("localStorage", mem);
    vi.resetModules();
    const fresh = await import("@/api/feedQueryPersist");
    const freshQueryClientModule = await import("@/api/queryClient");

    await expect(fresh.restoreFeedCache()).resolves.toBeUndefined();
    expect(warnTexts().some((t) => t.includes("[feedQueryPersist] restore 失败"))).toBe(true);
    expect(mem.getItem(key)).toBeNull();
    expect(freshQueryClientModule.queryClient.getQueryData([...K_FEED])).toBeUndefined();
  });
});

describe("写回节流（trailing debounce 5000ms）", () => {
  it("窗口内多次保存合并为一次写入，落盘为最新 payload", async () => {
    const mem = new MemoryStorage();
    const persister = createFeedQueryPersister(mem);
    const setItemSpy = vi.spyOn(mem, "setItem");
    const qa = new QueryClient();
    qa.setQueryData([...K_FEED], makeInfiniteData(1, "A"));
    const qb = new QueryClient();
    qb.setQueryData([...K_FEED], makeInfiniteData(1, "B"));

    await saveViaCore(qa, persister);
    await saveViaCore(qb, persister);
    expect(setItemSpy).not.toHaveBeenCalled(); // 窗口内未落盘

    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(setItemSpy).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(mem.getItem(mem.key(0)!)!) as {
      clientState: {
        queries: Array<{
          queryKey: unknown[];
          state: { data: { pages: Array<{ items: string[] }> } };
        }>;
      };
    };
    expect(saved.clientState.queries[0]!.queryKey).toEqual([...K_FEED]);
    expect(saved.clientState.queries[0]!.state.data.pages[0]!.items[0]).toBe("B:p0");
  });

  it("removeClient 取消挂起的写回（logout 先清持久化再清内存的依据）", async () => {
    const mem = new MemoryStorage();
    const persister = createFeedQueryPersister(mem);
    const setItemSpy = vi.spyOn(mem, "setItem");
    const source = new QueryClient();
    source.setQueryData([...K_FEED], makeInfiniteData(1, "pending"));
    await saveViaCore(source, persister);

    persister.removeClient();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(mem.length).toBe(0);
  });
});

describe("配额梯子（4.5MB，全量→截 3 页→截 1 页→removeItem+warn）", () => {
  it("超限截到每 query 3 页写入，pages/pageParams 对齐", async () => {
    const mem = new MemoryStorage();
    const source = new QueryClient();
    // 5 页 × 1.2MB ≈ 6MB > 4.5MB；截 3 页 ≈ 3.6MB 可写入
    source.setQueryData([...K_FEED], makeInfiniteData(5, "big", 1_200_000));
    await saveViaCore(source, createFeedQueryPersister(mem));

    vi.advanceTimersByTime(DEBOUNCE_MS); // flush 时才走配额梯子
    expect(warnTexts().some((t) => t.includes("截断到每 query 3 页"))).toBe(true);

    const saved = JSON.parse(mem.getItem(mem.key(0)!)!) as {
      clientState: {
        queries: Array<{ state: { data: { pages: unknown[]; pageParams: unknown[] } } }>;
      };
    };
    const data = saved.clientState.queries[0]!.state.data;
    expect(data.pages).toHaveLength(3);
    expect(data.pageParams).toHaveLength(3); // pages/pageParams 截断一致
    expect(data.pageParams[2]).toBe("cursor:big:2"); // 与截后末页对齐
  });

  it("多 query 时每个 query 独立截断到 1 页（梯子末级）", async () => {
    const mem = new MemoryStorage();
    const source = new QueryClient();
    const big = makeInfiniteData(5, "big", 1_200_000);
    source.setQueryData(["feed", "recommended_illust"], big);
    source.setQueryData(["feed", "recommended_manga"], big);
    await saveViaCore(source, createFeedQueryPersister(mem));
    vi.advanceTimersByTime(DEBOUNCE_MS);

    const saved = JSON.parse(mem.getItem(mem.key(0)!)!) as {
      clientState: {
        queries: Array<{ state: { data: { pages: unknown[]; pageParams: unknown[] } } }>;
      };
    };
    expect(saved.clientState.queries).toHaveLength(2);
    for (const q of saved.clientState.queries) {
      expect(q.state.data.pages).toHaveLength(1);
      expect(q.state.data.pageParams).toHaveLength(1);
    }
  });

  it("截 1 页仍超限 → removeItem + warn，key 不存在", async () => {
    const mem = new MemoryStorage();
    const source = new QueryClient();
    source.setQueryData([...K_FEED], makeInfiniteData(1, "z", 5_000_000));
    await saveViaCore(source, createFeedQueryPersister(mem));
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(warnTexts().some((t) => t.includes("配额梯子全部失败"))).toBe(true);
    expect(mem.length).toBe(0);
  });

  it("setItem 抛 QuotaExceededError → 同梯子降级到 1 页写入成功", async () => {
    const mem = new QuotaLimitedStorage(2_000_000); // 假配额 2MB
    const source = new QueryClient();
    // 4 页 × 0.8MB ≈ 3.2MB ≤ 4.5MB（不触发主动截断）但 > 2MB（撞 setItem 配额）
    source.setQueryData([...K_FEED], makeInfiniteData(4, "q", 800_000));
    await saveViaCore(source, createFeedQueryPersister(mem));
    vi.advanceTimersByTime(DEBOUNCE_MS);

    const saved = JSON.parse(mem.getItem(mem.key(0)!)!) as {
      clientState: { queries: Array<{ state: { data: { pages: unknown[] } } }> };
    };
    expect(saved.clientState.queries[0]!.state.data.pages).toHaveLength(1);
    expect(warnTexts().some((t) => t.includes("疑似配额"))).toBe(true);
  });
});

describe("storage 不可用", () => {
  it("探测失败：warn 一次，restore/save 双 no-op", async () => {
    // 无参构造才会走懒探测路径（与生产单例一致），stubGlobal 提供「setItem 即抛」的 localStorage
    const mem = new BrokenWriteStorage();
    const setItemSpy = vi.spyOn(mem, "setItem");
    vi.stubGlobal("localStorage", mem);
    const persister = createFeedQueryPersister();

    expect(await persister.restoreClient()).toBeUndefined(); // 首次操作触发探测 → warn
    expect(warnTexts().filter((t) => t.includes("localStorage 不可用"))).toHaveLength(1);

    const source = new QueryClient();
    source.setQueryData([...K_FEED], makeInfiniteData(1, "noop"));
    await saveViaCore(source, persister);
    vi.advanceTimersByTime(DEBOUNCE_MS);

    persister.removeClient();
    expect(warnSpy).toHaveBeenCalledTimes(1); // 只 warn 一次
    expect(setItemSpy).toHaveBeenCalledTimes(1); // 只有探测那一次，无重试写
    expect(mem.length).toBe(0);
  });
});

/**
 * clearPersistedFeedsAndCache（S2 防空 payload 复活）：
 * queryClient.clear() 逐 query 触发 removed 事件 → 订阅把空快照经 5s debounce 写回刚删掉的 key。
 * 修法 = 模块级 suppressWrites 抑制窗口 + removeClient 取消挂起 debounce。
 */
describe("clearPersistedFeedsAndCache（logout 原子清空，S2）", () => {
  it("suppress 期间 persistClient no-op：clear() 的 removed 事件经订阅也不会写回空快照", async () => {
    const mem = new MemoryStorage();
    const seeded = makeInfiniteData(2, "logout");
    const source = new QueryClient();
    source.setQueryData([...K_FEED], seeded);
    await saveViaCore(source, createFeedQueryPersister(mem));
    vi.advanceTimersByTime(DEBOUNCE_MS);
    const key = mem.key(0)!;

    vi.stubGlobal("localStorage", mem);
    vi.resetModules();
    const fresh = await import("@/api/feedQueryPersist");
    const freshQueryClientModule = await import("@/api/queryClient");

    // 订阅接线（S2 根因路径：clear 期间订阅仍在线）
    await fresh.restoreFeedCache();
    expect(freshQueryClientModule.queryClient.getQueryData([...K_FEED])).toEqual(seeded);

    fresh.clearPersistedFeedsAndCache();

    // 旧实现的死法：removeClient 删 key 后，clear() 的 removed 事件 5s 后把空快照写回 key
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(mem.getItem(key)).toBeNull(); // key 已删除且未被空 payload 复活
    expect(mem.length).toBe(0);
    expect(freshQueryClientModule.queryClient.getQueryData([...K_FEED])).toBeUndefined();
  });

  it("clearPersistedFeedsAndCache 后 storage key 不存在（取消挂起 debounce + 末尾 removeClient 兜底）", async () => {
    const mem = new MemoryStorage();
    vi.stubGlobal("localStorage", mem);
    vi.resetModules();
    const fresh = await import("@/api/feedQueryPersist");
    const freshQueryClientModule = await import("@/api/queryClient");
    await fresh.restoreFeedCache();

    // 单例缓存已有数据 → 订阅会排一个 5s debounce 写回，随后原子清空必须连它一起取消
    freshQueryClientModule.queryClient.setQueryData([...K_FEED], makeInfiniteData(1, "pre"));
    fresh.clearPersistedFeedsAndCache();

    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(mem.length).toBe(0);
    expect(freshQueryClientModule.queryClient.getQueryData([...K_FEED])).toBeUndefined();
  });
});

describe("restoreFeedCache 端到端（vi.stubGlobal localStorage）", () => {
  it("restore 注入单例 queryClient + 订阅写回 + hidden 立即 flush", async () => {
    const mem = new MemoryStorage();
    const seeded = makeInfiniteData(2, "e2e");
    const source = new QueryClient();
    source.setQueryData([...K_FEED], seeded);
    await saveViaCore(source, createFeedQueryPersister(mem));
    vi.advanceTimersByTime(DEBOUNCE_MS);
    const key = mem.key(0)!;

    const docListeners: Record<string, (e: Event) => void> = {};
    const winListeners: Record<string, (e: Event) => void> = {};
    const docStub = {
      visibilityState: "visible",
      addEventListener: vi.fn((type: string, handler: (e: Event) => void) => {
        docListeners[type] = handler;
      }),
    };
    vi.stubGlobal("localStorage", mem);
    vi.stubGlobal("document", docStub);
    vi.stubGlobal("window", {
      addEventListener: vi.fn((type: string, handler: (e: Event) => void) => {
        winListeners[type] = handler;
      }),
    });
    vi.resetModules();
    const fresh = await import("@/api/feedQueryPersist");
    const freshQueryClientModule = await import("@/api/queryClient");

    await fresh.restoreFeedCache();
    // hydrate：持久化数据注入单例
    expect(freshQueryClientModule.queryClient.getQueryData([...K_FEED])).toEqual(seeded);

    // 订阅生效：内存缓存变更 → 5s debounce 落盘
    freshQueryClientModule.queryClient.setQueryData(
      ["novel", "recommended"],
      makeInfiniteData(1, "sub"),
    );
    vi.advanceTimersByTime(DEBOUNCE_MS);
    const saved = JSON.parse(mem.getItem(key)!) as {
      clientState: { queries: Array<{ queryKey: unknown[] }> };
    };
    expect(saved.clientState.queries.map((q) => q.queryKey)).toContainEqual([
      "novel",
      "recommended",
    ]);

    // flush 监听：未到 5s，visibilitychange→hidden 立即落盘
    freshQueryClientModule.queryClient.setQueryData(
      ["bookmarks", 7, "public"],
      makeInfiniteData(1, "flush"),
    );
    docStub.visibilityState = "hidden";
    docListeners["visibilitychange"]!(new Event("visibilitychange"));
    const flushed = JSON.parse(mem.getItem(key)!) as {
      clientState: { queries: Array<{ queryKey: unknown[] }> };
    };
    expect(flushed.clientState.queries.map((q) => q.queryKey)).toContainEqual([
      "bookmarks",
      7,
      "public",
    ]);

    // pagehide 接线存在
    expect(Object.keys(winListeners)).toContain("pagehide");
  });
});

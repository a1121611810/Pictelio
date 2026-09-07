// @vitest-environment node
/**
 * createTQFeedStore prefetchAllTabs 空闲预取语义（地图 #371 / #375 实施记录）。
 *
 * oracle 溯源：
 * - 填空语义（默认 staleTime=Infinity，已有数据一律跳过）= #373 事实核查结论：
 *   预取应最小化 API 足迹，只填补空缓存；已缓存（含 feedQueryPersist 恢复的陈旧数据）
 *   的 tab 依赖既有 SWR（activate 路径 ensureLoaded，30s staleTime）刷新。
 * - 预取动机 = #372 基线：真首访 tab 骨架等网络 5-9s，预取消除该等待。
 * - 覆盖面期望值 = keysForTab 语义（activeKeys 的 tab 参数化）：merge "all" 模式
 *   预取全部子查询、指定 subTab 只预取该子查询——与访问时 activeKeys 完全一致，
 *   保证「预取的数据 = 访问时 items() 读到的数据」。
 * - 预取不改变 UI 状态（不触碰 activated 信号）：lazy store 未 activate 时
 *   loading 必须保持 false（骨架判据 loading() && items 为空）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/solid-query";

const qc = vi.hoisted(() => ({ client: undefined as QueryClient | undefined }));

vi.mock("@/api/queryClient", () => ({
  get queryClient() {
    return qc.client!;
  },
}));

import { createTQFeedStore, type TQFeedStoreResult } from "@/stores/shared/createTQFeedStore";

interface Item {
  id: number;
  create_date: string;
}

type FetchLog = string[];

const makeStore = (): TQFeedStoreResult<Item> =>
  createTQFeedStore<Item, string, undefined>({
    name: "test_prefetch_feed",
    currentTab: (() => "t1") as never,
    enabled: () => true,
    lazy: true,
    getDeps: () => undefined,
    staleTime: 30_000,
    errorStrategy: "priority",
    filterFn: (items) => items,
    tabs: {
      t1: {
        allMode: { type: "merge", subTabs: ["a", "b"] },
        getSubTab: () => "all",
        queries: {
          a: {
            queryKey: () => ["pf", "t1_a"],
            queryFn: () => {
              fetchLog.value.push("t1_a");
              return Promise.resolve({
                items: [{ id: 1, create_date: "2026-01-01" }],
                next_url: null,
              });
            },
          },
          b: {
            queryKey: () => ["pf", "t1_b"],
            queryFn: () => {
              fetchLog.value.push("t1_b");
              return Promise.resolve({
                items: [{ id: 2, create_date: "2026-01-02" }],
                next_url: null,
              });
            },
          },
        },
      },
      t2: {
        allMode: { type: "single", subTabs: ["main"] },
        queries: {
          main: {
            queryKey: () => ["pf", "t2_main"],
            queryFn: () => {
              fetchLog.value.push("t2_main");
              return Promise.resolve({ items: [], next_url: null });
            },
          },
        },
      },
    },
  });

const fetchLog: { value: FetchLog } = { value: [] };

beforeEach(() => {
  qc.client = new QueryClient();
  qc.client.clear();
  fetchLog.value = [];
});

afterEach(() => {
  // SWR 用例开启的 fake timers 不向后续用例泄漏（复检 P3 #3）
  vi.useRealTimers();
});

describe("createTQFeedStore prefetchAllTabs（#375 空闲预取）", () => {
  it("merge all 模式：对每个 tab 的全部子查询发起 ensure（t1_a/t1_b/t2_main）", async () => {
    const store = makeStore();
    const tasks = store.prefetchAllTabs();
    expect(tasks).toHaveLength(3);
    await Promise.all(tasks);
    expect(fetchLog.value.toSorted()).toEqual(["t1_a", "t1_b", "t2_main"]);
  });

  it("填空语义：已有数据的查询跳过（不重拉），空查询照常预取", async () => {
    const store = makeStore();
    // infinite query 缓存形状必须含 pageParams（TanStack v5 InfiniteQueryBehavior 要求）
    qc.client!.setQueryData(["pf", "t1_a"], {
      pages: [{ items: [{ id: 9, create_date: "2026-02-01" }], next_url: null }],
      pageParams: [undefined],
    });
    await Promise.all(store.prefetchAllTabs());
    expect(fetchLog.value).toEqual(["t1_b", "t2_main"]);
  });

  it("默认 staleTime=Infinity 参数透传 ensureInfiniteQueryData（参数级 pin）", async () => {
    const store = makeStore();
    const spy = vi.spyOn(qc.client!, "ensureInfiniteQueryData");
    store.prefetchAllTabs();
    const staleTimes = spy.mock.calls.map((c) => (c[0] as { staleTime?: number }).staleTime);
    expect(staleTimes).toHaveLength(3);
    expect(staleTimes.every((t) => t === Number.POSITIVE_INFINITY)).toBe(true);
  });

  it("失败传播：非活跃 tab 预取失败 → 重置回干净 pending（首访无错误闪现）", async () => {
    let fail = true;
    // currentTab = t1（活跃），失败的是 t2（非活跃）→ reset 语义保留（code review P2 原意图）
    const store = createTQFeedStore<Item, string, undefined>({
      name: "test_prefetch_fail_inactive",
      currentTab: (() => "t1") as never,
      enabled: () => true,
      lazy: true,
      getDeps: () => undefined,
      staleTime: 30_000,
      filterFn: (items) => items,
      tabs: {
        t1: {
          allMode: { type: "single", subTabs: ["main"] },
          queries: {
            main: {
              queryKey: () => ["pf_fail", "active"],
              queryFn: () => Promise.resolve({ items: [], next_url: null }),
            },
          },
        },
        t2: {
          allMode: { type: "single", subTabs: ["extra"] },
          queries: {
            extra: {
              queryKey: () => ["pf_fail", "inactive"],
              queryFn: () => {
                if (fail) return Promise.reject(new Error("network down"));
                return Promise.resolve({ items: [], next_url: null });
              },
            },
          },
        },
      },
    });
    await expect(Promise.all(store.prefetchAllTabs())).rejects.toThrow("network down");
    // 非活跃 tab：resetQueries 生效 → entry 回到干净 pending 且无 error（复检 N1：
    // 否定式断言在无修复时同样为绿，守不住该修复）
    const state = qc.client!.getQueryState(["pf_fail", "inactive"]);
    expect(state == null || (state.status === "pending" && state.error == null)).toBe(true);
    // 二次预取重新发起请求（缓存可干净重建）
    fail = false;
    await Promise.all(store.prefetchAllTabs());
    expect(store.items().length).toBe(0); // 空 feed 合法
  });

  it("失败传播：活跃 tab 预取失败 → 保持 error 不 reset（防永久骨架，#398）", async () => {
    // 真机实测（#393 T3）：活跃查询被 reset 回干净 pending 后，enabled:false 永不再
    // 自取 + #366 首载粘滞规则 → loading 恒 true = 永久骨架、ErrorDisplay 永不出现。
    // 活跃 tab 必须保持 error 态，交给面板 ErrorDisplay 的重试原地重载。
    let fail = true;
    const store = createTQFeedStore<Item, string, undefined>({
      name: "test_prefetch_fail_active",
      currentTab: (() => "t1") as never,
      enabled: () => true,
      lazy: true,
      getDeps: () => undefined,
      staleTime: 30_000,
      filterFn: (items) => items,
      tabs: {
        t1: {
          allMode: { type: "single", subTabs: ["main"] },
          queries: {
            main: {
              queryKey: () => ["pf_fail_active", "main"],
              queryFn: () => {
                if (fail) return Promise.reject(new Error("network down"));
                return Promise.resolve({ items: [], next_url: null });
              },
            },
          },
        },
      },
    });
    await expect(Promise.all(store.prefetchAllTabs())).rejects.toThrow("network down");
    // error 保留（不 reset）→ FeedList 的首载失败分支可渲染 ErrorDisplay
    expect(qc.client!.getQueryState(["pf_fail_active", "main"])?.status).toBe("error");
    // 面板重试路径：ensureLoaded 在网络恢复后重新拉取并清 error
    fail = false;
    await store.ensureLoaded();
    expect(store.error()).toBeNull();
  });

  it("ensureLoaded SWR：缓存陈旧时同步返回旧数据并触发后台重验证（revalidateIfStale，code review P1）", async () => {
    vi.useFakeTimers();
    const store = makeStore();
    qc.client!.setQueryData(["pf", "t1_a"], {
      pages: [{ items: [{ id: 7, create_date: "2026-01-07" }], next_url: null }],
      pageParams: [undefined],
    });
    // 回拨 dataUpdatedAt 使其超过 ensureLoaded 的 30s staleTime → 陈旧
    const entry = qc.client!.getQueryCache().find({ queryKey: ["pf", "t1_a"] });
    entry!.state.dataUpdatedAt = Date.now() - 31_000;
    const before = fetchLog.value.filter((v) => v === "t1_a").length;
    const p = store.ensureLoaded();
    // setQueryData/observer 通知经批处理微任务落地：先 flush 再断言缓存数据。
    // 注意 merge 模式下另一子查询（t1_b）的 ensureLoaded 取数也会在此窗口完成，
    // items 为两子查询合并结果——只断言「缓存未被后台重验证清空」。
    await vi.advanceTimersByTimeAsync(0);
    expect(store.items().length).toBeGreaterThanOrEqual(1);
    await p;
    // 后台重验证发生了：queryFn 被再次调用
    const after = fetchLog.value.filter((v) => v === "t1_a").length;
    expect(after).toBeGreaterThan(before);
  });

  it("自定义 staleTime 透传", async () => {
    const store = makeStore();
    const spy = vi.spyOn(qc.client!, "ensureInfiniteQueryData");
    store.prefetchAllTabs(30_000);
    expect(spy.mock.calls.every((c) => (c[0] as { staleTime?: number }).staleTime === 30_000)).toBe(
      true,
    );
  });

  it("指定 subTab（getSubTab 返回具体子查询）时只预取该子查询", async () => {
    const store = createTQFeedStore<Item, string, undefined>({
      name: "test_prefetch_subtab",
      currentTab: (() => "t1") as never,
      enabled: () => true,
      lazy: true,
      getDeps: () => undefined,
      staleTime: 30_000,
      filterFn: (items) => items,
      tabs: {
        t1: {
          allMode: { type: "merge", subTabs: ["a", "b"] },
          getSubTab: () => "b",
          queries: {
            a: {
              queryKey: () => ["pf2", "a"],
              queryFn: () => {
                fetchLog.value.push("a");
                return Promise.resolve({ items: [], next_url: null });
              },
            },
            b: {
              queryKey: () => ["pf2", "b"],
              queryFn: () => {
                fetchLog.value.push("b");
                return Promise.resolve({ items: [], next_url: null });
              },
            },
          },
        },
      },
    });
    await Promise.all(store.prefetchAllTabs());
    expect(fetchLog.value).toEqual(["b"]);
  });

  it("lazy 未激活：预取可用且不翻转 loading（不改变 UI 状态）", async () => {
    const store = makeStore();
    expect(store.isActivated()).toBe(false);
    expect(store.loading()).toBe(false);
    await Promise.all(store.prefetchAllTabs());
    expect(fetchLog.value.toSorted()).toEqual(["t1_a", "t1_b", "t2_main"]);
    expect(store.loading()).toBe(false);
    expect(store.isActivated()).toBe(false);
  });
});

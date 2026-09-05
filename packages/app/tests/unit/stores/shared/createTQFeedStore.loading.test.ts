// @vitest-environment node
/**
 * createTQFeedStore loading 首载粘滞语义（#366 FT-3）。
 *
 * oracle 溯源：
 * - 语义 = 工厂 loading 实现注释「已激活 && status=pending && 无错误 ⇒ 首载中」。
 *   真实事故（体检 P3 / s15 帧）：merge 多源 + 命令式 ensureInfiniteQueryData 组合下
 *   isFetching 信号在 fetch 进行中失真翻 false → FeedList 骨架被提前卸载 →
 *   内容区出现数秒空白窗 → 内容带图整体弹出。
 * - 期望行为：activate 后无数据即 loading=true（不随 isFetching 抖动）；
 *   数据到达（status=success，含合法空 feed）后 false；出错后 false 且 error 非空；
 *   lazy 未激活时不误报。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/solid-query";

const qc = vi.hoisted(() => ({ client: undefined as QueryClient | undefined }));

vi.mock("@/api/queryClient", () => ({
  get queryClient() {
    return qc.client!;
  },
}));

import { createTQFeedStore, type TQFeedStoreResult } from "@/stores/shared/createTQFeedStore";
import type { ApiError } from "@/api/types";

interface Item {
  id: number;
  create_date: string;
}

let resolveFetch: ((v: { items: Item[]; next_url: string | null }) => void) | null = null;
let rejectFetch: ((e: ApiError) => void) | null = null;
let fetchCalls = 0;

const makeStore = (): TQFeedStoreResult<Item> =>
  createTQFeedStore<Item, "tab", undefined>({
    name: "test_loading_feed",
    currentTab: () => "tab" as const,
    enabled: () => true,
    lazy: true,
    getDeps: () => undefined,
    staleTime: 30_000,
    errorStrategy: "priority",
    filterFn: (items) => items,
    tabs: {
      tab: {
        allMode: { type: "single", subTabs: ["main"] },
        queries: {
          main: {
            queryKey: () => ["test_loading_feed_main"],
            queryFn: () =>
              new Promise((res, rej) => {
                fetchCalls += 1;
                resolveFetch = res;
                rejectFetch = rej;
              }),
          },
        },
      },
    },
  });

beforeEach(() => {
  qc.client = new QueryClient();
  qc.client.clear();
  resolveFetch = null;
  rejectFetch = null;
  fetchCalls = 0;
});

describe("createTQFeedStore loading 首载粘滞（#366）", () => {
  it("lazy 未激活：loading=false（不误报骨架）", () => {
    const store = makeStore();
    expect(store.loading()).toBe(false);
  });

  it("核心回归：activate 后无数据即 loading=true，不随 isFetching 抖动提前翻 false", async () => {
    const store = makeStore();
    store.activate();
    // activate 尚未触发 fetch（fetchCalls=0、isFetching=false），status=pending：
    // 修复前此场景 loading=false（骨架提前卸载成空白窗），修复后粘滞为 true
    expect(fetchCalls).toBe(0);
    expect(store.loading()).toBe(true);

    const p = store.ensureLoaded();
    await Promise.resolve();
    expect(fetchCalls).toBe(1);
    expect(store.loading()).toBe(true);

    resolveFetch!({
      items: [
        { id: 1, create_date: "2026-01-01" },
        { id: 2, create_date: "2026-01-02" },
      ],
      next_url: null,
    });
    await p;
    expect(store.loading()).toBe(false);
    expect(store.items().length).toBe(2);
  });

  it("出错路径：loading=false 且 error 非空（骨架让位错误态，不永久粘滞）", async () => {
    const store = makeStore();
    store.activate();
    expect(store.loading()).toBe(true);

    const p = store.ensureLoaded();
    await Promise.resolve();
    rejectFetch!({
      type: 0,
      message: "network",
      reason: "network",
      name: "network",
    } as unknown as ApiError);
    try {
      await p;
    } catch {
      // ensureInfiniteQueryData 会抛出，调用方（页面）吞错由 error() 呈现
    }
    expect(store.loading()).toBe(false);
    expect(store.error()).not.toBeNull();
  });
});

/**
 * rankingStore 数据层契约（spec docs/specs/ranking.md §5.5 / §5.9 / §6.2）。
 *
 * oracle（独立来源）：
 * - 保序：rank = 全局下标 + 1，服务端返回顺序即名次顺序（spec §5.5）。测试数据刻意让
 *   create_date 与名次逆序——若数据层走了 sortByDate 合并路径，顺序会翻转为红。
 * - 过滤不重编号：spec §5.5「客户端过滤不重编号」→ 被滤除条目留下名次空洞。
 * - paginationError 置位/复位：ADR-0082（分页失败保留列表并置标志；刷新/成功复位）。
 * - 空响应 = 空态而非永久 loading：spec §5.3 状态机。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { QueryClient } from "@tanstack/solid-query";

const qc = vi.hoisted(() => ({ client: undefined as QueryClient | undefined }));
vi.mock("@/api/queryClient", () => ({
  get queryClient() {
    return qc.client!;
  },
}));

const fetchRankingMock = vi.fn();
const fetchRankingNextMock = vi.fn();
vi.mock("@/api/ranking", () => ({
  fetchRanking: (...a: unknown[]) => fetchRankingMock(...a),
  fetchRankingNext: (...a: unknown[]) => fetchRankingNextMock(...a),
}));

const filterMock = vi.fn((items: unknown[]) => items);
vi.mock("@/utils/r18Filter", () => ({
  filterFeedIllusts: (items: unknown[]) => filterMock(items),
}));

import { createRankingStore } from "@/stores/rankingStore";
import type { PixivIllust } from "@/api/types";

const illust = (id: number, create_date: string, x_restrict = 0): PixivIllust =>
  ({
    id,
    create_date,
    x_restrict,
    title: `t${id}`,
    user: { id: 1, name: "u" },
    total_bookmarks: id,
    image_urls: { square_medium: "", large: "", medium: "" },
  }) as unknown as PixivIllust;

function setup() {
  let dispose!: () => void;
  let store!: ReturnType<typeof createRankingStore>;
  createRoot((d) => {
    dispose = d;
    store = createRankingStore({ mode: "daily", date: null });
  });
  return { store, dispose };
}

beforeEach(() => {
  qc.client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fetchRankingMock.mockReset();
  fetchRankingNextMock.mockReset();
  filterMock.mockReset();
  filterMock.mockImplementation((items: unknown[]) => items);
});

describe("rankingStore", () => {
  it("保序：名次 = 全局下标+1，按服务端顺序而非 create_date 排序", async () => {
    // page1 的 create_date 与名次逆序：走 sortByDate 合并路径则 id1/id2 翻转
    fetchRankingMock.mockResolvedValue({
      illusts: [illust(1, "2020-01-01"), illust(2, "2026-01-02")],
      next_url: "https://app-api.pixiv.net/next?offset=30",
    });
    fetchRankingNextMock.mockResolvedValue({
      illusts: [illust(3, "2019-01-01"), illust(4, "2027-01-01")],
      next_url: null,
    });
    const { store, dispose } = setup();
    await store.ensureLoaded();
    expect(store.entries().map((e) => [e.rank, e.illust.id])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    await store.fetchMore();
    expect(store.entries().map((e) => [e.rank, e.illust.id])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ]);
    expect(store.nextUrl()).toBeNull();
    dispose();
  });

  it("过滤不重编号：被滤除条目留下名次空洞", async () => {
    fetchRankingMock.mockResolvedValue({
      illusts: [illust(1, "2026-01-01"), illust(2, "2026-01-02"), illust(3, "2026-01-03")],
      next_url: null,
    });
    filterMock.mockImplementation((items: unknown[]) =>
      (items as PixivIllust[]).filter((i) => i.id !== 2),
    );
    const { store, dispose } = setup();
    await store.ensureLoaded();
    expect(store.entries().map((e) => [e.rank, e.illust.id])).toEqual([
      [1, 1],
      [3, 3],
    ]);
    dispose();
  });

  it("分页失败：paginationError=true 且保留已加载列表；刷新后复位", async () => {
    fetchRankingMock.mockResolvedValue({
      illusts: [illust(1, "2026-01-01")],
      next_url: "https://app-api.pixiv.net/next?offset=30",
    });
    const { store, dispose } = setup();
    await store.ensureLoaded();
    expect(store.entries()).toHaveLength(1);
    expect(store.paginationError()).toBe(false);

    fetchRankingNextMock.mockRejectedValue(new Error("network down"));
    await store.fetchMore();
    await Promise.resolve();
    expect(store.error()).toBeTruthy();
    expect(store.paginationError()).toBe(true);
    // 已加载列表保留
    expect(store.entries()).toHaveLength(1);

    // 刷新第一页成功 → 复位
    fetchRankingMock.mockResolvedValue({
      illusts: [illust(1, "2026-01-01")],
      next_url: null,
    });
    await store.refresh();
    expect(store.paginationError()).toBe(false);
    dispose();
  });

  it("首载失败：error 非空且 loading 落回 false", async () => {
    fetchRankingMock.mockRejectedValue(new Error("boom"));
    const { store, dispose } = setup();
    await store.ensureLoaded().catch(() => {});
    expect(store.error()).not.toBeNull();
    expect(store.loading()).toBe(false);
    dispose();
  });

  it("空响应：空态（entries 空、loading=false），不是永久加载中", async () => {
    fetchRankingMock.mockResolvedValue({ illusts: [], next_url: null });
    const { store, dispose } = setup();
    await store.ensureLoaded();
    expect(store.entries()).toEqual([]);
    expect(store.loading()).toBe(false);
    expect(store.nextUrl()).toBeNull();
    dispose();
  });
});

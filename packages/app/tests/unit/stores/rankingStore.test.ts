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
    // serverCount = 服务端过滤前计数（R-18 指引判定依据，spec §5.7）
    expect(store.serverCount()).toBe(3);
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

  it("setQuery 改变请求参数；切回命中各自缓存（互不清空）", async () => {
    fetchRankingMock.mockResolvedValue({ illusts: [], next_url: null });
    const { store, dispose } = setup();
    await store.ensureLoaded();
    expect(fetchRankingMock).toHaveBeenLastCalledWith(
      { mode: "daily", date: null },
      expect.anything(),
    );
    const callsAfterFirst = fetchRankingMock.mock.calls.length;

    store.setQuery({ mode: "weekly", date: "2026-09-01" });
    await store.ensureLoaded();
    expect(fetchRankingMock).toHaveBeenLastCalledWith(
      { mode: "weekly", date: "2026-09-01" },
      expect.anything(),
    );
    expect(fetchRankingMock.mock.calls.length).toBe(callsAfterFirst + 1);

    // 切回日榜今日：命中 daily/null 缓存（不再请求），证明各 (mode,date) 缓存互不清空
    store.setQuery({ mode: "daily", date: null });
    await store.ensureLoaded();
    expect(fetchRankingMock.mock.calls.length).toBe(callsAfterFirst + 1);
    dispose();
  });

  it("入口与榜单页同键共用缓存：第二个 store ensureLoaded 不重复请求（spec §6.2）", async () => {
    fetchRankingMock.mockResolvedValue({ illusts: [illust(1, "2026-01-01")], next_url: null });
    const a = setup();
    await a.store.ensureLoaded();
    const calls = fetchRankingMock.mock.calls.length;

    // 第二个 store 用默认 (daily, today)，与第一个同 query key → 命中缓存
    let disposeB!: () => void;
    let storeB!: ReturnType<typeof createRankingStore>;
    createRoot((d) => {
      disposeB = d;
      storeB = createRankingStore();
    });
    await storeB.ensureLoaded();
    expect(fetchRankingMock.mock.calls.length).toBe(calls);
    a.dispose();
    disposeB();
  });

  it("首载请求进行中（pending+fetching）时读 entries()/serverCount()/nextUrl() 仍返回同步空值（不展开未提交的 data）", async () => {
    // oracle：TanStack v6 适配层 computeData ——「无提交数据」时 data() 返回进行中的 Promise
    // 或（enabled:false 且无数据）NEVER 哨兵；读取前者会挂起路由过渡（navigate 不提交）、
    // 读取后者会让投影永不落定（app 白屏）。首载期间必须只暴露骨架可用的空值。
    // 设备侧表现（白屏/登录后不跳转）由 packages/app/tests/android-e2e 覆盖。
    let resolveFetch!: (v: unknown) => void;
    fetchRankingMock.mockImplementation(
      () =>
        new Promise((res) => {
          resolveFetch = res;
        }),
    );
    const { store, dispose } = setup();
    try {
      const inflight = store.ensureLoaded();
      expect(store.loading()).toBe(true);
      expect(Array.isArray(store.entries())).toBe(true);
      expect(store.entries()).toEqual([]);
      expect(store.serverCount()).toBe(0);
      expect(store.nextUrl()).toBeNull();
      resolveFetch({ illusts: [illust(1, "2020-01-01")], next_url: null });
      await inflight;
      expect(store.entries().map((e) => e.illust.id)).toEqual([1]);
    } finally {
      dispose();
    }
  });

  it("未激活时读 entries()/serverCount()/nextUrl() 返回空值而不挂起（回归：禁用查询的 data() 返回 Solid NEVER）", () => {
    // oracle：spec §6.2「enabled:false + ensureLoaded」下，首帧必须能渲染骨架；
    // TanStack v6 适配层对 pending+idle 的查询 data() 返回 NEVER，直接读会让投影永不落定。
    const { store, dispose } = setup();
    try {
      expect(store.entries()).toEqual([]);
      expect(store.serverCount()).toBe(0);
      expect(store.nextUrl()).toBeNull();
      expect(store.loading()).toBe(true);
    } finally {
      dispose();
    }
  });
});

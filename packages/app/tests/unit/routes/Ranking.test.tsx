// @vitest-environment happy-dom
/**
 * Ranking 页面接线契约（spec docs/specs/ranking.md §5.3/§5.7；#515）。
 * oracle：ticket AC「维度切换改变请求参数」「后一天在今日禁用」「R-18 失败态渲染指引文案」。
 * store 以可控 fake 注入（本测试只验页面接线，数据层语义由 rankingStore.test.ts 覆盖）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";

const mocks = vi.hoisted(() => {
  const state = {
    error: null as unknown,
    paginationError: false,
    serverCount: 0,
    loading: false,
    entries: [] as unknown[],
  };
  const setQuery = vi.fn();
  const ensureLoaded = vi.fn(async () => {});
  const refresh = vi.fn(async () => {});
  const fetchMore = vi.fn(async () => {});
  const navigate = vi.fn();
  return {
    state,
    setQuery,
    ensureLoaded,
    refresh,
    fetchMore,
    navigate,
    store: {
      query: () => ({ mode: "daily", date: null }),
      setQuery,
      entries: () => state.entries,
      serverCount: () => state.serverCount,
      nextUrl: () => null,
      loading: () => state.loading,
      refreshing: () => false,
      loadingMore: () => false,
      error: () => state.error,
      paginationError: () => state.paginationError,
      ensureLoaded,
      refresh,
      fetchMore,
    },
  };
});

vi.mock("@/stores/rankingStore", () => ({ createRankingStore: () => mocks.store }));
vi.mock("@/components/NavBar", () => ({ default: () => null }));
vi.mock("@/services/backTransitionService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/backTransitionService")>();
  return { ...actual, goBack: vi.fn() };
});
vi.mock("@solidjs/router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solidjs/router")>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

import Ranking from "@/routes/Ranking";

/** 渲染榜单页并等待延迟挂载（createDeferredMount）落定——主体挂载后才有 DOM/接线可断言 */
async function renderRanking(): Promise<void> {
  render(() => <Ranking />);
  await new Promise((r) => setTimeout(r, 0));
}

const modeChip = (label: string) =>
  screen
    .getAllByRole("button")
    .find((b) => b.getAttribute("aria-pressed") !== null && b.textContent === label)!;

describe("Ranking 页面接线（#515）", () => {
  afterEach(() => {
    cleanup();
    mocks.setQuery.mockReset();
    mocks.ensureLoaded.mockReset();
    mocks.state.error = null;
    mocks.state.paginationError = false;
    mocks.state.serverCount = 0;
    mocks.state.loading = false;
    mocks.state.entries = [];
  });

  it("点击维度 chip → setQuery 带新 mode + ensureLoaded", async () => {
    await renderRanking();
    fireEvent.click(modeChip("周榜"));
    expect(mocks.setQuery).toHaveBeenLastCalledWith({ mode: "weekly", date: null });
    expect(mocks.ensureLoaded).toHaveBeenCalled();
  });

  it("今日时「后一天」禁用（页面接线）", async () => {
    await renderRanking();
    expect((screen.getByLabelText("后一天") as HTMLButtonElement).disabled).toBe(true);
  });

  it("R-18 档首载失败（服务端无数据）→ 渲染可操作指引，不显示普通空态", async () => {
    mocks.state.error = { type: "unknown", message: "boom" };
    mocks.state.serverCount = 0;
    mocks.state.loading = false;
    await renderRanking();
    fireEvent.click(modeChip("R-18"));
    // Solid 2.0：事件内 signal 写批处理，DOM 断言前需 flush（同 searchExecution.test.ts）
    flush();
    expect(mocks.setQuery).toHaveBeenLastCalledWith({ mode: "r18", date: null });
    expect(screen.getByText("R-18 榜单需要先在 pixiv 开启")).toBeTruthy();
    expect(screen.queryByText("暂无榜单内容")).toBeNull();
  });

  it("R-18 档服务端有数据但客户端过滤光 → 不显示指引（普通空态）", async () => {
    mocks.state.serverCount = 30; // 服务端有数据，entries 因过滤为空
    mocks.state.loading = false;
    await renderRanking();
    fireEvent.click(modeChip("R-18"));
    expect(screen.queryByText("R-18 榜单需要先在 pixiv 开启")).toBeNull();
  });
});

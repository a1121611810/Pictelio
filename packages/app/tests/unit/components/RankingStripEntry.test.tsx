// @vitest-environment happy-dom
/**
 * RankingStripEntry 契约（spec docs/specs/ranking.md §5.1/§5.2；#516）。
 * oracle：ticket AC「入口固定日榜·今日」「缩略图进取详情 / 全部 › 进榜单页」「收起当次隐藏、
 * 刷新恢复」「入口受开关控制」「共用同一查询」。store/router 以可控 mock 注入。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { PixivIllust } from "@/api/types";

const mocks = vi.hoisted(() => ({
  on: true,
  createRankingStore: vi.fn(),
  ensureLoaded: vi.fn(async () => {}),
  navigate: vi.fn(),
}));

vi.mock("@/stores/settingsStore", () => ({ rankingEntry: () => mocks.on }));
vi.mock("@/stores/rankingStore", () => ({
  createRankingStore: (...a: unknown[]) => mocks.createRankingStore(...a),
}));
vi.mock("@solidjs/router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solidjs/router")>();
  return { ...actual, useNavigate: () => mocks.navigate };
});

import RankingStripEntry from "@/components/ranking/RankingStripEntry";

const illust = (id: number): PixivIllust =>
  ({
    id,
    title: `t${id}`,
    user: { id: 1, name: "u" },
    image_urls: { square_medium: "https://i.pximg.net/a.jpg", large: "", medium: "" },
  }) as unknown as PixivIllust;

const entries = Array.from({ length: 25 }, (_, i) => ({ rank: i + 1, illust: illust(i + 1) }));

interface StoreOverrides {
  entries?: () => unknown[];
  error?: () => unknown;
}

function mockStore(over: StoreOverrides = {}) {
  mocks.createRankingStore.mockReturnValue({
    entries: over.entries ?? (() => entries),
    error: over.error ?? (() => null),
    loading: () => false,
    ensureLoaded: mocks.ensureLoaded,
  });
}

describe("RankingStripEntry", () => {
  afterEach(() => {
    cleanup();
    mocks.createRankingStore.mockReset();
    mocks.ensureLoaded.mockReset();
    mocks.navigate.mockReset();
  });

  it("开启：固定标题 + 前 20 名缩略图（名次角标），且 store 用默认参数（不传页面选择）", () => {
    mocks.on = true;
    mockStore();
    render(() => <RankingStripEntry />);
    expect(screen.getByText("今日排行 Top 20")).toBeTruthy();
    const items = screen.getAllByTestId("ranking-strip-item");
    expect(items).toHaveLength(20); // spec §3.4：只取前 20
    expect(items[0]!.getAttribute("aria-label")).toBe("第1名：t1");
    expect(items[19]!.getAttribute("aria-label")).toBe("第20名：t20");
    // 固定日榜·今日：createRankingStore() 无参（默认 daily/null），不随榜单页选择
    expect(mocks.createRankingStore).toHaveBeenCalledWith();
  });

  it("点缩略图进作品详情；点「全部」进 /ranking", () => {
    mocks.on = true;
    mockStore();
    render(() => <RankingStripEntry />);
    fireEvent.click(screen.getAllByTestId("ranking-strip-item")[0]!);
    expect(mocks.navigate).toHaveBeenCalledWith("/illust/1");
    fireEvent.click(screen.getByRole("button", { name: "查看完整排行榜" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/ranking");
  });

  it("收起：当次隐藏", () => {
    mocks.on = true;
    mockStore();
    render(() => <RankingStripEntry />);
    fireEvent.click(screen.getByRole("button", { name: "收起排行榜" }));
    flush();
    expect(screen.queryByText("今日排行 Top 20")).toBeNull();
  });

  it("刷新（refreshEpoch 变化）→ 恢复被收起的入口", () => {
    mocks.on = true;
    mockStore();
    const [epoch, setEpoch] = createSignal(0);
    render(() => <RankingStripEntry refreshEpoch={epoch()} />);
    fireEvent.click(screen.getByRole("button", { name: "收起排行榜" }));
    flush();
    expect(screen.queryByText("今日排行 Top 20")).toBeNull();
    setEpoch(1);
    flush();
    expect(screen.getByText("今日排行 Top 20")).toBeTruthy();
  });

  it("关闭开关：不渲染入口，也不创建数据源/发请求", () => {
    mocks.on = false;
    mockStore();
    render(() => <RankingStripEntry />);
    expect(mocks.createRankingStore).not.toHaveBeenCalled();
    expect(mocks.ensureLoaded).not.toHaveBeenCalled();
    expect(screen.queryByText("今日排行 Top 20")).toBeNull();
  });

  it("无条目时展示骨架（而非空白）", () => {
    mocks.on = true;
    mockStore({ entries: () => [] });
    render(() => <RankingStripEntry />);
    expect(screen.getByTestId("ranking-strip-skeleton")).toBeTruthy();
    expect(screen.queryAllByTestId("ranking-strip-item")).toHaveLength(0);
  });

  it("加载失败且无条目：隐藏入口（不留永久骨架），不抛 unhandled", () => {
    mocks.on = true;
    mockStore({ entries: () => [], error: () => ({ type: "unknown" }) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(() => <RankingStripEntry />);
    flush();
    expect(screen.queryByText("今日排行 Top 20")).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// @vitest-environment happy-dom
/**
 * SearchResults — 分页错误内联重试契约测试。
 *
 * 覆盖分页失败（error + paginationError + 已有结果）时保留已加载结果、
 * 仅底部显示内联重试条且重试只重试失败页；首载失败（error 且无结果）时
 * 整页 ErrorDisplay 展示。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import SearchResults from "@/components/SearchResults";
import { ApiErrorType, type SearchResultItem } from "@/api/types";

// ImageCard/NovelCard 依赖大量 store，用最小桩隔离，聚焦错误处理渲染
vi.mock("@/components/ImageCard", () => ({
  default: (props: { illust: { title: string } }) => (
    <div data-testid="illust-card">{props.illust.title}</div>
  ),
}));
vi.mock("@/components/NovelCard", () => ({
  default: (props: { novel: { title: string } }) => (
    <div data-testid="novel-card">{props.novel.title}</div>
  ),
}));
// ErrorDisplay 依赖 useNavigate（UNAUTHORIZED/FORBIDDEN 才跳转），测试中桩掉
vi.mock("@solidjs/router", () => ({
  useNavigate: () => () => undefined,
}));

const item: SearchResultItem = {
  type: "illust",
  date: "2026-01-01T00:00:00+09:00",
  entity: { id: 1, title: "作品A", create_date: "2026-01-01T00:00:00+09:00" },
};

const error = { type: ApiErrorType.UNKNOWN, message: "请求失败 (HTTP 404)" };

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    results: [item],
    loading: false,
    hasMore: true,
    onLoadMore: vi.fn(),
    onIllustClick: vi.fn(),
    onNovelClick: vi.fn(),
    onRefresh: vi.fn(),
    error: null,
    paginationError: false,
    ...overrides,
  } as unknown as Parameters<typeof SearchResults>[0];
}

describe("SearchResults 分页错误内联重试", () => {
  afterEach(() => cleanup());

  it("分页失败时保留已加载结果，显示内联重试条，重试只调 onLoadMore", () => {
    const onLoadMore = vi.fn();
    const onRefresh = vi.fn();
    render(() => (
      <SearchResults {...makeProps({ error, paginationError: true, onLoadMore, onRefresh })} />
    ));

    // 已加载结果保留
    expect(screen.getByText("作品A")).toBeTruthy();
    // 内联重试条出现
    expect(screen.getByText("加载更多失败")).toBeTruthy();
    const retry = screen.getByRole("button", { name: "重试" });
    fireEvent.click(retry);
    // 只重试失败页（onLoadMore），不整页重刷（onRefresh 不被调用）
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("首载失败（无结果）时整页 ErrorDisplay，重试绑 onRefresh", () => {
    const onRefresh = vi.fn();
    render(() => (
      <SearchResults {...makeProps({ results: [], error, paginationError: false, onRefresh })} />
    ));

    expect(screen.getByText("请求失败 (HTTP 404)")).toBeTruthy();
    const retry = screen.getByRole("button", { name: "重试" });
    fireEvent.click(retry);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("无错误时正常渲染结果且不显示重试条", () => {
    render(() => <SearchResults {...makeProps()} />);
    expect(screen.getByText("作品A")).toBeTruthy();
    expect(screen.queryByText("加载更多失败")).toBeNull();
  });
});

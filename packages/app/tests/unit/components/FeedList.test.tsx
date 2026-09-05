// @vitest-environment happy-dom
/**
 * FeedList — 统一 Feed 容器「骨架 / 列表 / 空态 / 错误」渲染分支契约测试（#365 P4）。
 *
 * 期望值出处（oracle）：FeedList.tsx 渲染分支规格（ADR-0078 + FT-2 #365 验收「先渲染后加载」）：
 * - loading && items 空 → 骨架（数据到达前的可见进展占位）
 * - items 非空 → 列表（renderItem 逐项渲染）
 * - loading=false && items 空 && 无错误 → empty 槽（EmptyHint 由调用方提供）
 * - items 空 + 首载 error（非分页失败）→ ErrorDisplay 重试入口
 * props 驱动纯渲染：数据源全部由测试注入，不依赖 feed store。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { ApiErrorType } from "@/api/types";
import { FeedList, type FeedListSource } from "@/components/home/FeedList";

vi.mock("@/stores/imageHostStore", () => ({
  isImageHostEnabled: () => false,
}));
vi.mock("@/stores/settingsStore", () => ({
  imageCachePrefetch: () => false,
}));
// ErrorDisplay 依赖路由原语（A/useNavigate），测试中桩掉（SearchResults.test.tsx 同款）
vi.mock("@solidjs/router", () => ({
  A: (props: { href?: string; children?: HTMLElement }) => (
    <a href={props.href ?? "#"}>{props.children}</a>
  ),
  useNavigate: () => () => undefined,
}));

function makeSource(overrides: Partial<FeedListSource<string>> = {}): FeedListSource<string> {
  return {
    items: () => [],
    loading: () => true,
    refreshing: () => false,
    loadingMore: () => false,
    nextUrl: () => null,
    fetchMore: vi.fn(),
    refresh: vi.fn(),
    error: () => null,
    paginationError: () => false,
    ...overrides,
  };
}

const skeleton = () => <div data-testid="feed-skeleton">skeleton</div>;
const empty = () => <div data-testid="feed-empty">empty</div>;
const renderItem = (item: string) => <div data-testid="feed-item">{item}</div>;

describe("FeedList 渲染分支", () => {
  beforeEach(() => {
    // FeedPaginationSentinel 内部构造 IntersectionObserver（happy-dom 无实现）
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function () {
        return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() };
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("首载中（loading && items 空）渲染骨架——数据到达前的可见占位", () => {
    const { container } = render(() => (
      <FeedList
        source={makeSource()}
        containerClass="flex"
        skeleton={skeleton}
        empty={empty}
        renderItem={renderItem}
      />
    ));
    expect(container.querySelector('[data-testid="feed-skeleton"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="feed-item"]')).toBeNull();
  });

  it("items 非空时渲染列表，骨架退场", () => {
    const { container } = render(() => (
      <FeedList
        source={makeSource({ items: () => ["a", "b"], loading: () => false })}
        containerClass="flex"
        skeleton={skeleton}
        empty={empty}
        renderItem={renderItem}
      />
    ));
    expect(container.querySelectorAll('[data-testid="feed-item"]').length).toBe(2);
    expect(container.querySelector('[data-testid="feed-skeleton"]')).toBeNull();
  });

  it("加载完成且无数据（loading=false && items 空 && 无错误）渲染空态", () => {
    const { container } = render(() => (
      <FeedList
        source={makeSource({ loading: () => false })}
        containerClass="flex"
        skeleton={skeleton}
        empty={empty}
        renderItem={renderItem}
      />
    ));
    expect(container.querySelector('[data-testid="feed-empty"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="feed-skeleton"]')).toBeNull();
  });

  it("首载失败（items 空 + error 非空 + 非分页失败）渲染错误态而非空态", () => {
    const { container } = render(() => (
      <FeedList
        source={makeSource({
          loading: () => false,
          error: () => ({ type: ApiErrorType.NETWORK, message: "网络错误" }),
        })}
        containerClass="flex"
        skeleton={skeleton}
        empty={empty}
        renderItem={renderItem}
      />
    ));
    expect(container.querySelector('[data-testid="feed-empty"]')).toBeNull();
    expect(container.textContent).toContain("网络错误");
  });
});

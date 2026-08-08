// @vitest-environment happy-dom
/**
 * FeedPaginationSentinel — 滚动分页哨兵契约测试（ticket #179，spec: docs/spec-home-c-shell-l5.md）。
 *
 * props 驱动纯渲染，不依赖 store。mock 全局 IntersectionObserver（vi.fn 返回
 * { observe, disconnect, unobserve } 假对象），通过构造回调模拟进入/离开视口。
 * 契约：进入视口且 hasMore()=true → loadMore；hasMore()=false → 不调用；卸载 → disconnect。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import FeedPaginationSentinel from "@/components/home/FeedPaginationSentinel";

/** 组件构造 IO 时收到的回调，类型收窄便于测试驱动 */
type IOCallback = (entries: Array<{ isIntersecting: boolean }>, observer: unknown) => void;

interface IOMockInstance {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
}

describe("FeedPaginationSentinel", () => {
  let IOMock: ReturnType<typeof vi.fn>;
  let instance: IOMockInstance;

  beforeEach(() => {
    instance = { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() };
    // 构造函数 mock 必须可用 `new`（箭头函数不行），返回假实例对象
    IOMock = vi.fn(function () {
      return instance;
    });
    vi.stubGlobal("IntersectionObserver", IOMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("进入视口且 hasMore 为真时调用 loadMore", () => {
    const loadMore = vi.fn();
    render(() => <FeedPaginationSentinel hasMore={() => true} loadMore={loadMore} />);

    // onMount 同步构造 IO 并 observe 哨兵元素
    expect(IOMock).toHaveBeenCalledTimes(1);
    expect(instance.observe).toHaveBeenCalledTimes(1);

    const callback = IOMock.mock.calls[0][0] as IOCallback;
    callback([{ isIntersecting: true }], instance);
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it("hasMore 为假时即使进入视口也不调用 loadMore", () => {
    const loadMore = vi.fn();
    render(() => <FeedPaginationSentinel hasMore={() => false} loadMore={loadMore} />);

    const callback = IOMock.mock.calls[0][0] as IOCallback;
    callback([{ isIntersecting: true }], instance);
    expect(loadMore).not.toHaveBeenCalled();
  });

  it("isIntersecting 为假时不调用 loadMore", () => {
    const loadMore = vi.fn();
    render(() => <FeedPaginationSentinel hasMore={() => true} loadMore={loadMore} />);

    const callback = IOMock.mock.calls[0][0] as IOCallback;
    callback([{ isIntersecting: false }], instance);
    expect(loadMore).not.toHaveBeenCalled();
  });

  it("组件卸载时调用 disconnect 清理", () => {
    const { unmount } = render(() => (
      <FeedPaginationSentinel hasMore={() => true} loadMore={vi.fn()} />
    ));
    expect(instance.disconnect).not.toHaveBeenCalled();
    unmount();
    expect(instance.disconnect).toHaveBeenCalledTimes(1);
  });
});

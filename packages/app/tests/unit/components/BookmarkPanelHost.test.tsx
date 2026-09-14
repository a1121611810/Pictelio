// @vitest-environment happy-dom
/**
 * BookmarkPanelHost 全局单宿主接线（#545）。
 *
 * 覆盖 seam 的宿主半边：store 唤起 → 面板 DOM 出现 / 关闭 → 消失；
 * 返回键契约：面板打开时注册 overlay 栈（pushOverlay("bookmarkPanel")），
 * 关闭时 popOverlay——原详情页本地接线随面板全局化迁入宿主，此处钉死。
 *
 * oracle 溯源：面板开/关渲染 = BookmarkPanel 既有 `data-testid="bookmark-panel"`
 * 契约（isOpen=false 整树不渲染）；overlay 注册 = IllustDetail 原接线同款
 * （backGestureStore.pushOverlay/popOverlay，ADR-0160 D3/D4 返回键先关面板）。
 * store 半边（开/关/换目标/onSaved 存取）由 bookmarkPanelStore.test.ts 覆盖。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";

const api = vi.hoisted(() => ({
  loadBookmarkDetail: vi.fn(),
  loadUserBookmarkTags: vi.fn(),
  addBookmark: vi.fn(),
}));

vi.mock("@/api/illust", () => ({ ...api }));
vi.mock("@/stores/authStore", () => ({ user: () => ({ id: 42 }) }));
const gesture = vi.hoisted(() => ({ pushOverlay: vi.fn(), popOverlay: vi.fn() }));
vi.mock("@/stores/backGestureStore", () => gesture);

// useLocation 以响应式 signal 模拟（宿主 effect 追踪 pathname 读取）。
// signal 须在 mock 工厂内创建（vi.hoisted 先于 import 初始化，TDZ 不可触 solid-js），
// setPathname 经 holder 暴露给测试体。
const locationMock = vi.hoisted(() => ({
  setPathname: (_v: string) => {},
}));
vi.mock("@solidjs/router", async () => {
  const { createSignal } = await import("solid-js");
  const [pathname, setPathname] = createSignal("/");
  locationMock.setPathname = setPathname;
  return {
    useLocation: () => ({
      get pathname() {
        return pathname();
      },
    }),
  };
});

import BookmarkPanelHost from "@/components/BookmarkPanelHost";
import {
  openBookmarkPanel,
  closeBookmarkPanel,
  bookmarkPanelOpen,
  type BookmarkPanelRequest,
} from "@/stores/bookmarkPanelStore";

function makeReq(overrides: Partial<BookmarkPanelRequest> = {}): BookmarkPanelRequest {
  return {
    illustId: 123,
    isBookmarked: false,
    workTags: ["原创"],
    onSaved: () => {},
    ...overrides,
  };
}

/** flush：microtask 链（Solid 2.0 写批处理在微任务） */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  closeBookmarkPanel();
  api.loadBookmarkDetail.mockResolvedValue({ is_bookmarked: false, restrict: "public", tags: [] });
  api.loadUserBookmarkTags.mockResolvedValue({ bookmark_tags: [], next_url: null });
});

describe("BookmarkPanelHost（全局单宿主）", () => {
  it("初始无面板 DOM（store 未打开时宿主零渲染）", () => {
    render(() => <BookmarkPanelHost />);
    expect(screen.queryByTestId("bookmark-panel")).toBeNull();
    expect(gesture.pushOverlay).not.toHaveBeenCalled();
  });

  it("openBookmarkPanel 后面板出现并注册返回键 overlay", async () => {
    render(() => <BookmarkPanelHost />);
    openBookmarkPanel(makeReq());
    await flush();

    expect(screen.queryByTestId("bookmark-panel")).not.toBeNull();
    expect(gesture.pushOverlay).toHaveBeenCalledWith("bookmarkPanel", expect.any(Function));
    // illustId 传播到面板数据层（预填请求作用域 = 打开时传入的目标）
    expect(api.loadBookmarkDetail).toHaveBeenCalledWith(123, expect.anything());
  });

  it("路由变化时自动关面板（复审 P2：程序化导航不再使面板悬空）", async () => {
    render(() => <BookmarkPanelHost />);
    openBookmarkPanel(makeReq());
    await flush();
    expect(bookmarkPanelOpen()).toBe(true);

    locationMock.setPathname("/login");
    await flush();

    expect(bookmarkPanelOpen()).toBe(false);
    expect(screen.queryByTestId("bookmark-panel")).toBeNull();
  });

  it("closeBookmarkPanel 后面板消失并注销 overlay", async () => {
    render(() => <BookmarkPanelHost />);
    openBookmarkPanel(makeReq());
    await flush();
    expect(screen.queryByTestId("bookmark-panel")).not.toBeNull();

    closeBookmarkPanel();
    await flush();

    expect(screen.queryByTestId("bookmark-panel")).toBeNull();
    expect(gesture.popOverlay).toHaveBeenCalledWith("bookmarkPanel");
  });

  it("换目标重开：面板随新 request 重新出现（illustId 变化由面板 generation gate 兜竞态）", async () => {
    render(() => <BookmarkPanelHost />);
    openBookmarkPanel(makeReq({ illustId: 1 }));
    await flush();
    expect(screen.queryByTestId("bookmark-panel")).not.toBeNull();

    closeBookmarkPanel();
    await flush();
    expect(screen.queryByTestId("bookmark-panel")).toBeNull();

    openBookmarkPanel(makeReq({ illustId: 2, isBookmarked: true }));
    await flush();
    expect(screen.queryByTestId("bookmark-panel")).not.toBeNull();
  });
});

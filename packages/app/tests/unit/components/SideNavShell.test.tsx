// @vitest-environment happy-dom
/**
 * SideNavShell — 首页 C 框架外壳契约测试（ticket #179）。
 *
 * 覆盖核心导航行为：初始 Tab 桥接全局 currentTab、selectTab 反向同步
 * setCurrentTab、导航列结构与选中态。store 依赖以 mock 隔离（uiStore/authStore/
 * historyStore），ContentTypeToggle 一并 mock（其自身有独立渲染路径）。
 */
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";

const uiStore = vi.hoisted(() => ({
  currentTab: vi.fn(() => "recommended"),
  setCurrentTab: vi.fn(),
  contentType: vi.fn(() => "illust"),
  setContentType: vi.fn(),
}));

const authStore = vi.hoisted(() => ({
  user: vi.fn(() => null),
  isLoggedIn: vi.fn(() => false),
}));

const historyStore = vi.hoisted(() => ({
  historyCollection: { toArray: [] as unknown[] },
  historyVersion: [vi.fn(() => 0)],
  clearAllHistory: vi.fn(),
  removeHistoryEntry: vi.fn(),
}));

vi.mock("@/stores/uiStore", () => ({
  get currentTab() {
    return uiStore.currentTab;
  },
  setCurrentTab: uiStore.setCurrentTab,
  get contentType() {
    return uiStore.contentType;
  },
  setContentType: uiStore.setContentType,
}));

vi.mock("@/stores/authStore", () => ({
  get user() {
    return authStore.user;
  },
  isLoggedIn: authStore.isLoggedIn,
}));

vi.mock("@/stores/historyStore", () => ({
  get historyCollection() {
    return historyStore.historyCollection;
  },
  get historyVersion() {
    return historyStore.historyVersion;
  },
  clearAllHistory: historyStore.clearAllHistory,
  removeHistoryEntry: historyStore.removeHistoryEntry,
}));

vi.mock("@/components/home/ContentTypeToggle", () => ({
  default: () => null,
}));

vi.mock("@/components/UserAvatar", () => ({
  default: () => <span data-testid="mock-avatar" />,
}));

vi.mock("@solidjs/router", () => ({
  useNavigate: () => vi.fn(),
}));

import SideNavShell from "@/components/home/SideNavShell";

/** 路由上下文包装（SideNavShell 内部 useNavigate 已 mock）。 */
function renderShell(renderPanel: () => unknown) {
  return render(() => <SideNavShell renderPanel={renderPanel} />);
}

describe("SideNavShell", () => {
  beforeEach(() => {
    uiStore.currentTab.mockReturnValue("recommended");
    uiStore.setCurrentTab.mockClear();
    uiStore.contentType.mockReturnValue("illust");
    authStore.user.mockReturnValue(null);
    authStore.isLoggedIn.mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("初始 Tab 桥接全局 currentTab（如 PersonalCenter 预设 follow）", () => {
    uiStore.currentTab.mockReturnValue("follow");
    renderShell(() => <div data-testid="panel" />);
    const followBtn = screen.getByRole("button", { name: "关注" });
    expect(followBtn.getAttribute("aria-current")).toBe("page");
  });

  it("点击 Tab 反向同步 setCurrentTab 并切换选中态", () => {
    renderShell(() => <div data-testid="panel" />);
    const bookmarksBtn = screen.getByRole("button", { name: "收藏" });
    fireEvent.click(bookmarksBtn);
    expect(uiStore.setCurrentTab).toHaveBeenCalledWith("bookmarks");
    expect(bookmarksBtn.getAttribute("aria-current")).toBe("page");
    const recommendedBtn = screen.getByRole("button", { name: "推荐" });
    expect(recommendedBtn.getAttribute("aria-current")).toBe(null);
  });

  it("导航列含搜索/设置/我的入口与四个 Tab", () => {
    renderShell(() => <div data-testid="panel" />);
    for (const name of ["推荐", "关注", "收藏", "历史"]) {
      expect(screen.getByRole("button", { name })).toBeDefined();
    }
    expect(screen.getByRole("button", { name: "搜索" })).toBeDefined();
    expect(screen.getByRole("button", { name: "设置" })).toBeDefined();
    expect(screen.getByRole("button", { name: "我的" })).toBeDefined();
  });

  it("历史 Tab 渲染空态而非调用 renderPanel", () => {
    const renderPanel = vi.fn(() => <div data-testid="panel" />);
    renderShell(renderPanel);
    expect(renderPanel).toHaveBeenCalledTimes(1); // 初始推荐 Tab 渲染插槽
    const historyBtn = screen.getByRole("button", { name: "历史" });
    fireEvent.click(historyBtn);
    expect(renderPanel).toHaveBeenCalledTimes(1); // 历史 Tab 不再调用插槽
    expect(screen.queryByTestId("panel")).toBeNull();
  });
});

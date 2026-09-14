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
import { flush } from "solid-js";

const uiStore = vi.hoisted(() => {
  // currentTab 返回 backing 字符串的函数；setCurrentTab 同步更新 backing——
  // 模拟真 store「setCurrentTab 写后 currentTab 读出新值」语义，fireEvent.click
  // 后 uiStore 状态自洽。__overrideSource 让测试在反向同步用例中接入 createSignal，
  // 获得 SolidJS 响应式追踪（compute 才能重跑）。
  let backing: string = "recommended";
  let source: () => string = () => backing;
  return {
    get currentTab() {
      return source;
    },
    setCurrentTab: vi.fn((tab: string) => {
      backing = tab;
      source = () => backing;
    }),
    __setBacking: (v: string) => {
      backing = v;
      source = () => backing;
    },
    /** 接入外部响应式 source（createSignal getter）；同时冻结 backing 防止后续 setCurrentTab 误改 */
    __overrideSource: (s: () => string) => {
      source = s;
    },
    contentType: vi.fn(() => "illust"),
    setContentType: vi.fn(),
  };
});

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
    uiStore.__setBacking("recommended");
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
    uiStore.__setBacking("follow");
    renderShell(() => <div data-testid="panel" />);
    const followBtn = screen.getByRole("button", { name: "关注" });
    expect(followBtn.getAttribute("aria-current")).toBe("page");
  });

  it("点击 Tab 反向同步 setCurrentTab 并切换选中态", () => {
    renderShell(() => <div data-testid="panel" />);
    const bookmarksBtn = screen.getByRole("button", { name: "收藏" });
    fireEvent.click(bookmarksBtn);
    expect(uiStore.setCurrentTab).toHaveBeenCalledWith("bookmarks");
    // Solid 2.0 批量更新：选中态 class/aria 变更在 flush 后才落到 DOM
    flush();
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
    // Solid 2.0 批量更新：面板卸载在 flush 后才落到 DOM
    flush();
    expect(screen.queryByTestId("panel")).toBeNull();
  });
});

/**
 * SideNavShell 反向同步契约（spec #422 D1 / ticket #425）
 *
 * oracle 溯源：
 * - 全局→局部同步语义 = src/components/home/SideNavShell.tsx createEffect 注释
 *   「反向同步：全局 currentTab → 局部 tab」；
 * - 同值守卫防循环 = SolidJS 2 官方推荐「if (next === cur()) return」双写循环
 *   短路模式（docs.solidjs.com/create-effect）；
 * - 非法 HomeTab 跳过 = uiStore.Tab 含 "me"（PersonalCenter 专用，HomeTab 仅 4 个）
 *   若不守卫会导致 Solid 2 strict 类型不变量破坏。
 *
 * 测试技巧：uiStore.currentTab 必须返回 SolidJS 响应式源（signal），否则
 * mock 改变值不会被 SolidJS 追踪——compute 不会重跑，DOM 不更新。
 * 用真 createSignal 包住可变值，setSignal 触发响应式更新。
 */
describe("SideNavShell 全局 currentTab 反向同步", () => {
  beforeEach(() => {
    uiStore.__setBacking("recommended");
    uiStore.setCurrentTab.mockClear();
    uiStore.contentType.mockReturnValue("illust");
    authStore.user.mockReturnValue(null);
    authStore.isLoggedIn.mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("挂载后全局 currentTab 改变 → 局部 tab 跟随（核心 oracle）", async () => {
    const { createSignal } = await import("solid-js");
    const [tabSignal, setTabSignal] = createSignal<string>("recommended");
    uiStore.__overrideSource(() => tabSignal());

    renderShell(() => <div data-testid="panel" />);

    // 初始：currentTab=recommended → 推荐 Tab 选中
    expect(screen.getByRole("button", { name: "推荐" }).getAttribute("aria-current")).toBe("page");

    // 模拟 NavBar / PersonalCenter 入口改写 currentTab 为 bookmarks（响应式 signal set）
    setTabSignal("bookmarks");
    flush();
    expect(screen.getByRole("button", { name: "收藏" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "推荐" }).getAttribute("aria-current")).toBe(null);
  });

  it("同值守卫：currentTab 与局部 tab 相同时不触发 setTab → setCurrentTab → effect → setTab 循环", async () => {
    const { createSignal } = await import("solid-js");
    const [tabSignal, setTabSignal] = createSignal<string>("follow");
    uiStore.__overrideSource(() => tabSignal());

    renderShell(() => <div data-testid="panel" />);

    // 初始：currentTab=follow，SideNavShell 局部 tab=follow（双向一致）
    // effect 触发过一次但同值守卫短路，setTab 不调用 → setCurrentTab 不被调
    const initialSetCount = uiStore.setCurrentTab.mock.calls.length;

    // 把 signal 设为相同值——compute 重跑但 next === tab() 短路
    // Oracle 强化：effect 不重跑（DOM 选中态不变）；setCurrentTab 不被调
    setTabSignal("follow");
    flush();
    expect(uiStore.setCurrentTab.mock.calls.length).toBe(initialSetCount);
    // 关注 Tab 仍选中——证明局部 tab 未被多余覆盖
    expect(screen.getByRole("button", { name: "关注" }).getAttribute("aria-current")).toBe("page");
  });

  it("非法 HomeTab 跳过：currentTab='me'（PersonalCenter 专用）不污染 SideNavShell 局部 tab", async () => {
    const { createSignal } = await import("solid-js");
    const [tabSignal, setTabSignal] = createSignal<string>("recommended");
    uiStore.__overrideSource(() => tabSignal());

    renderShell(() => <div data-testid="panel" />);

    // 初始：推荐 Tab 选中
    expect(screen.getByRole("button", { name: "推荐" }).getAttribute("aria-current")).toBe("page");

    // 模拟 PersonalCenter 入口 setCurrentTab("me")
    setTabSignal("me");
    flush();

    // 推荐 Tab 仍选中（非法 HomeTab 被守卫跳过，无 setTab 副作用）
    expect(screen.getByRole("button", { name: "推荐" }).getAttribute("aria-current")).toBe("page");
  });

  it("连续切换：recommended → bookmarks → history → 局部 tab 全部跟随", async () => {
    const { createSignal } = await import("solid-js");
    const [tabSignal, setTabSignal] = createSignal<string>("recommended");
    uiStore.__overrideSource(() => tabSignal());

    renderShell(() => <div data-testid="panel" />);

    const sequence: Array<{ value: string; label: string }> = [
      { value: "bookmarks", label: "收藏" },
      { value: "history", label: "历史" },
      { value: "follow", label: "关注" },
    ];
    for (const step of sequence) {
      setTabSignal(step.value);
      flush();
      expect(screen.getByRole("button", { name: step.label }).getAttribute("aria-current")).toBe(
        "page",
      );
    }
  });
});

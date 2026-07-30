import type { Component } from "solid-js";
import { autoHideNavBar } from "../stores/settingsStore";
import { currentTab, setCurrentTab } from "../stores/uiStore";
import FluentIcon, { type FluentIconName } from "./ui/FluentIcon";
import { createScrollBehavior } from "../primitives/scroll/createScrollBehavior";

// ── Tab definitions ──
type NavTab = "recommended" | "follow" | "bookmarks" | "history";

interface TabDef {
  key: NavTab;
  label: string;
  icon: FluentIconName;
}

const leftTabs: TabDef[] = [
  { key: "recommended", label: "推荐", icon: "home" },
  { key: "follow", label: "关注", icon: "people" },
];

const rightTabs: TabDef[] = [
  { key: "bookmarks", label: "收藏", icon: "bookmark" },
  { key: "history", label: "历史", icon: "history" },
];

/** 类型守卫：判断 Tab 是否属于 NavTab */
function toNavTab(tab: string): NavTab | null {
  if (tab === "recommended" || tab === "follow" || tab === "bookmarks" || tab === "history") {
    return tab;
  }
  return null;
}

const NavBar: Component = () => {
  const navigate = useNavigate();

  // ── State ──
  const [compact, setCompact] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<NavTab>("recommended");

  // Sync with currentTab from store
  createEffect(() => {
    const ct = toNavTab(currentTab());
    if (ct) {
      setActiveTab(ct);
    }
  });

  // ── 触摸滑动手势标志（防止点击触发）──
  let swiped = false;

  // ── Scroll-driven compact/expand ──
  const HIDE_THRESHOLD = 20;
  const TOP_ZONE = 100;
  const {
    direction: scrollDirection,
    reset: resetScrollDirection,
    scrolledPast: createPast,
  } = createScrollBehavior({
    directionThreshold: HIDE_THRESHOLD,
    topGuard: TOP_ZONE,
  });
  const pastTopZone = createPast(TOP_ZONE);

  createEffect(() => {
    // 如果用户关闭了自动隐藏，始终展开
    if (!autoHideNavBar()) {
      if (compact()) setCompact(false);
      return;
    }
    // 顶部保护区内始终展开
    if (!pastTopZone()) {
      setCompact(false);
      return;
    }
    const d = scrollDirection();
    if (d === "down") setCompact(true);
    else if (d === "up") setCompact(false);
  });

  onCleanup(() => {
    clearTimeout(animTimer);
  });

  // Tab 切换时重置滚动跟踪
  createEffect(() => {
    currentTab();
    resetScrollDirection();
  });

  // ── 中心按钮触摸滑动检测 ──
  let touchStartY = 0;
  const SWIPE_THRESHOLD = 30;
  // 回顶动画状态
  const [scrollToTopAnim, setScrollToTopAnim] = createSignal(false);
  let animTimer: ReturnType<typeof setTimeout> | undefined;

  function handleTouchStart(e: TouchEvent) {
    touchStartY = e.touches[0].clientY;
    swiped = false;
  }

  function handleTouchEnd(e: TouchEvent) {
    const dy = touchStartY - e.changedTouches[0].clientY;
    if (dy > SWIPE_THRESHOLD) {
      swiped = true;
      // 触发动效
      setScrollToTopAnim(true);
      clearTimeout(animTimer);
      animTimer = setTimeout(() => setScrollToTopAnim(false), 600);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  // ── 中心按钮点击：导航到搜索页（滑动回顶时不触发）──
  function handleCenterClick() {
    if (swiped) {
      swiped = false;
      return;
    }
    void navigate({ to: "/search" });
  }

  // ── Tab 导航 ──
  function handleTabClick(key: NavTab) {
    setCurrentTab(key);
    // 所有 Tab：已在首页则同页 CSS 切换，否则导航到首页
    if (window.location.pathname === "/home") {
      window.history.replaceState(null, "", "/home");
    } else {
      void navigate({ to: "/home" });
    }
  }

  return (
    <nav class="floating-nav" aria-label="主导航">
      <div class="floating-nav-capsule" classList={{ "floating-nav-capsule-compact": compact() }}>
        {/* 左侧按钮组：推荐 + 关注 */}
        <div
          class="floating-nav-group"
          classList={{
            "floating-nav-group-visible": !compact(),
            "floating-nav-group-hidden": compact(),
          }}
          aria-hidden={compact()}
        >
          {leftTabs.map((tab) => (
            <button
              class="floating-nav-item"
              classList={{ "floating-nav-item-active": activeTab() === tab.key }}
              onClick={() => handleTabClick(tab.key)}
              aria-current={activeTab() === tab.key ? "page" : undefined}
              aria-label={tab.label}
              tabIndex={compact() ? -1 : 0}
            >
              <FluentIcon name={tab.icon} active={activeTab() === tab.key} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* 中心大圆按钮（搜索入口） */}
        <button
          class="floating-nav-center"
          classList={{ "scroll-top-anim": scrollToTopAnim() }}
          onClick={handleCenterClick}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          aria-label="搜索"
        >
          <FluentIcon name="search" size={24} />
        </button>

        {/* 右侧按钮组：收藏 + 历史 */}
        <div
          class="floating-nav-group"
          classList={{
            "floating-nav-group-visible": !compact(),
            "floating-nav-group-hidden": compact(),
          }}
          aria-hidden={compact()}
        >
          {rightTabs.map((tab) => (
            <button
              class="floating-nav-item"
              classList={{ "floating-nav-item-active": activeTab() === tab.key }}
              onClick={() => handleTabClick(tab.key)}
              aria-current={activeTab() === tab.key ? "page" : undefined}
              aria-label={tab.label}
              tabIndex={compact() ? -1 : 0}
            >
              <FluentIcon name={tab.icon} active={activeTab() === tab.key} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
};

export default NavBar;

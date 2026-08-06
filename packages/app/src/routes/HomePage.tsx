import type { Component } from "solid-js";
import { currentTab, setContentType, contentType } from "../stores/uiStore";
import { user, isLoggedIn } from "../stores/authStore";
import { activate as followActivate } from "../stores/followStore";
import { activate as novelFollowActivate } from "../stores/novelFollowStore";
import { activate as bookmarkActivate } from "../stores/bookmarkStore";
import { activate as novelBookmarkActivate } from "../stores/novelBookmarkStore";
import UserAvatar from "../components/UserAvatar";
import GlassTabBar from "../components/ui/GlassTabBar";
import RecommendedFeed from "../components/RecommendedFeed";
import FollowFeed from "../components/FollowFeed";
import BookmarksFeed from "../components/BookmarksFeed";
import HistoryFeed from "../components/HistoryFeed";
import NavBar from "../components/NavBar";
import PageTransition from "../components/PageTransition";
import { scrollToTop } from "../utils/scrollToTop";
import { createScrollBehavior } from "../primitives/scroll/createScrollBehavior";
import { markContentReady } from "@/native/splashBridge";

const HomePage: Component = () => {
  console.log("[RENDER] HomePage rendering");
  const navigate = useNavigate();
  const { visible: headerVisible } = createScrollBehavior();

  // ── LRU Tab DOM 管理 + 延迟激活 ──
  const MAX_DOM_TABS = 2;
  const [lastAccess, setLastAccess] = createStore<Record<string, number>>({
    recommended: Date.now(),
    follow: 0,
    bookmarks: 0,
    history: 0,
  });

  createEffect(() => {
    const tab = currentTab();
    setLastAccess(tab, Date.now());
    if (tab === "follow") {
      followActivate();
      novelFollowActivate();
    }
    if (tab === "bookmarks") {
      bookmarkActivate();
      novelBookmarkActivate();
    }
  });

  const domActiveTabs = createMemo(() => {
    const entries = Object.entries(lastAccess)
      .filter(([, ts]) => ts > 0)
      .toSorted(([, a], [, b]) => b - a);
    return new Set(entries.slice(0, MAX_DOM_TABS).map(([key]) => key));
  });

  function isDomActive(tab: string): boolean {
    return domActiveTabs().has(tab);
  }

  // ── Splash Screen 关闭：组件挂载后立即关闭，让骨架屏立即可见 ──
  onMount(() => {
    markContentReady();
  });

  return (
    <>
      <PageTransition>
        <div class="pb-16">
          {/* ── Shared Header ── */}
          <header
            class="sticky top-0 z-20 surface-appbar h-12 flex items-center justify-between px-4 transition-transform duration-[var(--durationNormal)] ease-[var(--curveEasyEase)]"
            classList={{
              "translate-y-0": headerVisible(),
              "-translate-y-full": !headerVisible(),
            }}
            onDblClick={scrollToTop}
          >
            <h1
              class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] tracking-tight leading-none flex items-center gap-2 min-w-0"
              classList={{ "cursor-pointer": isLoggedIn() }}
              onClick={() => isLoggedIn() && navigate("/me")}
            >
              <Show when={isLoggedIn() && user()} fallback={<>Pictelio</>}>
                <UserAvatar />
                <span class="truncate max-w-[120px]">{user()!.name}</span>
              </Show>
            </h1>

            {/* ── Content type toggle (隐藏于历史 tab) ── */}
            <Show when={currentTab() !== "history"}>
              <GlassTabBar
                variant="segmented"
                items={[
                  { key: "illust", label: "插画" },
                  { key: "novel", label: "小说" },
                ]}
                activeKey={contentType()}
                onSelect={(k) => setContentType(k as "illust" | "novel")}
                ariaLabel="内容类型切换"
                class="[&_.glass-tab-item]:min-h-0! [&_.glass-tab-item]:px-2.5! [&_.glass-tab-item]:py-1! [&_.glass-tab-item]:text-[var(--fontSizeBase100)]!"
              />
            </Show>
          </header>

          {/* ── Tab content panels ── */}
          <Show when={isDomActive("recommended")}>
            <div style={{ display: currentTab() === "recommended" ? "block" : "none" }}>
              <RecommendedFeed />
            </div>
          </Show>
          <Show when={isDomActive("follow")}>
            <div style={{ display: currentTab() === "follow" ? "block" : "none" }}>
              <FollowFeed />
            </div>
          </Show>
          <Show when={isDomActive("bookmarks")}>
            <div style={{ display: currentTab() === "bookmarks" ? "block" : "none" }}>
              <BookmarksFeed />
            </div>
          </Show>
          <Show when={isDomActive("history")}>
            <div style={{ display: currentTab() === "history" ? "block" : "none" }}>
              <HistoryFeed />
            </div>
          </Show>
        </div>
      </PageTransition>

      <NavBar />
    </>
  );
};

export default HomePage;

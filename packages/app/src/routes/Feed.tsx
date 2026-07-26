import type { Component } from "solid-js";
import {
  illusts,
  nextUrl,
  loading,
  refreshing,
  error,
  ensureLoaded,
  fetchMore,
  refresh,
  saveTabScroll,
  markFeedMounted,
  isFeedCached,
} from "../stores/feedStore";
import { currentTab } from "../stores/uiStore";
import { layoutMode } from "../stores/settingsStore";
import VirtualFeed from "../components/VirtualFeed";
import NavBar from "../components/NavBar";
import PageTransition from "../components/PageTransition";
import { createScrollBehavior } from "../primitives/scroll/createScrollBehavior";
const Feed: Component = () => {
  const navigate = useNavigate();
  const cached = isFeedCached();
  const { visible: headerVisible, suppress: suppressHeaderVisibility } = createScrollBehavior();
  let prevTab = currentTab();

  onMount(() => {
    markFeedMounted();
  });

  // Tab change: save old tab's scroll, restore new tab's scroll, load data
  createEffect(() => {
    const tab = currentTab();
    // Save scroll for the tab we're leaving
    if (tab !== prevTab && (prevTab === "recommended" || prevTab === "follow")) {
      saveTabScroll(prevTab);
    }
    prevTab = tab;
    untrack(() => ensureLoaded());
  });

  return (
    <>
      <PageTransition>
        <div class="pb-16">
          <header
            class="sticky top-0 z-20 surface-appbar h-12 flex items-center justify-between px-4 transition-transform duration-[var(--durationNormal)] ease-[var(--curveEasyEase)]"
            classList={{
              "translate-y-0": headerVisible(),
              "-translate-y-full": !headerVisible(),
            }}
          >
            <h1 class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] tracking-tight leading-none">
              Pictelio
            </h1>
            <div onClick={() => navigate({ to: "/settings" })} style="display:inline-flex">
              <fluent-button
                appearance="subtle"
                aria-label="设置"
                class="w-8 h-8 p-0 min-w-8"
                style="pointer-events:none"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12.003.75a.75.75 0 0 1 .75.75v1.087a6.7 6.7 0 0 1 1.97.812l.765-.765a.75.75 0 0 1 1.06 1.06l-.742.743c.488.541.894 1.15 1.194 1.81l1.032-.32a.75.75 0 1 1 .462 1.427l-1.054.342c.05.402.06.813.028 1.22l1.06.382a.75.75 0 0 1-.497 1.416l-1.077-.378a6.693 6.693 0 0 1-1.268 1.849l.753.754a.75.75 0 0 1-1.06 1.06l-.78-.78a6.716 6.716 0 0 1-1.823.789v1.112a.75.75 0 0 1-1.5 0v-1.102a6.658 6.658 0 0 1-1.853-.794l-.777.777a.75.75 0 0 1-1.06-1.06l.75-.75a6.695 6.695 0 0 1-1.27-1.835l-1.08.376a.75.75 0 1 1-.496-1.415l1.06-.384a6.745 6.745 0 0 1 .032-1.245l-1.05-.342a.75.75 0 1 1 .465-1.427l1.032.32c.303-.658.713-1.267 1.204-1.806l-.743-.743a.75.75 0 1 1 1.06-1.06l.766.766a6.687 6.687 0 0 1 1.962-.811V1.5a.75.75 0 0 1 .75-.75zm-.005 6a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z"
                    fill="currentColor"
                  />
                </svg>
              </fluent-button>
            </div>
          </header>

          <VirtualFeed
            illusts={illusts()}
            loading={loading() || refreshing()}
            error={error()}
            hasMore={nextUrl() !== null}
            onIllustClick={(id) => void navigate({ to: `/illust/${id}` })}
            onAuthorClick={(id) => void navigate({ to: `/user/${id}` })}
            onLoadMore={fetchMore}
            onRefresh={refresh}
            skipAnimation={cached}
            layoutMode={layoutMode()}
            scrollKey={cached ? currentTab() : undefined}
            suppressHeaderVisibility={suppressHeaderVisibility}
          />
        </div>
      </PageTransition>

      <NavBar />
    </>
  );
};

export default Feed;

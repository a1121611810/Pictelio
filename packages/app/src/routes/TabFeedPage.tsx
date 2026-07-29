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
  isFeedCached,
  getFeedScrollY,
  followTab,
  setFollowTab,
  recommendSubTab,
  setRecommendSubTab,
  type RecommendSubTab,
} from "../stores/feedStore";
import { contentType, setContentType } from "../stores/uiStore";
import type { Tab } from "../stores/uiStore";
import { layoutMode } from "../stores/settingsStore";
import type { PixivIllust } from "../api/types";
import { user, isLoggedIn } from "../stores/authStore";
import UserAvatar from "../components/UserAvatar";
import VirtualFeed from "../components/VirtualFeed";
import NavBar from "../components/NavBar";
import NovelFeedPage from "./NovelFeedPage";
import PageTransition from "../components/PageTransition";
import { scrollToTop } from "../utils/scrollToTop";
import { createScrollBehavior } from "../primitives/scroll/createScrollBehavior";
import { markContentReady } from "@/native/splashBridge";

interface Props {
  tab: Tab;
}

const r18Handler = () => refresh();

const TabFeedPage: Component<Props> = (props) => {
  const navigate = useNavigate();
  const cached = isFeedCached(props.tab);
  const [isSwitchingSubTab, setIsSwitchingSubTab] = createSignal(false);
  const { visible: headerVisible, suppress: suppressHeaderVisibility } = createScrollBehavior();
  let abortController: AbortController | null = null;

  const filteredIllusts = createMemo<PixivIllust[]>(() => {
    // Track followTab changes so filter updates immediately
    followTab();
    // FeedStore.computeFollowIllusts() already handles follow tab filtering
    return illusts();
  });

  // Initialize abort controller and trigger data loading in background
  onMount(() => {
    abortController = new AbortController();
    ensureLoaded(abortController.signal);
  });

  // 检测到 TanStack Query 开始 fetch（loading=true，骨架屏已渲染）后关闭 Splash
  let splashDismissed = false;
  createEffect(() => {
    if (splashDismissed) return;
    if (loading()) {
      splashDismissed = true;
      // 等待浏览器完成当前帧绘制（骨架屏已显示到屏幕），再关闭 Splash
      requestAnimationFrame(() => markContentReady());
    }
  });

  // 兜底：500ms 后确保 Splash 关闭
  onMount(() => {
    setTimeout(() => {
      if (!splashDismissed) {
        splashDismissed = true;
        markContentReady();
      }
    }, 500);
  });

  // Save scroll + abort pending requests on unmount
  onCleanup(() => {
    abortController?.abort();
    saveTabScroll(props.tab);
  });

  // R18 / R-18G switch toggle auto-refresh
  onMount(() => {
    window.addEventListener("r18Changed", r18Handler);
    window.addEventListener("r18gChanged", r18Handler);
    onCleanup(() => {
      window.removeEventListener("r18Changed", r18Handler);
      window.removeEventListener("r18gChanged", r18Handler);
    });
  });

  // Content type changed -> save scroll position
  const contentTypeHandler = () => {
    saveTabScroll(props.tab);
  };
  onMount(() => {
    window.addEventListener("contentTypeChanged", contentTypeHandler);
    onCleanup(() => window.removeEventListener("contentTypeChanged", contentTypeHandler));
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
            onDblClick={scrollToTop}
          >
            <h1
              class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] tracking-tight leading-none flex items-center gap-2 min-w-0"
              classList={{ "cursor-pointer": isLoggedIn() }}
              onClick={() => isLoggedIn() && navigate({ to: "/me" })}
            >
              <Show when={isLoggedIn() && user()} fallback={<>Pictelio</>}>
                <UserAvatar />
                <span class="truncate max-w-[120px]">{user()!.name}</span>
              </Show>
            </h1>

            {/* ── Content type toggle ── */}
            <div class="flex items-center bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusSmall)] p-0.5 gap-0.5">
              <button
                class="px-2.5 py-1 rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase100)] font-semibold transition-all active:scale-95 appearance-none border-none outline-none cursor-pointer"
                classList={{
                  "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
                    contentType() === "illust",
                  "bg-transparent text-[var(--colorNeutralForeground2)]":
                    contentType() !== "illust",
                }}
                onClick={() => setContentType("illust")}
              >
                插画
              </button>
              <button
                class="px-2.5 py-1 rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase100)] font-semibold transition-all active:scale-95 appearance-none border-none outline-none cursor-pointer"
                classList={{
                  "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
                    contentType() === "novel",
                  "bg-transparent text-[var(--colorNeutralForeground2)]": contentType() !== "novel",
                }}
                onClick={() => setContentType("novel")}
              >
                小说
              </button>
            </div>
          </header>

          {/* ── 关注页三层过滤 ── */}
          <Show when={props.tab === "follow" && contentType() === "illust"}>
            <div
              class="sticky top-12 z-10 surface-appbar px-4 pb-2 transition-transform duration-[var(--durationNormal)] ease-[var(--curveEasyEase)]"
              classList={{ "translate-y-0": headerVisible(), "-translate-y-12": !headerVisible() }}
            >
              <div class="flex bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-1 gap-1">
                {[
                  { key: "all" as const, label: "全部" },
                  { key: "public" as const, label: "公开" },
                  { key: "private" as const, label: "非公开" },
                ].map((opt) => (
                  <button
                    class="flex-1 py-[var(--spacingVerticalS)] px-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase200)] font-semibold transition-all active:scale-95 appearance-none border-none outline-none cursor-pointer"
                    classList={{
                      "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
                        followTab() === opt.key,
                      "bg-transparent text-[var(--colorNeutralForeground2)]":
                        followTab() !== opt.key,
                    }}
                    onClick={() => {
                      if (followTab() !== opt.key) {
                        setFollowTab(opt.key);
                      }
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </Show>

          {/* ── 推荐页子标签 ── */}
          <Show when={props.tab === "recommended" && contentType() === "illust"}>
            <div
              class="sticky top-12 z-10 surface-appbar px-4 pb-2 transition-transform duration-[var(--durationNormal)] ease-[var(--curveEasyEase)]"
              classList={{ "translate-y-0": headerVisible(), "-translate-y-12": !headerVisible() }}
            >
              <div class="flex bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-1 gap-1">
                {[
                  { key: "mixed" as RecommendSubTab, label: "综合" },
                  { key: "illust" as RecommendSubTab, label: "插画" },
                  { key: "manga" as RecommendSubTab, label: "漫画" },
                ].map((opt) => (
                  <button
                    role="tab"
                    aria-selected={recommendSubTab() === opt.key}
                    class="flex-1 py-[var(--spacingVerticalS)] px-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase200)] font-semibold transition-all active:scale-95 appearance-none border-none outline-none cursor-pointer"
                    classList={{
                      "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
                        recommendSubTab() === opt.key,
                      "bg-transparent text-[var(--colorNeutralForeground2)]":
                        recommendSubTab() !== opt.key,
                      "opacity-50 cursor-not-allowed": isSwitchingSubTab(),
                    }}
                    disabled={isSwitchingSubTab()}
                    onClick={async () => {
                      if (isSwitchingSubTab() || recommendSubTab() === opt.key) {
                        return;
                      }
                      setIsSwitchingSubTab(true);
                      // 中止当前请求，创建新的 AbortController
                      abortController?.abort();
                      abortController = new AbortController();
                      const [tabErr] = await tryAsync((async () => {
                        saveTabScroll(props.tab);
                        setRecommendSubTab(opt.key);
                        await ensureLoaded(abortController.signal);
                        suppressHeaderVisibility();
                        window.scrollTo(0, getFeedScrollY(props.tab));
                      })());
                      setIsSwitchingSubTab(false);
                      if (tabErr) {
                        throw tabErr;
                      }
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </Show>

          <Show
            when={contentType() === "illust"}
            fallback={
              <NovelFeedPage tab={props.tab} suppressHeaderVisibility={suppressHeaderVisibility} />
            }
          >
            <VirtualFeed
              illusts={filteredIllusts()}
              loading={loading() || refreshing()}
              error={error()}
              hasMore={nextUrl() !== null}
              onIllustClick={(id) => void navigate({ to: `/illust/${id}` })}
              onAuthorClick={(id) => void navigate({ to: `/user/${id}` })}
              onLoadMore={() => fetchMore(abortController?.signal)}
              onRefresh={() => { refresh(abortController?.signal); }}
              onNavigateToSettings={() => void navigate({ to: "/settings" })}
              skipAnimation={cached}
              layoutMode={layoutMode()}
              scrollKey={props.tab}
              suppressHeaderVisibility={suppressHeaderVisibility}
            />
          </Show>
        </div>
      </PageTransition>

      <NavBar />
    </>
  );
};

export default TabFeedPage;

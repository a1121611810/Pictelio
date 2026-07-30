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
  isRecommendedCached,
  getFeedScrollY,
  recommendSubTab,
  setRecommendSubTab,
  type RecommendSubTab,
} from "../stores/recommendedStore";
import type { PixivIllust } from "../api/types";
import VirtualFeed from "./VirtualFeed";
import NovelFeedPage from "../routes/NovelFeedPage";
import { contentType } from "../stores/uiStore";
import { layoutMode } from "../stores/settingsStore";

interface Props {
  suppressHeaderVisibility?: (durationMs?: number) => void;
}

const r18Handler = () => refresh();

const RecommendedFeed: Component<Props> = (props) => {
  const navigate = useNavigate();
  const cached = isRecommendedCached();
  const [isSwitchingSubTab, setIsSwitchingSubTab] = createSignal(false);
  let abortController: AbortController | null = null;

  const filteredIllusts = createMemo<PixivIllust[]>(() => {
    return illusts();
  });

  // 初始化数据加载
  onMount(() => {
    abortController = new AbortController();
    ensureLoaded(abortController.signal);
  });

  // Save scroll + abort pending requests on unmount
  onCleanup(() => {
    abortController?.abort();
    saveTabScroll("recommended");
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
    saveTabScroll("recommended");
  };
  onMount(() => {
    window.addEventListener("contentTypeChanged", contentTypeHandler);
    onCleanup(() => window.removeEventListener("contentTypeChanged", contentTypeHandler));
  });

  return (
    <>
      {/* ── 推荐页子标签 ── */}
      <Show when={contentType() === "illust"}>
        <div class="sticky top-12 z-10 surface-appbar px-4 pb-2">
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
                  abortController?.abort();
                  abortController = new AbortController();
                  const [tabErr] = await tryAsync((async () => {
                    saveTabScroll("recommended");
                    setRecommendSubTab(opt.key);
                    await ensureLoaded(abortController.signal);
                    props.suppressHeaderVisibility?.();
                    window.scrollTo(0, getFeedScrollY("recommended"));
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
          <NovelFeedPage tab="recommended" suppressHeaderVisibility={props.suppressHeaderVisibility} />
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
          scrollKey="recommended"
          suppressHeaderVisibility={props.suppressHeaderVisibility}
        />
      </Show>
    </>
  );
};

export default RecommendedFeed;

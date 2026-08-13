import type { Component } from "solid-js";
import {
  illusts,
  nextUrl,
  loading,
  refreshing,
  error,
  paginationError,
  ensureLoaded,
  fetchMore,
  refresh,
  isRecommendedCached,
  recommendSubTab,
  setRecommendSubTab,
  type RecommendSubTab,
} from "../stores/recommendedStore";
import type { PixivIllust } from "../api/types";
import VirtualFeed from "./VirtualFeed";
import NovelRecommendedFeed from "../routes/NovelRecommendedFeed";
import StickySubTabs from "./ui/StickySubTabs";
import { contentType } from "../stores/uiStore";
import { layoutMode } from "../stores/settingsStore";

const r18Handler = () => refresh();

interface RecommendedFeedProps {
  /** 上方滚动 header 是否可见（决定子标签 sticky 停靠点，见 StickySubTabs） */
  headerVisible?: boolean;
}

const RecommendedFeed: Component<RecommendedFeedProps> = (props) => {
  const navigate = useNavigate();
  const cached = isRecommendedCached();
  const [isSwitchingSubTab, setIsSwitchingSubTab] = createSignal(false);
  let abortController: AbortController | null = null;

  const filteredIllusts = createMemo<PixivIllust[]>(() => {
    return illusts();
  });

  // 初始化数据加载（延迟到下一帧，让骨架屏先渲染）
  onMount(() => {
    abortController = new AbortController();
    // 延迟到浏览器绘制完骨架屏后再加载数据
    setTimeout(() => {
      ensureLoaded(abortController!.signal);
    }, 0);
  });

  // Save scroll + abort pending requests on unmount
  onCleanup(() => {
    abortController?.abort();
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

  return (
    <>
      {/* ── 推荐页子标签 ── */}
      <Show when={contentType() === "illust"}>
        <StickySubTabs headerVisible={props.headerVisible ?? true} class="px-4 pb-2">
          <div class="flex bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-1 gap-1">
            {[
              { key: "mixed" as RecommendSubTab, label: "综合" },
              { key: "illust" as RecommendSubTab, label: "插画" },
              { key: "manga" as RecommendSubTab, label: "漫画" },
            ].map((opt) => (
              <button
                role="tab"
                aria-selected={recommendSubTab() === opt.key}
                class="flex-1 py-[var(--spacingVerticalS)] px-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)] font-semibold transition-all active:scale-95 appearance-none border-none outline-none cursor-pointer"
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
                  const [tabErr] = await tryAsync(
                    (async () => {
                      setRecommendSubTab(opt.key);
                      await ensureLoaded(abortController.signal);
                    })(),
                  );
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
        </StickySubTabs>
      </Show>

      <Show when={contentType() === "illust"} fallback={<NovelRecommendedFeed />}>
        <VirtualFeed
          illusts={filteredIllusts()}
          loading={loading() || refreshing()}
          error={error()}
          paginationError={paginationError()}
          hasMore={nextUrl() !== null}
          onIllustClick={(id) => void navigate(`/illust/${id}`)}
          onAuthorClick={(id) => void navigate(`/user/${id}`)}
          onLoadMore={() => fetchMore(abortController?.signal)}
          onRefresh={() => {
            refresh(abortController?.signal);
          }}
          onNavigateToSettings={() => void navigate("/settings")}
          skipAnimation={cached}
          layoutMode={layoutMode()}
        />
      </Show>
    </>
  );
};

export default RecommendedFeed;

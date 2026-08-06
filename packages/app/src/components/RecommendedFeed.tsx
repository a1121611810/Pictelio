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
  isRecommendedCached,
  recommendSubTab,
  setRecommendSubTab,
  type RecommendSubTab,
} from "../stores/recommendedStore";
import type { PixivIllust } from "../api/types";
import VirtualFeed from "./VirtualFeed";
import GlassTabBar from "./ui/GlassTabBar";
import NovelRecommendedFeed from "../routes/NovelRecommendedFeed";
import { contentType } from "../stores/uiStore";
import { layoutMode } from "../stores/settingsStore";

const r18Handler = () => refresh();

const RecommendedFeed: Component = () => {
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
        <div class="sticky top-12 z-10 surface-appbar px-4 pb-2">
          <GlassTabBar
            variant="segmented"
            items={[
              { key: "mixed", label: "综合" },
              { key: "illust", label: "插画" },
              { key: "manga", label: "漫画" },
            ]}
            activeKey={recommendSubTab()}
            onSelect={async (key) => {
              if (isSwitchingSubTab() || recommendSubTab() === key) {
                return;
              }
              setIsSwitchingSubTab(true);
              abortController?.abort();
              abortController = new AbortController();
              const [tabErr] = await tryAsync(
                (async () => {
                  setRecommendSubTab(key as RecommendSubTab);
                  await ensureLoaded(abortController.signal);
                })(),
              );
              setIsSwitchingSubTab(false);
              if (tabErr) {
                throw tabErr;
              }
            }}
            disabled={isSwitchingSubTab()}
            ariaLabel="推荐分类"
          />
        </div>
      </Show>

      <Show when={contentType() === "illust"} fallback={<NovelRecommendedFeed />}>
        <VirtualFeed
          illusts={filteredIllusts()}
          loading={loading() || refreshing()}
          error={error()}
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

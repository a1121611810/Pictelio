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
  isFollowCached,
  followTab,
  setFollowTab,
} from "../stores/followStore";
import type { PixivIllust } from "../api/types";
import VirtualFeed from "./VirtualFeed";
import GlassTabBar from "./ui/GlassTabBar";
import NovelFollowFeed from "../routes/NovelFollowFeed";
import { contentType } from "../stores/uiStore";
import { layoutMode } from "../stores/settingsStore";

const r18Handler = () => refresh();

const FollowFeed: Component = () => {
  const navigate = useNavigate();
  const cached = isFollowCached();
  let abortController: AbortController | null = null;

  const filteredIllusts = createMemo<PixivIllust[]>(() => {
    followTab();
    return illusts();
  });

  // 初始化数据加载（延迟到下一帧，让骨架屏先渲染）
  onMount(() => {
    abortController = new AbortController();
    setTimeout(() => {
      ensureLoaded(abortController!.signal);
    }, 0);
  });

  // Abort pending requests on unmount
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
      {/* ── 关注页三层过滤 ── */}
      <Show when={contentType() === "illust"}>
        <div class="sticky top-12 z-10 surface-appbar px-4 pb-2">
          <GlassTabBar
            variant="segmented"
            items={[
              { key: "all", label: "全部" },
              { key: "public", label: "公开" },
              { key: "private", label: "非公开" },
            ]}
            activeKey={followTab()}
            onSelect={(key) => {
              if (followTab() !== key) {
                setFollowTab(key as "all" | "public" | "private");
              }
            }}
            ariaLabel="关注分类"
          />
        </div>
      </Show>

      <Show when={contentType() === "illust"} fallback={<NovelFollowFeed />}>
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

export default FollowFeed;

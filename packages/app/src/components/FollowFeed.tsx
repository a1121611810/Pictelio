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
  isFollowCached,
  followTab,
  setFollowTab,
} from "../stores/followStore";
import type { PixivIllust } from "../api/types";
import VirtualFeed from "./VirtualFeed";
import NovelFollowFeed from "../routes/NovelFollowFeed";
import { contentType } from "../stores/uiStore";
import { layoutMode } from "../stores/settingsStore";

interface Props {
  suppressHeaderVisibility?: (durationMs?: number) => void;
}

const r18Handler = () => refresh();

const FollowFeed: Component<Props> = (props) => {
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

  // Save scroll + abort pending requests on unmount
  onCleanup(() => {
    abortController?.abort();
    saveTabScroll("follow");
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
    saveTabScroll("follow");
  };
  onMount(() => {
    window.addEventListener("contentTypeChanged", contentTypeHandler);
    onCleanup(() => window.removeEventListener("contentTypeChanged", contentTypeHandler));
  });

  return (
    <>
      {/* ── 关注页三层过滤 ── */}
      <Show when={contentType() === "illust"}>
        <div class="sticky top-12 z-10 surface-appbar px-4 pb-2">
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

      <Show
        when={contentType() === "illust"}
        fallback={
          <NovelFollowFeed suppressHeaderVisibility={props.suppressHeaderVisibility} />
        }
      >
        <VirtualFeed
          illusts={filteredIllusts()}
          loading={loading() || refreshing()}
          error={error()}
          hasMore={nextUrl() !== null}
          onIllustClick={(id) => void navigate(`/illust/${id}`)}
          onAuthorClick={(id) => void navigate(`/user/${id}`)}
          onLoadMore={() => fetchMore(abortController?.signal)}
          onRefresh={() => { refresh(abortController?.signal); }}
          onNavigateToSettings={() => void navigate("/settings")}
          skipAnimation={cached}
          layoutMode={layoutMode()}
          scrollKey="follow"
          suppressHeaderVisibility={props.suppressHeaderVisibility}
        />
      </Show>
    </>
  );
};

export default FollowFeed;

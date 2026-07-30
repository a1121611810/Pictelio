import type { Component } from "solid-js";
import {
  illusts,
  nextUrl,
  loading,
  error,
  restrict,
  ensureLoaded,
  fetchMore,
  refresh,
  setRestrict,
  saveBookmarkScroll,
} from "../stores/bookmarkStore";
import { user } from "../stores/authStore";
import { layoutMode } from "../stores/settingsStore";
import VirtualFeed from "../components/VirtualFeed";

const r18Handler = () => refresh();

interface Props {
  suppressHeaderVisibility?: (durationMs?: number) => void;
}

const IllustBookmarks: Component<Props> = (props) => {
  const navigate = useNavigate();

  onMount(() => {
    // 返回收藏页时静默刷新（已有数据后台更新，无数据由 effect 处理）
    if (illusts().length > 0 && !loading()) {
      refresh();
    }

    // R18 开关切换时自动刷新
    window.addEventListener("r18Changed", r18Handler);
    onCleanup(() => {
      window.removeEventListener("r18Changed", r18Handler);
    });
  });

  // Save scroll position when leaving
  onCleanup(() => {
    saveBookmarkScroll();
  });

  // Load data when restrict changes or when user becomes available
  createEffect(() => {
    const u = user();
    // Track restrict changes
    restrict();
    if (u) {
      ensureLoaded();
    }
  });

  return (
    <>
      {/* Segmented: 公开收藏 / 非公开收藏 */}
      <div class="flex justify-center py-3 px-4">
        <div
          class="inline-flex rounded-[var(--borderRadiusMedium)] p-0.5"
          style={{ background: "var(--colorNeutralBackground2)" }}
        >
          <button
            class="px-4 py-1.5 rounded-[var(--borderRadiusSmall)] text-sm font-medium transition-colors"
            classList={{
              "bg-[var(--colorBrandBackground)] text-white": restrict() === "public",
              "text-[var(--colorNeutralForeground2)]": restrict() !== "public",
            }}
            onClick={() => setRestrict("public")}
          >
            公开收藏
          </button>
          <button
            class="px-4 py-1.5 rounded-[var(--borderRadiusSmall)] text-sm font-medium transition-colors"
            classList={{
              "bg-[var(--colorBrandBackground)] text-white": restrict() === "private",
              "text-[var(--colorNeutralForeground2)]": restrict() !== "private",
            }}
            onClick={() => setRestrict("private")}
          >
            非公开收藏
          </button>
        </div>
      </div>

      <VirtualFeed
        illusts={illusts()}
        loading={loading()}
        error={error()}
        hasMore={nextUrl() !== null}
        onIllustClick={(id) => navigate(`/illust/${id}`)}
        onAuthorClick={(id) => navigate(`/user/${id}`)}
        onLoadMore={fetchMore}
        onRefresh={() => {
          refresh();
        }}
        emptyText={restrict() === "public" ? "公开收藏夹为空" : "非公开收藏夹为空"}
        skipAnimation={true}
        layoutMode={layoutMode()}
        scrollKey="illust-bookmarks"
        suppressHeaderVisibility={props.suppressHeaderVisibility}
      />
    </>
  );
};

export default IllustBookmarks;

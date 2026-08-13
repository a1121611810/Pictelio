import type { Component } from "solid-js";
import {
  novels,
  nextUrl,
  loading,
  error,
  paginationError,
  bookmarkRestrict,
  ensureLoaded,
  fetchMore,
  refresh,
  setBookmarkRestrict,
} from "../stores/novelBookmarkStore";
import NovelVirtualFeed from "../components/NovelVirtualFeed";
import SeriesSheet from "../components/SeriesSheet";
import { novelLayoutMode } from "../stores/settingsStore";
import { pushOverlay, popOverlay } from "../stores/backGestureStore";

const r18Handler = () => refresh();

interface Props {
  suppressHeaderVisibility?: (durationMs?: number) => void;
}

const NovelBookmarks: Component<Props> = (props) => {
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = createSignal(false);
  const [sheetSeries, setSheetSeries] = createSignal<{
    id: number;
    title: string;
    authorName: string;
    authorId: number;
  } | null>(null);

  function openSeriesSheet(seriesId: number) {
    const novel = novels().find((n) => n.series?.id === seriesId);
    if (!novel?.series) {
      return;
    }
    setSheetSeries({
      id: seriesId,
      title: novel.series.title,
      authorName: novel.user.name,
      authorId: novel.user.id,
    });
    setSheetOpen(true);
  }

  // 将系列目录面板状态注册到 overlay 栈
  createEffect(() => {
    if (sheetOpen()) {
      pushOverlay("seriesSheet", () => setSheetOpen(false));
      onCleanup(() => {
        popOverlay("seriesSheet");
      });
    }
  });

  onMount(() => {
    // 返回小说收藏页时静默刷新
    if (novels().length > 0 && !loading()) {
      refresh();
    }

    // R18 开关切换时自动刷新
    window.addEventListener("r18Changed", r18Handler);
    onCleanup(() => {
      window.removeEventListener("r18Changed", r18Handler);
    });
  });

  createEffect(() => {
    // Track restrict changes
    bookmarkRestrict();
    ensureLoaded();
  });

  return (
    <>
      {/* Segmented: 公开小说收藏 / 非公开小说收藏 */}
      <div class="flex justify-center py-3 px-4">
        <div
          class="inline-flex rounded-[var(--borderRadiusMedium)] p-0.5"
          style={{ background: "var(--colorNeutralBackground2)" }}
        >
          <button
            class="px-4 py-1.5 rounded-[var(--borderRadiusSmall)] text-sm font-medium transition-colors"
            classList={{
              "bg-[var(--colorBrandBackground)] text-white": bookmarkRestrict() === "public",
              "text-[var(--colorNeutralForeground2)]": bookmarkRestrict() !== "public",
            }}
            onClick={() => setBookmarkRestrict("public")}
          >
            公开收藏
          </button>
          <button
            class="px-4 py-1.5 rounded-[var(--borderRadiusSmall)] text-sm font-medium transition-colors"
            classList={{
              "bg-[var(--colorBrandBackground)] text-white": bookmarkRestrict() === "private",
              "text-[var(--colorNeutralForeground2)]": bookmarkRestrict() !== "private",
            }}
            onClick={() => setBookmarkRestrict("private")}
          >
            非公开收藏
          </button>
        </div>
      </div>

      <NovelVirtualFeed
        novels={novels()}
        loading={loading()}
        error={error()}
        paginationError={paginationError()}
        hasMore={nextUrl() !== null}
        onNovelClick={(id) => navigate(`/novel/${id}`)}
        onAuthorClick={(id) => navigate(`/user/${id}`)}
        onLoadMore={fetchMore}
        onRefresh={refresh}
        onSeriesClick={openSeriesSheet}
        layoutMode={novelLayoutMode()}
        suppressHeaderVisibility={props.suppressHeaderVisibility}
      />

      <Show when={sheetSeries()}>
        {(s) => (
          <SeriesSheet
            seriesId={s().id}
            seriesTitle={s().title}
            authorName={s().authorName}
            authorId={s().authorId}
            isOpen={sheetOpen()}
            onClose={() => setSheetOpen(false)}
            onNovelSelect={(id) => navigate(`/novel/${id}`)}
          />
        )}
      </Show>
    </>
  );
};

export default NovelBookmarks;

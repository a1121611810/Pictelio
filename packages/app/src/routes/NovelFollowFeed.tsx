import type { Component } from "solid-js";
import {
  novels,
  nextUrl,
  loading,
  refreshing,
  error,
  ensureLoaded,
  fetchMore,
  refresh,
  novelFollowTab,
  setNovelFollowTab,
} from "../stores/novelFollowStore";
import { novelLayoutMode } from "../stores/settingsStore";
import NovelVirtualFeed from "../components/NovelVirtualFeed";
import GlassTabBar from "../components/ui/GlassTabBar";
import SeriesSheet from "../components/SeriesSheet";
import { pushOverlay, popOverlay } from "../stores/backGestureStore";

interface Props {
  suppressHeaderVisibility?: (durationMs?: number) => void;
}

const NovelFollowFeed: Component<Props> = (props) => {
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
    if (!novel?.series) return;
    setSheetSeries({
      id: seriesId,
      title: novel.series.title,
      authorName: novel.user.name,
      authorId: novel.user.id,
    });
    setSheetOpen(true);
  }

  createEffect(() => {
    if (sheetOpen()) {
      pushOverlay("seriesSheet", () => setSheetOpen(false));
      onCleanup(() => {
        popOverlay("seriesSheet");
      });
    }
  });

  onMount(() => {
    void ensureLoaded();
  });

  return (
    <>
      {/* ── 关注页三层过滤 ── */}
      <div class="surface-appbar px-4 pb-2">
        <GlassTabBar
          variant="segmented"
          items={[
            { key: "all", label: "全部" },
            { key: "public", label: "公开" },
            { key: "private", label: "非公开" },
          ]}
          activeKey={novelFollowTab()}
          onSelect={(key) => {
            if (novelFollowTab() !== key) {
              setNovelFollowTab(key as "all" | "public" | "private");
              props.suppressHeaderVisibility?.();
            }
          }}
          ariaLabel="小说关注分类"
        />
      </div>

      <NovelVirtualFeed
        novels={novels()}
        loading={loading() || refreshing()}
        error={error()}
        hasMore={nextUrl() !== null}
        onNovelClick={(id) => navigate(`/novel/${id}`)}
        onAuthorClick={(id) => navigate(`/user/${id}`)}
        onLoadMore={fetchMore}
        onRefresh={() => {
          refresh();
        }}
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

export default NovelFollowFeed;

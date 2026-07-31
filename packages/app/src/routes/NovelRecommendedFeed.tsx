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
} from "../stores/novelRecommendedStore";
import { novelLayoutMode } from "../stores/settingsStore";
import NovelVirtualFeed from "../components/NovelVirtualFeed";
import SeriesSheet from "../components/SeriesSheet";
import { pushOverlay, popOverlay } from "../stores/backGestureStore";

interface Props {
  suppressHeaderVisibility?: (durationMs?: number) => void;
}

const NovelRecommendedFeed: Component<Props> = (props) => {
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

export default NovelRecommendedFeed;

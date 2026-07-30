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
  saveTabScroll,
  getFeedScrollY,
  novelFollowTab,
  setNovelFollowTab,
} from "../stores/novelFollowStore";
import { novelLayoutMode } from "../stores/settingsStore";
import NovelVirtualFeed from "../components/NovelVirtualFeed";
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
    setSheetSeries({ id: seriesId, title: novel.series.title, authorName: novel.user.name, authorId: novel.user.id });
    setSheetOpen(true);
  }

  createEffect(() => {
    if (sheetOpen()) {
      pushOverlay("seriesSheet", () => setSheetOpen(false));
      onCleanup(() => { popOverlay("seriesSheet"); });
    }
  });

  onMount(() => {
    void ensureLoaded();
  });

  onCleanup(() => {
    saveTabScroll("follow");
  });

  return (
    <>
      {/* ── 关注页三层过滤 ── */}
      <div class="surface-appbar px-4 pb-2">
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
                  novelFollowTab() === opt.key,
                "bg-transparent text-[var(--colorNeutralForeground2)]":
                  novelFollowTab() !== opt.key,
              }}
              onClick={() => {
                if (novelFollowTab() !== opt.key) {
                  saveTabScroll("follow");
                  setNovelFollowTab(opt.key);
                  props.suppressHeaderVisibility?.();
                  window.scrollTo(0, getFeedScrollY("follow"));
                }
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <NovelVirtualFeed
        novels={novels()}
        loading={loading() || refreshing()}
        error={error()}
        hasMore={nextUrl() !== null}
        onNovelClick={(id) => navigate(`/novel/${id}`)}
        onAuthorClick={(id) => navigate(`/user/${id}`)}
        onLoadMore={fetchMore}
        onRefresh={() => { refresh(); }}
        scrollKey="follow"
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

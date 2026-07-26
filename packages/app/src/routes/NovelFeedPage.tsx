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
} from "../stores/novelStore";
import { setCurrentTab } from "../stores/uiStore";
import type { Tab } from "../stores/uiStore";
import { novelLayoutMode } from "../stores/settingsStore";
import NovelVirtualFeed from "../components/NovelVirtualFeed";
import SeriesSheet from "../components/SeriesSheet";
import { pushOverlay, popOverlay } from "../stores/backGestureStore";

interface Props {
  tab: Tab;
  suppressHeaderVisibility?: (durationMs?: number) => void;
}

const NovelFeedPage: Component<Props> = (props) => {
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
    setCurrentTab(props.tab);
    void ensureLoaded();
  });

  onCleanup(() => {
    saveTabScroll(props.tab);
  });

  // Key changes when sub-tab or main tab changes, forcing clean remount
  // To prevent badge overlap from lingering absolutely-positioned cards
  const feedKey = () => `novel-feed-${props.tab}-${novelFollowTab()}`;

  return (
    <For each={[feedKey()]}>
      {(_k) => (
        <>
          {/* ── 关注页三层过滤 ── */}
          <Show when={props.tab === "follow"}>
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
                        saveTabScroll(props.tab);
                        setNovelFollowTab(opt.key);
                        props.suppressHeaderVisibility?.();
                        window.scrollTo(0, getFeedScrollY(props.tab));
                      }
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </Show>

          <NovelVirtualFeed
            novels={novels()}
            loading={loading() || refreshing()}
            error={error()}
            hasMore={nextUrl() !== null}
            onNovelClick={(id) => void navigate({ to: `/novel/${id}` })}
            onAuthorClick={(id) => void navigate({ to: `/user/${id}` })}
            onLoadMore={fetchMore}
            onRefresh={refresh}
            scrollKey={props.tab}
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
                onNovelSelect={(id) => void navigate({ to: `/novel/${id}` })}
              />
            )}
          </Show>
        </>
      )}
    </For>
  );
};

export default NovelFeedPage;

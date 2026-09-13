import type { Component } from "solid-js";
import { Show, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  DEFAULT_RANK_MODE,
  isDateString,
  jstToday,
  shiftDate,
  type RankModeId,
} from "@pictelio/ranking-core";
import { goBack } from "@/services/backTransitionService";
import PageTransition from "@/components/PageTransition";
import NavBar from "@/components/NavBar";
import { FeedList } from "@/components/home/FeedList";
import RankingControls from "@/components/ranking/RankingControls";
import RankingR18Notice from "@/components/ranking/RankingR18Notice";
import RankingRowCard, { rankingCover } from "@/components/ranking/RankingRowCard";
import RankingSkeleton from "@/components/ranking/RankingSkeleton";
import { shouldShowR18Notice } from "@/components/ranking/rankingNotice";
import { createRankingStore } from "@/stores/rankingStore";
import { createScrollBehavior } from "@/primitives/scroll/createScrollBehavior";
import { scrollToTop } from "@/utils/scrollToTop";
import { t } from "@/i18n";

/**
 * 榜单页 /ranking（spec docs/specs/ranking.md §5.3）。
 *
 * - 维度切换 + 日期回看（#515）：切换后 setQuery 换缓存键（各自读缓存、互不清空）
 * - 「今日」= date=null；显式选择等于今日的日期归一为 null（同请求同缓存键）
 * - R-18/R-18G 档空或报错 → 可操作指引（§5.7），不静默降级为空态
 * - 先渲染后加载：组件即时挂载渲染头部 + 控件 + 骨架，onSettled 才 ensureLoaded
 */

/** 显式等于今日的日期归一为 null（同请求同缓存键，§5.9） */
function normalizeDate(iso: string): string | null {
  return iso === jstToday() ? null : iso;
}

const Ranking: Component = () => {
  const navigate = useNavigate();
  const store = createRankingStore();
  const { visible: headerVisible } = createScrollBehavior();

  const [mode, setMode] = createSignal<RankModeId>(DEFAULT_RANK_MODE);
  const [date, setDate] = createSignal<string | null>(null);

  /** 切换后改缓存键并发起请求；旧键数据留在缓存，切回即命中 */
  const applyQuery = (next: { mode: RankModeId; date: string | null }) => {
    store.setQuery(next);
    void store.ensureLoaded();
  };

  const selectMode = (m: RankModeId) => {
    if (m === mode()) return;
    setMode(m);
    applyQuery({ mode: m, date: date() });
  };

  /** ‹ / ›：以当前日期（或今日）为基准，前进到今日即归一为 null；不越过今日 */
  const shiftDay = (delta: number) => {
    const today = jstToday();
    const next = shiftDate(date() ?? today, delta);
    if (next > today) return;
    const normalized = normalizeDate(next);
    setDate(normalized);
    applyQuery({ mode: mode(), date: normalized });
  };

  const pickDate = (iso: string) => {
    if (!isDateString(iso)) return;
    const today = jstToday();
    if (iso > today) return;
    const normalized = normalizeDate(iso);
    setDate(normalized);
    applyQuery({ mode: mode(), date: normalized });
  };

  /** R-18/R-18G 档且空/报错 → 指引（§5.7），替代普通空态/错误态 */
  const showR18Notice = () =>
    shouldShowR18Notice({
      mode: mode(),
      hasError: store.error() != null,
      paginationError: store.paginationError(),
      serverCount: store.serverCount(),
      loading: store.loading(),
    });

  onSettled(() => {
    void store.ensureLoaded();
  });

  return (
    <>
      <PageTransition>
        <div class="pb-16">
          <header
            class={[
              "surface-appbar sticky top-0 z-20 flex h-12 items-center gap-3 px-4 transition-transform duration-[var(--durationNormal)] ease-[var(--curveEasyEase)]",
              {
                "translate-y-0": headerVisible(),
                "-translate-y-full": !headerVisible(),
              },
            ]}
            onDblClick={scrollToTop}
          >
            <fluent-button
              appearance="subtle"
              aria-label={t("ranking.page.back")}
              class="h-10 w-10 min-w-10 p-0"
              ref={fluentOn("click", () => goBack())}
            >
              ←
            </fluent-button>
            <h1 class="truncate [font-size:var(--fontSizeBase400)] font-semibold leading-none tracking-tight text-[var(--colorNeutralForeground1)]">
              {t("ranking.page.title")}
            </h1>
          </header>

          <RankingControls
            mode={mode()}
            date={date()}
            onSelectMode={selectMode}
            onShiftDay={shiftDay}
            onPickDate={pickDate}
          />

          <Show
            when={showR18Notice()}
            fallback={
              <FeedList
                source={{
                  items: store.entries,
                  loading: store.loading,
                  refreshing: store.refreshing,
                  loadingMore: store.loadingMore,
                  nextUrl: store.nextUrl,
                  fetchMore: store.fetchMore,
                  refresh: store.refresh,
                  error: store.error,
                  paginationError: store.paginationError,
                }}
                containerClass="flex flex-col"
                refreshMode="indicator"
                // 预取 URL 复用 RankingRowCard 的 rankingCover（与卡片展示取值逐字一致，防漂移）
                prefetchUrl={(entry) => rankingCover(entry.illust)}
                renderItem={(entry) => (
                  <RankingRowCard
                    rank={entry.rank}
                    illust={entry.illust}
                    onClick={() => void navigate(`/illust/${entry.illust.id}`)}
                  />
                )}
                skeleton={() => <RankingSkeleton />}
                empty={() => (
                  <div class="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
                    <p class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground2)]">
                      {t("ranking.page.empty")}
                    </p>
                  </div>
                )}
              />
            }
          >
            <RankingR18Notice onRetry={() => void store.refresh()} />
          </Show>
        </div>
      </PageTransition>
      <NavBar />
    </>
  );
};

export default Ranking;

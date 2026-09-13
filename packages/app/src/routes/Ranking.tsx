import type { Component } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { goBack } from "@/services/backTransitionService";
import PageTransition from "@/components/PageTransition";
import NavBar from "@/components/NavBar";
import { FeedList } from "@/components/home/FeedList";
import RankingRowCard, { rankingCover } from "@/components/ranking/RankingRowCard";
import RankingSkeleton from "@/components/ranking/RankingSkeleton";
import { createRankingStore } from "@/stores/rankingStore";
import { createScrollBehavior } from "@/primitives/scroll/createScrollBehavior";
import { scrollToTop } from "@/utils/scrollToTop";
import { t } from "@/i18n";

/**
 * 榜单页 /ranking（spec docs/specs/ranking.md §5.3；#514 = 日榜·今日骨架）。
 *
 * 「先渲染、后加载」：组件即时挂载渲染头部 + 骨架，onSettled 才 ensureLoaded。
 * 数据层走单源分页（rankingStore），名次跨页连续且不因过滤重编号。
 * 列表页 header 走滚动驱动显隐（ADR-0012），与 UserIllusts/FollowListPage 同款。
 */
const Ranking: Component = () => {
  const navigate = useNavigate();
  const store = createRankingStore();
  const { visible: headerVisible } = createScrollBehavior();

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
        </div>
      </PageTransition>
      <NavBar />
    </>
  );
};

export default Ranking;

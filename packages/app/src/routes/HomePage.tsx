/**
 * HomePage — 首页（C 框架 + L5 固定布局，ADR-0075 / ticket #178）。
 *
 * 外壳：SideNavShell（左侧导航列 + 页面标题 + contentType 切换器 + 历史内建），
 * 本页只提供内容域面板（renderPanel 插槽）：
 *  - 插画：IllustSingleCard 单列大图列表 + 行卡骨架 + FeedPaginationSentinel 分页
 *  - 小说：NovelRowCard 单列行卡列表 + 行卡骨架 + 分页
 * 数据源按 Tab 映射到 6 个 feed store（recommended 用 ensureLoaded，
 * follow / bookmarks 用 activate；均为幂等激活），分页由 nextUrl + fetchMore 驱动。
 * 不再渲染底部 NavBar（首页导航由 SideNavShell 承担）。
 */
import type { Component } from "solid-js";
import { createEffect, For, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { PixivIllust, PixivNovel } from "@/api/types";
import PageTransition from "@/components/PageTransition";
import PullIndicator from "@/components/PullIndicator";
import { createPullToRefresh } from "@/primitives/createPullToRefresh";
import { markContentReady } from "@/native/splashBridge";
import SideNavShell, { type HomeTab } from "@/components/home/SideNavShell";
import IllustSingleCard from "@/components/home/IllustSingleCard";
import NovelRowCard from "@/components/home/NovelRowCard";
import FeedPaginationSentinel from "@/components/home/FeedPaginationSentinel";
import { contentType } from "@/stores/uiStore";
// ── 插画数据源（推荐/关注/收藏）──
import {
  illusts as recIllusts,
  loading as recIllustLoading,
  nextUrl as recIllustNextUrl,
  fetchMore as recIllustFetchMore,
  ensureLoaded as recIllustEnsure,
  refreshing as recIllustRefreshing,
  refresh as recIllustRefresh,
} from "@/stores/recommendedStore";
import {
  illusts as followIllusts,
  loading as followIllustLoading,
  nextUrl as followIllustNextUrl,
  fetchMore as followIllustFetchMore,
  activate as followIllustActivate,
  ensureLoaded as followIllustEnsure,
  refreshing as followIllustRefreshing,
  refresh as followIllustRefresh,
} from "@/stores/followStore";
import {
  illusts as bmkIllusts,
  loading as bmkIllustLoading,
  nextUrl as bmkIllustNextUrl,
  fetchMore as bmkIllustFetchMore,
  activate as bmkIllustActivate,
  ensureLoaded as bmkIllustEnsure,
  refreshing as bmkIllustRefreshing,
  refresh as bmkIllustRefresh,
} from "@/stores/bookmarkStore";
// ── 小说数据源（推荐/关注/收藏）──
import {
  novels as recNovels,
  loading as recNovelLoading,
  nextUrl as recNovelNextUrl,
  fetchMore as recNovelFetchMore,
  ensureLoaded as recNovelEnsure,
  refreshing as recNovelRefreshing,
  refresh as recNovelRefresh,
} from "@/stores/novelRecommendedStore";
import {
  novels as followNovels,
  loading as followNovelLoading,
  nextUrl as followNovelNextUrl,
  fetchMore as followNovelFetchMore,
  activate as followNovelActivate,
  ensureLoaded as followNovelEnsure,
  refreshing as followNovelRefreshing,
  refresh as followNovelRefresh,
} from "@/stores/novelFollowStore";
import {
  novels as bmkNovels,
  loading as bmkNovelLoading,
  nextUrl as bmkNovelNextUrl,
  fetchMore as bmkNovelFetchMore,
  activate as bmkNovelActivate,
  ensureLoaded as bmkNovelEnsure,
  refreshing as bmkNovelRefreshing,
  refresh as bmkNovelRefresh,
} from "@/stores/novelBookmarkStore";

/** renderPanel 实际调用的内容域 Tab（历史由 shell 内建，不进入面板）。 */
type FeedTab = Exclude<HomeTab, "history">;

/** feed store 数据源接口（items/loading/分页/刷新 + 激活）。 */
interface FeedSource<T> {
  items: () => T[];
  loading: () => boolean;
  nextUrl: () => string | null;
  fetchMore: () => Promise<unknown> | undefined;
  activate: (() => void) | null;
  ensure: (() => Promise<void>) | null;
  /** 是否正在刷新（store.refreshing，refetch 进行中）——下拉刷新遮罩用 */
  refreshing: () => boolean;
  /** 触发刷新（refetch 第一页）——下拉刷新 onRefresh 用 */
  refresh: () => Promise<unknown> | void;
}

/** 插画数据源映射（Tab → store；recommended 无 activate，用 ensureLoaded）。 */
function illustSource(tab: FeedTab): FeedSource<PixivIllust> {
  if (tab === "recommended") {
    return {
      items: recIllusts,
      loading: recIllustLoading,
      nextUrl: recIllustNextUrl,
      fetchMore: recIllustFetchMore,
      activate: null,
      ensure: recIllustEnsure,
      refreshing: recIllustRefreshing,
      refresh: recIllustRefresh,
    };
  }
  if (tab === "follow") {
    return {
      items: followIllusts,
      loading: followIllustLoading,
      nextUrl: followIllustNextUrl,
      fetchMore: followIllustFetchMore,
      activate: followIllustActivate,
      ensure: followIllustEnsure,
      refreshing: followIllustRefreshing,
      refresh: followIllustRefresh,
    };
  }
  return {
    items: bmkIllusts,
    loading: bmkIllustLoading,
    nextUrl: bmkIllustNextUrl,
    fetchMore: bmkIllustFetchMore,
    activate: bmkIllustActivate,
    ensure: bmkIllustEnsure,
    refreshing: bmkIllustRefreshing,
    refresh: bmkIllustRefresh,
  };
}

/** 小说数据源映射（Tab → store；recommended 无 activate，用 ensureLoaded）。 */
function novelSource(tab: FeedTab): FeedSource<PixivNovel> {
  if (tab === "recommended") {
    return {
      items: recNovels,
      loading: recNovelLoading,
      nextUrl: recNovelNextUrl,
      fetchMore: recNovelFetchMore,
      activate: null,
      ensure: recNovelEnsure,
      refreshing: recNovelRefreshing,
      refresh: recNovelRefresh,
    };
  }
  if (tab === "follow") {
    return {
      items: followNovels,
      loading: followNovelLoading,
      nextUrl: followNovelNextUrl,
      fetchMore: followNovelFetchMore,
      activate: followNovelActivate,
      ensure: followNovelEnsure,
      refreshing: followNovelRefreshing,
      refresh: followNovelRefresh,
    };
  }
  return {
    items: bmkNovels,
    loading: bmkNovelLoading,
    nextUrl: bmkNovelNextUrl,
    fetchMore: bmkNovelFetchMore,
    activate: bmkNovelActivate,
    ensure: bmkNovelEnsure,
    refreshing: bmkNovelRefreshing,
    refresh: bmkNovelRefresh,
  };
}

/** 幂等激活当前数据源：**ensureLoaded 是数据加载的唯一入口**（工厂 ADR-0042 按需查询，
 * query enabled 恒为 false）；activate 仅置订阅标志、不触发 fetch。三个源统一 ensureLoaded
 * （幂等，不重复请求）+ activate 保险（回归修复：收藏/关注 Tab 之前只 activate 不加载 → 空）。 */
function useFeedActivation(src: () => FeedSource<PixivIllust> | FeedSource<PixivNovel>): void {
  createEffect(() => {
    const s = src();
    void s.ensure?.();
    if (s.activate) {
      s.activate();
    }
  });
}

/** 插画列表加载骨架（行卡形态，参考原型 IllustLoadingA2，animate-pulse）。 */
const IllustRowSkeleton: Component = () => (
  <div class="flex flex-col gap-[var(--spacingVerticalM)] px-4 pt-3">
    {[0, 1, 2].map(() => (
      <div class="flex animate-pulse items-center gap-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusLarge)] border border-[var(--colorNeutralStroke1)] bg-[var(--colorNeutralBackground1)] p-[var(--spacingHorizontalM)]">
        <div class="h-10 w-10 flex-shrink-0 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)]" />
        <div class="flex flex-1 flex-col gap-1.5">
          <div class="h-3 w-3/4 rounded bg-[var(--colorNeutralBackground2)]" />
          <div class="h-2.5 w-1/2 rounded bg-[var(--colorNeutralBackground2)]" />
        </div>
      </div>
    ))}
  </div>
);

/** 小说列表加载骨架（行卡形态，参考原型 NovelLoadingA2，animate-pulse）。 */
const NovelRowSkeleton: Component = () => (
  <div class="flex flex-col gap-[var(--spacingVerticalM)] px-4 pt-3">
    {[0, 1, 2].map(() => (
      <div class="flex animate-pulse items-center gap-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusLarge)] border border-[var(--colorNeutralStroke1)] bg-[var(--colorNeutralBackground1)] p-[var(--spacingHorizontalM)]">
        <div class="h-14 w-14 flex-shrink-0 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)]" />
        <div class="flex flex-1 flex-col gap-1.5">
          <div class="h-3 w-3/4 rounded bg-[var(--colorNeutralBackground2)]" />
          <div class="h-2.5 w-1/2 rounded bg-[var(--colorNeutralBackground2)]" />
        </div>
      </div>
    ))}
  </div>
);

/** 空态提示（加载完成且无数据时展示）。 */
const EmptyHint: Component = () => (
  <div class="py-14 flex flex-col items-center gap-1">
    <p class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground2)]">暂无内容</p>
    <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
      换一个内容类型或稍后再来看看
    </p>
  </div>
);

/** 插画单列大图 Feed 面板（数据源激活 + 列表 + 骨架 + 滚动分页 + 下拉刷新，ADR-0076）。 */
const IllustFeedPanel: Component<{ tab: FeedTab }> = (props) => {
  const navigate = useNavigate();
  const src = () => illustSource(props.tab);
  useFeedActivation(src);
  const items = () => src().items();
  const loading = () => src().loading();
  const refreshing = () => src().refreshing();

  // 下拉刷新手势（A1：refreshing 期间骨架遮罩替换旧列表）
  const pull = createPullToRefresh({
    onRefresh: () => void src().refresh(),
    isRefreshing: refreshing,
  });

  return (
    <Show
      when={loading() && items().length === 0}
      fallback={
        <Show when={items().length > 0} fallback={<EmptyHint />}>
          <div
            class="flex flex-col"
            onTouchStart={pull.touchHandlers.onTouchStart}
            onTouchMove={pull.touchHandlers.onTouchMove}
            onTouchEnd={pull.touchHandlers.onTouchEnd}
          >
            <PullIndicator
              zone={pull.pullPhase()}
              distance={pull.pullDistance()}
              refreshThreshold={60}
              settingsThreshold={60}
            />
            {refreshing() ? (
              <IllustRowSkeleton />
            ) : (
              <>
                <div class="flex flex-col gap-[var(--spacingVerticalM)] px-4 pt-3">
                  <For each={items()}>
                    {(il) => (
                      <IllustSingleCard
                        illust={il}
                        onClick={() => void navigate(`/illust/${il.id}`)}
                      />
                    )}
                  </For>
                </div>
                <FeedPaginationSentinel
                  hasMore={() => !!src().nextUrl()}
                  loadMore={() => void src().fetchMore()}
                />
              </>
            )}
          </div>
        </Show>
      }
    >
      <IllustRowSkeleton />
    </Show>
  );
};

/** 小说单列行卡 Feed 面板（数据源激活 + 列表 + 骨架 + 滚动分页 + 下拉刷新，ADR-0076）。 */
const NovelFeedPanel: Component<{ tab: FeedTab }> = (props) => {
  const navigate = useNavigate();
  const src = () => novelSource(props.tab);
  useFeedActivation(src);
  const items = () => src().items();
  const loading = () => src().loading();
  const refreshing = () => src().refreshing();

  // 下拉刷新手势（A1：refreshing 期间骨架遮罩替换旧列表）
  const pull = createPullToRefresh({
    onRefresh: () => void src().refresh(),
    isRefreshing: refreshing,
  });

  return (
    <Show
      when={loading() && items().length === 0}
      fallback={
        <Show when={items().length > 0} fallback={<EmptyHint />}>
          <div
            class="flex flex-col"
            onTouchStart={pull.touchHandlers.onTouchStart}
            onTouchMove={pull.touchHandlers.onTouchMove}
            onTouchEnd={pull.touchHandlers.onTouchEnd}
          >
            <PullIndicator
              zone={pull.pullPhase()}
              distance={pull.pullDistance()}
              refreshThreshold={60}
              settingsThreshold={60}
            />
            {refreshing() ? (
              <NovelRowSkeleton />
            ) : (
              <>
                <div class="flex flex-col gap-[var(--spacingVerticalM)] px-4 pt-3">
                  <For each={items()}>
                    {(n) => (
                      <NovelRowCard novel={n} onClick={() => void navigate(`/novel/${n.id}`)} />
                    )}
                  </For>
                </div>
                <FeedPaginationSentinel
                  hasMore={() => !!src().nextUrl()}
                  loadMore={() => void src().fetchMore()}
                />
              </>
            )}
          </div>
        </Show>
      }
    >
      <NovelRowSkeleton />
    </Show>
  );
};

const HomePage: Component = () => {
  onMount(() => {
    // 首页是登录后启动首屏：挂载后通知原生关闭 Splash Screen（幂等）
    markContentReady();
  });

  return (
    <PageTransition>
      <SideNavShell
        renderPanel={(tab: HomeTab) => {
          // 历史 Tab 由 SideNavShell 内建，此处不会实际命中，仅类型收窄占位
          if (tab === "history") {
            return <></>;
          }
          return contentType() === "illust" ? (
            <IllustFeedPanel tab={tab} />
          ) : (
            <NovelFeedPanel tab={tab} />
          );
        }}
      />
    </PageTransition>
  );
};

export default HomePage;

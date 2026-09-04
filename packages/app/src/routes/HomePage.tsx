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
import { createEffect, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { PixivIllust, PixivNovel, ApiError } from "@/api/types";
import PageTransition from "@/components/PageTransition";
import { FeedList } from "@/components/home/FeedList";
import { markContentReady } from "@/native/splashBridge";
import SideNavShell, { type HomeTab } from "@/components/home/SideNavShell";
import IllustSingleCard from "@/components/home/IllustSingleCard";
import NovelRowCard from "@/components/home/NovelRowCard";
import { contentType } from "@/stores/uiStore";
// ── 插画数据源（推荐/关注/收藏）──
import {
  illusts as recIllusts,
  loading as recIllustLoading,
  nextUrl as recIllustNextUrl,
  fetchMore as recIllustFetchMore,
  ensureLoaded as recIllustEnsure,
  refreshing as recIllustRefreshing,
  loadingMore as recIllustLoadingMore,
  refresh as recIllustRefresh,
  error as recIllustError,
  paginationError as recIllustPaginationError,
} from "@/stores/recommendedStore";
import {
  illusts as followIllusts,
  loading as followIllustLoading,
  nextUrl as followIllustNextUrl,
  fetchMore as followIllustFetchMore,
  activate as followIllustActivate,
  ensureLoaded as followIllustEnsure,
  refreshing as followIllustRefreshing,
  loadingMore as followIllustLoadingMore,
  refresh as followIllustRefresh,
  error as followIllustError,
  paginationError as followIllustPaginationError,
} from "@/stores/followStore";
import {
  illusts as bmkIllusts,
  loading as bmkIllustLoading,
  nextUrl as bmkIllustNextUrl,
  fetchMore as bmkIllustFetchMore,
  activate as bmkIllustActivate,
  ensureLoaded as bmkIllustEnsure,
  refreshing as bmkIllustRefreshing,
  loadingMore as bmkIllustLoadingMore,
  refresh as bmkIllustRefresh,
  error as bmkIllustError,
  paginationError as bmkIllustPaginationError,
} from "@/stores/bookmarkStore";
// ── 小说数据源（推荐/关注/收藏）──
import {
  novels as recNovels,
  loading as recNovelLoading,
  nextUrl as recNovelNextUrl,
  fetchMore as recNovelFetchMore,
  ensureLoaded as recNovelEnsure,
  refreshing as recNovelRefreshing,
  loadingMore as recNovelLoadingMore,
  refresh as recNovelRefresh,
  error as recNovelError,
  paginationError as recNovelPaginationError,
} from "@/stores/novelRecommendedStore";
import {
  novels as followNovels,
  loading as followNovelLoading,
  nextUrl as followNovelNextUrl,
  fetchMore as followNovelFetchMore,
  activate as followNovelActivate,
  ensureLoaded as followNovelEnsure,
  refreshing as followNovelRefreshing,
  loadingMore as followNovelLoadingMore,
  refresh as followNovelRefresh,
  error as followNovelError,
  paginationError as followNovelPaginationError,
} from "@/stores/novelFollowStore";
import {
  novels as bmkNovels,
  loading as bmkNovelLoading,
  nextUrl as bmkNovelNextUrl,
  fetchMore as bmkNovelFetchMore,
  activate as bmkNovelActivate,
  ensureLoaded as bmkNovelEnsure,
  refreshing as bmkNovelRefreshing,
  loadingMore as bmkNovelLoadingMore,
  refresh as bmkNovelRefresh,
  error as bmkNovelError,
  paginationError as bmkNovelPaginationError,
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
  /** 是否正在分页追加（store.loadingMore，fetchNextPage）——底部加载指示用 */
  loadingMore: () => boolean;
  /** 触发刷新（refetch 第一页）——下拉刷新 onRefresh 用 */
  refresh: () => Promise<unknown> | void;
  /** 首载/分页错误（error 非空即失败） */
  error: () => ApiError | null;
  /** 分页失败标记（error 非空 + paginationError=true = 分页失败，保留列表、底部内联重试） */
  paginationError: () => boolean;
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
      loadingMore: recIllustLoadingMore,
      refresh: recIllustRefresh,
      error: recIllustError,
      paginationError: recIllustPaginationError,
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
      loadingMore: followIllustLoadingMore,
      refresh: followIllustRefresh,
      error: followIllustError,
      paginationError: followIllustPaginationError,
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
    loadingMore: bmkIllustLoadingMore,
    refresh: bmkIllustRefresh,
    error: bmkIllustError,
    paginationError: bmkIllustPaginationError,
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
      loadingMore: recNovelLoadingMore,
      refresh: recNovelRefresh,
      error: recNovelError,
      paginationError: recNovelPaginationError,
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
      loadingMore: followNovelLoadingMore,
      refresh: followNovelRefresh,
      error: followNovelError,
      paginationError: followNovelPaginationError,
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
    loadingMore: bmkNovelLoadingMore,
    refresh: bmkNovelRefresh,
    error: bmkNovelError,
    paginationError: bmkNovelPaginationError,
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

/** 插画单列大图 Feed 面板（数据源激活 + FeedList 统一交互：下拉刷新 A1 遮罩 + 滚动分页，ADR-0078）。 */
const IllustFeedPanel: Component<{ tab: FeedTab }> = (props) => {
  const navigate = useNavigate();
  const src = () => illustSource(props.tab);
  useFeedActivation(src);

  return (
    <FeedList
      source={{
        items: () => src().items(),
        loading: () => src().loading(),
        refreshing: () => src().refreshing(),
        loadingMore: () => src().loadingMore(),
        nextUrl: () => src().nextUrl(),
        fetchMore: () => src().fetchMore(),
        refresh: () => src().refresh(),
        error: () => src().error(),
        paginationError: () => src().paginationError(),
      }}
      containerClass="flex flex-col gap-[var(--spacingVerticalM)] px-4 pt-3"
      refreshMode="overlay"
      skeleton={() => <IllustRowSkeleton />}
      empty={() => <EmptyHint />}
      // 预取 URL 与 IllustSingleCard 的 cover() 取值保持一致（large 优先），确保预热 key = 展示 src
      prefetchUrl={(il) => il.image_urls.large ?? il.image_urls.medium}
      renderItem={(il) => (
        <IllustSingleCard illust={il} onClick={() => void navigate(`/illust/${il.id}`)} />
      )}
    />
  );
};

/** 小说单列行卡 Feed 面板（数据源激活 + FeedList 统一交互，ADR-0078）。 */
const NovelFeedPanel: Component<{ tab: FeedTab }> = (props) => {
  const navigate = useNavigate();
  const src = () => novelSource(props.tab);
  useFeedActivation(src);

  return (
    <FeedList
      source={{
        items: () => src().items(),
        loading: () => src().loading(),
        refreshing: () => src().refreshing(),
        loadingMore: () => src().loadingMore(),
        nextUrl: () => src().nextUrl(),
        fetchMore: () => src().fetchMore(),
        refresh: () => src().refresh(),
        error: () => src().error(),
        paginationError: () => src().paginationError(),
      }}
      containerClass="flex flex-col gap-[var(--spacingVerticalM)] px-4 pt-3"
      refreshMode="overlay"
      skeleton={() => <NovelRowSkeleton />}
      empty={() => <EmptyHint />}
      // 预取 URL 与 NovelRowCard 的 cover() 取值保持一致（large → medium → square_medium），确保预热 key = 展示 src
      prefetchUrl={(n) => n.image_urls.large ?? n.image_urls.medium ?? n.image_urls.square_medium}
      renderItem={(n) => <NovelRowCard novel={n} onClick={() => void navigate(`/novel/${n.id}`)} />}
    />
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

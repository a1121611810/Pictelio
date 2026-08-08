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
} from "@/stores/recommendedStore";
import {
  illusts as followIllusts,
  loading as followIllustLoading,
  nextUrl as followIllustNextUrl,
  fetchMore as followIllustFetchMore,
  activate as followIllustActivate,
} from "@/stores/followStore";
import {
  illusts as bmkIllusts,
  loading as bmkIllustLoading,
  nextUrl as bmkIllustNextUrl,
  fetchMore as bmkIllustFetchMore,
  activate as bmkIllustActivate,
} from "@/stores/bookmarkStore";
// ── 小说数据源（推荐/关注/收藏）──
import {
  novels as recNovels,
  loading as recNovelLoading,
  nextUrl as recNovelNextUrl,
  fetchMore as recNovelFetchMore,
  ensureLoaded as recNovelEnsure,
} from "@/stores/novelRecommendedStore";
import {
  novels as followNovels,
  loading as followNovelLoading,
  nextUrl as followNovelNextUrl,
  fetchMore as followNovelFetchMore,
  activate as followNovelActivate,
} from "@/stores/novelFollowStore";
import {
  novels as bmkNovels,
  loading as bmkNovelLoading,
  nextUrl as bmkNovelNextUrl,
  fetchMore as bmkNovelFetchMore,
  activate as bmkNovelActivate,
} from "@/stores/novelBookmarkStore";

/** renderPanel 实际调用的内容域 Tab（历史由 shell 内建，不进入面板）。 */
type FeedTab = Exclude<HomeTab, "history">;

/** feed store 数据源接口（items/loading/分页 + 激活）。 */
interface FeedSource<T> {
  items: () => T[];
  loading: () => boolean;
  nextUrl: () => string | null;
  fetchMore: () => Promise<unknown> | undefined;
  activate: (() => void) | null;
  ensure: (() => Promise<void>) | null;
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
    };
  }
  if (tab === "follow") {
    return {
      items: followIllusts,
      loading: followIllustLoading,
      nextUrl: followIllustNextUrl,
      fetchMore: followIllustFetchMore,
      activate: followIllustActivate,
      ensure: null,
    };
  }
  return {
    items: bmkIllusts,
    loading: bmkIllustLoading,
    nextUrl: bmkIllustNextUrl,
    fetchMore: bmkIllustFetchMore,
    activate: bmkIllustActivate,
    ensure: null,
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
    };
  }
  if (tab === "follow") {
    return {
      items: followNovels,
      loading: followNovelLoading,
      nextUrl: followNovelNextUrl,
      fetchMore: followNovelFetchMore,
      activate: followNovelActivate,
      ensure: null,
    };
  }
  return {
    items: bmkNovels,
    loading: bmkNovelLoading,
    nextUrl: bmkNovelNextUrl,
    fetchMore: bmkNovelFetchMore,
    activate: bmkNovelActivate,
    ensure: null,
  };
}

/** 幂等激活当前数据源（activate 或 ensureLoaded），源切换时自动重跑。 */
function useFeedActivation(src: () => FeedSource<PixivIllust> | FeedSource<PixivNovel>): void {
  createEffect(() => {
    const s = src();
    if (s.activate) {
      s.activate();
    } else {
      void s.ensure?.();
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

/** 插画单列大图 Feed 面板（数据源激活 + 列表 + 骨架 + 滚动分页）。 */
const IllustFeedPanel: Component<{ tab: FeedTab }> = (props) => {
  const navigate = useNavigate();
  const src = () => illustSource(props.tab);
  useFeedActivation(src);
  const items = () => src().items();
  const loading = () => src().loading();

  return (
    <Show
      when={loading() && items().length === 0}
      fallback={
        <Show when={items().length > 0} fallback={<EmptyHint />}>
          <>
            <div class="flex flex-col gap-[var(--spacingVerticalM)] px-4 pt-3">
              <For each={items()}>
                {(il) => (
                  <IllustSingleCard illust={il} onClick={() => void navigate(`/illust/${il.id}`)} />
                )}
              </For>
            </div>
            <FeedPaginationSentinel
              hasMore={() => !!src().nextUrl()}
              loadMore={() => void src().fetchMore()}
            />
          </>
        </Show>
      }
    >
      <IllustRowSkeleton />
    </Show>
  );
};

/** 小说单列行卡 Feed 面板（数据源激活 + 列表 + 骨架 + 滚动分页）。 */
const NovelFeedPanel: Component<{ tab: FeedTab }> = (props) => {
  const navigate = useNavigate();
  const src = () => novelSource(props.tab);
  useFeedActivation(src);
  const items = () => src().items();
  const loading = () => src().loading();

  return (
    <Show
      when={loading() && items().length === 0}
      fallback={
        <Show when={items().length > 0} fallback={<EmptyHint />}>
          <>
            <div class="flex flex-col gap-[var(--spacingVerticalM)] px-4 pt-3">
              <For each={items()}>
                {(n) => <NovelRowCard novel={n} onClick={() => void navigate(`/novel/${n.id}`)} />}
              </For>
            </div>
            <FeedPaginationSentinel
              hasMore={() => !!src().nextUrl()}
              loadMore={() => void src().fetchMore()}
            />
          </>
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

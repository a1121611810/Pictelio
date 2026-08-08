/**
 * /home 首页内容域 A2 统一 —— UI 原型共享组件。
 *
 * 三个变体（VariantA/B/C）切换于现有 /home 路由（?variant=）：
 *  - A 统一基线：现状结构（底部 NavBar + contentType 子 Tab）+ 小说/历史卡 A2 化
 *  - B 同屏分区：推荐/关注/收藏 Tab 内插画 + 小说两个 A2 区块同屏展示
 *  - C 顶栏 Tab：Tab 上移到顶部 A2 segmented，内容域整页切换
 * 共享的 A2 行卡/小说卡是正式组件（NovelCard/HistoryFeed）的 A2 视觉副本，
 * 仅用于原型展示，选定后折入正式组件（ADR-0073）。
 */
import type { Component, JSX } from "solid-js";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { PixivNovel, PixivIllust } from "@/api/types";
import { resolveImageUrl } from "@/utils/imageLoader";
import { scrollToTop } from "@/utils/scrollToTop";
import {
  historyCollection,
  historyVersion,
  clearAllHistory,
  type HistoryEntry,
} from "@/stores/historyStore";
import { user, isLoggedIn } from "@/stores/authStore";
import { contentType, setContentType } from "@/stores/uiStore";
import RecommendedFeed from "@/components/RecommendedFeed";
import FollowFeed from "@/components/FollowFeed";
import BookmarksFeed from "@/components/BookmarksFeed";
import UserAvatar from "@/components/UserAvatar";
import FluentIcon, { type FluentIconName } from "@/components/ui/FluentIcon";
import {
  novels as recNovels,
  ensureLoaded as recEnsure,
  loading as recLoading,
  nextUrl as recNextUrl,
  fetchMore as recFetchMore,
} from "@/stores/novelRecommendedStore";
import {
  novels as followNovels,
  activate as followActivate,
  loading as followLoading,
  nextUrl as followNextUrl,
  fetchMore as followFetchMore,
} from "@/stores/novelFollowStore";
import {
  novels as bmkNovels,
  activate as bmkActivate,
  loading as bmkLoading,
  nextUrl as bmkNextUrl,
  fetchMore as bmkFetchMore,
} from "@/stores/novelBookmarkStore";
import {
  illusts as recIllusts,
  loading as recIllustLoading,
  ensureLoaded as recIllustEnsure,
  nextUrl as recIllustNextUrl,
  fetchMore as recIllustFetchMore,
} from "@/stores/recommendedStore";
import {
  illusts as followIllusts,
  loading as followIllustLoading,
  activate as followIllustActivate,
  nextUrl as followIllustNextUrl,
  fetchMore as followIllustFetchMore,
} from "@/stores/followStore";
import {
  illusts as bmkIllusts,
  loading as bmkIllustLoading,
  activate as bmkIllustActivate,
  nextUrl as bmkIllustNextUrl,
  fetchMore as bmkIllustFetchMore,
} from "@/stores/bookmarkStore";

/** A2 插画/小说切换器（分段控件 4px，激活项浮起）。 */
export const ContentTypeToggleA2: Component = () => (
  <div class="flex items-center bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-0.5 gap-0.5">
    {(["illust", "novel"] as const).map((t) => (
      <button
        class="flex-1 px-3 py-1 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase100)] font-semibold transition-all active:scale-95 appearance-none border-none outline-none cursor-pointer"
        classList={{
          "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
            contentType() === t,
          "bg-transparent text-[var(--colorNeutralForeground2)]": contentType() !== t,
        }}
        onClick={() => setContentType(t)}
      >
        {t === "illust" ? "插画" : "小说"}
      </button>
    ))}
  </div>
);

/** 当前用户的历史记录（响应 historyVersion，按访问时间倒序）。 */
export function historyRows(): HistoryEntry[] {
  historyVersion[0]();
  const uid = String(user()?.id ?? "");
  return historyCollection.toArray
    .filter((e) => e.userId === uid)
    .toSorted((a, b) => b.visitedAt - a.visitedAt);
}

// ── Tab 与内容域插槽 ──

export type HomeTab = "recommended" | "follow" | "bookmarks" | "history";

/** Tab 面板容器：非激活时 display:none（保留 DOM/滚动位置，与正式 HomePage 语义一致）。 */
export const HomeTabPanel: Component<{ tab: HomeTab; active: boolean; children: JSX.Element }> = (
  props,
) => (
  <div style={{ display: props.active ? "block" : "none" }} data-tab={props.tab}>
    {props.children}
  </div>
);

/** 插画内容域插槽：按 Tab 渲染对应插画 Feed（均已 A2：image-card，ADR-0070）。 */
export const IllustFeedSlot: Component<{ tab: "recommended" | "follow" | "bookmarks" }> = (
  props,
) => {
  if (props.tab === "recommended") return <RecommendedFeed />;
  if (props.tab === "follow") return <FollowFeed />;
  return <BookmarksFeed />;
};

/** 小说数据源（按 Tab）：items/loading/分页 + 激活。 */
function novelSource(tab: "recommended" | "follow" | "bookmarks") {
  if (tab === "recommended")
    return {
      items: recNovels,
      loading: recLoading,
      nextUrl: recNextUrl,
      fetchMore: recFetchMore,
      activate: null,
      ensure: recEnsure,
    };
  if (tab === "follow")
    return {
      items: followNovels,
      loading: followLoading,
      nextUrl: followNextUrl,
      fetchMore: followFetchMore,
      activate: followActivate,
      ensure: null,
    };
  return {
    items: bmkNovels,
    loading: bmkLoading,
    nextUrl: bmkNextUrl,
    fetchMore: bmkFetchMore,
    activate: bmkActivate,
    ensure: null,
  };
}

/** 小说内容域插槽：按 Tab 渲染 A2 小说卡（grid 封面卡 / rows 行卡 / single 大封面卡），含加载态。 */
export const NovelFeedSlot: Component<{
  tab: "recommended" | "follow" | "bookmarks";
  limit?: number;
  /** rows = 单列行卡（窄内容区/列表场景）；single = 单列大封面卡；默认 grid 双列封面卡 */
  layout?: "grid" | "rows" | "single";
}> = (props) => {
  const navigate = useNavigate();
  const src = () => novelSource(props.tab);

  // 激活对应小说 store（activate/ensureLoaded 内部幂等）
  createEffect(() => {
    const s = src();
    if (s.activate) s.activate();
    else s.ensure?.();
  });

  const items = () =>
    src()
      .items()
      .slice(0, props.limit ?? src().items().length);
  const onOpen = (id: number) => void navigate(`/novel/${id}`);

  return (
    <Show when={!src().loading() || items().length > 0} fallback={<NovelLoadingA2 />}>
      <>
        {props.layout === "rows" ? (
          <NovelRowListA2 items={items()} onOpen={onOpen} />
        ) : props.layout === "single" ? (
          <div class="flex flex-col gap-[var(--spacingVerticalM)] px-4 pt-3">
            <For each={items()}>
              {(n) => <NovelCardA2 novel={n} onClick={() => onOpen(n.id)} />}
            </For>
          </div>
        ) : (
          <NovelCardListA2 items={items()} onOpen={onOpen} />
        )}
        <FeedPaginationSentinel
          hasMore={() => !!src().nextUrl()}
          loadMore={() => void src().fetchMore()}
        />
      </>
    </Show>
  );
};

/** 小说紧凑行列表（L4：与插画紧凑行统一列表感）。 */
export const NovelCompactList: Component<{ tab: "recommended" | "follow" | "bookmarks" }> = (
  props,
) => {
  const navigate = useNavigate();
  const src = () => novelSource(props.tab);

  createEffect(() => {
    const s = src();
    if (s.activate) s.activate();
    else s.ensure?.();
  });

  const items = () => src().items();
  return (
    <Show when={!src().loading() || items().length > 0} fallback={<NovelLoadingA2 />}>
      <>
        <div class="flex flex-col gap-[var(--spacingVerticalM)] px-4 pt-3">
          <For each={items()}>
            {(n) => <NovelCompactRowA2 novel={n} onClick={() => void navigate(`/novel/${n.id}`)} />}
          </For>
        </div>
        <FeedPaginationSentinel
          hasMore={() => !!src().nextUrl()}
          loadMore={() => void src().fetchMore()}
        />
      </>
    </Show>
  );
};

/** 小说域加载骨架（行卡形态，animate-pulse）。 */
export const NovelLoadingA2: Component = () => (
  <div class="flex flex-col gap-[var(--spacingVerticalM)]">
    {[0, 1, 2].map((_i) => (
      <div class="rounded-[var(--borderRadiusLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] p-[var(--spacingHorizontalM)] flex items-center gap-[var(--spacingHorizontalM)] animate-pulse">
        <div class="w-14 h-14 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)]" />
        <div class="flex-1 flex flex-col gap-1.5">
          <div class="h-3 w-3/4 rounded bg-[var(--colorNeutralBackground2)]" />
          <div class="h-2.5 w-1/2 rounded bg-[var(--colorNeutralBackground2)]" />
        </div>
      </div>
    ))}
  </div>
);

/** A2 分区卡（VariantB 用）：区块容器 + 标题，内部承载单个内容域。 */
export const SectionCardA2: Component<{ title: string; children: JSX.Element }> = (props) => (
  <div class="rounded-[var(--borderRadiusXLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] p-[var(--spacingHorizontalL)]">
    <p class="mb-[var(--spacingVerticalM)] [font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground2)]">
      {props.title}
    </p>
    {props.children}
  </div>
);

/** A2 小说卡（正式 NovelCard 的 A2 视觉副本：8px 圆角 + 1px 边框 + 无阴影）。 */
export const NovelCardA2: Component<{ novel: PixivNovel; onClick: () => void }> = (props) => {
  const cover = () =>
    props.novel.image_urls.large ??
    props.novel.image_urls.medium ??
    props.novel.image_urls.square_medium;
  return (
    <div
      class="rounded-[var(--borderRadiusXLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] overflow-hidden cursor-pointer active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onClick();
      }}
    >
      <div class="relative aspect-[16/10] bg-[var(--colorNeutralBackground2)]">
        <img
          src={cover()}
          alt={props.novel.title}
          class="w-full h-full object-cover"
          loading="lazy"
        />
        <Show when={props.novel.series}>
          <span class="absolute top-2 left-2 px-1.5 py-0.5 rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase100)] font-semibold text-[var(--colorNeutralForegroundOnBrand)] bg-[var(--colorBrandBackground)]">
            系列
          </span>
        </Show>
      </div>
      <div class="px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalL)] flex flex-col gap-1">
        <p class="truncate [font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] leading-[var(--lineHeightBase300)]">
          {props.novel.title}
        </p>
        <p class="truncate [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]">
          {props.novel.user.name}
        </p>
        <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
          ★{props.novel.total_bookmarks.toLocaleString()} ·{" "}
          {(props.novel.text_length / 1000).toFixed(1)}k 字
        </p>
      </div>
    </div>
  );
};

/** A2 小说卡列表。 */
export const NovelCardListA2: Component<{
  items: PixivNovel[];
  onOpen: (id: number) => void;
}> = (props) => (
  <div class="grid grid-cols-2 gap-[var(--spacingVerticalM)]">
    <For each={props.items}>
      {(n) => <NovelCardA2 novel={n} onClick={() => props.onOpen(n.id)} />}
    </For>
  </div>
);

/** A2 小说行卡（单列，窄内容区/列表场景：左封面缩略 + 右信息）。 */
export const NovelRowA2: Component<{ novel: PixivNovel; onClick: () => void }> = (props) => {
  const cover = () =>
    props.novel.image_urls.large ??
    props.novel.image_urls.medium ??
    props.novel.image_urls.square_medium;
  return (
    <div
      class="rounded-[var(--borderRadiusLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] flex items-center gap-[var(--spacingHorizontalM)] p-[var(--spacingHorizontalM)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] cursor-pointer transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onClick();
      }}
    >
      <div class="relative flex-shrink-0 w-14 h-14 rounded-[var(--borderRadiusMedium)] overflow-hidden bg-[var(--colorNeutralBackground2)]">
        <img
          src={cover()}
          alt={props.novel.title}
          class="w-full h-full object-cover"
          loading="lazy"
        />
        <Show when={props.novel.series}>
          <span
            class="absolute top-[1px] left-[1px] px-[3px] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase100)] font-bold"
            style={{
              background: "var(--colorBrandBackground)",
              color: "var(--colorNeutralForegroundOnBrand)",
            }}
          >
            系列
          </span>
        </Show>
      </div>
      <div class="flex-1 min-w-0">
        <p class="truncate [font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] leading-[var(--lineHeightBase300)]">
          {props.novel.title}
        </p>
        <p class="mt-0.5 truncate [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]">
          {props.novel.user.name}
        </p>
        <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
          ★{props.novel.total_bookmarks.toLocaleString()} ·{" "}
          {(props.novel.text_length / 1000).toFixed(1)}k 字
        </p>
      </div>
    </div>
  );
};

/** A2 小说行卡列表（单列）。 */
export const NovelRowListA2: Component<{
  items: PixivNovel[];
  onOpen: (id: number) => void;
}> = (props) => (
  <div class="flex flex-col gap-[var(--spacingVerticalM)]">
    <For each={props.items}>
      {(n) => <NovelRowA2 novel={n} onClick={() => props.onOpen(n.id)} />}
    </For>
  </div>
);

/** A2 历史条目行卡（正式 HistoryFeed 条目的 A2 视觉副本：8px 圆角 + 1px 边框 + 无阴影）。 */
export const HistoryRowA2: Component<{
  entry: HistoryEntry;
  onOpen: () => void;
  onDelete: () => void;
}> = (props) => {
  const hideByR18 = props.entry.xRestrict === 1 || props.entry.xRestrict === 2;
  const time = () => {
    const d = new Date(props.entry.visitedAt);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  return (
    <div
      class="rounded-[var(--borderRadiusLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] flex items-center gap-[var(--spacingHorizontalM)] p-[var(--spacingHorizontalM)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] cursor-pointer transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onOpen();
      }}
    >
      <div
        class="relative flex-shrink-0 w-10 h-10 rounded-[var(--borderRadiusMedium)] overflow-hidden"
        style={{ background: "var(--colorNeutralBackground2)" }}
      >
        <img
          src={resolveImageUrl(props.entry.thumbnailUrl)}
          alt={props.entry.title}
          class={`w-full h-full object-cover ${hideByR18 ? "filter blur-[8px]" : ""}`}
        />
        {hideByR18 && (
          <span
            class="absolute top-[1px] left-[1px] px-[3px] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase100)] font-bold"
            style={{
              background: "var(--colorStatusDangerBackground2)",
              color: "var(--colorStatusDangerForeground1)",
            }}
          >
            {props.entry.xRestrict === 2 ? "R18G" : "R-18"}
          </span>
        )}
      </div>
      <div class="flex-1 min-w-0">
        <p class="truncate [font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)] leading-[var(--lineHeightBase300)]">
          {props.entry.title}
        </p>
        <p class="mt-0.5 truncate [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
          {props.entry.userName} · {time()} · {props.entry.visitCount}次
        </p>
      </div>
      <button
        class="w-8 h-8 flex items-center justify-center rounded-[var(--borderRadiusMedium)] text-[var(--colorNeutralForeground3)] hover:bg-[var(--colorNeutralBackground2)] hover:text-[var(--colorNeutralForeground1)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          props.onDelete();
        }}
        aria-label={`删除 ${props.entry.title}`}
      >
        ✕
      </button>
    </div>
  );
};

/** 历史 A2 列表（含空态）。 */
export const HistoryListA2: Component<{ onOpen: (type: string, id: number) => void }> = (props) => {
  const rows = () => historyRows();
  return (
    <Show
      when={rows().length > 0}
      fallback={
        <div class="py-16 flex flex-col items-center gap-2">
          <p class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground2)]">
            暂无浏览记录
          </p>
          <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
            浏览过的作品会出现在这里
          </p>
        </div>
      }
    >
      <div class="flex flex-col gap-[var(--spacingVerticalM)]">
        <For each={rows()}>
          {(e) => (
            <HistoryRowA2
              entry={e}
              onOpen={() => props.onOpen(e.type, e.id)}
              onDelete={() => {
                void import("@/stores/historyStore").then((m) => m.removeHistoryEntry(e.key));
              }}
            />
          )}
        </For>
      </div>
    </Show>
  );
};

// ═══════════════════════════════════════════════════════════════
// ── C 框架侧边导航 Shell（用户选定 C 方案，布局变体共享外壳）──
// ═══════════════════════════════════════════════════════════════

const SHELL_TABS: { key: HomeTab; label: string; icon: FluentIconName }[] = [
  { key: "recommended", label: "推荐", icon: "home" },
  { key: "follow", label: "关注", icon: "people" },
  { key: "bookmarks", label: "收藏", icon: "bookmark" },
  { key: "history", label: "历史", icon: "history" },
];

/** 插画数据源（按 Tab）：items/loading/分页 + 激活（activate 或 ensureLoaded）。 */
function illSource(tab: "recommended" | "follow" | "bookmarks") {
  if (tab === "recommended")
    return {
      items: recIllusts,
      loading: recIllustLoading,
      nextUrl: recIllustNextUrl,
      fetchMore: recIllustFetchMore,
      activate: null,
      ensure: recIllustEnsure,
    };
  if (tab === "follow")
    return {
      items: followIllusts,
      loading: followIllustLoading,
      nextUrl: followIllustNextUrl,
      fetchMore: followIllustFetchMore,
      activate: followIllustActivate,
      ensure: null,
    };
  return {
    items: bmkIllusts,
    loading: bmkIllustLoading,
    nextUrl: bmkIllustNextUrl,
    fetchMore: bmkIllustFetchMore,
    activate: bmkIllustActivate,
    ensure: null,
  };
}

/** 底部滚动分页哨兵：进入视口且还有下一页时触发 loadMore。 */
export const FeedPaginationSentinel: Component<{
  hasMore: () => boolean;
  loadMore: () => void;
}> = (props) => {
  let ref: HTMLDivElement | undefined;
  onMount(() => {
    const el = ref;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && props.hasMore()) props.loadMore();
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    onCleanup(() => io.disconnect());
  });
  return (
    <div
      ref={(el) => {
        ref = el;
      }}
      class="h-1"
    />
  );
};

/** C 框架外壳：左侧导航列 + 页面标题 + contentType + 历史内建；内容槽由 renderPanel 提供。 */
export const SideNavShell: Component<{ renderPanel: (tab: HomeTab) => JSX.Element }> = (props) => {
  const navigate = useNavigate();
  const [tab, setTab] = createSignal<HomeTab>("recommended");

  onMount(() => {
    scrollToTop();
  });

  return (
    <div class="flex min-h-screen bg-[var(--colorNeutralBackground2)] pb-6">
      {/* ── 左侧导航列（Win11 设置式）── */}
      <nav
        class="sticky top-0 h-screen w-14 flex-none flex flex-col items-center pt-3 gap-1"
        aria-label="主导航"
      >
        <button
          class="w-11 h-11 flex items-center justify-center rounded-[var(--borderRadiusMedium)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground2)] hover:text-[var(--colorNeutralForeground1)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer mb-2"
          onClick={() => void navigate("/search")}
          aria-label="搜索"
        >
          <FluentIcon name="search" />
        </button>
        {SHELL_TABS.map((t) => (
          <button
            class="w-11 h-11 flex items-center justify-center rounded-[var(--borderRadiusMedium)] transition-all active:scale-95 appearance-none border-none outline-none cursor-pointer"
            classList={{
              "bg-[var(--colorBrandBackground2)] text-[var(--colorBrandForeground1)]":
                tab() === t.key,
              "text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground1Hover)]":
                tab() !== t.key,
            }}
            onClick={() => setTab(t.key)}
            aria-current={tab() === t.key ? "page" : undefined}
            aria-label={t.label}
          >
            <FluentIcon name={t.icon} active={tab() === t.key} />
          </button>
        ))}
        <div class="flex-1" />
        <button
          class="w-11 h-11 flex items-center justify-center rounded-[var(--borderRadiusMedium)] text-[var(--colorNeutralForeground2)] hover:bg-[var(--colorNeutralBackground1Hover)] hover:text-[var(--colorNeutralForeground1)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
          onClick={() => void navigate("/settings")}
          aria-label="设置"
        >
          <FluentIcon name="settings" />
        </button>
        <button
          class="w-11 h-11 flex items-center justify-center rounded-[var(--borderRadiusMedium)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer mb-3"
          onClick={() => isLoggedIn() && navigate("/me")}
          aria-label="我的"
        >
          <UserAvatar />
        </button>
      </nav>

      {/* ── 右侧内容区 ── */}
      <div class="flex-1 min-w-0">
        <div class="sticky top-0 z-20 bg-[var(--colorNeutralBackground2)] px-4 pt-4 pb-2 flex items-end justify-between gap-3">
          <div class="min-w-0">
            <h1 class="[font-size:var(--fontSizeBase500)] font-semibold text-[var(--colorNeutralForeground1)] tracking-tight leading-tight">
              {SHELL_TABS.find((t) => t.key === tab())?.label}
            </h1>
            <p class="mt-0.5 truncate [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
              <Show when={isLoggedIn() && user()} fallback={<>Pictelio</>}>
                {user()!.name} 的首页
              </Show>
            </p>
          </div>
          <Show when={tab() !== "history"}>
            <div class="flex-none w-36">
              <ContentTypeToggleA2 />
            </div>
          </Show>
        </div>

        <Show
          when={tab() !== "history"}
          fallback={
            <div class="px-4 pt-2">
              <div class="flex items-center justify-between px-1 pb-2">
                <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                  浏览历史
                </span>
                <button
                  class="px-2 py-1 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)] font-medium text-[var(--colorDangerForeground)] hover:bg-[var(--colorDangerBackground)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
                  onClick={() => void clearAllHistory()}
                  aria-label="清空浏览历史"
                >
                  清空
                </button>
              </div>
              <Suspense fallback={null}>
                <HistoryListA2
                  onOpen={(type, id) =>
                    void navigate(type === "illust" ? `/illust/${id}` : `/novel/${id}`)
                  }
                />
              </Suspense>
            </div>
          }
        >
          {props.renderPanel(tab())}
        </Show>
      </div>
    </div>
  );
};

/** 激活插画 store 的通用 effect（activate 或 ensureLoaded）。 */
export function useIllustSource(tab: "recommended" | "follow" | "bookmarks") {
  const src = () => illSource(tab);
  createEffect(() => {
    const s = src();
    if (s.activate) s.activate();
    else s.ensure?.();
  });
  return { src };
}

/** 插画双列网格卡（固定 3:4 封面 + 信息）。 */
export const IllustGridCardA2: Component<{ illust: PixivIllust; onClick: () => void }> = (
  props,
) => {
  const cover = () => props.illust.image_urls.medium ?? props.illust.image_urls.large;
  return (
    <div
      class="rounded-[var(--borderRadiusXLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] overflow-hidden cursor-pointer active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)]"
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onClick();
      }}
    >
      <div class="relative aspect-[3/4] bg-[var(--colorNeutralBackground2)]">
        <img
          src={cover()}
          alt={props.illust.title}
          class="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      <div class="px-[var(--spacingHorizontalM)] py-[var(--spacingVerticalS)]">
        <p class="truncate [font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground1)]">
          {props.illust.title}
        </p>
        <p class="truncate [font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground2)]">
          {props.illust.user.name}
        </p>
      </div>
    </div>
  );
};

/** 插画单列大图卡（16:10 全宽 + 信息）。 */
export const IllustSingleCardA2: Component<{ illust: PixivIllust; onClick: () => void }> = (
  props,
) => {
  const cover = () => props.illust.image_urls.large ?? props.illust.image_urls.medium;
  return (
    <div
      class="rounded-[var(--borderRadiusXLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] overflow-hidden cursor-pointer active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)]"
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onClick();
      }}
    >
      <div class="relative aspect-[16/10] bg-[var(--colorNeutralBackground2)]">
        <img
          src={cover()}
          alt={props.illust.title}
          class="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      <div class="px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalM)] flex items-center justify-between gap-2">
        <div class="min-w-0">
          <p class="truncate [font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)]">
            {props.illust.title}
          </p>
          <p class="truncate [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)]">
            {props.illust.user.name}
          </p>
        </div>
        <p class="flex-none [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
          ★{props.illust.total_bookmarks.toLocaleString()}
        </p>
      </div>
    </div>
  );
};

/** 插画紧凑行卡（40px 缩略 + 信息，列表感）。 */
export const IllustRowA2: Component<{ illust: PixivIllust; onClick: () => void }> = (props) => {
  const cover = () => props.illust.image_urls.square_medium ?? props.illust.image_urls.medium;
  return (
    <div
      class="rounded-[var(--borderRadiusLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] flex items-center gap-[var(--spacingHorizontalM)] p-[var(--spacingHorizontalM)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] cursor-pointer transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)]"
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onClick();
      }}
    >
      <div class="relative flex-shrink-0 w-10 h-10 rounded-[var(--borderRadiusMedium)] overflow-hidden bg-[var(--colorNeutralBackground2)]">
        <img
          src={cover()}
          alt={props.illust.title}
          class="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      <div class="flex-1 min-w-0">
        <p class="truncate [font-size:var(--fontSizeBase200)] font-medium text-[var(--colorNeutralForeground1)]">
          {props.illust.title}
        </p>
        <p class="truncate [font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)]">
          {props.illust.user.name} · ★{props.illust.total_bookmarks.toLocaleString()}
        </p>
      </div>
    </div>
  );
};

/** 小说紧凑行卡（L4 与插画统一列表感）。 */
export const NovelCompactRowA2: Component<{ novel: PixivNovel; onClick: () => void }> = (props) => {
  const cover = () =>
    props.novel.image_urls.large ??
    props.novel.image_urls.medium ??
    props.novel.image_urls.square_medium;
  return (
    <div
      class="rounded-[var(--borderRadiusLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] flex items-center gap-[var(--spacingHorizontalM)] p-[var(--spacingHorizontalM)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] cursor-pointer transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)]"
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onClick();
      }}
    >
      <div class="relative flex-shrink-0 w-10 h-10 rounded-[var(--borderRadiusMedium)] overflow-hidden bg-[var(--colorNeutralBackground2)]">
        <img
          src={cover()}
          alt={props.novel.title}
          class="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
      <div class="flex-1 min-w-0">
        <p class="truncate [font-size:var(--fontSizeBase200)] font-medium text-[var(--colorNeutralForeground1)]">
          {props.novel.title}
        </p>
        <p class="truncate [font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)]">
          {props.novel.user.name} · ★{props.novel.total_bookmarks.toLocaleString()}
        </p>
      </div>
    </div>
  );
};

/** 插画布局：双列网格。 */
export const IllustLayoutGrid: Component<{ tab: "recommended" | "follow" | "bookmarks" }> = (
  props,
) => {
  const navigate = useNavigate();
  const { src } = useIllustSource(props.tab);
  const items = () => src().items();
  return (
    <Show when={!src().loading() || items().length > 0} fallback={<IllustLoadingA2 />}>
      <div class="grid grid-cols-2 gap-[var(--spacingVerticalM)] px-3 pt-3">
        <For each={items()}>
          {(il) => (
            <IllustGridCardA2 illust={il} onClick={() => void navigate(`/illust/${il.id}`)} />
          )}
        </For>
      </div>
    </Show>
  );
};

/** 插画布局：单列大图。 */
export const IllustLayoutSingle: Component<{ tab: "recommended" | "follow" | "bookmarks" }> = (
  props,
) => {
  const navigate = useNavigate();
  const { src } = useIllustSource(props.tab);
  const items = () => src().items();
  return (
    <Show when={!src().loading() || items().length > 0} fallback={<IllustLoadingA2 />}>
      <>
        <div class="flex flex-col gap-[var(--spacingVerticalM)] px-4 pt-3">
          <For each={items()}>
            {(il) => (
              <IllustSingleCardA2 illust={il} onClick={() => void navigate(`/illust/${il.id}`)} />
            )}
          </For>
        </div>
        <FeedPaginationSentinel
          hasMore={() => !!src().nextUrl()}
          loadMore={() => void src().fetchMore()}
        />
      </>
    </Show>
  );
};

/** 插画布局：紧凑行列表。 */
export const IllustLayoutRows: Component<{ tab: "recommended" | "follow" | "bookmarks" }> = (
  props,
) => {
  const navigate = useNavigate();
  const { src } = useIllustSource(props.tab);
  const items = () => src().items();
  return (
    <Show when={!src().loading() || items().length > 0} fallback={<IllustLoadingA2 />}>
      <div class="flex flex-col gap-[var(--spacingVerticalM)] px-4 pt-3">
        <For each={items()}>
          {(il) => <IllustRowA2 illust={il} onClick={() => void navigate(`/illust/${il.id}`)} />}
        </For>
      </div>
    </Show>
  );
};

/** 插画布局加载骨架（行卡形态）。 */
export const IllustLoadingA2: Component = () => (
  <div class="flex flex-col gap-[var(--spacingVerticalM)] px-4 pt-3">
    {[0, 1, 2].map((_i) => (
      <div class="rounded-[var(--borderRadiusLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] p-[var(--spacingHorizontalM)] flex items-center gap-[var(--spacingHorizontalM)] animate-pulse">
        <div class="w-10 h-10 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)]" />
        <div class="flex-1 flex flex-col gap-1.5">
          <div class="h-3 w-3/4 rounded bg-[var(--colorNeutralBackground2)]" />
          <div class="h-2.5 w-1/2 rounded bg-[var(--colorNeutralBackground2)]" />
        </div>
      </div>
    ))}
  </div>
);

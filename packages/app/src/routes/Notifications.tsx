import type { Component } from "solid-js";
import { For, Show, createEffect, createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { goBack } from "@/services/backTransitionService";
import PageTransition from "@/components/PageTransition";
import NavBar from "@/components/NavBar";
import SkeletonShimmer from "@/components/SkeletonShimmer";
import { FeedList } from "@/components/home/FeedList";
import FeedPaginationSentinel from "@/components/home/FeedPaginationSentinel";
import InlineRetryBar from "@/components/ui/InlineRetryBar";
import FluentIcon from "@/components/ui/FluentIcon";
import {
  buildNotificationRows,
  createNotificationChildrenStore,
  createNotificationsListStore,
  notifyListLoaded,
  type NotificationRow,
} from "@/stores/notificationStore";
import { notificationPlainText } from "@/utils/notificationText";
import { openNotificationTarget } from "@/utils/notificationTarget";
import { resolveImageUrl } from "@/utils/imageLoader";
import { formatRelativeTime } from "@/utils/dateFormat";
import { createDeferredMount } from "@/primitives/createDeferredMount";
import { t } from "@/i18n";
import type { PixivNotificationItem } from "@/api/types";

/**
 * 通知中心页 /notifications（ADR-0188 / spec docs/specs/notification-center.md）。
 *
 * - 数据层：createNotificationsListStore（useInfiniteQuery，next_url 透传分页）；
 *   列表拉取**成功后**推进设备级已读时间戳（notifyListLoaded，失败不推进，spec 边界 10）
 * - 行模型：buildNotificationRows——组头行（view_more 非空）点击就地插入子列表区
 *   （独立 query 键 + older_than 游标分页，展开单向不收起，spec 边界 9）
 * - 行点击：openNotificationTarget 路由解析（pixiv:// 三 scheme 端内 / http(s) 外链 /
 *   其它 scheme 静默忽略）
 * - 页面骨架对齐 Ranking.tsx 姿态：NavBar + 骨架/空态/错误重试 + 滚动分页（先渲染后加载）
 */

// ─── 缩略图：经 /pixiv-img/ 代理重写通道（禁直连 pximg CDN 域）───
// left_image（内容缩略图）优先，left_icon（公共图标）兜底；加载失败 → 隐藏图区
// （不占位、不重试风暴，spec 边界 5）——失败态在行组件实例内收敛。

/** 行缩略图原始 URL（content 缺失 / 两图字段皆空 → 空串 = 无图区） */
function rowThumbUrl(item: PixivNotificationItem): string {
  return item.content?.left_image || item.content?.left_icon || "";
}

/** 单个行缩略图（onError 一次即隐藏，img 不重试；keyed 复用由 Solid For 承担） */
const RowThumb: Component<{ item: PixivNotificationItem }> = (props) => {
  const [failed, setFailed] = createSignal(false);
  const url = () => resolveImageUrl(rowThumbUrl(props.item));
  return (
    <Show when={!failed() && url() !== ""}>
      <img
        src={url()}
        alt=""
        loading="lazy"
        decoding="async"
        class="h-12 w-12 flex-none rounded-[var(--borderRadiusMedium)] object-cover"
        onError={() => setFailed(true)}
      />
    </Show>
  );
};

// ─── 行文案与可达性 ───

/** 行主体文本：组头显示组标题；普通行显示剥 HTML 后的纯文本；content 缺失渲染占位（spec 边界 2） */
function rowBodyText(row: NotificationRow): string {
  if (row.kind === "header") return row.item.view_more?.title ?? "";
  return notificationPlainText(row.item.content?.text) || t("notifications.noContent");
}

/** 行可达性标签：打开语义 + 未读/已读（服务端只读字段作标注，未读推导不消费）+ 主体文本 */
function rowA11yLabel(row: NotificationRow): string {
  const state = row.item.is_read ? t("notifications.a11y.read") : t("notifications.a11y.unread");
  return `${t("notifications.a11y.openItem")} ${state} ${rowBodyText(row)}`;
}

/** 行内共同布局（缩略图 + 两行文本 + 相对时间）；组头附 chevron 展开指示 */
const NotificationRowView: Component<{
  row: NotificationRow;
  onOpen: (row: NotificationRow) => void;
}> = (props) => {
  return (
    <button
      type="button"
      class="flex w-full cursor-pointer appearance-none items-center gap-[var(--spacingHorizontalM)] border-none border-b border-[var(--colorNeutralStroke2)] bg-transparent px-[var(--spacingHorizontalM)] py-[var(--spacingVerticalS)] text-left outline-none transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--colorStrokeFocus2)]"
      onClick={() => props.onOpen(props.row)}
      aria-label={rowA11yLabel(props.row)}
    >
      <RowThumb item={props.row.item} />
      <div class="min-w-0 flex-1">
        <p class="line-clamp-2 m-0 [font-size:var(--fontSizeBase200)] leading-snug text-[var(--colorNeutralForeground1)]">
          {rowBodyText(props.row)}
        </p>
        <span class="mt-1 block [font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)]">
          {formatRelativeTime(props.row.item.created_datetime)}
        </span>
      </div>
      <Show when={props.row.kind === "header"}>
        <span class="flex-none text-[var(--colorNeutralForeground3)]">
          <FluentIcon name="chevronRight" size={16} />
        </span>
      </Show>
    </button>
  );
};

// ─── 组头摊平子列表区（就地插入；每展开组头一个实例，独立 query + older_than 游标）───

const NotificationChildrenSection: Component<{
  headerId: number;
  onOpenItem: (item: PixivNotificationItem) => void;
}> = (props) => {
  const store = createNotificationChildrenStore(props.headerId);
  return (
    <div class="bg-[var(--colorNeutralBackground1)] px-[var(--spacingHorizontalM)] py-2">
      <Show
        when={!store.loading() || store.items().length > 0}
        fallback={
          <div class="flex justify-center py-3">
            <span class="spinner h-5 w-5" />
          </div>
        }
      >
        <div class="ml-8 flex flex-col">
          <For each={store.items()}>
            {(item) => (
              <button
                type="button"
                class="flex w-full cursor-pointer appearance-none items-center gap-2 border-none border-b border-[var(--colorNeutralStroke2)] bg-transparent px-1 py-2 text-left outline-none transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--colorStrokeFocus2)]"
                onClick={() => props.onOpenItem(item)}
                aria-label={`${t("notifications.a11y.openItem")} ${
                  notificationPlainText(item.content?.text) || t("notifications.noContent")
                }`}
              >
                <RowThumb item={item} />
                <div class="min-w-0 flex-1">
                  <p class="line-clamp-2 m-0 [font-size:var(--fontSizeBase200)] leading-snug text-[var(--colorNeutralForeground2)]">
                    {notificationPlainText(item.content?.text) || t("notifications.noContent")}
                  </p>
                  <span class="mt-1 block [font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)]">
                    {formatRelativeTime(item.created_datetime)}
                  </span>
                </div>
              </button>
            )}
          </For>
        </div>
        {/* 子列表错误：保留已加载条目，内联重试（只重试失败页） */}
        <Show when={store.error() != null && store.items().length > 0}>
          <InlineRetryBar onRetry={() => void store.fetchMore()} />
        </Show>
        {/* 子列表分页：older_than 游标滚动续拉（next_url null = 尽头，哨兵隐藏） */}
        <FeedPaginationSentinel
          hasMore={() => store.nextUrl() != null}
          loadMore={() => void store.fetchMore()}
        />
        <Show when={store.loadingMore()}>
          <div class="flex justify-center py-2">
            <span class="spinner h-5 w-5" />
          </div>
        </Show>
      </Show>
    </div>
  );
};

// ─── 通知页主体 ───

const NotificationsInner: Component = () => {
  const navigate = useNavigate();
  const store = createNotificationsListStore();
  // 组头展开注册表（单向不收起：只增不减，spec 边界 9）
  const [expanded, setExpanded] = createSignal<Record<number, boolean>>({});

  /** 分页 accumulate + 组头就地插入（store 纯函数，测试钉住顺序语义） */
  const rows = () => buildNotificationRows(store.items(), expanded());

  // 已读推进（ADR-0188 D5 / spec 边界 10）：任一次拉取落定（loading true→false）且无错误
  // 才推进；失败不推进，保证未读不丢。Solid 2.0 拆分：compute 读快照、apply 做副作用。
  createEffect(
    () => store.loading(),
    (loading, prevLoading) => {
      if (prevLoading === true && loading === false && store.error() == null) {
        notifyListLoaded(true);
      }
    },
  );

  /** 行点击统一入口：组头展开（单向）；其余走 target_url 解析（ignore 静默，不抛错） */
  const openRow = (row: NotificationRow) => {
    if (row.kind === "children") return;
    if (row.kind === "header") {
      const id = row.item.id;
      setExpanded((prev) => ({ ...prev, [id]: true }));
      return;
    }
    openNotificationTarget(row.item.target_url, (path) => void navigate(path));
  };

  return (
    <>
      <PageTransition>
        <div class="pb-16">
          <header class="surface-appbar sticky top-0 z-20 flex h-12 items-center gap-3 px-4">
            <fluent-button
              appearance="subtle"
              aria-label={t("notifications.page.back")}
              class="h-10 w-10 min-w-10 p-0"
              ref={fluentOn("click", () => goBack())}
            >
              ←
            </fluent-button>
            <h1 class="truncate [font-size:var(--fontSizeBase400)] font-semibold leading-none tracking-tight text-[var(--colorNeutralForeground1)]">
              {t("notifications.page.title")}
            </h1>
          </header>

          <FeedList
            source={{
              items: rows,
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
            renderItem={(row) =>
              // children 行 = 展开后的组头子列表区（就地插入；独立 query + older_than 游标）
              row.kind === "children" && row.headerId !== undefined ? (
                <NotificationChildrenSection
                  headerId={row.headerId}
                  onOpenItem={(item) =>
                    openNotificationTarget(item.target_url, (path) => void navigate(path))
                  }
                />
              ) : (
                <NotificationRowView row={row} onOpen={openRow} />
              )
            }
            skeleton={() => (
              <div class="flex flex-col" aria-hidden="true">
                <For each={Array.from({ length: 8 })}>
                  {() => (
                    <div class="flex items-center gap-[var(--spacingHorizontalM)] border-b border-[var(--colorNeutralStroke2)] px-[var(--spacingHorizontalM)] py-[var(--spacingVerticalS)]">
                      <SkeletonShimmer class="h-12 w-12 flex-none rounded-[var(--borderRadiusMedium)]" />
                      <div class="flex min-w-0 flex-1 flex-col gap-2">
                        <SkeletonShimmer class="h-4 w-3/4 rounded-[var(--borderRadiusSmall)]" />
                        <SkeletonShimmer class="h-3 w-1/3 rounded-[var(--borderRadiusSmall)]" />
                      </div>
                    </div>
                  )}
                </For>
              </div>
            )}
            empty={() => (
              <div class="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center">
                <p class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground2)]">
                  {t("notifications.empty")}
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

/**
 * 路由出口：延迟到宿主提交后挂载通知页主体（createDeferredMount，Ranking 同款）。
 * 主体内的 createNotificationsListStore 会构造 v6 查询并读取其投影，若在路由过渡中
 * 执行会令过渡永不提交；过渡期间的呈现由 PageTransition 承担（先渲染后加载）。
 */
const Notifications: Component = () => {
  const ready = createDeferredMount();
  return (
    <Show when={ready()}>
      <NotificationsInner />
    </Show>
  );
};

export default Notifications;

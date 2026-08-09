import type { JSX } from "solid-js";
import { For, Show } from "solid-js";
import { createPullToRefresh } from "@/primitives/createPullToRefresh";
import PullIndicator from "@/components/PullIndicator";
import FeedPaginationSentinel from "@/components/home/FeedPaginationSentinel";

/**
 * 统一 Feed 列表容器（ADR-0078）——深模块：小接口（source + 布局 + 渲染回调）背后
 * 收敛全部列表交互：
 * - 下拉刷新（createPullToRefresh + PullIndicator；overlay 模式 = A1 骨架遮罩）
 * - 滚动分页（FeedPaginationSentinel + loadingMore 底部指示）
 * - 首载骨架 / 空态 / 列表渲染
 *
 * 状态语义（工厂已分离）：refreshing = 仅 refetch 第一页（下拉刷新）；
 * loadingMore = 分页追加（fetchNextPage）——分页加载绝不触发骨架遮罩。
 */

export interface FeedListSource<T> {
  items: () => T[];
  /** 首载中（items 空时显示骨架） */
  loading: () => boolean;
  /** 下拉刷新 refetch 中 */
  refreshing: () => boolean;
  /** 分页追加中（fetchNextPage） */
  loadingMore: () => boolean;
  nextUrl: () => string | null;
  fetchMore: () => Promise<unknown> | undefined;
  refresh: () => Promise<unknown> | void;
}

export interface FeedListProps<T> {
  source: FeedListSource<T>;
  /** 布局容器 class（single=单列大图 / rows=单列行卡，由调用方传容器样式） */
  containerClass: string;
  /** 下拉反馈：overlay = A1 骨架遮罩（首页）；indicator = PullIndicator 指示器（列表页） */
  refreshMode?: "overlay" | "indicator";
  renderItem: (item: T) => JSX.Element;
  skeleton: () => JSX.Element;
  empty?: () => JSX.Element;
}

export function FeedList<T>(props: FeedListProps<T>): JSX.Element {
  // 注意：source 必须通过 props.source 响应式访问（tab 切换时父组件传新 source 对象）
  const refreshMode = props.refreshMode ?? "overlay";

  const pull = createPullToRefresh({
    onRefresh: () => void props.source.refresh(),
    isRefreshing: props.source.refreshing,
  });

  const items = () => props.source.items();

  const list = () => (
    <>
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
        {refreshMode === "overlay" && pull.pullPhase() === "refreshing" ? (
          props.skeleton()
        ) : (
          <div class={props.containerClass}>
            <For each={items()}>{(item) => props.renderItem(item)}</For>
          </div>
        )}
        <FeedPaginationSentinel
          hasMore={() => !!props.source.nextUrl()}
          loadMore={() => void props.source.fetchMore()}
        />
        <Show when={props.source.loadingMore()}>
          <div class="flex justify-center py-[var(--spacingVerticalM)]">
            <span class="[font-size:var(--fontSizeBase100)] text-[var(--colorNeutralForeground3)]">
              加载中…
            </span>
          </div>
        </Show>
      </div>
    </>
  );

  return (
    <Show
      when={props.source.loading() && items().length === 0}
      fallback={
        <Show
          when={items().length > 0 || pull.pullPhase() === "refreshing"}
          fallback={props.empty?.() ?? null}
        >
          {list()}
        </Show>
      }
    >
      {props.skeleton()}
    </Show>
  );
}

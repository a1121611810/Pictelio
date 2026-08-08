/**
 * FeedPaginationSentinel — 滚动分页哨兵（首页 L5 布局正式版）。
 *
 * 1px 高的不可见哨兵 div，通过 IntersectionObserver（rootMargin 300px 提前预热）
 * 在进入视口且 hasMore() 为真时触发 loadMore()；组件卸载时 disconnect 清理。
 * 使用原生 IntersectionObserver，无第三方依赖。
 */
import type { Component } from "solid-js";
import { onCleanup, onMount } from "solid-js";

interface FeedPaginationSentinelProps {
  /** 是否还有下一页（响应式判断） */
  hasMore: () => boolean;
  /** 加载下一页回调 */
  loadMore: () => void;
}

const FeedPaginationSentinel: Component<FeedPaginationSentinelProps> = (props) => {
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
      class="h-px"
      aria-hidden="true"
    />
  );
};

export default FeedPaginationSentinel;

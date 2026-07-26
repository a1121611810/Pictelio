import type { Accessor } from "solid-js";
import { createIntersectionObserver } from "@solid-primitives/intersection-observer";
import { SENTINEL_MARGIN } from "../rootMargins";

export interface SentinelOptions {
  /** IntersectionObserver rootMargin，默认 {@link SENTINEL_MARGIN} */
  rootMargin?: string;
  /**
   * 指定局部滚动容器作为 IntersectionObserver 的 root。
   * 未传时默认以浏览器视口为 root。
   */
  root?: Accessor<HTMLElement | null>;
  /**
   * 是否允许触发分页。通常传 `() => hasMore && !loading` 作为阀门。
   */
  enabled?: Accessor<boolean>;
  /**
   * 哨兵进入视口时调用。
   */
  onTrigger: () => void;
}

/**
 * 哨兵分页原语：封装 IntersectionObserver 驱动的“加载更多”模式。
 *
 * 基于 `@solid-primitives/intersection-observer` 的 `createIntersectionObserver`：
 * - 当不指定 `root` 时，在 primitive 顶层创建 observer，库内部自动完成 observe/unobserve 与 disconnect。
 * - 当指定 `root` 时，在 `createEffect` 中创建 observer，从而响应式跟踪 `root` 信号变化；
 *   `root` 为 null 时不创建 observer，变为非 null 时自动创建；root 变化时旧 observer 被 disconnect。
 *
 * 与一次性可见性的区别：不 disconnect，每次进入视口都触发 onTrigger（受 enabled 阀门控制）。
 *
 * 用法：
 * ```ts
 * const { attach } = createSentinel({
 *   rootMargin: "200px",
 *   enabled: () => hasMore() && !loading(),
 *   onTrigger: () => loadMore(),
 * });
 *
 * return <div ref={attach} class="h-1" />;
 * ```
 */
export function createSentinel(options: SentinelOptions) {
  const [el, setEl] = createSignal<HTMLElement>();

  function handleEntries(entries: IntersectionObserverEntry[]) {
    if (entries.some((entry) => entry.isIntersecting) && (!options.enabled || options.enabled())) {
      options.onTrigger();
    }
  }

  const elements = createMemo(() => (el() ? [el()!] : []));

  if (options.root) {
    createEffect(() => {
      const root = options.root!();
      if (!root) {
        return;
      }
      createIntersectionObserver(elements, handleEntries, {
        rootMargin: options.rootMargin ?? SENTINEL_MARGIN,
        root,
      });
    });
  } else {
    createIntersectionObserver(elements, handleEntries, {
      rootMargin: options.rootMargin ?? SENTINEL_MARGIN,
    });
  }

  return { attach: setEl };
}

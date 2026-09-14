import type { Accessor } from "solid-js";
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
 * 基于 2.0 拆分效应（compute 提取 root/元素快照 → apply 创建原生 IntersectionObserver）：
 * - 当不指定 `root` 时，以浏览器视口为 root，元素挂载后自动 observe，作用域销毁时 disconnect。
 * - 当指定 `root` 时，响应式跟踪 `root` 信号变化：`root` 为 null 时不创建 observer，
 *   变为非 null 时自动创建；root 或元素变化时旧 observer 经 apply cleanup 被 disconnect。
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

  // @solid-primitives/intersection-observer 3.0 移除回调式 API，这里直接创建原生
  // IntersectionObserver：root/元素变化或作用域销毁时经 apply 返回的 cleanup 断开旧实例。
  const hasRoot = options.root != null;

  createEffect(
    () => ({ root: options.root?.() ?? null, el: el() }),
    ({ root, el: current }) => {
      if (hasRoot && !root) {
        return;
      }
      if (!current) {
        return;
      }
      const io = new IntersectionObserver(handleEntries, {
        rootMargin: options.rootMargin ?? SENTINEL_MARGIN,
        root: hasRoot ? root : undefined,
      });
      io.observe(current);
      return () => io.disconnect();
    },
  );

  return { attach: setEl };
}

import type { Accessor } from "solid-js";
import { createIntersectionObserver } from "@solid-primitives/intersection-observer";
import { LAZY_LOAD_MARGIN } from "../rootMargins";

export interface EverVisibleOptions {
  /** IntersectionObserver rootMargin，默认 {@link LAZY_LOAD_MARGIN} */
  rootMargin?: string;
  /**
   * 为 true 时不创建 IntersectionObserver。
   * 用于父组件已通过其他信号知道元素可见、无需再监听的情况。
   */
  skipObserver?: boolean;
  /** 初始可见状态，默认 false */
  initialVisible?: boolean;
  /**
   * 外部可见性信号。返回 true 时立即标记为可见，不依赖 IntersectionObserver。
   * 常用于父组件已有滚动位置/页码信号的场景。
   */
  externalVisible?: Accessor<boolean>;
}

/**
 * 一次性可见性原语：元素首次进入视口后，返回的 signal 永久为 true。
 *
 * 基于 `createVisibilityObserver` + `withOccurrence` 修饰器，
 * 精确区分 Entering / Inside / Leaving / Outside，避免手动维护上一次可见状态。
 *
 * 支持两种额外触发方式（可组合）：
 *   - `initialVisible`: 初始状态即为可见
 *   - `externalVisible`: 外部信号驱动，为 true 时立即标记为可见
 *
 * 用法：
 * ```ts
 * const [ref, setRef] = createSignal<HTMLDivElement>();
 * const everVisible = createEverVisible({ rootMargin: "100px" })(() => ref());
 *
 * return <div ref={setRef}>{everVisible() ? <Content /> : <Skeleton />}</div>;
 * ```
 */
export function createEverVisible(options: EverVisibleOptions = {}) {
  const [everVisible, setEverVisible] = createSignal(options.initialVisible ?? false);

  createEffect(() => {
    if (options.externalVisible?.() && !everVisible()) {
      setEverVisible(true);
    }
  });

  const [el, setEl] = createSignal<HTMLElement>();
  const elements = createMemo(() => (el() ? [el()!] : []));

  onMount(() => {
    if (options.skipObserver || everVisible()) {
      return;
    }

    createIntersectionObserver(
      elements,
      ([entry], observer) => {
        if (entry?.isIntersecting) {
          setEverVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: options.rootMargin ?? LAZY_LOAD_MARGIN },
    );
  });

  return (ref: Accessor<HTMLElement | undefined>) => {
    createEffect(() => setEl(ref()));
    return everVisible;
  };
}

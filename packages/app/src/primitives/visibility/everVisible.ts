import type { Accessor } from "solid-js";
import { createVisibilityObserver } from "@solid-primitives/intersection-observer";
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
 * 基于 `createVisibilityObserver`（元素响应式注册/注销，observer 生命周期由库托管），
 * 首次可见后经闩锁效应永久置位，避免反复翻转。
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

  // 外部信号闩锁：externalVisible 为 true 时永久置位
  // （2.0 拆分效应：compute 只读，写移入 apply 段——write-under-scope 禁令）
  createEffect(
    () => Boolean(options.externalVisible?.()) && !everVisible(),
    (needLatch) => {
      if (needLatch) setEverVisible(true);
    },
  );

  const [el, setEl] = createSignal<HTMLElement>();

  // skipObserver：父组件已通过其他信号知道元素可见，不创建 IntersectionObserver
  const ioVisible: Accessor<boolean> = options.skipObserver
    ? () => false
    : createVisibilityObserver(el, {
        rootMargin: options.rootMargin ?? LAZY_LOAD_MARGIN,
        // 初始 false（不抛 NotReadyError），进入视口后由下方闩锁效应永久置位
        initialValue: false,
      });

  // IO 首次可见 → 永久闩锁（一次性可见性语义）
  createEffect(
    () => !everVisible() && ioVisible(),
    (hit) => {
      if (hit) setEverVisible(true);
    },
  );

  return (ref: Accessor<HTMLElement | undefined>) => {
    // 2.0 拆分效应：写 signal 移入 apply 段（apply 需返回 void/cleanup，不能透传 setEl 返回值）
    createEffect(
      () => ref(),
      (value) => {
        setEl(value);
      },
    );
    return everVisible;
  };
}

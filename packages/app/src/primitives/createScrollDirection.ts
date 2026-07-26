import { createScrollPosition } from "@solid-primitives/scroll";

export type ScrollDirection = "up" | "down" | null;

export interface ScrollDirectionOptions {
  /** 判定方向的最小位移（px），默认 4 */
  threshold?: number;
  /** 同向累计模式：反向滚动抵消累计，须持续同向滚过 threshold 才触发（NovelDetail footer 语义），默认 false */
  accumulate?: boolean;
  /** 单次位移超过此值视为程序性跳变，丢弃不计（px），默认 200 */
  jumpThreshold?: number;
}

/**
 * 滚动方向原语：输出最近一次有效滚动的方向。
 *
 * 方向驱动的 UI 显隐（NavBar compact、Search compact header、NovelDetail footer）
 * 由站点 policy effect 组合本原语与 createScrolledPast 实现
 * （见 docs/adr/0013-scroll-primitives-unification.md）。
 * reset() 用于 Tab 切换 / 小说切换等上下文变更后重置基准位置。
 */
export function createScrollDirection(options?: ScrollDirectionOptions) {
  const threshold = options?.threshold ?? 4;
  const accumulate = options?.accumulate ?? false;
  const jumpThreshold = options?.jumpThreshold ?? 200;

  const [direction, setDirection] = createSignal<ScrollDirection>(null);
  const scroll = createScrollPosition();
  let lastY = scroll.y;
  let accumulatedDelta = 0;

  createEffect(() => {
    const y = scroll.y;
    const delta = y - lastY;
    lastY = y;

    if (Math.abs(delta) > jumpThreshold) {
      accumulatedDelta = 0;
      return;
    }

    if (accumulate) {
      accumulatedDelta += delta;
      if (accumulatedDelta >= threshold) {
        setDirection("down");
        accumulatedDelta = 0;
      } else if (accumulatedDelta <= -threshold) {
        setDirection("up");
        accumulatedDelta = 0;
      }
      return;
    }

    if (delta >= threshold) {
      setDirection("down");
    } else if (delta <= -threshold) {
      setDirection("up");
    }
  });

  function reset() {
    lastY = scroll.y;
    accumulatedDelta = 0;
  }

  return { direction, reset };
}

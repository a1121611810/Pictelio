import { createScrollPosition } from "@solid-primitives/scroll";
import { debounce } from "@solid-primitives/scheduled";

export interface ScrollDrivenVisibilityOptions {
  /** 判定滚动方向的最小位移（px），默认 4 */
  directionThreshold?: number;
  /** 滚动停止判定窗口（ms），默认 250 */
  idleDelay?: number;
  /** 顶部保护区高度（px），scrollY 小于此值时恒显示，默认 48 */
  topGuard?: number;
}

/**
 * 滚动驱动显隐原语：列表页 header 的统一显隐机制。
 *
 * 规则（见 docs/adr/0012-scroll-driven-header-visibility.md）：
 *   向下滑动隐藏，向上滑动显示，滚动停止 idleDelay 后重现；
 *   scrollY 处于顶部保护区时恒显示；
 *   suppress(ms) 在程序性滚动期间暂停方向判定，避免恢复闪烁。
 */
export function createScrollDrivenVisibility(options?: ScrollDrivenVisibilityOptions) {
  const directionThreshold = options?.directionThreshold ?? 4;
  const idleDelay = options?.idleDelay ?? 250;
  const topGuard = options?.topGuard ?? 48;

  const [visible, setVisible] = createSignal(true);
  const scroll = createScrollPosition();
  let lastY = scroll.y;
  let suppressUntil = 0;

  const idleReappear = debounce(() => setVisible(true), idleDelay);

  createEffect(() => {
    const y = scroll.y;
    const delta = y - lastY;
    lastY = y;

    idleReappear();

    if (y < topGuard) {
      setVisible(true);
      return;
    }
    if (Date.now() < suppressUntil) return;
    if (Math.abs(delta) < directionThreshold) return;
    setVisible(delta < 0);
  });

  function suppress(
    // 默认时长 600ms：覆盖首次数据到达后 scroll 事件的延迟
    durationMs = 600,
  ) {
    suppressUntil = Date.now() + durationMs;
  }

  return { visible, suppress };
}

import type { Accessor } from "solid-js";

/**
 * Tracks container element width via ResizeObserver.
 * Returns the element's clientWidth as a signal.
 */
export function useContainerWidth(): {
  width: Accessor<number>;
  ref: (el: HTMLDivElement) => void;
} {
  const [width, setWidth] = createSignal(0);

  // 守卫：非有限/负值不写入（NaN 会穿透 recalc 的 w<=0 守卫导致 visible=0 只显示 +N）
  const setW = (v: number) => {
    if (Number.isFinite(v) && v >= 0) setWidth(v);
  };

  function ref(el: HTMLDivElement) {
    if (!el) {
      return;
    }
    // 初始值使用 contentRect.width 相同的口径（excludes padding）
    const cs = getComputedStyle(el);
    const paddingH = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    setW(el.clientWidth - paddingH);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setW(entry.contentRect.width);
      }
    });
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  }

  return { width, ref };
}

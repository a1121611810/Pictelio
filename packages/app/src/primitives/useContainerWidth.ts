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

  function ref(el: HTMLDivElement) {
    if (!el) {
      return;
    }
    // 初始值使用 contentRect.width 相同的口径（excludes padding）
    const cs = getComputedStyle(el);
    const paddingH = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    setWidth(el.clientWidth - paddingH);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  }

  return { width, ref };
}

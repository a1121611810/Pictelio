import { createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";

/**
 * 指针跟随高光 + prefers-reduced-motion 原语（ADR-0044）。
 *
 * GlassTabBar（capsule 形态）与 NavBar 共用同一套指针高光逻辑：
 * - 监听胶囊容器 pointermove/pointerleave，更新 --glass-hx/--glass-hy 渐变中心；
 * - prefers-reduced-motion: reduce 时关闭高光层（不渲染 + 不更新坐标）。
 * 提取为共享 hook，避免两处 25 行重复实现漂移。
 */
export function usePointerHighlight() {
  const [pointer, setPointer] = createSignal<{ x: number; y: number } | null>(null);
  const [reducedMotion, setReducedMotion] = createSignal(false);

  onMount(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    onCleanup(() => mq.removeEventListener("change", update));
  });

  function onPointerMove(e: PointerEvent) {
    if (reducedMotion()) {
      return;
    }
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    setPointer({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  function onPointerLeave() {
    setPointer(null);
  }

  /** 高光层内联样式（--glass-hx/--glass-hy + opacity） */
  const highlightStyle = () =>
    ({
      "--glass-hx": `${pointer()?.x ?? 0}px`,
      "--glass-hy": `${pointer()?.y ?? 0}px`,
      opacity: pointer() ? "1" : "0",
    }) as JSX.CSSProperties;

  return { pointer, reducedMotion, onPointerMove, onPointerLeave, highlightStyle };
}

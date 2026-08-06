import type { Component, JSX } from "solid-js";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";

export interface GlassTabItem {
  key: string;
  label: string;
}

export type GlassTabVariant = "capsule" | "segmented";

interface GlassTabBarProps {
  items: GlassTabItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  variant?: GlassTabVariant;
  disabled?: boolean;
  ariaLabel?: string;
  class?: string;
}

/**
 * 玻璃 Tab 控件（ADR-0044）：磨砂玻璃容器 + 顶部内高光 + 激活项浮起玻璃胶囊。
 * capsule 形态额外带指针跟随高光层；prefers-reduced-motion 下不渲染高光层（无动效）。
 */
const GlassTabBar: Component<GlassTabBarProps> = (props) => {
  const isCapsule = () => props.variant !== "segmented";
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

  function handlePointerMove(e: PointerEvent) {
    if (reducedMotion()) {
      return;
    }
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    setPointer({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  return (
    <div
      role="tablist"
      aria-label={props.ariaLabel}
      class={`${isCapsule() ? "glass-tab-bar-capsule" : "glass-tab-bar-segmented"} ${props.class ?? ""}`}
      onPointerMove={isCapsule() ? handlePointerMove : undefined}
      onPointerLeave={isCapsule() ? () => setPointer(null) : undefined}
    >
      <Show when={isCapsule() && !reducedMotion()}>
        <span
          class="glass-tab-highlight"
          aria-hidden="true"
          style={
            {
              "--glass-hx": `${pointer()?.x ?? 0}px`,
              "--glass-hy": `${pointer()?.y ?? 0}px`,
              opacity: pointer() ? "1" : "0",
            } as JSX.CSSProperties
          }
        />
      </Show>
      <span class="glass-tab-bar-highlight" aria-hidden="true" />
      <For each={props.items}>
        {(item) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.activeKey === item.key}
            aria-current={props.activeKey === item.key ? "page" : undefined}
            class={`glass-tab-item ${props.activeKey === item.key ? "glass-tab-item-active" : ""} ${
              isCapsule() ? "min-w-14" : "flex-1"
            }`}
            disabled={props.disabled}
            onClick={() => props.onSelect(item.key)}
          >
            {item.label}
          </button>
        )}
      </For>
    </div>
  );
};

export default GlassTabBar;

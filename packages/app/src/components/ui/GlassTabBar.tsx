import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import { usePointerHighlight } from "@/primitives/usePointerHighlight";

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
 *
 * ARIA：role=tablist + roving tabindex（仅激活项可聚焦）+ 方向键切换
 * （ArrowLeft/ArrowRight，wrap 到两端时停止），aria-selected 标识激活态。
 */
const GlassTabBar: Component<GlassTabBarProps> = (props) => {
  const isCapsule = () => props.variant !== "segmented";
  const { reducedMotion, onPointerMove, onPointerLeave, highlightStyle } = usePointerHighlight();

  /** 方向键切换（roving tabindex 配套；disabled 时禁用手势） */
  function handleKeyDown(e: KeyboardEvent) {
    if (props.disabled) {
      return;
    }
    const idx = props.items.findIndex((i) => i.key === props.activeKey);
    if (idx < 0) {
      return;
    }
    let next = idx;
    if (e.key === "ArrowRight") {
      next = Math.min(idx + 1, props.items.length - 1);
    } else if (e.key === "ArrowLeft") {
      next = Math.max(idx - 1, 0);
    } else {
      return;
    }
    if (next === idx) {
      return; // 已到端点，不重复触发
    }
    e.preventDefault();
    props.onSelect(props.items[next].key);
  }

  return (
    <div
      role="tablist"
      aria-label={props.ariaLabel}
      class={`${isCapsule() ? "glass-tab-bar-capsule" : "glass-tab-bar-segmented"} ${props.class ?? ""}`}
      onPointerMove={isCapsule() ? onPointerMove : undefined}
      onPointerLeave={isCapsule() ? onPointerLeave : undefined}
      onKeyDown={handleKeyDown}
    >
      <Show when={isCapsule() && !reducedMotion()}>
        <span class="glass-tab-highlight" aria-hidden="true" style={highlightStyle()} />
      </Show>
      <span class="glass-tab-bar-highlight" aria-hidden="true" />
      <For each={props.items}>
        {(item) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.activeKey === item.key}
            tabIndex={props.activeKey === item.key ? 0 : -1}
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

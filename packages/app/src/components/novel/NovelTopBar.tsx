import type { Component, JSX } from "solid-js";
import { Show } from "solid-js";
import FluentIcon from "../ui/FluentIcon";

interface NovelTopBarProps {
  title: string;
  /** 滚动后标题是否显示（NovelDetail 的 showHeaderTitle） */
  showTitle: () => boolean;
  searchOpen: () => boolean;
  onBack: () => void;
  onOpenSearch: () => void;
  onDoubleClick?: () => void;
  /** 搜索栏（searchOpen 时内嵌，NovelDetail 传入 NovelSearchBar） */
  searchBar?: JSX.Element;
}

/**
 * 小说阅读器顶部栏（A2 卡片式，ADR-0072）：
 * sticky 容器页面背景色 + 内部 A2 卡片（返回 + 「小说《标题》」+ 搜索按钮/搜索栏）。
 * 双击卡片重置阅读进度（与旧 header 行为一致）。
 */
const NovelTopBar: Component<NovelTopBarProps> = (props) => {
  return (
    <div class="sticky top-0 z-20 bg-[var(--colorNeutralBackground3)] px-4 pt-3 pb-1">
      <div
        class="rounded-[var(--borderRadius2XLarge)] bg-[var(--colorNeutralBackground1)] shadow-[var(--elevation2)] px-[var(--spacingHorizontalL)] h-12 flex items-center gap-2"
        onDblClick={props.onDoubleClick}
      >
        <fluent-button
          appearance="subtle"
          aria-label="返回"
          on:click={props.onBack}
          class="w-9 h-9 p-0 min-w-9 flex-shrink-0"
        >
          ←
        </fluent-button>
        <Show
          when={!props.searchOpen()}
          fallback={<div class="flex-1 min-w-0">{props.searchBar}</div>}
        >
          <h1 class="flex-1 min-w-0 [font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] flex items-center gap-1">
            <span class="whitespace-nowrap flex-shrink-0">小说</span>
            <span
              class="truncate text-[var(--colorNeutralForeground2)]"
              classList={{
                "opacity-0": !props.showTitle(),
                "opacity-100": props.showTitle(),
              }}
              style="transition:opacity var(--durationFast) var(--curveEasyEase)"
            >
              {props.title ? `《${props.title}》` : ""}
            </span>
          </h1>
        </Show>
        <Show when={!props.searchOpen()}>
          <button
            type="button"
            class="w-9 h-9 flex items-center justify-center rounded-[var(--borderRadiusMedium)] text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorNeutralBackground2)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer flex-shrink-0 focus-visible:[box-shadow:0_0_0_var(--strokeWidthThick)_var(--colorStrokeFocus2)]"
            onClick={props.onOpenSearch}
            aria-label="搜索"
          >
            <FluentIcon name="search" size={20} />
          </button>
        </Show>
      </div>
    </div>
  );
};

export default NovelTopBar;

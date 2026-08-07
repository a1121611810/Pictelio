import type { Component } from "solid-js";
import { Show } from "solid-js";
import NovelFooterNav from "../../NovelFooterNav";
import { NovelCard, NovelCoverCard, type NovelVariantProps } from "./shared";

/**
 * /novel 小说详情页 UI 原型 — 变体 B：封面强调版
 *
 * 顶部栏极简（返回 + 搜索，无标题卡）；封面 Hero 大卡（标题大字浮封面）；
 * 正文区套 A2 卡片（阅读区在卡片内）；底部导航 A2 卡片条。
 */
const VariantB: Component<NovelVariantProps> = (props) => {
  return (
    <div class="pb-10">
      {/* 极简顶部栏：返回 + 搜索 */}
      <div class="sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-[var(--colorNeutralBackground3)]">
        <fluent-button
          appearance="subtle"
          aria-label="返回"
          on:click={props.onBack}
          class="w-9 h-9 p-0 min-w-9"
        >
          ←
        </fluent-button>
        <button
          type="button"
          class="w-9 h-9 flex items-center justify-center rounded-[var(--borderRadiusMedium)] text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorNeutralBackground2)] active:scale-95 transition-all appearance-none border-none outline-none cursor-pointer"
          onClick={props.openSearch}
          aria-label="搜索"
        >
          🔍
        </button>
      </div>

      <Show when={props.novelData()}>
        <div class="px-4 mt-2">
          <NovelCoverCard
            novel={props.novelData()!}
            onAuthorClick={props.onAuthorClick}
            onSeriesClick={props.onSeriesClick}
            onCommentsClick={props.onCommentsClick}
            onTitleRef={props.setTitleEl}
            layout="hero"
          />
        </div>

        {/* 正文区 — 套 A2 卡片 */}
        <div class="px-4 mt-4">
          <NovelCard class="px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalL)]">
            {props.renderBody()}
          </NovelCard>
        </div>

        {/* 底部导航 — A2 卡片条 */}
        <div class="px-4 pb-4 mt-4">
          <NovelCard class="px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalS)]">
            <NovelFooterNav {...props.footerNav()} />
          </NovelCard>
        </div>
      </Show>
    </div>
  );
};

export default VariantB;

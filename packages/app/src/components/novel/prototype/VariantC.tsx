import type { Component } from "solid-js";
import { Show } from "solid-js";
import NovelFooterNav from "../../NovelFooterNav";
import { NovelCard, NovelCoverCard, NovelTopBar, type NovelVariantProps } from "./shared";

/**
 * /novel 小说详情页 UI 原型 — 变体 C：阅读沉浸版
 *
 * 顶部栏 A2 卡片式；封面紧凑横条卡（左缩略 + 右标题/作者/统计）；
 * 正文纯净（不套卡，沉浸阅读）；底部导航 A2 卡片条。
 */
const VariantC: Component<NovelVariantProps> = (props) => {
  return (
    <div class="pb-10">
      <NovelTopBar
        title={props.novelData()?.title ?? ""}
        showTitle={props.showHeaderTitle}
        searchOpen={props.searchOpen}
        onBack={props.onBack}
        onOpenSearch={props.openSearch}
        onCloseSearch={props.closeSearch}
      />

      <Show when={props.novelData()}>
        <div class="px-4 mt-4">
          <NovelCoverCard
            novel={props.novelData()!}
            onAuthorClick={props.onAuthorClick}
            onSeriesClick={props.onSeriesClick}
            onCommentsClick={props.onCommentsClick}
            onTitleRef={props.setTitleEl}
            layout="compact"
          />
        </div>

        {/* 正文区 — 纯净沉浸（背景 NeutralBackground2，不套卡） */}
        <div class="px-4 py-6 max-w-2xl mx-auto pb-[64px]">{props.renderBody()}</div>

        {/* 底部导航 — A2 卡片条 */}
        <div class="px-4 pb-4">
          <NovelCard class="px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalS)]">
            <NovelFooterNav {...props.footerNav()} />
          </NovelCard>
        </div>
      </Show>
    </div>
  );
};

export default VariantC;

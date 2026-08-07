import type { Component } from "solid-js";

interface DetailHeaderProps {
  title: string;
  onBack: () => void;
  onMore: () => void;
}

/**
 * 详情页顶部栏（A2 卡片式，ADR-0071）：
 * sticky 容器为页面背景色，内容是一张 A2 圆角卡片（2XLarge + elevation2），
 * 内含返回 / 标题（truncate）/ 更多操作。与 /home header 同构。
 */
const DetailHeader: Component<DetailHeaderProps> = (props) => {
  return (
    <div class="sticky top-0 z-20 bg-[var(--colorNeutralBackground3)] px-4 pt-3 pb-1">
      <div class="rounded-[var(--borderRadius2XLarge)] bg-[var(--colorNeutralBackground1)] shadow-[var(--elevation2)] px-[var(--spacingHorizontalL)] h-12 flex items-center gap-2">
        <fluent-button
          appearance="subtle"
          aria-label="返回"
          on:click={props.onBack}
          class="w-9 h-9 p-0 min-w-9 flex-shrink-0"
        >
          ←
        </fluent-button>
        <h1 class="flex-1 min-w-0 [font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)] truncate">
          {props.title}
        </h1>
        <fluent-button
          appearance="subtle"
          aria-label="更多操作"
          on:click={props.onMore}
          class="w-9 h-9 p-0 min-w-9 flex-shrink-0"
        >
          ⋯
        </fluent-button>
      </div>
    </div>
  );
};

export default DetailHeader;

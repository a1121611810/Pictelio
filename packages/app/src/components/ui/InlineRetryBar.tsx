import type { Component } from "solid-js";

interface InlineRetryBarProps {
  /** 失败提示文案（默认“加载更多失败”） */
  message?: string;
  /** 重试回调：只重试失败的那一页（不整页重刷） */
  onRetry: () => void;
}

/**
 * 内联分页重试条 —— 分页（加载更多）失败时保留已加载结果，只在列表底部
 * 显示一条失败提示 + 重试按钮。重试仅重新请求失败页，不清理已有结果。
 */
const InlineRetryBar: Component<InlineRetryBarProps> = (props) => {
  return (
    <div class="flex items-center justify-center gap-3 py-[var(--spacingVerticalL)]" role="status">
      <span class="text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase200)]">
        {props.message ?? "加载更多失败"}
      </span>
      <button
        type="button"
        class="min-h-10 px-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] hover:bg-[var(--colorNeutralBackground2Hover)] active:scale-95 focus-visible:outline-[var(--colorStrokeFocus2)] focus-visible:outline-2 focus-visible:outline-offset-1 transition-all duration-[var(--durationFast)]"
        onClick={props.onRetry}
      >
        重试
      </button>
    </div>
  );
};

export default InlineRetryBar;

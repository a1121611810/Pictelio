/**
 * HistoryRowCard — 历史条目 A2 行卡（首页 L5 历史 Tab 正式版）。
 *
 * 视觉：40px 缩略图（R18 内容模糊 + R-18/R18G 徽标）+ 标题 / 作者·时间·次数 + 删除按钮。
 * A2 规范（ADR-0074）：Large 圆角、NeutralBackground1 底、1px NeutralStroke1 边框、
 * 无阴影、hover 背景高亮、active 轻微缩放。
 * 删除按钮事件 stopPropagation，避免误触打开详情。
 */
import type { Component } from "solid-js";
import { Show } from "solid-js";
import type { HistoryEntry } from "@/stores/historyStore";
import { resolveImageUrl } from "@/utils/imageLoader";

interface HistoryRowCardProps {
  /** 历史条目 */
  entry: HistoryEntry;
  /** 打开详情回调（点击行 / 回车） */
  onOpen: () => void;
  /** 删除该条目回调（删除按钮） */
  onDelete: () => void;
}

const HistoryRowCard: Component<HistoryRowCardProps> = (props) => {
  // R18 内容（xRestrict 1=R-18 / 2=R18G）：缩略图模糊并叠加徽标
  const hideByR18 = props.entry.xRestrict === 1 || props.entry.xRestrict === 2;

  // 访问时间（HH:mm）
  const time = () => {
    const d = new Date(props.entry.visitedAt);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div
      class="flex cursor-pointer items-center gap-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusLarge)] border border-[var(--colorNeutralStroke1)] bg-[var(--colorNeutralBackground1)] p-[var(--spacingHorizontalM)] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-98 focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onOpen();
      }}
    >
      {/* 40px 缩略图（R18 模糊 + 徽标） */}
      <div class="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground2)]">
        <img
          src={resolveImageUrl(props.entry.thumbnailUrl)}
          alt={props.entry.title}
          class={`h-full w-full object-cover ${hideByR18 ? "filter blur-[8px]" : ""}`}
          loading="lazy"
        />
        <Show when={hideByR18}>
          <span
            class="absolute left-[var(--strokeWidthThin)] top-[var(--strokeWidthThin)] rounded-[var(--borderRadiusSmall)] px-[var(--spacingHorizontalXXS)] font-bold [font-size:var(--fontSizeBase100)]"
            style={{
              background: "var(--colorStatusDangerBackground2)",
              color: "var(--colorStatusDangerForeground1)",
            }}
          >
            {props.entry.xRestrict === 2 ? "R18G" : "R-18"}
          </span>
        </Show>
      </div>

      {/* 标题 / 作者·时间·次数 */}
      <div class="min-w-0 flex-1">
        <p class="truncate text-[var(--colorNeutralForeground1)] leading-[var(--lineHeightBase300)] [font-size:var(--fontSizeBase300)]">
          {props.entry.title}
        </p>
        <p class="mt-[var(--spacingVerticalXXS)] truncate text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase200)]">
          {props.entry.userName} · {time()} · {props.entry.visitCount}次
        </p>
      </div>

      {/* 删除按钮：stopPropagation 避免触发行点击 */}
      <button
        class="flex h-8 w-8 flex-shrink-0 cursor-pointer items-center justify-center rounded-[var(--borderRadiusMedium)] border-none bg-transparent text-[var(--colorNeutralForeground3)] outline-none transition-all hover:bg-[var(--colorNeutralBackground2)] hover:text-[var(--colorNeutralForeground1)] active:scale-95 focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[color:var(--colorStrokeFocus2)]"
        onClick={(e) => {
          e.stopPropagation();
          props.onDelete();
        }}
        aria-label={`删除 ${props.entry.title}`}
      >
        ✕
      </button>
    </div>
  );
};

export default HistoryRowCard;

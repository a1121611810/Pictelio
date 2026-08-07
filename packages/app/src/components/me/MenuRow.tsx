import type { Component } from "solid-js";
import FluentIcon, { type FluentIconName } from "@/components/ui/FluentIcon";

interface MenuRowProps {
  icon: FluentIconName;
  label: string;
  count?: number | null;
  onClick: () => void;
  ariaLabel: string;
}

/**
 * 个人中心菜单行（A2 视觉语言）：
 * 图标 + 标签 + 可选计数 + chevron，无边框、hover 反馈、触控高度 44px+。
 */
export const MenuRow: Component<MenuRowProps> = (props) => {
  return (
    <div
      class="flex items-center px-2 py-3.5 gap-3 cursor-pointer hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] rounded-[var(--borderRadiusMedium)]"
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onClick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={props.ariaLabel}
    >
      <div class="w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
        <FluentIcon name={props.icon} size={22} />
      </div>
      <span class="flex-1 [font-size:var(--fontSizeBase300)] font-medium text-[var(--colorNeutralForeground1)] leading-snug">
        {props.label}
      </span>
      {props.count != null && (
        <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
          {props.count.toLocaleString()}
        </span>
      )}
      <FluentIcon name="chevronRight" size={16} />
    </div>
  );
};

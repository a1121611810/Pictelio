import type { Accessor, Component } from "solid-js";
import type { UseUserProfileResult } from "@/primitives/useUserProfile";
import type { PixivProfile } from "@/api/types";
import FluentIcon, { type FluentIconName } from "@/components/ui/FluentIcon";

/** 个人中心导航动作集（与 PersonalCenter.tsx 现状行为一一对应） */
export interface PersonalCenterActions {
  works: () => void;
  bookmarks: () => void;
  following: () => void;
  followers: () => void;
  settings: () => void;
  back: () => void;
  search: () => void;
}

/** /me 页面 UI 原型变体公共 props */
export interface PersonalCenterVariantProps {
  profileState: UseUserProfileResult;
  profile: Accessor<PixivProfile | null>;
  actions: PersonalCenterActions;
}

/** 菜单行（图标 + 标签 + 可选计数 + chevron），A2 视觉：无边框、hover 反馈、触控 44px+ */
export const MenuRow: Component<{
  icon: FluentIconName;
  label: string;
  count?: number | null;
  onClick: () => void;
  ariaLabel: string;
}> = (props) => {
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
      <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
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

/** 头像（圆形，加载失败回退首字母底） */
export const Avatar: Component<{
  src: string;
  errored: boolean;
  name: string;
  sizeClass?: string;
}> = (props) => {
  return (
    <>
      {!props.errored && props.src ? (
        <img
          src={props.src}
          alt={props.name}
          class={`${props.sizeClass ?? "w-14 h-14"} rounded-full object-cover flex-shrink-0`}
        />
      ) : (
        <div
          class={`${props.sizeClass ?? "w-14 h-14"} rounded-full bg-[var(--colorBrandBackground)] flex items-center justify-center text-[var(--colorNeutralForegroundOnBrand)] font-semibold flex-shrink-0`}
        >
          <span class="[font-size:var(--fontSizeBase500)]">{props.name.charAt(0) || "P"}</span>
        </div>
      )}
    </>
  );
};

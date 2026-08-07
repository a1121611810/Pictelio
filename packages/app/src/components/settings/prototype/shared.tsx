import type { Component, JSX } from "solid-js";
import { Show } from "solid-js";
import FluentIcon from "../../ui/FluentIcon";

/**
 * 设置页 UI 原型（`?variant=` 切换）变体共用的 props。
 * 与 Settings.tsx 现有状态/回调对齐：数据层与行为层保持在页面路由内，
 * 变体只负责渲染结构。
 */
export interface SettingsVariantProps {
  isLoggedIn: () => boolean;
  onLogout: () => void;
  onOpenBlocklist: () => void;
  setAgeGateMessage: (msg: string | null) => void;
  onClearData: () => void;
  onDeleteAccount: () => void;
  onActionToast: (msg: string) => void;
}

/** 退出登录行（danger 样式），三个变体共用。 */
export const LogoutRow: Component<{ isLoggedIn: () => boolean; onLogout: () => void }> = (
  props,
) => {
  return (
    <Show when={props.isLoggedIn()}>
      <button
        type="button"
        class="w-full flex items-center gap-3 py-3 px-2 cursor-pointer hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] rounded-[var(--borderRadiusMedium)] appearance-none border-none bg-transparent text-left"
        onClick={props.onLogout}
        aria-label="退出登录"
      >
        <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorStatusDangerForeground1)]">
          <FluentIcon name="signOut" size={24} />
        </div>
        <div>
          <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorStatusDangerForeground1)] leading-snug">
            退出登录
          </p>
          <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
            清除当前登录凭证，不会删除本地其他数据
          </p>
        </div>
      </button>
    </Show>
  );
};

interface SettingsCardProps {
  /** elevated=柔和阴影无边框（A2）；outlined=细边框无阴影（A3）；danger=危险操作卡片 */
  tone?: "elevated" | "outlined" | "danger";
  class?: string;
  children?: JSX.Element;
}

/**
 * 设置区块卡片容器（A 系变体共用）。
 * 对照调研：卡片圆角用 --borderRadius2XLarge（16px 档），
 * 浮起用单级 --elevation2（不叠多级阴影），表面用 --colorNeutralBackground1。
 */
export const SettingsCard: Component<SettingsCardProps> = (props) => {
  const toneClass = () =>
    props.tone === "outlined"
      ? "rounded-[var(--borderRadius2XLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)]"
      : props.tone === "danger"
        ? "rounded-[var(--borderRadius2XLarge)] bg-[var(--colorStatusDangerBackground2)] border border-[var(--colorStatusDangerBackground2)]"
        : "rounded-[var(--borderRadius2XLarge)] bg-[var(--colorNeutralBackground1)] shadow-[var(--elevation2)]";

  return (
    <section
      class={`px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalS)] ${toneClass()} ${props.class ?? ""}`}
    >
      {props.children}
    </section>
  );
};

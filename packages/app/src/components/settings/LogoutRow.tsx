import type { Component } from "solid-js";
import { Show } from "solid-js";
import FluentIcon from "../ui/FluentIcon";

/** 退出登录行（danger 样式，用于设置页独立危险卡片）。 */
const LogoutRow: Component<{ isLoggedIn: () => boolean; onLogout: () => void }> = (props) => {
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

export default LogoutRow;

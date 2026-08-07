import type { Component } from "solid-js";
import { Show } from "solid-js";
import FluentIcon from "../ui/FluentIcon";
import SettingsAppearance from "./SettingsAppearance";
import SettingsContent from "./SettingsContent";
import SettingsImage from "./SettingsImage";
import SettingsTranslate from "./SettingsTranslate";
import SettingsClient from "./SettingsClient";
import SettingsAccount from "./SettingsAccount";
import type { SettingsVariantProps } from "./prototype/shared";

/**
 * 设置页「现状布局」（生产默认）。
 *
 * 与 UI 原型变体（prototype/VariantA/B/C）使用同一组 props，但保持原有的
 * 扁平区块 + divider 结构。生产构建通过 `import.meta.env.DEV` 门控走此组件，
 * 确保原型未选定前不改动线上外观。
 */
const SettingsLegacy: Component<SettingsVariantProps> = (props) => {
  return (
    <>
      <SettingsAppearance />

      <fluent-divider />

      <SettingsContent
        onOpenBlocklist={props.onOpenBlocklist}
        setAgeGateMessage={props.setAgeGateMessage}
      />

      <fluent-divider />

      <SettingsImage />

      <fluent-divider />

      <SettingsTranslate />

      <fluent-divider />

      <SettingsClient />

      <fluent-divider />

      {/* Logout — 保留在设置页（design choice） */}
      <Show when={props.isLoggedIn()}>
        <div
          class="flex items-center justify-between py-3 cursor-pointer hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] rounded-[var(--borderRadiusMedium)] -mx-2 px-2"
          onClick={props.onLogout}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              props.onLogout();
            }
          }}
          role="button"
          tabindex="0"
          aria-label="退出登录"
        >
          <div class="flex items-center gap-3">
            <div class="relative w-6 h-6 flex-shrink-0 text-[var(--colorNeutralForeground2)]">
              <FluentIcon name="signOut" size={24} />
            </div>
            <div>
              <p class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
                退出登录
              </p>
              <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug">
                清除当前登录凭证，不会删除本地其他数据
              </p>
            </div>
          </div>
        </div>
      </Show>

      <SettingsAccount
        onClearData={props.onClearData}
        onDeleteAccount={props.onDeleteAccount}
        onActionToast={props.onActionToast}
      />
    </>
  );
};

export default SettingsLegacy;

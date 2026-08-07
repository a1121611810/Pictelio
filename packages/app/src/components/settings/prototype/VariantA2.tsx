import type { Component } from "solid-js";
import SettingsAppearance from "../SettingsAppearance";
import SettingsContent from "../SettingsContent";
import SettingsImage from "../SettingsImage";
import SettingsTranslate from "../SettingsTranslate";
import SettingsClient from "../SettingsClient";
import SettingsAccount from "../SettingsAccount";
import { LogoutRow, SettingsCard, type SettingsVariantProps } from "./shared";

/**
 * 设置页 UI 原型 — 变体 A2：精修版（Windows 11 / Fluent 风格）
 *
 * 在 A（卡片分组）基础上对照业界调研改进：
 * - 卡片去边框、大圆角（--borderRadius2XLarge）、单级柔和阴影（--elevation2）；
 * - 卡片间大间距（--spacingVerticalXL），无多余分割线（少线条原则）；
 * - 危险操作（退出登录）独立 danger 色调卡片，不与普通设置同卡。
 */
const VariantA2: Component<SettingsVariantProps> = (props) => {
  return (
    <div class="flex flex-col gap-[var(--spacingVerticalXL)] py-2">
      <SettingsCard tone="elevated">
        <SettingsAppearance />
      </SettingsCard>

      <SettingsCard tone="elevated">
        <SettingsContent
          onOpenBlocklist={props.onOpenBlocklist}
          setAgeGateMessage={props.setAgeGateMessage}
        />
      </SettingsCard>

      <SettingsCard tone="elevated">
        <SettingsImage />
      </SettingsCard>

      <SettingsCard tone="elevated">
        <SettingsTranslate />
      </SettingsCard>

      <SettingsCard tone="elevated">
        <SettingsClient />
      </SettingsCard>

      <SettingsCard tone="elevated">
        <SettingsAccount
          onClearData={props.onClearData}
          onDeleteAccount={props.onDeleteAccount}
          onActionToast={props.onActionToast}
        />
      </SettingsCard>

      {/* 退出登录 — 独立危险卡片 */}
      <SettingsCard tone="danger">
        <LogoutRow isLoggedIn={props.isLoggedIn} onLogout={props.onLogout} />
      </SettingsCard>
    </div>
  );
};

export default VariantA2;

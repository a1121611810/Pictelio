import type { Component } from "solid-js";
import SettingsAppearance from "../SettingsAppearance";
import SettingsContent from "../SettingsContent";
import SettingsImage from "../SettingsImage";
import SettingsTranslate from "../SettingsTranslate";
import SettingsClient from "../SettingsClient";
import SettingsAccount from "../SettingsAccount";
import { LogoutRow, SettingsCard, type SettingsVariantProps } from "./shared";

/**
 * 设置页 UI 原型 — 变体 A3：清爽版（iOS inset grouped 风格）
 *
 * 在 A（卡片分组）基础上对照业界调研改进：
 * - 卡片细边框（--colorNeutralStroke1）、无阴影、大圆角（--borderRadius2XLarge）；
 * - 卡片内行间 1px 细分割线（inset 分组习惯：组头与首行之间无线，行间有线）；
 * - 危险操作（退出登录）独立 danger 色调卡片。
 */
const VariantA3: Component<SettingsVariantProps> = (props) => {
  return (
    <>
      {/* 行间细分割线：仅作用于本变体卡片内（.p-a3-card 前缀避免全局污染） */}
      <style>{`
        .p-a3-card > div > div + div {
          border-top: 1px solid var(--colorNeutralStroke2);
        }
      `}</style>

      <div class="flex flex-col gap-[var(--spacingVerticalL)] py-2">
        <SettingsCard tone="outlined" class="p-a3-card">
          <SettingsAppearance />
        </SettingsCard>

        <SettingsCard tone="outlined" class="p-a3-card">
          <SettingsContent
            onOpenBlocklist={props.onOpenBlocklist}
            setAgeGateMessage={props.setAgeGateMessage}
          />
        </SettingsCard>

        <SettingsCard tone="outlined" class="p-a3-card">
          <SettingsImage />
        </SettingsCard>

        <SettingsCard tone="outlined" class="p-a3-card">
          <SettingsTranslate />
        </SettingsCard>

        <SettingsCard tone="outlined" class="p-a3-card">
          <SettingsClient />
        </SettingsCard>

        <SettingsCard tone="outlined" class="p-a3-card">
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
    </>
  );
};

export default VariantA3;

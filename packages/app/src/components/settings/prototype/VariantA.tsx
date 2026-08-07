import type { Component } from "solid-js";
import SettingsAppearance from "../SettingsAppearance";
import SettingsContent from "../SettingsContent";
import SettingsImage from "../SettingsImage";
import SettingsTranslate from "../SettingsTranslate";
import SettingsClient from "../SettingsClient";
import SettingsAccount from "../SettingsAccount";
import { LogoutRow, type SettingsVariantProps } from "./shared";

/**
 * 设置页 UI 原型 — 变体 A：卡片化分组（Card Groups）
 *
 * 主交互：滚动。信息层级：区块卡片 → 行项目。
 * 每个设置区块浮起为圆角卡片（surface-card-elevated），区块间大间距留白，
 * 不再使用 divider；退出登录独立成一张 danger 色调卡片。
 */
const VariantA: Component<SettingsVariantProps> = (props) => {
  return (
    <div class="flex flex-col gap-[var(--spacingVerticalXL)] py-2">
      <section class="surface-card-elevated px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalS)]">
        <SettingsAppearance />
      </section>

      <section class="surface-card-elevated px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalS)]">
        <SettingsContent
          onOpenBlocklist={props.onOpenBlocklist}
          setAgeGateMessage={props.setAgeGateMessage}
        />
      </section>

      <section class="surface-card-elevated px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalS)]">
        <SettingsImage />
      </section>

      <section class="surface-card-elevated px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalS)]">
        <SettingsTranslate />
      </section>

      <section class="surface-card-elevated px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalS)]">
        <SettingsClient />
      </section>

      <section class="surface-card-elevated px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalS)]">
        <SettingsAccount
          onClearData={props.onClearData}
          onDeleteAccount={props.onDeleteAccount}
          onActionToast={props.onActionToast}
        />
      </section>

      {/* 退出登录 — 独立危险卡片 */}
      <section class="rounded-[var(--borderRadiusMedium)] border border-[var(--colorStatusDangerBackground2)] bg-[var(--colorStatusDangerBackground2)] px-[var(--spacingHorizontalL)] py-[var(--spacingVerticalS)]">
        <LogoutRow isLoggedIn={props.isLoggedIn} onLogout={props.onLogout} />
      </section>
    </div>
  );
};

export default VariantA;

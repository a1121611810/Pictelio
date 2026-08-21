import type { Component } from "solid-js";
import SettingsAppearance from "./SettingsAppearance";
import SettingsContent from "./SettingsContent";
import SettingsImage from "./SettingsImage";
import SettingsTranslate from "./SettingsTranslate";
import SettingsClient from "./SettingsClient";
import SettingsAccount from "./SettingsAccount";
import SettingsCard from "./SettingsCard";
import LogoutRow from "./LogoutRow";

interface SettingsSectionsProps {
  isLoggedIn: () => boolean;
  onLogout: () => void;
  onOpenBlocklist: () => void;
  onClearData: () => void;
  onDeleteAccount: () => void;
  onActionToast: (msg: string) => void;
}

/**
 * 设置页分区布局（A2 精修版，UI 原型用户选定后折入）。
 *
 * 卡片化分组：每个设置区块浮起为圆角卡片（无边框、单级柔和阴影
 * --elevation2、圆角 --borderRadiusXLarge（ADR-0074）），卡片间大间距
 * --spacingVerticalXL、不使用分隔线（少线条原则）；
 * 危险操作（退出登录）独立 danger 色调卡片，不与普通设置同卡。
 */
const SettingsSections: Component<SettingsSectionsProps> = (props) => {
  return (
    <div class="flex flex-col gap-[var(--spacingVerticalXL)] py-2">
      <SettingsCard tone="elevated">
        <SettingsAppearance />
      </SettingsCard>

      <SettingsCard tone="elevated">
        <SettingsContent onOpenBlocklist={props.onOpenBlocklist} />
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

export default SettingsSections;

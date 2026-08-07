import type { Component } from "solid-js";
import { createSignal, For, Show } from "solid-js";
import SettingsAppearance from "../SettingsAppearance";
import SettingsContent from "../SettingsContent";
import SettingsImage from "../SettingsImage";
import SettingsTranslate from "../SettingsTranslate";
import SettingsClient from "../SettingsClient";
import SettingsAccount from "../SettingsAccount";
import { LogoutRow, type SettingsVariantProps } from "./shared";

type TabKey = "appearance" | "content" | "image" | "translate" | "client" | "account";

const TABS: { key: TabKey; label: string }[] = [
  { key: "appearance", label: "显示" },
  { key: "content", label: "内容" },
  { key: "image", label: "图片" },
  { key: "translate", label: "翻译" },
  { key: "client", label: "引擎" },
  { key: "account", label: "账户" },
];

/**
 * 设置页 UI 原型 — 变体 B：分类 Tab（Tabbed Categories）
 *
 * 主交互：点选切换（一次只看一个分类）。信息层级：类别优先。
 * 顶部 sticky 分段 tab 栏贴在 header 下方，点击切换内容区；
 * 退出登录并入「账户」分类末尾。
 */
const VariantB: Component<SettingsVariantProps> = (props) => {
  const [tab, setTab] = createSignal<TabKey>("appearance");

  return (
    <div>
      {/* Sticky 分段 tab 栏（贴在 header 下方） */}
      <div class="sticky top-12 z-10 -mx-5 px-5 py-2 bg-[var(--colorNeutralBackgroundAlpha)] backdrop-blur-[var(--backdropBlurDefault)] backdrop-saturate-[var(--backdropSaturateDefault)]">
        <div
          class="flex bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusMedium)] p-1.5 gap-1"
          role="tablist"
          aria-label="设置分类"
        >
          <For each={TABS}>
            {(t) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab() === t.key}
                class="flex-1 py-[var(--spacingVerticalS)] rounded-[var(--borderRadiusSmall)] [font-size:var(--fontSizeBase200)] font-semibold transition-all active:scale-[0.98] appearance-none border-none outline-none cursor-pointer focus-visible:[box-shadow:0_0_0_var(--strokeWidthThick)_var(--colorStrokeFocus2)]"
                classList={{
                  "bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] shadow-[var(--elevation2)]":
                    tab() === t.key,
                  "bg-transparent text-[var(--colorNeutralForeground2)] hover:text-[var(--colorNeutralForeground1)]":
                    tab() !== t.key,
                }}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            )}
          </For>
        </div>
      </div>

      {/* 内容区 — 仅渲染当前分类 */}
      <div class="py-2">
        <Show when={tab() === "appearance"}>
          <SettingsAppearance />
        </Show>
        <Show when={tab() === "content"}>
          <SettingsContent
            onOpenBlocklist={props.onOpenBlocklist}
            setAgeGateMessage={props.setAgeGateMessage}
          />
        </Show>
        <Show when={tab() === "image"}>
          <SettingsImage />
        </Show>
        <Show when={tab() === "translate"}>
          <SettingsTranslate />
        </Show>
        <Show when={tab() === "client"}>
          <SettingsClient />
        </Show>
        <Show when={tab() === "account"}>
          <div class="flex flex-col gap-2">
            <SettingsAccount
              onClearData={props.onClearData}
              onDeleteAccount={props.onDeleteAccount}
              onActionToast={props.onActionToast}
            />
            <LogoutRow isLoggedIn={props.isLoggedIn} onLogout={props.onLogout} />
          </div>
        </Show>
      </div>
    </div>
  );
};

export default VariantB;

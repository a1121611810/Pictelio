import type { Component } from "solid-js";
import { Preferences } from "@capacitor/preferences";
import { isLoggedIn, logout } from "../stores/authStore";
import { clearImageCache } from "../utils/imageLoader";
import { clearAll as clearNovelCache } from "../stores/novelCache";
import { clearTranslationCache } from "../utils/translationCache";
import { resetBlockedIds } from "../stores/blockStore";
import { resetReportedIds } from "../stores/reportStore";
import { resetSettingsStore as resetUiStore } from "../stores/settingsStore";
import { switchClient } from "../utils/clientSwitch";
import FluentIcon from "../components/ui/FluentIcon";
import PageTransition from "../components/PageTransition";
import SettingsAppearance from "../components/settings/SettingsAppearance";
import SettingsContent from "../components/settings/SettingsContent";
import SettingsImage from "../components/settings/SettingsImage";
import SettingsTranslate from "../components/settings/SettingsTranslate";
import SettingsAccount from "../components/settings/SettingsAccount";
import SettingsClient from "../components/settings/SettingsClient";
import SettingsDialogs from "../components/settings/SettingsDialogs";

function openDeleteAccountPage() {
  // TODO: Install @capacitor/browser and use Browser.open({ url }) for a native in-app/system browser experience.
  window.open("https://www.pixiv.net/leave.php", "_blank", "noopener,noreferrer");
}

const Settings: Component = () => {
  const navigate = useNavigate();
  const [ageGateMessage, setAgeGateMessage] = createSignal<string | null>(null);
  const [showBlocklist, setShowBlocklist] = createSignal(false);
  const [actionToast, setActionToast] = createSignal<string | null>(null);
  const [dialogState, setDialogState] = createSignal<
    { type: "clear" } | { type: "deleteAccount" } | { type: "switchClient" } | null
  >(null);

  // Auto-hide the age gate hint toast
  createEffect(() => {
    if (ageGateMessage()) {
      const timer = setTimeout(() => setAgeGateMessage(null), 2500);
      onCleanup(() => clearTimeout(timer));
    }
  });

  // Auto-hide action toast
  createEffect(() => {
    if (actionToast()) {
      const timer = setTimeout(() => setActionToast(null), 2500);
      onCleanup(() => clearTimeout(timer));
    }
  });

  async function handleLogout() {
    const [logoutErr] = await tryAsync(
      (async () => {
        await logout();
        navigate("/login", { replace: true });
      })(),
    );
    if (logoutErr) {
      setActionToast("退出登录失败");
    } else {
      setActionToast("已退出登录");
    }
  }

  async function handleClearLocalData() {
    const [clearErr] = await tryAsync(
      (async () => {
        await logout();
        clearImageCache();
        await clearNovelCache();
        await clearTranslationCache();
        resetBlockedIds();
        resetReportedIds();
        await Preferences.clear();
        await resetUiStore();
        navigate("/login", { replace: true });
      })(),
    );
    if (clearErr) {
      setActionToast("清除失败，请重试");
    } else {
      setActionToast("本地数据已清除");
    }
  }

  /** 切换到 Lynx 客户端：深模块 switchClient 完成写开关 + 原生重启编排 */
  async function handleSwitchClient() {
    setDialogState(null);
    const result = await switchClient("lynx");
    if (!result.ok) {
      console.warn("[settings] 切换失败", result.reason);
      // busy：已有切换在途，静默忽略（防连点）
      if (result.reason !== "busy") {
        setActionToast(result.reason === "timeout" ? "切换超时，请重试" : "切换失败，请重试");
      }
      return;
    }
    setActionToast("已切换到 Lynx，正在重启…");
  }

  // ── E2E 测试钩子（仅 --mode e2e 构建）──
  // 动态 showModal 的 <dialog> 内按钮无法被 WebDriver/脚本点击（浏览器级限制，
  // 真实用户触摸正常）。模拟器 E2E（tests/android-e2e）通过此全局钩子触发
  // 确认逻辑，绕过对话框交互限制。
  // __E2E__ 由 vite.config define 控制：仅 --mode e2e 构建为 true，
  // build:android（production）被替换为 false 并整体消除，无生产泄漏。
  if (__E2E__) {
    (window as unknown as Record<string, unknown>).pictelioE2e = {
      confirmSwitchClient: () => {
        void handleSwitchClient();
      },
    };
  }

  return (
    <PageTransition>
      <div class="min-h-screen pb-8">
        {/* Age gate hint toast */}
        <Show when={ageGateMessage()}>
          <fluent-message-bar
            intent="warning"
            style="position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:60;pointer-events:none"
          >
            {ageGateMessage()}
          </fluent-message-bar>
        </Show>

        {/* Action success toast */}
        <Show when={actionToast()}>
          <fluent-message-bar
            intent="success"
            style="position:fixed;top:80px;left:50%;transform:translateX(-50%);z-index:60;pointer-events:none"
          >
            {actionToast()}
          </fluent-message-bar>
        </Show>

        {/* Sticky header */}
        <header class="sticky top-0 z-20 surface-appbar h-12 flex items-center px-4 gap-3">
          <fluent-button
            appearance="subtle"
            aria-label="返回"
            on:click={() => navigate(-1)}
            class="w-8 h-8 p-0 min-w-8"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M15.53 4.22a.75.75 0 0 1 0 1.06L8.81 12l6.72 6.72a.75.75 0 1 1-1.06 1.06l-7.25-7.25a.75.75 0 0 1 0-1.06l7.25-7.25a.75.75 0 0 1 1.06 0z"
                fill="currentColor"
              />
            </svg>
          </fluent-button>
          <h1 class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] flex-1">
            设置
          </h1>
        </header>

        {/* Scrollable content */}
        <div class="px-5 pb-8">
          <SettingsAppearance />

          <fluent-divider />

          <SettingsContent
            onOpenBlocklist={() => setShowBlocklist(true)}
            setAgeGateMessage={setAgeGateMessage}
          />

          <fluent-divider />

          <SettingsImage />

          <fluent-divider />

          <SettingsTranslate />

          <fluent-divider />

          <SettingsClient onSwitchRequest={() => setDialogState({ type: "switchClient" })} />

          <fluent-divider />

          {/* Logout — kept in Settings.tsx per design choice */}
          <Show when={isLoggedIn()}>
            <div
              class="flex items-center justify-between py-3 cursor-pointer hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] rounded-[var(--borderRadiusMedium)] -mx-2 px-2"
              onClick={handleLogout}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleLogout();
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
            onClearData={() => setDialogState({ type: "clear" })}
            onDeleteAccount={() => setDialogState({ type: "deleteAccount" })}
            onActionToast={setActionToast}
          />
        </div>

        <SettingsDialogs
          showBlocklist={showBlocklist()}
          onCloseBlocklist={() => setShowBlocklist(false)}
          dialogType={dialogState()?.type ?? null}
          onCloseDialog={() => setDialogState(null)}
          onConfirmClear={handleClearLocalData}
          onConfirmSwitchClient={handleSwitchClient}
          onConfirmDelete={() => {
            setDialogState(null);
            openDeleteAccountPage();
          }}
        />
      </div>
    </PageTransition>
  );
};

export default Settings;

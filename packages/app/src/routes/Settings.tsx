import type { Component } from "solid-js";
import { Preferences } from "@capacitor/preferences";
import { isLoggedIn, logout } from "../stores/authStore";
import { clearImageCache } from "../utils/imageLoader";
import { clearAll as clearNovelCache } from "../stores/novelCache";
import { clearTranslationCache } from "../utils/translationCache";
import { resetBlockedIds } from "../stores/blockStore";
import { resetReportedIds } from "../stores/reportStore";
import { resetSettingsStore as resetUiStore } from "../stores/settingsStore";
import PageTransition from "../components/PageTransition";
import SettingsDialogs from "../components/settings/SettingsDialogs";
import SettingsSections from "../components/settings/SettingsSections";
import { goBack } from "../services/backTransitionService";

function openDeleteAccountPage() {
  // TODO: Install @capacitor/browser and use Browser.open({ url }) for a native in-app/system browser experience.
  window.open("https://www.pixiv.net/leave.php", "_blank", "noopener,noreferrer");
}

const Settings: Component = () => {
  const navigate = useNavigate();
  const [showBlocklist, setShowBlocklist] = createSignal(false);
  const [actionToast, setActionToast] = createSignal<string | null>(null);
  const [dialogState, setDialogState] = createSignal<
    { type: "clear" } | { type: "deleteAccount" } | null
  >(null);

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

  // ── E2E 测试钩子（仅 --mode e2e 构建）──
  // 已随 T2 迁移至 /client-switch 说明页（routes/ClientSwitch.tsx）：
  // 设置页入口行现直接导航说明页，confirmSwitchClient 钩子由该页注册。

  return (
    <PageTransition>
      <div class="min-h-screen pb-8">
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
            on:click={() => goBack()}
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

        {/* Scrollable content — A2 卡片化分组布局（UI 原型选定） */}
        <div class="px-5 pb-8">
          <SettingsSections
            isLoggedIn={isLoggedIn}
            onLogout={handleLogout}
            onOpenBlocklist={() => setShowBlocklist(true)}
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

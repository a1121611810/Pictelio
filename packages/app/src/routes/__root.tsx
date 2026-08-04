import type { Component } from "solid-js";
import { isLoggedIn, isLoading, setIsLoading, initializeAuth } from "@/stores/authStore";
import {
  loadAutoHideNavBarPreference,
  loadShowR18Preference,
  loadShowR18GPreference,
  loadLayoutModePreference,
  loadUgoiraModePreference,
  loadShowDetailStairsPreference,
  loadAgePreference,
  ageConfirmed,
  autoCheckUpdate,
  loadAutoCheckUpdatePreference,
  loadImageCachePrefs,
  loadNovelLayoutModePreference,
  loadLastDismissedVersionPreference,
  setHasUpdate,
  setLatestVersion,
  setLatestReleaseUrl,
  setLatestChangelog,
  setShowUpdateDialog,
  setIsCheckingUpdate,
  setCheckCompleted,
  lastDismissedVersion,
} from "@/stores/settingsStore";
import { loadThemePreference, loadPageStyleThemePreference } from "@/stores/themeStore";
import { loadContentTypePreference } from "@/stores/uiStore";
import { checkForUpdate } from "@/services/updateService";
import StartupUpdateDialog from "@/components/StartupUpdateDialog";
import { clearOverlays, registerBackGesture } from "@/services/backGestureService";
import { warmCacheFromDisk } from "@/utils/imageLoader";
import { loadReportedIds } from "@/stores/reportStore";
import { loadBlockedIds } from "@/stores/blockStore";
import { loadImageHostPreference } from "@/stores/imageHostStore";
import LoadingSpinner from "@/components/LoadingSpinner";
import { markContentReady } from "@/native/splashBridge";
/** 启动后检查更新的延迟时间（ms），确保页面渲染完成后再弹窗 */
const STARTUP_CHECK_DELAY_MS = 500;
/** "再按一次退出应用" toast 的显示时长（ms） */
const EXIT_HINT_DURATION_MS = 2000;

/**
 * 启动后检查更新（延迟执行，不阻塞首次渲染）。
 * 在 onMount 中的启动流程完成后调用。
 * 所有 setter 均为 settingsStore 模块级导出，无需在组件内定义。
 */
async function runStartupUpdateCheck(): Promise<void> {
  setIsCheckingUpdate(true);
  const [updateErr] = await tryAsync(
    (async () => {
      const result = await checkForUpdate();
      setHasUpdate(result.hasUpdate);
      setLatestVersion(result.latestVersion);
      setLatestReleaseUrl(result.latestReleaseUrl);
      setLatestChangelog(result.latestChangelog);

      if (
        result.hasUpdate &&
        result.latestVersion &&
        result.latestVersion !== lastDismissedVersion()
      ) {
        setShowUpdateDialog(true);
      }
    })(),
  );
  setIsCheckingUpdate(false);
  setCheckCompleted(true);
  if (updateErr) {
    console.warn("[App] Startup update check failed", updateErr);
  }
}

const RootLayout: Component = (props: { children?: any }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [showExitHint, setShowExitHint] = createSignal(false);
  let exitHintTimer: ReturnType<typeof setTimeout>;

  // 路由切换时清空 overlay 栈，避免旧路由未关闭的 overlay 阻塞新路由的返回手势。
  createEffect(() => {
    // 依赖 location 变化
    void location.pathname;
    clearOverlays();
  });

  // 监听登录过期：当 isLoggedIn 从 true 变为 false 时自动跳转登录页
  createEffect(() => {
    const loggedIn = isLoggedIn();
    const path = location.pathname;
    // 跳过启动阶段（startup 代码在 onMount 中处理了初始导航）
    if (isLoading()) return;
    if (!loggedIn && path !== "/login" && path !== "/age-confirmation") {
      navigate("/login", { replace: true });
    }
  });

  /**
   * 启动后检查更新（延迟执行，不阻塞首次渲染）。
   * 在 onMount 中的启动流程完成后调用。
   */
  onMount(async () => {
    // 滚动恢复由 @solidjs/router 内置 scrollRestoration 管理，无需手动设置

    // Show "press again to exit" toast handler
    const onExitHint = () => {
      setShowExitHint(true);
      clearTimeout(exitHintTimer);
      exitHintTimer = setTimeout(() => setShowExitHint(false), EXIT_HINT_DURATION_MS);
    };
    window.addEventListener("exitHint", onExitHint);

    // Register cleanup synchronously (before any await) so Solid tracks it properly
    let unregisterBackGesture: (() => void) | null = null;
    onCleanup(() => {
      window.removeEventListener("exitHint", onExitHint);
      clearTimeout(exitHintTimer);
      unregisterBackGesture?.();
    });

    // Load persisted preferences (async) — 并行加载
    await Promise.all([
      loadThemePreference(),
      loadAutoHideNavBarPreference(),
      loadShowR18Preference(),
      loadShowR18GPreference(),
      loadLayoutModePreference(),
      loadUgoiraModePreference(),
      loadShowDetailStairsPreference(),
      loadAgePreference(),
      loadAutoCheckUpdatePreference(),
      loadLastDismissedVersionPreference(),
      loadContentTypePreference(),
      loadImageCachePrefs(),
      loadNovelLayoutModePreference(),
      loadPageStyleThemePreference(),
    ]);

    // Load user content moderation state — 并行加载
    await Promise.all([loadReportedIds(), loadBlockedIds(), loadImageHostPreference()]);

    // 后台预热 LRU 缓存（从 Android 文件系统读取最近图片，不阻塞启动流程）
    warmCacheFromDisk();

    // Register native back gesture handler. Overlay closure is handled by backGestureStore
    // Once components push overlays in Phase 5; for now the service closes top overlay if any.
    unregisterBackGesture = await registerBackGesture({
      getPathname: () => location.pathname,
      navigateBack: () => navigate(-1),
      dispatchExitHint: () => window.dispatchEvent(new CustomEvent("exitHint")),
    });

    const [authErr] = await tryAsync(
      (async () => {
        // 如果尚未确认年龄，先导航到年龄确认页面，不进行登录判断
        if (!ageConfirmed()) {
          await navigate("/age-confirmation", { replace: true });
          return;
        }

        await initializeAuth();
        if (isLoggedIn()) {
          if (location.pathname !== "/home") {
            await navigate("/home", { replace: true });
          }
        } else {
          if (location.pathname !== "/login") {
            await navigate("/login", { replace: true });
          }
        }
      })(),
    );
    setIsLoading(false);
    // 兜底关闭 Splash：非 Feed 页面（login / age-confirmation 等）
    // 由 Login.tsx 或 Feed.tsx 负责主动触发，此处兜底确保不会泄漏
    const currentPath = location.pathname;
    if (currentPath !== "/home") {
      markContentReady();
    }
    // 启动后延迟检查更新 — 确保页面渲染完成后再弹窗
    if (autoCheckUpdate()) {
      setTimeout(() => {
        runStartupUpdateCheck();
      }, STARTUP_CHECK_DELAY_MS);
    }
    if (authErr) {
      console.error("[App] Auth initialization failed", authErr);
      navigate("/login", { replace: true });
    }
  });

  return (
    <div class="page">
      <Show
        when={!isLoading()}
        fallback={
          <div class="min-h-screen flex items-center justify-center bg-[var(--colorNeutralBackground2)]">
            <LoadingSpinner size="lg" text="加载中" />
          </div>
        }
      >
        <ErrorBoundary
          fallback={(err, reset) => (
            <div class="flex flex-col items-center justify-center min-h-screen gap-4 p-8">
              <p class="text-[var(--colorStatusDangerForeground1)] text-lg font-semibold">
                页面加载失败
              </p>
              <p class="text-[var(--colorNeutralForeground2)] text-sm text-center max-w-xs">
                {err?.message ?? "未知错误"}
              </p>
              <button
                class="px-4 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] text-sm font-medium"
                onClick={reset}
              >
                重试
              </button>
            </div>
          )}
        >
          {/* 子路由由 @solidjs/router 自动通过 props.children 传入 */}
          {props.children}
        </ErrorBoundary>
      </Show>

      {/* Exit hint toast */}
      <Show when={showExitHint()}>
        <div class="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke2)] rounded-[var(--borderRadius2XLarge)] shadow-[var(--elevation8)] px-5 py-2.5 text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] font-medium whitespace-nowrap pointer-events-none transition-all duration-[var(--durationGentle)]">
          再按一次退出应用
        </div>
      </Show>

      <StartupUpdateDialog />
    </div>
  );
};

export default RootLayout;

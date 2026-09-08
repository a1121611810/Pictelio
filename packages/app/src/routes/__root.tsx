import type { Component } from "solid-js";
import { isLoggedIn, isLoading, setIsLoading, initializeAuth } from "@/stores/authStore";
import { setIsCheckingUpdate, setCheckCompleted, loadAccountR18 } from "@/stores/settingsStore";
import { settings } from "@/settings";
import { persistScrollRestoration } from "@/stores/uiStore";
import { scrollToTop } from "@/utils/scrollToTop";
import { installStartupScrollGuard } from "@/utils/startupScrollGuard";
import {
  gateActive,
  notifyWebBundleReady,
  registerOtaResumeListener,
  runOtaCheck,
} from "@/services/otaService";
import StartupUpdateDialog from "@/components/StartupUpdateDialog";
import GateOverlay from "@/components/GateOverlay";
import { clearOverlays, registerBackGesture } from "@/services/backGestureService";
import { runBackTransition } from "@/services/backTransitionService";
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
      // 单 fetch 三重消费（#251/#256）：OTA 侧（floor/自愈/T0 预热）与 APK 弹窗信号
      // 填充全部收敛在 otaService.runOtaCheck；autoCheckUpdate 只关弹窗打扰
      await runOtaCheck();
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
    if (!loggedIn && path !== "/login") {
      navigate("/login", { replace: true });
    }
  });

  /**
   * 启动后检查更新（延迟执行，不阻塞首次渲染）。
   * 在 onMount 中的启动流程完成后调用。
   */
  onMount(async () => {
    // FT-2 冷启动反馈治理（#365 P1）：原生 splash 只承担「进程启动 + JS 引导」最前段，
    // 根布局 loading 态（品牌 LoadingSpinner 扫光动画）首帧绘制后即释放——
    // 后续等待（settings 水合 / auth 恢复 / feed 首取）全部由应用内可见进展接管，
    // 消除「静态启动窗口从进程创建一路静止到 WebView 首帧」的零反馈静止段。
    // 双 rAF：确保 spinner 首帧已实际绘制后再退出 splash，衔接处无空帧。
    // 下方 auth 流程结束后的 markContentReady 兜底保留（幂等）：后台启动等 rAF
    // 被节流的场景仍保证 splash 释放。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => markContentReady());
    });

    // 滚动恢复由 @solidjs/router 内置 scrollRestoration 管理。
    // 「持久化滚动恢复」开关关闭（默认）时：重新打开 app = 全新会话，
    // 清除跨会话滚动持久化并强制回顶，冷启动始终从顶部开始。
    // 守卫的 cleanup 挂进下方 onCleanup（组件卸载时可能仍在守卫窗口期内）。
    let removeStartupScrollGuard: (() => void) | null = null;
    if (!persistScrollRestoration()) {
      try {
        sessionStorage.removeItem("solid-router:scroll");
      } catch {
        // sessionStorage 不可用（隐私模式等）时忽略——没有持久化也就不需要清除
      }
      // Chromium 浏览器级滚动恢复（磁盘浏览数据）不经 window.scrollTo 且不受
      // history.scrollRestoration="manual" 控制，会在渲染早期把 scrollY 恢复为
      // 上次会话位置（真机实测 t≈3.5s 0→1306，触发 scroll 事件但 calls 无 scrollTo）。
      // 守卫在启动窗口内判别滚动来源：无用户交互时出现恢复特征滚动（scrollY>0）
      // 立即回顶；用户已有交互（touchstart/pointerdown/wheel，磁盘级恢复不产生
      // 这些事件）则永不回顶，避免把用户首次主动滚动误打回顶部。窗口过后自卸载。
      removeStartupScrollGuard = installStartupScrollGuard({
        isTopRequired: () => true,
        scrollToTop: () => scrollToTop(),
      });
      scrollToTop();
    }

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
      removeStartupScrollGuard?.();
    });

    // Load persisted preferences (async) — 统一由 Settings registry 批量加载。
    // FT-2（#365 P2）：水合（~数十次 Preferences 桥 IPC）与 auth 恢复（secure storage +
    // token 网络刷新）无数据依赖，二者并行——auth 不再串行等水合。唯一顺序点：
    // loadAccountR18 回写 settings 必须发生在 hydrateAll 打开写门槛（phase=warm）之后，
    // 故在 auth 分支内先 await hydrated；isLoading 释放同样以 hydrated 完成为前提
    // （保证 feed 首帧渲染时屏蔽列表/举报列表/R18 过滤等已就绪）。
    const hydrated = Promise.all([
      settings.hydrateAll(),
      loadReportedIds(),
      loadBlockedIds(),
      loadImageHostPreference(),
    ]).then(() => undefined);

    // 后台预热 LRU 缓存（从 Android 文件系统读取最近图片，不阻塞启动流程）
    warmCacheFromDisk();

    // Register native back gesture handler. Overlay closure is handled by backGestureStore
    // Once components push overlays in Phase 5; for now the service closes top overlay if any.
    unregisterBackGesture = await registerBackGesture({
      getPathname: () => location.pathname,
      // 系统返回走「动画吸收冻结」过渡（#364）：预位移 + 快照覆盖层先行动画，
      // home remount 冻结期用户看到的是过渡进行中而非冻结硬切
      navigateBack: () => runBackTransition(() => void navigate(-1)),
      dispatchExitHint: () => window.dispatchEvent(new CustomEvent("exitHint")),
      // OTA 门槛过渡面激活期间返回键 = 退出应用（#253，对齐 lynx /update 语义）
      shouldExitOnBack: () => gateActive(),
    });

    const [authErr] = await tryAsync(
      (async () => {
        await initializeAuth();
        await hydrated;
        await loadAccountR18();
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
    // 水合完成（写门槛 warm + 屏蔽/举报/R18 就绪）后才释放 isLoading 渲染内容
    await hydrated;
    setIsLoading(false);
    // 兜底关闭 Splash：非 Feed 页面（login 等）
    // 由 Login.tsx 或 Feed.tsx 负责主动触发，此处兜底确保不会泄漏
    const currentPath = location.pathname;
    if (currentPath !== "/home") {
      markContentReady();
    }
    // 健康上报（notifyReady 首帧挂点，#251）+ 回前台节流补查监听（均 native-only）
    notifyWebBundleReady();
    registerOtaResumeListener();
    // 启动后延迟检查更新 — 确保页面渲染完成后再弹窗；不再被 autoCheckUpdate 关断
    // （单 fetch 同时服务 OTA 门槛检查，门槛不受弹窗开关抑制，规格「检查与调度」）
    setTimeout(() => {
      void runStartupUpdateCheck();
    }, STARTUP_CHECK_DELAY_MS);
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
        <div class="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke2)] rounded-[var(--borderRadiusXLarge)] shadow-[var(--elevation8)] px-5 py-2.5 text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] font-medium whitespace-nowrap pointer-events-none transition-all duration-[var(--durationGentle)]">
          再按一次退出应用
        </div>
      </Show>

      <StartupUpdateDialog />
      <GateOverlay />
    </div>
  );
};

export default RootLayout;

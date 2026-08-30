// ─── OTA web bundle 调度（#251，规格 docs/specs/ota-web-bundle.md「检查与调度」） ───
// 职责：单 fetch 三重消费的 OTA 侧消费（floor 评估 + 静默安装 + 门槛自愈触发）；
// notifyReady 首帧挂点；回前台节流补查；失败指数退避。APK 弹窗消费归 __root（updateService 面）。
// 原生不可用（web/dev）时全部动作显式跳过（console.info，禁静默吞错）。
import { createSignal } from "solid-js";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import {
  checkForUpdate,
  isBelowMin,
  isNewer,
  type CheckResult,
  type FetchLike,
} from "@pictelio/update-check";
import { Ota } from "@/native/Ota";
import {
  autoCheckUpdate,
  lastDismissedVersion,
  otaAutoDownload,
  otaLastKnownFloor,
  setHasUpdate,
  setLatestChangelog,
  setLatestReleaseUrl,
  setLatestVersion,
  setOtaLastKnownFloor,
  setShowUpdateDialog,
} from "@/stores/settingsStore";

declare const APP_VERSION: string;

/** 回前台补查的最小间隔（规格：≥4h 节流） */
export const RESUME_CHECK_MIN_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** notifyReady 延迟（ms）：等路由首帧渲染完成（含骨架屏）后再上报健康 */
export const NOTIFY_READY_DELAY_MS = 500;

// ── 门槛状态机（G1：全屏过渡面的数据源，UI 呈现在 #253） ──

const [gateActive, setGateActive] = createSignal(false);
const [gateHealing, setGateHealing] = createSignal(false);
const [gateError, setGateError] = createSignal("");
const [gateFloor, setGateFloor] = createSignal<string | null>(null);

export { gateActive, gateHealing, gateError, gateFloor };

// ── 模块内状态 ──

let lastSuccessfulCheckAt = 0;
let lastGateResult: CheckResult | null = null;

/** 当前运行的 web bundle 版本 = 构建期内联的 APP_VERSION（bundle.version 与构建时
 * package.json 同源，OTA 目录名即该值；内置 bundle = APK versionName，同口径） */
function currentBundleVersion(): string {
  return APP_VERSION;
}

function nativeOrWarn(action: string): boolean {
  if (Capacitor.isNativePlatform()) return true;
  console.info(`[ota] 非原生环境跳过 ${action}（web/dev 预期）`);
  return false;
}

// ── 健康上报（notifyReady 首帧挂点） ──

/**
 * 路由首帧渲染完成后调用（含骨架屏即算就绪：语义 =「bundle 能执行到首帧」；
 * 数据加载失败不算不健康，那是 ErrorDisplay 的职责）。版本握手：内置 bundle 时
 * 原生侧按 APK versionName 校验，OTA bundle 按目录名校验——两侧都与 APP_VERSION 同源。
 */
export function notifyWebBundleReady(): void {
  if (!nativeOrWarn("notifyReady")) return;
  setTimeout(() => {
    void Ota.notifyReady({ version: APP_VERSION }).catch((e) => {
      console.warn("[ota] notifyReady 上报失败（回滚判定将走超时路径）:", e);
    });
  }, NOTIFY_READY_DELAY_MS);
}

// ── 检查与调度 ──

/**
 * 启动/回前台共用的检查编排。单次 fetch 三重消费：返回值供 __root 驱动 APK 弹窗
 * （autoCheckUpdate 开关在弹窗侧把关），floor 评估与 T0 静默安装在本模块内完成。
 * silent=true 时仅更新内部状态（回前台补查不弹任何窗）。
 */
export async function runOtaCheck(
  fetchImpl?: FetchLike,
  silent = false,
): Promise<CheckResult | null> {
  const result = await checkForUpdate(APP_VERSION, fetchImpl);
  if (!result.error) {
    lastSuccessfulCheckAt = Date.now();
  }
  lastGateResult = result;
  await evaluateGateAndHeal(result);
  if (!gateActive()) {
    void maybeSilentInstall(result);
  }
  if (silent) {
    return null; // 回前台补查：全程静默，不喂弹窗
  }
  // 三重消费之 APK 弹窗面（autoCheckUpdate 只关弹窗打扰，不关门槛检查）：
  // 「前往下载」按钮依赖 latestReleaseUrl，故信号填充与门槛评估同源同处
  setHasUpdate(result.hasUpdate);
  setLatestVersion(result.latestVersion);
  setLatestReleaseUrl(result.latestReleaseUrl);
  setLatestChangelog(result.latestChangelog);
  if (
    autoCheckUpdate() &&
    result.hasUpdate &&
    result.latestVersion &&
    result.latestVersion !== lastDismissedVersion()
  ) {
    setShowUpdateDialog(true);
  }
  return result;
}

/**
 * floor 评估（fail-open 显式化）：远端 minWebVersion 优先；检查失败回退本地缓存 floor
 * （显式 warn——floor 未知被当「不设门槛」是行为决策，必须可见，禁 ?? 兜底）。
 */
async function evaluateGateAndHeal(result: CheckResult): Promise<void> {
  let floor: string | null = null;
  if (result.error) {
    const cached = otaLastKnownFloor();
    if (cached) {
      console.warn("[ota] 检查失败，使用本地缓存 floor 评估（fail-open 走缓存）:", result.error);
      floor = cached;
    } else {
      console.warn("[ota] 检查失败且无缓存 floor，不设门槛（fail-open）:", result.error);
    }
  } else if (result.minWebVersion) {
    floor = result.minWebVersion;
    await setOtaLastKnownFloor(floor);
  }
  setGateFloor(floor);
  if (floor && isBelowMin(currentBundleVersion(), floor)) {
    console.warn(
      `[ota] 门槛命中：当前 bundle ${currentBundleVersion()} < floor ${floor} → 触发自愈`,
    );
    setGateActive(true);
    setGateError("");
    void selfHeal();
  } else {
    setGateActive(false);
    setGateError("");
  }
}

/**
 * G1 自愈（前台直连快路径）：install 成功即 applyNow + reload 进新版；
 * 失败置 gateError（#253 全屏过渡面的阻断态数据源），重试由 UI 触发或回前台补查。
 */
export async function selfHeal(): Promise<boolean> {
  if (!nativeOrWarn("selfHeal")) {
    return false;
  }
  const urlBase = lastGateResult?.webBundle?.url;
  if (!urlBase) {
    console.warn("[ota] 自愈无可用 bundle 元数据（webBundle 缺失），转阻断态");
    setGateError("无可用更新包");
    setGateHealing(false);
    return false;
  }
  setGateHealing(true);
  try {
    const r = await Ota.install({ urlBase });
    console.info(`[ota] 自愈下载成功 version=${r.version} → applyNow + reload`);
    setGateError("");
    setGateHealing(false);
    await Ota.applyNow();
    location.reload();
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // T3 逆向门槛：最新 bundle 声明的 minApkVersion > 本机 → 拒装转 L2 温和弹窗通道
    // （不阻断使用旧 bundle，规格「门槛 UX」T3 行）；其余失败转同屏阻断态（T2）
    if (msg.includes("apk-too-old")) {
      console.warn("[ota] T3：bundle 要求更新宿主 APK，撤销门槛转 APK 弹窗通道");
      setGateActive(false);
      setGateError("");
      setGateHealing(false);
      void setShowUpdateDialog(true);
      return false;
    }
    console.warn("[ota] 自愈失败，转阻断态:", msg);
    setGateError(msg);
    setGateHealing(false);
    return false;
  }
}

/**
 * T0 常规预热（下次启动生效，#252 慢通道）：webBundle 较新且非门槛态时入队 WorkManager
 * 后台下载（unique KEEP 防堆叠；瞬态失败由 Worker 指数退避重试，上限 5 次转 failure）。
 * 门槛自愈（G1 快路径）不走此处——selfHeal 用前台直连 install。
 */
async function maybeSilentInstall(result: CheckResult): Promise<void> {
  if (!nativeOrWarn("silent install")) return;
  if (!otaAutoDownload()) {
    // 用户关闭自动下载（#254）：仅报告可用版本，不写 pending（门槛自愈路径不受此开关影响）
    console.info(
      `[ota] 自动下载已关闭，报告可用 bundle ${result.webBundle?.version ?? "（无）"}，不预热`,
    );
    return;
  }
  const bundle = result.webBundle;
  if (!bundle || !bundle.version) return;
  if (!isNewer(currentBundleVersion(), bundle.version)) return;
  try {
    await Ota.prewarm({ urlBase: bundle.url });
    console.info(`[ota] 预热已入队 version=${bundle.version} → WorkManager 后台下载，下次启动生效`);
  } catch (e) {
    console.warn("[ota] 预热入队失败（下次检查再试）:", e);
  }
}

// ── E2E 测试钩子 ──

// agent-browser E2E 专用（#256）：仅 dev server 构建（import.meta.env.DEV 在生产构建被
// define 替换为 false → 死代码消除）。mockFetch 的 window 注入不跨页面 reload，无法在
// 启动检查（500ms）之前就位——暴露 runOtaCheck 让 E2E 在 mock 注入后确定性驱动门槛
// 状态机（单 fetch 三重消费与真实路径完全同代码）。
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).pictelioOtaDev = {
    runOtaCheck,
    debug: () => ({
      floor: gateFloor(),
      active: gateActive(),
      err: gateError(),
      cached: otaLastKnownFloor(),
    }),
  };
}

// ── 回前台节流补查 ──

let resumeListenerRegistered = false;

/** appStateChange 监听（authStore 先例）：回前台且距上次成功检查 ≥4h 才发请求，全程静默 */
export function registerOtaResumeListener(): void {
  if (!nativeOrWarn("resume listener")) return;
  if (resumeListenerRegistered) return;
  resumeListenerRegistered = true;
  void App.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) return;
    if (Date.now() - lastSuccessfulCheckAt < RESUME_CHECK_MIN_INTERVAL_MS) return;
    void runOtaCheck(undefined, true);
  });
}

/** 测试专用：重置模块内状态（backoff/时间戳） */
export function resetOtaStateForTest(): void {
  lastSuccessfulCheckAt = 0;
  lastGateResult = null;
  setGateActive(false);
  setGateHealing(false);
  setGateError("");
  setGateFloor(null);
}

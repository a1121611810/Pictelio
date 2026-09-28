/**
 * 回归：Lynx 客户端「启动即渲染，不白屏」（ADR-0120）。
 *
 * 曾因 router.ts ↔ 页面 ↔ stores/globalFab 循环依赖 + 模块顶层立即读 routeState，
 * 触发 ES module TDZ `Cannot access 'routeState' before initialization`，
 * 导致 web/dev 与 lynx 客户端白屏。Lynx 4.0.1 accessibility 树不暴露 view/text
 * （switch-client-roundtrip 已记录，TalkBack 绑定仍空树），故不用 Appium 元素定位，
 * 改用 logcat：boot lynx → 断言 LynxActivity 前台 + logcat 无 TDZ / loadCard failed 致命错误。
 *
 * 与 S1 契约同源：轻量 adb 驱动（run-as 扫 prefs + logcat），不依赖 Appium/WebView/token。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureEmulator } from "../avd";
import { assertDebugApkInstalled, forceStopApp, startMainActivity } from "../prefs";
import { buildDebugApk, installApk } from "../build-install";
import { adbPath, APP_PACKAGE, runCapture, runOrThrow } from "../env";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 读取 logcat，优先按 app 进程 pid 过滤，进程已死则回退全量。
 *
 * 之所以不能直接 `logcat -d`：logcat 是环形 buffer，而 `waitForActivity` 每秒一次
 * `dumpsys activity activities` 本身就会刷出大量 ActivityTaskManager/WindowManager 日志，
 * 叠加模拟器系统日志后，最早产生的 Lynx 初始化行会被**挤出 buffer**——实测 2026-09-28
 * 单引擎包上稳定复现：`logcat -d | grep LynxEnv` 为空，而按 pid 抓同一次启动
 * 立刻拿到 `I LynxEnv: LynxEnv start init` 与 `Loading native libraries succeeded`。
 * 那是**采样窗口问题**，不是渲染没发生——别据此判产品回归。
 *
 * 进程不存在时**回退全量而非抛错**：实测偶发 `Destroy timeout of remove-task` 会让
 * `am start` 拉起的进程被 ActivityManager 连带杀掉且不再拉起（ActivityTaskManager 侧
 * 无 FATAL、无崩溃栈），此时按 pid 抓会拿到空串，抛错会把这个**环境竞态**误报成
 * 产品回归。回退全量仍能拿到死前的日志，断言照常；若断言随之转红，那才是真信号。
 */
function readAppLogcat(serial: string): string {
  const pid = runCapture(adbPath(), ["-s", serial, "shell", "pidof", APP_PACKAGE]).stdout.trim();
  if (!pid) {
    console.warn(
      "[android-e2e] pidof 无输出——app 进程不在（可能是 remove-task 竞态误杀），回退抓全量 logcat",
    );
    return runCapture(adbPath(), ["-s", serial, "logcat", "-d"]).stdout;
  }
  return runCapture(adbPath(), ["-s", serial, "logcat", "-d", `--pid=${pid}`]).stdout;
}

/** 等待前台 Activity 变为期望值（adb 轮询）。 */
async function waitForActivity(
  serial: string,
  expected: string,
  timeoutMs = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const d = runCapture(adbPath(), ["-s", serial, "shell", "dumpsys", "activity", "activities"]);
    last = /ResumedActivity:\s*ActivityRecord\{[^}]*u0\s+([^\s]+)/u.exec(d.stdout)?.[1] ?? "";
    if (last.endsWith(expected)) return last;
    await SLEEP(1_000);
  }
  throw new Error(`等待 Activity ${expected} 超时（${timeoutMs / 1000}s），当前: ${last}`);
}

describe("Lynx 客户端启动即渲染（白屏回归）", () => {
  let serial: string;

  beforeAll(async () => {
    const { serial: s } = await ensureEmulator(process.env.ANDROID_E2E_AVD);
    serial = s;
    assertDebugApkInstalled(serial);
    await buildDebugApk(); // ANDROID_E2E_SKIP_BUILD=1 时跳过
    await installApk(serial);
    // 基线清空 + 启动。单引擎布局：launcher 入口恒为 LynxActivity，
    // 无需预置 client_kind（CLIENT_KINDS 已塌缩为 {"lynx"}）。
    runOrThrow(adbPath(), ["-s", serial, "shell", "pm", "clear", APP_PACKAGE], 60_000);
    forceStopApp(serial);
    // 清 logcat 基线，捕获本次启动的渲染错误（若有）
    runOrThrow(adbPath(), ["-s", serial, "logcat", "-c"]);
    startMainActivity(serial);
  }, 300_000);

  afterAll(() => {
    try {
      if (serial) forceStopApp(serial);
    } catch {
      // 收尾失败不阻断
    }
  });

  it("boot lynx → LynxActivity 前台 + logcat 有渲染初始化 + 无 TDZ / loadCard failed（不白屏）", async () => {
    await waitForActivity(serial, "LynxActivity");
    // 留出 web-core bundle 加载 + 首帧渲染时间
    await SLEEP(5_000);
    const log = readAppLogcat(serial);
    // 正向：lynx 运行时已初始化（渲染非白屏的充要信号之一；空 logcat 也算失败）
    expect(log).toMatch(/LynxEnv start init|Loading native libraries succeeded/);
    // 白屏签名：ES module TDZ / lynx loadCard 失败。出现即回归（bundle 加载即崩→白屏）。
    expect(log).not.toMatch(
      /Cannot access 'routeState'|loadCard failed|ReferenceError: Cannot access/,
    );
  }, 60_000);
});

/**
 * app-lynx 网络自检设备验收（spec docs/specs/network-self-check.md / ticket I5）。
 *
 * Lynx 4.0.1 accessibility 树不暴露 view/text，Appium 无法定位 Lynx 元素，故复用
 * ADR-0136 的 benchNav 深链：BENCH_NAV=1 构建 + `am start --es benchNav netdiag`
 * 直达 /network-check，再以原生 NetDiag 完成日志为证据（页面确实挂载并调用探测）。
 *
 * oracle：logcat 出现 Lynx 初始化 + NetDiagModule「diagnose 完成」（探测真实执行）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureEmulator } from "../avd";
import { assertDebugApkInstalled, forceStopApp, writeClientKind } from "../prefs";
import { buildDebugApk, installApk } from "../build-install";
import { adbPath, APP_PACKAGE, MAIN_ACTIVITY, runCapture, runOrThrow } from "../env";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

// benchNav 深链需要 BENCH_NAV=1 构建（lynx.config.ts 据此注入 __BENCH_NAV__）
process.env.BENCH_NAV = "1";

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
  throw new Error(
    "等待 Activity " + expected + " 超时（" + timeoutMs / 1000 + "s），当前: " + last,
  );
}

describe("android-e2e app-lynx 网络自检", () => {
  let serial: string;

  beforeAll(async () => {
    const { serial: s } = await ensureEmulator(process.env.ANDROID_E2E_AVD);
    serial = s;
    assertDebugApkInstalled(serial);
    await buildDebugApk();
    await installApk(serial);
    runOrThrow(adbPath(), ["-s", serial, "shell", "pm", "clear", APP_PACKAGE], 60_000);
    expect(writeClientKind(serial, "lynx")).toBe("lynx");
    forceStopApp(serial);
    runOrThrow(adbPath(), ["-s", serial, "logcat", "-c"]);
    // 先清 logcat，再带 benchNav 深链启动（MainActivity 读 clientKind=lynx 转发 extras 到 LynxActivity）
    runOrThrow(adbPath(), [
      "-s",
      serial,
      "shell",
      "am",
      "start",
      "-n",
      APP_PACKAGE + "/" + MAIN_ACTIVITY,
      "--es",
      "benchNav",
      "netdiag",
    ]);
  }, 600_000);

  afterAll(() => {
    try {
      forceStopApp(serial);
      writeClientKind(serial, "webview"); // 恢复默认，避免污染后续用例
    } catch {
      // 收尾失败不阻断
    }
  });

  it("benchNav 直达 /network-check，Lynx 页调用 NetDiag 原生模块完成探测", async () => {
    await waitForActivity(serial, "LynxActivity");
    // 等 benchNav 广播窗口（≤6s）+ 页面挂载 + 探测（总预算 ≤10s）
    await SLEEP(25_000);
    const log = runCapture(adbPath(), ["-s", serial, "logcat", "-d"]).stdout;
    expect(log).toMatch(/LynxEnv start init|Loading native libraries succeeded/);
    expect(log).toContain("NetDiagModule");
    expect(log).toMatch(/diagnose 完成/);
  }, 120_000);
});

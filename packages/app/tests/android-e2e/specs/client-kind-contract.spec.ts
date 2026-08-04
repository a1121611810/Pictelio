/**
 * S1 SharedPreferences 契约测试（issue #105）。
 *
 * 验证「pictelio_client_kind 写入 → MainActivity 重启读取分发」跨进程契约：
 * 1. 读真实 CapacitorStorage.xml，断言初始为默认 webview（或不存在）
 * 2. 写入 lynx → 重启 app → 断言 MainActivity 分发到 LynxActivity
 * 3. 写入 webview → 重启 app → 断言 MainActivity 留在 WebView 主界面
 *
 * 纯 adb 驱动（run-as + am + dumpsys），不需要 Appium/WebView session——
 * S1 的定位是「秒级区分写入问题 vs 分发问题」，快且独立于 UI 层。
 * 沿用「真实数据源比对」原则：读真实 shared_prefs 文件，不 mock。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertDebugApkInstalled,
  currentTopActivity,
  dumpPrefsToFile,
  forceStopApp,
  readClientPrefs,
  startMainActivity,
  writeClientKind,
} from "../prefs";
import { ensureEmulator } from "../avd";
import { buildDebugApk, installApk } from "../build-install";
import { adbPath, APP_PACKAGE, runOrThrow, TIMEOUTS } from "../env";

/** 等待前台 Activity 变为期望值（adb 轮询，不依赖 Appium） */
async function waitForActivity(serial: string, expected: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last: string | null = null;
  while (Date.now() < deadline) {
    last = currentTopActivity(serial);
    if (last === expected) return last;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`等待 Activity ${expected} 超时（${timeoutMs / 1000}s），当前: ${last}`);
}

describe("S1 SharedPreferences 契约（pictelio_client_kind → MainActivity 分发）", () => {
  let serial: string;

  beforeAll(async () => {
    // 轻量准备：AVD + 编译安装 debug APK + 清基线，不起 Appium/WebView
    const { serial: s } = await ensureEmulator(process.env.ANDROID_E2E_AVD);
    serial = s;
    assertDebugApkInstalled(serial);
    await buildDebugApk();
    await installApk(serial);
    // 清空基线：确保初始为默认 webview
    runOrThrow(adbPath(), ["-s", serial, "shell", "pm", "clear", APP_PACKAGE], TIMEOUTS.adb);
    console.log(`[S1] ✓ 基线已清空，${APP_PACKAGE} 回到初始状态`);
  }, 600_000);

  afterAll(() => {
    // 恢复到 webview 默认，避免污染后续测试
    try {
      forceStopApp(serial);
      writeClientKind(serial, "webview");
    } catch {
      // 收尾失败不阻断
    }
  });

  it("初始：CapacitorStorage 无 pictelio_client_kind（默认 webview）", async () => {
    const prefs = readClientPrefs(serial);
    dumpPrefsToFile(serial, "initial");
    // pm clear 后文件可能不存在，或存在但无该键
    expect(prefs.clientKind).toBeNull();
  });

  it("写入 lynx → 重启 → MainActivity 分发到 LynxActivity", async () => {
    const written = writeClientKind(serial, "lynx");
    expect(written).toBe("lynx");

    forceStopApp(serial);
    // 系统可能残留权限弹窗（GrantPermissionsActivity 如 TalkBack 通知权限），
    // 阻塞 Activity 分发——tap Allow 区域关闭它
    await new Promise((r) => setTimeout(r, 500));
    const { adbPath: ap } = await import("../env");
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync(ap(), ["-s", serial, "shell", "input", "tap", "500", "650"]);
    } catch {
      // 无弹窗时忽略
    }
    startMainActivity(serial);

    const activity = await waitForActivity(serial, "io.pictelio.app.LynxActivity");
    expect(activity).toBe("io.pictelio.app.LynxActivity");
  }, 60_000);

  it("写入 webview → 重启 → MainActivity 留在 WebView 主界面", async () => {
    const written = writeClientKind(serial, "webview");
    expect(written).toBe("webview");

    forceStopApp(serial);
    startMainActivity(serial);

    const activity = await waitForActivity(serial, "io.pictelio.app.MainActivity");
    expect(activity).toBe("io.pictelio.app.MainActivity");
  }, 60_000);

  it("读取真实文件：pictelio_client_kind 值可被 run-as 读到", async () => {
    // 上一用例已写入 webview，验证读回
    const prefs = readClientPrefs(serial);
    expect(prefs.fileExists).toBe(true);
    expect(prefs.clientKind).toBe("webview");
    // 原始 XML 应包含该键（真实数据源比对）
    expect(prefs.rawXml).toContain("pictelio_client_kind");
  });
});

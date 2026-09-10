/**
 * S2 双向闭环降级路径（issue #107）：pictelio_low（android-28）。
 *
 * pictelio_low 的 WebView 版本 < 85（项目 minWebviewVersion），full 包含 Lynx：
 * - WebView → Lynx 方向可达（MainActivity 的 lynx 分支在版本检查之前）；
 * - Lynx → 切回 WebView 方向：MainActivity 判 isWebViewVersionOk() 失败，但
 *   LynxRuntimeInitializer.isAvailable() 为真 → 自动降级进 LynxActivity（ADR-0153），
 *   不再停静态升级页。
 *
 * 验证：Lynx 可达 + Lynx 渲染成功 + 切回 WebView 时自动降级进 LynxActivity。
 * 用 ANDROID_E2E_AVD=pictelio_low 运行。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function enableAccessibility(ctx: AndroidE2eContext): Promise<void> {
  const { execFileSync } = await import("node:child_process");
  const { adbPath } = await import("../env");
  execFileSync(adbPath(), [
    "-s",
    ctx.serial,
    "shell",
    "settings",
    "put",
    "secure",
    "enabled_accessibility_services",
    "com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService",
  ]);
  execFileSync(adbPath(), [
    "-s",
    ctx.serial,
    "shell",
    "settings",
    "put",
    "secure",
    "accessibility_enabled",
    "1",
  ]);
}

describe("S2 降级：Lynx 可达 + 切回自动降级进 Lynx（pictelio_low）", () => {
  let ctx: AndroidE2eContext;

  beforeAll(async () => {
    ctx = await setupAndroidE2e();
    await enableAccessibility(ctx);
  }, 600_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("写入 lynx 后重启进入 LynxActivity（WebView 版本不影响 Lynx 方向）", async () => {
    const { driver } = ctx;
    const { writeClientKind, forceStopApp, startMainActivity, currentTopActivity } =
      await import("../prefs");
    writeClientKind(ctx.serial, "lynx");
    forceStopApp(ctx.serial);
    startMainActivity(ctx.serial);
    await driver.raw.waitUntil(
      async () => currentTopActivity(ctx.serial) === "io.pictelio.app.LynxActivity",
      {
        timeout: 60_000,
        timeoutMsg: "未进入 LynxActivity（pictelio_low 应可达 Lynx）",
        interval: 1_000,
      },
    );
    await driver.switchToNative();
    // Lynx 渲染断言（logcat）：无 token 时 lynx 渲染登录页（实测 2026-08-06：
    // accessibility 树空、元素定位不可靠，改用渲染日志 + 无致命错误断言）
    await SLEEP(5_000);
    const { execFileSync } = await import("node:child_process");
    const { adbPath, APP_PACKAGE } = await import("../env");
    const pid = execFileSync(adbPath(), ["-s", ctx.serial, "shell", "pidof", APP_PACKAGE])
      .toString()
      .trim();
    const logs = execFileSync(adbPath(), [
      "-s",
      ctx.serial,
      "shell",
      "logcat",
      "-d",
      "--pid",
      pid,
    ]).toString();
    expect(
      /onPageChanged|OnPatchFinishForFiber/u.test(logs),
      "Lynx 应有页面渲染日志（onPageChanged/OnPatchFinishForFiber）",
    ).toBe(true);
    const fatal =
      logs.match(
        /990200|InstantiationException|Lynx 渲染失败|bundle 加载失败|Lynx 渲染致命错误/gu,
      ) ?? [];
    expect(fatal, `Lynx 不应有致命渲染错误（实际: ${fatal.join("; ")}）`).toEqual([]);
    console.log("[S2-low] ✓ LynxActivity 可达 + Lynx 渲染成功（pictelio_low android-28）");
  }, 120_000);

  it("切回 WebView（契约层）→ 自动降级进 LynxActivity（ADR-0153）", async () => {
    const { driver } = ctx;
    const { writeClientKind, forceStopApp, startMainActivity, currentTopActivity } =
      await import("../prefs");
    const { LYNX_ACTIVITY } = await import("../env");
    writeClientKind(ctx.serial, "webview");
    forceStopApp(ctx.serial);
    startMainActivity(ctx.serial);
    // WebView 66 < 85 且 Lynx 可用 → MainActivity 不停升级页，直接降级进 LynxActivity。
    await driver.raw.waitUntil(async () => currentTopActivity(ctx.serial) === LYNX_ACTIVITY, {
      timeout: 60_000,
      timeoutMsg: "未自动降级到 LynxActivity（ADR-0153）",
      interval: 1_000,
    });
    await driver.switchToNative();
    await SLEEP(3_000);
    const src = await driver.raw.getPageSource();
    expect(
      src.includes("WebView 版本过低") || src.includes("需要 85"),
      "降级路径不应出现静态升级页文案",
    ).toBe(false);
    expect(currentTopActivity(ctx.serial)).toBe(LYNX_ACTIVITY);
    console.log("[S2-low] ✓ 切回 WebView 时自动降级进 LynxActivity（ADR-0153）");
  }, 120_000);
});

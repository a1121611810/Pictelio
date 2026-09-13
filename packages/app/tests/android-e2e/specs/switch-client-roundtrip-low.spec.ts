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
 * 用 ANDROID_E2E_AVD=pictelio_low 运行（spec 内已 pin 该缺省，见下）。
 *
 * AVD pin 根因（ADR-0159 根因 3，2026-09-13 失败轮事故）：本用例此前仅依赖
 * ANDROID_E2E_AVD 环境变量且无 pin/guard，失败轮 setup 按 KNOWN_AVDS 顺序
 * 自动选中 pictelio_ui（WebView 113 ≥ 85）——在该设备上「切回后不降级」是
 * ADR-0153 的正确行为，「未自动降级到 LynxActivity」属跑错设备的假失败；
 * 降级本身在 pictelio_low（WebView 66）实测正常。现 spec 内 pin 缺省 AVD，
 * 并在 setup 连设备之前用环境常量做整文件 skip guard。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";

/**
 * AVD pin（ADR-0159 根因 3 防回归）：
 * - 缺省 pin 到 pictelio_low。用 || 而非 ??：空字符串（CI 里 ANDROID_E2E_AVD=
 *   的常见形态）会绕过 ?? 但不该绕过本缺省（与 fab-hit-testing-regression 先例一致）；
 * - ANDROID_E2E_AVD 显式解析到其他 AVD 时，在 setup 连设备之前整文件 skip
 *   （仅环境常量判定，不访问 adb/emulator）；
 * - 非 skip 路径把 TARGET_AVD 显式传给 setupAndroidE2e（显式参数优先于 env），
 *   杜绝 setup 层按 KNOWN_AVDS 顺序（pictelio_ui 优先）自动选错设备。
 */
const TARGET_AVD = process.env.ANDROID_E2E_AVD || "pictelio_low";
const SKIPPED = TARGET_AVD !== "pictelio_low";
const SKIP_REASON =
  `本用例需要 pictelio_low（WebView < 85）验证 ADR-0153 自动降级；` +
  `当前解析到 ${TARGET_AVD}（ANDROID_E2E_AVD），已整文件跳过`;
if (SKIPPED) {
  console.log(`[switch-client-roundtrip-low] SKIP: ${SKIP_REASON}`);
}

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

describe.skipIf(SKIPPED)(
  `S2 降级：Lynx 可达 + 切回自动降级进 Lynx（pictelio_low）${SKIPPED ? `（SKIP：${SKIP_REASON}）` : ""}`,
  () => {
    let ctx: AndroidE2eContext;

    beforeAll(async () => {
      ctx = await setupAndroidE2e(TARGET_AVD);
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
  },
);

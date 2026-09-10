/**
 * webview 单引擎包降级回归（ADR-0153）：ANDROID_E2E_FLAVOR=webview + pictelio_low。
 *
 * webview 单引擎包编译期无 LynxActivity（CLIENT_KINDS = {"webview"}），WebView < 85
 * 必须停在静态升级页——引擎降级逻辑只在 full 包生效。
 *
 * 运行：
 *   ANDROID_E2E_AVD=pictelio_low ANDROID_E2E_FLAVOR=webview ANDROID_E2E_BUILD_MODE=e2e \
 *     pnpm test:android:e2e -- specs/webview-only-upgrade.spec.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";
import { E2E_FLAVOR, LYNX_ACTIVITY, MAIN_ACTIVITY } from "../env";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(E2E_FLAVOR !== "webview")(
  "webview 单引擎包：WebView < 85 停升级页（ADR-0153 回归）",
  () => {
    let ctx: AndroidE2eContext;

    beforeAll(async () => {
      ctx = await setupAndroidE2e();
    }, 600_000);

    afterAll(async () => {
      await ctx?.teardown();
    });

    it("MainActivityWebview 显示升级页，且不进入 LynxActivity", async () => {
      const { driver } = ctx;
      const { forceStopApp, startMainActivity, currentTopActivity } = await import("../prefs");
      forceStopApp(ctx.serial);
      startMainActivity(ctx.serial);
      await driver.raw.waitUntil(async () => currentTopActivity(ctx.serial) === MAIN_ACTIVITY, {
        timeout: 60_000,
        timeoutMsg: "未进入 MainActivityWebview",
        interval: 1_000,
      });
      // WebView < 85 且单引擎包无 Lynx 能力 → 升级提示页（activity_webview_error）。
      await driver.switchToNative();
      await SLEEP(3_000);
      const src = await driver.raw.getPageSource();
      const isUpgradePage = src.includes("WebView") || src.includes("升级") || src.includes("更新");
      expect(isUpgradePage, "webview 单引擎包应停在升级页").toBe(true);
      expect(currentTopActivity(ctx.serial), "单引擎包不应出现 LynxActivity").not.toBe(
        LYNX_ACTIVITY,
      );
      console.log("[webview-only] ✓ MainActivityWebview 停在升级页（无 Lynx 能力）");
    }, 120_000);
  },
);

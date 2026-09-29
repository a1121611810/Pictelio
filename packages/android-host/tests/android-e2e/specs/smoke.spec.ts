/**
 * 冒烟测试（issue #104 验收核心）：
 * 1. 完整走通 AVD 检测启动 → APK 编译安装 → Appium server → session 创建；
 * 2. 断言当前 Activity 为单引擎唯一入口 io.pictelio.app.LynxActivity
 *    （显式等待，不用固定 sleep）。
 *
 * ── 单引擎化处置（#610 后）────────────────────────────────────────────
 * 原第 3 条「NATIVE_APP ↔ WEBVIEW context 双向切换」已删除：单引擎 APK 内
 * **不存在 WebView**，实测该用例稳定失败于「等待 WEBVIEW context 超时（30s）」
 * （smoke / network-check 两条同一失败形态）。被测对象随 #610 一起消失，
 * 按「按被测对象存废处置」（与 #808 手术同一原则）删除，不改成永远 skip。
 *
 * 失败时自动收集证据（Activity / 截屏 / logcat 尾部）到 test-results/android-e2e/。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAIN_ACTIVITY } from "../env";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";

describe("android-e2e 冒烟", () => {
  let ctx: AndroidE2eContext;

  beforeAll(async () => {
    ctx = await setupAndroidE2e();
  });

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("启动 App 后当前 Activity 为 LynxActivity（单引擎唯一入口）", async () => {
    const { driver } = ctx;
    try {
      // launch() 内已 waitForActivity，这里再显式断言一次作为测试断言本体
      await driver.waitForActivity(MAIN_ACTIVITY);
      const activity = await driver.currentActivity();
      expect(activity).toBe(MAIN_ACTIVITY);
    } catch (e) {
      await driver.collectEvidence("main-activity-assert-failed").catch(() => {});
      throw e;
    }
  });
});

/**
 * 冒烟测试（issue #104 验收核心）：
 * 1. 完整走通 AVD 检测启动 → APK 编译安装 → Appium server → session 创建；
 * 2. 断言当前 Activity 为 io.pictelio.app.MainActivity（显式等待，不用固定 sleep）；
 * 3. 验证 NATIVE_APP ↔ WEBVIEW context 双向切换。
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

  it("启动 App 后当前 Activity 为 MainActivity", async () => {
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

  it("可在 NATIVE_APP 与 WEBVIEW context 间切换", async () => {
    const { driver } = ctx;
    try {
      // 初始应在 NATIVE_APP
      expect(await driver.currentContext()).toBe("NATIVE_APP");

      // 等待 WEBVIEW context 出现并切换（Capacitor WebView 加载后才会出现）
      const webviewContext = await driver.switchToWebView();
      expect(webviewContext).toContain("WEBVIEW");
      expect(await driver.currentContext()).toBe(webviewContext);

      // WEBVIEW 下应能拿到真实 DOM（SolidJS 挂载点 #root）
      await driver.raw.waitUntil(
        async () => {
          const root = await driver.raw.$("#root");
          return root.isExisting();
        },
        { timeout: 30_000, timeoutMsg: "WEBVIEW 下等待 #root 挂载超时", interval: 1_000 },
      );

      // 切回 NATIVE_APP，Activity 仍是 MainActivity
      await driver.switchToNative();
      expect(await driver.currentContext()).toBe("NATIVE_APP");
      expect(await driver.currentActivity()).toBe(MAIN_ACTIVITY);
    } catch (e) {
      await driver.collectEvidence("context-switch-failed").catch(() => {});
      throw e;
    }
  });
});

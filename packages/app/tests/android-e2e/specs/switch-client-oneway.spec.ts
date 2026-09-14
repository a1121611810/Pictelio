/**
 * S2 单向链路（issue #106）：WebView 设置页真实点击「切换渲染引擎」→ 确认 →
 * 应用退出 → 重启后断言进入 LynxActivity。
 *
 * 完整链路：WebView JS（SettingsClient.onSwitchRequest）→ setClientKind("lynx")
 * 写 SharedPreferences → App.exitApp() → 重启 → MainActivity 读 pictelio_client_kind
 * → 分发 LynxActivity。
 *
 * 依赖：
 * - PIXIV_REFRESH_TOKEN（~/.zshrc）：设置页受登录守卫保护（__root.tsx），需先登录
 * - #103 Lynx accessibility 标注（LynxActivity 可被定位）、#104 基建、#105 S1 契约工具
 *
 * 交互定位：WebdriverIO `$`/`$$` 定位器（实测 execute 在 Chromedriver 下返回值
 * 被 Appium 包裹拿不到，`$` 定位器 + getText/click 可靠）。
 *
 * 断言：关键状态全部用显式条件等待（waitUntil）或 pollPrefs 轮询，不用固定 sleep；
 * 导航 DOM 契约见 ../helpers.ts（SideNavShell 设置按钮 aria-label 语义化定位）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";
import { pollPrefs } from "../prefs";
import { clickByText, openSettingsFromHome, switchToLynxFromSettings } from "../helpers";

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("S2 单向链路：WebView → LynxActivity", () => {
  let ctx: AndroidE2eContext;

  beforeAll(async () => {
    ctx = await setupAndroidE2e();
  }, 600_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("通过年龄确认并登录", async () => {
    const { driver } = ctx;
    await driver.switchToWebView(60_000);

    // 年龄确认页（/age-confirmation）：点「已满 18 岁」通过
    await driver.raw.waitUntil(
      async () => {
        const url = await driver.raw.getUrl();
        if (!url.includes("/age-confirmation")) return true;
        await clickByText(ctx, "已满 18 岁");
        return false;
      },
      { timeout: 60_000, timeoutMsg: "年龄确认页未通过", interval: 1_000 },
    );

    // 登录页：注入 refresh_token 并点击登录
    await driver.raw.waitUntil(
      async () =>
        (await driver.raw.$("fluent-textarea").isExisting()) &&
        (await driver.raw.$("fluent-button=登录").isExisting()),
      { timeout: 30_000, timeoutMsg: "登录页未渲染", interval: 1_000 },
    );
    const token = process.env.PIXIV_REFRESH_TOKEN!;
    // fluent-textarea 是 custom element：setValue 报 invalid element state。
    // 正确方式：execute 操作其 shadow DOM 内部 <textarea>，用原生 value setter
    // + composed input 事件（探针实测 disabled 从 true → null，token 生效）
    await driver.raw.execute(
      `(() => {
        const ta = document.querySelector('fluent-textarea');
        const inner = ta && ta.shadowRoot ? ta.shadowRoot.querySelector('textarea') : null;
        if (!inner) return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(inner, ${JSON.stringify(token)});
        inner.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        inner.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      })()`,
    );
    // 条件等待：登录按钮从 disabled 变为 enabled（token 注入生效），替代固定 sleep
    await driver.raw.waitUntil(
      async () => {
        const btn = await driver.raw.$("fluent-button=登录");
        return (await btn.getAttribute("disabled")) === null;
      },
      { timeout: 10_000, timeoutMsg: "token 注入后登录按钮未启用", interval: 300 },
    );
    await clickByText(ctx, "登录");

    // 等待登录完成（离开 /login 进入主界面）
    await driver.raw.waitUntil(async () => !(await driver.raw.getUrl()).includes("/login"), {
      timeout: 90_000,
      timeoutMsg: "登录失败（仍停留在 /login）",
      interval: 2_000,
    });
    console.log(`[S2] ✓ 登录成功，当前 URL: ${await driver.raw.getUrl()}`);
  }, 180_000);

  it("导航到设置页并点击「切换渲染引擎」", async () => {
    const { driver } = ctx;
    // 新导航契约（a5e2c27c 后）：/home 点 SideNavShell 设置按钮（aria-label「设置」）
    // 直达 /settings——h1 为纯展示标题，h1.click 位置性选择器已失效
    await openSettingsFromHome(ctx);
    console.log(`[S2] ✓ 已进入设置页: ${await driver.raw.getUrl()}`);

    // 设置页点「切换渲染引擎」行 → /client-switch 说明页 → E2E 钩子确认
    //（结果契约断言 E2E-SWITCH-OK，见 helpers.switchToLynxFromSettings）
    await switchToLynxFromSettings(ctx);
    console.log("[S2] ✓ 已触发确认切换（E2E-SWITCH-OK），等待应用退出…");
  }, 120_000);

  it("应用退出后 SharedPreferences 已写 lynx", async () => {
    const { serial } = ctx;
    // 写入经 Capacitor 桥 + SharedPreferences.apply 异步落盘，单读与写入天然竞态
    // —— 落盘断言必须轮询（超时抛错并附最后一次 XML 快照，等价断言失败）
    await pollPrefs(serial, (p) => p.clientKind === "lynx", 15_000);
    console.log("[S2] ✓ 契约确认：pictelio_client_kind=lynx 已写入");
  }, 60_000);

  it("重启 App 后进入 LynxActivity", async () => {
    const { driver } = ctx;
    try {
      // 应用已退出（exitApp），手动重启走 MainActivity 入口路由
      const { forceStopApp, startMainActivity, currentTopActivity } = await import("../prefs");
      forceStopApp(ctx.serial);
      startMainActivity(ctx.serial);

      // 等待 LynxActivity 前台（S1 的 dumpsys 断言）
      await driver.raw.waitUntil(
        async () => currentTopActivity(ctx.serial) === "io.pictelio.app.LynxActivity",
        { timeout: 60_000, timeoutMsg: "重启后未进入 LynxActivity", interval: 1_000 },
      );
      expect(currentTopActivity(ctx.serial)).toBe("io.pictelio.app.LynxActivity");
      console.log("[S2] ✓ 重启后已进入 LynxActivity");
    } catch (e) {
      await ctx.driver.collectEvidence("lynx-launch-failed").catch(() => {});
      throw e;
    }
  }, 90_000);
});

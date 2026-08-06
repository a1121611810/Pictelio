/**
 * S2 双向闭环（issue #107）：WebView → Lynx → 切回 WebView。
 *
 * 实测（2026-08-05）：Lynx 4.0.1 的 accessibility 树只暴露表单元素
 * （input/EditText），view/text 容器节点不暴露（即使标注 accessibility-element +
 * accessibility-label）——Lynx 登录按钮、导航入口、Me 页「切换客户端到WebView」
 * 均无法被 Appium 定位。因此 Lynx 侧完整 UI 操作（登录→导航→点击切回）在
 * 当前 SDK 下不可自动化。
 *
 * 调整后的验证策略（覆盖切换链路全部五段，Lynx 侧 UI 操作受限部分用日志/契约层兜底）：
 * 1. WebView 登录 → 设置页 → 点切换 → 写 lynx → 重启（真实 UI 点击，复用 #106）
 * 2. LynxActivity 可达 + Lynx 渲染成功（logcat 断言：渲染日志存在 + 无致命错误）。
 *    #126/#127 修复后 lynx 从 WSSecureStorage 恢复登录态渲染主界面（非登录页）；
 *    Lynx 4.0.1 accessibility 树在本模拟器不暴露内容节点（实测 2026-08-06，
 *    TalkBack 已绑定仍空树）——「登录页 input 可定位」为修复前行为，已过时。
 * 3. 反向切回用 S1 契约层：写 webview → 重启 → MainActivity → WebView 主界面
 *    （等价于 Lynx 内「切换客户端到WebView」按钮的契约效果）
 *
 * Lynx 侧 UI 自动化的 SDK 限制已记录，留待 Lynx 升级或无障碍暴露修复后补全。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";
import { readClientPrefs } from "../prefs";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 启用系统无障碍服务（Lynx accessibility 树暴露前提，表单元素可定位）。
 *  启用 TalkBack 后 Android 会弹「允许通知」权限询问（阻塞后续 Activity 分发），
 *  这里预授权通知权限 + 处理可能残留的弹窗。 */
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
  // TalkBack 通知权限预授权（否则弹「允许通知」权限询问，阻塞 Activity 分发）
  execFileSync(adbPath(), [
    "-s",
    ctx.serial,
    "shell",
    "pm",
    "grant",
    "com.google.android.marvin.talkback",
    "android.permission.POST_NOTIFICATIONS",
  ]);
  // 处理可能残留的通知权限弹窗（GrantPermissionsActivity）：点 Allow（屏幕中上部）
  try {
    execFileSync(adbPath(), ["-s", ctx.serial, "shell", "input", "tap", "500", "650"]);
  } catch {
    // 无弹窗时 tap 无效，忽略
  }
}

describe("S2 双向闭环：WebView → Lynx → 切回 WebView（pictelio_ui）", () => {
  let ctx: AndroidE2eContext;

  beforeAll(async () => {
    ctx = await setupAndroidE2e();
    await enableAccessibility(ctx);
  }, 600_000);

  afterAll(async () => {
    await ctx?.teardown();
  });

  it("WebView 登录并切换到 Lynx（真实 UI 点击，复用 #106）", async () => {
    const { driver } = ctx;
    await driver.switchToWebView(60_000);

    // 串行执行隔离：前序 spec 可能留下 app 在非初始状态。
    // 若不在登录/年龄确认页（如已登录），先登出回到初始（pm clear + 重启）。
    const bootUrl = await driver.raw.getUrl().catch(() => "");
    if (!bootUrl.includes("/age-confirmation") && !bootUrl.includes("/login")) {
      const { forceStopApp, writeClientKind } = await import("../prefs");
      writeClientKind(ctx.serial, "webview");
      forceStopApp(ctx.serial);
      const { startMainActivity, currentTopActivity } = await import("../prefs");
      startMainActivity(ctx.serial);
      await driver.raw.waitUntil(
        async () => currentTopActivity(ctx.serial) === "io.pictelio.app.MainActivity",
        { timeout: 30_000, interval: 1_000 },
      );
      await driver.switchToWebView(30_000);
      console.log("[S2] 串行隔离：已重置 app 到初始状态");
    }

    // 年龄确认
    await driver.raw.waitUntil(
      async () => {
        const url = await driver.raw.getUrl();
        if (!url.includes("/age-confirmation")) return true;
        const btn = await driver.raw.$("fluent-button=已满 18 岁");
        if (await btn.isExisting()) await btn.click();
        return false;
      },
      { timeout: 60_000, interval: 1_000 },
    );

    // 登录
    await driver.raw.waitUntil(
      async () =>
        (await driver.raw.$("fluent-textarea").isExisting()) &&
        (await driver.raw.$("fluent-button=登录").isExisting()),
      { timeout: 30_000, timeoutMsg: "登录页未渲染", interval: 1_000 },
    );
    const token = process.env.PIXIV_REFRESH_TOKEN!;
    await driver.raw.execute(
      `(() => {
        const ta = document.querySelector('fluent-textarea');
        const inner = ta && ta.shadowRoot ? ta.shadowRoot.querySelector('textarea') : null;
        if (!inner) return;
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(inner, ${JSON.stringify(token)});
        inner.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        inner.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      })()`,
    );
    await driver.raw.waitUntil(
      async () => (await driver.raw.$("fluent-button=登录").getAttribute("disabled")) === null,
      { timeout: 10_000, timeoutMsg: "token 注入后登录按钮未启用", interval: 300 },
    );
    await driver.raw.$("fluent-button=登录").click();
    await driver.raw.waitUntil(async () => !(await driver.raw.getUrl()).includes("/login"), {
      timeout: 90_000,
      timeoutMsg: "登录失败（仍停留在 /login）",
      interval: 2_000,
    });
    console.log(`[S2] ✓ WebView 登录成功: ${await driver.raw.getUrl()}`);

    // 导航到设置页
    await driver.raw.execute(
      `(() => { const h = document.querySelector('h1'); if (h) h.click(); })()`,
    );
    await SLEEP(3_000);
    await driver.raw.execute(
      `(() => { const el = document.querySelector("[aria-label='设置']"); if (el) el.click(); })()`,
    );
    await SLEEP(3_000);
    await driver.raw.waitUntil(async () => (await driver.raw.getUrl()).includes("/settings"), {
      timeout: 30_000,
      timeoutMsg: "未进入设置页",
      interval: 1_000,
    });
    // 点切换 + E2E 钩子确认
    await driver.raw.waitUntil(
      async () => await driver.raw.$("[aria-label='切换渲染引擎']").isExisting(),
      { timeout: 10_000, interval: 500 },
    );
    await driver.raw.execute(
      `(() => { const el = document.querySelector("[aria-label='切换渲染引擎']"); if (el) el.click(); })()`,
    );
    // T2 起：点击入口行 → 跳转说明页 /client-switch（不再是确认弹窗）
    await driver.raw.waitUntil(
      async () => (await driver.raw.getUrl().catch(() => "")).includes("/client-switch"),
      { timeout: 10_000, timeoutMsg: "未跳转到 /client-switch 说明页", interval: 500 },
    );
    await driver.raw.waitUntil(
      async () => await driver.raw.$("fluent-button=确认切换").isExisting(),
      { timeout: 10_000, timeoutMsg: "说明页确认切换按钮未出现", interval: 500 },
    );
    await driver.raw.execute(
      `(() => { const e2e = (window).pictelioE2e; if (e2e && e2e.confirmSwitchClient) { e2e.confirmSwitchClient(); document.title = 'E2E-HOOK-CALLED'; } else { document.title = 'E2E-HOOK-MISSING'; } })()`,
    );
    // execute 返回值被 Chromedriver 包裹不可靠，用 title 读回钩子状态
    const hookTitle = (await driver.raw.getTitle()) as string;
    expect(hookTitle, "E2E 钩子应存在（--mode e2e 构建）").toBe("E2E-HOOK-CALLED");
    await SLEEP(2_000);

    const prefs = readClientPrefs(ctx.serial);
    expect(prefs.clientKind, "pictelio_client_kind 应为 lynx").toBe("lynx");
  }, 180_000);

  it("LynxActivity 可达 + Lynx 渲染成功（logcat 断言，无致命错误）", async () => {
    const { driver } = ctx;
    const { forceStopApp, startMainActivity, currentTopActivity } = await import("../prefs");
    // 应用已退出（exitApp），重启进入 LynxActivity
    forceStopApp(ctx.serial);
    startMainActivity(ctx.serial);
    await driver.raw.waitUntil(
      async () => currentTopActivity(ctx.serial) === "io.pictelio.app.LynxActivity",
      { timeout: 60_000, timeoutMsg: "未进入 LynxActivity", interval: 1_000 },
    );
    // Lynx 渲染断言：logcat 确认渲染发生 + 无致命错误。
    // 实测（2026-08-06）：#126/#127 修复后 lynx 能从 WSSecureStorage 恢复登录态
    // （PictelioAuth.loginWithRefreshToken 调用），渲染主界面而非登录页；且
    // Lynx 4.0.1 accessibility 树在本模拟器不暴露内容节点（TalkBack 已绑定仍空树）
    // ——故不再断言「登录页 input 可定位」（修复前行为，已过时），改用日志断言。
    await driver.switchToNative();
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
      logs.match(/990200|InstantiationException|Lynx 渲染失败|bundle 加载失败|Lynx 渲染致命错误/gu) ?? [];
    expect(fatal, `Lynx 不应有致命渲染错误（实际: ${fatal.join("; ")}）`).toEqual([]);
    console.log("[S2] ✓ LynxActivity 可达 + Lynx 渲染成功（日志确认，无致命错误）");
  }, 120_000);

  it("反向切回（契约层）：写 webview → 重启 → WebView 主界面", async () => {
    const { driver } = ctx;
    const { writeClientKind, forceStopApp, startMainActivity, currentTopActivity } =
      await import("../prefs");
    // Lynx 内「切换客户端到WebView」按钮的契约效果（SDK 限制无法 UI 点击，用契约层等价验证）
    writeClientKind(ctx.serial, "webview");
    forceStopApp(ctx.serial);
    startMainActivity(ctx.serial);
    await driver.raw.waitUntil(
      async () => currentTopActivity(ctx.serial) === "io.pictelio.app.MainActivity",
      { timeout: 60_000, timeoutMsg: "切回后未进入 MainActivity", interval: 1_000 },
    );
    // WebView 主界面渲染断言
    await driver.switchToWebView(30_000);
    await driver.raw.waitUntil(
      async () => {
        const url = await driver.raw.getUrl().catch(() => "");
        return url.includes("/home") || url.includes("/recommended");
      },
      { timeout: 30_000, timeoutMsg: "WebView 主界面未渲染", interval: 1_000 },
    );
    console.log("[S2] ✓ 双向闭环完成：回到 WebView 主界面");
  }, 120_000);
});

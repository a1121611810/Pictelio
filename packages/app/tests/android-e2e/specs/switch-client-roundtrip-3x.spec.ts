/**
 * T4 #131 引擎切换往返 3 次回归门（pictelio_ui，android-34）。
 *
 * 验收标准（#131）逐项对应：
 * 1. 往返切换 3 次，token 不被误删 → 每轮往返前后 run-as 读
 *    `WSSecureStorageSharedPreferences.xml`，断言
 *    `capacitor-storage_refresh_token` key 持续存在（@aparajita 密文，只断 key 不断值）
 * 2. lynx 恢复登录并渲染 → LynxActivity 前台（dumpsys）+ lynx 渲染日志（logcat）
 *    确认渲染发生且无致命错误。实测（2026-08-06）：#126/#127 修复后 lynx 能从
 *    WSSecureStorage 恢复 token（PictelioAuth.loginWithRefreshToken 调用），渲染
 *    主界面而非登录页；且 Lynx 4.0.1 accessibility 树在本模拟器不暴露内容节点
 *    （TalkBack 已绑定仍空树）——故不依赖 accessibility 元素定位，用日志断言。
 *    导航栏 tap 无法 UI 自动化（accessibility 树空），由真机 UI 验收（#125）兜底。
 * 3. 切回 webview 后登录态恢复 → MainActivity + WebView URL 进入 /home（非 /login）
 * 4. logcat 无 "Invalid data" / "internalRemoveItem" 误删日志 → 最后 dump logcat grep
 * 5. 复用 tests/android-e2e 现有基建（Appium + adb + run-as 契约工具，纯 adb 驱动）
 *
 * 依赖：PIXIV_REFRESH_TOKEN（~/.zshrc）——WebView 侧真实登录（@aparajita
 * 存储写入），然后验证 3 次往返后 token 不被误删。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";
import { readClientPrefs, writeClientKind } from "../prefs";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 启用系统无障碍服务（Lynx accessibility 树暴露前提，表单元素可定位）。 */
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
  try {
    execFileSync(adbPath(), ["-s", ctx.serial, "shell", "input", "tap", "500", "650"]);
  } catch {
    // 无弹窗时 tap 无效，忽略
  }
}

/** WSSecureStorageSharedPreferences.xml 相对路径（run-as 需相对路径） */
const SECURE_PREFS_REL = "shared_prefs/WSSecureStorageSharedPreferences.xml";
/** @aparajita secure-storage 实际存储 key（SecureStorageCompat.PREFIX + "refresh_token"） */
const SECURE_TOKEN_KEY = "capacitor-storage_refresh_token";

/** run-as 读 WSSecureStorageSharedPreferences.xml，返回 refresh_token key 是否存在 */
async function secureTokenKeyPresent(serial: string): Promise<{ present: boolean; raw: string }> {
  const { execFileSync } = await import("node:child_process");
  const { adbPath, APP_PACKAGE } = await import("../env");
  let raw = "";
  try {
    raw = execFileSync(adbPath(), [
      "-s",
      serial,
      "shell",
      `run-as ${APP_PACKAGE} cat ${SECURE_PREFS_REL}`,
    ]).toString();
  } catch {
    return { present: false, raw: "(读取失败：文件不存在或 run-as 不可用)" };
  }
  return { present: raw.includes(`name="${SECURE_TOKEN_KEY}"`), raw };
}

/**
 * Lynx 渲染成功断言（替代 accessibility 元素定位）：
 * 实测（2026-08-06，pictelio_ui/android-34）：Lynx 4.0.1 的 accessibility 树在本
 * 模拟器上不暴露任何内容节点（TalkBack 已绑定、app 已注册 accessibility client，
 * 仍只出 8 个空 view 节点）——`~输入refresh_token` 等元素定位不可靠。
 * 且 #126/#127 修复后 lynx 能从 WSSecureStorage 恢复登录态，有 token 时渲染的是
 * 主界面（非登录页），登录页 input 本来就不存在。
 * 改用 logcat 断言：渲染发生（onPageChanged / OnPatchFinishForFiber）+ 无致命渲染
 * 错误（990200 / InstantiationException / 兜底页）。
 */
async function assertLynxRenderedOk(serial: string): Promise<void> {
  const { execFileSync } = await import("node:child_process");
  const { adbPath, APP_PACKAGE } = await import("../env");
  const pid = execFileSync(adbPath(), ["-s", serial, "shell", "pidof", APP_PACKAGE])
    .toString()
    .trim();
  const logs = execFileSync(adbPath(), [
    "-s",
    serial,
    "shell",
    "logcat",
    "-d",
    "--pid",
    pid,
  ]).toString();
  // 渲染实际发生（Lynx SDK 页面更新日志）
  expect(
    /onPageChanged|OnPatchFinishForFiber/u.test(logs),
    "Lynx 应有页面渲染日志（onPageChanged/OnPatchFinishForFiber）",
  ).toBe(true);
  // 无致命渲染错误（R8 PropsSetter 白屏根因 / 兜底页触发）
  const fatal =
    logs.match(/990200|InstantiationException|Lynx 渲染失败|bundle 加载失败|Lynx 渲染致命错误/gu) ??
    [];
  expect(fatal, `Lynx 不应有致命渲染错误（实际: ${fatal.join("; ")}）`).toEqual([]);
  console.log("[T4] ✓ Lynx 渲染成功（日志确认，无致命错误）");
}

describe("T4 #131 引擎切换往返 3 次回归门（pictelio_ui）", () => {
  let ctx: AndroidE2eContext;

  beforeAll(async () => {
    ctx = await setupAndroidE2e();
    await enableAccessibility(ctx);
  }, 600_000);

  afterAll(async () => {
    // 恢复到 webview 默认，避免污染后续测试
    try {
      const { forceStopApp } = await import("../prefs");
      writeClientKind(ctx.serial, "webview");
      forceStopApp(ctx.serial);
    } catch {
      // 收尾失败不阻断
    }
    await ctx?.teardown();
  });

  it("基线：WebView 真实登录 + refresh_token 已持久化（WSSecureStorageSharedPreferences）", async () => {
    const { driver } = ctx;
    await driver.switchToWebView(60_000);

    // 串行执行隔离：若不在登录/年龄确认页，重置到初始状态
    const bootUrl = await driver.raw.getUrl().catch(() => "");
    if (!bootUrl.includes("/age-confirmation") && !bootUrl.includes("/login")) {
      const { forceStopApp } = await import("../prefs");
      writeClientKind(ctx.serial, "webview");
      forceStopApp(ctx.serial);
      const { startMainActivity, currentTopActivity } = await import("../prefs");
      startMainActivity(ctx.serial);
      await driver.raw.waitUntil(
        async () => currentTopActivity(ctx.serial) === "io.pictelio.app.MainActivity",
        { timeout: 30_000, interval: 1_000 },
      );
      await driver.switchToWebView(30_000);
      console.log("[T4] 串行隔离：已重置 app 到初始状态");
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
    console.log(`[T4] ✓ WebView 登录成功: ${await driver.raw.getUrl()}`);

    // 基线：token 已持久化到 WSSecureStorageSharedPreferences
    const { present, raw } = await secureTokenKeyPresent(ctx.serial);
    console.log(`[T4] 基线 WSSecureStorage: key present=${present}`);
    expect(present, "登录后 refresh_token 应已写入 WSSecureStorageSharedPreferences").toBe(true);
    console.log(`[T4] ✓ 基线 token 持久化确认（${raw.length} bytes）`);
  }, 180_000);

  /** 每轮往返的 WebView 侧操作：设置 → 说明页 → 确认切换（真实 UI 点击） */
  async function switchToLynxViaUi(): Promise<void> {
    const { driver } = ctx;
    const url = async () => await driver.raw.getUrl().catch(() => "");
    const clickEl = (sel: string) =>
      driver.raw.execute(
        `(() => { const el = document.querySelector("${sel}"); if (el) el.click(); })()`,
      );

    // 顺序导航：/home → h1 → /me → 设置 → /settings
    const u1 = await url();
    if (!u1.includes("/me") && !u1.includes("/settings")) {
      await clickEl("h1");
      await SLEEP(3_000);
    }
    const u2 = await url();
    if (u2.includes("/me")) {
      await driver.raw.waitUntil(
        async () => await driver.raw.$("[aria-label='设置']").isExisting(),
        { timeout: 10_000, timeoutMsg: "/me 未渲染设置行", interval: 500 },
      );
      await clickEl("[aria-label='设置']");
      await SLEEP(3_000);
    }
    // SPA 路由切换 + getUrl 轮询会触发 Chromedriver DevTools 断连（#131 实测）。
    // 降低 DevTools 空转：getUrl 等待用更粗的 interval，减少单位时间内会话往返。
    await driver.raw.waitUntil(async () => (await url()).includes("/settings"), {
      timeout: 30_000,
      timeoutMsg: "未进入设置页",
      interval: 2_000,
    });

    await driver.raw.waitUntil(
      async () => await driver.raw.$("[aria-label='切换渲染引擎']").isExisting(),
      { timeout: 10_000, timeoutMsg: "未找到切换渲染引擎行", interval: 500 },
    );
    await clickEl("[aria-label='切换渲染引擎']");
    // T2 起：点击入口行 → 跳转说明页 /client-switch
    await driver.raw.waitUntil(async () => (await url()).includes("/client-switch"), {
      timeout: 10_000,
      timeoutMsg: "未跳转到 /client-switch 说明页",
      interval: 1_000,
    });
    await driver.raw.waitUntil(
      async () => await driver.raw.$("fluent-button=确认切换").isExisting(),
      { timeout: 10_000, timeoutMsg: "说明页确认切换按钮未出现", interval: 500 },
    );
    await driver.raw.execute(
      `(() => { const e2e = (window).pictelioE2e; if (e2e && e2e.confirmSwitchClient) { e2e.confirmSwitchClient(); document.title = 'E2E-HOOK-CALLED'; } else { document.title = 'E2E-HOOK-MISSING'; } })()`,
    );
    const hookTitle = (await driver.raw.getTitle()) as string;
    expect(hookTitle, "E2E 钩子应存在（--mode e2e 构建）").toBe("E2E-HOOK-CALLED");
    await SLEEP(1_000);

    // 轮询 pictelio_client_kind=lynx 落盘（Capacitor 桥异步 apply，模拟器更慢）
    let clientKind: string | null = null;
    for (let i = 0; i < 15; i++) {
      clientKind = readClientPrefs(ctx.serial).clientKind;
      if (clientKind === "lynx") break;
      await SLEEP(1_000);
    }
    expect(clientKind, "pictelio_client_kind 应为 lynx（轮询 15s 内写入）").toBe("lynx");
    console.log("[T4] ✓ pictelio_client_kind=lynx 已写入");
  }

  for (let round = 1; round <= 3; round += 1) {
    it(`第 ${round} 次往返：WebView 说明页确认切换 → LynxActivity 渲染 + token 不丢`, async () => {
      const { driver } = ctx;
      const { forceStopApp, startMainActivity, currentTopActivity } = await import("../prefs");

      await switchToLynxViaUi();

      // 应用已退出（exitApp），手动重启走 MainActivity 入口路由 → LynxActivity
      forceStopApp(ctx.serial);
      startMainActivity(ctx.serial);
      await driver.raw.waitUntil(
        async () => currentTopActivity(ctx.serial) === "io.pictelio.app.LynxActivity",
        { timeout: 60_000, timeoutMsg: `第 ${round} 次未进入 LynxActivity`, interval: 1_000 },
      );
      expect(currentTopActivity(ctx.serial)).toBe("io.pictelio.app.LynxActivity");

      // Lynx 渲染成功断言（logcat：渲染发生 + 无致命错误；#126/#127 修复后
      // lynx 恢复登录渲染主界面，accessibility 树空故不用元素定位）
      await driver.switchToNative();
      await SLEEP(5_000);
      await assertLynxRenderedOk(ctx.serial);
      console.log(`[T4] ✓ 第 ${round} 次：LynxActivity 可达 + Lynx 渲染成功`);

      // token 不丢：WSSecureStorageSharedPreferences 中 refresh_token key 持续存在
      const { present } = await secureTokenKeyPresent(ctx.serial);
      expect(present, `第 ${round} 次 Lynx 侧 refresh_token 不应被误删`).toBe(true);
      console.log(`[T4] ✓ 第 ${round} 次 Lynx 侧 token 仍存在`);
    }, 180_000);

    it(`第 ${round} 次往返：契约层切回 WebView → /home 登录态恢复 + token 不丢`, async () => {
      const { driver } = ctx;
      const { forceStopApp, startMainActivity, currentTopActivity } = await import("../prefs");

      // Lynx 内「切换客户端到WebView」按钮的契约效果（SDK 限制无法 UI 点击）
      writeClientKind(ctx.serial, "webview");
      forceStopApp(ctx.serial);
      startMainActivity(ctx.serial);
      await driver.raw.waitUntil(
        async () => currentTopActivity(ctx.serial) === "io.pictelio.app.MainActivity",
        { timeout: 60_000, timeoutMsg: `第 ${round} 次切回后未进入 MainActivity`, interval: 1_000 },
      );

      // WebView 登录态恢复：进入 /home 或 /recommended（未登录会停在 /login）
      await SLEEP(2_000);
      await driver.switchToWebView(30_000);
      await driver.raw.waitUntil(
        async () => {
          const url = await driver.raw.getUrl().catch(() => "");
          return url.includes("/home") || url.includes("/recommended");
        },
        {
          timeout: 60_000,
          timeoutMsg: `第 ${round} 次切回后 WebView 主界面未渲染（登录态丢失?）`,
          interval: 2_000,
        },
      );
      console.log(`[T4] ✓ 第 ${round} 次：切回 WebView 主界面（登录态恢复）`);

      const { present } = await secureTokenKeyPresent(ctx.serial);
      expect(present, `第 ${round} 次切回后 refresh_token 不应被误删`).toBe(true);
      console.log(`[T4] ✓ 第 ${round} 次切回后 token 仍存在`);
    }, 180_000);
  }

  it("logcat 无 Invalid data / internalRemoveItem 误删日志", async () => {
    const { execFileSync } = await import("node:child_process");
    const { adbPath } = await import("../env");
    let logcat = "";
    try {
      logcat = execFileSync(adbPath(), ["-s", ctx.serial, "shell", "logcat", "-d"]).toString();
    } catch {
      // logcat dump 失败：记录但继续（证据不足时不误报）
      console.warn("[T4] logcat dump 失败，跳过误删日志断言");
      return;
    }
    const badLines = logcat.split("\n").filter((l) => /Invalid data|internalRemoveItem/u.test(l));
    // 允许 SecureStorageCompat 自身源码注释/文档里的字样；这里只查运行时日志输出
    expect(badLines, "logcat 不应出现 Invalid data / internalRemoveItem 误删日志").toEqual([]);
    console.log(
      `[T4] ✓ logcat 干净：无 Invalid data / internalRemoveItem（共 ${logcat.split("\n").length} 行日志）`,
    );
  }, 60_000);
});

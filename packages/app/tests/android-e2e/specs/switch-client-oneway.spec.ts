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
 * 断言：关键状态用显式等待（waitUntil/waitFor）；少量固定等待仅用于
 * SPA 路由切换动画与原生退出时序（页面过渡 ~300ms、exitApp ~600ms）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";
import { readClientPrefs } from "../prefs";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** WebView 内按文本点击（`$` 定位器 + execute DOM click 兜底，覆盖自定义元素/不可交互元素） */
async function clickByText(ctx: AndroidE2eContext, text: string): Promise<boolean> {
  const { driver } = ctx;
  // fluent-button 有 shadow DOM，textContent 在 light DOM slot 里；优先 fluent-button=
  try {
    if (await driver.raw.$(`fluent-button=${text}`).isExisting()) {
      await driver.raw.$(`fluent-button=${text}`).click();
      return true;
    }
  } catch {
    // interactable 失败走 execute 兜底
  }
  try {
    if (await driver.raw.$(`button=${text}`).isExisting()) {
      await driver.raw.$(`button=${text}`).click();
      return true;
    }
  } catch {
    // interactable 失败走 execute 兜底
  }
  // 通用 fallback：execute 遍历元素（文本或 aria-label 匹配）直接 DOM click，
  // 绕过 $ 的 interactable 检查（custom element / 滚动容器内元素）。
  // execute 返回值被 Chromedriver 包裹不可靠读取，靠后续断言验证效果。
  await driver.raw.execute(
    `(() => {
      const els = [...document.querySelectorAll('button, fluent-button, [role="button"], [aria-label], div, span')];
      const el = els.find((n) =>
        (n.textContent && n.textContent.trim().includes(${JSON.stringify(text)})) ||
        n.getAttribute && n.getAttribute('aria-label') === ${JSON.stringify(text)}
      );
      if (el) { el.click(); return 'clicked'; }
      return 'not-found';
    })()`,
  );
  return true;
}

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
      async () => (await driver.raw.$("fluent-textarea").isExisting()) && (await driver.raw.$("fluent-button=登录").isExisting()),
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
    await driver.raw.waitUntil(
      async () => !(await driver.raw.getUrl()).includes("/login"),
      { timeout: 90_000, timeoutMsg: "登录失败（仍停留在 /login）", interval: 2_000 },
    );
    console.log(`[S2] ✓ 登录成功，当前 URL: ${await driver.raw.getUrl()}`);
  }, 180_000);

  it("导航到设置页并点击「切换渲染引擎」", async () => {
    const { driver } = ctx;
    // 顺序导航（诊断验证）：/home → h1.click → /me → 设置行.click → /settings
    // 减少 getUrl 轮询频率（频繁 getUrl + SPA 切换会导致 Chromedriver DevTools 断开）
    const url = async () => (await driver.raw.getUrl().catch(() => ""));
    const clickEl = (sel: string) =>
      driver.raw.execute(`(() => { const el = document.querySelector("${sel}"); if (el) el.click(); })()`);

    // 若在 /home 或 feed 页：点击 h1 进 /me
    const u1 = await url();
    if (!u1.includes("/me") && !u1.includes("/settings")) {
      await clickEl("h1");
      await SLEEP(3_000);
    }
    // 若在 /me：点击设置行进 /settings
    const u2 = await url();
    if (u2.includes("/me")) {
      await driver.raw.waitUntil(
        async () => await driver.raw.$("[aria-label='设置']").isExisting(),
        { timeout: 10_000, timeoutMsg: "/me 未渲染设置行", interval: 500 },
      );
      await clickEl("[aria-label='设置']");
      await SLEEP(3_000);
    }

    // 断言进入设置页（失败时带当前 URL 诊断）
    await driver.raw.waitUntil(
      async () => (await url()).includes("/settings"),
      { timeout: 30_000, timeoutMsg: `未进入设置页（当前 URL: ${await url() || "(获取失败)"}）`, interval: 1_000 },
    );
    console.log(`[S2] ✓ 已进入设置页: ${await url()}`);

    // 找到「切换渲染引擎」行（aria-label）并点击
    await driver.raw.waitUntil(
      async () => await driver.raw.$("[aria-label='切换渲染引擎']").isExisting(),
      { timeout: 10_000, timeoutMsg: "未找到切换渲染引擎行", interval: 500 },
    );
    await clickEl("[aria-label='切换渲染引擎']");
    await SLEEP(1_000);

    // 确认对话框出现后，通过 E2E 钩子触发确认（动态 showModal dialog 内按钮
    // 无法被 WebDriver/脚本点击——浏览器级限制，真实用户触摸正常；钩子仅在
    // DEV 构建存在，生产被消除）
    await driver.raw.waitUntil(
      async () => await driver.raw.$("fluent-button=确认切换").isExisting(),
      { timeout: 10_000, timeoutMsg: "确认切换对话框未出现", interval: 500 },
    );
    await driver.raw.execute(
      `(() => {
        const e2e = (window).pictelioE2e;
        if (e2e && e2e.confirmSwitchClient) {
          e2e.confirmSwitchClient();
          document.title = 'E2E-HOOK-CALLED';
        } else {
          document.title = 'E2E-HOOK-MISSING';
        }
      })()`,
    );
    // execute 返回值被 Chromedriver 包裹不可靠，改用 title 读回钩子状态
    const title = (await driver.raw.getTitle()) as string;
    expect(title, "E2E 钩子应存在（DEV 构建）").toBe("E2E-HOOK-CALLED");
    await SLEEP(1_000);
    console.log("[S2] ✓ 已触发确认切换，等待应用退出…");
  }, 120_000);

  it("应用退出后 SharedPreferences 已写 lynx", async () => {
    const { serial } = ctx;
    await SLEEP(2_000);
    const prefs = readClientPrefs(serial);
    expect(prefs.clientKind, "pictelio_client_kind 应为 lynx").toBe("lynx");
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

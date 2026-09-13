/**
 * android-e2e 切换线 spec 共享 helper（issue #526，T4）。
 *
 * 收敛 oneway / roundtrip / 3x 三份 spec 的重复交互逻辑：
 * - WebView 内按文本 / 选择器点击（fluent-button shadow DOM + execute DOM click 兜底）
 * - /home → /settings 导航（SideNavShell 设置按钮，aria-label 语义化定位，首页直达）
 * - /settings → /client-switch 说明页确认 + E2E 钩子结果契约断言
 *
 * DOM 契约依据（a5e2c27c 重构 + ADR-0159）：
 * - /home 导航由 SideNavShell 承担（HomePage 不再渲染 NavBar / 无可点击 h1），
 *   设置按钮 aria-label = t("home.sidenav.settingsAria")（zh-CN「设置」），
 *   在 /home DOM 中唯一（「设置」其余来源仅 /me 的 personalCenter.settings 与
 *   /settings 页可见文本 settingsPage.title，均不在 /home 渲染）；
 * - h1 为纯展示标题（无 onClick），h1.click 位置性选择器已失效，禁止回潮。
 */
import { expect } from "vitest";
import type { AndroidE2eContext } from "./setup";

/** 固定等待（仅用于 logcat 采集前的渲染缓冲等无法条件等待的原生时序场景） */
export const SLEEP = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * WebView 内按 CSS 选择器 execute DOM click。
 * execute 返回值被 Chromedriver 包裹不可靠读取，效果由后续 waitUntil/断言验证；
 * querySelector 绕过 `$` 的 interactable 检查（custom element / 滚动容器内元素）。
 */
export async function clickSelector(ctx: AndroidE2eContext, selector: string): Promise<void> {
  await ctx.driver.raw.execute(
    `(() => { const el = document.querySelector("${selector}"); if (el) el.click(); })()`,
  );
}

/**
 * WebView 内按文本点击（`$` 定位器优先 + execute DOM click 兜底，
 * 覆盖 fluent-button shadow DOM / 不可交互元素）。
 */
export async function clickByText(ctx: AndroidE2eContext, text: string): Promise<boolean> {
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
  // 通用 fallback：execute 遍历元素（文本或 aria-label 匹配）直接 DOM click
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

/**
 * /home → /settings 导航：点 SideNavShell 设置按钮（aria-label「设置」，首页直达）。
 * 等待按钮渲染（顺带确认 /home 外壳就绪）→ 语义化点击 → 等 URL 进入 /settings。
 */
export async function openSettingsFromHome(ctx: AndroidE2eContext): Promise<void> {
  const { driver } = ctx;
  await driver.raw.waitUntil(async () => await driver.raw.$("[aria-label='设置']").isExisting(), {
    timeout: 30_000,
    timeoutMsg: "/home 未渲染 SideNavShell 设置按钮（aria-label=设置）",
    interval: 500,
  });
  await clickSelector(ctx, "[aria-label='设置']");
  // getUrl 轮询用粗间隔：SPA 路由切换期高频 getUrl 会触发 Chromedriver DevTools 断连（#131 实测）
  await driver.raw.waitUntil(
    async () => (await driver.raw.getUrl().catch(() => "")).includes("/settings"),
    {
      timeout: 30_000,
      timeoutMsg: "点击 SideNavShell 设置按钮后未进入 /settings",
      interval: 2_000,
    },
  );
}

/**
 * /settings → /client-switch 说明页 → 确认切换 + E2E 钩子结果契约断言（ADR-0159 决策 2）。
 *
 * 流程：等「切换渲染引擎」行 → 点击 → 等 /client-switch → 等「确认切换」按钮 →
 * 调 pictelioE2e.confirmSwitchClient()（仅 e2e 构建）→ 轮询 title 出现 E2E-SWITCH-*
 * 终态（15s）→ 断言 E2E-SWITCH-OK（非 OK / 超时的失败信息含实际 title 与 reason 诊断）。
 * 前置：已通过 openSettingsFromHome 进入 /settings。
 */
export async function switchToLynxFromSettings(ctx: AndroidE2eContext): Promise<void> {
  const { driver } = ctx;

  // 设置页「切换渲染引擎」行（aria-label = settings.client.switchEngine）
  await driver.raw.waitUntil(
    async () => await driver.raw.$("[aria-label='切换渲染引擎']").isExisting(),
    { timeout: 10_000, timeoutMsg: "设置页未找到切换渲染引擎行", interval: 500 },
  );
  await clickSelector(ctx, "[aria-label='切换渲染引擎']");

  // T2 起：点击入口行 → 跳转说明页 /client-switch（不再是确认弹窗），
  // 确认按钮与 E2E 钩子均由说明页渲染/注册
  await driver.raw.waitUntil(
    async () => (await driver.raw.getUrl().catch(() => "")).includes("/client-switch"),
    {
      timeout: 15_000,
      timeoutMsg: "点击切换渲染引擎行后未跳转 /client-switch 说明页",
      interval: 1_000,
    },
  );
  await driver.raw.waitUntil(
    async () => await driver.raw.$("fluent-button=确认切换").isExisting(),
    { timeout: 10_000, timeoutMsg: "说明页确认切换按钮未出现", interval: 500 },
  );

  // E2E 钩子（见 ClientSwitch.tsx）：调用即置 title=E2E-HOOK-CALLED，
  // 切换结算后置 E2E-SWITCH-OK / E2E-SWITCH-<REASON>
  await driver.raw.execute(`(() => {
    const e2e = (window).pictelioE2e;
    if (e2e && e2e.confirmSwitchClient) {
      e2e.confirmSwitchClient();
      document.title = 'E2E-HOOK-CALLED';
    } else {
      document.title = 'E2E-HOOK-MISSING';
    }
  })()`);
  // execute 返回值被 Chromedriver 包裹不可靠，用 title 读回结果契约
  let title = "";
  try {
    await driver.raw.waitUntil(
      async () => {
        title = (await driver.raw.getTitle()) as string;
        return title.startsWith("E2E-SWITCH-");
      },
      { timeout: 15_000, interval: 500, timeoutMsg: "切换未结算" },
    );
  } catch {
    const finalTitle = await driver.raw.getTitle().catch(() => "(getTitle 失败)");
    throw new Error(
      `E2E 钩子 15s 内未结算出 E2E-SWITCH-* 结果（实际 title: ${finalTitle}）。` +
        `诊断：E2E-HOOK-MISSING=钩子不存在（非 e2e 构建）；E2E-HOOK-CALLED=已调用但 switchClient 未结算`,
    );
  }
  expect(
    title,
    `切换应成功结算为 E2E-SWITCH-OK，实际 title: ${title}` +
      `（BUSY=切换在途 / WRITE-FAILED=写入失败 / TIMEOUT=重启编排超时 / RESTART-FAILED=重启失败）`,
  ).toBe("E2E-SWITCH-OK");
}

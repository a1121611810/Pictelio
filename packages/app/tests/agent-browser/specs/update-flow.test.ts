/**
 * 更新流程 E2E — agent-browser 版
 *
 * 覆盖"检查更新 → 更新弹窗 → 前往下载"链路（v3.21.7 回归：version.json url 字段解析）。
 * 通过注入 fetch mock 构造"远端有新版本"状态 + window.open spy 断言跳转是否真实发生，
 * 不依赖真实远端发布状态。
 *
 * 依赖：
 * - PIXIV_REFRESH_TOKEN：设置页受登录守卫保护（__root.tsx），无 token 时跳过
 * - 交互通过 evaluate 驱动（agent-browser 的 click 命令对 fluent-button 自定义元素不可靠）
 *
 * 本用例是回归防护：修复前 latestReleaseUrl 恒为空，window.open 永不执行，
 * spy 记录为空 → 断言失败；修复后 spy 应收到 release URL。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AgentBrowserDriver } from "../driver";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 用 99.0.0 保证 isNewer 判定为 true，且不会与真实发布版本/已忽略版本冲突
const MOCK_VERSION_JSON = JSON.stringify({
  version: "99.0.0",
  url: "https://github.com/a1121611810/pixivizer/releases/tag/v99.0.0",
  changelog: "E2E mock version",
});

const UPDATE_URL_PATTERN =
  "raw.githubusercontent.com/a1121611810/pixivizer/main/packages/website/version.json";

/** 通过 evaluate 点击文本匹配的按钮（fluent-button 自定义元素） */
async function clickButtonByText(driver: AgentBrowserDriver, text: string): Promise<boolean> {
  const js = `(() => {
    const btn = [...document.querySelectorAll('button, fluent-button, [role="button"]')]
      .find((el) => el.textContent && el.textContent.includes('${text}'));
    if (btn) { btn.click(); return 'clicked'; }
    return 'not-found';
  })()`;
  const result = await driver.evaluate(js);
  try {
    return JSON.parse(result) === "clicked";
  } catch {
    return false;
  }
}

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 更新流程", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = new AgentBrowserDriver();
    await driver.launch();
    await SLEEP(2500);

    // ── 年龄确认（evaluate 驱动） ──
    for (let attempt = 0; attempt < 5; attempt++) {
      const snap = await driver.snapshot();
      if (!snap.includes("年龄确认")) break;
      await clickButtonByText(driver, "已满 18 岁");
      await SLEEP(2000);
    }

    // ── 登录（evaluate 注入 token + 点击） ──
    const token = process.env.PIXIV_REFRESH_TOKEN!;
    await SLEEP(1500);
    const snap = await driver.snapshot();
    if (snap.includes("登录") && !snap.includes("推荐")) {
      const escapedToken = token.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      await driver.evaluate(
        `(() => { const ta = document.querySelector('fluent-textarea'); if (!ta) return 'no-textarea'; ta.value = '${escapedToken}'; ta.dispatchEvent(new Event('input', { bubbles: true })); return 'injected'; })()`,
      );
      await SLEEP(1000);
      await clickButtonByText(driver, "登录");
      // 等待登录完成（登录按钮消失 / 进入主界面）
      for (let attempt = 0; attempt < 10; attempt++) {
        await SLEEP(3000);
        const s = await driver.snapshot();
        if (!s.includes("登录") || s.includes("推荐")) break;
      }
    }

    // ── 进入设置页后再注入 mock/spy（页面导航会清空注入的 JS） ──
    // 启动导航（__root.tsx）会强制跳 /home，直接 navigate 子路由无效，
    // 必须走 UI 路径：/home 顶部用户名 → /me → "设置"行 → /settings
    for (let attempt = 0; attempt < 6; attempt++) {
      const s = await driver.snapshot();
      if (s.includes("检查更新") || s.includes("账户与数据")) break;
      if (s.includes("设置")) {
        // 已在个人中心：点击"设置"行
        await clickButtonByText(driver, "设置");
      } else {
        // 在 /home：点击顶部用户名（h1）进入 /me
        await driver.evaluate(
          `(() => { const h = document.querySelector('h1'); if (h) { h.click(); return 'clicked'; } return 'no-h1'; })()`,
        );
      }
      await SLEEP(2500);
    }
    await driver.mockFetch(UPDATE_URL_PATTERN, MOCK_VERSION_JSON);
    await driver.spyOnWindowOpen();
  }, 180_000);

  afterAll(async () => {
    await driver?.close();
  });

  it("设置页检查更新 → 弹窗出现 → 前往下载跳转正确 URL", async () => {
    // 点击"检查更新"
    const clicked = await clickButtonByText(driver, "检查更新");
    expect(clicked, "应能找到并点击「检查更新」按钮").toBe(true);
    await SLEEP(4000);

    // 弹窗应出现（含 mock 版本号；snapshot 为 -i 交互模式，纯文本需用 pageText）
    const snap = await driver.snapshot();
    expect(snap.includes("发现新版本"), "弹窗应显示「发现新版本」").toBe(true);
    const pageText = await driver.pageText();
    expect(
      pageText.includes("99.0.0"),
      `弹窗应显示 mock 版本号 99.0.0，实际页面文本: ${pageText.slice(0, 300)}`,
    ).toBe(true);

    // 设置页 handleCheckUpdate 发现更新时会立即 window.open（spy 第一次记录）
    let calls = await driver.getWindowOpenCalls();
    expect(calls.length, "检查更新后应触发一次跳转").toBeGreaterThanOrEqual(1);
    expect(calls[0], "跳转 URL 应指向 release 页面").toContain("releases/tag/v99.0.0");

    // 点击"前往下载"
    const dlClicked = await clickButtonByText(driver, "前往下载");
    expect(dlClicked, "应能找到并点击「前往下载」按钮").toBe(true);
    await SLEEP(2000);

    // 弹窗应关闭
    const snapAfter = await driver.snapshot();
    expect(snapAfter.includes("发现新版本"), "点击前往下载后弹窗应关闭").toBe(false);

    // handleDownload 应再次调用 window.open（spy 第二次记录）
    calls = await driver.getWindowOpenCalls();
    expect(calls.length, "点击前往下载后应再次触发跳转").toBeGreaterThanOrEqual(2);
    expect(calls[calls.length - 1], "前往下载的 URL 应指向 release 页面").toContain(
      "releases/tag/v99.0.0",
    );
  }, 120_000);
});

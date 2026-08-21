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
  url: "https://github.com/a1121611810/Pictelio/releases/tag/v99.0.0",
  changelog: "E2E mock version",
});

const UPDATE_URL_PATTERN =
  "raw.githubusercontent.com/a1121611810/Pictelio/main/packages/website/version.json";

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
    // R 类：等首屏内容渲染（页面文本非空即就绪）
    await driver.waitForPageContent(10_000);

    // ── 登录（evaluate 注入 token + 点击；ADR-0103：年龄确认已移除，冷启动直达登录页） ──
    const token = process.env.PIXIV_REFRESH_TOKEN!;
    await SLEEP(500);
    const snap = await driver.snapshot();
    if (snap.includes("登录") && !snap.includes("推荐")) {
      const escapedToken = token.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      await driver.evaluate(
        `(() => { const ta = document.querySelector('fluent-textarea'); if (!ta) return 'no-textarea'; ta.value = '${escapedToken}'; ta.dispatchEvent(new Event('input', { bubbles: true })); return 'injected'; })()`,
      );
      // S 类：输入稳定（textarea 值注入后待响应式同步），缩至 300ms
      await SLEEP(300);
      await clickButtonByText(driver, "登录");
      // 等待登录完成（登录按钮消失 / 进入主界面）
      // I 类：轮询间隔 3000ms → 500ms，次数 10 → 60，总超时上限保持 ~30s
      for (let attempt = 0; attempt < 60; attempt++) {
        await SLEEP(500);
        const s = await driver.snapshot();
        if (!s.includes("登录") || s.includes("推荐")) break;
      }
    }

    // ── 进入设置页后再注入 mock/spy（页面导航会清空注入的 JS） ──
    // 启动导航（__root.tsx）会强制跳 /home。C-shell（ADR-0075）后 /home 侧边导航
    // 「设置」为纯图标按钮（仅 aria-label，textContent 为空，文本匹配不可靠），
    // 用 aria-label 精准点击；未渲染完成时循环重试。
    // I 类：轮询间隔 2500ms → 500ms，次数 6 → 30，总超时上限保持 ~15s
    for (let attempt = 0; attempt < 30; attempt++) {
      const s = await driver.snapshot();
      if (s.includes("检查更新") || s.includes("账户与数据")) break;
      await driver.evaluate(
        `(() => { const b = document.querySelector('nav[aria-label="主导航"] button[aria-label="设置"]'); if (b) { b.click(); return 'clicked'; } return 'not-found'; })()`,
      );
      await SLEEP(500);
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
    // R 类：等更新弹窗出现（mock fetch 立即返回，弹窗文本出现即就绪）
    await driver.waitForText("发现新版本", 10_000);

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
    // S 类：弹窗关闭过渡（Fluent gentle 300ms），无稳定谓词，缩至 500ms
    await SLEEP(500);

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

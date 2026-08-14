/**
 * 验证路由迁移核心收益：导航后骨架屏先于 API 响应渲染。
 *
 * 使用 agent-browser driver 执行 E2E 验证。
 * 每步：操作 → 评估 DOM → 确定性断言（C 方向：evaluate + expect 替代 aiAssert）
 *
 * 被测行为 (@solidjs/router 同步渲染特性)：
 * - 路由匹配后立即渲染组件，不等待异步操作
 * - 骨架屏、导航栏等结构元素在 API 请求发起前即出现在 DOM 中
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createLoggedInDriver } from "../fixtures";
import type { AgentBrowserDriver } from "../driver";

// C 方向：evaluate 返回 JSON 编码的布尔字符串（"true"/"false"），统一解析为 boolean
async function evalBool(d: AgentBrowserDriver, js: string): Promise<boolean> {
  return JSON.parse(await d.evaluate(js)) === true;
}

async function getPageState(d: AgentBrowserDriver): Promise<string> {
  const snap = await d.snapshot();
  const text = await d.pageText().catch(() => "");
  return snap + "\n---页面文本---\n" + text;
}

describe("路由即时渲染", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
  }, 120_000);

  afterAll(async () => {
    await driver?.close();
  });

  it("骨架屏在 API 响应前已渲染 — 导航栏和页面框架立即可见", async () => {
    // createLoggedInDriver 登录后已导航到 /home，此时 API 请求可能仍在进行中
    // 使用 evaluate（同步 JS）检查 DOM 结构，不等待 API 响应

    // 1. 主导航（SideNavShell 侧边导航列，ADR-0075 C-shell）必须存在 — 路由渲染标记
    const navBar = await driver.evaluate(
      "document.querySelector('nav[aria-label=\"主导航\"]') !== null",
    );
    expect(navBar, "主导航(nav[aria-label=主导航])应在 API 响应前渲染").toBe("true");

    // 2. 页面 sticky 标题区必须存在（SideNavShell 右侧 sticky header）
    const header = await driver.evaluate(
      'Array.from(document.querySelectorAll("div.sticky")).length > 0',
    );
    expect(header, "页面 sticky header 应在 API 响应前渲染").toBe("true");

    // 3. 至少有一个 Tab 内容面板可见（recommended 为默认面板）
    const contentPanel = await driver.evaluate(
      "Array.from(document.querySelectorAll('[style*=\"display: block\"]')).length > 0 || Array.from(document.querySelectorAll('div')).some(el => el.innerText.includes('推荐') && el.offsetParent !== null)",
    );
    expect(contentPanel, "内容面板应在 API 响应前可见").toBe("true");

    // 4. C 方向：确定性断言替代 LLM —— 主导航渲染出 推荐/关注/收藏/历史 四个 Tab 按钮
    //（aria-label 精确匹配，保持「页面布局框架完整」的断言强度）
    const labels = JSON.parse(
      await driver.evaluate(
        '[...document.querySelectorAll(\'nav[aria-label="主导航"] button[aria-label]\')].map((b) => b.getAttribute("aria-label"))',
      ),
    ) as (string | null)[];
    for (const tab of ["推荐", "关注", "收藏", "历史"]) {
      expect(labels, `主导航应渲染「${tab}」Tab 按钮`).toContain(tab);
    }
  }, 60_000);

  it("数据加载完成后内容完整展示", async () => {
    // 条件等待：推荐 Feed 插画卡片出现后再断言完整展示（替代固定 8s）
    await driver.waitForSelector('[data-testid="illust-card"]', 15_000);

    // C 方向：确定性断言替代 LLM —— 插画卡片与缩略图已渲染、主导航存在、页面无错误提示
    const cardCount = JSON.parse(
      await driver.evaluate("document.querySelectorAll('[data-testid=illust-card]').length"),
    ) as number;
    expect(cardCount, "推荐 Feed 应加载出插画卡片瀑布流").toBeGreaterThan(0);
    const imgCount = JSON.parse(
      await driver.evaluate("document.querySelectorAll('[data-testid=illust-card] img').length"),
    ) as number;
    expect(imgCount, "插画卡片应展示作品缩略图").toBeGreaterThan(0);
    const navReady = await evalBool(
      driver,
      "document.querySelector('nav[aria-label=\"主导航\"]') !== null",
    );
    expect(navReady, "导航栏应正常渲染").toBe(true);
    const state = await getPageState(driver);
    expect(state.includes("加载失败"), "页面不应出现错误提示").toBe(false);
  }, 60_000);
});

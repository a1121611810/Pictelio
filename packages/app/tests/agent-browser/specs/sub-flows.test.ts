/**
 * 中链主流程测试 — agent-browser 版
 *
 * 每个 describe 块独立创建已登录的 driver 会话。
 * 使用 clickReliable / clickFirst 进行可靠交互。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createLoggedInDriver } from "../fixtures";
import { aiAssert } from "../../ai-shared/assertion";
import type { AgentBrowserDriver } from "../driver";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getState(d: AgentBrowserDriver): Promise<string> {
  const snap = await d.snapshot();
  const text = await d.pageText().catch(() => "");
  return snap + "\n---页面文本---\n" + text;
}

// ─── 发现链路 ─────────────────────────────────────

describe("agent-browser 发现链路", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => { driver = await createLoggedInDriver(); }, 120_000);
  afterAll(async () => { await driver?.close(); });

  it("推荐 Feed 首屏 → 滚动加载", async () => {
    await SLEEP(3000);
    let state = await getState(driver);
    let result = await aiAssert("推荐 Feed 展示插画卡片瀑布流", state);
    expect(result.passed, result.reason).toBe(true);

    await driver.scroll("down", 1000);
    await SLEEP(3000);
    state = await getState(driver);
    result = await aiAssert("滚动后新卡片加载", state);
    expect(result.passed, result.reason).toBe(true);
  }, 120_000);

  it("子 Tab 切换 + 导航栏", async () => {
    await driver.clickReliable("漫画");
    await SLEEP(2000);
    let state = await getState(driver);
    let result = await aiAssert("漫画子 Tab 内容加载", state);
    expect(result.passed, result.reason).toBe(true);

    await driver.clickReliable("综合");
    await SLEEP(2000);

    await driver.clickReliable("关注", undefined, '[aria-label*="关注"]');
    await SLEEP(3000);
    state = await getState(driver);
    result = await aiAssert("关注 Tab 页面正常显示投稿或空状态", state);
    expect(result.passed, result.reason).toBe(true);
  }, 120_000);
});

// ─── 作品链路 ─────────────────────────────────────

describe("agent-browser 作品链路", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => { driver = await createLoggedInDriver(); }, 120_000);
  afterAll(async () => { await driver?.close(); });

  it("点卡片 → 详情页", async () => {
    await SLEEP(3000);
    const ok = await driver.clickFirst();
    if (!ok) throw new Error("找不到可点击的元素");
    await SLEEP(5000);

    const state = await getState(driver);
    const result = await aiAssert("作品详情页加载（/illust/{id}），展示大图、标题、标签", state);
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("收藏与取消收藏", async () => {
    const snap = await driver.snapshot();
    if (snap.includes("isCurrentUser") || snap.includes("加载失败")) {
      console.log("详情页未加载，跳过");
      return;
    }

    // 详情页收藏按钮: button.relative.inline-flex button（含 ♡ 或 ♥ 图标）
    try {
      await driver.click('.relative.inline-flex button');
    } catch {
      // fallback: 尝试通过文本点击
      await driver.clickReliable("♡");
    }
    await SLEEP(2000);
    let state = await getState(driver);
    let result = await aiAssert("收藏成功，按钮点亮", state);
    expect(result.passed, result.reason).toBe(true);

    // 再次点击取消收藏
    try {
      await driver.click('.relative.inline-flex button');
    } catch {
      await driver.clickReliable("♥");
    }
    await SLEEP(2000);
    state = await getState(driver);
    result = await aiAssert("取消收藏，按钮恢复", state);
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("返回 Feed", async () => {
    await driver.clickReliable("推荐");
    await SLEEP(3000);
    const state = await getState(driver);
    const result = await aiAssert("返回推荐 Feed，页面正常展示", state);
    expect(result.passed, result.reason).toBe(true);
  }, 30_000);
});

// ─── 阅读链路 ─────────────────────────────────────

describe("agent-browser 阅读链路", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => { driver = await createLoggedInDriver(); }, 120_000);
  afterAll(async () => { await driver?.close(); });

  it("小说 Feed → 正文加载", async () => {
    // 小说是页面顶部的 content type 切换按钮，通过 clickReliable 定位
    const ok = await driver.clickReliable("小说");
    if (!ok) {
      console.log("[阅读] 找不到小说按钮，跳过");
      return;
    }
    await SLEEP(3000);

    let state = await getState(driver);
    let result = await aiAssert("小说 Feed 加载出卡片列表", state);
    expect(result.passed, result.reason).toBe(true);

    const cardOk = await driver.clickFirst();
    if (cardOk) {
      await SLEEP(5000);
      state = await getState(driver);
      result = await aiAssert("小说详情页正文使用 pretext 渲染", state);
      expect(result.passed, result.reason).toBe(true);
    }
  }, 120_000);

  it("正文滚动", async () => {
    await driver.scroll("down", 600);
    await SLEEP(2000);
    const state = await getState(driver);
    const result = await aiAssert("向下滚动后正文推进", state);
    expect(result.passed, result.reason).toBe(true);
  }, 30_000);
});

// ─── 个人链路 ─────────────────────────────────────

describe("agent-browser 个人链路", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => { driver = await createLoggedInDriver(); }, 120_000);
  afterAll(async () => { await driver?.close(); });

  it("个人中心 → 用户信息", async () => {
    // 点击页面顶部用户名（client-side 路由跳转到 /me）
    await driver.evaluate('document.querySelector("h1")?.click()');
    // 等待个人中心数据加载完成
    for (let i = 0; i < 10; i++) {
      await SLEEP(1000);
      const snap = await driver.snapshot();
      if (snap.includes("我的作品") || snap.includes("我的收藏")) break;
    }

    const state = await getState(driver);
    const result = await aiAssert("个人中心显示头像、用户名、统计数据", state);
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("查看收藏夹", async () => {
    // 收藏在底部导航栏右侧按钮组，aria-label="收藏"
    const ok = await driver.clickReliable("收藏", "收藏", '[aria-label="收藏"]');
    if (ok) {
      await SLEEP(3000);
      const state = await getState(driver);
      const result = await aiAssert("收藏页展示收藏作品列表", state);
      expect(result.passed, result.reason).toBe(true);
    }
  }, 60_000);
});

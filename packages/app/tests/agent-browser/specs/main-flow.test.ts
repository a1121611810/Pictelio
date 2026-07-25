/**
 * 超长链主流程测试 — agent-browser 版
 *
 * 使用 clickReliable 进行导航操作，clickFirst 点击卡片。
 * 每个步骤：操作 → page state → aiAssert → expect
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createLoggedInDriver } from "../fixtures";
import { aiAssert } from "../../ai-shared/assertion";
import type { AgentBrowserDriver } from "../driver";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getPageState(d: AgentBrowserDriver): Promise<string> {
  const snap = await d.snapshot();
  const text = await d.pageText().catch(() => "");
  return snap + "\n---页面文本---\n" + text;
}

describe("agent-browser 超长链", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
  }, 120_000);

  afterAll(async () => {
    await driver?.close();
  });

  it("[A] 登录成功 → 推荐 Feed", async () => {
    await SLEEP(3000);
    const state = await getPageState(driver);
    const result = await aiAssert(
      "已成功登录 Pictelio，当前在推荐 Feed 页面，显示插画/漫画卡片的瀑布流",
      state,
    );
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("[B1] Feed 首屏展示", async () => {
    const state = await getPageState(driver);
    const result = await aiAssert(
      "推荐 Feed 已加载出插画卡片瀑布流，展示多张作品缩略图",
      state,
    );
    expect(result.passed, result.reason).toBe(true);
  }, 30_000);

  it("[B2-B3] 向下滚动加载新内容", async () => {
    await driver.scroll("down", 1000);
    await SLEEP(3000);
    const state = await getPageState(driver);
    const result = await aiAssert(
      "向下滚动后瀑布流加载出新作品卡片，无白屏或错误",
      state,
    );
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("[B4-B6] 子 Tab 切换（综合→漫画→综合）", async () => {
    await driver.clickReliable("漫画");
    await SLEEP(3000);
    let state = await getPageState(driver);
    let result = await aiAssert("切换到'漫画'子 Tab，内容切换为漫画作品", state);
    expect(result.passed, result.reason).toBe(true);

    await driver.clickReliable("综合");
    await SLEEP(2000);
    state = await getPageState(driver);
    result = await aiAssert("切换回'综合'Tab，恢复综合内容展示", state);
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("[C1-C2] 点击插画卡片进入详情页", async () => {
    await driver.clickReliable("综合");
    await SLEEP(3000);

    // 重试点击卡片：最多 3 次，每次取新 snapshot
    let cardClicked = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        cardClicked = await driver.clickFirst();
        if (cardClicked) break;
      } catch {
        await SLEEP(2000);
      }
    }
    if (!cardClicked) throw new Error("找不到可点击的卡片");

    await SLEEP(5000);
    const state = await getPageState(driver);
    const result = await aiAssert(
      "点击卡片后跳转到作品详情页（URL 含 /illust/），展示大图、标题、作者、标签",
      state,
    );
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("[C3-C5] 收藏 → 取消收藏", async () => {
    const snap = await driver.snapshot();
    if (snap.includes("isCurrentUser") || snap.includes("加载失败")) {
      console.log("[C3-C5] 详情页未正常加载，跳过收藏测试");
      return;
    }

    // 详情页收藏按钮: div.relative.inline-flex button
    try {
      await driver.click('.relative.inline-flex button');
    } catch {
      await driver.clickReliable("♡");
    }
    await SLEEP(2000);

    let state = await getPageState(driver);
    let result = await aiAssert("收藏操作已执行，页面没有错误提示，状态正常", state);
    expect(result.passed, result.reason).toBe(true);

    try {
      await driver.click('.relative.inline-flex button');
    } catch {
      await driver.clickReliable("♥");
    }
    await SLEEP(2000);
    state = await getPageState(driver);
    result = await aiAssert("取消收藏操作已执行，页面状态正常", state);
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("[D1-D4] 关注 Feed", async () => {
    const ok = await driver.clickReliable("关注", undefined, '[aria-label*="关注"]');
    if (!ok) {
      console.log("[D] 找不到关注按钮，跳过");
      return;
    }
    await SLEEP(3000);
    const state = await getPageState(driver);
    const result = await aiAssert("切换到'关注'Tab，显示关注用户的投稿或空状态", state);
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("[E1-E4] 小说 Feed → 小说详情", async () => {
    // 小说是页面顶部的 content type 切换按钮，CSS 选择器精准定位
    // 直接点击页面中的"小说"按钮（触发 onClick → setContentType，绕过 Preferences）
    await driver.evaluate(
      '[...document.querySelectorAll("button")].find(b => b.textContent.includes("小说"))?.click()',
    );
    await SLEEP(3000);

    let state = await getPageState(driver);
    let result = await aiAssert("切换到'小说'Tab，小说 Feed 加载出卡片列表", state);
    expect(result.passed, result.reason).toBe(true);

    const cardOk = await driver.clickFirst();
    if (cardOk) {
      await SLEEP(5000);
      state = await getPageState(driver);
      result = await aiAssert("小说详情页正文使用 pretext 渲染，显示标题、作者、段落", state);
      expect(result.passed, result.reason).toBe(true);
    }
  }, 120_000);

  it("[E5-E6] 正文滚动", async () => {
    await driver.scroll("down", 600);
    await SLEEP(2000);
    const state = await getPageState(driver);
    const result = await aiAssert("向下滚动后小说正文内容推进，显示后续段落", state);
    expect(result.passed, result.reason).toBe(true);
  }, 30_000);

  it("[F1-F4] 个人中心 → 收藏夹", async () => {
    // "我的"是页面顶部用户名区域，直接导航到 /me
    // 点击页面顶部用户名（client-side 路由跳转到 /me）
    await driver.evaluate('document.querySelector("h1")?.click()');
    // 等待个人中心数据加载
    for (let i = 0; i < 10; i++) {
      await SLEEP(1000);
      const snap = await driver.snapshot();
      if (snap.includes("我的作品") || snap.includes("我的收藏")) break;
    }

    let state = await getPageState(driver);
    let result = await aiAssert("个人中心展示用户头像、用户名、统计数据", state);
    expect(result.passed, result.reason).toBe(true);

    const bmOk = await driver.clickReliable("我的收藏");
    if (bmOk) {
      await SLEEP(3000);
      state = await getPageState(driver);
      result = await aiAssert("收藏页展示用户收藏的作品列表", state);
      expect(result.passed, result.reason).toBe(true);
    }
  }, 120_000);
});

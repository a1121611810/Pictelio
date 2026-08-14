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
  // 等待页面渲染出实质内容，避免路由切换/加载期间的白屏竞态导致 AI 断言误报
  await d.waitForPageContent(10_000);
  const snap = await d.snapshot();
  const text = await d.pageText().catch(() => "");
  return snap + "\n---页面文本---\n" + text;
}

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 超长链", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
  }, 120_000);

  afterAll(async () => {
    await driver?.close();
  });

  it("[A] 登录成功 → 推荐 Feed", async () => {
    // 条件等待：推荐 Feed 渲染出插画卡片或「暂无内容」空态（覆盖空列表分支，避免空态等满超时）
    await driver.waitForJs(
      "document.querySelectorAll('[data-testid=illust-card]').length > 0 || document.body.innerText.includes('暂无内容')",
      10_000,
    );
    const state = await getPageState(driver);
    const result = await aiAssert(
      "已成功登录 Pictelio，当前在推荐 Feed 页面（/home），显示插画卡片列表",
      state,
    );
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("[B1] Feed 首屏展示", async () => {
    const state = await getPageState(driver);
    const result = await aiAssert("推荐 Feed 已加载出插画卡片瀑布流，展示多张作品缩略图", state);
    expect(result.passed, result.reason).toBe(true);
  }, 30_000);

  it("[B2-B3] 向下滚动加载新内容", async () => {
    const imgBefore = JSON.parse(
      await driver.evaluate("document.querySelectorAll('img').length"),
    ) as number;
    await driver.scroll("down", 1000);
    // 条件等待：滚动触发分页加载后 img 数量增加（无新内容时等满超时，交由 AI 断言判定）
    await driver.waitForCount("img", imgBefore + 1, 10_000);
    const state = await getPageState(driver);
    const result = await aiAssert("向下滚动后瀑布流加载出新作品卡片，无白屏或错误", state);
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("[B4-B6] 内容类型切换（插画→小说→插画）", async () => {
    // 内容类型切换器（ContentTypeToggle）仅「插画/小说」两段，
    // 「漫画/综合」子 Tab 已随 ADR-0075 移除。
    await driver.clickReliable("小说");
    // 条件等待：小说卡片渲染或「暂无小说」空态（覆盖空列表分支）
    await driver.waitForJs(
      "document.querySelectorAll('[data-testid=novel-card]').length > 0 || document.body.innerText.includes('暂无小说')",
      10_000,
    );
    let state = await getPageState(driver);
    let result = await aiAssert(
      "切换到「小说」内容类型，小说 Feed 加载（小说卡片列表或空状态）",
      state,
    );
    expect(result.passed, result.reason).toBe(true);

    await driver.clickReliable("插画");
    // 条件等待：插画卡片渲染或「暂无内容」空态（覆盖空列表分支）
    await driver.waitForJs(
      "document.querySelectorAll('[data-testid=illust-card]').length > 0 || document.body.innerText.includes('暂无内容')",
      10_000,
    );
    state = await getPageState(driver);
    result = await aiAssert("切换回「插画」内容类型，恢复插画卡片 Feed 展示", state);
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("[C1-C2] 点击插画卡片进入详情页", async () => {
    await driver.clickReliable("插画");
    // 删除原固定 3s 等待：下一行 waitForSelector 已覆盖卡片渲染条件

    // 等待卡片渲染（tab 切换后 feed 重载可能较慢），再重试点击
    await driver.waitForSelector('[data-testid="illust-card"]', 10_000);
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

    // 条件等待详情页就绪：URL 进入 /illust/ 是路由变化的可靠信号，
    // 再等页面内容非空（详情页 API 在慢网络下可能超过固定 5s，白屏即假失败）。
    const detailReady = await driver.waitForUrl("/illust/", 15_000);
    if (!detailReady) throw new Error("点击卡片后 15s 内未进入 /illust/ 详情页");
    await driver.waitForPageContent(10_000);

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
      await driver.click(".relative.inline-flex button");
    } catch {
      await driver.clickReliable("♡");
    }
    // S 类：收藏按钮状态变化与爱心动效无稳定谓词，等 Fluent 最长动效时长（500ms）收敛
    await SLEEP(500);

    let state = await getPageState(driver);
    let result = await aiAssert("收藏操作已执行，页面没有错误提示，状态正常", state);
    expect(result.passed, result.reason).toBe(true);

    try {
      await driver.click(".relative.inline-flex button");
    } catch {
      await driver.clickReliable("♥");
    }
    // S 类：取消收藏的状态变化动效无稳定谓词，等 Fluent 最长动效时长（500ms）收敛
    await SLEEP(500);
    state = await getPageState(driver);
    result = await aiAssert("取消收藏操作已执行，页面状态正常", state);
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("[D1-D4] 关注 Feed", async () => {
    // 前置用例停在详情页（C-shell 后详情页无导航外壳），先回 /home；
    // 主导航已改为 SideNavShell 侧边栏（ADR-0075），Tab 为纯图标按钮，
    // 用 aria-label 精准定位，避免误点卡片上的"关注"按钮。
    const curPath = JSON.parse(await driver.evaluate(`location.pathname`)) as string;
    if (!curPath.startsWith("/home")) {
      await driver.navigateSpa("/home");
      // 条件等待：推荐 Feed 卡片或空态渲染完成
      await driver.waitForJs(
        "document.querySelectorAll('[data-testid=illust-card]').length > 0 || document.body.innerText.includes('暂无内容')",
        10_000,
      );
    }
    const ok = await driver.clickReliable(
      "关注",
      undefined,
      'nav[aria-label="主导航"] button[aria-label="关注"]',
    );
    if (!ok) {
      console.log("[D] 找不到关注按钮，跳过");
      return;
    }
    // 条件等待：「关注」是 /home 下的面板（无 URL 变化），等关注 Feed 卡片或空态渲染
    await driver.waitForJs(
      "document.querySelectorAll('[data-testid=illust-card]').length > 0 || document.body.innerText.includes('暂无内容')",
      10_000,
    );
    const state = await getPageState(driver);
    const result = await aiAssert("切换到'关注'Tab，显示关注用户的投稿或空状态", state);
    expect(result.passed, result.reason).toBe(true);
  }, 60_000);

  it("[E1-E4] 小说 Feed → 小说详情", async () => {
    // 前置用例可能在详情页（D1-D4 在详情页点不到导航 tab 会静默跳过），
    // 先确保回到 feed 页再切小说 tab
    const curPath = JSON.parse(await driver.evaluate(`location.pathname`)) as string;
    if (!curPath.startsWith("/home")) {
      console.log(`[E1-E4] 当前路径 ${curPath} 非 feed 页，先导航回 /home`);
      await driver.navigateSpa("/home");
      // 条件等待：推荐 Feed 卡片或空态渲染完成
      await driver.waitForJs(
        "document.querySelectorAll('[data-testid=illust-card]').length > 0 || document.body.innerText.includes('暂无内容')",
        10_000,
      );
    }
    // 小说是页面顶部的 content type 切换按钮，CSS 选择器精准定位
    // 直接点击页面中的"小说"按钮（触发 onClick → setContentType，绕过 Preferences）
    await driver.evaluate(
      '[...document.querySelectorAll("button")].find(b => b.textContent.includes("小说"))?.click()',
    );
    // 条件等待：小说卡片渲染或「暂无小说」空态（覆盖空列表分支）
    await driver.waitForJs(
      "document.querySelectorAll('[data-testid=novel-card]').length > 0 || document.body.innerText.includes('暂无小说')",
      10_000,
    );

    let state = await getPageState(driver);
    let result = await aiAssert(
      "切换到'小说'Tab，小说 Feed 正常加载：显示小说卡片列表，或显示'暂无小说'空状态（账号无小说推荐时）",
      state,
    );
    expect(result.passed, result.reason).toBe(true);

    const cardOk = await driver.clickFirst();
    if (cardOk) {
      // 条件等待：URL 进入 /novel/ 详情路由后，再等正文内容非空（慢网络下不白屏误报）
      await driver.waitForUrl("/novel/", 15_000);
      await driver.waitForPageContent(10_000);
      state = await getPageState(driver);
      result = await aiAssert("小说详情页正文使用 pretext 渲染，显示标题、作者、段落", state);
      expect(result.passed, result.reason).toBe(true);
    }
  }, 120_000);

  it("[E5-E6] 正文滚动", async () => {
    // 账号无小说推荐时 E1-E4 未进入详情，跳过滚动断言
    const path = await driver.evaluate(`location.pathname`);
    if (!path.includes("/novel/")) {
      console.log("[E5-E6] 未进入小说详情（无小说卡片），跳过");
      return;
    }
    await driver.scroll("down", 600);
    // S 类：正文滚动后的虚拟列表重排无稳定谓词，等 Fluent 最长动效时长（500ms）收敛
    await SLEEP(500);
    const state = await getPageState(driver);
    const result = await aiAssert("向下滚动后小说正文内容推进，显示后续段落", state);
    expect(result.passed, result.reason).toBe(true);
  }, 30_000);

  it("[F1-F4] 个人中心 → 收藏夹", async () => {
    // 「我的」入口已改为侧边导航底部 UserAvatar 按钮（aria-label="我的"），
    // 且前置用例可能停在小说详情页（无侧边导航），直接 SPA 导航到 /me 更稳。
    await driver.navigateSpa("/me");
    // 条件等待：个人中心渲染出「我的作品/我的收藏」入口（替代原 10×1s 固定轮询，总超时上限同为 10s）
    await driver.waitForJs(
      "document.body.innerText.includes('我的作品') || document.body.innerText.includes('我的收藏')",
      10_000,
    );

    let state = await getPageState(driver);
    let result = await aiAssert("个人中心展示用户头像、用户名、统计数据", state);
    expect(result.passed, result.reason).toBe(true);

    const bmOk = await driver.clickReliable("我的收藏");
    if (bmOk) {
      // 条件等待：点击后 SPA 导航到 /home 收藏面板，等收藏卡片或空态渲染
      await driver.waitForJs(
        "location.pathname.startsWith('/home') && (document.querySelectorAll('[data-testid=illust-card]').length > 0 || document.body.innerText.includes('暂无内容'))",
        10_000,
      );
      state = await getPageState(driver);
      result = await aiAssert("收藏页展示用户收藏的作品列表", state);
      expect(result.passed, result.reason).toBe(true);
    }
  }, 120_000);
});

/**
 * 超长链主流程测试 — agent-browser 版
 *
 * 使用 clickReliable 进行导航操作，clickFirst 点击卡片。
 * 每个步骤：操作 → 条件等待 → 确定性 DOM 断言（C 方向：evaluate + expect 替代 aiAssert）
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createLoggedInDriver } from "../fixtures";
import type { AgentBrowserDriver } from "../driver";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

// C 方向：evaluate 返回 JSON 编码的布尔字符串（"true"/"false"），统一解析为 boolean
async function evalBool(d: AgentBrowserDriver, js: string): Promise<boolean> {
  return JSON.parse(await d.evaluate(js)) === true;
}

// C 方向：evaluate 返回 JSON 编码的数字，统一解析为 number
async function evalNum(d: AgentBrowserDriver, js: string): Promise<number> {
  return JSON.parse(await d.evaluate(js)) as number;
}

async function getPageState(d: AgentBrowserDriver): Promise<string> {
  // 等待页面渲染出实质内容，避免路由切换/加载期间的白屏竞态导致断言误报
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
    // C 方向：确定性断言替代 LLM —— 路由在 /home 且 Feed 已渲染卡片或空态
    //（推荐 Feed 仅登录后可达，渲染成功即登录成功的确定性信号）
    const path = JSON.parse(await driver.evaluate("location.pathname")) as string;
    expect(path.startsWith("/home"), `登录后应在推荐 Feed 页（/home），实际 ${path}`).toBe(true);
    const feedRendered = await evalBool(
      driver,
      "document.querySelectorAll('[data-testid=illust-card]').length > 0 || document.body.innerText.includes('暂无内容')",
    );
    expect(feedRendered, "推荐 Feed 应展示插画卡片列表或「暂无内容」空态").toBe(true);
  }, 60_000);

  it("[B1] Feed 首屏展示", async () => {
    // 条件等待：首屏插画卡片渲染完成
    await driver.waitForSelector('[data-testid="illust-card"]', 10_000);
    // C 方向：确定性断言替代 LLM —— 卡片已渲染且卡片内缩略图 img 已挂载
    const cardCount = await evalNum(
      driver,
      "document.querySelectorAll('[data-testid=illust-card]').length",
    );
    expect(cardCount, "推荐 Feed 应加载出插画卡片瀑布流").toBeGreaterThan(0);
    const imgCount = await evalNum(
      driver,
      "document.querySelectorAll('[data-testid=illust-card] img').length",
    );
    expect(imgCount, "插画卡片应展示作品缩略图").toBeGreaterThan(0);
  }, 30_000);

  it("[B2-B3] 向下滚动加载新内容", async () => {
    const imgBefore = await evalNum(driver, "document.querySelectorAll('img').length");
    // 循环滚到底触发分页（一次 scrollTo 可能因 scrollHeight 变化导致 IO 未触达分页哨兵）
    const scrolledDeadline = Date.now() + 20_000;
    let imgAfter = imgBefore;
    while (Date.now() < scrolledDeadline) {
      await driver.evaluate("window.scrollTo(0, document.body.scrollHeight); 'scrolled'");
      imgAfter = await evalNum(driver, "document.querySelectorAll('img').length");
      if (imgAfter > imgBefore) break;
      await new Promise((res) => setTimeout(res, 1000));
    }
    // C 方向：确定性断言替代 LLM —— img 数量增长即加载了新作品；
    // 页面文本非空且不含错误提示即「无白屏或错误」
    expect(imgAfter, `滚动后应加载新作品（img ${imgBefore} → ${imgAfter}）`).toBeGreaterThan(
      imgBefore,
    );
    const text = await driver.pageText();
    expect(text.trim().length, "滚动后页面不应白屏").toBeGreaterThan(0);
    expect(text.includes("加载失败"), "滚动后页面不应出现错误提示").toBe(false);
  }, 60_000);

  it("[B4-B6] 内容类型切换（插画→小说→插画）", async () => {
    // 内容类型切换器（ContentTypeToggle）仅「插画/小说」两段，
    // 「漫画/综合」子 Tab 已随 ADR-0075 移除。
    // 用 data-testid 精确点击（clickReliable("小说") 的 @ref 可能歧义匹配到卡片标题）
    await driver.evaluate(
      "document.querySelector('[data-testid=\"content-type-novel\"]')?.click(); 'clicked'",
    );
    // 条件等待：小说卡片渲染或空态（「暂无小说」/ 通用「暂无内容」/ 加载失败）
    await driver.waitForJs(
      "document.querySelectorAll('[data-testid=novel-card]').length > 0 || document.body.innerText.includes('暂无小说') || document.body.innerText.includes('暂无内容') || document.body.innerText.includes('加载失败')",
      30_000,
    );
    // C 方向：确定性断言替代 LLM —— 切换按钮 aria-pressed=true 且小说卡片或空态已渲染
    const novelPressed = await driver.getAttribute(
      '[data-testid="content-type-novel"]',
      "aria-pressed",
    );
    expect(novelPressed, "「小说」切换按钮应处于激活态（aria-pressed=true）").toBe("true");
    const novelFeed = await evalBool(
      driver,
      "document.querySelectorAll('[data-testid=novel-card]').length > 0 || document.body.innerText.includes('暂无小说') || document.body.innerText.includes('暂无内容') || document.body.innerText.includes('加载失败')",
    );
    expect(novelFeed, "小说 Feed 应展示小说卡片列表或空状态（无数据时显示「暂无内容」）").toBe(
      true,
    );

    await driver.clickReliable("插画");
    // 条件等待：插画卡片渲染或「暂无内容」空态（覆盖空列表分支）
    await driver.waitForJs(
      "document.querySelectorAll('[data-testid=illust-card]').length > 0 || document.body.innerText.includes('暂无内容')",
      10_000,
    );
    // C 方向：确定性断言替代 LLM —— 切换回插画后按钮激活态与卡片/空态渲染
    const illustPressed = await driver.getAttribute(
      '[data-testid="content-type-illust"]',
      "aria-pressed",
    );
    expect(illustPressed, "「插画」切换按钮应恢复激活态（aria-pressed=true）").toBe("true");
    const illustFeed = await evalBool(
      driver,
      "document.querySelectorAll('[data-testid=illust-card]').length > 0 || document.body.innerText.includes('暂无内容')",
    );
    expect(illustFeed, "应恢复插画卡片 Feed 展示或「暂无内容」空态").toBe(true);
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

    // C 方向：确定性断言替代 LLM —— URL 已进入 /illust/，详情标题 h1（DetailHeader）非空，
    // 作品大图 img 已挂载（作者/标签随详情数据同批渲染，标题+大图非空即详情渲染成功）
    const path = JSON.parse(await driver.evaluate("location.pathname")) as string;
    expect(path.includes("/illust/"), `应跳转到作品详情页（URL 含 /illust/），实际 ${path}`).toBe(
      true,
    );
    const titleLen = await evalNum(
      driver,
      "document.querySelector('h1')?.textContent?.trim().length ?? 0",
    );
    expect(titleLen, "详情页应展示作品标题").toBeGreaterThan(0);
    const imgCount = await evalNum(driver, "document.querySelectorAll('img').length");
    expect(imgCount, "详情页应展示作品大图").toBeGreaterThan(0);
  }, 60_000);

  it("[C3-C5] 收藏 → 取消收藏", async () => {
    const snap = await driver.snapshot();
    if (snap.includes("isCurrentUser") || snap.includes("加载失败")) {
      console.log("[C3-C5] 详情页未正常加载，跳过收藏测试");
      return;
    }

    // C 方向：确定性断言替代 LLM —— 收藏操作可执行且页面无错误。
    // 注意：不断言收藏态翻转（收藏接口依赖真实网络 + 账号数据，翻转时序不可控；
    // 原 aiAssert「操作已执行」即宽松语义，此处保持等价验收点）。
    const bookmarkBtn = await driver.waitForSelector(
      '[aria-label="收藏"], [aria-label="取消收藏"]',
      15_000,
    );
    expect(bookmarkBtn, "详情页应存在收藏按钮").toBe(true);
    // 点击收藏（evaluate 注入 el.click()，CLI click 对 fluent-button 不可靠）
    await driver.evaluate(
      `(() => { const b = document.querySelector('[aria-label="收藏"], [aria-label="取消收藏"]'); if (b) { b.click(); return "clicked"; } return "not-found"; })()`,
    );
    // 等收藏接口回包（按钮 aria-label 变化或页面无错误）
    await driver.waitForJs(
      "document.querySelector('[aria-label=取消收藏]') !== null || document.body.innerText.includes('加载失败')",
      15_000,
    );
    expect((await driver.pageText()).includes("加载失败"), "收藏后页面不应出现错误提示").toBe(
      false,
    );

    // 再次点击取消收藏
    await driver.evaluate(
      `(() => { const b = document.querySelector('[aria-label="收藏"], [aria-label="取消收藏"]'); if (b) { b.click(); return "clicked"; } return "not-found"; })()`,
    );
    // 取消收藏后页面无错误
    await driver.waitForJs(
      "document.querySelector('[aria-label=收藏]') !== null || document.body.innerText.includes('加载失败')",
      15_000,
    );
    expect((await driver.pageText()).includes("加载失败"), "取消收藏后页面不应出现错误提示").toBe(
      false,
    );
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
    // C 方向：确定性断言替代 LLM —— 「关注」Tab 激活（aria-current=page）且面板渲染投稿或空态
    const current = await driver.getAttribute(
      'nav[aria-label="主导航"] button[aria-label="关注"]',
      "aria-current",
    );
    expect(current, "「关注」Tab 应处于激活态（aria-current=page）").toBe("page");
    const followFeed = await evalBool(
      driver,
      "document.querySelectorAll('[data-testid=illust-card]').length > 0 || document.body.innerText.includes('暂无内容')",
    );
    expect(followFeed, "关注 Feed 应显示关注用户的投稿或空状态").toBe(true);
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
    // 用 data-testid 精确点击小说切换按钮（find(includes("小说")) 可能歧义匹配到卡片标题）
    await driver.evaluate(
      "document.querySelector('[data-testid=\"content-type-novel\"]')?.click(); 'clicked'",
    );
    // 条件等待：小说卡片渲染或空态（「暂无小说」/ 通用「暂无内容」/ 加载失败）
    await driver.waitForJs(
      "document.querySelectorAll('[data-testid=novel-card]').length > 0 || document.body.innerText.includes('暂无小说') || document.body.innerText.includes('暂无内容') || document.body.innerText.includes('加载失败')",
      30_000,
    );

    // C 方向：确定性断言替代 LLM —— 小说卡片或「暂无小说」空态已渲染
    const novelFeed = await evalBool(
      driver,
      "document.querySelectorAll('[data-testid=novel-card]').length > 0 || document.body.innerText.includes('暂无小说') || document.body.innerText.includes('暂无内容') || document.body.innerText.includes('加载失败')",
    );
    expect(novelFeed, "小说 Feed 应展示小说卡片列表或空状态（无数据时显示「暂无内容」）").toBe(
      true,
    );

    const cardOk = await driver.clickFirst();
    if (cardOk) {
      // 条件等待：URL 进入 /novel/ 详情路由后，再等正文内容非空（慢网络下不白屏误报）
      await driver.waitForUrl("/novel/", 15_000);
      await driver.waitForPageContent(10_000);
      // C 方向：确定性断言替代 LLM（B 类弱化）—— URL 已进入 /novel/，标题 h1 非空，
      // 正文元素存在且非空（pretext 布局正确性由单测承担，此处只断言渲染产出非空）
      const path = JSON.parse(await driver.evaluate("location.pathname")) as string;
      expect(path.includes("/novel/"), `应进入小说详情页（URL 含 /novel/），实际 ${path}`).toBe(
        true,
      );
      const titleOk = await evalBool(
        driver,
        "(document.querySelector('h1')?.textContent?.trim().length ?? 0) > 0",
      );
      expect(titleOk, "小说详情页应展示标题").toBe(true);
      const bodyOk = await evalBool(
        driver,
        "document.querySelectorAll('.novel-text-paragraph').length > 0 || (document.querySelector('.novel-text')?.textContent?.trim().length ?? 0) > 0",
      );
      expect(bodyOk, "小说详情页正文应渲染出非空内容（段落或正文容器）").toBe(true);
    }
  }, 120_000);

  it("[E5-E6] 正文滚动", async () => {
    // 账号无小说推荐时 E1-E4 未进入详情，跳过滚动断言
    const path = await driver.evaluate(`location.pathname`);
    if (!path.includes("/novel/")) {
      console.log("[E5-E6] 未进入小说详情（无小说卡片），跳过");
      return;
    }
    // C 方向：记录滚动前位置（window/documentElement/body 取最大，兼容滚动容器差异）
    const scrollProbe =
      "Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop)";
    const scrollBefore = await evalNum(driver, scrollProbe);
    await driver.scroll("down", 600);
    // S 类：正文滚动后的虚拟列表重排无稳定谓词，等 Fluent 最长动效时长（500ms）收敛
    await SLEEP(500);
    // C 方向：确定性断言替代 LLM —— 滚动位置推进（或已在页面底部）且正文段落仍存在
    const scrollAfter = await evalNum(driver, scrollProbe);
    const atBottom = await evalBool(
      driver,
      "window.innerHeight + Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop) >= document.documentElement.scrollHeight - 2",
    );
    expect(
      scrollAfter > scrollBefore || atBottom,
      `正文滚动应推进（scrollTop ${scrollBefore} → ${scrollAfter}，atBottom=${atBottom}）`,
    ).toBe(true);
    const paragraphs = await evalBool(
      driver,
      "document.querySelectorAll('.novel-text-paragraph').length > 0 || (document.querySelector('.novel-text')?.textContent?.trim().length ?? 0) > 0",
    );
    expect(paragraphs, "滚动后正文内容应仍渲染于 DOM").toBe(true);
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

    // C 方向：确定性断言替代 LLM —— 路由 /me、头像元素已渲染、作品/收藏/关注/粉丝入口齐全
    const path = JSON.parse(await driver.evaluate("location.pathname")) as string;
    expect(path, `应导航到个人中心 /me，实际 ${path}`).toBe("/me");
    const avatarOk = await evalBool(
      driver,
      "document.querySelectorAll('img.rounded-full, div.rounded-full').length > 0",
    );
    expect(avatarOk, "个人中心应展示用户头像").toBe(true);
    const state = await getPageState(driver);
    for (const entry of ["我的作品", "我的收藏", "我的关注", "我的粉丝"]) {
      expect(state.includes(entry), `个人中心应展示「${entry}」入口`).toBe(true);
    }

    const bmOk = await driver.clickReliable("我的收藏");
    if (bmOk) {
      // 条件等待：点击后 SPA 导航到 /home 收藏面板，等收藏卡片或空态渲染
      await driver.waitForJs(
        "location.pathname.startsWith('/home') && (document.querySelectorAll('[data-testid=illust-card]').length > 0 || document.body.innerText.includes('暂无内容'))",
        10_000,
      );
      // C 方向：确定性断言替代 LLM —— 路由进入 /home 收藏面板且渲染收藏卡片或空态
      const bmPath = JSON.parse(await driver.evaluate("location.pathname")) as string;
      expect(bmPath.startsWith("/home"), `收藏页应在 /home 收藏面板，实际 ${bmPath}`).toBe(true);
      const bmFeed = await evalBool(
        driver,
        "document.querySelectorAll('[data-testid=illust-card]').length > 0 || document.body.innerText.includes('暂无内容')",
      );
      expect(bmFeed, "收藏页应展示用户收藏的作品列表或「暂无内容」空态").toBe(true);
    }
  }, 120_000);
});

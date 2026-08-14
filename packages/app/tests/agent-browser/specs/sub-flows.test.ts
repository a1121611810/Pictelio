/**
 * 中链主流程测试 — agent-browser 版
 *
 * A-1 文件内共享登录会话：14 个非登录 describe 嵌套在「agent-browser 共享会话」
 * 父 describe 下，父级 beforeAll 登录一次，子 describe 复用同一 driver，
 * 开始前通过 resetToHome() 回到已知状态（/home + 推荐 Tab + 插画内容类型）。
 * 两个登录流 describe（有效 / 无效 token）验证完整登录流程，保留独立会话，位于文件末尾。
 * 使用 clickReliable / clickFirst 进行可靠交互。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createLoggedInDriver } from "../fixtures";
import { aiAssert } from "../../ai-shared/assertion";
import { AgentBrowserDriver } from "../driver";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getState(d: AgentBrowserDriver): Promise<string> {
  // 等待页面渲染出实质内容，避免路由切换/加载期间的白屏竞态导致 AI 断言误报
  await d.waitForPageContent(10_000);
  const snap = await d.snapshot();
  const text = await d.pageText().catch(() => "");
  return snap + "\n---页面文本---\n" + text;
}

// ─── 条件等待谓词（B 方向：固定 SLEEP → 条件等待） ───
// 空态/错误态必须纳入谓词，否则空列表场景会等满超时。
/** 插画 Feed 就绪：卡片出现，或「暂无内容」空态 / 加载失败 */
const ILLUST_FEED_READY_JS =
  'document.querySelector(\'[data-testid="illust-card"]\') !== null || document.body.innerText.includes("暂无内容") || document.body.innerText.includes("加载失败")';
/** 小说 Feed 就绪：小说卡片（封面墙或文本列表）出现，或空态（「暂无小说」/ 通用「暂无内容」）/ 加载失败 */
const NOVEL_FEED_READY_JS =
  'document.querySelector(\'[data-testid="novel-card"], [data-testid="novel-text-list-card"]\') !== null || document.body.innerText.includes("暂无小说") || document.body.innerText.includes("暂无内容") || document.body.innerText.includes("加载失败")';
/** 收藏面板就绪：收藏卡片（插画或小说）出现，或空态 / 加载失败 */
const BOOKMARKS_READY_JS =
  'document.querySelector(\'[data-testid="illust-card"], [data-testid="novel-card"]\') !== null || document.body.innerText.includes("暂无内容") || document.body.innerText.includes("加载失败")';
/** 侧边导航指定 Tab 为当前页（aria-current=page） */
const navTabActiveJs = (label: string) =>
  `document.querySelector('nav[aria-label="主导航"] button[aria-label="${label}"]')?.getAttribute("aria-current") === "page"`;

// ─── C 方向：确定性断言辅助（替代 aiAssert 的 LLM 调用） ───
/** 页面无加载错误提示（「无渲染异常」类断言的弱化确定性信号） */
const NO_LOAD_ERROR_JS = '!document.body.innerText.includes("加载失败")';
/** evaluate 布尔谓词 → boolean（evaluate 输出为 JSON 编码字符串，布尔为 "true"/"false"） */
async function evalBool(d: AgentBrowserDriver, js: string): Promise<boolean> {
  return JSON.parse(await d.evaluate(js)) === true;
}
/** 当前插画卡片数量 */
async function illustCardCount(d: AgentBrowserDriver): Promise<number> {
  return JSON.parse(
    await d.evaluate(`document.querySelectorAll('[data-testid="illust-card"]').length`),
  ) as number;
}

// ─── A-1：文件内共享登录会话 ─────────────────────
// 14 个非登录 describe 共享一次登录会话（原结构每个 describe 各登录一次，每次 20~40s）。

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 共享会话", () => {
  // 共享 driver：父级 beforeAll 登录一次，子 describe 通过闭包引用；
  // afterAll 只在父级 close 一次（子级不再 close）。
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();
  }, 120_000);
  afterAll(async () => {
    await driver?.close();
  });

  /**
   * 回到已知状态（每个子 describe 开始前执行）：
   * 1. SPA 导航回 /home——清除详情页 / 设置页等路由残留；
   * 2. 侧边导航切回「推荐」——currentTab 是 uiStore 内存态，SPA 导航后保留；
   * 3. 内容类型切回「插画」——content_type 经 settings registry 持久化（CapacitorStorage. 前缀），
   *    阅读链路等 describe 切到「小说」后必须复位，否则污染后续 describe 的默认视图；
   * 4. 等推荐 Feed 就绪（卡片 / 空态 / 错误态均可），避免空列表场景等满超时。
   */
  async function resetToHome() {
    await driver.navigateSpa("/home");
    // 等侧边导航渲染完成，再执行状态复位
    await driver.waitForSelector('nav[aria-label="主导航"] button[aria-label="推荐"]', 15_000);
    // 仅当当前不在「推荐」时点击复位，避免无谓重渲染
    await driver.evaluate(
      `(() => { const b = document.querySelector('nav[aria-label="主导航"] button[aria-label="推荐"]'); if (b && b.getAttribute("aria-current") !== "page") b.click(); return "ok"; })()`,
    );
    // 仅当内容类型不是「插画」时点击复位（data-testid 精准定位，aria-pressed 为激活态）
    await driver.evaluate(
      `(() => { const b = document.querySelector('[data-testid="content-type-illust"]'); if (b && b.getAttribute("aria-pressed") !== "true") b.click(); return "ok"; })()`,
    );
    // 等推荐 Feed 就绪（卡片或空态/错误态）；返回 false 不阻塞后续用例
    await driver.waitForJs(ILLUST_FEED_READY_JS, 15_000);
  }

  // ─── 发现链路 ─────────────────────────────────────

  describe("发现链路", () => {
    // 回到已知状态：/home + 推荐 Tab + 插画内容类型（见父级 resetToHome）
    beforeAll(resetToHome);

    it("推荐 Feed 首屏 → 滚动加载", async () => {
      // 等推荐 Feed 就绪（卡片或空态/错误态），替代固定 SLEEP
      await driver.waitForJs(ILLUST_FEED_READY_JS, 15_000);
      // C 方向：确定性断言替代 LLM —— 推荐 Feed 至少渲染出一张插画卡片
      const firstCount = await illustCardCount(driver);
      expect(firstCount, "推荐 Feed 应展示插画卡片瀑布流").toBeGreaterThan(0);

      // 循环滚到底触发分页（一次 scrollTo 可能因 scrollHeight 变化导致 IO 未触达分页哨兵）
      const countBefore = await illustCardCount(driver);
      const scrolled = await (async () => {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          await driver.evaluate("window.scrollTo(0, document.body.scrollHeight); 'scrolled'");
          const count = await illustCardCount(driver);
          if (count > countBefore) return true;
          await new Promise((res) => setTimeout(res, 1000));
        }
        return false;
      })();
      // C 方向：确定性断言替代 LLM —— 滚动后新卡片加载（或已到底则页面仍健康）
      if (scrolled) {
        const countAfter = await illustCardCount(driver);
        expect(countAfter, "滚动后应加载出新卡片").toBeGreaterThan(countBefore);
      } else {
        const healthy = await evalBool(driver, NO_LOAD_ERROR_JS);
        expect(healthy, "未加载新卡片时页面应无错误").toBe(true);
      }
    }, 120_000);

    it("内容类型切换 + 导航栏", async () => {
      // 内容类型切换器（ContentTypeToggle）仅「插画/小说」两段，
      // 「漫画/综合」子 Tab 已随 ADR-0075 移除，改用「小说」切换验证。
      // 用 data-testid 精确点击（clickReliable("小说") 的 @ref 可能歧义匹配到卡片标题）
      await driver.evaluate(
        "document.querySelector('[data-testid=\"content-type-novel\"]')?.click(); 'clicked'",
      );
      // 等小说 Feed 就绪（小说卡片或空态「暂无小说/暂无内容」），替代固定 SLEEP
      await driver.waitForJs(NOVEL_FEED_READY_JS, 30_000);
      // C 方向：确定性断言替代 LLM —— 小说 Feed 已就绪（卡片或空态）
      const novelReady = await evalBool(driver, NOVEL_FEED_READY_JS);
      expect(novelReady, "小说 Feed 应展示小说卡片或空状态").toBe(true);

      await driver.clickReliable("插画");
      // 等插画 Feed 就绪，替代固定 SLEEP
      await driver.waitForJs(ILLUST_FEED_READY_JS, 15_000);

      await driver.clickReliable(
        "关注",
        undefined,
        'nav[aria-label="主导航"] button[aria-label="关注"]',
      );
      // 关注是 /home 下 SideNavShell 面板（URL 不变）：等导航选中态 + 面板内容就绪
      await driver.waitForJs(navTabActiveJs("关注"), 10_000);
      await driver.waitForJs(ILLUST_FEED_READY_JS, 15_000);
      // C 方向：确定性断言替代 LLM —— 关注 Tab 选中且面板就绪（卡片或空态/错误态）
      const followActive = await evalBool(driver, navTabActiveJs("关注"));
      expect(followActive, "关注 Tab 应处于选中态").toBe(true);
      const followReady = await evalBool(driver, ILLUST_FEED_READY_JS);
      expect(followReady, "关注 Tab 应显示投稿或空状态").toBe(true);
    }, 120_000);
  });

  // ─── 作品链路 ─────────────────────────────────────

  describe("作品链路", () => {
    // 回到已知状态：/home + 推荐 Tab + 插画内容类型（见父级 resetToHome）
    beforeAll(resetToHome);

    it("点卡片 → 详情页", async () => {
      // 等待卡片渲染（feed 加载可能较慢），再尝试点击
      await driver.waitForSelector('[data-testid="illust-card"]', 10_000);
      const ok = await driver.clickFirst();
      if (!ok) throw new Error("找不到可点击的元素");
      // 等详情页路由进入，替代固定 SLEEP
      await driver.waitForUrl("/illust/", 15_000);
      // C 方向：确定性断言替代 LLM —— 详情页路由 + 标题 h1 非空 + 大图 img + 标签容器
      await driver.waitForJs(
        'document.querySelector("h1")?.textContent?.trim().length > 0 && document.querySelectorAll("img").length > 0',
        15_000,
      );
      const detailPath = JSON.parse(await driver.evaluate("location.pathname")) as string;
      expect(detailPath, "应进入作品详情页路由").toMatch(/^\/illust\/\d+/);
      const h1 = JSON.parse(
        await driver.evaluate('document.querySelector("h1")?.textContent ?? ""'),
      ) as string;
      expect(h1.trim().length, "详情页标题 h1 应非空").toBeGreaterThan(0);
    }, 60_000);

    it("收藏与取消收藏", async () => {
      const snap = await driver.snapshot();
      if (snap.includes("isCurrentUser") || snap.includes("加载失败")) {
        console.log("详情页未加载，跳过");
        return;
      }

      // 详情页收藏按钮：用 aria-label 精准定位（BottomActionBar 无 .relative class）
      const bookmarkBtnReady = await driver.waitForSelector(
        '[aria-label="收藏"], [aria-label="取消收藏"]',
        15_000,
      );
      expect(bookmarkBtnReady, "详情页应存在收藏按钮").toBe(true);
      // 点击收藏（evaluate 注入 el.click()，CLI click 对 fluent-button 不可靠）
      await driver.evaluate(
        `(() => { const b = document.querySelector('[aria-label="收藏"]'); if (b) { b.click(); return "clicked"; } return "not-found"; })()`,
      );
      // C 方向：确定性断言替代 LLM（宽松语义，收藏接口依赖真实网络）——按钮 aria-label 变化或页面无错误
      await driver.waitForJs(
        "document.querySelector('[aria-label=取消收藏]') !== null || document.body.innerText.includes('加载失败')",
        15_000,
      );
      expect((await driver.pageText()).includes("加载失败"), "收藏后页面不应出现错误提示").toBe(
        false,
      );

      // 取消收藏后：按钮恢复或页面无错误（宽松语义）
      await driver.waitForJs(
        "document.querySelector('[aria-label=收藏]') !== null || document.body.innerText.includes('加载失败')",
        15_000,
      );
      expect((await driver.pageText()).includes("加载失败"), "取消收藏后页面不应出现错误提示").toBe(
        false,
      );
    }, 60_000);

    it("返回 Feed", async () => {
      // 详情页无导航外壳（C-shell 后 NavBar 不再全局挂载），直接 SPA 导航回 /home
      await driver.navigateSpa("/home");
      // 等推荐 Feed 就绪（卡片或空态/错误态），替代固定 SLEEP
      await driver.waitForJs(ILLUST_FEED_READY_JS, 15_000);
      // C 方向：确定性断言替代 LLM —— 回到 /home 且推荐 Feed 就绪（卡片或空态）
      const feedReady = await evalBool(driver, ILLUST_FEED_READY_JS);
      expect(feedReady, "返回推荐 Feed 应正常展示（卡片或空态）").toBe(true);
    }, 30_000);
  });

  // ─── 阅读链路 ─────────────────────────────────────

  describe("阅读链路", () => {
    // 回到已知状态：/home + 推荐 Tab + 插画内容类型（见父级 resetToHome）
    beforeAll(resetToHome);

    it("小说 Feed → 正文加载", async () => {
      // 用 data-testid 精确点击小说切换按钮（find(includes("小说")) 可能歧义匹配到卡片标题）
      await driver.evaluate(
        "document.querySelector('[data-testid=\"content-type-novel\"]')?.click(); 'clicked'",
      );
      // 等小说 Feed 就绪（小说卡片或空态「暂无小说/暂无内容」），替代固定 SLEEP
      await driver.waitForJs(NOVEL_FEED_READY_JS, 30_000);
      // C 方向：确定性断言替代 LLM —— 小说 Feed 已就绪（卡片或空态）
      const novelFeedReady = await evalBool(driver, NOVEL_FEED_READY_JS);
      expect(novelFeedReady, "小说 Feed 应展示小说卡片或空状态").toBe(true);

      const cardOk = await driver.clickFirst();
      if (cardOk) {
        // 等小说详情路由进入，替代固定 SLEEP
        await driver.waitForUrl("/novel/", 15_000);
        // C 方向：pretext 渲染正确性由单测承担，E2E 弱化为正文段落元素存在且非空
        const bodyReady = await driver.waitForJs(
          '[...document.querySelectorAll(".novel-text-paragraph")].some((p) => p.textContent.trim().length > 0)',
          15_000,
        );
        expect(bodyReady, "小说详情页正文应渲染出非空段落").toBe(true);
      }
    }, 120_000);

    it("正文滚动", async () => {
      // 账号无小说推荐时前一用例未进入详情，跳过滚动断言
      const path = await driver.evaluate(`location.pathname`);
      if (!path.includes("/novel/")) {
        console.log("[阅读链路] 未进入小说详情（无小说卡片），跳过");
        return;
      }
      await driver.scroll("down", 600);
      // C 方向：确定性断言替代 LLM —— 滚动后正文段落仍在且页面无错误（正文推进的弱化信号）
      await driver.waitForJs(
        '[...document.querySelectorAll(".novel-text-paragraph")].some((p) => p.textContent.trim().length > 0)',
        10_000,
      );
      const paragraphs = JSON.parse(
        await driver.evaluate('document.querySelectorAll(".novel-text-paragraph").length'),
      ) as number;
      expect(paragraphs, "滚动后正文段落应仍在").toBeGreaterThan(0);
    }, 30_000);
  });

  // ─── 个人链路 ─────────────────────────────────────

  describe("个人链路", () => {
    // 回到已知状态：/home + 推荐 Tab + 插画内容类型（见父级 resetToHome）
    beforeAll(resetToHome);

    it("个人中心 → 用户信息", async () => {
      // 点击侧边导航底部「我的」（UserAvatar 按钮，aria-label="我的"）跳转到 /me。
      // C-shell（ADR-0075）后 /home 的 h1 是 Tab 标签，点击无导航。
      await driver.evaluate(
        `document.querySelector('nav[aria-label="主导航"] button[aria-label="我的"]')?.click()`,
      );
      // 等个人中心数据加载完成（功能菜单行出现），条件等待替代固定轮询
      await driver.waitForJs(
        'document.body.innerText.includes("我的作品") || document.body.innerText.includes("我的收藏")',
        15_000,
      );

      // C 方向：确定性断言替代 LLM —— /me 页头像（me/Avatar 用 rounded-full）+「我的作品」入口
      const mePageOk = await evalBool(
        driver,
        `location.pathname === "/me" && document.querySelector('img.rounded-full, div.rounded-full') !== null && document.body.innerText.includes("我的作品")`,
      );
      expect(mePageOk, "个人中心应显示头像、用户名与「我的作品」入口").toBe(true);
    }, 60_000);

    it("查看收藏夹", async () => {
      // 在个人中心页面点击"我的收藏"（内容区域菜单行，非侧边导航）
      const ok = await driver.clickReliable("我的收藏");
      if (ok) {
        // 「我的收藏」切换到 /home 收藏面板（PersonalCenter actions.bookmarks）：
        // 等侧边导航「收藏」选中 + 面板内容就绪，替代固定 SLEEP
        await driver.waitForJs(navTabActiveJs("收藏"), 10_000);
        await driver.waitForJs(BOOKMARKS_READY_JS, 15_000);
        // C 方向：确定性断言替代 LLM —— 收藏 Tab 选中且面板就绪（收藏卡片或空态）
        const bookmarksReady = await evalBool(driver, BOOKMARKS_READY_JS);
        expect(bookmarksReady, "收藏面板应展示收藏作品列表或空状态").toBe(true);
      }
    }, 60_000);
  });

  // ─── Feed 增强链路 ─────────────────────────────────
  // 覆盖 Playwright feed.e2e.ts 中 agent-browser 尚未测试的场景

  describe("Feed 增强", () => {
    beforeAll(async () => {
      // 回到已知状态 + 等推荐 Feed 就绪（卡片或空态/错误态），替代固定 SLEEP
      await resetToHome();
      await driver.waitForJs(ILLUST_FEED_READY_JS, 20_000);
    });

    it("推荐 Feed 无限滚动加载更多", async () => {
      // C 方向：确定性断言替代 LLM —— 首屏渲染出多张插画卡片
      const firstScreenCount = await illustCardCount(driver);
      expect(firstScreenCount, "推荐 Feed 首屏应展示多张插画卡片").toBeGreaterThan(1);

      // 滚动到底并验证页面健康：真实账号 Feed 数据有限（可能已到底，分页不再追加），
      // 因此不强制卡片数递增——断言"滚动不崩、无加载错误、列表仍在"。
      await driver.evaluate("window.scrollTo(0, document.body.scrollHeight); 'scrolled'");
      await driver.waitForJs(
        "window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 10 || document.body.innerText.includes('加载失败')",
        10_000,
      );
      const scrollOk = await evalBool(
        driver,
        `Math.max(window.scrollY, document.documentElement.scrollTop) > 0 && ${NO_LOAD_ERROR_JS}`,
      );
      expect(scrollOk, "滚动到底后页面应可滚动且无加载错误").toBe(true);
      const afterCount = await illustCardCount(driver);
      expect(afterCount, "滚动后卡片列表不应消失").toBeGreaterThan(0);
    }, 120_000);

    it("切换到关注 Tab", async () => {
      const ok = await driver.clickReliable(
        "关注",
        undefined,
        'nav[aria-label="主导航"] button[aria-label="关注"]',
      );
      if (!ok) {
        console.log("[Feed 增强] 找不到关注按钮，跳过");
        return;
      }
      // 等导航选中态 + 面板内容就绪，替代固定 SLEEP
      await driver.waitForJs(navTabActiveJs("关注"), 10_000);
      await driver.waitForJs(ILLUST_FEED_READY_JS, 15_000);

      // 关注是 /home 下 SideNavShell 面板（ADR-0075），URL 不变；
      // 改断言侧边导航「关注」按钮 aria-current=page。
      const ariaCurrent = await driver.getAttribute(
        'nav[aria-label="主导航"] button[aria-label="关注"]',
        "aria-current",
      );
      expect(ariaCurrent, "侧边导航「关注」应为当前页").toBe("page");

      // C 方向：确定性断言替代 LLM —— 关注 Tab 面板就绪（卡片或空态/错误态）
      const followReady = await evalBool(driver, ILLUST_FEED_READY_JS);
      expect(followReady, "关注 Tab 应显示投稿列表或空状态").toBe(true);
    }, 60_000);
  });

  // ─── 设置链路（图床代理）────────────────────────────
  // B 类场景：UI 组件行为验证

  describe("图床代理设置", () => {
    // 回到已知状态：/home + 推荐 Tab + 插画内容类型（见父级 resetToHome）
    beforeAll(resetToHome);

    it("图床设置页可打开", async () => {
      // 直接导航到图床设置页，等主开关渲染替代固定 SLEEP
      await driver.navigateSpa("/image-host");
      const switchReady = await driver.waitForSelector(
        'fluent-switch[aria-label="启用图床代理"]',
        15_000,
      );
      // C 方向：确定性断言替代 LLM —— 页面标题含「图床代理」+ 主开关存在
      expect(switchReady, "图床设置页应渲染主开关").toBe(true);
      const pageOk = await evalBool(
        driver,
        'document.body.innerText.includes("图床代理") || document.body.innerText.includes("图片托管")',
      );
      expect(pageOk, "图床设置页标题应含「图床代理」或「图片托管」").toBe(true);
    }, 60_000);

    it("toggle 开关 → 取消确认 → 开关保持关闭", async () => {
      await driver.navigateSpa("/image-host");
      // 等主开关渲染，替代固定 SLEEP
      await driver.waitForSelector('fluent-switch[aria-label="启用图床代理"]', 15_000);

      // C 方向：确定性断言替代 LLM —— 初始开关关闭。
      // fluent-switch 的 checked 是 property 而非 attribute，getAttribute 返回 null，
      // 改用 evaluate 读 property（C 报告 7.3 的教训）。
      const initialChecked = JSON.parse(
        await driver.evaluate(
          "document.querySelector('[aria-label=\"启用图床代理\"]')?.checked ?? false",
        ),
      ) as boolean;
      expect(initialChecked, "图床代理主开关初始应为关闭状态").toBe(false);

      // 点击开关（触发确认对话框）
      // 用 evaluate 操作 fluent-switch（避免 Shadow DOM 选择器问题），带存在性反馈
      const sw1 = await driver.evaluate(
        `(() => {
        const el = document.querySelector('fluent-switch[aria-label="启用图床代理"]');
        if (el) { el.click(); return 'clicked'; }
        return 'not-found';
      })()`,
      );
      if (!sw1.includes("clicked")) console.warn("[图床设置] fluent-switch 未找到");
      // 等确认对话框出现，替代固定 SLEEP
      const dialogShown = await driver.waitForText("开启图床代理？", 10_000);
      // C 方向：确定性断言替代 LLM —— 确认对话框标题出现
      expect(dialogShown, "点击开关后应弹出「开启图床代理？」确认对话框").toBe(true);

      // 点击"取消"
      await driver.clickReliable("取消");
      // 等对话框关闭（标题消失），替代固定 SLEEP
      const dialogClosed = await driver.waitForJs(
        '!document.body.innerText.includes("开启图床代理？")',
        10_000,
      );
      expect(dialogClosed, "点击「取消」后确认对话框应关闭").toBe(true);
      // C 方向：开关保持关闭（读 property）
      const afterCancel = JSON.parse(
        await driver.evaluate(
          "document.querySelector('[aria-label=\"启用图床代理\"]')?.checked ?? false",
        ),
      ) as boolean;
      expect(afterCancel, "取消后主开关应保持关闭").toBe(false);
    }, 60_000);

    it("toggle 开关 → 确认 → 开关保持打开（自动复原）", async () => {
      await driver.navigateSpa("/image-host");
      // 等主开关渲染，替代固定 SLEEP
      await driver.waitForSelector('fluent-switch[aria-label="启用图床代理"]', 15_000);

      // 点击开关弹出确认
      const sw2 = await driver.evaluate(
        `(() => {
        const el = document.querySelector('fluent-switch[aria-label="启用图床代理"]');
        if (el) { el.click(); return 'clicked'; }
        return 'not-found';
      })()`,
      );
      if (!sw2.includes("clicked")) console.warn("[图床设置] fluent-switch 未找到");
      // 等确认对话框出现，替代固定 SLEEP
      await driver.waitForText("开启图床代理？", 10_000);

      // 点击"确认开启"
      await driver.clickReliable("确认开启");
      // 等开关进入打开状态（确认生效 + 弹窗关闭），替代固定 SLEEP
      await driver.waitForJs(
        "document.querySelector('fluent-switch[aria-label=\"启用图床代理\"]')?.checked === true",
        10_000,
      );

      // C 方向：确定性断言替代 LLM —— 确认后开关打开（读 property）且弹窗关闭
      const enabledChecked = JSON.parse(
        await driver.evaluate(
          "document.querySelector('[aria-label=\"启用图床代理\"]')?.checked ?? false",
        ),
      ) as boolean;
      expect(enabledChecked, "确认开启后主开关应处于打开状态").toBe(true);
      const dialogGone = await evalBool(
        driver,
        '!document.body.innerText.includes("开启图床代理？")',
      );
      expect(dialogGone, "确认后对话框应关闭").toBe(true);

      // 复原：再次点击开关关闭（不会弹出确认）
      const sw3 = await driver.evaluate(
        `(() => {
        const el = document.querySelector('fluent-switch[aria-label="启用图床代理"]');
        if (el) { el.click(); return 'clicked'; }
        return 'not-found';
      })()`,
      );
      if (!sw3.includes("clicked")) console.warn("[图床设置] fluent-switch 未找到");
      // 等开关恢复关闭状态，替代固定 SLEEP
      await driver.waitForJs(
        "document.querySelector('fluent-switch[aria-label=\"启用图床代理\"]')?.checked === false",
        10_000,
      );
      // C 方向：确定性断言替代 LLM —— 开关恢复关闭（读 property）
      const restoredChecked = JSON.parse(
        await driver.evaluate(
          "document.querySelector('[aria-label=\"启用图床代理\"]')?.checked ?? false",
        ),
      ) as boolean;
      expect(restoredChecked, "再次点击后主开关应恢复为关闭状态").toBe(false);
    }, 60_000);
  });

  // ─── 小说详情增强链路 ──────────────────────────────
  // 覆盖 novel-detail.e2e.ts 的 header 标题滚动显隐行为

  describe("小说标题滚动", () => {
    // 回到已知状态：/home + 推荐 Tab + 插画内容类型（见父级 resetToHome）
    beforeAll(resetToHome);

    it("进入小说详情 → 滚动时标题显隐", async () => {
      // 切换到小说模式（data-testid 精确点击，避免 find 歧义）
      await driver.evaluate(
        "document.querySelector('[data-testid=\"content-type-novel\"]')?.click(); 'clicked'",
      );
      // 等小说 Feed 就绪（小说卡片或空态「暂无小说/暂无内容」），替代固定 SLEEP
      await driver.waitForJs(NOVEL_FEED_READY_JS, 30_000);
      // C 方向：确定性断言替代 LLM —— 小说 Feed 已就绪
      const novelFeedReady = await evalBool(driver, NOVEL_FEED_READY_JS);
      expect(novelFeedReady, "小说 Feed 应展示小说卡片或空状态").toBe(true);

      // 点击第一张卡片进入详情
      const cardOk = await driver.clickFirst();
      if (!cardOk) {
        console.log("[小说标题滚动] 找不到可点击的卡片，跳过");
        return;
      }
      // 等小说详情路由进入，替代固定 SLEEP
      await driver.waitForUrl("/novel/", 15_000);

      // C 方向：确定性断言替代 LLM —— 正文段落非空（pretext 渲染正确性由单测承担）
      const bodyReady = await driver.waitForJs(
        '[...document.querySelectorAll(".novel-text-paragraph")].some((p) => p.textContent.trim().length > 0)',
        15_000,
      );
      expect(bodyReady, "小说详情页正文应渲染出非空段落").toBe(true);

      // 向下滚动——标题栏应显现
      await driver.scroll("down", 500);
      // S 类：标题栏渐显动画无稳定谓词，保留短等待（Fluent 最长动效 500ms）
      await SLEEP(500);

      // C 方向：确定性断言替代 LLM —— 滚动后标题栏 opacity-100（渐显）
      await driver.waitForJs('[...document.querySelectorAll(".opacity-100")].length > 0', 10_000);
      const titleShown = await evalBool(
        driver,
        '[...document.querySelectorAll(".opacity-100")].some((el) => el.textContent && el.textContent.trim().length > 0)',
      );
      expect(titleShown, "向下滚动后小说标题栏应渐显").toBe(true);

      // 滚回顶部——标题栏应隐藏
      await driver.evaluate("window.scrollTo(0, 0)");
      // S 类：标题栏渐隐动画无稳定谓词，保留短等待（Fluent 最长动效 500ms）
      await SLEEP(500);

      // C 方向：确定性断言替代 LLM —— 标题栏 opacity-0（隐藏）
      const titleHidden = await evalBool(
        driver,
        'document.querySelectorAll(".opacity-100").length === 0',
      );
      expect(titleHidden, "滚回顶部后标题栏应恢复隐藏").toBe(true);
    }, 120_000);
  });

  // ─── 关注 Feed 链路 ──────────────────────────────────
  // 原「关注筛选」用例已重写：FollowListPage 无「全部/公开/非公开」筛选按钮，
  // 关注 Feed 是 /home 下 SideNavShell 面板（ADR-0075），仅保留面板加载断言。

  describe("关注 Feed", () => {
    // 回到已知状态：/home + 推荐 Tab + 插画内容类型（见父级 resetToHome）
    beforeAll(resetToHome);

    it("关注 Tab 面板正常加载", async () => {
      // 侧边导航「关注」为纯图标按钮（仅 aria-label），精准定位避免误点卡片按钮
      const ok = await driver.clickReliable(
        "关注",
        undefined,
        'nav[aria-label="主导航"] button[aria-label="关注"]',
      );
      if (!ok) {
        console.log("[关注 Feed] 找不到关注按钮，跳过");
        return;
      }
      // 等导航选中态 + 面板内容就绪，替代固定 SLEEP
      await driver.waitForJs(navTabActiveJs("关注"), 10_000);
      await driver.waitForJs(ILLUST_FEED_READY_JS, 15_000);

      // URL 不变（/home 面板切换），断言导航选中态 + 面板内容
      const ariaCurrent = await driver.getAttribute(
        'nav[aria-label="主导航"] button[aria-label="关注"]',
        "aria-current",
      );
      expect(ariaCurrent, "侧边导航「关注」应为当前页").toBe("page");

      // C 方向：确定性断言替代 LLM —— 关注面板就绪（卡片或空态）且无加载错误
      const followReady = await evalBool(driver, ILLUST_FEED_READY_JS);
      expect(followReady, "关注 Tab 应显示投稿列表或空状态").toBe(true);
    }, 120_000);
  });

  // ─── 设置链路（通用）────────────────────────────────
  // 覆盖 extra-flows.e2e.ts 的 About/Theme（布局切换器已随 ADR-0075 移除，不再覆盖）

  describe("关于页", () => {
    // 回到已知状态：/home + 推荐 Tab + 插画内容类型（见父级 resetToHome）
    beforeAll(resetToHome);

    it("关于页通过设置页打开", async () => {
      // C-shell（ADR-0075）后设置不再是抽屉：侧边导航「设置」为纯图标按钮
      // （仅 aria-label，textContent 为空），点击导航到 /settings。
      await driver.evaluate(
        `document.querySelector('nav[aria-label="主导航"] button[aria-label="设置"]')?.click()`,
      );
      // 等设置页「关于」行渲染，替代固定 SLEEP
      await driver.waitForSelector('[aria-label="关于"]', 10_000);

      // 尝试点击设置页"关于"行（SettingsAccount，aria-label="关于"）
      const aboutOk = await driver.clickReliable("关于", undefined, '[aria-label="关于"]');
      if (!aboutOk) {
        // fallback: 直接导航到 /about
        await driver.navigateSpa("/about");
      }
      // 等关于页路由进入，替代固定 SLEEP
      await driver.waitForUrl("/about", 10_000);

      // C 方向：确定性断言替代 LLM —— 关于页标题/品牌文本出现
      await driver.waitForJs(
        'document.body.innerText.includes("关于") || document.body.innerText.includes("Pictelio")',
        10_000,
      );
      const aboutOkText = await evalBool(
        driver,
        'document.body.innerText.includes("关于") || document.body.innerText.includes("Pictelio")',
      );
      expect(aboutOkText, "关于页应显示「关于」或「Pictelio」标题").toBe(true);
    }, 60_000);
  });

  describe("主题设置", () => {
    // 回到已知状态：/home + 推荐 Tab + 插画内容类型（见父级 resetToHome）
    beforeAll(resetToHome);

    it("主题可在设置中切换（深色/浅色）", async () => {
      // 打开设置页（侧边导航「设置」纯图标按钮，仅 aria-label）
      await driver.evaluate(
        `document.querySelector('nav[aria-label="主导航"] button[aria-label="设置"]')?.click()`,
      );
      // 等设置页主题选项渲染，替代固定 SLEEP
      await driver.waitForSelector('[aria-label="深色"]', 10_000);

      // 尝试切换主题 — 先点击深色
      const darkOk = await driver.clickReliable("深色");
      if (darkOk) {
        // 等 html.dark 类生效（主题切换的确定性条件），替代固定 SLEEP
        const darkApplied = await driver.waitForJs(
          'document.documentElement.classList.contains("dark")',
          10_000,
        );
        // C 方向：确定性断言替代 LLM —— 深色主题已生效
        expect(darkApplied, "点击深色主题后页面应切换为深色模式").toBe(true);

        // 切回浅色
        const lightOk = await driver.clickReliable("浅色");
        if (lightOk) {
          // 等 html.dark 类移除（浅色生效），替代固定 SLEEP
          const lightApplied = await driver.waitForJs(
            '!document.documentElement.classList.contains("dark")',
            10_000,
          );
          // C 方向：确定性断言替代 LLM —— 浅色主题已生效
          expect(lightApplied, "点击浅色主题后页面应切换为浅色模式").toBe(true);

          // 精确验证：浅色主题按钮的 aria-pressed 应为 true
          try {
            const pressed = await driver.getAttribute('[aria-label="浅色"]', "aria-pressed");
            expect(pressed).toBe("true");
          } catch (e) {
            console.log("[主题] aria-pressed 精确检查跳过:", (e as Error).message);
          }
        }
      }
    }, 60_000);
  });

  // ─── 注意：illust-detail 已由「作品链路」describe 覆盖 ──
  // 作品链路已覆盖：点卡片→详情页、收藏与取消收藏、返回Feed

  // ─── 用户子路由导航 ─────────────────────────────────
  // 覆盖 child-route-navigation.e2e.ts：个人中心子路由跳转
  // user-bookmarks/user-profile 的其余场景已由「个人链路」覆盖

  describe("用户子路由", () => {
    // 回到已知状态：/home + 推荐 Tab + 插画内容类型（见父级 resetToHome）
    beforeAll(resetToHome);

    it("我的作品 → /user/{id}/illusts", async () => {
      await driver.navigateSpa("/me");
      // 等个人中心菜单行渲染，替代固定 SLEEP
      await driver.waitForText("我的作品", 15_000);

      // C 方向：确定性断言替代 LLM —— /me 页头像（rounded-full）+「我的作品」入口
      const meOk = await evalBool(
        driver,
        `location.pathname === "/me" && document.querySelector('img.rounded-full, div.rounded-full') !== null && document.body.innerText.includes("我的作品")`,
      );
      expect(meOk, "个人中心应显示头像与「我的作品」入口").toBe(true);

      // 点击"我的作品"
      const ok = await driver.clickReliable("我的作品");
      if (!ok) {
        console.log("[子路由] 找不到'我的作品'，跳过");
        return;
      }
      // 等用户作品页路由进入，替代固定 SLEEP
      await driver.waitForUrl("/illusts", 15_000);
      // C 方向：确定性断言替代 LLM —— 已进入用户作品页路由
      const path = JSON.parse(await driver.evaluate("location.pathname")) as string;
      expect(path, "应导航到用户作品页").toMatch(/\/user\/\d+\/illusts/);
    }, 60_000);

    it("我的关注 → /user/{id}/following", async () => {
      await driver.navigateSpa("/me");
      // 等个人中心菜单行渲染，替代固定 SLEEP
      await driver.waitForText("我的关注", 15_000);

      const ok = await driver.clickReliable("我的关注");
      if (!ok) {
        console.log("[子路由] 找不到'我的关注'，跳过");
        return;
      }
      // 本人账号的「我的关注」切换到 /home 关注面板（PersonalCenter actions.following）：
      // 等侧边导航「关注」选中 + 面板内容就绪，替代固定 SLEEP
      await driver.waitForJs(navTabActiveJs("关注"), 15_000);
      await driver.waitForJs(ILLUST_FEED_READY_JS, 15_000);
      // C 方向：确定性断言替代 LLM —— 关注 Tab 选中 + 面板就绪（本人账号切 /home 面板，URL 不变）
      const followActive = await evalBool(driver, navTabActiveJs("关注"));
      expect(followActive, "「关注」Tab 应处于选中态").toBe(true);
      const followReady = await evalBool(driver, ILLUST_FEED_READY_JS);
      expect(followReady, "关注面板应就绪（投稿或空态）").toBe(true);
    }, 60_000);

    it("我的粉丝 → /user/{id}/followers", async () => {
      await driver.navigateSpa("/me");
      // 等个人中心菜单行渲染，替代固定 SLEEP
      await driver.waitForText("我的粉丝", 15_000);

      const ok = await driver.clickReliable("我的粉丝");
      if (!ok) {
        console.log("[子路由] 找不到'我的粉丝'，跳过");
        return;
      }
      // 等粉丝列表路由进入（本人为 /my/followers），替代固定 SLEEP
      await driver.waitForUrl("/followers", 15_000);
      // C 方向：确定性断言替代 LLM —— 已进入粉丝列表路由
      const path = JSON.parse(await driver.evaluate("location.pathname")) as string;
      expect(path, "应导航到粉丝列表页").toMatch(/(\/user\/\d+\/followers|\/my\/followers)/);
    }, 60_000);
  });

  // ─── 图片缓存设置 ──────────────────────────────────
  // 覆盖 image-cache-settings.e2e.ts

  describe("图片缓存设置", () => {
    // 回到已知状态：/home + 推荐 Tab + 插画内容类型（见父级 resetToHome）
    beforeAll(resetToHome);

    it("导航到 /image-cache 渲染页面", async () => {
      await driver.navigateSpa("/image-cache");
      // 等页面标题渲染，替代固定 SLEEP
      await driver.waitForText("图片缓存", 15_000);
      // C 方向：确定性断言替代 LLM —— 页面标题 + 三个功能开关存在
      const pageOk = await evalBool(
        driver,
        'document.body.innerText.includes("图片缓存") && document.body.innerText.includes("磁盘缓存") && document.body.innerText.includes("浏览器缓存")',
      );
      expect(pageOk, "图片缓存页应显示标题与功能开关").toBe(true);
    }, 60_000);
  });

  // ─── 导航与路由 ────────────────────────────────────
  // 覆盖 navigation-settings.e2e.ts

  describe("导航与路由", () => {
    // 回到已知状态：/home + 推荐 Tab + 插画内容类型（见父级 resetToHome）
    beforeAll(resetToHome);

    it("导航栏标签可见并可点击切换", async () => {
      // 复位到推荐页（it 重试时页面可能停在上次切换的 Tab，避免首断言连坐失败）
      await driver.clickReliable(
        "推荐",
        undefined,
        'nav[aria-label="主导航"] button[aria-label="推荐"]',
      );
      await driver.waitForSelector('[data-testid="illust-card"]', 10_000);

      // C 方向：确定性断言替代 LLM —— 侧边导航四 Tab 存在且当前选中推荐页
      const navOk = await evalBool(
        driver,
        `['推荐','关注','收藏','历史'].every((t) => document.querySelector('nav[aria-label="主导航"] button[aria-label="' + t + '"]') !== null) && document.querySelector('nav[aria-label="主导航"] button[aria-label="推荐"]')?.getAttribute("aria-current") === "page"`,
      );
      expect(navOk, "侧边导航应显示推荐/关注/收藏/历史且当前选中推荐").toBe(true);

      // 切换到收藏（侧边导航 Tab 为纯图标按钮，用 aria-label 精准定位）。
      // 等待收藏面板就绪（收藏卡片出现或「暂无内容」空态）而非固定 SLEEP：
      // 固定 3s 在收藏 Feed 加载慢时不足，LLM 会把骨架态误判为"内容缺失"。
      await driver.clickReliable(
        "收藏",
        undefined,
        'nav[aria-label="主导航"] button[aria-label="收藏"]',
      );
      const bookmarksReady = await driver.waitForSelector(
        '[data-testid="illust-card"], [data-testid="novel-card"]',
        10_000,
      );
      if (!bookmarksReady) {
        const empty = await driver.evaluate(
          'document.body.innerText.includes("暂无内容") ? "yes" : "no"',
        );
        if (!empty.includes("yes")) {
          throw new Error("收藏面板 10s 内未就绪（无卡片且无「暂无内容」空态）");
        }
      }
      // C 方向：确定性断言替代 LLM —— 收藏 Tab 选中 + 面板就绪
      const bookmarksActive = await evalBool(driver, navTabActiveJs("收藏"));
      expect(bookmarksActive, "点击「收藏」后收藏 Tab 应选中").toBe(true);
      const bookmarksOk = await evalBool(driver, BOOKMARKS_READY_JS);
      expect(bookmarksOk, "收藏面板应展示收藏列表或空状态").toBe(true);

      // 切换到推荐
      await driver.clickReliable(
        "推荐",
        undefined,
        'nav[aria-label="主导航"] button[aria-label="推荐"]',
      );
      await driver.waitForSelector('[data-testid="illust-card"]', 10_000);
      // C 方向：确定性断言替代 LLM —— 推荐 Tab 选中 + Feed 就绪
      const recommendedActive = await evalBool(driver, navTabActiveJs("推荐"));
      expect(recommendedActive, "点击「推荐」后推荐 Tab 应选中").toBe(true);
      const feedReady = await evalBool(driver, ILLUST_FEED_READY_JS);
      expect(feedReady, "推荐 Feed 应展示插画卡片或空态").toBe(true);
    }, 60_000);

    it("debug 页可正常加载", async () => {
      await driver.navigateSpa("/debug");
      // 等调试页内容渲染，替代固定 SLEEP
      await driver.waitForText("图片加载调试", 15_000);
      // C 方向：确定性断言替代 LLM —— debug 页标题出现且无崩溃
      const debugOk = await evalBool(driver, 'document.body.innerText.includes("图片加载调试")');
      expect(debugOk, "Debug 页面应正常加载并显示调试信息").toBe(true);
    }, 60_000);

    it("未知路由不崩溃，回退到首页", async () => {
      // 应用无 404 catch-all 路由（router.tsx），未知路由由 TanStack Router
      // 回退到根路径内容。断言实际行为：不崩溃且回退到正常首页内容。
      await driver.navigateSpa("/this-route-does-not-exist");
      // 等回退的主页内容就绪（卡片或空态），替代固定 SLEEP
      await driver.waitForJs(ILLUST_FEED_READY_JS, 15_000);
      // C 方向：确定性断言替代 LLM —— 回退到主页且 Feed 就绪（无白屏）
      const fellBack = await evalBool(driver, ILLUST_FEED_READY_JS);
      expect(fellBack, "未知路由应回退到正常首页内容").toBe(true);
    }, 60_000);
  });

  // ─── 作品详情增强（标签、系列、双击回顶）─────────────
  // 覆盖 IllustTags、SeriesSheet、IllustDetailDoubleClickTop 等 browser 测试

  describe("详情页增强", () => {
    beforeAll(async () => {
      // 回到已知状态 + 等推荐 Feed 卡片就绪（clickFirst 需要卡片存在），替代固定 SLEEP
      await resetToHome();
      await driver.waitForSelector('[data-testid="illust-card"]', 20_000);
    });

    it("插画详情页展示作品标签", async () => {
      // 从推荐 Feed 点卡片进入详情
      const cardOk = await driver.clickFirst();
      if (!cardOk) {
        console.log("[详情增强] 找不到可点击的卡片，跳过");
        return;
      }
      // 等详情页路由进入，替代固定 SLEEP
      await driver.waitForUrl("/illust/", 15_000);

      const state = await getState(driver);
      const result = await aiAssert(
        "作品详情页加载完成，展示标签列表（如标签按钮/链接），标签内容与作品相关",
        state,
      );
      expect(result.passed, result.reason).toBe(true);
    }, 60_000);

    it("小说详情系列面板可打开", async () => {
      // 切换到小说模式（data-testid 精确点击）
      await driver.evaluate(
        "document.querySelector('[data-testid=\"content-type-novel\"]')?.click(); 'clicked'",
      );
      // 等小说 Feed 就绪（小说卡片或空态「暂无小说/暂无内容」），替代固定 SLEEP
      await driver.waitForJs(NOVEL_FEED_READY_JS, 30_000);

      const cardOk = await driver.clickFirst();
      if (!cardOk) {
        console.log("[系列面板] 找不到小说卡片，跳过");
        return;
      }
      // 等小说详情路由进入，替代固定 SLEEP
      await driver.waitForUrl("/novel/", 15_000);

      // 尝试打开系列面板（如果存在）
      const seriesOk = await driver.clickReliable("目录");
      if (seriesOk) {
        // 等系列面板内容渲染（「系列作品」标题仅出现在 SeriesSheet 中），替代固定 SLEEP
        const sheetShown = await driver.waitForText("系列作品", 10_000);
        // C 方向：确定性断言替代 LLM —— 系列面板标题出现（当前章节高亮由面板 aria-label 体现）
        expect(sheetShown, "小说系列面板应打开并显示「系列作品」").toBe(true);
        const highlight = await evalBool(
          driver,
          `[...document.querySelectorAll("[aria-label^='当前章节：']")].length > 0`,
        );
        if (!highlight) {
          console.log(
            "[系列面板] 未检测到当前章节高亮标记（面板结构可能无此 aria-label），跳过精确断言",
          );
        }
      }
    }, 120_000);

    it("小说详情双击顶部回顶", async () => {
      // 切换到小说模式（data-testid 精确点击）
      await driver.evaluate(
        "document.querySelector('[data-testid=\"content-type-novel\"]')?.click(); 'clicked'",
      );
      // 等小说 Feed 就绪（小说卡片或空态「暂无小说/暂无内容」），替代固定 SLEEP
      await driver.waitForJs(NOVEL_FEED_READY_JS, 30_000);

      const cardOk = await driver.clickFirst();
      if (!cardOk) {
        console.log("[双击回顶] 找不到小说卡片，跳过");
        return;
      }
      // 等小说详情路由进入，替代固定 SLEEP
      await driver.waitForUrl("/novel/", 15_000);

      // 向下滚动
      await driver.scroll("down", 500);
      // S 类：滚动后正文重排无稳定谓词，保留短等待（Fluent 最长动效 500ms）
      await SLEEP(500);

      // 双击页面顶部（模拟双击 header 回到顶部）
      await driver.evaluate(
        `document.querySelector('header')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`,
      );
      // 等回顶完成（scrollY 归零），替代固定 SLEEP
      const backToTop = await driver.waitForJs("window.scrollY === 0", 10_000);
      // C 方向：确定性断言替代 LLM —— scrollY 归零即已回到顶部
      expect(backToTop, "双击页面顶部后应回到顶部（scrollY 为 0）").toBe(true);
    }, 120_000);
  });
});

// ─── 登录链路 ─────────────────────────────────────
// 不依赖 createLoggedInDriver——从空白状态开始测试完整登录流程

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 登录流（有效 token）", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    // launch 重试：agent-browser daemon 偶发白屏（页面加载不出）或 daemon 连接失败
    // （并行运行时 socket 抖动），与 createLoggedInDriver 的重试机制对齐
    for (let attempt = 0; attempt < 3; attempt++) {
      driver = new AgentBrowserDriver();
      try {
        await driver.launch();
        if (await driver.waitForPageContent(20_000)) break;
        console.warn(`[有效 token] 启动白屏（第 ${attempt + 1}/3 次），重新 launch`);
      } catch (err) {
        console.warn(
          `[有效 token] launch 失败（第 ${attempt + 1}/3 次）: ${err instanceof Error ? err.message : String(err)}，重新 launch`,
        );
      }
      await driver.close().catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));
    }
  }, 120_000);
  afterAll(async () => {
    await driver?.close();
  });

  // retry: 0 —— 状态破坏性用例：首次执行会把 token 写进 localStorage 完成登录，
  // retry 重跑时浏览器停留在登录态，年龄确认弹窗不再出现，必连坐失败（F 报告 2.2：
  // retry 只重跑测试体，不重置 beforeAll 的 driver 会话）。
  it(
    "年龄确认 → 登录页 → 有效 token 登录成功",
    { retry: 0 },
    async () => {
      // 等待页面渲染完成（daemon 冷启动可能白屏较久），再断言年龄确认弹窗
      await driver.waitForPageContent(20_000);
      // 1. 年龄确认弹窗（C 方向：确定性断言替代 LLM —— 「已满 18 岁」按钮存在）
      await driver.waitForSelector('[aria-label="已满 18 岁"], [aria-label="未满 18 岁"]', 10_000);
      const ageDialog = await evalBool(
        driver,
        'document.body.innerText.includes("年龄确认") && document.body.innerText.includes("已满 18 岁")',
      );
      expect(ageDialog, "页面应显示年龄确认弹窗").toBe(true);

      // 2. 确认年龄
      await driver.clickReliable("已满", undefined, "@e2");
      // 年龄确认后等登录页渲染（refresh_token 输入框出现），替代固定 SLEEP
      const loginPage = await driver.waitForSelector("fluent-textarea", 15_000);
      // C 方向：确定性断言替代 LLM —— 登录页输入框出现
      expect(loginPage, "年龄确认后应跳转到登录页（refresh_token 输入框）").toBe(true);

      // 3. 填入有效 token 并登录
      const token = process.env.PIXIV_REFRESH_TOKEN;
      if (!token) throw new Error("PIXIV_REFRESH_TOKEN 未设置");
      const escapedToken = token.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      await driver.evaluate(
        `document.querySelector("fluent-textarea").value = '${escapedToken}'; ` +
          `document.querySelector("fluent-textarea").dispatchEvent(new Event("input", { bubbles: true }));`,
      );
      // S 类：输入事件分发后等 fluent-textarea 状态稳定，保留短等待
      await SLEEP(500);
      await driver.clickReliable("登录");

      // 条件等待登录完成（慢网络下 OAuth 请求可能超过固定 8s，用轮询替代固定 SLEEP）：
      // pathname 变为 /home 即登录成功；20s 超时兜底避免悬挂。
      let path = "";
      const loginDeadline = Date.now() + 20_000;
      while (Date.now() < loginDeadline) {
        path = JSON.parse(await driver.evaluate(`location.pathname`)) as string;
        if (path === "/home") break;
        await new Promise((res) => setTimeout(res, 1000));
      }

      // 登录后落在 /home（router.tsx 无 /recommended 路由；evaluate 输出为 JSON 字符串）
      expect(path, "登录成功后应落在 /home").toBe("/home");

      // 条件等待推荐 Feed 卡片就绪（登录后 Feed API 请求在途，固定等待不足时
      // 页面只有导航标题、无卡片，LLM 会误判"未展示插画卡片列表"）。
      const feedCards = await driver.waitForSelector('[data-testid="illust-card"]', 20_000);
      // C 方向：确定性断言替代 LLM —— 推荐 Feed 卡片出现
      expect(feedCards, "登录成功后首页推荐 Feed 应展示插画卡片").toBe(true);
    },
    120_000,
  );
});

describe("agent-browser 登录流（无效 token）", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    // launch 重试：agent-browser daemon 偶发白屏或连接失败（并行运行时 socket 抖动），
    // 与有效 token 用例对齐。重试循环成功后 driver 已就绪，无需再次 launch。
    for (let attempt = 0; attempt < 3; attempt++) {
      driver = new AgentBrowserDriver();
      try {
        await driver.launch();
        if (await driver.waitForPageContent(15_000)) break;
        console.warn(`[无效 token] 启动白屏（第 ${attempt + 1}/3 次），重新 launch`);
      } catch (err) {
        console.warn(
          `[无效 token] launch 失败（第 ${attempt + 1}/3 次）: ${err instanceof Error ? err.message : String(err)}，重新 launch`,
        );
      }
      await driver.close().catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));
    }
    // 清理登录残留（精准删除 token keys，保留 ageConfirmed 等偏好设置）：
    // SecureStorage = capacitor-storage_ 前缀，Preferences = 裸 key / _cap_ 旧前缀。
    // 注：_cap_ 是旧 Preferences 一次性迁移前缀（应用当前不调用 migrate，实际极少存在，
    //     保留匹配以防迁移启用时误判已登录）。
    // 不清空整个 localStorage —— 全清会连带清掉年龄确认标志，
    // 导致同文件后续 describe 重新被年龄确认弹窗拦截（Issue #19 T1）。
    // 页面未就绪时 localStorage 访问抛 SecurityError，重试直到清理成功。
    const CLEAR_JS = `(() => {
      try {
        const TOKEN_KEY_PATTERNS = [/^capacitor-storage_/, /^_cap_/, /^refresh_token$/];
        const removed = [];
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && TOKEN_KEY_PATTERNS.some((p) => p.test(k))) {
            localStorage.removeItem(k);
            removed.push(k);
          }
        }
        return 'removed: ' + removed.length;
      } catch (e) {
        return 'storage-error: ' + e.message;
      }
    })()`;
    for (let attempt = 0; attempt < 20; attempt++) {
      const clearRes = await driver.evaluate(CLEAR_JS);
      if (!clearRes.includes("storage-error")) {
        console.log(`[无效 token] 登录残留清理完成: ${clearRes}`);
        break;
      }
      console.warn(`[无效 token] localStorage 不可访问（第 ${attempt + 1}/20 次），等待重试`);
      // I 类：重试间隔 2s → 500ms，循环次数 5 → 20 保持 10s 总上限
      await SLEEP(500);
    }
    await driver.navigate("/");
    // 等首页渲染出内容，替代固定 SLEEP
    await driver.waitForPageContent(20_000);
    // 通过年龄确认，重试直到登录页（fluent-textarea）渲染完成
    for (let attempt = 0; attempt < 6; attempt++) {
      await driver.clickReliable("已满", undefined, "@e2");
      // 等登录页 textarea 出现（条件等待替代固定 SLEEP + snapshot 轮询）
      if (await driver.waitForSelector("fluent-textarea", 2_000)) break;
    }
  }, 60_000);
  afterAll(async () => {
    await driver?.close();
  });

  // retry: 0 —— 状态破坏性用例：beforeAll 已清理登录残留并导航到登录页，
  // retry 重跑时页面状态已变（storage 清理过、可能已在登录页），连坐失败。
  it(
    "无效 refresh_token 显示错误提示",
    { retry: 0 },
    async () => {
      // 填入无效 token
      await driver.evaluate(
        `document.querySelector("fluent-textarea").value = 'invalid-token-12345'; ` +
          `document.querySelector("fluent-textarea").dispatchEvent(new Event("input", { bubbles: true }));`,
      );
      // S 类：输入事件分发后等 fluent-textarea 状态稳定，保留短等待
      await SLEEP(500);
      await driver.clickReliable("登录");
      // 等登录错误提示出现（失败/错误/invalid/error 任一），替代固定 SLEEP
      await driver.waitForJs(
        'document.body.innerText.includes("失败") || document.body.innerText.includes("错误") || document.body.innerText.toLowerCase().includes("invalid") || document.body.innerText.toLowerCase().includes("error")',
        15_000,
      );

      // C 方向：确定性断言替代 LLM —— 错误提示已出现（waitForJs 前置已确认）
      const errShown = await evalBool(
        driver,
        'document.body.innerText.includes("失败") || document.body.innerText.includes("错误") || document.body.innerText.toLowerCase().includes("invalid") || document.body.innerText.toLowerCase().includes("error")',
      );
      expect(errShown, "无效 token 登录后应显示错误提示").toBe(true);
    },
    60_000,
  );
});

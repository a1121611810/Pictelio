/**
 * 收藏加标签 E2E（spec docs/specs/bookmark-tags.md，ADR-0160 D1–D5）——agent-browser 版。
 *
 * 覆盖双轨收藏在 webview 详情页的两条轨道：
 * - S1 主路径：长按心形 500ms → 收藏面板 → 勾选标签库 chip + 内联新建标签 → 切可见性 →
 *   保存 → 断言 POST /v2/illust/bookmark/add 的表单载荷（illust_id / restrict /
 *   tags[] 空格 join 单值）与面板关闭、宿主收藏态更新；
 * - S2 回归：单击心形 = 快速收藏（pointerdown + 立即 pointerup，短于长按阈值）→
 *   不弹面板、载荷不含 tags 字段（spec 用户故事 2 / D3 单轨不变）。
 *
 * 确定性设计（无条件 skip，断言全部落在真实分支上）：
 * - /v1/illust/detail 经 driver.mockFetch 拦截为合成插画（is_bookmarked=false），
 *   合成 id 取真实 ID 区间之外，避免命中真实数据/历史缓存；书签详情（预填）与标签库
 *   同样 mock —— 面板预填真值完全可控，不依赖真实账号的收藏现状；
 * - POST /v2/illust/bookmark/add 由页面级 fetch 包装**捕获真实请求体**并回 200 {}，
 *   载荷断言看的是被测代码真实发出的字节，不是 mock 回显；
 * - 心形交互用 PointerEvent 注入：详情页心形的收藏路径只挂 pointerdown/pointerup，
 *   没有 onClick（el.click() 不触发任何收藏路径——勿用 click 驱动本用例）。
 *
 * oracle 溯源：
 * - 载荷键名 / 「空格 join 单值」/「空集不发 tags 字段」= spec D1 + ADR-0160 D1（六实现
 *   差分；tests/unit/api/illust.test.ts 为同源契约测试）；
 * - 长按 500ms 阈值 = src/routes/IllustDetail.tsx onBookmarkPointerDown 计时，短于阈值
 *   的 pointerup = 快速收藏（同文件 onBookmarkPointerUp）；
 * - 标签库候选（name/count）/ 可见性 / 已选区 / 保存文案 = spec D5–D7（面板 i18n 键，
 *   zh-CN 源语言静态内联）；
 * - tags[] 期望值 = 本文件交互顺序（先勾标签库 chip、后新建）+ 上方标签名字面量，
 *   以及标签库 mock 的 count，均不从被测实现反推。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createLoggedInDriver } from "../fixtures";
import type { AgentBrowserDriver } from "../driver";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── 合成插画：合成 id 取真实 ID 区间之外，避免命中真实数据/IndexedDB 缓存 ───
const QUICK_ID = 888_000_001;
const PANEL_ID = 888_000_002;

/** 作品自带标签（面板「作品标签」建议区来源，spec D5） */
const WORK_TAG = "e2eworktag";
/** 标签库候选（mock /v1/user/bookmark-tags/illust 返回；count 用于分隔符断言） */
const UNIVERSE_TAG = "e2etag";
const UNIVERSE_COUNT = 3;
/** 面板内联新建的标签：含中文，覆盖标签名非 ASCII 的表单编码往返 */
const NEW_TAG = "e2e新标签";

/** 长按阈值（IllustDetail onBookmarkPointerDown 的 500ms 计时，ADR-0160 D4） */
const LONG_PRESS_MS = 500;

const HEART_READY = '[aria-label="收藏"]';
const HEART_BOOKMARKED = '[aria-label="取消收藏"]';
/** 面板标题（i18n bookmarkPanel.title，zh-CN 源语言） */
const PANEL_TITLE = "收藏到…";
/** 未收藏预填下的保存文案（i18n bookmarkPanel.save）——精确等值避免误点详情页心形「♡ 收藏」 */
const SAVE_LABEL = "收藏";
/** 已选标签 chip 的可访问名前缀（i18n bookmarkPanel.removeTagAria） */
const REMOVE_PREFIX = "移除标签 ";

/** 面板内唯一 id 的输入框：面板锚点 + 面板是否打开的唯一判据（Show 卸载即消失） */
const PANEL_INPUT_ID = "bookmark-panel-tag-input";

/** 合成插画详情（PixivIllust 全字段形态，字段名取自 api/types.ts 契约） */
function mockIllustDetail(id: number): string {
  return JSON.stringify({
    illust: {
      id,
      title: `E2E 收藏加标签合成作品 ${id}`,
      type: "illust",
      user: {
        id: 888_000_100,
        name: "E2E 合成作者",
        account: "e2e_synthetic_author",
        profile_image_urls: { medium: "", px_170x170: "" },
        is_followed: false,
      },
      image_urls: { square_medium: "", medium: "", large: "" },
      width: 1200,
      height: 1600,
      page_count: 1,
      is_bookmarked: false,
      total_bookmarks: 0,
      total_comments: 0,
      total_view: 0,
      illust_ai_type: 0,
      tags: [{ name: WORK_TAG }],
      x_restrict: 0,
      create_date: "2026-01-01T00:00:00+09:00",
      caption: "",
      meta_pages: [],
      meta_single_page: { original_image_url: "" },
    },
  });
}

/** GET /v2/illust/bookmark/detail：bookmark_detail=null = 未收藏（预填空态，spec D6） */
const MOCK_BOOKMARK_DETAIL = JSON.stringify({ bookmark_detail: null });

/** GET /v1/user/bookmark-tags/illust：标签库候选（公开/私密分库共用同一份 mock） */
const MOCK_TAG_UNIVERSE = JSON.stringify({
  bookmark_tags: [{ name: UNIVERSE_TAG, count: UNIVERSE_COUNT }],
  next_url: null,
});

/** 相关作品：合成作品无相关推荐，避免真实端点 404 噪音（spec related-injection 无关面） */
const MOCK_RELATED = JSON.stringify({ illusts: [], next_url: null });

/**
 * POST /v2/illust/bookmark/add 捕获包装（单行注入；agent-browser eval 约束）。
 * 记录真实请求体后回 200 {}，其余请求透传给已注入的 mockFetch 链。
 */
const CAPTURE_ADD_JS =
  "(() => { if (window.__bookmarkPosts) return 'already'; window.__bookmarkPosts = []; " +
  "const prev = window.fetch.bind(window); " +
  "window.fetch = (input, init) => { " +
  "const url = typeof input === 'string' ? input : input.url; " +
  "if (url.indexOf('/pixiv-api/v2/illust/bookmark/add') !== -1) { " +
  "window.__bookmarkPosts.push({ url: url, body: init && init.body ? String(init.body) : '' }); " +
  "return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })); } " +
  "return prev(input, init); }; return 'ok'; })()";

interface CapturedPost {
  url: string;
  body: string;
}

/** 面板内按钮定位：以面板内唯一 id 的输入框为锚点向上找到含目标按钮的最近祖先后点击。
 * 作用域限定避免与详情页心形（文本「♡ 收藏」）等同名按钮歧义；match 以 el 为元素变量。
 */
function panelButtonJs(match: string): string {
  return (
    `(() => { const input = document.getElementById('${PANEL_INPUT_ID}'); if (!input) return 'no-panel'; ` +
    `let root = input.parentElement; ` +
    `while (root && ![...root.querySelectorAll('button')].some(el => ${match})) root = root.parentElement; ` +
    `if (!root) return 'no-root'; ` +
    `const b = [...root.querySelectorAll('button')].find(el => ${match}); ` +
    `if (!b) return 'not-found'; b.click(); return 'clicked'; })()`
  );
}

/** 用例自隔离：组件实例跨 param 导航复用，上一条用例若中途失败可能留下打开的面板 */
async function closePanelIfOpen(driver: AgentBrowserDriver): Promise<void> {
  const open = await evalJson<boolean>(
    driver,
    `document.getElementById('${PANEL_INPUT_ID}') !== null`,
  );
  if (!open) return;
  await driver.evaluate(
    `(() => { const s = document.querySelector('[aria-label="关闭收藏面板"]'); if (!s) return 'no-scrim'; s.click(); return 'closed'; })()`,
  );
  const closed = await driver.waitForJs(
    `document.getElementById('${PANEL_INPUT_ID}') === null`,
    5_000,
  );
  expect(closed, "用例前置：应能关闭遗留的收藏面板").toBe(true);
}

/** 全局按钮匹配的 JS 谓词片段（断言用；点击一律走 panelButtonJs 的锚点定位） */
const btnMatchPredicate = (expr: string) =>
  `[...document.querySelectorAll('button')].some(b => ${expr})`;

async function evalJson<T>(driver: AgentBrowserDriver, js: string): Promise<T> {
  return JSON.parse(await driver.evaluate(js)) as T;
}

/** 清空捕获列表（每个用例断言自己触发的那一次请求） */
async function clearCapturedPosts(driver: AgentBrowserDriver): Promise<void> {
  await driver.evaluate("window.__bookmarkPosts.length = 0; 'cleared'");
}

async function readCapturedPosts(driver: AgentBrowserDriver): Promise<CapturedPost[]> {
  return evalJson<CapturedPost[]>(driver, "window.__bookmarkPosts");
}

/** 面板已选标签 chip 的可访问名列表（顺序 = 选择顺序，spec D5 保序） */
async function readSelectedTagLabels(driver: AgentBrowserDriver): Promise<string[]> {
  return evalJson<string[]>(
    driver,
    `[...document.querySelectorAll('[aria-label^="移除标签 "]')].map(b => b.getAttribute('aria-label'))`,
  );
}

/** 标签库 chip 的 aria-pressed（按「带 aria-pressed 且文本含标签名」精确定位：已选 chip 无 aria-pressed） */
async function readUniverseChipPressed(
  driver: AgentBrowserDriver,
  tagName: string,
): Promise<string | null> {
  const js = `(() => { const b = [...document.querySelectorAll('button')].find(el => (el.textContent || '').includes('${tagName}') && el.hasAttribute('aria-pressed')); return b ? b.getAttribute('aria-pressed') : null; })()`;
  return evalJson<string | null>(driver, js);
}

describe.skipIf(!process.env.PIXIV_REFRESH_TOKEN)("agent-browser 收藏加标签", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = await createLoggedInDriver();

    // 页面级 fetch mock（登录后注入；SPA 导航不清空，reload 会清空——本文件不 reload）
    await driver.mockFetch(`v1/illust/detail?illust_id=${QUICK_ID}`, mockIllustDetail(QUICK_ID));
    await driver.mockFetch(`v1/illust/detail?illust_id=${PANEL_ID}`, mockIllustDetail(PANEL_ID));
    await driver.mockFetch("v2/illust/related", MOCK_RELATED);
    await driver.mockFetch("v2/illust/bookmark/detail", MOCK_BOOKMARK_DETAIL);
    await driver.mockFetch("v1/user/bookmark-tags/illust", MOCK_TAG_UNIVERSE);
    // 载荷捕获（必须最后注入：包装在 mockFetch 链之外，普通请求继续透传）
    await driver.evaluate(CAPTURE_ADD_JS);
    const captureReady = await evalJson<boolean>(driver, "Array.isArray(window.__bookmarkPosts)");
    expect(captureReady, "bookmark/add 载荷捕获包装应注入成功").toBe(true);
  }, 240_000);

  afterAll(async () => {
    await driver?.close();
  });

  it("[S1] 长按心形 → 面板 → 勾选标签库 + 新建标签 → 保存：add 载荷 = illust_id/restrict/tags[]", async () => {
    // ── 进入合成插画详情（mock 未收藏 → 心形 aria-label=收藏） ──
    await driver.navigateSpa(`/illust/${PANEL_ID}`);
    const heartReady = await driver.waitForSelector(HEART_READY, 15_000);
    expect(heartReady, "合成插画详情应渲染未收藏心形（mock is_bookmarked=false）").toBe(true);
    await clearCapturedPosts(driver);

    // ── 长按心形：只派发 pointerdown（按住 500ms 到点即开面板，不等松手） ──
    const pressed = await driver.evaluate(
      `(() => { const b = document.querySelector('${HEART_READY}'); if (!b) return 'not-found'; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return 'down'; })()`,
    );
    expect(pressed, "心形应可派发 pointerdown").toContain("down");

    const panelOpen = await driver.waitForText(PANEL_TITLE, 15_000);
    expect(panelOpen, `长按 ${LONG_PRESS_MS}ms 后应出现收藏面板（spec 用户故事 1）`).toBe(true);
    // 长按本身不写服务端：面板打开前不应有任何 bookmark/add 请求
    expect((await readCapturedPosts(driver)).length, "长按唤出面板不应触发快速收藏请求").toBe(0);

    // ── 标签库候选 chip 渲染（mock bookmark_tags） ──
    const universeShown = await driver.waitForJs(
      btnMatchPredicate(`(b.textContent || '').includes('${UNIVERSE_TAG}')`),
      10_000,
    );
    expect(universeShown, "面板应渲染标签库候选 chip（mock 标签库）").toBe(true);
    expect(await readUniverseChipPressed(driver, UNIVERSE_TAG), "标签库候选初始未勾选").toBe(
      "false",
    );

    // ── 可见性切到私密（同时验证按分库重拉标签库后候选仍在） ──
    const restrictClicked = await driver.evaluate(
      panelButtonJs(`(el.textContent || '').trim() === '私密'`),
    );
    expect(restrictClicked, "面板应可点击「私密」可见性 chip").toContain("clicked");
    const privateOn = await driver.waitForJs(
      btnMatchPredicate(
        `(b.textContent || '').trim() === '私密' && b.getAttribute('aria-pressed') === 'true'`,
      ),
      10_000,
    );
    expect(privateOn, "可见性应切到私密（spec 用户故事 6）").toBe(true);
    const universeReloaded = await driver.waitForJs(
      btnMatchPredicate(`(b.textContent || '').includes('${UNIVERSE_TAG}')`),
      10_000,
    );
    expect(universeReloaded, "切换可见性后标签库应重新渲染候选（spec D7 分库）").toBe(true);

    // ── 勾选标签库 chip ──
    const chipClicked = await driver.evaluate(
      panelButtonJs(`(el.textContent || '').includes('${UNIVERSE_TAG}')`),
    );
    expect(chipClicked, "面板应可点击标签库 chip").toContain("clicked");
    const chipPressed = await driver.waitForJs(
      `(document.querySelector('button[aria-pressed="true"]') !== null)`,
      5_000,
    );
    expect(chipPressed, "勾选后应存在 aria-pressed=true 的 chip").toBe(true);
    expect(
      await readUniverseChipPressed(driver, UNIVERSE_TAG),
      "标签库 chip 勾选后应处于选中态",
    ).toBe("true");
    expect(
      await readSelectedTagLabels(driver),
      "已选区应出现该标签（可移除 chip，aria-label 前缀「移除标签 」）",
    ).toEqual([`${REMOVE_PREFIX}${UNIVERSE_TAG}`]);

    // 作品标签建议区（spec D5 建议来源）应渲染合成作品自带标签
    expect(
      await driver.waitForJs(
        btnMatchPredicate(`(b.textContent || '').trim() === '${WORK_TAG}'`),
        5_000,
      ),
      "面板应渲染作品标签建议 chip",
    ).toBe(true);

    // ── 内联新建标签：写入输入框（独立调用，等响应式落定）后以空格提交 token（spec D11） ──
    const typed = await driver.evaluate(
      `(() => { const el = document.getElementById('${PANEL_INPUT_ID}'); if (!el) return 'no-input'; el.value = '${NEW_TAG}'; el.dispatchEvent(new Event('input', { bubbles: true })); return 'typed'; })()`,
    );
    expect(typed, "应能写入新建标签输入框").toContain("typed");
    const committed = await driver.evaluate(
      `(() => { const el = document.getElementById('${PANEL_INPUT_ID}'); if (!el) return 'no-input'; el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); return 'committed'; })()`,
    );
    expect(committed, "应能提交新建标签").toContain("committed");
    const twoSelected = await driver.waitForJs(
      `document.querySelectorAll('[aria-label^="移除标签 "]').length === 2`,
      5_000,
    );
    expect(twoSelected, "已选区应同时含标签库标签与新建标签").toBe(true);
    expect(
      await readSelectedTagLabels(driver),
      "已选区顺序 = 选择顺序（标签库标签在前，新建标签在后），决定 tags[] 序列化顺序",
    ).toEqual([`${REMOVE_PREFIX}${UNIVERSE_TAG}`, `${REMOVE_PREFIX}${NEW_TAG}`]);

    // ── 保存（未收藏预填 → 文案「收藏」；保存即覆盖式 add，spec D2） ──
    const saveClicked = await driver.evaluate(
      panelButtonJs(`(el.textContent || '').trim() === '${SAVE_LABEL}'`),
    );
    expect(saveClicked, "面板应可点击保存按钮").toContain("clicked");
    const posted = await driver.waitForJs("window.__bookmarkPosts.length >= 1", 10_000);
    expect(posted, "保存应发出 bookmark/add 请求").toBe(true);

    // ── 载荷断言：真实发出的表单体（URLSearchParams 编码，按字段解码比对） ──
    const posts = await readCapturedPosts(driver);
    // 证据化输出：CI 日志可见被测代码真实发出的字节（便于失败复盘）
    console.log(`[bookmark-tags][S1] 捕获 bookmark/add 请求体: ${posts[0]?.body ?? "<无>"}`);
    expect(posts.length, "保存应恰好发出 1 次 bookmark/add").toBe(1);
    expect(posts[0].url, "请求应指向 bookmark/add 端点").toContain("/v2/illust/bookmark/add");
    const params = new URLSearchParams(posts[0].body);
    expect(params.get("illust_id"), "载荷 illust_id 应为当前作品 id").toBe(String(PANEL_ID));
    expect(params.get("restrict"), "载荷 restrict 应反映面板选择的可见性").toBe("private");
    expect(params.get("tags[]"), "载荷 tags[] 应为标签空格 join 的单值").toBe(
      `${UNIVERSE_TAG} ${NEW_TAG}`,
    );

    // ── 面板关闭 + 宿主收藏态更新（onSaved → is_bookmarked 置真） ──
    const panelClosed = await driver.waitForJs(
      `document.getElementById('${PANEL_INPUT_ID}') === null`,
      5_000,
    );
    expect(panelClosed, "保存成功后面板应关闭").toBe(true);
    const hostUpdated = await driver.waitForSelector(HEART_BOOKMARKED, 10_000);
    expect(hostUpdated, "保存成功后详情页心形应显示已收藏态").toBe(true);
  }, 120_000);

  it("[S2] 单击心形 = 快速收藏（不弹面板、载荷不含 tags）", async () => {
    await driver.navigateSpa(`/illust/${QUICK_ID}`);
    await closePanelIfOpen(driver);
    const heartReady = await driver.waitForSelector(HEART_READY, 15_000);
    expect(heartReady, "合成插画详情应渲染未收藏心形").toBe(true);
    await clearCapturedPosts(driver);

    // ── 单击 = pointerdown + 立即 pointerup（短于长按阈值 → 走快速收藏路径） ──
    const tapped = await driver.evaluate(
      `(() => { const b = document.querySelector('${HEART_READY}'); if (!b) return 'not-found'; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); return 'tapped'; })()`,
    );
    expect(tapped, "心形应可派发单击手势").toContain("tapped");
    const posted = await driver.waitForJs("window.__bookmarkPosts.length >= 1", 10_000);
    expect(posted, "快速收藏应发出 bookmark/add 请求").toBe(true);

    const posts = await readCapturedPosts(driver);
    console.log(`[bookmark-tags][S2] 捕获 bookmark/add 请求体: ${posts[0]?.body ?? "<无>"}`);
    expect(posts.length, "快速收藏应恰好发出 1 次请求").toBe(1);
    const params = new URLSearchParams(posts[0].body);
    expect(params.get("illust_id"), "载荷 illust_id 应为当前作品 id").toBe(String(QUICK_ID));
    expect(params.get("restrict"), "快速收藏恒公开（spec 用户故事 2）").toBe("public");
    expect(params.has("tags[]"), "快速收藏零标签：空标签集不得发 tags 字段（spec D1）").toBe(false);

    // ── 不弹面板：等过长按阈值再断言（长按计时已被 pointerup 取消，面板永不出现） ──
    await SLEEP(LONG_PRESS_MS + 200);
    const panelAbsent = await evalJson<boolean>(
      driver,
      `document.getElementById('${PANEL_INPUT_ID}') === null`,
    );
    expect(panelAbsent, `单击（未达 ${LONG_PRESS_MS}ms）不得唤出收藏面板`).toBe(true);
    const panelTitleShown = await evalJson<boolean>(
      driver,
      `document.body.innerText.includes('${PANEL_TITLE}')`,
    );
    expect(panelTitleShown, "页面不应出现收藏面板标题").toBe(false);

    // 宿主收藏态已翻转（动效/联动不变，spec 用户故事 2）
    const hostUpdated = await driver.waitForSelector(HEART_BOOKMARKED, 10_000);
    expect(hostUpdated, "快速收藏后详情页心形应显示已收藏态").toBe(true);
  }, 120_000);
});

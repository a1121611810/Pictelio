/**
 * 收藏加标签 Android 模拟器验收（T7 / issue #536；spec docs/specs/bookmark-tags.md、ADR-0160 D3/D4）。
 *
 * ── 验收口径（「功能是真的正常」而非纸面绿）────────────────────────────────
 * 1. **设备级真实输入**：长按 = `adb shell input motionevent DOWN/UP`（静止按压 700ms，非合成事件）；
 *    单击 = `input tap`。坐标由「uiautomator dump 的 WebView bounds + 页内 getBoundingClientRect
 *    × scale」实测推导（不写死常量，AVD 漂移由 scale 断言暴露）。
 * 2. **真实网络与真实服务端**：登录用 .env 的 PIXIV_REFRESH_TOKEN 走 webview 登录页契约注入
 *    （与 switch-client-oneway / fab 回归同款）；此后所有读写在真机上打到 Pixiv：
 *    GET /v2/illust/bookmark/detail（预填）、GET /v1/user/bookmark-tags/illust（标签库）、
 *    POST /v2/illust/bookmark/add（带 tags[] 保存）。
 * 3. **双 oracle 交叉**：
 *    - 服务端直读（host 侧 curl 直连 Pixiv App API，**不经 app 代码路径**）：断言
 *      `is_bookmarked=true` + `restrict` + `is_registered=true` 的标签集合真含本次所选；
 *    - UI 回读：重开面板，预填（来自 bookmark/detail）中该标签为选中态。
 *    两者一致才判定链路真的通。
 * 4. **确定性前置**：目标插画由 host API 从推荐流中挑选**当前未收藏**的一张（避免「已收藏」
 *    导致单击语义反转、断言失义）。
 * 5. **账号状态自清理**：末尾取消收藏还原（不在真实账号留验收痕迹）。
 *
 * ── 方法学注意（踩过的坑，写在这里防复发）───────────────────────────────
 * WebDriver `execute(script)` 把字符串当作**函数体**执行：只写表达式不写 `return` 时返回
 * `undefined`——等待谓词必须用**函数式**（`execute(fn, args)`）或显式 `return`。本 spec 全部
 * 走函数式谓词。
 *
 * ── 已知边界（显式声明）─────────────────────────────────────────────────
 * - 打开详情页用 `pushState` 路由跳转（导航非本 effort 被测对象，且避免推荐流加载时序抖动）；
 *   被验收的手势（长按/单击/面板内点击）全部走设备级输入。
 * - lynx 侧完整 UI 操作在当前 SDK 下不可自动化（仓库既有约定，见 fab 回归注释）：本 spec 覆盖
 *   webview 端真实链路；lynx 端由引擎切换 + 启动渲染 + 单元/模板测试兜底。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSON5 from "json5";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";
import { adbPath, REPO_ROOT, runCapture, runOrThrow } from "../env";
import { SLEEP, clickByText } from "../helpers";

/** 面板可访问选择器（组件内 data-testid / aria-label，见 BookmarkPanel.tsx） */
const SEL = {
  panel: '[data-testid="bookmark-panel"]',
  scrim: '[data-testid="bookmark-panel-scrim"]',
  input: '[data-testid="bookmark-panel-input"]',
  add: '[data-testid="bookmark-panel-add"]',
  save: '[data-testid="bookmark-panel-save"]',
  heartIdle: 'button[aria-label="收藏"]',
  heartActive: 'button[aria-label="取消收藏"]',
  suggestionChip: 'button[aria-label^="加入作品标签 "]',
} as const;

/** 验收用新建标签（ASCII，便于在证据与断言中稳定比对） */
const NEW_TAG = `e2e-tag-${String(Date.now() % 1_000_000)}`;

const PIXIV_UA = "PixivAndroidApp/5.0.234 (Android 11; Pixel 5)";

interface BookmarkDetail {
  is_bookmarked?: boolean;
  restrict?: string;
  tags?: { name: string; is_registered?: boolean }[];
}

let ctx: AndroidE2eContext;
let serial: string;
let geo: { left: number; top: number; scaleX: number; scaleY: number };
let illustId = "";

// ─── host 侧直连 Pixiv（独立 oracle；凭据取仓库既有 credentials.json5，不硬编码）──

function hostProxy(): string {
  return process.env.HTTPS_PROXY ?? process.env.https_proxy ?? "http://127.0.0.1:10808";
}

function pixivCredentials(): { clientId: string; clientSecret: string } {
  const cfg = JSON5.parse(
    readFileSync(resolve(REPO_ROOT, "packages/app/credentials.json5"), "utf8"),
  ) as { clientId: string; clientSecret: string };
  return { clientId: cfg.clientId, clientSecret: cfg.clientSecret };
}

let cachedAccess: { token: string; expiresAt: number } | null = null;

function hostAccessToken(): string {
  if (cachedAccess && Date.now() < cachedAccess.expiresAt) {
    return cachedAccess.token;
  }
  const refresh = process.env.PIXIV_REFRESH_TOKEN ?? "";
  expect(refresh.length).toBeGreaterThan(0);
  const { clientId, clientSecret } = pixivCredentials();
  const res = runCapture(
    "curl",
    [
      "-s",
      "-x",
      hostProxy(),
      "-X",
      "POST",
      "https://oauth.secure.pixiv.net/auth/token",
      "-H",
      "Content-Type: application/x-www-form-urlencoded",
      "-H",
      `User-Agent: ${PIXIV_UA}`,
      "-H",
      "Referer: https://app-api.pixiv.net/",
      "--data-urlencode",
      `client_id=${clientId}`,
      "--data-urlencode",
      `client_secret=${clientSecret}`,
      "--data-urlencode",
      "grant_type=refresh_token",
      "--data-urlencode",
      `refresh_token=${refresh}`,
      "--data-urlencode",
      "include_policy=true",
    ],
    30_000,
  );
  const parsed = JSON.parse(res.stdout) as { access_token?: string };
  if (!parsed.access_token) {
    throw new Error(`host 侧换取 access_token 失败: ${res.stdout.slice(0, 200)}`);
  }
  cachedAccess = { token: parsed.access_token, expiresAt: Date.now() + 2_400_000 };
  return parsed.access_token;
}

function pixivGet<T>(path: string): T {
  const res = runCapture(
    "curl",
    [
      "-s",
      "-x",
      hostProxy(),
      "-H",
      `Authorization: Bearer ${hostAccessToken()}`,
      "-H",
      `User-Agent: ${PIXIV_UA}`,
      "-H",
      "Referer: https://app-api.pixiv.net/",
      `https://app-api.pixiv.net${path}`,
    ],
    30_000,
  );
  return JSON.parse(res.stdout) as T;
}

/** 服务端真值：读收藏详情（oracle 独立于被测实现）。 */
function serverBookmarkDetail(id: string): BookmarkDetail | null | undefined {
  return pixivGet<{ bookmark_detail?: BookmarkDetail | null }>(
    `/v2/illust/bookmark/detail?illust_id=${id}`,
  ).bookmark_detail;
}

/** 从推荐流挑一张**当前未收藏**的插画（确定性前置，避免单击语义反转）。 */
function pickUnbookmarkedIllustId(): string {
  const rec = pixivGet<{ illusts: { id: number }[] }>("/v1/illust/recommended?filter=for_ios");
  for (const item of rec.illusts.slice(0, 12)) {
    const id = String(item.id);
    if (serverBookmarkDetail(id)?.is_bookmarked !== true) {
      return id;
    }
  }
  throw new Error("推荐流前 12 条均已被收藏，无法挑选未收藏插画");
}

// ─── 设备/页内交互基建 ───

/** 校验目标 AVD 规格（坐标推导依赖；AVD 漂移时快速失败而非静默错点）。 */
function assertDeviceGeometry(): void {
  const size = runCapture(adbPath(), ["-s", serial, "shell", "wm", "size"]).stdout;
  const density = runCapture(adbPath(), ["-s", serial, "shell", "wm", "density"]).stdout;
  expect(size).toMatch(/1080x2160/u);
  expect(density).toMatch(/480/u);
}

/**
 * 读窗口几何（坐标映射基线）。
 *
 * 为什么不用 uiautomator dump：在图片内容页 dump 会被系统 SIGKILL（exit 137，内存所限；
 * 与 fab 回归里「Lynx 页 dump 不可用」同族问题）。改用 `dumpsys window displays`：
 * 输出含 DisplayFrames 尺寸与 ROTATION_0 的 configInsets / nonDecorFrame，稳定且可解析。
 *
 * 映射模型（1080×2160 / density 480 实测）：应用内容区 = nonDecorFrame 再按 configInsets
 * 顶部内边距内缩（状态栏不透明，非 edge-to-edge），即 contentRect=[0,72]→[1080,2088]；
 * 于是 device = contentOrigin + css × dpr。调用方用 innerHeight 断言该模型成立。
 */
function readContentGeometry(): {
  originX: number;
  originY: number;
  screenW: number;
  screenH: number;
  contentW: number;
  contentH: number;
} {
  const out = runCapture(adbPath(), [
    "-s",
    serial,
    "shell",
    "dumpsys",
    "window",
    "displays",
  ]).stdout;
  const display = /DisplayFrames w=(\d+) h=(\d+)/u.exec(out);
  const rot =
    /ROTATION_0=\{[^}]*configInsets=\[(\d+),(\d+)\]\[(\d+),(\d+)\][^}]*nonDecorFrame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/u.exec(
      out,
    );
  if (!display || !rot) {
    throw new Error("无法从 dumpsys window displays 解析显示几何（格式变化？）");
  }
  const screenW = Number(display[1]);
  const screenH = Number(display[2]);
  // configInsets / nonDecorFrame 的形态均为 [left,top][right,bottom]
  const [ciLeft, ciTop] = [Number(rot[1]), Number(rot[2])];
  const [ndLeft, ndTop, ndRight, ndBottom] = [
    Number(rot[5]),
    Number(rot[6]),
    Number(rot[7]),
    Number(rot[8]),
  ];
  const originX = ndLeft + ciLeft;
  const originY = ndTop + ciTop;
  return {
    originX,
    originY,
    screenW,
    screenH,
    contentW: ndRight - originX,
    contentH: ndBottom - originY,
  };
}

/** 元素存在（函数式谓词：WebDriver 只对「函数」取返回值）。 */
async function exists(selector: string): Promise<boolean> {
  return Boolean(
    await ctx.driver.raw.execute((sel: string) => document.querySelector(sel) !== null, selector),
  );
}

/** 页面文本（用于文案断言）。 */
async function pageText(): Promise<string> {
  return String(await ctx.driver.raw.execute(() => document.body.innerText));
}

/** 元素是否可用（disabled 属性）。 */
async function isEnabled(selector: string): Promise<boolean> {
  return Boolean(
    await ctx.driver.raw.execute((sel: string) => {
      const el = document.querySelector(sel) as HTMLButtonElement | null;
      return el !== null && !el.disabled;
    }, selector),
  );
}

/** 某 chip 是否处于选中态（aria-pressed="true" 且 aria-label 精确等于 label）。 */
async function chipPressed(selector: string, label: string): Promise<boolean> {
  return Boolean(
    await ctx.driver.raw.execute(
      (sel: string, lab: string) =>
        [...document.querySelectorAll(sel)].some(
          (b) => b.getAttribute("aria-label") === lab && b.getAttribute("aria-pressed") === "true",
        ),
      selector,
      label,
    ),
  );
}

/** 元素中心 CSS 坐标（devicePixelRatio 一并返回用于映射校验）。 */
async function elementCenter(
  selector: string,
): Promise<{ cx: number; cy: number; dpr: number; innerWidth: number; innerHeight: number }> {
  const raw = await ctx.driver.raw.execute((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) {
      return null;
    }
    const b = el.getBoundingClientRect();
    return {
      cx: b.left + b.width / 2,
      cy: b.top + b.height / 2,
      dpr: window.devicePixelRatio,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  }, selector);
  if (!raw) {
    throw new Error(`元素不存在，无法定位: ${selector}`);
  }
  return raw as { cx: number; cy: number; dpr: number; innerWidth: number; innerHeight: number };
}

function toDevice(cssX: number, cssY: number): { x: number; y: number } {
  return {
    x: Math.round(geo.left + cssX * geo.scaleX),
    y: Math.round(geo.top + cssY * geo.scaleY),
  };
}

async function tapSelector(selector: string): Promise<void> {
  const c = await elementCenter(selector);
  const p = toDevice(c.cx, c.cy);
  runOrThrow(adbPath(), ["-s", serial, "shell", "input", "tap", String(p.x), String(p.y)]);
}

/**
 * 面板内目标：先滚入面板可视区再点。
 *
 * 面板内容区可滚动（max-height 80vh）：选中标签变多后底部「保存」会被挤出可视区，此时
 * getBoundingClientRect 的 y 已越过视口——直接按坐标点会落在屏外（实测：请求根本没发出、
 * 服务端真值不变）。**只滚面板自身的滚动容器**：scrollIntoView 会连带滚动整页，导致信息区
 * 进入视口 → 底部操作条自动隐藏，后续找不到心形（实测踩过）。越界即失败，不盲点。
 */
async function tapInPanel(selector: string): Promise<void> {
  await ctx.driver.raw.execute(
    (sheetSel: string, targetSel: string) => {
      const sheet = document.querySelector(sheetSel);
      const el = document.querySelector(targetSel);
      if (!sheet || !el) {
        return;
      }
      const delta = el.getBoundingClientRect().top - sheet.getBoundingClientRect().top;
      sheet.scrollTop = sheet.scrollTop + delta - sheet.clientHeight / 2;
    },
    '[data-testid="bookmark-panel-sheet"]',
    selector,
  );
  await SLEEP(400);
  const c = await elementCenter(selector);
  if (c.cy < 0 || c.cy > c.innerHeight) {
    throw new Error(
      `目标不在视口内（${selector} 中心 y=${c.cy.toFixed(1)}，视口高 ${c.innerHeight}）——拒绝盲点`,
    );
  }
  const p = toDevice(c.cx, c.cy);
  runOrThrow(adbPath(), ["-s", serial, "shell", "input", "tap", String(p.x), String(p.y)]);
}

/** 页面滚回顶部（详情页操作条在信息区进入视口时自动隐藏；断言心形前必须复位）。 */
async function scrollPageToTop(): Promise<void> {
  await ctx.driver.raw.execute(() => window.scrollTo(0, 0));
  await SLEEP(500);
}

/** 视口 CSS 尺寸。 */
async function viewport(): Promise<{ w: number; h: number }> {
  return (await ctx.driver.raw.execute(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }))) as { w: number; h: number };
}

/**
 * 点遮罩关闭面板。
 *
 * 必须点**面板上方**的遮罩区：面板高至 80vh，屏幕几何中心落在面板体内（实测踩过——
 * 点中心不会关闭面板，反而命中面板 body），故固定点视口顶部 30 CSS px 处。
 */
async function tapScrimAbovePanel(): Promise<void> {
  const vp = await viewport();
  const p = toDevice(vp.w / 2, 30);
  runOrThrow(adbPath(), ["-s", serial, "shell", "input", "tap", String(p.x), String(p.y)]);
}

/**
 * 设备级长按：motionevent DOWN → 静止 700ms → UP（真实触摸，跨过 500ms 长按阈值）。
 * 用 motionevent 而非 swipe：零位移，语义上就是长按，不引入滑动/惯性副作用。
 */
async function longPressSelector(selector: string, holdMs = 700): Promise<void> {
  const c = await elementCenter(selector);
  const p = toDevice(c.cx, c.cy);
  runOrThrow(adbPath(), [
    "-s",
    serial,
    "shell",
    "input",
    "motionevent",
    "DOWN",
    String(p.x),
    String(p.y),
  ]);
  await SLEEP(holdMs);
  runOrThrow(adbPath(), [
    "-s",
    serial,
    "shell",
    "input",
    "motionevent",
    "UP",
    String(p.x),
    String(p.y),
  ]);
}

/** 条件等待（谓词为 TS 函数，每轮一次往返；超时收证据后抛错，不静默通过）。 */
async function waitFor(
  predicate: () => Promise<boolean>,
  label: string,
  timeoutMs = 20_000,
  intervalMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await SLEEP(intervalMs);
  }
  await ctx.driver.collectEvidence(`timeout-${label}`).catch(() => {});
  throw new Error(`等待超时（${label}，${timeoutMs}ms）`);
}

// ─── 登录与导航 ───

/** 登录（webview 契约注入；与 switch-client-oneway / fab 回归同款内联实现）。 */
async function loginViaWebview(): Promise<void> {
  const { driver } = ctx;
  await driver.switchToWebView(60_000);

  await driver.raw.waitUntil(
    async () => {
      const url = await driver.raw.getUrl();
      if (!url.includes("/age-confirmation")) return true;
      await clickByText(ctx, "已满 18 岁");
      return false;
    },
    { timeout: 60_000, timeoutMsg: "年龄确认页未通过", interval: 1_000 },
  );

  await driver.raw.waitUntil(
    async () =>
      (await driver.raw.$("fluent-textarea").isExisting()) &&
      (await driver.raw.$("fluent-button=登录").isExisting()),
    { timeout: 30_000, timeoutMsg: "登录页未渲染", interval: 1_000 },
  );

  const token = process.env.PIXIV_REFRESH_TOKEN ?? "";
  expect(token.length).toBeGreaterThan(0);
  await driver.raw.execute(
    `(() => {
      const ta = document.querySelector('fluent-textarea');
      const inner = ta && ta.shadowRoot ? ta.shadowRoot.querySelector('textarea') : null;
      if (!inner) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(inner, ${JSON.stringify(token)});
      inner.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      inner.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    })()`,
  );
  await driver.raw.waitUntil(
    async () => (await driver.raw.$("fluent-button=登录").getAttribute("disabled")) === null,
    { timeout: 10_000, timeoutMsg: "token 注入后登录按钮未启用", interval: 300 },
  );
  await clickByText(ctx, "登录");
  await driver.raw.waitUntil(async () => !(await driver.raw.getUrl()).includes("/login"), {
    timeout: 90_000,
    timeoutMsg: "登录失败（仍停留在 /login）",
    interval: 2_000,
  });
}

/** pushState 路由跳转到指定路径（导航非被测对象；避免推荐流加载时序抖动）。 */
async function navigateTo(path: string): Promise<void> {
  await ctx.driver.raw.execute((p: string) => {
    window.history.pushState({}, "", p);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

beforeAll(async () => {
  ctx = await setupAndroidE2e();
  serial = ctx.serial;
  assertDeviceGeometry();
  await loginViaWebview();

  illustId = pickUnbookmarkedIllustId();
  await navigateTo(`/illust/${illustId}`);
  await waitFor(
    async () => (await exists(SEL.heartIdle)) || (await exists(SEL.heartActive)),
    "detail-heart-ready",
    60_000,
    1_000,
  );
  // 确定性前置校验：挑选时未收藏，则详情页心形必须是「收藏」态
  expect(await exists(SEL.heartIdle)).toBe(true);

  const content = readContentGeometry();
  const probe = await elementCenter(SEL.heartIdle);
  // 模型自校验：内容区尺寸必须等于「视口 CSS 尺寸 × 设备像素比」，否则坐标映射不可信
  expect(Math.abs(content.contentW - probe.innerWidth * probe.dpr)).toBeLessThan(2);
  expect(Math.abs(content.contentH - probe.innerHeight * probe.dpr)).toBeLessThan(2);
  const scaleX = probe.dpr;
  const scaleY = probe.dpr;
  geo = { left: content.originX, top: content.originY, scaleX, scaleY };
  console.log(
    `[bookmark-tags] 几何：屏幕 ${content.screenW}x${content.screenH}，内容原点 (${content.originX},${content.originY})，` +
      `内容区 ${content.contentW}x${content.contentH}，视口 ${probe.innerWidth}x${probe.innerHeight}，dpr=${probe.dpr}`,
  );
  console.log(`[bookmark-tags] 目标插画 ${illustId}（host API 预检：未收藏）`);
});

afterAll(async () => {
  await ctx?.teardown();
});

describe("收藏加标签 · webview 详情页真机验收", () => {
  it("长按心形打开收藏面板（设备级长按），且不改变收藏状态", async () => {
    await scrollPageToTop();
    await longPressSelector(SEL.heartIdle);

    await waitFor(() => exists(SEL.panel), "panel-open", 15_000);
    // 仅打开面板不产生收藏（用户故事 1：先决策后保存）
    expect(await exists(SEL.heartIdle)).toBe(true);
    // 预填落定（保存按钮可用 = 无预填失败）
    await waitFor(() => isEnabled(SEL.save), "prefill-ready", 25_000);

    await tapScrimAbovePanel();
    await waitFor(async () => !(await exists(SEL.panel)), "panel-closed", 15_000);
  });

  it("单击心形 = 快速收藏（不弹面板），再点还原", async () => {
    await scrollPageToTop();
    await tapSelector(SEL.heartIdle);
    await waitFor(() => exists(SEL.heartActive), "quick-bookmark", 25_000);
    expect(await exists(SEL.panel)).toBe(false);
    // 服务端真值：快速收藏为公开、无标签
    const d1 = serverBookmarkDetail(illustId);
    expect(d1?.is_bookmarked).toBe(true);
    expect(d1?.restrict).toBe("public");

    await scrollPageToTop();
    await tapSelector(SEL.heartActive);
    await waitFor(() => exists(SEL.heartIdle), "quick-unbookmark", 25_000);
    expect(serverBookmarkDetail(illustId)?.is_bookmarked).toBe(false);
  });

  it("面板内选作品标签 + 新建标签 + 保存 → 服务端落库（双 oracle）", async () => {
    await scrollPageToTop();
    await longPressSelector(SEL.heartIdle);
    await waitFor(() => exists(SEL.panel), "panel-open-2", 15_000);
    await waitFor(() => isEnabled(SEL.save), "prefill-ready-2", 25_000);

    // 1) 勾选一个作品标签建议（必须真的产生选中态）
    const chipName = String(
      await ctx.driver.raw.execute((sel: string) => {
        const el = document.querySelector(sel);
        const label = el?.getAttribute("aria-label") ?? "";
        return label.replace("加入作品标签 ", "");
      }, SEL.suggestionChip),
    );
    expect(chipName.length).toBeGreaterThan(0);
    await tapInPanel(SEL.suggestionChip);
    await waitFor(
      () => chipPressed(SEL.suggestionChip, `加入作品标签 ${chipName}`),
      "suggestion-selected",
      15_000,
    );

    // 2) 内联新建标签：真实输入（CDP setValue）+ 设备级点「添加」
    const inputEl = await ctx.driver.raw.$(SEL.input);
    await inputEl.setValue(NEW_TAG);
    await SLEEP(400);
    await tapInPanel(SEL.add);
    await waitFor(async () => (await pageText()).includes(NEW_TAG), "new-tag-added", 15_000);
    // 新建标签进入已选集（选中态）
    await waitFor(() => chipPressed("button", `移除标签 ${NEW_TAG}`), "new-tag-selected", 15_000);

    // 3) 保存
    await tapInPanel(SEL.save);
    await waitFor(async () => !(await exists(SEL.panel)), "panel-closed-after-save", 30_000);
    await waitFor(() => exists(SEL.heartActive), "bookmarked-after-save", 25_000);

    // 4) oracle A：host 侧直连 Pixiv 读服务端真值
    const server = serverBookmarkDetail(illustId);
    expect(server?.is_bookmarked).toBe(true);
    expect(server?.restrict).toBe("public");
    const registered = (server?.tags ?? [])
      .filter((tag) => tag.is_registered)
      .map((tag) => tag.name);
    expect(registered).toContain(NEW_TAG);
    expect(registered).toContain(chipName);
    console.log(
      `[bookmark-tags] oracle A（服务端直读）：is_bookmarked=true, restrict=public, is_registered=[${registered.join(", ")}]`,
    );
  });

  it("oracle B：重开面板，预填（服务端数据）显示已保存标签，并清理账号状态", async () => {
    await scrollPageToTop();
    await longPressSelector(SEL.heartActive);
    await waitFor(() => exists(SEL.panel), "panel-open-3", 15_000);

    // 预填来自 GET /v2/illust/bookmark/detail：已注册标签应呈选中态
    await waitFor(
      () => chipPressed("button", `移除标签 ${NEW_TAG}`),
      "oracle-b-tag-prefilled",
      25_000,
    );
    await waitFor(async () => (await pageText()).includes("保存修改"), "edit-label", 15_000);
    console.log("[bookmark-tags] oracle B（UI 回读）：面板预填含已保存标签且为编辑态");

    // 收尾：关面板 + 取消收藏（真实账号状态还原）
    await tapScrimAbovePanel();
    await waitFor(async () => !(await exists(SEL.panel)), "panel-closed-final", 15_000);
    await scrollPageToTop();
    await tapSelector(SEL.heartActive);
    await waitFor(() => exists(SEL.heartIdle), "cleanup-unbookmark", 25_000);
    expect(serverBookmarkDetail(illustId)?.is_bookmarked).toBe(false);
    console.log(`[bookmark-tags] ✓ 验收通过；账号状态已还原（标签 ${NEW_TAG} / 插画 ${illustId}）`);
  });
});

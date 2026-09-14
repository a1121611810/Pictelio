/**
 * 收藏加标签 · **lynx 客户端**详情页真机验收（ticket #536 必验项，跟进票 #538）。
 *
 * 与 `bookmark-tags.spec.ts`（webview 端，6/6 绿）互补：本文件把同一被测能力
 * （长按心形 → 收藏面板 → 选可见性/标签 → 保存 → 服务端真值）搬到 lynx 引擎上，
 * 全程**设备级真实输入** + **host 侧直连 Pixiv 读真值**（不经 app 代码路径）。
 *
 * ── 为什么这样驱动（lynx 平台的硬约束，可查证）───────────────────────────
 * 1. **无 UI 自动化通道**：原生 LynxView 的 accessibility 树不暴露 view/text
 *    （TalkBack 绑定仍空树），uiautomator dump 在 pictelio_ui 上必被 SIGKILL
 *    （exit 137）→ 全部定位走「截图 + 像素分析」（本文件内联实现）。
 * 2. **无深链**：lynx 是内存路由（无 URL 环境），`benchNav` 深链（ADR-0136）需
 *    `BENCH_NAV=1` 构建 + 原生 BuildConfig.DEBUG 双门禁，且 TARGETS 里**没有**
 *    详情页场景（只有 /illusts /novels /recommended /bookmarks 等列表页）。本
 *    AVD 上装的 full-debug APK 的 `assets/main.lynx.bundle` 实测 `grep -a -c
 *    pictelioBenchNav` = 0（钩子未注入）→ **必须用设备级点击进入详情**：
 *    推荐页轮播首卡 `@tap` → 详情（实测可用）。
 * 3. **原生 hit-testing 不识别 pointer-events**（ADR-0123）：面板是 `v-if` 条件
 *    渲染 + 遮罩自带 `@tap`，所以「面板出现/关闭」都是渲染树真实增减，截图可见。
 * 4. **长按必须用 motionevent**：`input tap` 是瞬时按压，跨不过 500ms 阈值；
 *    用 `input motionevent DOWN → sleep 0.7s → UP`（与 webview 端验收同法）。
 *
 * ── 目标插画 id 怎么来（本文件最关键的工程点）────────────────────────────
 * 详情页 id 在设备上不可直读（无 URL、无 a11y、logcat 不打 URL、缓存文件名不含
 * id；host 侧 `/v1/illust/recommended` 每次请求返回集合会变——实测两次请求 83/85
 * 条且目标插画可能不在其中，故「host 侧预测 id」不可靠）。故走**设备驱动的 id
 * 发现**，且与「进详情页」合成一步、**用可验证的动作闭环**（`enterDetailAndResolveId`）：
 * 单击定位到的心形 → host 侧收藏列表**恰好新增 1 条 public 收藏**（集合差；该账号
 * 收藏量 < 30，单页即完整快照，见 `bookmarkSets`）→ 同坐标心形须变红（证明 tap 命中
 * 心形而非旁边的可点行）→ 立即再点一次取消收藏还原基线。
 * 这个闭环同时是三条证据：①「当前页确实是插画详情页」；②目标插画 id；③lynx 快速
 * 收藏路径实证（写 public、心形变红、计数 +1、服务端 restrict=public）。
 *
 * ── 三项验收（按序，逐项留证到 test-results/android-e2e/lynx-bookmark-tags/）──
 * 1. 长按心形 500ms → 面板出现；**且未写收藏**（host 侧 `GET /v2/illust/bookmark/
 *    detail` 的 `is_bookmarked=false` + 收藏集合逐项不变）——证明旧「私密直存」
 *    语义在 lynx 详情页已消失。
 * 2. 面板内 tap「私密」→ tap「保存」→ host 侧直读 `is_bookmarked=true` 且
 *    `restrict="private"`（并顺带覆盖「作品标签建议 chip → 保存」的加标签路径：
 *    `is_registered` 标签集合由空变非空且 ⊆ 作品自带标签）。
 * 3. 清理：host 侧 `POST /v1/illust/bookmark/delete` **表单体**（`--data
 *    "illust_id=<id>"`，ADR-0161：不是 query）→ 复核 `is_bookmarked=false` 且
 *    收藏集合回到基线。
 *
 * ── 坐标来源（不做纯手抄，全部可复算）────────────────────────────────────
 * 布局日志（logcat `[Layout] layout finish with result size: 1080, 2016`）给出
 * **视口 = 1080×2016**（= 屏高 2160 − 状态栏 72 − 手势条 72），lynx 顶边 = 72：
 * - 面板 = `top-[20vh] h-[80vh]`（BookmarkPanel.vue）→ 面板顶 = 72 + 0.2×2016 =
 *   **475.2**（截图实测白色圆角起点 480，误差 ≤5px）；
 * - 保存按钮 = 面板底 − `pb-[5.333vw]`(57.6) − `h-[12vw]`/2(64.8) = 2088 − 122.4
 *   → 中心 y ≈ **1965**（截图实测色带 1902..2028，中心 1965 逐像素吻合）；
 * - 可见性 chip 行 = `mt-4` 块内标签下方 `mt-2`，`h-[10.667vw]` = **115.2**
 *   → 截图实测 y 720..834（h=115 ✓）；「公开」左边距 = `px-4` = 43.2（实测 46），
 *   「私密」中心实测 **(309, 777)**；
 * - 心形**不写死**：详情页滚动位置随作品标签行数浮动，一律用像素特征现定位
 *   （`findHeartGlyph`：左下角区域内「近方形实心暗/红色块」——M3 outline 色
 *   #71787E 未收藏 / error 红已收藏）。实测命中 (71,1744)，与标签文字块
 *   （h/w≈0.46）和「保存」字块可靠区分。
 *
 * ── 前置条件 ────────────────────────────────────────────────────────────
 * - AVD `pictelio_ui`（1080×2160 / density 480 / WebView 113），坐标常量绑定该
 *   规格（`assertDeviceGeometry` 快速失败防漂移）；flavor=webview 时整文件 skip。
 * - 设备全局代理（`ANDROID_E2E_HTTP_PROXY=10.0.2.2:10808`）：模拟器 DNS 被污染，
 *   不设代理则推荐流与图片都拉不到（实测）。
 * - 登录：`setupAndroidE2e` 的 `pm clear` 会清掉 Keystore 里的 refresh_token，
 *   故先按 fab 回归同款流程在 **webview 侧**注入 token 登录（`loginViaWebview`），
 *   再切 `pictelio_client_kind=lynx` 重启——lynx 经 `PictelioAuth` 从共享
 *   `WSSecureStorage` 种子恢复登录态（跨引擎登录态共享，ADR-0050/#126）。
 * - `PIXIV_REFRESH_TOKEN`（packages/app/.env）与 `credentials.json5`：host 侧
 *   独立 oracle 用（与 webview 验收同源）。
 *
 * ── 已知环境缺陷（与本次验收目标无关，但会出现在截图里）──────────────────
 * 详情页图片显示「图片加载失败」（推荐页封面正常）：`GET /v1/illust/detail` 的
 * 元数据与 `img-original` 页图在该代理链路上不可用，不影响本用例（心形位于信息区，
 * 高度由元数据预算，不依赖图片加载）。另有 lynx debug HUD（右上 FPS 条 + 触摸点
 * 红/蓝十字线）叠加在页面上——**像素断言已按此避让**（如可见性 chip 取 4 点中位数、
 * 心形检测限定左下角且用「实心块」判据而非颜色）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import JSON5 from "json5";
import { createCanvas, loadImage } from "canvas";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";
import {
  adbPath,
  APP_PACKAGE,
  E2E_FLAVOR,
  LYNX_ACTIVITY,
  MAIN_ACTIVITY,
  REPO_ROOT,
  runCapture,
  runOrThrow,
} from "../env";
import { clickByText } from "../helpers";
import { currentTopActivity, forceStopApp, startMainActivity, writeClientKind } from "../prefs";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 证据落盘目录（被 gitignore，仅本地取证用） */
const EVIDENCE_DIR = resolve(REPO_ROOT, "packages/app/test-results/android-e2e/lynx-bookmark-tags");
mkdirSync(EVIDENCE_DIR, { recursive: true });

// ── AVD pin（仿 fab 回归 / switch-client-roundtrip-low）：坐标常量绑定 pictelio_ui ──
const TARGET_AVD = process.env.ANDROID_E2E_AVD || "pictelio_ui";
const SKIPPED = TARGET_AVD !== "pictelio_ui" || E2E_FLAVOR === "webview";
const SKIP_REASON =
  TARGET_AVD !== "pictelio_ui"
    ? `本用例坐标常量绑定 pictelio_ui（1080×2160/density 480），当前 ANDROID_E2E_AVD=${TARGET_AVD}`
    : `本用例需要 full 包（Lynx 引擎）；当前 ANDROID_E2E_FLAVOR=webview，已整文件跳过`;
if (SKIPPED) {
  console.log(`[lynx-bookmark-tags] SKIP: ${SKIP_REASON}`);
}

// ── 坐标常量（推导见文件头注释；均为「屏幕物理像素」）──
/** 推荐页轮播首卡的点击点（图片区内，避开底部 scrim 信息区与右侧 FAB） */
const CAROUSEL_CARD_TAP = { x: 540, y: 900 };
/** 可见性 chip 行 y（实测 720..834 的中心） */
const CHIP_ROW_Y = 777;
/** 「私密」chip 中心 x（实测 bbox 230..388） */
const PRIVATE_CHIP_X = 309;
/** 「公开」chip 采样框（用于断言其变回未选中态） */
const PUBLIC_CHIP_BOX = { x0: 55, x1: 200, y0: 730, y1: 825 };
/** 「私密」chip 采样框（断言其进入选中态） */
const PRIVATE_CHIP_BOX = { x0: 240, x1: 380, y0: 730, y1: 825 };
/** 保存按钮所在色带（bbox 由像素现算，这里只给扫描窗口） */
const SAVE_BAND_WINDOW = { y0: 1870, y1: 2050 };

const PIXIV_UA = "PixivIOSApp/7.18.3 (iOS 18.5; iPhone15,4)";

interface PixivBookmarkDetail {
  is_bookmarked?: boolean;
  restrict?: string;
  tags?: { name: string; is_registered?: boolean }[];
}
interface PixivIllustLite {
  id: number;
  tags?: { name: string }[];
}

let ctx: AndroidE2eContext | undefined;
let serial = "";
/** 目标插画 id（设备驱动的 id 发现得到，见文件头「目标插画 id 怎么来」） */
let illustId = "";

// ─── 设备侧基建 ───

/** 校验目标 AVD 分辨率/密度（坐标推导依赖；漂移时快速失败而非静默错点）。 */
function assertDeviceGeometry(): void {
  const size = runCapture(adbPath(), ["-s", serial, "shell", "wm", "size"]).stdout;
  const density = runCapture(adbPath(), ["-s", serial, "shell", "wm", "density"]).stdout;
  expect(size).toMatch(/1080x2160/u);
  expect(density).toMatch(/480/u);
}

/** 截屏（exec-out 直取 PNG 字节流，20MB 上限防 1080×2160 PNG 触发 ENOBUFS）并落盘留证。 */
function screenshot(name: string): Buffer {
  const buf = execFileSync(adbPath(), ["-s", serial, "exec-out", "screencap", "-p"], {
    maxBuffer: 20 * 1024 * 1024,
  });
  writeFileSync(resolve(EVIDENCE_DIR, `${name}.png`), buf);
  return buf;
}

/** 像素视图（canvas 解码 + getImageData；与 fab 回归同款依赖） */
interface Pixels {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

async function toPixels(png: Buffer): Promise<Pixels> {
  const img = await loadImage(png);
  const canvas = createCanvas(img.width, img.height);
  const c2d = canvas.getContext("2d");
  c2d.drawImage(img, 0, 0);
  const { data } = c2d.getImageData(0, 0, img.width, img.height);
  return { w: img.width, h: img.height, data };
}

function pixelAt(p: Pixels, x: number, y: number): [number, number, number] {
  const i = (Math.round(y) * p.w + Math.round(x)) * 4;
  return [p.data[i], p.data[i + 1], p.data[i + 2]];
}

/** 饱和度（max−min）；用于区分「选中态实色 chip」与「未选中态浅灰 chip」 */
function saturation(p: Pixels, x: number, y: number): number {
  const [r, g, b] = pixelAt(p, x, y);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function tap(x: number, y: number): void {
  runOrThrow(adbPath(), ["-s", serial, "shell", "input", "tap", String(x), String(y)]);
}

/** 设备级长按：DOWN → 静止 holdMs → UP（真实触摸，跨过 500ms 长按阈值；零位移）。 */
async function longPress(x: number, y: number, holdMs = 700): Promise<void> {
  runOrThrow(adbPath(), [
    "-s",
    serial,
    "shell",
    "input",
    "motionevent",
    "DOWN",
    String(x),
    String(y),
  ]);
  await SLEEP(holdMs);
  runOrThrow(adbPath(), [
    "-s",
    serial,
    "shell",
    "input",
    "motionevent",
    "UP",
    String(x),
    String(y),
  ]);
}

/** 详情页向下滑动一屏（scroll-view 内拖动；起点避开底部信息区与右侧 FAB）。 */
function swipeUp(): void {
  runOrThrow(adbPath(), [
    "-s",
    serial,
    "shell",
    "input",
    "swipe",
    "540",
    "1800",
    "540",
    "400",
    "300",
  ]);
}

/**
 * 心形定位（像素特征，不写死坐标）。
 *
 * 窗口 x ∈ [40, 130]：心形是 `text-[6.4vw]` 的固定字形，左对齐于 `p-4`（43.2px），
 * 实测跨两个不同作品稳定落在 x 50..92；右侧的「↓ 保存」字形在 x≈170 之外，天然排除。
 *
 * 判据（对 5 张真实截图校准）：连通块 bbox 满足 w ∈ [34,60]、h ∈ [38,64]、
 * h/w ∈ [1.0,1.4]、实心像素 ≥ 300，取实心数最大者。
 * **只按尺寸/长宽比就够，不要再加「心形缺口」之类的形状判据**——实测那个判据会把
 * 正确答案筛掉（心形顶部缺口位置随字体渲染浮动），而尺寸判据已能把同区域里的
 * 作者头像（h=109）、标题文字（w=62）、「581 × 1029」（h=23）、工具行「保存」（h=34）
 * 全部排除（早期版本因窗口过窄把头像裁成 79×109 而误判为心形，导致 tap 落到
 * 可点的作者行 → 误跳到用户页；这就是必须保留本窗口与尺寸判据的原因）。
 */
function findHeartGlyph(p: Pixels): { x: number; y: number } | null {
  const dark: [number, number][] = [];
  const xEnd = Math.min(130, Math.floor(p.w * 0.15));
  for (let y = Math.floor(p.h * 0.5); y < Math.floor(p.h * 0.99); y += 2) {
    for (let x = 40; x < xEnd; x += 1) {
      const [r, g, b] = pixelAt(p, x, y);
      const isInk = Math.max(r, g, b) < 170;
      const isRed = r > 170 && g < 90 && b < 90;
      if (isInk || isRed) dark.push([x, y]);
    }
  }
  const cells = new Map<string, [number, number][]>();
  for (const [x, y] of dark) {
    const key = `${Math.floor(x / 8)},${Math.floor(y / 8)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push([x, y]);
    else cells.set(key, [[x, y]]);
  }
  const seen = new Set<string>();
  let best: { n: number; cx: number; cy: number } | null = null;
  for (const key of cells.keys()) {
    if (seen.has(key)) continue;
    const stack = [key];
    seen.add(key);
    const comp: [number, number][] = [];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      comp.push(...(cells.get(cur) ?? []));
      const [cxi, cyi] = cur.split(",").map(Number);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nk = `${cxi + dx},${cyi + dy}`;
          if (cells.has(nk) && !seen.has(nk)) {
            seen.add(nk);
            stack.push(nk);
          }
        }
      }
    }
    const xs = comp.map((c) => c[0]);
    const ys = comp.map((c) => c[1]);
    const w = Math.max(...xs) - Math.min(...xs) + 1;
    const h = Math.max(...ys) - Math.min(...ys) + 1;
    const ratio = h / w;
    if (
      w >= 34 &&
      w <= 60 &&
      h >= 38 &&
      h <= 64 &&
      ratio >= 1.0 &&
      ratio <= 1.4 &&
      comp.length >= 300
    ) {
      if (!best || comp.length > best.n) {
        best = {
          n: comp.length,
          cx: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
          cy: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
        };
      }
    }
  }
  return best ? { x: best.cx, y: best.cy } : null;
}

/**
 * 心形是否处于「已收藏」态：`text-error` 红 (179,38,30) vs 未收藏 `text-outline`
 * 灰 (113,120,126)（同一坐标窗口实测 红 80/110、灰 0/110）。
 * 阈值取 0.5 —— lynx debug 的触摸点红标记只覆盖 1~2 行/列（≤20/110），不会误判。
 */
function heartFilled(p: Pixels, spot: { x: number; y: number }): boolean {
  let red = 0;
  let n = 0;
  for (let y = spot.y - 22; y <= spot.y + 22; y += 4) {
    for (let x = spot.x - 19; x <= spot.x + 19; x += 4) {
      n++;
      const [r, g, b] = pixelAt(p, x, y);
      if (r > 150 && g < 110 && b < 110) red++;
    }
  }
  return n > 0 && red / n >= 0.5;
}

/**
 * 面板是否打开：面板底部的「保存」按钮横跨近全宽且为饱和主题色带。
 * 实测分离度极大——关闭态该窗口饱和像素 0~2，打开态 ≈10100（单行峰值 164/170）。
 * 判据取 maxRow ≥ 100 且 total ≥ 2000（既不与「未加载完的图片」「FAB」混淆，
 * 也不受主题色取值影响）。
 */
function panelOpen(p: Pixels): boolean {
  let total = 0;
  let maxRow = 0;
  for (let y = SAVE_BAND_WINDOW.y0; y < SAVE_BAND_WINDOW.y1; y += 2) {
    let row = 0;
    for (let x = 30; x < p.w - 30; x += 6) {
      const [r, g, b] = pixelAt(p, x, y);
      if (Math.max(r, g, b) - Math.min(r, g, b) > 45 && Math.max(r, g, b) > 110) row++;
    }
    total += row;
    if (row > maxRow) maxRow = row;
  }
  return maxRow >= 100 && total >= 2000;
}

/** 定位保存按钮中心（面板打开时）：返回色带 bbox 的中心。 */
function findSaveButton(p: Pixels): { x: number; y: number } | null {
  let y0 = -1;
  let y1 = -1;
  let x0 = p.w;
  let x1 = 0;
  for (let y = SAVE_BAND_WINDOW.y0; y < SAVE_BAND_WINDOW.y1; y += 2) {
    for (let x = 30; x < p.w - 30; x += 6) {
      const [r, g, b] = pixelAt(p, x, y);
      if (Math.max(r, g, b) - Math.min(r, g, b) > 45 && Math.max(r, g, b) > 110) {
        if (y0 < 0) y0 = y;
        y1 = y;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
      }
    }
  }
  if (y0 < 0 || x1 - x0 < p.w * 0.6) return null;
  return { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2) };
}

/** 采样框内「饱和像素」占比（chip 选中态判定；自动规避 lynx debug 触摸点标记）。 */
function saturatedRatio(
  p: Pixels,
  box: { x0: number; x1: number; y0: number; y1: number },
): number {
  let sat = 0;
  let n = 0;
  for (let y = box.y0; y < box.y1; y += 3) {
    for (let x = box.x0; x < box.x1; x += 3) {
      n++;
      if (saturation(p, x, y) > 30) sat++;
    }
  }
  return n === 0 ? 0 : sat / n;
}

/** 面板内的「药丸」（chip）几何：h ≈ 115 = h-[10.667vw]。 */
interface Pill {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/**
 * 面板体内的药丸检测（通用）：把满足 `hit` 的像素按 10px 网格聚类成连通块，
 * 再按「药丸形状」过滤（h ∈ [100,130]、宽 ≥ 70、w/h ≥ 1.5）。
 * 形状过滤天然排除 lynx debug 的触摸点红/蓝十字标记（非药丸形状），
 * 故调用方不必为它做避让。
 */
function findPills(
  p: Pixels,
  y0: number,
  y1: number,
  hit: (x: number, y: number) => boolean,
): Pill[] {
  const cell = 10;
  const cells = new Map<string, [number, number][]>();
  for (let y = Math.max(0, y0); y < Math.min(p.h, y1); y += 2) {
    for (let x = 0; x < p.w; x += 2) {
      if (hit(x, y)) {
        const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
        const bucket = cells.get(key);
        if (bucket) bucket.push([x, y]);
        else cells.set(key, [[x, y]]);
      }
    }
  }
  const seen = new Set<string>();
  const pills: Pill[] = [];
  for (const key of cells.keys()) {
    if (seen.has(key)) continue;
    const stack = [key];
    seen.add(key);
    const comp: [number, number][] = [];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      comp.push(...(cells.get(cur) ?? []));
      const [cxi, cyi] = cur.split(",").map(Number);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nk = `${cxi + dx},${cyi + dy}`;
          if (cells.has(nk) && !seen.has(nk)) {
            seen.add(nk);
            stack.push(nk);
          }
        }
      }
    }
    const xs = comp.map((c) => c[0]);
    const ys = comp.map((c) => c[1]);
    const w = Math.max(...xs) - Math.min(...xs) + 1;
    const h = Math.max(...ys) - Math.min(...ys) + 1;
    if (h >= 100 && h <= 130 && w >= 70 && w / h >= 1.5) {
      pills.push({
        cx: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
        cy: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
        w,
        h,
      });
    }
  }
  return pills;
}

/** 未选中 chip 的填充色：`bg-surface-container-high`（M3 中性容器高）。 */
function isIdleChipFill(x: number, y: number, p: Pixels): boolean {
  const [r, g, b] = pixelAt(p, x, y);
  return Math.abs(r - 230) < 10 && Math.abs(g - 232) < 10 && Math.abs(b - 238) < 10;
}

/**
 * 「作品标签建议」chip 定位（末行最左那个）。
 * 只在**可见性行以下 200px 起**的窗口里找闲置态药丸，按 y 分行取最下一行的最左
 * chip —— 不依赖文案、不依赖标签行数；也不会误命中可见性 chip（y 窗口排除）。
 * 找不到（作品无标签 / 已全部选中）返回 null，由调用方显式 warn（不静默）。
 */
function findSuggestionsChip(p: Pixels, bodyBottomY: number): { x: number; y: number } | null {
  const pills = findPills(p, CHIP_ROW_Y + 200, bodyBottomY, (x, y) => isIdleChipFill(x, y, p));
  if (pills.length === 0) return null;
  const maxY = Math.max(...pills.map((c) => c.cy));
  const row = pills.filter((c) => Math.abs(c.cy - maxY) <= 30);
  row.sort((a, b) => a.cx - b.cx);
  const pick = row[0];
  return pick ? { x: pick.cx, y: pick.cy } : null;
}

/**
 * 面板体内「已选中 chip」计数：选中态 = 主题填充色（饱和），未选中 = 中性灰。
 * 窗口从可见性行下方起算（排除「公开/私密」这两个同样药丸形状的 chip）。
 *
 * 为什么用「计数」而不是「在某个固定坐标上断言选中态」：选中一个作品标签会**新增
 * 一行已选 chip**，把下方的建议区整体下移（实测 ~137px = 一行 chip + 间距），
 * 按 tap 前坐标取样的断言必然扑空（首跑实测 0.371 < 阈值 0.4 而误红）。
 */
function countSelectedPills(p: Pixels, bodyBottomY: number): number {
  return findPills(p, CHIP_ROW_Y + 150, bodyBottomY, (x, y) => saturation(p, x, y) > 25).length;
}

/** 条件等待（谓词为同步函数，每轮重截图一次；超时抛错并留最后一张证据）。 */
async function waitFor(
  label: string,
  predicate: (p: Pixels) => boolean | Promise<boolean>,
  timeoutMs = 30_000,
  intervalMs = 1_500,
): Promise<Buffer> {
  const deadline = Date.now() + timeoutMs;
  let last: ReturnType<typeof screenshot> = Buffer.alloc(0);
  while (Date.now() < deadline) {
    last = screenshot(`wait-${label}`);
    if (await predicate(await toPixels(last))) return last;
    await SLEEP(intervalMs);
  }
  throw new Error(`等待超时（${label}，${timeoutMs}ms）——最后证据已落盘 wait-${label}.png`);
}

/** 等待前台 Activity 变为期望值（prefs.currentTopActivity 归一化比对）。 */
async function waitForTopActivity(activity: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: string | null = null;
  while (Date.now() < deadline) {
    last = currentTopActivity(serial);
    if (last === activity) return;
    await SLEEP(1_000);
  }
  throw new Error(
    `等待前台 Activity ${activity} 超时（${timeoutMs / 1000}s），当前: ${last ?? "未知"}`,
  );
}

/** 等待 Lynx 渲染就绪（`onPageChanged|OnPatchFinishForFiber`，T7 口径）。 */
async function waitForLynxRenderReady(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (/onPageChanged|OnPatchFinishForFiber/u.test(logcatTailByPid())) {
      console.log("[lynx-bookmark-tags] ✓ Lynx 渲染就绪");
      return;
    }
    await SLEEP(1_000);
  }
  throw new Error(`等待 Lynx 渲染就绪超时（${timeoutMs / 1000}s）`);
}

/**
 * 按 pid 读 logcat 尾部（渲染就绪探测 + 证据留档）。
 *
 * **两个必须处理的坑（都实测踩过）**：
 * 1. lynx 的 `ElementManager::OnPatchFinishForFiber` 是**逐帧日志（~60fps）**，
 *    `logcat -d --pid <pid>` 单次可达数 MB；`runCapture` 没有 maxBuffer 参数
 *    （spawnSync 默认 1MB）→ 直接抛 `ENOBUFS`（实测把用例 ② 打成红）。
 *    故此处自带 spawnSync + 16MB maxBuffer。
 * 2. 全量 dump 无意义（60fps 噪声），用 `-t 2000` 只取尾部 2000 行。
 */
function logcatTailByPid(lines = 2000): string {
  const pid = runCapture(adbPath(), ["-s", serial, "shell", "pidof", APP_PACKAGE]).stdout.trim();
  if (!pid) return "(进程不存在)";
  const r = spawnSync(
    adbPath(),
    ["-s", serial, "shell", "logcat", "-d", "--pid", pid, "-t", String(lines)],
    { encoding: "utf-8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
  );
  return (r.stdout ?? "").trim();
}

/** 把关键 logcat 行留档（剔除逐帧噪声）。 */
function dumpLogcat(tag: string): void {
  const interesting = logcatTailByPid()
    .split("\n")
    .filter(
      (l) =>
        /PictelioApi|layout finish|bookmark-pop|bookmark-ring|Animation (start|end)|touch_event_handler|SendPageEvent|Error|error|warn|Warn/u.test(
          l,
        ) && !/OnPatchFinishForFiber|onUpdateDataWithoutChange/u.test(l),
    )
    .join("\n");
  writeFileSync(resolve(EVIDENCE_DIR, `${tag}-logcat.txt`), interesting);
}

// ─── host 侧直连 Pixiv（独立 oracle；凭据全部取自仓库既有文件）──

function hostProxy(): string {
  return process.env.HTTPS_PROXY ?? process.env.https_proxy ?? "http://127.0.0.1:10808";
}

function pixivCredentials(): { clientId: string; clientSecret: string } {
  const cfg = JSON5.parse(
    readFileSync(resolve(REPO_ROOT, "packages/app/credentials.json5"), "utf8"),
  ) as { clientId: string; clientSecret: string };
  return { clientId: cfg.clientId, clientSecret: cfg.clientSecret };
}

let cachedAuth: { token: string; uid: number; expiresAt: number } | null = null;

/** host 侧换 access_token（同时拿 uid——收藏集合快照要用）。 */
function hostAuth(): { token: string; uid: number } {
  if (cachedAuth && Date.now() < cachedAuth.expiresAt) {
    return { token: cachedAuth.token, uid: cachedAuth.uid };
  }
  const refresh = process.env.PIXIV_REFRESH_TOKEN ?? "";
  expect(refresh.length).toBeGreaterThan(0);
  const { clientId, clientSecret } = pixivCredentials();
  const parsed = curlJson<{ access_token?: string; user?: { id?: number } }>(
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
    "POST /auth/token(refresh_token)",
  );
  if (!parsed.access_token || !parsed.user?.id) {
    throw new Error(`host 侧换取 access_token 失败: ${JSON.stringify(parsed).slice(0, 200)}`);
  }
  cachedAuth = {
    token: parsed.access_token,
    uid: parsed.user.id,
    expiresAt: Date.now() + 2_400_000,
  };
  return { token: cachedAuth.token, uid: cachedAuth.uid };
}

/**
 * host 侧 curl（自带 60s 超时；**超时不抛错**，计为一次失败尝试后交给重试）。
 *
 * 为什么不复用 env.ts 的 `runCapture`：它的 timeout 形参被 TS 收窄为字面量 `30000`
 * （`timeoutMs = TIMEOUTS.adb`，`as const` 推断），既无法放宽，又会在 spawnSync 超时时
 * 直接抛错（跳过重试）。本文件只允许新增 spec（不得改 env.ts），故自带一个最小封装。
 */
function curlHost(args: string[], timeoutMs = 60_000): { code: number; stdout: string } {
  const r = spawnSync("curl", args, {
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  return { code: r.status ?? -1, stdout: (r.stdout ?? "").trim() };
}

/**
 * host 侧 curl 包装：**至多 3 次尝试**并要求响应为合法 JSON。
 *
 * 为什么必须重试：经宿主代理直连 Pixiv 偶发空响应（实测一次 `curl -s` 退出码非 0、
 * stdout 为空 → 裸 `JSON.parse` 抛 `SyntaxError: Unexpected end of JSON input`，
 * 表现为「清理用例莫名红」）。这是网络/代理抖动，不是被测行为，故重试；
 * 3 次仍失败就**带原始响应**抛错（不静默降级成默认值）。
 */
function curlJson<T>(args: string[], label: string): T {
  let lastRaw = "";
  let lastCode = -1;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = curlHost(args);
    lastRaw = res.stdout;
    lastCode = res.code;
    if (res.stdout.trim() !== "") {
      try {
        return JSON.parse(res.stdout) as T;
      } catch {
        // 非法 JSON（截断/HTML 错误页）→ 重试
      }
    }
    console.warn(
      `[lynx-bookmark-tags] host 侧 ${label} 第 ${attempt} 次响应异常（curl exit ${res.code}，${res.stdout.length} 字节）→ 重试`,
    );
  }
  throw new Error(
    `host 侧 ${label} 3 次尝试均失败（最后 curl exit ${lastCode}）。最后响应: ${JSON.stringify(lastRaw.slice(0, 300))}`,
  );
}

function pixivGet<T>(path: string): T {
  const { token } = hostAuth();
  return curlJson<T>(
    [
      "-s",
      "-x",
      hostProxy(),
      "-H",
      `Authorization: Bearer ${token}`,
      "-H",
      `User-Agent: ${PIXIV_UA}`,
      "-H",
      "Referer: https://app-api.pixiv.net/",
      `https://app-api.pixiv.net${path}`,
    ],
    `GET ${path}`,
  );
}

/** 服务端真值：插画收藏详情（oracle 独立于被测实现）。 */
function serverBookmarkDetail(id: string): PixivBookmarkDetail | null | undefined {
  return pixivGet<{ bookmark_detail?: PixivBookmarkDetail | null }>(
    `/v2/illust/bookmark/detail?illust_id=${id}`,
  ).bookmark_detail;
}

/**
 * 当前账号某可见性的收藏 id 快照。
 *
 * 分页安全性：单页上限 30，本账号收藏量 < 30（实测 public 14 / private 0），
 * 故单页即**完整**快照——「集合逐项不变」因此是强断言（不是「首屏未变」）。
 * 若未来账号收藏超过 30，本函数会 follow `next_url` 继续翻页直到取完。
 */
function bookmarkSets(restrict: "public" | "private"): number[] {
  const { uid } = hostAuth();
  const ids: number[] = [];
  let path: string | null =
    `/v1/user/bookmarks/illust?user_id=${uid}&restrict=${restrict}&filter=for_ios`;
  for (let page = 0; page < 20 && path; page++) {
    const res: { illusts?: { id: number }[]; next_url?: string | null } = pixivGet(path);
    ids.push(...(res.illusts ?? []).map((i) => i.id));
    const next = res.next_url ?? null;
    path = next ? next.replace("https://app-api.pixiv.net", "") : null;
  }
  return ids;
}

/**
 * 取消收藏（清理路径）。**必须表单体**：ADR-0161 记录该端点读 `--data`（form body），
 * 用 query string 会成功返回但**不生效**（静默无效）。
 */
function hostDeleteBookmark(id: string): string {
  const { token } = hostAuth();
  // 无 `-f`：HTTP 错误也想看到响应体；但同时要求非空响应（空 = 网络抖动，重试）
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = curlHost([
      "-s",
      "-x",
      hostProxy(),
      "-X",
      "POST",
      "https://app-api.pixiv.net/v1/illust/bookmark/delete",
      "-H",
      `Authorization: Bearer ${token}`,
      "-H",
      "Content-Type: application/x-www-form-urlencoded",
      "-H",
      `User-Agent: ${PIXIV_UA}`,
      "-H",
      "Referer: https://app-api.pixiv.net/",
      "--data",
      `illust_id=${id}`,
    ]);
    if (res.stdout.trim() !== "") return res.stdout;
    console.warn(
      `[lynx-bookmark-tags] 取消收藏 ${id} 第 ${attempt} 次响应为空（curl exit ${res.code}）→ 重试`,
    );
  }
  throw new Error(`取消收藏 ${id} 失败：3 次尝试均空响应`);
}

function persistJson(name: string, value: unknown): void {
  writeFileSync(resolve(EVIDENCE_DIR, name), JSON.stringify(value, null, 1));
}

// ─── 登录（webview 契约注入；与 switch-client-oneway / fab 回归同款内联实现）──

async function loginViaWebview(): Promise<void> {
  const driver = ctx!.driver;
  await driver.switchToWebView(60_000);

  // 年龄确认页（/age-confirmation）：点「已满 18 岁」通过；已确认过则直接放行
  await driver.raw.waitUntil(
    async () => {
      const url = await driver.raw.getUrl();
      if (!url.includes("/age-confirmation")) return true;
      await clickByText(ctx!, "已满 18 岁");
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
  await clickByText(ctx!, "登录");
  await driver.raw.waitUntil(async () => !(await driver.raw.getUrl()).includes("/login"), {
    timeout: 90_000,
    timeoutMsg: "登录失败（仍停留在 /login）",
    interval: 2_000,
  });
  console.log("[lynx-bookmark-tags] ✓ webview 登录完成（refresh_token 已落共享 WSSecureStorage）");
}

// ─── 导航：lynx 无深链（见文件头），用设备级点击进详情 ───

/** 推荐页「首屏已出内容」判定：骨架屏近乎纯色，加载后色彩桶数骤增（实测 3 → 94）。 */
function recommendedLoaded(p: Pixels): boolean {
  const buckets = new Set<string>();
  for (let y = 220; y < 1500; y += 16) {
    for (let x = 20; x < p.w - 20; x += 16) {
      const [r, g, b] = pixelAt(p, x, y);
      buckets.add(`${Math.floor(r / 24)},${Math.floor(g / 24)},${Math.floor(b / 24)}`);
    }
  }
  return buckets.size > 25;
}

/** 返回上一页（进错页面时的重置动作）。 */
function pressBack(): void {
  runOrThrow(adbPath(), ["-s", serial, "shell", "input", "keyevent", "4"]);
}

/**
 * 进入插画详情页 **并**解析目标插画 id —— 合二为一且**自验证**。
 *
 * 为什么要自验证（两次真实踩坑）：
 * - 推荐轮播首卡可能是**小说**（推荐流是插画+小说时间交叉合并）→ 详情页结构与操作行不同；
 * - 详情页信息区里可点元素很多（作者行 `openAuthor`、保存行、评论行、标签 chip），
 *   一旦心形定位偏移就会点到它们（实测：误点作者头像 → 直接跳到用户页，
 *   且用户页的缩略图上还能被心形判据误命中）。
 * 故**只看像素不足以确认「这是插画详情页」**，必须用一次**可验证的动作**闭环：
 * 单击定位到的心形 → 服务端收藏集合必须**恰好新增 1 条 public 收藏**（= 当前详情页
 * 插画的身份证明，同时就是 id 发现）→ 同坐标心形必须变红（证明 tap 命中的是心形，
 * 不是旁边的可点行）→ 再点一次还原基线。
 * 任一环不成立即判定「不是插画详情页 / 没点中」→ 返回 + 重试（最多 3 次）。
 */
async function enterDetailAndResolveId(): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    // 推荐页首屏出内容（骨架屏近乎纯色，加载后色彩桶数骤增，实测 3 → 94）
    await waitFor("recommended-loaded", recommendedLoaded, 90_000, 2_000);
    tap(CAROUSEL_CARD_TAP.x, CAROUSEL_CARD_TAP.y);
    await SLEEP(6_000);

    // 滚到详情页底部（信息区 + 操作行）：每滑一次找一次心形，命中即停
    let heart: { x: number; y: number } | null = null;
    for (let i = 0; i < 9 && !heart; i++) {
      heart = findHeartGlyph(await toPixels(screenshot(`detail-scroll-${i}`)));
      if (!heart) {
        swipeUp();
        await SLEEP(1_300);
      }
    }
    if (!heart) {
      console.warn(`[lynx-bookmark-tags] 第 ${attempt} 次尝试：滚到底仍未检出心形 → 返回重试`);
      pressBack();
      await SLEEP(4_000);
      continue;
    }

    // 自验证步骤 1：单击心形 → 服务端恰好新增 1 条 public 收藏
    const pubBefore = bookmarkSets("public");
    const priBefore = bookmarkSets("private");
    tap(heart.x, heart.y);
    await SLEEP(5_000);
    const afterTap = await toPixels(screenshot("act0-post-tap"));
    const pubAfter = bookmarkSets("public");
    const added = pubAfter.filter((id) => !pubBefore.includes(id));
    const removed = pubBefore.filter((id) => !pubAfter.includes(id));
    if (added.length !== 1 || removed.length !== 0) {
      console.warn(
        `[lynx-bookmark-tags] 第 ${attempt} 次尝试：单击心形未产生唯一新收藏（+${added.length}/-${removed.length}）→ 判定不是插画详情页，返回重试`,
      );
      pressBack();
      await SLEEP(4_000);
      continue;
    }
    const candidate = String(added[0]);

    // 自验证步骤 2：同坐标心形必须变红（证明 tap 命中心形本身而非旁边的可点行）
    if (!heartFilled(afterTap, heart)) {
      console.warn(
        `[lynx-bookmark-tags] 第 ${attempt} 次尝试：心形未变红（tap 未命中）→ 回滚收藏并重试`,
      );
      hostDeleteBookmark(candidate);
      pressBack();
      await SLEEP(4_000);
      continue;
    }

    // lynx 快速收藏路径实证（顺带覆盖）：写 public、无标签
    const quick = serverBookmarkDetail(candidate);
    expect(quick?.is_bookmarked).toBe(true);
    expect(quick?.restrict).toBe("public");
    expect(priBefore).toEqual(bookmarkSets("private"));
    illustId = candidate;

    // 还原基线：再点一次取消收藏（用例 ① 要求目标未收藏）
    tap(heart.x, heart.y);
    await SLEEP(5_000);
    screenshot("act0-undo-tap");
    expect(bookmarkSets("public")).toEqual(pubBefore);
    expect(serverBookmarkDetail(illustId)?.is_bookmarked).toBe(false);
    console.log(
      `[lynx-bookmark-tags] ✓ 已进入 lynx 插画详情页并解析目标 id=${illustId}（心形 @(${heart.x},${heart.y})；快速收藏实证 restrict=public，已还原）`,
    );
    return illustId;
  }
  throw new Error(
    "3 次尝试均未能进入 lynx 插画详情页（证据见 detail-scroll-*.png / act0-*.png / wait-recommended-loaded.png）",
  );
}

// ─── 用例 ───

describe.skipIf(SKIPPED)(
  `收藏加标签 · lynx 详情页真机验收（pictelio_ui）${SKIPPED ? `（SKIP：${SKIP_REASON}）` : ""}`,
  () => {
    beforeAll(async () => {
      ctx = await setupAndroidE2e(TARGET_AVD);
      serial = ctx.serial;
      assertDeviceGeometry();

      // 阶段 A：webview 登录（pm clear 后 Keystore 里没有 token，只能真实登录）
      writeClientKind(serial, "webview");
      forceStopApp(serial);
      startMainActivity(serial);
      await waitForTopActivity(MAIN_ACTIVITY);
      await loginViaWebview();

      // 阶段 B：契约层切 lynx（跨引擎登录态共享 → 种子恢复）
      expect(writeClientKind(serial, "lynx")).toBe("lynx");
      forceStopApp(serial);
      runOrThrow(adbPath(), ["-s", serial, "logcat", "-c"]);
      startMainActivity(serial);
      await waitForTopActivity(LYNX_ACTIVITY);
      await waitForLynxRenderReady();

      // 阶段 C：进插画详情页 **并**解析目标插画 id（自验证，失败最多重试 3 次）
      expect(await enterDetailAndResolveId()).toBe(illustId);
      dumpLogcat("00-detail-entered");
    }, 900_000);

    afterAll(async () => {
      // 兜底清理：用例中途红掉时也把账号状态还原（best-effort，失败不掩盖用例本身的红）
      try {
        if (illustId && serverBookmarkDetail(illustId)?.is_bookmarked === true) {
          console.log(
            `[lynx-bookmark-tags] 兜底清理：取消收藏 ${illustId}（响应 ${hostDeleteBookmark(illustId).slice(0, 60)}）`,
          );
        }
      } catch (e) {
        console.warn(`[lynx-bookmark-tags] 兜底清理失败（不影响用例结果）: ${String(e)}`);
      }
      await ctx?.teardown().catch(() => {});
      try {
        if (!serial) return;
        forceStopApp(serial);
        writeClientKind(serial, "webview"); // 恢复默认，避免污染后续用例
      } catch {
        // 收尾失败不阻断
      }
    });

    it("① 长按心形 500ms → 收藏面板出现，且未写入收藏（AC 必验项）", async () => {
      const pubBefore = bookmarkSets("public");
      const priBefore = bookmarkSets("private");
      const heart = findHeartGlyph(await toPixels(await screenshot("act1-before-longpress")));
      expect(heart, "长按前未检出心形").not.toBeNull();

      await longPress(heart!.x, heart!.y, 700);
      await SLEEP(3_000);
      const after = screenshot("act1-after-longpress");
      expect(panelOpen(await toPixels(after)), "长按后收藏面板未出现（保存按钮色带缺失）").toBe(
        true,
      );
      dumpLogcat("01-longpress");

      // oracle：长按只开面板，不写收藏（旧「私密直存」语义已消失）
      const detail = serverBookmarkDetail(illustId);
      expect(detail?.is_bookmarked).toBe(false);
      expect(bookmarkSets("public")).toEqual(pubBefore);
      expect(bookmarkSets("private")).toEqual(priBefore);
      persistJson("01-bookmark-detail.json", detail);
      console.log(
        `[lynx-bookmark-tags] ✓ 面板出现且未写收藏：is_bookmarked=false，收藏集合逐项不变`,
      );
    }, 120_000);

    it("② 面板内 tap「私密」→ tap「保存」→ 服务端 is_bookmarked=true 且 restrict=private", async () => {
      // 前置：上一步已打开面板（v-if 渲染树仍在）
      const before = await toPixels(screenshot("act2a-before-private"));
      expect(panelOpen(before), "面板未打开（上一步失败？）").toBe(true);
      // 可见性 chip 行定位自检：初始应为「公开」选中 → 公开饱和、「私密」不饱和
      expect(
        saturatedRatio(before, PUBLIC_CHIP_BOX),
        "初始「公开」chip 未呈选中态",
      ).toBeGreaterThan(0.5);
      expect(
        saturatedRatio(before, PRIVATE_CHIP_BOX),
        "初始「私密」chip 已是选中态？（前置异常）",
      ).toBeLessThan(0.15);

      tap(PRIVATE_CHIP_X, CHIP_ROW_Y);
      await SLEEP(2_000);
      const afterPrivate = await toPixels(screenshot("act2b-private-selected"));
      expect(
        saturatedRatio(afterPrivate, PRIVATE_CHIP_BOX),
        "tap 后「私密」chip 未进入选中态",
      ).toBeGreaterThan(0.5);
      expect(
        saturatedRatio(afterPrivate, PUBLIC_CHIP_BOX),
        "tap 后「公开」chip 未退出选中态",
      ).toBeLessThan(0.15);

      // 加标签路径（本票主题）：选中「作品标签建议」末行最左 chip（best-effort，显式告警）
      const saveBtn0 = findSaveButton(afterPrivate);
      expect(saveBtn0, "未定位到面板保存按钮").not.toBeNull();
      // 前置：目标未收藏且未带标签 → 面板体内不应有任何选中态 chip（已选标签 0/10）
      expect(
        countSelectedPills(afterPrivate, saveBtn0!.y - 70),
        "加标签前置不成立：面板内已有选中态标签 chip",
      ).toBe(0);
      const tagChip = findSuggestionsChip(afterPrivate, saveBtn0!.y - 70);
      let tagTapped = false;
      if (tagChip) {
        tap(tagChip.x, tagChip.y);
        await SLEEP(2_500);
        tagTapped = true;
        const afterTag = await toPixels(screenshot("act2c-tag-selected"));
        const saveBtnTag = findSaveButton(afterTag) ?? saveBtn0!;
        // 断言与布局无关：选中一个作品标签 = 「已选标签」区新增 1 个 chip +
        // 该建议 chip 本身转为选中态 → 面板体内选中态 chip 数恰好 +2（实测校准）
        expect(
          countSelectedPills(afterTag, saveBtnTag.y - 70),
          "tap 作品标签 chip 后面板内选中态 chip 数未按预期 +2",
        ).toBe(2);
        console.log(`[lynx-bookmark-tags] 已选中作品标签建议 chip @(${tagChip.x},${tagChip.y})`);
      } else {
        console.warn(
          "[lynx-bookmark-tags] 未定位到作品标签建议 chip（作品无标签/已全选）——跳过加标签子步骤，仅验可见性",
        );
      }

      // 保存（按钮 bbox 现算，避免依赖固定坐标）
      const beforeSave = await toPixels(screenshot("act2d-before-save"));
      const saveBtn = findSaveButton(beforeSave);
      expect(saveBtn, "未定位到面板保存按钮").not.toBeNull();
      const pubBefore = bookmarkSets("public");
      tap(saveBtn!.x, saveBtn!.y);
      await waitFor("panel-closed-after-save", (p) => !panelOpen(p), 40_000, 2_000);
      screenshot("act2e-after-save");
      dumpLogcat("02-save");

      // oracle：服务端真值
      const detail = serverBookmarkDetail(illustId);
      expect(detail?.is_bookmarked).toBe(true);
      expect(detail?.restrict).toBe("private");
      expect(bookmarkSets("private")).toEqual([Number(illustId)]);
      expect(bookmarkSets("public")).toEqual(pubBefore);
      persistJson("02-bookmark-detail.json", detail);

      if (tagTapped) {
        const registered = (detail?.tags ?? []).filter((t) => t.is_registered).map((t) => t.name);
        const illust = pixivGet<{ illust: PixivIllustLite }>(
          `/v1/illust/detail?illust_id=${illustId}`,
        ).illust;
        const workTags = (illust.tags ?? []).map((t) => t.name);
        expect(registered.length, "已 tap 标签 chip 但服务端未登记任何标签").toBeGreaterThan(0);
        // 断言方向：登记标签 ⊆ 作品自带标签（面板建议只来自作品标签，spec D5）
        expect(workTags).toEqual(expect.arrayContaining(registered));
        console.log(`[lynx-bookmark-tags] ✓ 标签已登记：is_registered=[${registered.join(", ")}]`);
      }
      console.log(
        `[lynx-bookmark-tags] ✓ 私密保存生效：is_bookmarked=true, restrict=${detail?.restrict}`,
      );
    }, 180_000);

    it("③ 清理：host 侧表单体取消收藏 → 复核未收藏且集合回到基线", async () => {
      // 前置断言（防「空转绿」）：本步必须真的清理掉用例 ② 写入的**私密**收藏。
      // 若 ② 未真正落库，这里先红，而不是让 delete 后的 false 断言无条件成立。
      const before = serverBookmarkDetail(illustId);
      expect(
        before?.is_bookmarked,
        `清理前置不成立：插画 ${illustId} 在清理前应处于已收藏态（用例 ② 未落库？）`,
      ).toBe(true);
      expect(before?.restrict).toBe("private");
      expect(bookmarkSets("private")).toEqual([Number(illustId)]);

      const baselinePub = bookmarkSets("public");
      const res = hostDeleteBookmark(illustId);
      writeFileSync(
        resolve(EVIDENCE_DIR, "03-delete-response.txt"),
        `POST /v1/illust/bookmark/delete\n--data illust_id=${illustId}\nresponse: ${res}\n`,
      );
      await SLEEP(2_000);
      const detail = serverBookmarkDetail(illustId);
      expect(detail?.is_bookmarked).toBe(false);
      expect(bookmarkSets("private")).toEqual([]);
      expect(bookmarkSets("public")).toEqual(baselinePub);
      persistJson("03-bookmark-detail.json", detail);
      console.log(
        `[lynx-bookmark-tags] ✓ 账号状态已还原：插画 ${illustId} is_bookmarked=false，private 集合为空`,
      );
    }, 90_000);
  },
);

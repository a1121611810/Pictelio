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
 * - 设备全局代理（`ANDROID_E2E_HTTP_PROXY=10.0.2.2:7897`）：模拟器 DNS 被污染，
 *   不设代理则推荐流与图片都拉不到（实测）。
 * - 登录：`setupAndroidE2e` 的 `pm clear` 会清掉 Keystore 里的 refresh_token，
 *   故走 LynxActivity 的 **dev intent hook**（`prefs.loginViaDevIntent`）真实登录：
 *   `am start -n io.pictelio.app/.LynxActivity --es pictelio_dev_refresh_token <token>`
 *   → `LynxActivity.applyDevIntentHooks()` 调 `autoLoginWithRefreshToken` 持久化并登录
 *   （门禁 BuildConfig.DEBUG，只有 debug 包有该钩子）。单引擎化后 webview 登录页已不存在
 *   （APK 内无 WebView），跨引擎共享 WSSecureStorage 种子恢复那条路随之失效。
 *   `pictelio_client_kind` 无需播种：单引擎下入口恒为 LynxActivity，写什么都归一为 lynx。
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
import { adbPath, LYNX_ACTIVITY, REPO_ROOT, runCapture, runOrThrow } from "../env";
import {
  currentTopActivity,
  forceStopApp,
  loginViaDevIntent,
  readAppLogcat,
  startMainActivity,
} from "../prefs";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 证据落盘目录（被 gitignore，仅本地取证用） */
const EVIDENCE_DIR = resolve(REPO_ROOT, "packages/app/test-results/android-e2e/lynx-bookmark-tags");
mkdirSync(EVIDENCE_DIR, { recursive: true });

// ── AVD pin（仿 fab 回归 / switch-client-roundtrip-low）：坐标常量绑定 pictelio_ui ──
const TARGET_AVD = process.env.ANDROID_E2E_AVD || "pictelio_ui";
// ⚠️ #817 移除了 `|| E2E_FLAVOR === "webview"` 守卫：该分支在本分支恒不可达
// （build.gradle 已无 productFlavors），静默 skip 会把「ANDROID_E2E_FLAVOR 配错」
// 伪装成「该设备上不可跑」。flavor 口径现在由 env.ts 收口显式抛错。
const SKIPPED = TARGET_AVD !== "pictelio_ui";
const SKIP_REASON = `本用例坐标常量绑定 pictelio_ui（1080×2160/density 480），当前 ANDROID_E2E_AVD=${TARGET_AVD}`;
if (SKIPPED) {
  console.log(`[lynx-bookmark-tags] SKIP: ${SKIP_REASON}`);
}

// ── 坐标常量（推导见文件头注释；均为「屏幕物理像素」）──
/** 推荐页轮播首卡的点击点（图片区内，避开底部 scrim 信息区与右侧 FAB） */
const CAROUSEL_CARD_TAP = { x: 540, y: 900 };
// ── 可见性 chip 行（#817 订正）────────────────────────────────────────
// oracle = 2026-09-29 实测帧 test-results/android-e2e/lynx-bookmark-tags/
//          act2a-before-private.png（面板已打开、初始「公开」选中），按精确色值扫包围盒：
//   选中「公开」chip rgb(207,229,255) bbox x46..205  y893..1007 ⇒ 中心 (126, 950)；
//   未选「私密」chip rgb(230,232,238) bbox x210..388 y893..1007 ⇒ 中心 (299, 950)。
// 原常量 CHIP_ROW_Y=777 / PUBLIC_CHIP_BOX.y=730..825 / PRIVATE_CHIP_X=309 是**旧面板布局**
// 的取值：面板加高后整行下移约 173px。旧 y=777 处实测 rgb(255,255,255) = 面板纯白背景，
// 既无 chip 也无文字 ⇒ `saturatedRatio` 恒 0 ⇒ 用例 ② 前置自检恒红。
// 与 FAB / Me 页行两处同源：都是「按旧布局推导的坐标」。
/** 详情页滑动预算（#817 由 9 提到 14：单页插画图高差异大，9 次是最坏情况下的贴边值）。 */
const DETAIL_SCROLL_BUDGET = 14;
const CHIP_ROW_Y = 950;
/** 「私密」chip 中心 x（实测 bbox 210..388） */
const PRIVATE_CHIP_X = 299;
/** 「公开」chip 采样框（用于断言其变回未选中态；内缩于实测 bbox x46..205 / y893..1007
 *  以避开抗锯齿边缘与面板圆角） */
const PUBLIC_CHIP_BOX = { x0: 60, x1: 195, y0: 905, y1: 995 };
/** 「私密」chip 采样框（断言其进入选中态） */
/** 「私密」chip 采样框（实测 bbox x210..388 / y893..1007，同样内缩） */
const PRIVATE_CHIP_BOX = { x0: 225, x1: 375, y0: 905, y1: 995 };
/** 保存按钮所在色带（bbox 由像素现算，这里只给扫描窗口） */
/** 「收藏」保存按钮的色带扫描窗（#817 订正）。
 *  oracle = act2a-before-private.png 按按钮色 rgb(26,111,168) 扫出 bbox
  x46..1033 / **y1973..2101**（988×129，横跨近全宽）。原窗 y1870..2050 只有
  下半截压在按钮上、且 2016 以上的部分落在手势条 inset 里——判据虽仍能过但贴边。
  现取 y1975..2015：完全在按钮内，且完全在内容区底界（2016）之上。 */
const SAVE_BAND_WINDOW = { y0: 1975, y1: 2015 };

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
/**
 * 心形定位（像素特征，不写死坐标）。
 *
 * ⚠️ #817 **极性判据订正**（oracle = 2026-09-29 实跑证据帧
 * `test-results/android-e2e/lynx-bookmark-tags/detail-scroll-8.png`，逐像素实测）：
 * 本函数原先在扫「**暗色或红色**心形」，而 lynx 详情页实际把心形渲染成
 * **深色胶囊底 + 白色心形笔画**。极性反了 ⇒ 分量尺寸落在胶囊（170×103）
 * 或其它暗块上，`w ∈ [34,60] / h ∈ [38,64]` 永远不命中 ⇒ `findHeartGlyph`
 * 恒返回 null ⇒ 9 次滑动全部落空 ⇒ 报「未能进入插画详情页」。
 * **报错文案把人说向「进不去详情页」，实际页面上「作品详情」标题、心形、
 * 收藏数 97 全都在**（又一次「报错文案指向错误根因」）。
 *
 * 现改为两段式：
 *   ① 找出**深色胶囊**（暗色连通块）——心形与收藏数共处的容器；
 *   ② 在每个胶囊**内部**找「严格内嵌的亮色连通域」= 白色心形笔画。
 *
 * **尺寸窗口原样保留**（w ∈ [34,60]、h ∈ [38,64]、h/w ∈ [1.0,1.4]、实心 ≥ 300）——
 * 实测心形笔画恰为 **43×49、中心 (100,1698)**，落在窗口正中。窗口没错，
 * 错的只是「按什么颜色去找」。这同时说明尺寸判据本身仍有效。
 *
 * 「严格内嵌」是必须的排除条件：胶囊四角在深色 bbox 里会露出 4 块白色背景
 * （实测各 521~565 px，形状与心形不冲突但尺寸接近），心形笔画 bbox 完全落在
 * 胶囊 bbox 内部，四角块则贴边甚至越界。
 *
 * 扫描窗 x ∈ [40, 130) 保留：心形中心 x=100 在窗内，而右侧「↓ 保存」「标签近邻」
 * 等可点行在 x≈170 之外，天然排除（早期版本因窗口过窄把头像裁成 79×109
 * 误判为心形，tap 落到可点的作者行跳到用户页——该教训继续有效）。
 */
function findHeartGlyph(p: Pixels): { x: number; y: number } | null {
  // ── ① 深色连通块（胶囊容器）──
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
  const capsules = connectedBoxes(dark, 8);
  // 容器下限：心形所在胶囊实测 170×103（x<130 窗内被裁成 ≥84×103）。取足够大的下界，
  // 既容纳胶囊，又能与「标题文字」「作者头像」等小块区分开。
  const capsulesBig = capsules.filter((b) => b.y1 - b.y0 + 1 >= 70 && b.x1 - b.x0 + 1 >= 50);

  // ── ② 胶囊内部「严格内嵌的亮色连通域」= 白色心形笔画 ──
  let best: { n: number; cx: number; cy: number } | null = null;
  for (const cap of capsulesBig) {
    const bright: [number, number][] = [];
    for (let y = cap.y0; y <= cap.y1; y += 1) {
      for (let x = cap.x0; x <= cap.x1; x += 1) {
        const [r, g, b] = pixelAt(p, x, y);
        // 近白且近灰（排除彩色插画像素）
        if (Math.min(r, g, b) > 190 && Math.max(r, g, b) - Math.min(r, g, b) < 40) {
          bright.push([x, y]);
        }
      }
    }
    for (const blob of connectedBoxes(bright, 6)) {
      // 严格内嵌：至少留 3px 边距 ⇒ 排除胶囊四角露出的白色背景（它们贴边）
      if (
        blob.x0 <= cap.x0 + 3 ||
        blob.y0 <= cap.y0 + 3 ||
        blob.x1 >= cap.x1 - 3 ||
        blob.y1 >= cap.y1 - 3
      ) {
        continue;
      }
      const w = blob.x1 - blob.x0 + 1;
      const h = blob.y1 - blob.y0 + 1;
      const ratio = h / w;
      if (
        w >= 34 &&
        w <= 60 &&
        h >= 38 &&
        h <= 64 &&
        ratio >= 1.0 &&
        ratio <= 1.4 &&
        blob.n >= 300
      ) {
        if (!best || blob.n > best.n) {
          best = {
            n: blob.n,
            cx: Math.round((blob.x0 + blob.x1) / 2),
            cy: Math.round((blob.y0 + blob.y1) / 2),
          };
        }
      }
    }
  }
  return best ? { x: best.cx, y: best.cy } : null;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  n: number;
}

/**
 * 8 连通域 + 按 `cell` 像素分桶，返回每个分量的包围盒与实心像素数。
 * 纯函数，供心形定位复用（原先内联在 findHeartGlyph 里，两段式判据需要用两次）。
 */
function connectedBoxes(pts: [number, number][], cell: number): Box[] {
  const cells = new Map<string, [number, number][]>();
  for (const [x, y] of pts) {
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push([x, y]);
    else cells.set(key, [[x, y]]);
  }
  const seen = new Set<string>();
  const out: Box[] = [];
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
    out.push({
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
      n: comp.length,
    });
  }
  return out;
}

/**
 * 心形胶囊是否处于「已收藏」态。
 *
 * ⚠️ #817 **判据订正**：原判据找 `text-error` 红（r>150 且 g<110 且 b<110），阈值 0.5。
 * 它在本 UI 上**永远为假**——不是「偶尔漏检」，而是结构性失效：
 *   oracle（2026-09-29 两帧同坐标窗口 (100,1698) ±22/±19、步长 4 = 120 采样点实测）：
 *     未收藏 detail-scroll-8.png：胶囊底 **rgb(46,49,54)**，心形笔画 rgb(239,241,247)
 *                                → 旧判红命中 **0** / 120
 *     已收藏 act0-post-tap.png：胶囊底 **rgb(59,100,112)**（青），心形仍为白
 *                                → 旧判红命中 **0** / 120
 *   两态都是 0 ⇒ `heartFilled` 恒 false ⇒ `enterDetailAndResolveId` 的第 3 次重试
 *   分支必然命中 ⇒ 该 spec **结构性不可通过**（前 2 次尝试也是这么耗尽的）。
 *
 * 现按「胶囊底色的青度」判定（主题色随 M3 配色变，红不是稳定信号）：
 *   判青 = (g - r) ≥ 25 且 (b - r) ≥ 25 且 g < 200（后两条排除白色心形笔画本身：
 *   rgb(239,241,247) 的 g-r=2 / b-r=8，天然不满足，无需单列）。
 * 同帧实测：已收藏 **37/120 = 0.308**；未收藏 **0/120**；同坐标空白区域对照 **0/120**。
 * 阈值取 **0.15**：距实测信号 2 倍余量，距阴性 0 有 15% 硬间隔。
 */
const HEART_FILLED_RATIO = 0.15;
function heartFilled(p: Pixels, spot: { x: number; y: number }): boolean {
  let teal = 0;
  let n = 0;
  for (let y = spot.y - 22; y <= spot.y + 22; y += 4) {
    for (let x = spot.x - 19; x <= spot.x + 19; x += 4) {
      n++;
      const [r, g, b] = pixelAt(p, x, y);
      if (g - r >= 25 && b - r >= 25 && g < 200) teal++;
    }
  }
  return n > 0 && teal / n >= HEART_FILLED_RATIO;
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
 * #817：原为**私有副本**（与 transition-matrix 逐字同款）。副本把 logcat 采集
 * 口径分裂成 4 处中的 2 处，且 pid 为空时返回 `"(进程不存在)"` 占位串——会被
 * `waitForLynxRenderReady` 的正则当日志内容反复匹配，也**不** warn。
 * 现统一走 `prefs.readAppLogcat({ lines })`：16MB maxBuffer（Lynx
 * `ElementManager::OnPatchFinishForFiber` 是 ~60fps 逐帧日志，1MB 缺省会抛
 * ENOBUFS，实测把用例 ② 打成红）与 `-t` 限尾均已收进该函数。
 */
function logcatTailByPid(lines = 2000): string {
  return readAppLogcat(serial, { lines });
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
  return process.env.HTTPS_PROXY ?? process.env.https_proxy ?? "http://127.0.0.1:7897";
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

/**
 * 当前详情页是否是**多页作品**（漫画/多图）——#817。
 *
 * 推荐流每天轮换，同一个 spec 有时抽到单页插画、有时抽到 26 页漫画。多页作品的
 * 详情页顶部是**分页器**而非信息区，滑动被翻页吃掉，无论滑多少次都到不了
 * 底部的心形胶囊 ⇒ 固定滑动预算必然耗尽。实测同一轮里：
 *   26 页漫画 detail-scroll-8.png：右上分页药丸 **9453** 个灰像素（主色 rgb(128,128,128)）
 *   单页插画 act2a-before-private.png：同窗 **0** 个
 * 判据取灰像素数 ≥ 2000（阴性 0、阳性 9453，间隔极大）。
 */
function multiPageWork(p: Pixels): boolean {
  let gray = 0;
  for (let y = 820; y < 980; y += 2) {
    for (let x = 820; x < 1060; x += 2) {
      const [r, g, b] = pixelAt(p, x, y);
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx - mn < 18 && mx > 70 && mx < 190) gray++;
    }
  }
  return gray >= 2000;
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
  /** 轮播横向滑动换下一张卡（与 transition-matrix 的 SWIPE_CAROUSEL_NEXT 同款手势）。
   *  #817：原重试逻辑 pressBack 后仍点同一张卡——推荐轮播不自转，三次尝试撞的是
   *  **同一张**作品，抽到多页漫画就必然三次全灭。 */
  const swipeCarouselNext = (): void => {
    runOrThrow(adbPath(), ["-s", serial, "shell", "input", "swipe", "900", "700", "180", "700"]);
  };

  /** 每次尝试的实际卡点（#817）：三个失败分支的报错文案原先被混成一句，
   *  会把「心形没检出 / 收藏集合不符 / 心形未变色」都说成「进不去详情页」，
   *  而后两种的失败现场页面上心形与收藏数明明都在。 */
  const attempts: string[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    // 推荐页首屏出内容（骨架屏近乎纯色，加载后色彩桶数骤增，实测 3 → 94）
    await waitFor("recommended-loaded", recommendedLoaded, 90_000, 2_000);
    if (attempt > 1) {
      swipeCarouselNext();
      await SLEEP(2_500);
    }
    tap(CAROUSEL_CARD_TAP.x, CAROUSEL_CARD_TAP.y);
    await SLEEP(6_000);

    // 滚到详情页底部（信息区 + 操作行）：每滑一次找一次心形，命中即停
    // 多页作品：滑动被翻页吃掉，滑到天亮也到不了底部信息区 ⇒ 立刻换卡重试，
    // 不浪费滑动预算（#817）
    const firstFrame = await toPixels(screenshot("detail-scroll-0"));
    if (multiPageWork(firstFrame)) {
      attempts.push(`第 ${attempt} 次：抽到多页作品（详情页顶部为分页器），换下一张卡重试`);
      console.warn(
        `[lynx-bookmark-tags] 第 ${attempt} 次：抽到多页作品（右上分页器），返回并换下一张卡`,
      );
      pressBack();
      await SLEEP(4_000);
      continue;
    }

    let heart: { x: number; y: number } | null = null;
    for (let i = 0; i < DETAIL_SCROLL_BUDGET && !heart; i++) {
      heart = findHeartGlyph(await toPixels(screenshot(`detail-scroll-${i}`)));
      if (!heart) {
        swipeUp();
        await SLEEP(1_300);
      }
    }
    if (!heart) {
      attempts.push(
        `第 ${attempt} 次：${DETAIL_SCROLL_BUDGET} 次滑动后仍未检出心形（findHeartGlyph 恒 null）`,
      );
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
      attempts.push(
        `第 ${attempt} 次：单击心形后服务端收藏集合 +${added.length}/-${removed.length}（期望 +1/-0）`,
      );
      console.warn(
        `[lynx-bookmark-tags] 第 ${attempt} 次尝试：单击心形未产生唯一新收藏（+${added.length}/-${removed.length}）→ 判定不是插画详情页，回滚本次新增后重试`,
      );
      // 本次点击仍可能已写入收藏（只是数量不唯一）——逐条回滚，避免在真实账号留痕
      for (const id of added) {
        hostDeleteBookmark(String(id));
      }
      pressBack();
      await SLEEP(4_000);
      continue;
    }
    const candidate = String(added[0]);

    // 自验证步骤 2：同坐标心形必须变红（证明 tap 命中心形本身而非旁边的可点行）
    if (!heartFilled(afterTap, heart)) {
      attempts.push(`第 ${attempt} 次：心形胶囊未变已收藏色（heartFilled 判据未命中）`);
      console.warn(
        `[lynx-bookmark-tags] 第 ${attempt} 次尝试：心形未变已收藏色（heartFilled 未命中）→ 回滚收藏并重试`,
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
  // #817：原先三个失败分支（无心形 / 收藏集合不符 / 心形未变色）共用一句
  // 「未能进入插画详情页」，而实际三种里**只有第一种**与「进不去页面」有关。
  // 另两种的失败现场页面上明明就摆着心形与收藏数——文案会把人引向改产品。
  // 现逐条列出实际卡点 + 各自证据文件。
  throw new Error(
    `3 次尝试均未走完「插画详情页自验证」闭环。各次卡点：\n` +
      attempts.map((a) => `  - ${a}`).join("\n") +
      `\n证据：detail-scroll-*.png（进详情页后的滚动帧）、act0-post-tap.png（点心形后的帧）、` +
      `wait-recommended-loaded.png（推荐流入口帧）、act0-undo-tap.png（出现即说明闭环已走到还原步）`,
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

      // 阶段 A：dev intent hook 登录（pm clear 后 Keystore 里没有 token，只能真实登录）
      await loginViaDevIntent(serial);

      // 阶段 B：干净重启进已登录主界面
      // client_kind 无需播种：单引擎下入口恒为 LynxActivity，写什么都归一为 lynx
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
        // 单引擎布局下无「默认引擎」可恢复（写入的 client_kind 一律归一为 lynx），
        // force-stop 即完成收尾，不播种 prefs 避免污染后续用例
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

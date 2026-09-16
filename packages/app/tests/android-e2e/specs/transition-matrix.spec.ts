// @vitest-environment node
/**
 * @release-gate 发版前手动门：T2 转换矩阵首版（issue #548，spec docs/specs/qa-defense-lines.md §3.T2）。
 *
 * **不进每-PR CI（#539 裁决）；发版前必跑 + 大 PR 手动触发。**
 * 运行前置 = Appium（pnpm appium:setup）+ AVD(pictelio_ui) + 代理（ANDROID_E2E_HTTP_PROXY=10.0.2.2:7897，
 * 等价 `adb shell settings put global http_proxy 10.0.2.2:7897`，setup.ts 统一下发/teardown 清除）
 * + 登录态（PIXIV_REFRESH_TOKEN，既有 spec 的种入方式：webview 侧 token 注入登录 → WSSecureStorage
 * 跨引擎种子恢复，ADR-0050/#126）+ **`BENCH_NAV=1 pnpm build:android`**（benchNav 深链钩子整链注入，
 * 单独注入 build:app-lynx 会被覆盖——#542 实测坑；beforeAll 用 bundle grep 快速失败）。
 *
 * **待发版门首跑**：本文件随 #548 首版落地时未实机运行（Appium 栈不可用），
 * 验收依据 spec §4 T2「不可运行时在文件头注明待发版门首跑」。首跑注意事项：
 * 坐标常量为 vw 几何模型静态推导（未实机逐点校准，口径与 fab-hit-testing-regression 相同——
 * 该模型已在 fab spec 实弹验证 FAB_TAP/ME_RING_TAP 两点命中）；首跑如几何断言失败，
 * 优先怀疑状态栏 inset / vh 基准（本文件坐标对 vh 基准 2016/2088 两种取值均取交集规避），
 * 用截图证据（test-results/android-e2e/transition-matrix/）实测后微调。
 * 另两条数据/证据口径（review P2-2/P2-3）：
 * - R3 收藏行两两不同依赖真实数据恰异——偶发同值不算回归，换一批数据复测；
 * - R1③ 帧差异为「段已注入」的必要非充分证据：红 = 确定回归；绿存疑时对照
 *   r1-*.png 截图人工确认段是否真的渲染。
 *
 * ── 矩阵 4 行（spec §3.T2，每行 = 一个已收口缺陷的回归）─────────────────────
 * R1 lynx `/illusts`（benchNav 深链）→ 点中部卡片进详情 → 系统返回：
 *    断言 ①返回后页面不是列表顶部（与深链后首帧对比，内容不同）；
 *         ②滚动位置保持（锚点卡上方区域与进详情前逐像素一致）；
 *         ③锚点卡下方注入「相关作品」段（relatedRowFor 渲染物——ADR-0162 渲染缝），
 *           帧证据 = 锚点下方区域内容变化（段插入把后续卡片整体下移）。
 * R2 lynx SearchSheet（FAB 放射环搜索项打开）→ 搜多结果词 original → 滚到底触发翻页：
 *    断言 ①首次触底后继续滚动，列表底部内容推进（翻页后行数增加的帧证据——
 *           翻页失败则列表钉死在原底部，帧不再变化）；
 *         ②列表底部无「加载更多失败」横幅（text-error 红色文字像素扫描）；
 *         ③切「小说」scope → 结果区内容整体替换（ADR-0107 D4「选了小说还能看到插画」
 *           旧行残留回归的帧证据：换 scope 后列表帧与换前首帧必须不同）。
 * R3 lynx 推荐轮播（`/recommended` benchNav 深链）→ 滑动换卡 ≥2 次：
 *    断言每次换卡后 ①图片区内容变化（index 前进）；
 *                    ②底部 scrim 收藏行区域（♥ + 收藏数文本所在窗口）帧两两不同
 *                      （spec「收藏数两两不同（对比帧文本）」——C 类 props 冻结缺陷
 *                      「收藏数恒 135」的帧证据：冻结时该窗口跨卡恒等）。
 * R4 webview 搜索（同 R2 序列，基线对照；客户端切换用既有 roundtrip 的契约层惯例）：
 *    DOM 可直读，断言全部为数值/文本内容对比：结果行数增加（data-testid 计数）、
 *    无「加载更多失败」role=status 文本、切「小说」scope 后插画行数 = 0 且小说行数 > 0。
 *
 * ── 为什么 lynx 侧断言是「帧对比」而不是文本直读（口径声明，spec §0 允许）─────
 * Lynx 4.0.1 原生 LynxView 的 accessibility 树不暴露 view/text（TalkBack 绑定仍空树），
 * uiautomator dump 在 pictelio_ui 上必被 SIGKILL（exit 137）——「无 UI 自动化通道，
 * 全部定位走截图 + 像素分析」是仓库既有实测结论（lynx-bookmark-tags / fab spec 文件头）。
 * spec §0 对内容断言的定义包含「段存在性/数值对比」，§3.T2 对 R1/R3 明书「对比返回前后
 * 截图」「对比帧文本」——故 lynx 侧以**区域化帧对比**（差异必须落在语义区域：锚点下方/
 * 收藏行窗口/列表底部）承载内容断言，禁止整帧无差别 diff（那是 #374 存在性口径的换皮）；
 * webview 侧（R4）则按修订口径用数值/文本直读。R4 与 R2 同序列构成双引擎基线对照。
 *
 * ── 驱动方式（全部沿用既有 spec 已验证的交互，无新发明）────────────────────
 * - 深链：`am start -n <pkg>/<MainActivity> --es benchNav <scenario>`（MainActivity 转发
 *   extras → LynxActivity onLoadSuccess 四次广播 → JS navigate，ADR-0136/#542 先例）；
 * - 点击/滑动：adb `input tap|swipe|motionevent|keyevent`（fab / lynx-bookmark-tags 先例）；
 * - 登录：webview token 注入（roundtrip / fab / probe 同款内联实现，helpers 未提取故本文件照抄）；
 * - 客户端切换：writeClientKind 契约层 + 重启（roundtrip 先例）；
 * - 断言证据：截图逐帧落盘 test-results/android-e2e/transition-matrix/。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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
const EVIDENCE_DIR = resolve(REPO_ROOT, "packages/app/test-results/android-e2e/transition-matrix");
mkdirSync(EVIDENCE_DIR, { recursive: true });

// ── AVD pin（仿 lynx-bookmark-tags / fab 回归）：坐标常量绑定 pictelio_ui ──
const TARGET_AVD = process.env.ANDROID_E2E_AVD || "pictelio_ui";
const SKIPPED = TARGET_AVD !== "pictelio_ui" || E2E_FLAVOR === "webview";
const SKIP_REASON =
  TARGET_AVD !== "pictelio_ui"
    ? `坐标常量绑定 pictelio_ui（1080×2160/density 480），当前 ANDROID_E2E_AVD=${TARGET_AVD}`
    : `本用例需要 full 包（Lynx 引擎 + benchNav 深链）；当前 ANDROID_E2E_FLAVOR=webview，已整文件跳过`;
if (SKIPPED) {
  console.log(`[transition-matrix] SKIP: ${SKIP_REASON}`);
}

// ── 坐标常量（pictelio_ui：物理 1080×2160，density 480，1vw = 10.8px）──────────
// 推导模型 = fab-hit-testing-regression 同款 vw 几何（其 FAB_TAP=(953,2033)/ME_RING_TAP=
// (576,2020) 已实弹验证，反推锚点 (0,0) = 屏幕物理原点、H = 200vw，非「LynxView 顶 = 72」口径）：
// - 放射 FAB（menu 模式，/illusts 为 4 顶层 tab 之一）：fabCx = 100-4.267-14.933/2 = 88.2665vw，
//   fabCy = 200-4.267-14.933/2 = 188.2665vw → (953, 2033)（与 fab spec 实测常量逐位一致）；
// - 内环搜索项（内环 = [搜索, 刷新, 回顶] 3 项，spread(-14°,-80°)，R_INNER = 20vw，搜索固定首位）：
//   极角 -14°：x = 88.2665 + sin(14°)×(-20) = 83.43vw → 901；y = 188.2665 - cos(14°)×20 = 168.86vw → 1824；
// - SearchSheet 底部面板 = 80vh：vh 基准存在 2088（= 2160-72）/2016（再减手势条 72）两种实测口径，
//   面板顶分别为 490/547 —— 下列输入框/scope chip 坐标取两种口径的交集规避（见各项注释）；
// - 轮播滑动起点取封面图区（scrim 遮罩 pointer-events 不生效、不响应滑动——Recommended.vue 真机修复注记）。
/** 放射 FAB 主按钮（menu 模式，fab spec 已实弹验证的同款常量） */
const FAB_TAP = { x: 953, y: 2033 };
/** 内环「搜索」项（内环第 1 项，极角 -14°） */
const FAB_SEARCH_ITEM_TAP = { x: 901, y: 1824 };
/** SearchSheet 输入框（两种 vh 口径下均落在输入行内：617..795 的交集 674..738 附近） */
const SEARCH_INPUT_TAP = { x: 400, y: 700 };
/** 「小说」scope chip（输入行下方 mt-4，chip x ≈ 427..597 的中心；y 取两口径交集 838..896 内） */
const SCOPE_NOVEL_TAP = { x: 512, y: 860 };
/** /illusts 中部卡片点击点位（瀑布流左右列中心 × 两档高度；避开心形所在卡底行） */
const CARD_TAP_CANDIDATES = [
  { x: 270, y: 1100 },
  { x: 810, y: 1100 },
  { x: 270, y: 650 },
  { x: 810, y: 650 },
];
/** 列表滚动一屏（上滑，RefreshableList 只认下拉为刷新，上滑安全） */
const SWIPE_SCROLL_UP: readonly [number, number, number, number] = [540, 1700, 540, 500];
/** 搜索结果列表内上滑（起止点均在结果区内部，避免跨到 scope/sort chip 上误触） */
const SWIPE_RESULTS_UP: readonly [number, number, number, number] = [540, 2050, 540, 1350];
/** 轮播左滑换卡（起点/终点均在封面图区，scrim 区不响应滑动） */
const SWIPE_CAROUSEL_NEXT: readonly [number, number, number, number] = [900, 700, 180, 700];

// ── 帧对比采样区域（Region = 物理像素窗口；全部避开状态栏/顶栏/lynx debug HUD 叠层）──
interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** R1「未回顶」对比窗口：列表内容区上半（顶栏 394 以下） */
const REGION_TOPREF: Region = { x0: 0, y0: 400, x1: 1080, y1: 1040 };
/** R2 结果列表区（关键词输入后 scope/sort/filter 行以下、面板底以上；vh 两口径的下方交集） */
const REGION_RESULTS: Region = { x0: 0, y0: 1270, x1: 1080, y1: 2140 };
/** R2「加载更多失败」红色文字扫描窗（横幅 flex 居中；避开行首缩略图列 x<200） */
const REGION_BANNER_SCAN: Region = { x0: 200, y0: 1850, x1: 1040, y1: 2140 };
/** R3 轮播封面图区（scrim 顶部最高约 1191，本窗口恒在 scrim 之上） */
const REGION_CAROUSEL_IMAGE: Region = { x0: 0, y0: 300, x1: 1080, y1: 1150 };
/** R3 scrim 收藏行窗口（遮罩底部锚定：pb-10vw=108 → 内容底边恒 2052；♥+收藏数在左下） */
const REGION_BOOKMARK_ROW: Region = { x0: 43, y0: 1955, x1: 430, y1: 2070 };

// ── 帧对比阈值（差异采样点数，步长 2；fab spec 同量纲。首跑如误判优先校准这里）──
/** 稳定判定：两次连拍差异 ≤ 此值视为画面已静止 */
const STABLE_TH = 350;
/** 变化判定：差异 > 此值视为画面实质变化（换卡/导航/内容推进） */
const CHANGE_TH = 800;
/** R1「未回顶」：与列表首帧对比需超过的差异（远大于换页噪声） */
const NOT_TOP_TH = 2000;
/** R1「相关作品段注入」：锚点下方区域差异阈值（段插入把后续卡整体下移 → 大差异） */
const INJECT_TH = 800;
/** R1「滚动保持」：锚点上方区域允许的最大差异占比（图片缓存命中时理论 ≈0，留 4% 噪声） */
const PRESERVE_RATIO = 0.04;
/** R2 翻页失败横幅：红色文字像素采样数下限（label-medium 红字实测应有数百采样，取保守下限） */
const BANNER_RED_TH = 25;

let ctx: AndroidE2eContext;
let serial = "";

// ─── 设备侧基建（lynx-bookmark-tags / fab 回归同款内联实现）───

/** 校验目标 AVD 分辨率/密度（坐标推导依赖；漂移时快速失败而非静默错点）。 */
function assertDeviceGeometry(s: string): void {
  const size = runCapture(adbPath(), ["-s", s, "shell", "wm", "size"]).stdout;
  const density = runCapture(adbPath(), ["-s", s, "shell", "wm", "density"]).stdout;
  expect(size).toMatch(/1080x2160/u);
  expect(density).toMatch(/480/u);
}

/** APK 内 lynx bundle 必须含 benchNav 深链钩子（BENCH_NAV=1 整链构建），否则快速失败并给指令。 */
function assertDeepLinkHookPresent(): void {
  const bundle = resolve(REPO_ROOT, "packages/app/android/app/src/main/assets/main.lynx.bundle");
  for (const hook of ["pictelioBenchNavIllust", "pictelioBenchNavCarousel"]) {
    const r = runCapture("grep", ["-a", "-c", hook, bundle]);
    if (r.stdout.trim() === "0") {
      throw new Error(
        `[transition-matrix] APK 内 lynx bundle 无深链钩子 ${hook}——请先 ` +
          "`BENCH_NAV=1 pnpm build:android`（整链注入；单独注入 build:app-lynx 会被覆盖，#542 实测坑）",
      );
    }
  }
}

/** 截屏（exec-out 直取 PNG 字节流，20MB 上限防 1080×2160 PNG 触发 ENOBUFS）并落盘留证。 */
function screenshot(name: string): Buffer {
  const buf = execFileSync(adbPath(), ["-s", serial, "exec-out", "screencap", "-p"], {
    maxBuffer: 20 * 1024 * 1024,
  });
  writeFileSync(resolve(EVIDENCE_DIR, `${name}.png`), buf);
  return buf;
}

/** 像素视图（canvas 解码 + getImageData；与 fab 回归同款依赖）。 */
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

/**
 * 区域化帧对比：返回 region 内（步长 2）逐通道阈值 24 的差异采样点数。
 * fab-hit-testing-regression 的 pngDiff 加 region 参数版——内容断言必须落在语义区域。
 */
async function diffRegion(a: Buffer, b: Buffer, region: Region): Promise<number> {
  const [ia, ib] = await Promise.all([loadImage(a), loadImage(b)]);
  const w = Math.min(ia.width, ib.width);
  const h = Math.min(ia.height, ib.height);
  const ca = createCanvas(w, h);
  const cxa = ca.getContext("2d");
  cxa.drawImage(ia, 0, 0);
  const da = cxa.getImageData(0, 0, w, h);
  const cb = createCanvas(w, h);
  const cxb = cb.getContext("2d");
  cxb.drawImage(ib, 0, 0);
  const db = cxb.getImageData(0, 0, w, h);
  const x0 = Math.max(0, Math.min(region.x0, w - 1));
  const y0 = Math.max(0, Math.min(region.y0, h - 1));
  const x1 = Math.min(w, region.x1);
  const y1 = Math.min(h, region.y1);
  let changed = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * w + x) * 4;
      if (
        Math.abs(da.data[i] - db.data[i]) > 24 ||
        Math.abs(da.data[i + 1] - db.data[i + 1]) > 24 ||
        Math.abs(da.data[i + 2] - db.data[i + 2]) > 24
      ) {
        changed++;
      }
    }
  }
  return changed;
}

/** 区域采样点总数（步长 2；供占比阈值用）。 */
function regionSamples(region: Region): number {
  return Math.ceil((region.y1 - region.y0) / 2) * Math.ceil((region.x1 - region.x0) / 2);
}

/** 区域内色彩桶数（lynx-bookmark-tags recommendedLoaded 同款判据的窗口化版本）：
 *  骨架屏近乎纯色，真实内容（图片/文字）加载后色彩桶数骤增。 */
function colorBuckets(p: Pixels, region: Region): number {
  const buckets = new Set<string>();
  for (let y = region.y0; y < region.y1; y += 16) {
    for (let x = region.x0; x < region.x1; x += 16) {
      const [r, g, b] = pixelAt(p, x, y);
      buckets.add(`${Math.floor(r / 24)},${Math.floor(g / 24)},${Math.floor(b / 24)}`);
    }
  }
  return buckets.size;
}

/** 区域内「错误红」文字像素采样数（text-error M3 error 红；heartFilled 同阈值族）。 */
function redTextSamples(p: Pixels, region: Region): number {
  let red = 0;
  for (let y = region.y0; y < region.y1; y += 2) {
    for (let x = region.x0; x < region.x1; x += 2) {
      const [r, g, b] = pixelAt(p, x, y);
      if (r > 150 && g < 110 && b < 110) red++;
    }
  }
  return red;
}

/** 设备级单击（adb input tap；fab / lynx-bookmark-tags 同款）。 */
function tap(x: number, y: number): void {
  runOrThrow(adbPath(), ["-s", serial, "shell", "input", "tap", String(x), String(y)]);
}

/** 设备级滑动（adb input swipe，300ms fling）。 */
function swipe(x1: number, y1: number, x2: number, y2: number): void {
  runOrThrow(adbPath(), [
    "-s",
    serial,
    "shell",
    "input",
    "swipe",
    String(x1),
    String(y1),
    String(x2),
    String(y2),
    "300",
  ]);
}

/** 系统返回键（keyevent 4；lynx 返回桥 pictelioBack → 路由 goBack）。 */
function pressBack(): void {
  runOrThrow(adbPath(), ["-s", serial, "shell", "input", "keyevent", "4"]);
}

/** 软键盘是否在前台（dumpsys input_method；有则第一次 back 由 IME 消费、不会触达 app 返回桥）。 */
function softKeyboardShown(): boolean {
  const r = runCapture(adbPath(), ["-s", serial, "shell", "dumpsys", "input_method"]);
  return /mInputShown=true|mInputViewShown=true/u.test(r.stdout);
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

/**
 * 按 pid 读 logcat 尾部（lynx-bookmark-tags 同款：自带 16MB maxBuffer 防
 * OnPatchFinishForFiber 逐帧日志 ENOBUFS，-t 限尾防 60fps 噪声）。
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

/** 等待 Lynx 渲染就绪（`onPageChanged|OnPatchFinishForFiber`，T7 口径，多 spec 同款）。 */
async function waitForLynxRenderReady(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (/onPageChanged|OnPatchFinishForFiber/u.test(logcatTailByPid())) {
      console.log("[transition-matrix] ✓ Lynx 渲染就绪");
      return;
    }
    await SLEEP(1_000);
  }
  throw new Error(`等待 Lynx 渲染就绪超时（${timeoutMs / 1000}s）`);
}

/**
 * benchNav 深链启动（probe spec 同款）：force-stop → 清 logcat →
 * `am start --es benchNav <scenario>`（MainActivity 转发 extras → LynxActivity 四次广播）。
 */
async function launchBenchNav(scenario: "illust" | "carousel"): Promise<void> {
  forceStopApp(serial);
  runOrThrow(adbPath(), ["-s", serial, "logcat", "-c"]);
  runOrThrow(adbPath(), [
    "-s",
    serial,
    "shell",
    "am",
    "start",
    "-n",
    `${APP_PACKAGE}/${MAIN_ACTIVITY}`,
    "--es",
    "benchNav",
    scenario,
  ]);
  await waitForTopActivity(LYNX_ACTIVITY);
  await waitForLynxRenderReady();
  await SLEEP(2_000);
}

/**
 * 帧稳定等待：连拍两帧对比 ≤ STABLE_TH 即认为画面静止，返回后一帧。
 * 用于「列表加载完成」「返回落地」「翻页触底」等无法条件等待的渲染收敛场景。
 */
async function waitForStableFrame(label: string, region: Region, timeoutMs = 30_000): Promise<Buffer> {
  const deadline = Date.now() + timeoutMs;
  let prev = await screenshot(`stable-${label}`);
  while (Date.now() < deadline) {
    await SLEEP(1_200);
    const cur = await screenshot(`stable-${label}`);
    if ((await diffRegion(prev, cur, region)) <= STABLE_TH) return cur;
    prev = cur;
  }
  throw new Error(`等待画面稳定超时（${label}，${timeoutMs}ms）——证据 stable-${label}.png`);
}

/** 等待区域内内容加载完成（色彩桶数 > 阈值；骨架屏 ≈ 单色不过阈）。 */
async function waitForContentLoaded(
  label: string,
  region: Region,
  minBuckets: number,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    last = colorBuckets(await toPixels(screenshot(`loaded-${label}`)), region);
    if (last > minBuckets) return;
    await SLEEP(2_000);
  }
  throw new Error(
    `等待内容加载超时（${label}：色彩桶数 ${last} 未超过 ${minBuckets}）——证据 loaded-${label}.png`,
  );
}

// ─── 登录（webview 契约注入；与 fab / probe spec 同款内联实现，helpers 未提取）───

async function loginViaWebview(loginCtx: AndroidE2eContext): Promise<void> {
  const driver = loginCtx.driver;
  await driver.switchToWebView(60_000);

  // 年龄确认页（/age-confirmation）：点「已满 18 岁」通过；已确认过则直接放行
  await driver.raw.waitUntil(
    async () => {
      const url = await driver.raw.getUrl();
      if (!url.includes("/age-confirmation")) return true;
      await clickByText(loginCtx, "已满 18 岁");
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
  await clickByText(loginCtx, "登录");
  await driver.raw.waitUntil(async () => !(await driver.raw.getUrl()).includes("/login"), {
    timeout: 90_000,
    timeoutMsg: "登录失败（仍停留在 /login）",
    interval: 2_000,
  });
  console.log("[transition-matrix] ✓ webview 登录完成（refresh_token 已落共享 WSSecureStorage）");
}

// ─── webview 数值探针（document.title 通道；switchToLynxFromSettings 先例：
//      execute 返回值被 Chromedriver 包裹不可靠读取，改写 title 再 getTitle 读回）───

async function probeWebviewNumber(jsExpr: string): Promise<number> {
  await ctx.driver.raw.execute(`(() => { document.title = "E2E-PROBE-" + (${jsExpr}); })()`);
  const title = String(await ctx.driver.raw.getTitle().catch(() => ""));
  const m = /^E2E-PROBE-(-?\d+)$/u.exec(title);
  return m ? Number(m[1]) : Number.NaN;
}

/** 搜索结果行总数（插画卡 + 小说卡；DOM 契约 = data-testid，ImageCard/NovelCard 源码钉死）。 */
const ROW_COUNT_EXPR = `document.querySelectorAll('[data-testid="illust-card"],[data-testid="novel-card"]').length`;
/** 插画结果行数（R4 scope 断言用）。 */
const ILLUST_ROW_EXPR = `document.querySelectorAll('[data-testid="illust-card"]').length`;
/** 「加载更多失败」横幅在否（InlineRetryBar role=status 文本；1 = 在）。 */
const BANNER_EXPR = `[...document.querySelectorAll('[role="status"]')].some((el) => (el.textContent ?? '').includes('加载更多失败')) ? 1 : 0`;

// ─── 用例 ───

describe.skipIf(SKIPPED)(
  `@release-gate T2 转换矩阵首版（issue #548，pictelio_ui）${SKIPPED ? `（SKIP：${SKIP_REASON}）` : ""}`,
  () => {
    beforeAll(async () => {
      const token = process.env.PIXIV_REFRESH_TOKEN ?? "";
      expect(token.length).toBeGreaterThan(0);
      assertDeepLinkHookPresent();

      ctx = await setupAndroidE2e(TARGET_AVD);
      serial = ctx.serial;
      assertDeviceGeometry(serial);

      // 阶段 A：webview 登录（setupAndroidE2e 的 pm clear 清掉 Keystore token，只能真实登录）
      writeClientKind(serial, "webview");
      forceStopApp(serial);
      startMainActivity(serial);
      await waitForTopActivity(MAIN_ACTIVITY);
      await loginViaWebview(ctx);

      // 阶段 B：契约层切 lynx（跨引擎登录态共享：WSSecureStorage → 种子恢复）
      expect(writeClientKind(serial, "lynx")).toBe("lynx");
    }, 900_000);

    afterAll(async () => {
      await ctx?.teardown().catch(() => {});
      try {
        if (!serial) return;
        forceStopApp(serial);
        writeClientKind(serial, "webview"); // 恢复默认，避免污染后续用例
      } catch {
        // 收尾失败不阻断
      }
    });

    it("R1 lynx /illusts：点中部卡片进详情 → 系统返回 → 锚点卡注入「相关作品」段 + 滚动不回顶", async () => {
      // 深链到 /illusts（benchNav illust），等列表内容渲染完成
      await launchBenchNav("illust");
      await waitForContentLoaded("r1-illusts", REGION_TOPREF, 25);
      const topRef = await waitForStableFrame("r1-top", REGION_TOPREF);

      // 下滑约一屏（进入列表中部），取滚动基线帧 S1
      swipe(...SWIPE_SCROLL_UP);
      const s1 = await waitForStableFrame("r1-scrolled", REGION_TOPREF, 20_000);

      // 逐候选点点击中部卡片，直到确认离开列表（帧大变化 = 进入详情）
      let tapPoint = { x: 0, y: 0 };
      let opened = false;
      for (const pos of CARD_TAP_CANDIDATES) {
        const before = await screenshot("r1-before-tap");
        tap(pos.x, pos.y);
        await SLEEP(2_500);
        const after = await screenshot("r1-after-tap");
        if ((await diffRegion(before, after, REGION_TOPREF)) > CHANGE_TH) {
          opened = true;
          tapPoint = pos;
          break;
        }
        console.warn(
          `[transition-matrix] tap (${pos.x},${pos.y}) 未导航（受限条目或空白位），尝试下一点位`,
        );
      }
      expect(opened, "点击候选点位均未进入详情页（证据 r1-before/after-tap.png）").toBe(true);

      // 详情页渲染收敛（封面大图加载）
      await waitForStableFrame("r1-detail", { x0: 0, y0: 72, x1: 1080, y1: 2160 }, 30_000);
      await screenshot("r1-detail-settled");

      // 系统返回 → 列表（KeepAlive 激活 → consumeAnchor 注入相关作品行）
      expect(currentTopActivity(serial)).toBe(LYNX_ACTIVITY);
      pressBack();
      await SLEEP(4_000); // 返回渲染 + 注入行网络请求（相关作品拉取）缓冲
      const s2 = await waitForStableFrame("r1-returned", REGION_TOPREF, 30_000);

      // 断言① 未回顶：返回后画面 ≠ 深链后的列表顶部画面
      const notTop = await diffRegion(s2, topRef, REGION_TOPREF);
      expect(
        notTop,
        `返回后应停留在原滚动位置而非列表顶部（与首帧差异 ${notTop} 应 > ${NOT_TOP_TH}）`,
      ).toBeGreaterThan(NOT_TOP_TH);

      // 断言② 滚动保持：锚点卡上方区域与进详情前逐像素一致（同卡同偏移）
      const above: Region = { x0: 0, y0: 400, x1: 1080, y1: Math.max(420, tapPoint.y - 80) };
      const preserved = await diffRegion(s1, s2, above);
      const preservedRatio = preserved / regionSamples(above);
      expect(
        preservedRatio,
        `锚点上方区域应保持原内容（差异占比 ${preservedRatio.toFixed(4)} 应 ≤ ${PRESERVE_RATIO}）——` +
          `超限意味列表被重置/重排（滚动位置丢失回归）`,
      ).toBeLessThanOrEqual(PRESERVE_RATIO);

      // 断言③「相关作品」段注入（relatedRowFor 渲染物）：锚点卡下方区域内容变化
      //   （段以 list-item 内部展开段插入，把该列后续卡片整体下移 → 帧差异集中落在本区域）
      const below: Region = { x0: 0, y0: tapPoint.y + 40, x1: 1080, y1: 2100 };
      const injected = await diffRegion(s1, s2, below);
      expect(
        injected,
        `返回后锚点卡下方应出现「相关作品」注入段（区域差异 ${injected} 应 > ${INJECT_TH}；` +
          `0 差异 = 注入段未渲染，ADR-0162 渲染缝回归）`,
      ).toBeGreaterThan(INJECT_TH);
      console.log(
        "[transition-matrix] ✓ R1 通过：未回顶 + 滚动保持 + 相关作品段注入（证据 r1-*.png）",
      );
    }, 300_000);

    it("R2 lynx SearchSheet：搜 original 翻页 → 行数推进且无失败横幅 → 切「小说」scope 内容整体替换", async () => {
      // 深链重进 /illusts（与 R1 状态解耦），经放射 FAB 内环搜索项打开 SearchSheet
      await launchBenchNav("illust");
      await waitForContentLoaded("r2-illusts", REGION_TOPREF, 25);
      const beforeFab = await screenshot("r2-before-fab");
      tap(FAB_TAP.x, FAB_TAP.y);
      await SLEEP(1_500);
      const afterFab = await screenshot("r2-after-fab");
      expect(
        await diffRegion(beforeFab, afterFab, REGION_TOPREF),
        "点击 FAB 后放射菜单未展开（坐标或层级回归，证据 r2-*-fab.png）",
      ).toBeGreaterThan(CHANGE_TH);
      tap(FAB_SEARCH_ITEM_TAP.x, FAB_SEARCH_ITEM_TAP.y);
      await SLEEP(2_000);
      const afterSearchItem = await screenshot("r2-search-sheet");
      expect(
        await diffRegion(afterFab, afterSearchItem, REGION_TOPREF),
        "点击内环搜索项后 SearchSheet 未打开（证据 r2-search-sheet.png）",
      ).toBeGreaterThan(CHANGE_TH);

      // 输入多结果词（即输即搜，300ms 防抖在 controller 内；短词无 fab spec 记录的截断风险）
      tap(SEARCH_INPUT_TAP.x, SEARCH_INPUT_TAP.y);
      await SLEEP(800);
      runOrThrow(adbPath(), ["-s", serial, "shell", "input", "text", "original"]);
      await SLEEP(1_000);
      // 收起软键盘（先探测：仅在 IME 在前台时 back，避免 back 误关 SearchSheet）
      if (softKeyboardShown()) {
        pressBack();
        await SLEEP(1_500);
        expect(softKeyboardShown(), "back 后软键盘未收起（R2 后续坐标依赖键盘收起后的布局）").toBe(
          false,
        );
      }
      await SLEEP(1_000); // 键盘收起后布局回弹 + 首页请求落定缓冲

      // 等结果渲染（结果区色彩桶数阈值），取第一页基线帧
      await waitForContentLoaded("r2-results", REGION_RESULTS, 20);
      const f1 = await waitForStableFrame("r2-page1", REGION_RESULTS);

      // 滚动 + 翻页推进检测（单循环）：
      // - 「停滞」= 某次上滑后画面无推进（diff ≤ STABLE_TH）→ 已停在当前列表底（首次触底帧 stalled）；
      // - 「推进」= stalled 之后任一帧相对 stalled 差异 > CHANGE_TH → 底部之后出现了新行
      //   （翻页追加的帧证据）。翻页失败（list patch 丢弃 / loadMore 回归）时列表钉死在
      //   首个触底位置，永远推不动 → 断言红。
      // 时序说明：scrolltolower 在接近底部时即触发追加，追加后视点随滚动进入新行——
      // 故不能拆成「先触底后推进」两阶段（追加发生时可能已越过首底），以首个停滞帧为
      // 基准的单向推进判定对两种时序（先停滞再追加 / 追加先于停滞）都成立。
      let stalled: Buffer | null = null;
      let advancedFrame: Buffer | null = null;
      let last = f1;
      for (let i = 0; i < 14 && advancedFrame === null; i++) {
        swipe(...SWIPE_RESULTS_UP);
        await SLEEP(1_600);
        const cur = screenshot(`r2-scroll-${i}`);
        const moved = await diffRegion(last, cur, REGION_RESULTS);
        if (moved <= STABLE_TH && stalled === null) {
          stalled = cur; // 首次触底（本轮滚动无推进）
        } else if (stalled !== null) {
          const grew = await diffRegion(stalled, cur, REGION_RESULTS);
          if (grew > CHANGE_TH) advancedFrame = cur; // 底部之后出现新内容 = 追加行已进入视口
        }
        last = cur;
      }
      expect(
        stalled,
        "14 次上滑内未检测到列表触底（结果区异常或滑动未生效，证据 r2-scroll-*.png）",
      ).not.toBeNull();
      expect(
        advancedFrame,
        "触底后继续滚动未出现新内容（翻页未追加行——list patch 丢弃 / loadMore 回归）",
      ).not.toBeNull();

      // 断言② 无「加载更多失败」横幅：结果底部无 text-error 红字（横幅 flex 居中、缩略图列已避开）
      const bannerRed = redTextSamples(await toPixels(last), REGION_BANNER_SCAN);
      expect(
        bannerRed,
        `结果列表底部出现红色文字（疑似「加载更多失败」横幅，红色采样 ${bannerRed} 应 ≤ ${BANNER_RED_TH}）`,
      ).toBeLessThanOrEqual(BANNER_RED_TH);

      // 断言③ 切「小说」scope：结果区内容整体替换（ADR-0107 D4「选了小说还能看到插画」旧行残留回归：
      //   残留时 novel 首帧 ≈ 切换前首帧 → 差异趋零 → 断言红）
      tap(SCOPE_NOVEL_TAP.x, SCOPE_NOVEL_TAP.y);
      await SLEEP(1_500);
      await waitForContentLoaded("r2-novel-scope", REGION_RESULTS, 20);
      const n2 = await waitForStableFrame("r2-novel-page1", REGION_RESULTS);
      const replaced = await diffRegion(n2, f1, REGION_RESULTS);
      expect(
        replaced,
        `切「小说」scope 后结果区应整体替换（与插画首帧差异 ${replaced} 应 > ${CHANGE_TH}；` +
          `趋零 = 旧插画行残留）`,
      ).toBeGreaterThan(CHANGE_TH);
      console.log(
        "[transition-matrix] ✓ R2 通过：翻页推进 + 无失败横幅 + 小说 scope 整体替换（证据 r2-*.png）",
      );
    }, 420_000);

    it("R3 lynx 推荐轮播：滑动换卡 ≥2 次 → 图片区前进 + 收藏行帧两两不同", async () => {
      await launchBenchNav("carousel");
      await waitForContentLoaded("r3-recommended", REGION_CAROUSEL_IMAGE, 25);
      const c0 = await waitForStableFrame("r3-card0", REGION_CAROUSEL_IMAGE);

      // 换卡 ×2：每次断言图片区内容前进（index 变化）
      const frames: Buffer[] = [c0];
      for (let i = 1; i <= 2; i++) {
        swipe(...SWIPE_CAROUSEL_NEXT);
        const ci = await waitForStableFrame(`r3-card${i}`, REGION_CAROUSEL_IMAGE, 20_000);
        const moved = await diffRegion(frames[i - 1], ci, REGION_CAROUSEL_IMAGE);
        expect(
          moved,
          `第 ${i} 次滑动后封面图区未变化（换卡失败/吸附回归，差异 ${moved} 应 > ${CHANGE_TH}）`,
        ).toBeGreaterThan(CHANGE_TH);
        frames.push(ci);
      }

      // 收藏行窗口两两不同（spec「收藏数两两不同（对比帧文本）」）：C 类 props 冻结缺陷
      // （BookmarkButton 轮播宿主不 remount → 收藏数恒定首卡值）的帧证据——冻结时三帧该窗口恒等
      for (let a = 0; a < frames.length; a++) {
        for (let b = a + 1; b < frames.length; b++) {
          const d = await diffRegion(frames[a]!, frames[b]!, REGION_BOOKMARK_ROW);
          expect(
            d,
            `第 ${a + 1} 与第 ${b + 1} 张卡的收藏行窗口内容相同（差异 ${d} 应 > ${CHANGE_TH}；` +
              `恒等 = 收藏数/收藏态冻结在首卡，BookmarkButton init-only props 宿主契约回归）`,
          ).toBeGreaterThan(CHANGE_TH);
        }
      }
      console.log(
        "[transition-matrix] ✓ R3 通过：换卡 ×2 + 收藏行三帧两两不同（证据 r3-card*.png）",
      );
    }, 240_000);

    it("R4 webview 搜索（基线对照）：同 R2 序列 → 行数数值增加 + 无失败横幅 + 小说 scope 无插画行", async () => {
      // 契约层切回 webview（switch-client-roundtrip 第三段同款惯例），重启后重取 WEBVIEW context
      writeClientKind(serial, "webview");
      forceStopApp(serial);
      startMainActivity(serial);
      await waitForTopActivity(MAIN_ACTIVITY);
      const driver = ctx.driver;
      await driver.switchToWebView(30_000);

      // /home → SideNavShell 搜索入口（aria-label「搜索」；openSettingsFromHome 同款语义定位）
      await driver.raw.waitUntil(
        async () => await driver.raw.$("[aria-label='搜索']").isExisting(),
        { timeout: 30_000, timeoutMsg: "/home 未渲染 SideNavShell 搜索入口", interval: 500 },
      );
      await driver.raw.execute(
        `(() => { const el = document.querySelector("[aria-label='搜索']"); if (el) el.click(); })()`,
      );
      await driver.raw.waitUntil(
        async () => (await driver.raw.getUrl().catch(() => "")).includes("/search"),
        { timeout: 30_000, timeoutMsg: "点击搜索入口后未进入 /search", interval: 2_000 },
      );

      // 输入多结果词：TagInput 内原生 input（native setter + input 事件 + Enter 提交 tag，
      // 与登录 token 注入同一 idiom）；tag 提交触发 store 搜索链
      await driver.raw.waitUntil(
        async () => await driver.raw.$("div.surface-card input[type='text']").isExisting(),
        { timeout: 30_000, timeoutMsg: "/search 主搜索框未渲染", interval: 500 },
      );
      await driver.raw.execute(
        `(() => {
          const input = document.querySelector("div.surface-card input[type='text']");
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, 'original');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        })()`,
      );
      await driver.raw.waitUntil(async () => {
        const n = await probeWebviewNumber(ROW_COUNT_EXPR);
        return Number.isFinite(n) && n > 0;
      }, { timeout: 60_000, timeoutMsg: "webview 搜索结果未渲染（original 应有多结果）", interval: 2_000 });

      // 断言① 翻页后行数增加（数值对比；哨兵 IntersectionObserver 由滚动到底触发）
      const countBefore = await probeWebviewNumber(ROW_COUNT_EXPR);
      let countAfter = countBefore;
      for (let i = 0; i < 6 && countAfter <= countBefore; i++) {
        await driver.raw.execute(`(() => { window.scrollTo(0, document.body.scrollHeight); })()`);
        await SLEEP(2_500);
        countAfter = await probeWebviewNumber(ROW_COUNT_EXPR);
      }
      expect(
        countAfter,
        `滚动到底后结果行数应增加（翻页前 ${countBefore} → 翻页后 ${countAfter}）`,
      ).toBeGreaterThan(countBefore);

      // 断言② 无「加载更多失败」横幅（文本对比；InlineRetryBar role=status 承载该文案）
      const banner = await probeWebviewNumber(BANNER_EXPR);
      expect(banner, "搜索结果页出现「加载更多失败」横幅").toBe(0);

      // 断言③ 切「小说」scope：插画行归零、小说行出现（数值对比；searchResults 双卡 data-testid 契约）
      await clickByText(ctx, "小说");
      await driver.raw.waitUntil(
        async () => {
          const illust = await probeWebviewNumber(ILLUST_ROW_EXPR);
          const novel = await probeWebviewNumber(
            `document.querySelectorAll('[data-testid="novel-card"]').length`,
          );
          return Number.isFinite(illust) && Number.isFinite(novel) && illust === 0 && novel > 0;
        },
        {
          timeout: 60_000,
          timeoutMsg: "切「小说」scope 后结果未刷新为纯小说行（插画行残留或空结果）",
          interval: 2_000,
        },
      );
      console.log(
        `[transition-matrix] ✓ R4 通过：行数 ${countBefore} → ${countAfter}，无失败横幅，小说 scope 插画行 = 0`,
      );
    }, 300_000);
  },
);

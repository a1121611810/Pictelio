// @vitest-environment node
/**
 * @release-gate 发版前手动门：T2 转换矩阵（issue #548，spec docs/specs/qa-defense-lines.md §3.T2）。
 *
 * **不进每-PR CI（#539 裁决）；发版前必跑 + 大 PR 手动触发。**
 * 运行前置 = Appium（pnpm appium:setup）+ AVD(pictelio_ui) + 代理（ANDROID_E2E_HTTP_PROXY=10.0.2.2:7897，
 * 等价 `adb shell settings put global http_proxy 10.0.2.2:7897`，setup.ts 统一下发/teardown 清除）
 * + 登录态（PIXIV_REFRESH_TOKEN，经 `prefs.loginViaDevIntent()` 注入）+ **`BENCH_NAV=1 pnpm build:android`**
 * （benchNav 深链钩子整链注入，单独注入 build:app-lynx 会被覆盖——#542 实测坑；beforeAll 用 bundle grep 快速失败）。
 *
 * ── 单引擎化后本门从 4 行降为 3 行（#610 处置）────────────────────────────
 * 原 R4「webview 搜索（基线对照）」整行删除：它断言的是 WebView SPA 的 DOM 契约
 * （`data-testid="illust-card"`、`role=status` 横幅、SideNavShell aria-label 搜索入口）。
 * **不可观测的原因不是「前端没打进包」**——实测（2026-09-28，unzip 主线 debug APK）
 * 包内仍有 27 条 `assets/public/*` 外加 `assets/capacitor.config.json`；
 * 而是去 Capacitor 化后**没有任何 Activity 承载 WebView**（`MainActivity` /
 * `MainActivityWebview` 已删，唯一入口是 launcher `LynxActivity`），
 * 于是 Appium 永远等不到 WEBVIEW context，DOM 断言无从落地。
 * 连带删除其专属死代码
 * （`loginViaWebview` / `probeWebviewNumber` / `ROW_COUNT_EXPR` / `ILLUST_ROW_EXPR` / `BANNER_EXPR`）。
 * **本门不再有「双引擎基线对照」**——单引擎下不存在第二个渲染面可比。
 * spec §3.T2 的「4 行转换矩阵」表述已同步改为 3 行。
 *
 * **首跑已完成（2026-09-16，pictelio_ui，双引擎时期，4/4 绿）**：R1 43.5s / R2 58.3s / R3 34.9s / R4 17.6s。
 * 首跑历经 5 轮校准（三失败全为**测试常量/度量**问题，非产品缺陷——R3 证据帧实证收藏数
 * 1168→33 正常变化而标准度量读不出）。校准要点（详见下方各常量与判据注释）：
 * ① 榜单入口大卡恒占 y≤1150 且不随列表滚动 → 对比区/点击点必须取其下（列表视口 1150..2088）；
 * ② 卡片点击需网格重试（fling 落点随机，单点可能落在 ♥ 行 = 只切收藏不导航）；
 * ③ FAB 内环搜索项实测 (906,1760)、scope chip 行实测 y≈776（几何推导值分别偏 64px/84px）；
 * ④ 低对比内容（♥ 收藏数半透明灰字）需「通道和差」度量，逐通道 >24 恒判恒等；
 * ⑤ 列表长度无界（original 达 30+ 屏）→ 翻页判据取「10 次滑动内底部带持续更新」而非「测到底」。
 *
 * ── 矩阵 3 行（spec §3.T2，每行 = 一个已收口缺陷的回归，全部 Lynx）──────────
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
 *
 * ── 为什么 lynx 侧断言是「帧对比」而不是文本直读（口径声明，spec §0 允许）─────
 * Lynx 4.0.1 原生 LynxView 的 accessibility 树不暴露 view/text（TalkBack 绑定仍空树），
 * uiautomator dump 在 pictelio_ui 上必被 SIGKILL（exit 137）——「无 UI 自动化通道，
 * 全部定位走截图 + 像素分析」是仓库既有实测结论（lynx-bookmark-tags / fab spec 文件头）。
 * spec §0 对内容断言的定义包含「段存在性/数值对比」，§3.T2 对 R1/R3 明书「对比返回前后
 * 截图」「对比帧文本」——故本门以**区域化帧对比**（差异必须落在语义区域：锚点下方/
 * 收藏行窗口/列表底部）承载内容断言，禁止整帧无差别 diff（那是 #374 存在性口径的换皮）。
 *
 * ── 驱动方式（全部沿用既有 spec 已验证的交互，无新发明）────────────────────
 * - 深链：`am start -n <pkg>/.LynxActivity --es benchNav <scenario>`——benchNav extra
 *   由 LynxActivity 自行读取（`LynxActivity.java:504` getStringExtra("benchNav") +
 *   `:660` applyDevIntentHooks），**不经过已删除的 MainActivity 转发**；
 * - 点击/滑动：adb `input tap|swipe|motionevent|keyevent`（fab / lynx-bookmark-tags 先例）；
 * - 登录：dev intent hook（prefs.loginViaDevIntent，替换原 webview 登录页注入）；
 * - 断言证据：截图逐帧落盘 test-results/android-e2e/transition-matrix/。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, loadImage } from "canvas";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";
import { runReleaseGate, type OutcomeRow } from "../support/releaseGate";
import {
  adbPath,
  APP_PACKAGE,
  LYNX_ACTIVITY,
  MAIN_ACTIVITY,
  REPO_ROOT,
  runCapture,
  runOrThrow,
} from "../env";
import {
  currentTopActivity,
  forceStopApp,
  loginViaDevIntent,
  readAppLogcat,
  startMainActivity,
} from "../prefs";
import {
  CONTENT_BOTTOM,
  CONTENT_RIGHT,
  MIN_BOOKMARK_SAMPLES,
  belowAnchorRegion,
  bookmarkSampleRegion,
  detectBookmarkRow,
  fabCenterPx,
  fabSearchItemPx,
  judgeBookmarkRow,
  judgeContentLoaded,
  judgeNotTopWindow,
  notTopWindow as notTopRegion,
  regionSamples as geomRegionSamples,
  roundPx,
  type GrayAt,
} from "../transition-geometry";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 证据落盘目录（被 gitignore，仅本地取证用） */
const EVIDENCE_DIR = resolve(REPO_ROOT, "packages/android-host/test-results/android-e2e/transition-matrix");
mkdirSync(EVIDENCE_DIR, { recursive: true });

// ── AVD pin（仿 lynx-bookmark-tags / fab 回归）：坐标常量绑定 pictelio_ui ──
const TARGET_AVD = process.env.ANDROID_E2E_AVD || "pictelio_ui";
const SKIPPED = TARGET_AVD !== "pictelio_ui";
const SKIP_REASON = `坐标常量绑定 pictelio_ui（1080×2160/density 480），当前 ANDROID_E2E_AVD=${TARGET_AVD}`;
if (SKIPPED) {
  console.log(`[transition-matrix] SKIP: ${SKIP_REASON}`);
}

// ── 坐标常量（pictelio_ui：物理 1080×2160，density 480，1vw = 10.8px）──────────
// 首跑校准记录（2026-09-16，pictelio_ui 实机；首跑 3 失败全部为常量偏差，非产品缺陷）：
// - /illusts 的榜单入口大卡是 RefreshableList 的**兄弟节点**（不在列表流内）→ 永不随列表
//   滚动，恒占 y≈380..1150。任何 y<1200 的点击都会命中它并导航到 /ranking（首跑 R1/R2
//   即因此误入榜单页）→ 卡片点击点位必须取 y≥1350（列表视口 1150..2088 内）。
// - 内环「搜索」项首跑写成魔数 (906,1760)，而实机在 **(903,1682)**（2026-09-28 20:27
//   `r2-after-fab.png` 逐像素簇实测：三个 115px 内环小圆盘中心 903,1682 / 795,1742 /
//   741,1852）——魔数落在环项之间的空隙，点下去菜单收起、回到列表，#816 R2 红真因。
//   现改为按 GlobalFab.vue 几何推导（`fabSearchItemPx()`），见下方常量区。
// - scope chip 行实机 y≈776（本轮实弹切「小说」成功）；几何推导值 860 实际命中
//   **sort 行**（最新/最早/热门）——两行仅差约 84px，必须按实测取。
// - 轮播收藏行（♥ + 收藏数）实机 y≈1915..1975；首跑窗口 1955..2070 只覆盖数字下缘 →
//   窗口内几乎全是 scrim 渐变背景 → 三帧恒等误报（R3 失败实因，非 props 冻结缺陷）。
// 推导模型 = fab-hit-testing-regression 同款 vw 几何。
//
// ⚠️ 2026-09-28 口径订正（转场矩阵复跑 3 红时定位）：本段原按 **H = 200vw（全屏 2160）** 推导
// FAB 中心 → y=2033，但**实现不是这个口径**。`GlobalFab.vue` 的
// `screenHeightVw(contentSize, …)`（`viewportGeometry.ts:35-41`）在 `contentSize` 命中时返回
// `(contentSize.h / contentSize.w) * 100`，而 `contentSize.h` 是**稳定区**高度，不是全屏：
//     dumpsys window displays → app=1080x2088 / rng=1080x936-2160x2016 ⇒ contentSize.h = 2016
// 三种口径的 FAB 中心：
//     全屏 2160 → 2033（本段原值，错）   app 2088 → 1961   稳定区 2016 → 1889 ← 实现口径
// 像素级实测（canvas 扫 FAB 浅蓝底色，band 高 161px = 精确直径）：
//     浅蓝带 y 1808..1969 → 中心 **1889**，与「稳定区 2016」逐位吻合，与全屏口径差 144px
//     （= 状态栏 72 + 手势条 72）。原 tap 点落在 FAB 盒外 → 放射菜单从未展开（R2 红实因，
//     before/after FAB 浅蓝像素数逐位相同 = 纹丝未动）。
// ⇒ FAB_TAP 的 y 由 2033 改为 1889。`assertDeviceGeometry` 已加系统栏校验：
//   换 ROM / 换导航模式（gestural↔threebutton）导致稳定区高度变化时**快速失败**，
//   而非静默点到空处——原实现只校验分辨率/密度，漏掉了这一维。
//
// - 放射 FAB 与内环落点：**已由 `fabCenterPx()` / `fabSearchItemPx()` 按 GlobalFab.vue 几何推导**
//   （常量在下方 CONTENT_BOTTOM / CONTENT_RIGHT 之后声明）。口径订正记录见上方两段。
// - SearchSheet 底部面板 = 80vh：vh 基准存在 2088（= 2160-72）/2016（再减手势条 72）两种实测口径，
//   面板顶分别为 490/547 —— 下列输入框坐标取两种口径的交集规避；
// - 轮播滑动起点取封面图区（scrim 遮罩 pointer-events 不生效、不响应滑动——Recommended.vue 真机修复注记）。
/**
 * SearchSheet 输入框（2026-09-28 #816 R2 复校正：由像素实测替代旧「两口径取交集」的猜测）。
 *
 * 旧值 (400,700)：`r2-search-sheet.png`（20:45 R2 实跑）沿 x=400 竖扫，输入框淡紫填充带
 * (225,227,233) 实为 **y 560..680**；y=700 已落到带外纯白 (255,255,255) → **点在框下 20px 空隙**，
 * 输入框从未获得焦点，`input text "original"` 全部落空 ⇒ 结果区恒空 ⇒ 翻页「第 0 次上滑即停滞」。
 * 框实测范围 x 48..1034 / y 560..680，取中心 (541,620)（该点为纯填充、未压占位符字形）。
 */
const SEARCH_INPUT_TAP = { x: 541, y: 620 };
/** 「小说」scope chip（首跑校准：实机 y≈776；几何推导值 860 命中 sort 行——两行仅差 ~84px） */
const SCOPE_NOVEL_TAP = { x: 512, y: 776 };
/** /illusts 卡片点击点位网格（首跑/三跑校准：榜单卡恒占 y≤1150 → 全部取 y≥1250；
 *  列表视口 1150..2088 高约 938px，单点固定 y 会受 fling 落点影响落到卡片「♥ 行」
 *  （点击只切收藏不导航，实测：同为 y1450 在不同滚动落点分别命中图片区与 ♥ 行）——
 *  故取 2 列 × 5 带网格逐点重试，任一命中图片/标题/作者区即导航成功） */
const CARD_TAP_CANDIDATES = [
  { x: 270, y: 1250 },
  { x: 810, y: 1250 },
  { x: 270, y: 1400 },
  { x: 810, y: 1400 },
  { x: 270, y: 1650 },
  { x: 810, y: 1650 },
  { x: 270, y: 1800 },
  { x: 810, y: 1800 },
  { x: 270, y: 1950 },
  { x: 810, y: 1950 },
];
/** 列表滚动一屏（上滑，RefreshableList 只认下拉为刷新，上滑安全） */
const SWIPE_SCROLL_UP: readonly [number, number, number, number] = [540, 1700, 540, 500];
/**
 * 结果列表上滑（#816 R2 复校正）。起止点均在结果区内部，避免跨到 scope/sort chip 上误触。
 *
 * 旧值起点 y=**2050** 已在内容区底界 `CONTENT_BOTTOM=2016` 之下（系统手势条 inset 内），
 * 落点不在 `<list class="flex-1 min-h-0">` 的盒内 ⇒ 列表收不到滚动。
 * 现场证据（20:48 实跑 r2-scroll-0..9 逐段复算 diffRegion）：
 *   - HUD 记到 `dY: -700.0`、`Yv: -2.332` ⇒ 手势**确实送达**了 App 根，但列表逐像素不动；
 *   - 基线 vs scroll-0 的整屏 2157 差异里 **1658 落在 y0..120**（benchNav 调试 HUD，每次手势
 *     都变），内容区仅 118/187/87；scroll-0 vs scroll-9 整屏只差 104 ⇒ 列表压根没滚。
 * 起点改到 1900（落在最后一条可见结果行上），终点 1300（仍在列表顶 1188 之下）。
 */
const SWIPE_RESULTS_UP: readonly [number, number, number, number] = [540, 1900, 540, 1300];
/** 轮播左滑换卡（起点/终点均在封面图区，scrim 区不响应滑动） */
const SWIPE_CAROUSEL_NEXT: readonly [number, number, number, number] = [900, 700, 180, 700];

// ── 帧对比采样区域（Region = 物理像素窗口；全部避开状态栏/顶栏/lynx debug HUD 叠层）──
interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/**
 * 内容区底界（= 稳定区高度 2016 = Lynx contentSize.h 口径）。
 *
 * ⚠️ 2026-09-28：以下各采样窗口原按 **2080 / 2140** 取 y1，越过了内容区底界。
 * 越界部分落在**恒定不变的系统栏/手势条**上——那部分像素在任意两帧间都相同，
 * 会按比例**稀释帧对比差异**，让「内容确实变了」被判成「没变」：
 *   - `REGION_RESULTS_BOTTOM` 原 1850..2140（高 290）中 124px 是死像素，占 **43%**；
 *   - `REGION_RESULTS` / `REGION_BANNER_SCAN` 原 1270..2140 / 1850..2140，越界 124px；
 *   - `REGION_TOPREF` 原 1200..2080，越界 64px。
 * 全部钳到 `CONTENT_BOTTOM` 后，窗口内全部是真实内容像素。
 * （`REGION_BOOKMARK_ROOM` 1905..1990 本就在区内，未越界，故不动。）
 */
/** R1「未回顶」对比窗口（首跑校准：榜单入口大卡是 RefreshableList 兄弟节点、恒占
 *  y≈380..1150 且永不滚动——旧窗 400..1040 整块落在静态卡上 → 差异恒 ≈0，与列表位置
 *  无关（首跑/二跑 R1 失败实因）。列表真实视口 = 榜单卡之下 1150..2016） */
const REGION_TOPREF: Region = { x0: 0, y0: 1200, x1: 1080, y1: CONTENT_BOTTOM };
/** R2 结果列表区（关键词输入后 scope/sort/filter 行以下、面板底以上） */
const REGION_RESULTS: Region = { x0: 0, y0: 1270, x1: 1080, y1: CONTENT_BOTTOM };
/** R2 触底判定带（三跑校准）：结果列表**底部带**——只在「新行进入视口」时变化，
 *  比整结果区稳定（中部懒加载缩略图会持续造成整区差异 → 永不停滞） */
const REGION_RESULTS_BOTTOM: Region = { x0: 0, y0: 1850, x1: 1080, y1: CONTENT_BOTTOM };
/** R2「加载更多失败」红色文字扫描窗（横幅 flex 居中；避开行首缩略图列 x<200） */
const REGION_BANNER_SCAN: Region = { x0: 200, y0: 1850, x1: 1040, y1: CONTENT_BOTTOM };
/** R3 轮播封面图区（scrim 顶部最高约 1191，本窗口恒在 scrim 之上） */
const REGION_CAROUSEL_IMAGE: Region = { x0: 0, y0: 300, x1: 1080, y1: 1150 };
/**
 * R3 收藏行探测域（#814：采样窗已改为运行时探测，此常量仅作探测范围，不再直接当采样窗用）。
 * 原硬编码采样窗 = { x0: 43, y0: 1905, x1: 430, y1: 1990 }，见上方订正①。
 */

// ── 运行时几何探测（2026-09-28 #814）────────────────────────────────────────────
//
// 为什么必须运行时探测：#814 实测推翻了三处硬编码假设，**报错文案全部指向错误根因**。
//
// ① R3 采样窗 x 范围漏掉了收藏数字。
//    证据：stable-r3-card{0,1,2}.png 上按 diffRegionLoose 复算原采样窗
//      （x 43..430 × y 1905..1990）得 card0 vs card1 = 50、card0 vs card2 = 57（都能过），
//      但 **card1 vs card2 = 0**。同一窗、同一度量，两对结果一过一不过 ⇒ 不是「状态冻结」，
//      是**这一对卡片的收藏数字恰好落在采样窗 x 范围之外**。
//    逐行扫描证实：该帧 y 1860..1940 的深色内容横跨 **x 0..1078**（♥ 徽标是整行宽的 scrim
//      胶囊，不是只占左侧 43..430），窗右界 430 会把数字切掉。
//    ⇒ 改为运行时按「深色 scrim 胶囊行」定位 y，再按该行**全宽**取窗。
//
// ② R1 的 below 区包含恒定死像素。
//    证据：below = y(tapY+40)..2100 复算差异 tapY=1250→444、1400→369、1650→240、1800→232、
//      **1950→0**；而 2100 已越过 CONTENT_BOTTOM=2016 ⇒ 靠底部的一段恒落在系统栏上。
//      实测占比只有 0.2%，却足以把断言压到 INJECT_TH 之下。
//    ⇒ below 的 y1 钳到 CONTENT_BOTTOM。
//
// ③ R2 的色彩桶判据与「是否加载完」没有稳定对应。
//    证据：loaded-r2-illusts.png（mtime 17:53:42 = 最后一轮轮询）桶数 **88**、远高于阈值 25，
//      但同一函数报「未超过 25」⇒ 之前所有轮询都停在骨架屏（逐带桶数 1..5、亮度 202..238），
//      90s 耗尽。真因 = **首屏懒加载耗时**（网络恢复后单图仍需 ~0.8s × 首屏 N 张）。
//    ⇒ 判据改为「桶数过阈 **或** 帧已稳定」，并把超时与「真的没加载」区分开。
//
// 纯逻辑（探测 / 窗构造 / 可信度裁决 / 加载判据）已提取到 `../transition-geometry`，
// 由 `unit/transition-geometry.test.ts` 以真实帧实测值覆盖（12 例）——spec 只留编排。
//
// 判据可信度自检（新增，禁止再出现「蒙对」）：探测函数在**证据帧**上跑出的值必须与
// 该帧的实测像素一致；窗与被测对象无交集时必须返回「不可信」而非 0。

/** 深色 scrim 胶囊行探测（R3 收藏行）：canvas 薄封装，委托纯逻辑到 transition-geometry。 */
function detectBookmarkRowOnFrame(p: Pixels, region: Region): { y0: number; y1: number } | null {
  const gray: GrayAt = (x, y) => {
    const [r, g, b] = pixelAt(p, x, y);
    return (r + g + b) / 3;
  };
  return detectBookmarkRow(region, gray);
}

/** 收藏行探测扫描域（scrim 底部带；右界 = `CONTENT_RIGHT` 1080 横跨全屏宽、
 *  收藏胶囊实测横跨 x 0..1078；上界 = `CONTENT_BOTTOM` 避开系统栏） */
const REGION_BOOKMARK_SCAN: Region = { x0: 0, y0: 1700, x1: CONTENT_RIGHT, y1: CONTENT_BOTTOM };

// 放射 FAB 落点：**推导所得，非魔数**（#816 R2 真因教训）。
//
// 声明位置在 CONTENT_BOTTOM / CONTENT_RIGHT 之后，因为推导要以内容区（稳定区）尺寸为输入——
// 这正是本轮连续写错坐标的根源：全屏 2160 / app 2088 / 稳定区 2016 三种口径差 144px。
// 公式镜像 packages/app-lynx/src/components/GlobalFab.vue（改组件几何须同步 transition-geometry.ts
// 并跑 unit/transition-geometry.test.ts）：
//   fabCx = 100 - 4.267 - 14.933/2 = 88.2665vw；fabCy = H − 4.267 − 14.933/2
//   polar(a, r) = (cx + sin(a)·r, cy − cos(a)·r)；内环 r = 20vw
/**
 * 放射 FAB 主按钮圆心（取整 = **(953, 1889)**，与本轮像素实测验证过有效的手写常量逐位相同；
 * 20:27 证据帧实测簇心 (952,1888)）。
 */
const FAB_TAP = roundPx(fabCenterPx(CONTENT_BOTTOM, CONTENT_RIGHT));
/**
 * 内环「搜索」项圆心（取整 = (901, 1680)；实测 (903,1682)）。
 *
 * 首跑写死 (906,1760)：距推导圆心 80px > 圆盘半径 57.6px ⇒ 点在环项之间的**空隙**，
 * 菜单收起、回到列表，报错却写「SearchSheet 未打开」，把排查引向布局回归。已由单测钉死。
 */
const FAB_SEARCH_ITEM_TAP = roundPx(fabSearchItemPx(CONTENT_BOTTOM, CONTENT_RIGHT));

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

/**
 * 校验目标 AVD 分辨率/密度/**稳定区高度**（坐标推导依赖这三者；漂移时快速失败而非静默错点）。
 *
 * ⚠️ 2026-09-28 增补第三项：原实现只校验 `wm size` / `wm density`，漏掉了系统栏高度——
 * 而 FAB 等常量按「稳定区 2016px」推导（见上方口径订正）。换 ROM 或切换导航模式
 * （gestural ↔ threebutton）会让稳定区高度变化，此时旧常量会**静默点到空处**
 * （2026-09-28 实测：全屏口径 2033 vs 实际 1889，偏 144px，落在 FAB 盒外）。
 * 像素级 UI 断言在坐标错位时表现为「功能坏了」，极易被误判为产品回归。
 */
function assertDeviceGeometry(s: string): void {
  const size = runCapture(adbPath(), ["-s", s, "shell", "wm", "size"]).stdout;
  const density = runCapture(adbPath(), ["-s", s, "shell", "wm", "density"]).stdout;
  expect(size).toMatch(/1080x2160/u);
  expect(density).toMatch(/480/u);

  // 稳定区高度（= Lynx contentSize.h 口径，也是 FAB 等坐标常量的 H 基准）
  const displays = runCapture(adbPath(), [
    "-s",
    s,
    "shell",
    "dumpsys",
    "window",
    "displays",
  ]).stdout;
  const rng = /rng=\d+x\d+-\d+x(\d+)/u.exec(displays);
  expect(
    rng,
    `无法从 dumpsys window displays 解析稳定区高度（坐标常量依赖它）。原始输出片段：${displays
      .split("\n")
      .find((l) => l.includes("rng="))
      ?.trim()}`,
  ).not.toBeNull();
  const contentHeight = Number(rng?.[1]);
  expect(
    contentHeight,
    `稳定区高度应为 ${CONTENT_BOTTOM}（状态栏 72 + 手势条 72 之外）；实测 ${contentHeight}。` +
      `本 spec 的 FAB / 采样窗口常量按 ${CONTENT_BOTTOM} 校准，换 ROM 或切换导航模式后需重新校准` +
      `（gestural ↔ threebutton 会改变底部系统条高度）。`,
  ).toBe(CONTENT_BOTTOM);
}

/** APK 内 lynx bundle 必须含 benchNav 深链钩子（BENCH_NAV=1 整链构建），否则快速失败并给指令。 */
function assertDeepLinkHookPresent(): void {
  const bundle = resolve(REPO_ROOT, "packages/android-host/android/app/src/main/assets/main.lynx.bundle");
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

// 区域采样点总数（步长 2）已迁至 `../transition-geometry` 的 `regionSamples`
// （以 `geomRegionSamples` 别名导入，由 unit/transition-geometry.test.ts 覆盖）。
// #816 恢复锚点：若要改回本文件内的本地实现，从提交 9c2604d4 恢复该函数并把
// import 中的 `regionSamples as geomRegionSamples` 换回 `regionSamples`。

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

/** 区域内平均亮度（0..255）。用途：SearchSheet（底部 80vh 面板，顶边实测 ≈y360）打开时
 *  其面板区由列表内容（多为图片，均值 ~95）变为近白面板（均值 ~250）——用固定语义带
 *  （输入行 y620-790 / scope 行 y800-960）的绝对亮度 ≥180 作「sheet 确实打开」判据。
 *  二跑教训：曾用「sheet 上方 20vh 被 scrim 压暗」——实测该区**不压暗**（两态逐像素恒等，
 *  亮度 124.3 vs 124.3）→ 判据恒假。判据必须建立在实测特征上。 */
async function avgBrightness(png: Buffer, region: Region): Promise<number> {
  const p = await toPixels(png);
  let sum = 0;
  let n = 0;
  for (let y = region.y0; y < region.y1; y += 4) {
    for (let x = region.x0; x < region.x1; x += 4) {
      const [r, g, b] = pixelAt(p, x, y);
      sum += (r + g + b) / 3;
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * 低对比区域差异度量（首跑 R3 实因）：♥/收藏数是**半透明灰字叠深色 scrim**，
 * 字形差异的逐通道幅度普遍 <20 —— diffRegion（逐通道 >24）恒返 0，即使收藏数从
 * 1168 变到 33 也判「恒等」。本度量改判「通道和差 > 30」并逐像素（步长 1），
 * 对低对比内容敏感；冻结回归（props 冻结）时该窗口逐像素恒等 → 仍为 0。
 */
async function diffRegionLoose(a: Buffer, b: Buffer, region: Region): Promise<number> {
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
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const d =
        Math.abs(da.data[i] - db.data[i]) +
        Math.abs(da.data[i + 1] - db.data[i + 1]) +
        Math.abs(da.data[i + 2] - db.data[i + 2]);
      if (d > 30) changed++;
    }
  }
  return changed;
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
 * 按 pid 读 logcat 尾部（渲染就绪探测 + 证据留档）。
 *
 * #819：原先此处是一份**私有副本**（与 lynx-bookmark-tags 逐字同款），连同它的
 * `"(进程不存在)"` 占位串一起。副本有三处问题：① logcat 采集口径分裂（本轮
 * 统一只做了 2/4 处）；② pid 为空时返回占位串而非空串，会被 `waitForLynxRenderReady`
 * 的正则当日志内容反复匹配，且**不** warn（违反「禁止静默降级」）；
 * ③ 自带 spawnSync 绕开了 env.runCapture 的 cleanEnv。
 * 现统一走 `prefs.readAppLogcat({ lines })`——`env.runCapture` 本就支持
 * maxBuffer 形参（4th），16MB 逐帧缓冲与 `-t` 限尾都已收进该函数。
 */
function logcatTailByPid(lines = 2000): string {
  return readAppLogcat(serial, { lines });
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
 * `am start --es benchNav <scenario>`（**LynxActivity 自行读取**——`LynxActivity.java:504`
 * getStringExtra("benchNav") 后按场景 sendGlobalEvent；单引擎下已无 MainActivity 转发环节）。
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
async function waitForStableFrame(
  label: string,
  region: Region,
  timeoutMs = 30_000,
): Promise<Buffer> {
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

/**
 * 等待区域内内容加载完成。
 *
 * 判据 = **色彩桶数过阈 或 画面已稳定**（2026-09-28 #814 订正）。
 *
 * 原实现只有「桶数 > 阈值」一条判据，实测不可靠：loaded-r2-illusts.png 的最终帧桶数
 * 是 **88**（阈值 25，远超），但同一函数仍报「未超过 25」——因为 90s 全部耗在骨架屏
 * （逐带桶数 1..5、亮度 202..238 的均匀浅灰）上。**色彩桶数与「是否加载完」没有稳定对应**：
 * 单张大幅插画铺满视口时纵向色块少，桶数天然偏低；而骨架屏若恰有渐变也可能虚高。
 *
 * 「帧已稳定」是内容无关的收敛信号：列表不再变化 ⇒ 渲染已停。此时若桶数仍低，
 * 说明该内容形态就是低桶（而非还没加载完）——继续等也无意义，故放行。
 *
 * 超时文案区分两种失败，避免再把「加载慢」说成「内容没加载」：
 *   - 未稳定且桶数低 → 真的没加载完（附桶数与稳定度）
 *   - 已稳定但桶数低 → 内容形态低桶，放行并打日志
 */
async function waitForContentLoaded(
  label: string,
  region: Region,
  minBuckets: number,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  let lastFrame: Buffer | null = null;
  while (Date.now() < deadline) {
    const cur = await screenshot(`loaded-${label}`);
    last = colorBuckets(await toPixels(cur), region);
    // 画面已收敛（与上一帧差异 ≤ STABLE_TH）⇒ 渲染已停
    const stable = lastFrame !== null && (await diffRegion(lastFrame, cur, region)) <= STABLE_TH;
    const verdict = judgeContentLoaded({ buckets: last, minBuckets, stable });
    if (verdict.verdict === "loaded") return;
    if (verdict.verdict === "stable-but-low-buckets") {
      console.log(
        `[transition-matrix] ℹ ${label} 画面已稳定但桶数 ${last} ≤ ${minBuckets}：` +
          `判为内容形态低桶（非加载未完成），放行`,
      );
      return;
    }
    lastFrame = cur;
    await SLEEP(2_000);
  }
  // 超时：附上稳定度，帮助区分「加载慢」与「真没加载」
  const stability =
    lastFrame === null ? "未能取得帧" : `最后一帧桶数 ${last}，超时 ${timeoutMs / 1000}s`;
  throw new Error(
    `等待内容加载超时（${label}：${stability}，未超过 ${minBuckets}）——证据 loaded-${label}.png。` +
      `注意：慢网络下首屏懒加载可能耗尽超时（实测单图 ~0.8s × 首屏 N 张），` +
      `此时应先确认网络而非判定内容异常`,
  );
}

// ─── 用例 ───

describe.skipIf(SKIPPED)(
  `@release-gate T2 转换矩阵首版（issue #548，pictelio_ui）${SKIPPED ? `（SKIP：${SKIP_REASON}）` : ""}`,
  () => {
    /**
     * 内容判定台账（#819 code-review 两轴共识阻塞修复，#819 二次订正为**三态**）。
     *
     * **为什么需要它**：本门多处「采样窗取不到被测对象 ⇒ 不可判定」分支。修掉
     * `return` 判绿之前，这些分支让 vitest 记 **passed**——发版门对「相关作品段注入」
     * （ADR-0162）与「收藏行两两不同」（init-only props）这两条**内容断言**丧失强制力，
     * 且 `:xxx` 的「✓ R1/R3 通过」日志会宣称验证了实际未验证的事。
     *
     * 现在三处都改用 `t.skip()`（报 skipped 而非 passed），这里再补一道**外层**，
     * 堵住「有人把 skip 又改回 return」这条回潮路径。
     *
     * ⚠️ **为什么是三态而不是布尔**（二次订正的实测依据）：
     * 这两行的可判定性**依赖内容形态**，不是恒可判定也不是恒不可判定。实测两跑对照
     * （同一份代码、同一台 AVD，只因推荐流内容不同）：
     *   · 全量跑那轮：`belowAnchorRegion` 差异 **214** ≤ INJECT_TH(800) ⇒ R1 断言③
     *     走 skip 分支，台账判 0 次；
     *   · 单跑那轮：同一窗口差异 **26080** ≫ 800 ⇒ R1 断言③ 真判过并通过，台账 1 次。
     * 若外层门写成「逐行 AND，判 0 次即判红」，就会把**内容形态造成的不可判定**
     * 报成**产品回归**，得到一个随机红的发版门——比它要堵的洞更糟。
     * 故按**三态**记账：
     *   judged  = 断言真跑了并给出通过/不通过的判定；
     *   skipped = 断言显式 `t.skip()` 声明「本形态不可判定」并带原因；
     *   两者皆 0 = **既没判定也没声明** ⇒ 判红。⚠️ 但这**不唯一**指向 `return`：
     *   见 `support/releaseGate.ts` 的 `buildGateFailureMessage`——它并列三类成因
     *   （① 被写回 return / ② 该 test
     *   本轮没跑 / ③ 该行自己的断言真失败）——那条消息才是判红时读者唯一能看到的
     *   诊断物。⚠️ 这里**不编号复述**那三类：复述即漂移源，本轮已经漂过一次。
     *   ⚠️ 更细一层的「`-t` 把 suite 内全部 test 滤掉 ⇒ 门整个消失」**不属此类**
     *   （那时 afterAll 都不执行，台账对象不存在），已记在
     *   `docs/specs/qa-defense-lines.md` 的「不可判定」口径**第三类**。
     * skipped 的情形不判红，但会 `console.warn` 高亮「本轮未验证」，且 vitest 已把该
     * test 记为 **skipped**（不是 passed），信息不丢失、也不冒充通过。
     *
     * 计数对象只含**内容断言**（spec §3.T2 承诺的那些帧对比）：
     * R1 断言③「锚点卡下方区域」帧差、R3「收藏行」两两不同。这四行之外的断言形态各不相同，
     * 都不是「显式 skip」，故一律不进本台账：
     *   · R1 断言①：判别窗无判别力时 `console.log` 声明不可判定 + 置 `notTopJudged = false`
     *     后**继续**（不判红，由断言② 兜底）；
     *   · R1 断言②：**没有**不可判定分支，裸无条件 `expect`（失败即红）；
     *   · R1 断言③：`t.skip()`（R1 的 `it` 回调有 `t` 形参）；
     *   · R2 三条：R2 的 `it` 回调签名是 `async () => {}`、**没有 `t` 形参**，用不了 `t.skip()`；
     *     其 `console.log` 是**抛错前的诊断日志**，不是「声明不可判定」。
     */
    const coreOutcome = {
      // R1 断言③ 是**单次**判定（不给 expected ⇒ 不做覆盖率判定）
      r1: { judged: 0, skipped: 0 },
      // R3 收藏行是**三对两两不同** = 3 次子判定，故带 expected：
      // 采样窗可能只让部分对可判定，另几对被 `continue` 吞掉且**不写台账**。
      // 缺 expected 时「1/3 覆盖」既不判红也不 warn ⇒ 门完全静默（#819 第 11 轮 review）。
      r3: { judged: 0, skipped: 0, expected: 0 },
    };

    beforeAll(async () => {
      const token = process.env.PIXIV_REFRESH_TOKEN ?? "";
      expect(token.length).toBeGreaterThan(0);
      assertDeepLinkHookPresent();

      ctx = await setupAndroidE2e(TARGET_AVD);
      serial = ctx.serial;
      assertDeviceGeometry(serial);

      // 登录：setupAndroidE2e 的 pm clear 清掉了 Keystore 里的 token，只能真实登录。
      // 单引擎布局下走 LynxActivity 的 dev intent hook（prefs.loginViaDevIntent），
      // 不再需要 webview 登录页注入——webview 客户端已随 #610 移除。
      forceStopApp(serial);
      startMainActivity(serial);
      await waitForTopActivity(LYNX_ACTIVITY);
      await loginViaDevIntent(serial);
    }, 900_000);

    afterAll(async () => {
      // 收尾（teardown / forceStop）与外层门的**执行时序**由 `runReleaseGate` 统一承担：
      // 它保证「收尾出错 / serial 尚未赋值」只影响收尾本身，**判定永远执行**。
      // ⚠️ 曾在此处写 `if (!serial) return;` —— 因 `serial` 初值 `""` 且 beforeAll 前三步
      // 失败时它还没被赋值，那句 early return 会让外层门整段不执行（不判红、不 warn）。
      // 见 `tests/android-e2e/support/releaseGate.ts` 的说明与对应单测。
      //
      // ── 外层门：只堵「既没判定也没声明」这条回潮路径（#819 二次订正）────────
      //
      // ⚠️ 首版（求和 `r1Injected + r3BookmarkPairs > 0`）**太弱**：R1 单独不可判定时，
      //   只要 R3 判过一对就满足 ⇒ 门照样绿。R1 行承诺的就是「相关作品」段注入，
      //   R3 判过并不能替它背书。求和 = 允许「A 行没验、B 行验了」蒙混过关。
      // ⚠️ 二版（逐行 AND，判 0 次即红）**太强**：把「内容形态导致的不可判定」
      //   报成产品回归，得到一个随机红的发版门（实测同代码两跑：一轮 skip 一轮通过）。
      // 三版（当前）：按三态记账——`judged===0 && skipped===0` 才判红，
      //   该条件**主要**指向「直接 return、既不判定也不 skip」，正是首版要堵的洞；
      //   但**不是唯一成因**——「该 test 本轮没跑」同样停在双 0（beforeAll 失败 /
      //   前面断言抛错 / 超时；`-t` 只滤掉本 test 时也属此列）。故报错文案并列
      //   报错文案并列多类成因，不替读者猜（清单与措辞见 buildGateFailureMessage）。
      //   ⚠️ 与上方 JSDoc 的「第三类」分界：`-t` 把 suite 内**全部** test 滤光时
      //   门整个消失、根本进不到这里（那不是双 0，是无台账）。
      //   显式 skip 的行不判红，但 warn 高亮「本轮未验证」，且 vitest 已记 skipped。
      //
      // 反事实检验（务必保留）：把 R1 断言③ / R3 收藏行对的 skip 分支改回 `return`，
      // `skipped` 与 `judged` 双 0 ⇒ 本断言立刻转红——回潮路径被堵死。
      // 该检验现有**两个入口**：本行的设备级（贵，要模拟器）与
      // `tests/android-e2e/unit/releaseGate.test.ts` 的纯函数级（秒级，随 CI 跑）。
      // 日常改判定语义请走后者；前者留给发版前首跑。
      const rows: OutcomeRow[] = [
        // ⚠️ 行名按**代理口径**表述，不写成「相关作品段注入」：该断言判的是
        // 「锚点卡下方区域帧差 > INJECT_TH」，不区分变化来源（qa-defense-lines §3.T2
        // 「帧对比代理」）。判红时读者只见这行名，写成渲染物名会把他引向错误的
        // 产品改动——#814→#816 连续三轮正是这个坑。
        ["R1 断言③ 锚点卡下方区域帧差 > INJECT_TH（代理「相关作品」段注入）", coreOutcome.r1],
        ["R3「收藏行」两两不同", coreOutcome.r3],
      ];
      await runReleaseGate({
        teardown: async () => {
          await ctx?.teardown();
        },
        forceStop: forceStopApp,
        serial,
        rows,
        warn: (message) => console.warn(message),
        // 判红：expect 抛错即失败，与改造前 `expect(silent, msg).toEqual([])` 等价
        fail: (silent, message) => expect(silent, message).toEqual([]),
      });
    });

    it("R1 lynx /illusts：点中部卡片进详情 → 系统返回 → 锚点卡下方区域出现帧差（代理「相关作品」段注入）+ 滚动不回顶", async (t) => {
      // 深链到 /illusts（benchNav illust），等列表内容渲染完成
      await launchBenchNav("illust");
      await waitForContentLoaded("r1-illusts", REGION_TOPREF, 25);
      const topRef = await waitForStableFrame("r1-top", REGION_TOPREF);

      // 下滑约一屏（进入列表中部），取滚动基线帧 S1
      swipe(...SWIPE_SCROLL_UP);
      const s1 = await waitForStableFrame("r1-scrolled", REGION_TOPREF, 20_000);

      // 逐候选点点击中部卡片，直到确认离开列表（**全屏**帧大变化 = 进入详情）。
      // 全屏判定（三跑教训）：列表区局域判定会漏——详情页骨架与列表局部可能低差异。
      const FULL_FRAME: Region = { x0: 0, y0: 0, x1: 1080, y1: 2088 };
      let tapPoint = { x: 0, y: 0 };
      let opened = false;
      for (const pos of CARD_TAP_CANDIDATES) {
        const before = await screenshot("r1-before-tap");
        tap(pos.x, pos.y);
        await SLEEP(2_500);
        const after = await screenshot("r1-after-tap");
        if ((await diffRegion(before, after, FULL_FRAME)) > CHANGE_TH) {
          opened = true;
          tapPoint = pos;
          console.log(`[transition-matrix] ✓ 进详情命中点位 (${pos.x},${pos.y})`);
          break;
        }
        // 未导航：可能是 ♥ 行/卡间空隙（点击无效或仅切收藏）→ 继续下一点位
        pressBack(); // 若上一点位其实触发了收藏动效等无导航副作用，回退无副作用
        await SLEEP(600);
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

      // ── 断言① 未回顶（#816 二次订正）：判据窗必须**排除注入段** ──────────
      // 首版与 topRef（深链后的首帧）比。缺陷：深链后首帧**常常尚未加载完**
      // （榜单卡 + 骨架），返回帧是完整首屏 ⇒ 两者天然差异大 ⇒ 代理失效。
      // 实测踩中假绿：列表实际**已回到顶部**（锚点卡在第 2 屏、注入段不可见），
      // 旧断言仍「通过」（notTop > 2000）。
      // 二版（34df4489）改与**下滑基线 s1** 比——方向正确，但**窗选错了**：
      //   本轮 R1 红在 9358，现场取证（stable-r1-returned.png 的 y1650..2016 裁图）：
      //   返回帧里锚点卡「方方土 ♥5823」下方多出 **「相关作品 / 收起」** 注入段，
      //   其下卡片整体下推约 166px；而判据窗 REGION_TOPREF（y1200..2016）**正好含这块**。
      //   逐段复算：y1150..1400=131、y1400..1600=102、y1600..1800=55、**y1800..2016=9095**
      //   （占 9358 的 97%）；纵向配准最佳对齐 **dy=0**（±10px 即涨到 29289）⇒ **不是滚动位移**。
      //   旁证：`top vs returned = 124964` ≫ 阈值 ⇒ 列表确实**没有回顶**（此前那次
      //   「疑似 KeepAlive 回顶」告警是误判，订正维持）。
      // 三版：窗停在**锚点行以上**——注入段渲染在锚点卡下方，不可能出现在该窗内。
      //   收窄后判别力实测未损（top↔scrolled）：y1200..1720 = **105,158**（阈值 2000 的 53 倍）；
      //   纯净度（scrolled↔returned）由 9358 降到 **263**。判别力未降、污染已除。
      const notTopWindow = notTopRegion(tapPoint.y);
      const notTop = await diffRegion(s2, s1, notTopWindow);
      const vsTopRef = await diffRegion(s2, topRef, REGION_TOPREF);
      let notTopJudged = false;
      // 判别力自检：窗太窄/内容不随滚动变化时，「真回顶」在该窗内未必有差异 ⇒ 判据失效。
      // 此时**显式 skip**，不拿一个无判别力的窗去判红（与断言③ 同一纪律）。
      const notTopPower = await diffRegion(s1, topRef, notTopWindow);
      const notTopVerdict = judgeNotTopWindow({
        window: notTopWindow,
        power: notTopPower,
        minPower: NOT_TOP_TH,
      });
      if (notTopVerdict.verdict === "indeterminate") {
        notTopJudged = false;
        console.log(
          `[transition-matrix] ⏭ R1 断言①不可判定，已跳过（${notTopVerdict.reason}）：判别窗 ` +
            `y${notTopWindow.y0}..${notTopWindow.y1}（高 ${notTopWindow.y1 - notTopWindow.y0}px），` +
            `窗内 top↔scrolled 判别力 ${notTopPower} ≤ ${NOT_TOP_TH} ⇒ 该窗分不出「顶部」与「下滑」。` +
            `锚点卡过靠上时该窗必然退化——**不判为「回顶回归」**，滚动保持由断言② 兜底`,
        );
      } else {
        notTopJudged = true;
        expect(
          notTop,
          `返回后应停留在下滑后的滚动位置而非列表顶部（判别窗 y${notTopWindow.y0}..` +
            `${notTopWindow.y1}，与下滑基线 s1 差异 ${notTop} 应 ≤ ${NOT_TOP_TH}）。` +
            `附：整窗 topRef 差异 ${vsTopRef}、窗内判别力 ${notTopPower}` +
            `（均远大于阈值 = 「不是顶部」这一侧证据充分）`,
        ).toBeLessThanOrEqual(NOT_TOP_TH);
      }

      // 断言② 滚动保持：锚点卡上方区域与进详情前逐像素一致（同卡同偏移）
      const above: Region = { x0: 0, y0: 400, x1: 1080, y1: Math.max(420, tapPoint.y - 80) };
      const preserved = await diffRegion(s1, s2, above);
      const preservedRatio = preserved / geomRegionSamples(above);
      expect(
        preservedRatio,
        `锚点上方区域应保持原内容（差异占比 ${preservedRatio.toFixed(4)} 应 ≤ ${PRESERVE_RATIO}）——` +
          `超限意味列表被重置/重排（滚动位置丢失回归）`,
      ).toBeLessThanOrEqual(PRESERVE_RATIO);

      // 断言③「相关作品」段注入（relatedRowFor 渲染物）：锚点卡下方区域内容变化
      //   （段以 list-item 内部展开段插入，把该列后续卡片整体下移 → 帧差异集中落在本区域）
      // ⚠️ #814 订正：y1 由 2100 钳到 CONTENT_BOTTOM。2100 已越过内容区底界 2016，
      //   靠底部的一段恒落在系统栏/手势条上——那部分像素任意两帧都相同，按比例稀释差异。
      //   实测证据：tapY=1250→差异 444（0.2%），越界越多稀释越狠，tapY=1950 时窗几乎全在
      //   界外 → 差异直接归 0。夹住后窗内全部是真实内容像素。
      // ── 断言③「相关作品」段注入（#816 订正）：不可判定时**显式 skip** ──────
      // 实测真因（可观测性日志坐实）：consumeAnchor 报「注入完成 items=20」
      // ⇒ 状态机正常、数据已注入，但返回后**列表回到顶部**，锚点卡在第 2 屏
      // **屏幕之外** ⇒ 注入段（卡内子节点）随之不可见 ⇒ 采样窗取不到内容。
      // 此时差异低是**采样对象不存在**，不是「注入段未渲染」；文案若仍写
      // 「渲染缝回归」会把人引向错误的产品改动（#814 → #816 连续三轮都是这个坑）。
      // ⚠️ y1 由 2100 钳到 CONTENT_BOTTOM（#814）：越界段恒落在系统栏死像素上。
      const below: Region = belowAnchorRegion(tapPoint.y, CONTENT_BOTTOM);
      const injected = await diffRegion(s1, s2, below);
      const belowSamples = geomRegionSamples(below);
      if (injected <= INJECT_TH) {
        // ⚠️ #819：此处曾是 `return` —— vitest 记 **passed**，发版门对 ADR-0162
        // 「相关作品」段注入回归彻底失效，且下方「✓ R1 通过」日志会宣称验证了
        // 实际未验证的事。改为 `t.skip()`：报 skipped 而非 passed，诚实。
        // 同时记 skipped（区别于「既没判定也没声明」），供 afterAll 外层门区分二者。
        //
        // ⚠️ skip 文案里的成因**必须按本轮 logcat 分支**，不能无条件断言
        // 「数据已到位」：#819 第 11 轮 review 实测，本轮 logcat 根本没有
        // 「注入完成」行（logcat 是 2 MiB 环形 buffer，Lynx 逐帧日志会把它挤掉），
        // 而 skip 消息仍在陈述那条因果——**在唯一告诉人「本轮未验证」的消息里塞一个
        // 本轮没验的诊断**，与门级「并列多类成因」是同一个错。
        //
        // ⚠️ 取证调用**必须容错**（#819 第 12 轮 review）：`logcatTailByPid` 底层
        // `runCapture` 在 spawnSync 出错时**抛**，`TIMEOUTS.adb = 30s`。若让异常逃出
        // `it`，本例记 **failed**（不是 skipped）⇒ 台账停在双 0 ⇒ 外层门**再判红一次**，
        // 而判红文案 ① 写的是「该行被写回 return」——把读者引向错误的修法
        // （正是 `releaseGate.ts` 判红文案并列多类成因所防的那件事）。
        // 故：抛错**必须单列第三态**并 warn；**保持在记账之前**，
        // 否则会撞接线契约「记账下一条可执行语句必须是 t.skip(」的不变式。
        //
        // ⚠️ 上一轮只做到「不抛」，却把第三态并回了第二态：catch 里置 `false` 后
        // 落进「未检出」分支——而抛错路径上 logcat **根本没读成功**，「未检出」是假陈述。
        // skip 消息是 vitest 持久化、判红时读者**唯一能回看**的那条（warn 谁也不会回头看），
        // 所以三态必须在消息里分开说。
        let injectedLog: boolean | undefined;
        let logcatErr = "";
        try {
          injectedLog = /注入完成/u.test(logcatTailByPid());
        } catch (err) {
          logcatErr = String(err).slice(0, 120);
          console.warn(
            `[transition-matrix] ⚠️ 取证失败：读 app logcat 抛错（${logcatErr}）` +
              `⇒ 本轮「注入完成」**未知**（既非已检出也非未检出），skip 消息按「读取失败」分支表述`,
          );
        }
        coreOutcome.r1.skipped += 1;
        t.skip(
          `R1 断言③不可判定：锚点卡下方区域帧差 ${injected} ≤ ${INJECT_TH}。` +
            `采样窗 y ${below.y0}..${below.y1}、采样点 ${belowSamples}；` +
            `锚点上方保持率 ${preservedRatio.toFixed(4)}，返回帧与 s1 差异 ${notTop}` +
            `${notTopJudged ? "（断言①亦不可判定）" : ""}。` +
            `两种候选成因，**不替读者猜是哪种**：① 锚点卡不在视口内；` +
            `② 该内容形态不产生卡内展开段。` +
            (injectedLog === undefined
              ? `本轮 logcat **读取失败**（${logcatErr}）⇒「注入完成」状态**未知**` +
                `（既非已检出也非未检出）；成因本轮未取证，**不要据此改产品**。`
              : injectedLog
                ? `本轮 logcat 检出「注入完成」——**这只说明数据已到位**；` +
                  `**不据此断定差异低的原因**（候选成因 ②「无卡内展开段」与该日志同样兼容）。`
                : `本轮 logcat **未**检出「注入完成」⇒ 成因本轮未取证（环形 buffer 会滚，` +
                  `2 MiB、Lynx ~60fps 逐帧日志）；**不要据此改产品**。`),
        );
      }
      coreOutcome.r1.judged += 1;
      console.log(
        `[transition-matrix] ✓ R1 通过：` +
          `${notTopJudged ? `未回顶（与 s1 差异 ${notTop} ≤ ${NOT_TOP_TH}）` : "断言①不可判定（未回顶未判）"}` +
          ` + 滚动保持 + 锚点卡下方区域帧差 ${injected} > ${INJECT_TH}` +
          `（代理「相关作品」段注入，不区分变化来源；证据 r1-*.png）`,
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
      const menuRegion: Region = { x0: 500, y0: 1400, x1: 1000, y1: 2050 };
      // 双判据（首跑教训：只看「画面变过」会被「FAB 环收起」假通过 → 后续输入落空 →
      // 误触榜单卡）：①FAB 环区域有变化（环收起）；②sheet 面板语义带变亮（实测：
      // 输入行带 y620-790 由 95→237、scope 行带 y800-960 由 93→250，面板恒亮 ≥230）
      expect(
        await diffRegion(afterFab, afterSearchItem, menuRegion),
        "点击内环搜索项后放射菜单未收起（证据 r2-search-sheet.png）",
      ).toBeGreaterThan(CHANGE_TH);
      const sheetBandInput: Region = { x0: 100, y0: 620, x1: 980, y1: 790 };
      const sheetBandScope: Region = { x0: 100, y0: 800, x1: 980, y1: 960 };
      const bInput = await avgBrightness(afterSearchItem, sheetBandInput);
      const bScope = await avgBrightness(afterSearchItem, sheetBandScope);
      if (bInput > 180 && bScope > 180) {
        // 面板已打开 → 亮度判据通过，继续输入流程
      } else {
        // ⚠️ #816 订正：先判「面板是否出现」，未出现时**报网络层失败**而非布局回归。
        // 实测（2026-09-28 20:01，本轮唯一红项）：输入行带亮度 150、scope 行带 131，
        // 逐行扫描显示 y=1400 以下**整片纯白 251** ⇒ SearchSheet 浅色面板压根没出现，
        // 150/131 是**列表页残留内容**（榜单卡 + 空网格），不是「半亮的打开中态」。
        // 同一帧另有红字「未知错误」= client.ts classifyError 的 status<=0 兜底
        // ⇒ **网络层无响应**（老问题，见 #802 模拟器内图片 CDN 9–11s/张）。
        // 旧文案「SearchSheet 未打开」会把网络问题误导成布局/坐标回归，
        // 导致后续照文案去调 FAB 坐标——那正是 ab026592 反复白跑的原因。
        const belowSheet: Region = { x0: 0, y0: 1400, x1: 1080, y1: CONTENT_BOTTOM };
        const blankness = await avgBrightness(afterSearchItem, belowSheet);
        console.log(
          `[transition-matrix] R2 面板未出现：输入行带 ${bInput.toFixed(0)}、scope 行带 ` +
            `${bScope.toFixed(0)}（应 ≥180）；面板区 y1400..${CONTENT_BOTTOM} 平均亮度 ` +
            `${blankness.toFixed(0)}（≈251 即整片纯白 = 列表空白区，非面板）`,
        );
        throw new Error(
          `SearchSheet 未打开，且画面呈「列表空白 + 未知错误」形态 —— ` +
            `面板区 y1400..${CONTENT_BOTTOM} 平均亮度 ${blankness.toFixed(0)}（纯白即面板未出现）。` +
            `实测该形态伴随「未知错误」红字，对应 client.ts classifyError 的 status<=0 兜底` +
            `= **网络层无响应**（非 HTTP 错误码）。` +
            `请先确认网络/登录态（见 #802 模拟器内图片 CDN 9–11s/张），` +
            `**不要**据本条去调 FAB 坐标或面板高度——那是布局回归的方向，且已证伪。` +
            `证据 r2-search-sheet.png`,
        );
      }

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

      // 滚动 + 翻页推进检测（有界判据；四跑定版）：
      // 判据 = 「连续 10 次上滑内，底部带（REGION_RESULTS_BOTTOM）每次都有新内容进入」
      //        （diff > STABLE_TH）且全程无失败横幅。
      // 为什么这样判（历次教训累积）：
      // - 度量域必须是底部带：整结果区会被列表中部懒加载缩略图持续扰动 → 永远测不到「无推进」；
      // - 不能要求「测到绝对底部」：搜索词 original 结果多达 30+ 屏（四跑 30 次滑动仍未到底），
      //   该判据不适定。翻页失效（loadMore 回归）的现场签名是「列表钉死在当前页末 + 红字横幅」，
      //   此时 10 次滑动内必然出现底部带停滞（无新内容进入）→ 本判据转红；
      // - 数据依赖告警（同 R3 同值 caveat 性质）：若某日 original 结果总数不足 10 屏，
      //   会在结果末尾停滞而误红——换更宽的搜索词复跑即可。
      const SCROLL_STEPS = 10;
      let last = f1;
      let stallAt: number | null = null;
      for (let i = 0; i < SCROLL_STEPS; i++) {
        swipe(...SWIPE_RESULTS_UP);
        await SLEEP(1_600);
        const cur = screenshot(`r2-scroll-${i}`);
        const moved = await diffRegion(last, cur, REGION_RESULTS_BOTTOM);
        if (moved <= STABLE_TH && stallAt === null) stallAt = i; // 底部带无新内容进入 = 停滞
        last = cur;
      }
      expect(
        stallAt,
        `第 ${stallAt} 次上滑后结果底部带停止更新（列表未再增长 = 翻页追加失效 / 已到底；` +
          `证据 r2-scroll-*.png。若确为结果不足 10 屏的正常到底，换更宽搜索词复跑）`,
      ).toBeNull();

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

    it("R3 lynx 推荐轮播：滑动换卡 ≥2 次 → 图片区前进 + 收藏行帧两两不同", async (t) => {
      await launchBenchNav("carousel");
      await waitForContentLoaded("r3-recommended", REGION_CAROUSEL_IMAGE, 25);
      const c0 = await waitForStableFrame("r3-card0", REGION_CAROUSEL_IMAGE);
      // 帧证据落盘（首跑教训：waitForStableFrame 不写盘，失败时无从取证 → 显式 screenshot）
      await screenshot("r3-card0");

      // 换卡 ×2：每次断言图片区内容前进（index 变化）
      const frames: Buffer[] = [c0];
      for (let i = 1; i <= 2; i++) {
        swipe(...SWIPE_CAROUSEL_NEXT);
        const ci = await waitForStableFrame(`r3-card${i}`, REGION_CAROUSEL_IMAGE, 20_000);
        await screenshot(`r3-card${i}`);
        const moved = await diffRegion(frames[i - 1], ci, REGION_CAROUSEL_IMAGE);
        expect(
          moved,
          `第 ${i} 次滑动后封面图区未变化（换卡失败/吸附回归，差异 ${moved} 应 > ${CHANGE_TH}）`,
        ).toBeGreaterThan(CHANGE_TH);
        frames.push(ci);
      }

      // 收藏行窗口两两不同（spec「收藏数两两不同（对比帧文本）」）：C 类 props 冻结缺陷
      // （BookmarkButton 轮播宿主不 remount → 收藏数恒定首卡值）的帧证据——冻结时三帧该窗口恒等。
      // 度量用 diffRegionLoose（半透明灰字低对比，逐通道 >24 恒返 0——首跑+二跑 R3 失败实因：
      // 收藏数确实 1168→33 变化，但标准度量读不出）；阈值取实测余量（真变化 ≈150，冻结 = 0）。
      //
      // ⚠️ 2026-09-28 #814 订正：窗**不再硬编码**，改为逐帧运行时探测（见上方说明①）。
      // 原窗 x 43..430 会切掉收藏数字（胶囊横跨全宽 x 0..1078），导致 card1 vs card2 读出
      // 恒等 0 而被误报为「props 冻结」——实测同窗下 card0 vs card1 = 50 能过，
      // 说明不是状态冻结，是采样窗没盖住被测对象。
      const BOOKMARK_LOOSE_TH = 20;
      // 逐帧探测收藏行：任一帧探测不到 → 显式 skip（内容形态不符），不 fail 成「冻结回归」
      const rowSpans: ({ y0: number; y1: number } | null)[] = [];
      for (const f of frames) {
        rowSpans.push(detectBookmarkRowOnFrame(await toPixels(f), REGION_BOOKMARK_SCAN));
      }
      const undetected = rowSpans.map((s, i) => (s ? null : `card${i}`)).filter(Boolean);
      if (undetected.length > 0) {
        // ⚠️ #819：此处曾是 `return` —— vitest 记 **passed**，init-only props
        // （收藏数冻结在首卡）这条 C 类缺陷的帧证据防线形同虚设。改 t.skip()。
        // 记账必须在 t.skip() **之前**：`t.skip()` 是 throw（vitest
        // run.C5UmxDPh.js:3362 抛 PendingError 中止执行），放在其后不可达 ⇒
        // 台账双 0 会被外层门误报成「return 回潮」并判红。
        coreOutcome.r3.skipped += 1;
        t.skip(
          `R3 收藏行断言不可判定：${undetected.join(",")} 帧未探测到深色收藏胶囊` +
            `（内容形态不符，如非推荐流卡片）；不据此判定「props 冻结」。` +
            `换卡 ×2 的图片区前进断言已判定（见上），但内容断言无判定 ⇒ 记 skipped 不记 judged。`,
        );
      }
      let judgedPairs = 0;
      let skippedPairs = 0;
      for (let a = 0; a < frames.length; a++) {
        for (let b = a + 1; b < frames.length; b++) {
          // 以被测对象（较深的一帧）为准取窗：两帧布局一致时窗相同；不一致时取交集避免漏采样
          const row: Region = bookmarkSampleRegion(rowSpans[a]!, rowSpans[b]!, CONTENT_RIGHT);
          const d = await diffRegionLoose(frames[a]!, frames[b]!, row);
          const verdict = judgeBookmarkRow(row, d, BOOKMARK_LOOSE_TH, MIN_BOOKMARK_SAMPLES);
          // 窗未覆盖任何实质内容 ⇒ 差异 0 不可信（防「蒙对」：不能把采样失误当成状态冻结）
          if (verdict.verdict === "skip") {
            skippedPairs += 1;
            console.log(`[transition-matrix] ⏭ R3 跳过第 ${a + 1}/${b + 1} 对：${verdict.reason}`);
            continue;
          }
          judgedPairs += 1;
          expect(
            d,
            `第 ${a + 1} 与第 ${b + 1} 张卡的收藏行窗口内容相同（低对比差异 ${d} 应 > ${BOOKMARK_LOOSE_TH}；` +
              `恒等 = 收藏数/收藏态冻结在首卡，BookmarkButton init-only props 宿主契约回归。` +
              `采样窗 y ${row.y0}..${row.y1} × x ${row.x0}..${row.x1}）`,
          ).toBeGreaterThan(verdict.expected);
        }
      }
      // ⚠️ #819：三对全被 `continue` 吞掉时旧代码照样打「✓ R3 通过：…收藏行三帧两两不同」——
      // 日志宣称验证了实际未验证的事。零判定 ⇒ skip 而非绿。
      if (judgedPairs === 0) {
        coreOutcome.r3.skipped += 1;
        t.skip(
          `R3 收藏行三帧两两不同：${skippedPairs} 对全部因采样窗无实质内容而不可判定` +
            `（不得据此判定「props 冻结」，也不得视为通过）`,
        );
      }
      coreOutcome.r3.judged += judgedPairs;
      // 记本轮应有几次子判定（帧数组合对），供外层门做覆盖率判定：
      // 「1/3 覆盖」必须落进 warn（未验证），否则门静默而日志只报「跳过 N 对」。
      coreOutcome.r3.expected = (frames.length * (frames.length - 1)) / 2;
      console.log(
        `[transition-matrix] ✓ R3 通过：换卡 ×2 + 收藏行三帧两两不同` +
          `（实质判定 ${judgedPairs} 对 / 跳过 ${skippedPairs} 对，证据 r3-card*.png）`,
      );
    }, 240_000);
  },
);

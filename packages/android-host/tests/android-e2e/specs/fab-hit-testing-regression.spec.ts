/**
 * ADR-0123 回归：lynx 客户端「页面点击恢复」（全屏 pointer-events 容器吞触摸修复）。
 *
 * 背景（诊断证据）：修复前 GlobalFab.vue 根容器为 `absolute inset-0 z-40 pointer-events-none`
 * 全屏透明层；原生 LynxView hit-testing 不识别 pointer-events（lynx 4.0.1 实测），
 * 关闭态该层吞掉页面全部点击——仅 FAB 可点。修复 = 遮罩/环层 `v-if="view.isOpen"` 条件渲染 +
 * 外层 (0,0) 零尺寸盒锚点，关闭态渲染树无全屏元素（单测负向断言已锁模板结构）。
 *
 * 本 spec 用「Me 页『我的收藏』行点击 → 导航到 /bookmarks」作确定性探针（离线可点）：
 * - 修复前：页面点击被全屏容器吞掉 → 0 像素变化（红）
 * - 修复后：行点击导航 → 屏幕大变化（绿）
 * 并做 FAB 控制组（FAB 点击应始终有反应，证明应用未假死且坐标基线正确）。
 *
 * ── 登录策略（单引擎化 #610 后重写）──────────────────────────────────────
 * 旧实现的「Lynx 侧 adb 盲打登录」（uiautomator 定位输入框 + `input text` 键入 token）
 * 不可靠：`adb shell input text` 会截断/吞字符长 token（实测只落 43 字符，refresh_token
 * 实际 ~100+），歪 token 发不出有效请求。
 * 更靠后的「webview 侧登录 → 跨引擎共享 WSSecureStorage」也随单引擎化一并失效：
 * APK 内已无 WebView ⇒ Appium 永远等不到 WEBVIEW context，登录页在运行时不存在。
 * 故改走原生 dev intent hook（prefs.loginViaDevIntent，实机已验证）：
 * `am start -n io.pictelio.app/.LynxActivity --es pictelio_dev_refresh_token <token>`
 * → LynxActivity.applyDevIntentHooks() 调 autoLoginWithRefreshToken 持久化并登录
 * （门禁 BuildConfig.DEBUG，只有 debug 包有该钩子）。当前阶段划分：
 * - 阶段 A（dev hook 登录）：setup 已 pm clear，Keystore 里没有 token，必须真实登录；
 * - 阶段 B（干净重启）：force-stop → 清 logcat → 启动 → LynxActivity 前台 →
 *   渲染就绪（logcat `onPageChanged|OnPatchFinishForFiber`，T7 口径，60s 独立超时，
 *   超时附 logcat 尾部 50 行）；
 * - 阶段 C（登录态确认）：uiautomator dump 不再出现登录页 EditText（登录页唯一表单
 *   元素；已登录 /recommended 无输入框）+ LynxActivity 保持前台，60s 超时；dump 不可用
 *   时 warn 跳过软校验（Lynx a11y 树空是已知 SDK 限制），漏判由 FAB 控制组用例兜底
 *   （登录页无 FAB 必红）。
 *
 * ── AVD 迁移：pictelio_low → pictelio_ui ──────────────────────────────────
 * 本用例的**剩余**坐标常量（`FAB_TAP` / `BOOKMARKS_ROW_TAP` / `SCRIM_CLOSE_TAP`）
 * 是按 pictelio_ui（android-34，1080×2160 / density 480）的 vw 几何静态推导的，
 * 换设备会静默失准（点空 → 假绿/假红）。故缺省 pin 到 pictelio_ui，并显式
 * ANDROID_E2E_AVD=pictelio_low 时整文件 skip（beforeAll 的 assertDeviceGeometry
 * 也会按分辨率/密度兜底）。**不可因为「不再需要 WebView」就放开到 pictelio_low。**
 *
 * ⚠️ **#1047 起 FAB 圆心不再来自常量**：`FAB_TAP` 已降级为**对照**（树给的圆心与它
 *   差 >8px ⇒ **告警**，提示 vw 推算口径该重新校准；且**不替读者猜成因**），
 *   实际点击用的是**运行时 UI 树给出的真实盒子**算出的圆心；
 *   外环「我的」项的 y 跟随树给的圆心（`ME_RING_TAP` 这个标识符已随之消失）。
 *   仍由常量决定的只剩 `BOOKMARKS_ROW_TAP`（Me 页那行的真实文本/层级**未取证**，
 *   按文本定位会误伤，故本轮不改——理由已登记在 #1047）与 `SCRIM_CLOSE_TAP`。
 *
 * 纯 adb 驱动（仿 lynx-boot-renders.spec.ts 轻量模式；登录走 am start hook，无需
 * Appium webview context）。用例本体坐标常量推导式见常量注释；
 * 模型经旧 pictelio_low 常量校准——用同一公式反推 720×1280/320 可逐像素复现
 * 旧值 (635,1195)/(384,1187)，误差 ≤1px；beforeAll 校验分辨率防 AVD 漂移）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { assertDeviceGeometry as assertGeometry, screenshot as shoot } from "../pixel";
import {
  currentTopActivity,
  forceStopApp,
  loginViaDevIntent,
  readAppLogcat,
  startMainActivity,
} from "../prefs";
import { adbPath, LYNX_ACTIVITY, REPO_ROOT, runCapture, runOrThrow } from "../env";
import { assertFabTree, captureUiTree, fabCenter, type UiTreeNode } from "../ui-tree";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";
import { CONTENT_BOTTOM, CONTENT_RIGHT, fabCenterPx, roundPx } from "../transition-geometry";
import { createCanvas, loadImage } from "canvas";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * AVD pin（坐标常量绑定 pictelio_ui，防「跑错设备」静默失准）：
 * - 缺省 pin 到 pictelio_ui（1080×2160 / density 480，与坐标推导式同源）；
 *   用 || 而非 ??：空字符串（CI 里 ANDROID_E2E_AVD= 的常见形态）会绕过 ??
 *   但不该绕过本缺省；
 * - 非 pictelio_ui（含 pictelio_low）时整文件 skip：坐标常量在其他分辨率/密度下
 *   点空或点偏，表现为无意义的假红/假绿；**不得因「不再需要 WebView」而放开
 *   pictelio_low**。beforeAll 的 assertDeviceGeometry 是第二道防线。
 */
const TARGET_AVD = process.env.ANDROID_E2E_AVD || "pictelio_ui";
const SKIPPED = TARGET_AVD !== "pictelio_ui";
const SKIP_REASON =
  "本用例的固定坐标常量绑定 pictelio_ui（1080×2160 / density 480，见 assertDeviceGeometry）；" +
  `当前 ANDROID_E2E_AVD=${TARGET_AVD}，坐标会静默失准，已整文件跳过。` +
  "请在 pictelio_ui 运行（缺省即 pictelio_ui）";
if (SKIPPED) {
  console.log(`[fab] SKIP: ${SKIP_REASON}`);
}

// ── 坐标（AVD pictelio_ui：物理 1080×2160，density 480，1vw = 10.8px）──
//
// ⚠️ #819 **坐标系口径订正**：本块原按 **H_vw = (2160 - 72) / 1080 × 100 ≈ 193.33**
// （= 全屏高减去顶部状态栏）推导，于是 FAB_TAP.y = 2033、ME_RING_TAP.y = 2020。
// 但 ADR-0131 的 `screenHeightVw` 在 `contentSize` 命中时返回的是**稳定区**高度，
// 而稳定区**两端**都扣了系统栏——`dumpsys window displays` 实测
// `app=1080x2088 rng=1080x936-2160x2016` ⇒ 底界 **2016**（顶部 72 状态栏 +
// 底部 72 手势条，共 144px）。
// 结果：点 (953, 2033) 落在**手势条**上，FAB 根本不响应；断言只看到一个
// 「差异 8」的裸数字（其余全是状态栏时钟 + Lynx debug 触摸标记的红点）。
//
// 现复用 `transition-geometry` 的推导（与 transition-matrix.spec.ts **同一份事实源**，
// 且有单测钉住），FAB 圆心 = (953, 1889)：
//   oracle（2026-09-29 实测帧 test-results/android-e2e/fab-probe/fab-open.png，
//   在 (953,1889) 轻点即展开）：主 FAB 亮簇 bbox x872..1033 / y1808..1969
//   ⇒ 该**闭区间**的中点 (952.5, 1888.5)。与 `fabCenterPx(2016, 1080)` 推导值
//   (953.3, 1889.3) 差 ≤0.8px；该 bbox 也与 `transition-geometry.fabCenterPx`
//   注释里早已记录的 `r2-after-fab.png` 口径（x872..1032 / y1808..1968）独立吻合。
//
// ⚠️ **两种中心口径，别混着看**（#1047 review 第 2 轮 Standards 轴 N5）：
//   · **闭区间中点** (952.5, 1888.5) = 上面的像素扫描 bbox 两端取平均——
//     亮簇是「离散像素集合」，两端像素各占半像素，中心落在两个像素之间。
//   · **布局盒中心** (953, 1889) = 树的 `position.frameInScreen`
//     (x 872 / y 1808 / w 162 / h 162) 的左上角 + 81 —— 布局盒是**连续**坐标，
//     中心落在像素网格上。
//   两者差 0.5px（不是测量误差，是两种口径的定义差）⇒ 本 spec 的点击坐标用
//   **布局盒中心**（树给的），像素 oracle 用**闭区间中点**，写数字时必须标明是哪一种。
const FAB_TAP = roundPx(fabCenterPx(CONTENT_BOTTOM, CONTENT_RIGHT));

/**
 * 主 FAB 的圆心：**树优先**（#1047）。
 *
 * ⚠️ 旧口径 `FAB_TAP` 是按 vw 常量**推算**的——输入是「设计常量 + 稳定区高度」，
 *   布局一改就偏（本仓已因同类推算连续失准两次：#819、#920，两次都是「按旧布局推算
 *   坐标」而点空）。树的 `position.frameInScreen` 给的是**当下这一帧**的真实盒子
 *   （实测 162×162px ⇒ **布局盒中心** (953, 1889)；与推算值今天**完全相同**）。
 * ⇒ 推算值降级为**对照**：两者差得多 ⇒ **只报事实**（「推算口径可能陈旧了」），
 *   **不归因**「布局变了」——从这一项测量上分不开这两者。
 */
let fabTap = FAB_TAP;

/**
 * 本次抓到的运行时 UI 树（控制组用例的**树断言**用它）。
 *
 * ⚠️ 为什么单独存一份：`beforeAll` 抓树、后续 `it` 断言 ⇒ 跨用例传递。
 */
let capturedTree: UiTreeNode | null = null;

// 外环「我的」项：实测落点 (576, 1887)，相对 FAB 圆心 r=377px、角度 -89.7°
// （同帧另三项：推荐 (890,1520) r=374 -9.7°、插画 (735,1612) r=352 -38.2°、
// 小说 (621,1749) r=360 -67.1° —— 半径一致 ⇒ 外环 R_OUTER ≈ 376px）。
// y 改取 **FAB 圆心 y**：该项几乎正左方（-89.7°），与圆心同高是几何必然，
// 写成常量会再次把两处独立漂移绑在一起。
/**
 * 外环「我的」项相对 FAB 圆心的 **x 偏移**（px，负 = 在圆心左侧）。
 *
 * ⚠️ 为什么是「偏移」而不是绝对坐标 576（第 4 轮 Standards 轴 S-N1）：
 *   该项是**外环**上的一项 ⇒ 几何上就是**相对 FAB 圆心**定义的（r≈377px、
 *   角度 -89.7°）。若圆心改用**树给的**、而 x 仍写绝对常量 576 ⇒ FAB 一动，
 *   这一项就偏 ⇒ 第二跳点空 ⇒ 报出「点击外环项后放射菜单未收起」这种
 *   **误导性**失败信息（把排查引向布局回归，而真实原因是本测试的坐标口径陈旧）。
 *   ⇒ 拆成「圆心（树给）+ 偏移（实测 oracle，随圆心一起动）」。
 *
 * ⚠️ **今天的落点逐字不变**：树给的圆心 (953,1889) 与 vw 推算的 `FAB_TAP` (953,1889)
 *   **完全相同**（实测差 ≤0.8px，已由上面的漂移对照告警覆盖）⇒ 953 + (-377) = 576
 *   ⇒ 与改动前的绝对常量 **逐字一致**，本次改动**不改变任何当前行为**，
 *   只让「布局变了」时的行为从「点空」变成「跟着走」。
 */
const ME_RING_OFFSET_X = 576 - FAB_TAP.x; // = -377（实测 oracle 576 − vw 圆心 953）

/**
 * 外环「我的」项的落点：x = 树给的圆心 + 实测偏移，**y 跟随树给的 FAB 圆心**
 * （该项几乎正左方，与圆心同高是几何必然，写死会再次把两处独立漂移绑在一起）。
 */
let meRingTap = { x: FAB_TAP.x + ME_RING_OFFSET_X, y: FAB_TAP.y };

// Me 页「我的收藏」行（#819 订正；**票 #920 去顶栏后于 2026-10-03 重取帧**）。
//
// ⚠️ **本 oracle 已重取两次，两次都是因为「按旧布局推算坐标」而失效。**
//
// 【第一次失效（#819）】原写死 y=611 正落在「@1121611810」与「我的收藏」之间的
//   分隔区——既不是可点行，也不是任何文字 ⇒ tap 无反应，断言只看到「差异 8」。
//
// 【第二次失效（票 #920）】#819 订正时取的是**含 64dp 实体顶栏**的帧。
//   #920 去掉四个根页的实体顶栏后，内容整体上移 ⇒ 本坐标再次落空。
//   ⚠️ 当时只登记了「需重取帧」的注释，**没真去取**（E2E 不进 CI，ADR-0084，
//   没人会提醒）——「已登记」不是「已处理」。2026-10-03 已补取真帧。
//
// 【2026-10-03 重取帧 · 依据（emulator-5554 / Android 14 / 1080×2160 / density 480）】
//   按 #819 的同一像素扫描法（卡片内 x 60..700 扫「深色文字带」，阈值 RGB>110，
//   带高 ≥8px），在**去顶栏后**的 Me 页实测：
//     头像卡 Hintaooda/@ID  y151..302（中心 226）
//     **我的收藏            y415..459（中心 437）**  ← 本常量
//     追更列表 y566..609（中心 587）/ 稍后看 738 / 好P友 887 /
//     下载管理 1037 / 网络自检 1187 / 通知 1337（行距稳定 ≈149.6px）
//   **探针实测（不靠推算）**：tap(300, 437) ⇒ 成功导航到「收藏」页；
//   对照 tap(300, 587) ⇒ 进入「追更列表」（证明探针本身有效，不是"点了没反应"的静默失败）。
//
// ⚠️ **下一个人若再改根页顶栏/安全区，必须重新取帧，不得用「减 N」推算** ——
//   本仓已因同类推算连续失准两次（#819、#920）。推算看起来省事，但省掉的是验证。
const BOOKMARKS_ROW_TAP = { x: 300, y: 437 };

// ⚠️ **#1047 暂未把这一处改树**（诚实登记，不是漏做）：树里**能**按文本定位
//   （`attributes.text`，实测登录页树里 5 条文本可命中），但「我的收藏」这一行在
//   **Me 页**上的实际文本内容与所在层级**尚未在真机上取证**——文本对不上就会把一条
//   当前能过的用例改成必红。⇒ 取证需要**已登录的 Me 页**（当前 refresh_token 已失效，
//   见 #1047 阻塞项），补跑取证后再改。⚠️ 本仓已因「按推算坐标点空」返工两次
//   （#819 / #920），所以这里宁可不改，也不改成一个没验过的口径。

// 遮罩空白区（点空白收起菜单）：远离 FAB 与环。
const SCRIM_CLOSE_TAP = { x: 540, y: 506 };

/**
 * 校验目标 AVD 的几何（坐标常量按 pictelio_ui 1080×2160/density 480 **稳定区 2016px** 实测 config 推导，防 AVD 漂移静默失效）。
 *
 * ⚠️ 三项都要验，缺一不可（原实现只验 `wm size` / `wm density`，漏掉了系统栏高度）：
 * FAB 坐标由 `fabCenterPx(CONTENT_BOTTOM=2016, 1080)` 推导，而 `contentSize.h` 是**稳定区**
 * 高度而非全屏 2160。换 ROM 或切换导航模式（gestural ↔ threebutton）会让稳定区高度变化，
 * 此时旧常量会**静默点到空处**——2026-09-28 实测：全屏口径 2033 vs 实际 1889，偏 144px，
 * 落在 FAB 盒外。像素级 UI 断言在坐标错位时表现为「功能坏了」，极易被误判为产品回归。
 *
 * #852：实现收敛到 `../pixel` 的 `assertDeviceGeometry`（三 spec 共用一份），此处只做
 * 参数绑定（稳定区期望值 + 报错文案里的用途），断言体未改一字。
 */
function assertDeviceGeometry(serial: string): void {
  assertGeometry(serial, {
    contentHeight: CONTENT_BOTTOM,
    consumer: "本 spec 的 FAB / Me 页行常量",
  });
}

/** 等待前台 Activity 变为期望值（adb 轮询，prefs.currentTopActivity 归一化全名比对）。 */
async function waitForTopActivity(
  serial: string,
  activity: string,
  timeoutMs = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last: string | null = null;
  while (Date.now() < deadline) {
    last = currentTopActivity(serial);
    if (last === activity) return last;
    await SLEEP(1_000);
  }
  throw new Error(
    `等待前台 Activity ${activity} 超时（${timeoutMs / 1000}s），当前: ${last ?? "未知"}`,
  );
}

/** 断言 LynxActivity 仍前台（阶段 C 轮询安全校验点：被导航/崩溃即刻报错而非静默失效）。 */
function assertLynxActivityForeground(serial: string, context: string): void {
  const current = currentTopActivity(serial);
  if (current !== LYNX_ACTIVITY) {
    throw new Error(`${context}: LynxActivity 已不在前台（当前: ${current ?? "未知"}）`);
  }
}

/** 证据落盘目录（被 gitignore，仅本地取证用） */
const EVIDENCE_DIR = resolve(
  REPO_ROOT,
  "packages/android-host/test-results/android-e2e/fab-hit-testing",
);
mkdirSync(EVIDENCE_DIR, { recursive: true });

/**
 * 截屏（exec-out 直接取 PNG 字节流）。maxBuffer 放宽到 20MB——Node spawnSync
 *  默认 1MB，1080×2160 的 PNG 字节流会 ENOBUFS（pictelio_ui 实测）。
 *
 * #819：传入 `label` 时同时落盘。此前本 spec 的全部帧只在内存里参与 `pngDiff`，
 * 断言失败时**零证据**——只能看到一个裸数字（实测「差异 8」），无从判断是
 * 没点击、点错位置、还是页面确实变了（状态栏时钟本身就会贡献几十像素差）。
 * 落盘后失败即可对着两帧逐段复算差异来源。
 *
 * #852：实现收敛到 `../pixel` 的 `screenshot`（三 spec 共用一份），此处只绑定
 * 本 spec 的证据目录；`label` 可选、不传就不落盘的行为与收敛前一致。
 */
function screenshot(serial: string, label?: string): Buffer {
  return shoot(serial, label, EVIDENCE_DIR);
}

/** 像素 diff（canvas 解码 PNG；采样步长 2，逐通道阈值 24），返回差异采样点数。 */
async function pngDiff(
  a: Buffer,
  b: Buffer,
  region?: [number, number, number, number],
): Promise<number> {
  const [ia, ib] = await Promise.all([loadImage(a), loadImage(b)]);
  const w = Math.min(ia.width, ib.width);
  const h = Math.min(ia.height, ib.height);
  const ca = createCanvas(w, h);
  const cxa = ca.getContext("2d");
  cxa.drawImage(ia, 0, 0);
  const da = cxa.getImageData(0, 0, w, h).data;
  const cb = createCanvas(w, h);
  const cxb = cb.getContext("2d");
  cxb.drawImage(ib, 0, 0);
  const db = cxb.getImageData(0, 0, w, h).data;
  const [x0, y0, x1, y1] = region ?? [0, 0, w, h];
  let changed = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * w + x) * 4;
      if (
        Math.abs(da[i] - db[i]) > 24 ||
        Math.abs(da[i + 1] - db[i + 1]) > 24 ||
        Math.abs(da[i + 2] - db[i + 2]) > 24
      ) {
        changed++;
      }
    }
  }
  return changed;
}

/** adb 单次 tap。 */
function tap(serial: string, x: number, y: number): void {
  runOrThrow(adbPath(), ["-s", serial, "shell", "input", "tap", String(x), String(y)]);
}

/** uiautomator dump 一次，返回 XML；失败返回 null（Lynx a11y 树空是已知 SDK 限制，降级策略由调用方决定，不静默）。 */
function dumpUiXml(serial: string): string | null {
  try {
    runOrThrow(adbPath(), ["-s", serial, "shell", "uiautomator", "dump", "/sdcard/ui.xml"]);
    return runCapture(adbPath(), ["-s", serial, "shell", "cat", "/sdcard/ui.xml"]).stdout;
  } catch (e) {
    console.warn(
      `[fab] uiautomator dump 失败（Lynx a11y 树空是已知 SDK 限制）: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

/** dump XML 是否含 EditText 节点（Lynx 登录页唯一暴露的表单元素；已登录主界面无输入框）。 */
function dumpHasEditText(xml: string): boolean {
  return /class="android\.widget\.EditText"/u.test(xml);
}

/**
 * 等待 Lynx 渲染就绪（T7 加固项，沿用 ADR-0159 根因 4 口径）。
 * 信号：`onPageChanged|OnPatchFinishForFiber`（Lynx SDK 页面更新日志，页面首帧渲染后必现；
 * 与 switch-client-roundtrip* 的渲染断言同口径）。独立超时 60s，
 * 超时失败消息附 logcat 尾部 50 行，避免「全链失效无报错」。
 */
async function waitForLynxRenderReady(serial: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // prefs.readAppLogcat：按 pid 过滤（--pid 需 API≥24，两 AVD 均满足）；进程尚未创建时
    // **返回空串**而不是抛错——`am start` 返回后 ActivityTaskManager 的 Activity 记录
    // **先于**进程出现（实测 `START` 23:39:49.923 vs `Start proc` 23:39:50.070，
    // 差约 150ms），而此处正在轮询循环里，抛错会把「进程还没起」误报成
    // 「app 崩溃或被杀」并直接绕过整个等待逻辑。
    if (/onPageChanged|OnPatchFinishForFiber/u.test(readAppLogcat(serial))) {
      console.log("[fab] ✓ Lynx 渲染就绪（logcat: onPageChanged/OnPatchFinishForFiber）");
      return;
    }
    await SLEEP(1_000);
  }
  throw new Error(
    `等待 Lynx 渲染就绪超时（${timeoutMs / 1000}s，信号: onPageChanged|OnPatchFinishForFiber）。\n` +
      `logcat 尾部 50 行:\n${readAppLogcat(serial, { lines: 50 })}`,
  );
}

/**
 * 阶段 C：确认「已登录的 Lynx 主界面」。
 * Oracle：dev hook 登录把 refresh_token 持久化进 SecureStorage，重启后由
 * PictelioAuth 恢复登录态——该路径同样不产生登录页专属 marker，故不能等 marker；
 * 改为软校验「uiautomator dump 不再出现登录页 EditText」（登录页唯一表单元素，
 * 已登录 /recommended 无输入框）+ LynxActivity 保持前台（离开即刻报错）。
 * dump 不可用（Lynx a11y 树空是已知 SDK 限制；pictelio_ui 上 uiautomator dump
 * 实测必然被 SIGKILL 退出码 137）→ 以前台 Activity + 3s 稳定窗口判定；
 * 万一漏判（实际仍停登录页），后续 FAB 控制组用例必红（登录页无 FAB）。
 * 60s 超时，失败附 logcat 尾部 50 行。
 */
async function waitForLynxLoggedInHome(serial: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let warnedNoDump = false;
  while (Date.now() < deadline) {
    assertLynxActivityForeground(serial, "登录态确认");
    const xml = dumpUiXml(serial);
    if (xml === null) {
      // dump 不可用（pictelio_ui 的 Lynx 上 uiautomator dump 实测必然被 SIGKILL，
      // 退出码 137）：以「LynxActivity 前台 + 稳定窗口」为准返回——真正的登录态
      // oracle 由 FAB 控制组用例兜底（登录页无 FAB 必红）。稳定窗口 3s 后复验
      // 前台，排除恢复中途瞬时态。
      if (!warnedNoDump) {
        console.warn(
          "[fab] uiautomator dump 不可用（Lynx a11y 树空是已知 SDK 限制）：以前台 Activity + 3s 稳定窗口判定，登录态由 FAB 用例兜底",
        );
        warnedNoDump = true;
      }
      await SLEEP(3_000);
      assertLynxActivityForeground(serial, "登录态确认（稳定窗口复验）");
      console.log("[fab] ✓ 已登录 Lynx 主界面（前台 + 稳定窗口；dump 不可用）");
      return;
    }
    if (!dumpHasEditText(xml)) {
      console.log("[fab] ✓ 已登录 Lynx 主界面（dump 无登录页 EditText + LynxActivity 前台）");
      return;
    }
    await SLEEP(2_000);
  }
  throw new Error(
    `等待已登录 Lynx 主界面超时（${timeoutMs / 1000}s：登录页 EditText 仍在或 LynxActivity 离场）。\n` +
      `logcat 尾部 50 行:\n${readAppLogcat(serial, { lines: 50 })}`,
  );
}

describe.skipIf(SKIPPED)(
  `ADR-0123 回归：页面点击恢复（FAB 全屏容器吞触摸修复，pictelio_ui）${SKIPPED ? `（SKIP：${SKIP_REASON}）` : ""}`,
  () => {
    let ctx: AndroidE2eContext | undefined;
    let serial = "";

    beforeAll(async () => {
      const token = process.env.PIXIV_REFRESH_TOKEN ?? "";
      expect(token.length).toBeGreaterThan(0);
      // setupAndroidE2e：AVD 检测启动 → 编译安装（ANDROID_E2E_SKIP_BUILD=1 可跳过）→
      // Appium → session（pm clear 冒烟基线在内；可选 ANDROID_E2E_HTTP_PROXY 设备代理也在内）
      ctx = await setupAndroidE2e(TARGET_AVD);
      serial = ctx.serial;
      // 本 spec 坐标常量绑定 pictelio_ui 1080×2160/density 480（wm 实测校验，防 AVD 漂移）
      assertDeviceGeometry(serial);

      // ── 阶段 A：dev intent hook 登录 ──
      // 单引擎布局无 webview 登录页（APK 内无 WebView），走 am start 的
      // refresh_token 钩子；token 缺省读 PIXIV_REFRESH_TOKEN（globalSetup 注入）
      await loginViaDevIntent(serial);

      // ── 阶段 B：干净重启进已登录主界面 ──
      // client_kind 无需播种：单引擎下入口恒为 LynxActivity，原 getClientKind 归一逻辑已随 ADR-0203 决策 7 删除
      forceStopApp(serial);
      runOrThrow(adbPath(), ["-s", serial, "logcat", "-c"]);
      startMainActivity(serial);
      await waitForTopActivity(serial, LYNX_ACTIVITY, 60_000);
      // T7 口径：渲染就绪轮询（不再固定 sleep 盲等；超时附 logcat 尾部 50 行）
      await waitForLynxRenderReady(serial);

      // ── 阶段 C：确认已登录的 Lynx 主界面（登录态恢复不产生登录页 marker，见函数注释）──
      await waitForLynxLoggedInHome(serial);
      await SLEEP(5_000); // 主界面 settle：FAB 挂载完成（/recommended）

      // ── 阶段 D：抓运行时 UI 树，取主 FAB 的**真实圆心**（#1047 树优先）──
      // 抓树走 hot 采样点（`am start` + `uiTreeDump=1`）：`LynxActivity` 是 singleTask
      // ⇒ intent 走 onNewIntent 投递，Activity **不重建**、页面不重载 ⇒ 不影响后续用例。
      const captured = await captureUiTree(serial, {
        outDir: resolve(EVIDENCE_DIR, "ui-tree"),
      });
      // 落齐判据**进断言**（#1047 review 第 1 轮 Spec 轴）：未落齐 ⇒「最完整的那份」
      // 可能没到（缺 4s 档）⇒ 半成品树会让下游「找不到 FAB」报出误导性失败信息。
      expect(
        captured.settled,
        "UI 树采样未落齐（0/1500/4000 三档未齐）⇒ 最完整的那份可能没到",
      ).toBe(true);
      capturedTree = captured.best.tree;
      const treeCenter = fabCenter(captured.best.tree);
      fabTap = { x: Math.round(treeCenter.x), y: Math.round(treeCenter.y) };
      console.log(
        `[fab] 主 FAB 圆心：树 = (${fabTap.x}, ${fabTap.y})（${captured.best.point} 采样点 / ` +
          `${captured.best.delayMs}ms 档 / ${captured.best.nodeCount} 节点）` +
          `；vw 推算 = (${FAB_TAP.x}, ${FAB_TAP.y})` +
          `；差 ${Math.round(Math.hypot(fabTap.x - FAB_TAP.x, fabTap.y - FAB_TAP.y))}px`,
      );
      // 外环「我的」项跟着**树给的圆心**走（偏移量固定，圆心不固定）——
      // 见 `ME_RING_OFFSET_X` 的说明（第 4 轮 Standards 轴 S-N1）。
      meRingTap = { x: fabTap.x + ME_RING_OFFSET_X, y: fabTap.y };
      // ── 两套独立推导的**对照**（#1047 review 第 2 轮 Standards 轴 N5）──
      // 树给的圆心（当下这一帧的事实）与 vw 推算口径（设计常量 + 稳定区高度）是
      // **两个互相独立的来源**。今天实测两者**完全相同**（漂移 = 0）⇒ 这条是
      // 一支**哑炮**：它只会在布局真的动了之后才响。
      //
      // ⚠️ 为什么**只告警、不升为断言**：布局**合法**变更同样会让两者分开
      //   （那正是「树优先」要支持的方向）——把它做成断言就成了「布局一改就假红」，
      //   与方向相反。⚠️ 文案也**不能**断言成因：「布局已变」与「推算口径陈旧」
      //   从这一项测量上**分不开**（本仓 #819 / #920 两次返工的成因恰是后者）⇒
      //   只报事实 + 指明**该动哪一侧**（推算口径），不替读者猜。
      const fabDrift = Math.hypot(fabTap.x - FAB_TAP.x, fabTap.y - FAB_TAP.y);
      if (fabDrift > 8) {
        console.warn(
          `[fab] 树给的 FAB 圆心 (${fabTap.x}, ${fabTap.y}) 与 vw 推算口径 ` +
            `(${FAB_TAP.x}, ${FAB_TAP.y}) 相差 ${Math.round(fabDrift)}px > 8px。` +
            `**从这一项测量本身分不出成因**（布局变了 / 推算口径陈旧了 / 抓到的树不是当前这一帧，` +
            `三者都与此兼容——不要据此断定是产品回归）。以树为准（树是当下这一帧的真实盒子）；` +
            `vw 推算口径 fabCenterPx 需要重新校准，或在树已全面接管后直接删掉。`,
        );
      }
    }, 600_000);

    afterAll(async () => {
      // 先关 Appium session（app 可能已被 force-stop，dispose 内部逐项容错）
      await ctx?.teardown().catch(() => {});
      try {
        if (!serial) return;
        forceStopApp(serial);
        // 单引擎布局下无「默认引擎」可恢复（原 client_kind 归一逻辑已随 ADR-0203 决策 7 删除），
        // force-stop 即完成收尾，不播种 prefs 避免污染后续用例
      } catch {
        // 收尾失败不阻断
      }
    });

    it("控制组：FAB 点击有反应（菜单展开，证明应用未假死）", async () => {
      // ── 树断言：这一问像素答不了 ──
      // 像素只能答「画面变没变」；「那个元素**在不在**、**能不能点**、**多大**」只有树能答。
      // 树给的圆心就是下面实际点击的坐标 ⇒ 这几条把「点到了那个元素」钉成可复核的断言。
      const tree = capturedTree;
      expect(tree, "抓树失败：FAB 的树断言需要运行时 UI 树").not.toBeNull();
      if (!tree) throw new Error("缺运行时 UI 树");
      // 树断言判据**只有一份**：共享模块的 `assertFabTree`（跨 spec 的同一件事）。
      // ⚠️ 原先本 spec 与 `transition-matrix` 各写了一份 32 行、归一化后只差变量名与
      //   消息前缀（第 6 轮 Standards 轴 S-N3）⇒ 改一处漏一处的「漂」是必然的，
      //   而本仓的门禁纪律明令「抄三份就会漂」⇒ 收口到共享模块。
      assertFabTree(tree, { contentRight: CONTENT_RIGHT, contentBottom: CONTENT_BOTTOM });
      // ⚠️ **这里刻意没有「点击坐标 ∈ 屏幕盒」那类断言**（第 3 轮 Standards 轴 B1）：
      //   点击坐标 `fabTap` 就是**这棵树同一个节点**的布局盒中心
      //   （`beforeAll` 里 `fabCenter(captured.best.tree)` 算出来的），断言
      //   「圆心落在自己那个盒内」在**结构上不可能失败** ⇒ 它是一条恒真断言。
      //   旧写法 `expect(fabCenter(tree).x).toBe(fabTap.x)` 同理（树值对树值）。
      // ⇒ 「点到的到底是不是那个元素」由**独立来源**回答，不由树自证：
      //   ① `assertFabTree` 里那两条**位置判据**（盒子不越出内容区 ⇒ 坐标系用错就转红）；
      //   ② 点击**之后**的像素 diff（`pngDiff(before, after) > 100`）——画面真的变了，
      //      说明这一击打到了 FAB（没点空）。
      //   ③ 「树给的圆心」与「vw 推算的圆心」是否一致 ⇒ 那是 beforeAll 里的
      //      **对照告警**（不是断言）：布局合法变更不该让本门禁变红。

      const before = screenshot(serial, "ctl-before-fab-tap");
      tap(serial, fabTap.x, fabTap.y);
      await SLEEP(1_200);
      const after = screenshot(serial, "ctl-after-fab-tap");
      const changed = await pngDiff(before, after);
      expect(
        changed,
        "FAB 点击后画面无变化——证据 ctl-before/ctl-after-fab-tap.png",
      ).toBeGreaterThan(100);
      // 收起菜单（点遮罩空白区），恢复关闭态
      tap(serial, SCRIM_CLOSE_TAP.x, SCRIM_CLOSE_TAP.y);
      await SLEEP(1_200);
    }, 30_000);

    it("回归：经 FAB 进 Me 页后，『我的收藏』行点击有反应（导航到 /bookmarks）", async () => {
      // 1. 展开菜单 → 点「我的」外环项 → Me 页（KeepAlive 常驻，无需等待数据）
      tap(serial, fabTap.x, fabTap.y);
      await SLEEP(1_500);
      tap(serial, meRingTap.x, meRingTap.y);
      await SLEEP(3_000);
      // 2. 探针：点「我的收藏」行 → 应导航（修复前被全屏容器吞掉 → 0 变化）
      const before = screenshot(serial, "row-before-tap");
      tap(serial, BOOKMARKS_ROW_TAP.x, BOOKMARKS_ROW_TAP.y);
      await SLEEP(2_000);
      const after = screenshot(serial, "row-after-tap");
      const changed = await pngDiff(before, after);
      expect(
        changed,
        `点「我的收藏」行后画面几乎没变（差异 ${changed}，阈值 500）——证据 ` +
          `row-before-tap.png / row-after-tap.png。若两帧只差状态栏时钟，说明点击未生效。`,
      ).toBeGreaterThan(500);
    }, 45_000);
  },
);

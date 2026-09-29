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
 * 本用例的坐标常量（FAB_TAP / ME_RING_TAP / BOOKMARKS_ROW_TAP / SCRIM_CLOSE_TAP）
 * 是按 pictelio_ui（android-34，1080×2160 / density 480）的 vw 几何静态推导的，
 * 换设备会静默失准（点空 → 假绿/假红）。故缺省 pin 到 pictelio_ui，并显式
 * ANDROID_E2E_AVD=pictelio_low 时整文件 skip（beforeAll 的 assertDeviceGeometry
 * 也会按分辨率/密度兜底）。**不可因为「不再需要 WebView」就放开到 pictelio_low。**
 *
 * 纯 adb 驱动（仿 lynx-boot-renders.spec.ts 轻量模式；登录走 am start hook，无需
 * Appium webview context）。用例本体坐标常量推导式见常量注释；
 * 模型经旧 pictelio_low 常量校准——用同一公式反推 720×1280/320 可逐像素复现
 * 旧值 (635,1195)/(384,1187)，误差 ≤1px；beforeAll 校验分辨率防 AVD 漂移）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  currentTopActivity,
  forceStopApp,
  loginViaDevIntent,
  readAppLogcat,
  startMainActivity,
} from "../prefs";
import { adbPath, LYNX_ACTIVITY, REPO_ROOT, runCapture, runOrThrow } from "../env";
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
//   ⇒ 圆心 (952.5, 1888.5)。与 `fabCenterPx(2016, 1080)` 推导值 (953.3, 1889.3)
//   差 ≤0.8px；该 bbox 也与 `transition-geometry.fabCenterPx` 注释里早已记录的
//   `r2-after-fab.png` 口径（x872..1032 / y1808..1968）独立吻合。
const FAB_TAP = roundPx(fabCenterPx(CONTENT_BOTTOM, CONTENT_RIGHT));

// 外环「我的」项：实测落点 (576, 1887)，相对 FAB 圆心 r=377px、角度 -89.7°
// （同帧另三项：推荐 (890,1520) r=374 -9.7°、插画 (735,1612) r=352 -38.2°、
// 小说 (621,1749) r=360 -67.1° —— 半径一致 ⇒ 外环 R_OUTER ≈ 376px）。
// x 沿用原常量 576（本就正确）；y 改取 **FAB 圆心 y**：该项几乎正左方（-89.7°），
// 与圆心同高是几何必然，写成常量会再次把两处独立漂移绑在一起。
const ME_RING_TAP = { x: 576, y: FAB_TAP.y };

// Me 页「我的收藏」行（#819 订正）。
// oracle = 2026-09-29 实测帧 test-results/android-e2e/fab-hit-testing/row-before-tap.png
// 逐行像素扫描（卡片内 x 60..700 的深色文字带）：Hintaooda y492..558 / @1121611810
// y591..640 / **我的收藏 y746..788（中心 767）** / 追更列表 913 / 稍后看 1061 /
// 好P友 1209 / 下载管理 1353 / 网络自检 1500 / 通知 1647（行距稳定 ≈146.5px）。
// 原写死 y=611 正落在「@1121611810」(中心 616) 与「我的收藏」(中心 767) 之间的
// 分隔区——既不是可点行，也不是任何文字 ⇒ tap 无反应，断言只看到「差异 8」。
// 同样属于「按旧布局推导的坐标」这一类，与上面 FAB/外环同源。
const BOOKMARKS_ROW_TAP = { x: 300, y: 767 };

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
 */
function assertDeviceGeometry(serial: string): void {
  const size = runCapture(adbPath(), ["-s", serial, "shell", "wm", "size"]).stdout;
  const density = runCapture(adbPath(), ["-s", serial, "shell", "wm", "density"]).stdout;
  expect(size).toMatch(/1080x2160/u);
  expect(density).toMatch(/480/u);

  // 稳定区高度（= Lynx contentSize.h 口径，也是 FAB 圆心推导的 H 基准）
  const displays = runCapture(adbPath(), [
    "-s",
    serial,
    "shell",
    "dumpsys",
    "window",
    "displays",
  ]).stdout;
  const rng = /rng=\d+x\d+-\d+x(\d+)/u.exec(displays);
  expect(
    rng,
    `无法从 dumpsys window displays 解析稳定区高度（FAB_TAP 坐标依赖它）。原始输出片段：${displays
      .split("\n")
      .find((l) => l.includes("rng="))
      ?.trim()}`,
  ).not.toBeNull();
  const contentHeight = Number(rng?.[1]);
  expect(
    contentHeight,
    `稳定区高度应为 ${CONTENT_BOTTOM}（全屏 2160 减去顶部状态栏 72 + 底部手势条 72）；实测 ${contentHeight}。` +
      `本 spec 的 FAB / Me 页行常量按 ${CONTENT_BOTTOM} 校准，换 ROM 或切换导航模式后需重新校准` +
      `（gestural ↔ threebutton 会改变底部系统条高度）。`,
  ).toBe(CONTENT_BOTTOM);
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
const EVIDENCE_DIR = resolve(REPO_ROOT, "packages/android-host/test-results/android-e2e/fab-hit-testing");
mkdirSync(EVIDENCE_DIR, { recursive: true });

/**
 * 截屏（exec-out 直接取 PNG 字节流）。maxBuffer 放宽到 20MB——Node spawnSync
 *  默认 1MB，1080×2160 的 PNG 字节流会 ENOBUFS（pictelio_ui 实测）。
 *
 * #819：传入 `label` 时同时落盘。此前本 spec 的全部帧只在内存里参与 `pngDiff`，
 * 断言失败时**零证据**——只能看到一个裸数字（实测「差异 8」），无从判断是
 * 没点击、点错位置、还是页面确实变了（状态栏时钟本身就会贡献几十像素差）。
 * 落盘后失败即可对着两帧逐段复算差异来源。
 */
function screenshot(serial: string, label?: string): Buffer {
  const buf = execFileSync(adbPath(), ["-s", serial, "exec-out", "screencap", "-p"], {
    maxBuffer: 20 * 1024 * 1024,
  });
  if (label) writeFileSync(resolve(EVIDENCE_DIR, `${label}.png`), buf);
  return buf;
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
      // client_kind 无需播种：单引擎下入口恒为 LynxActivity，写什么都归一为 lynx
      forceStopApp(serial);
      runOrThrow(adbPath(), ["-s", serial, "logcat", "-c"]);
      startMainActivity(serial);
      await waitForTopActivity(serial, LYNX_ACTIVITY, 60_000);
      // T7 口径：渲染就绪轮询（不再固定 sleep 盲等；超时附 logcat 尾部 50 行）
      await waitForLynxRenderReady(serial);

      // ── 阶段 C：确认已登录的 Lynx 主界面（登录态恢复不产生登录页 marker，见函数注释）──
      await waitForLynxLoggedInHome(serial);
      await SLEEP(5_000); // 主界面 settle：FAB 挂载完成（/recommended）
    }, 600_000);

    afterAll(async () => {
      // 先关 Appium session（app 可能已被 force-stop，dispose 内部逐项容错）
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

    it("控制组：FAB 点击有反应（菜单展开，证明应用未假死）", async () => {
      const before = screenshot(serial, "ctl-before-fab-tap");
      tap(serial, FAB_TAP.x, FAB_TAP.y);
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
      tap(serial, FAB_TAP.x, FAB_TAP.y);
      await SLEEP(1_500);
      tap(serial, ME_RING_TAP.x, ME_RING_TAP.y);
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

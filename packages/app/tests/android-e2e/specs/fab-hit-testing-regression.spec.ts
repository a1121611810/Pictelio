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
 * ── 登录策略（2026-09-14 实弹诊断后重写，ADR-0159）──────────────────────────
 * 旧实现的「Lynx 侧 adb 盲打登录」（uiautomator 定位输入框 + `input text` 键入 token）
 * 有两条实证根因，不可靠且不可修复：
 * 1. `adb shell input text` 会截断/吞字符长 token——实测输入框只落了 43 字符
 *    （refresh_token 实际 ~100+），歪 token 发不出有效请求，登录必然失败；
 * 2. pictelio_low 的 DNS 普遍被污染（解到被墙 IP，app-api.pixiv.net TCP 15s 超时）；
 *    宿主代理（10.0.2.2:10808）可用，见 setup.ts 的 ANDROID_E2E_HTTP_PROXY。
 * 故改用跨引擎登录态共享（既有设计，#126/#127：webview 侧登录写入 WSSecureStorage 后，
 * pictelio_client_kind=lynx 重启进 LynxActivity 会恢复登录态渲染主界面；
 * 「Lynx 侧完整 UI 操作在当前 SDK 下不可自动化……用日志/契约层兜底」为仓库既有约定）：
 * - 阶段 A（webview 登录）：确保 client_kind=webview + 重启 → switchToWebView →
 *   token 注入 fluent-textarea shadow DOM → 等登录按钮 enabled → 点击 → 等离开 /login
 *   （与 switch-client-oneway / roundtrip 内联登录流程同款；提取为共享 helper 需改
 *   helpers.ts + 三份切换 spec，超出本次改动文件范围，先在本文件实现）；
 * - 阶段 B（契约层切 lynx）：writeClientKind("lynx") + 重启 → LynxActivity 前台 →
 *   渲染就绪（logcat `onPageChanged|OnPatchFinishForFiber`，T7 口径，60s 独立超时，
 *   超时附 logcat 尾部 50 行）；
 * - 阶段 C（登录态确认）：不再等 `PictelioSecureStorage.setItem.refresh_token` marker
 *   （该 marker 只在登录写入路径出现，WSSecureStorage 种子恢复路径不触发），改为软校验
 *   「uiautomator dump 不再出现登录页 EditText」（登录页唯一表单元素；已登录 /recommended
 *   无输入框）+ LynxActivity 保持前台，60s 超时；dump 不可用时 warn 跳过软校验
 *   （Lynx a11y 树空是已知 SDK 限制），漏判由 FAB 控制组用例兜底（登录页无 FAB 必红）。
 *
 * ── AVD 迁移：pictelio_low → pictelio_ui ──────────────────────────────────
 * pictelio_low（android-28）WebView 为 66 < 85：client_kind=webview 重启会触发
 * ADR-0153 自动降级直接进 LynxActivity（MainActivity.java:69-77，webviewOk=false 且
 * Lynx 可用），WEBVIEW context 不存在 → 阶段 A webview 登录在该 AVD 结构性不可行
 * （ADR-0159 根因 3「跑错设备」同类陷阱）。webview 登录需要 WebView ≥ 85，
 * 故整体迁移到 pictelio_ui（android-34，WebView 113，1080×2160 / density 480），
 * 显式 ANDROID_E2E_AVD=pictelio_low 时整文件 skip（防假失败）。
 *
 * 纯 adb + Appium 混合驱动：阶段 A 用 WebdriverIO（Appium session，webview context），
 * 阶段 B/C 与用例本体用纯 adb（仿 lynx-boot-renders.spec.ts 轻量模式）。
 * 用例本体坐标常量按 pictelio_ui 重新推导（vw 几何模型，推导式见常量注释；
 * 模型经旧 pictelio_low 常量校准——用同一公式反推 720×1280/320 可逐像素复现
 * 旧值 (635,1195)/(384,1187)，误差 ≤1px；beforeAll 校验分辨率防 AVD 漂移）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { currentTopActivity, forceStopApp, startMainActivity, writeClientKind } from "../prefs";
import {
  adbPath,
  APP_PACKAGE,
  E2E_FLAVOR,
  LYNX_ACTIVITY,
  MAIN_ACTIVITY,
  runCapture,
  runOrThrow,
} from "../env";
import { clickByText } from "../helpers";
import { setupAndroidE2e, type AndroidE2eContext } from "../setup";
import { createCanvas, loadImage } from "canvas";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * AVD pin（ADR-0159 根因 3 防回归，仿 switch-client-roundtrip-low）：
 * - 缺省 pin 到 pictelio_ui（WebView 113，webview 登录可达）；用 || 而非 ??：
 *   空字符串（CI 里 ANDROID_E2E_AVD= 的常见形态）会绕过 ?? 但不该绕过本缺省；
 * - 显式 ANDROID_E2E_AVD=pictelio_low 时整文件 skip：该 AVD WebView 66 < 85，
 *   client_kind=webview 重启触发 ADR-0153 自动降级进 LynxActivity，webview 登录
 *   结构性不可行（否则红在 switchToWebView 超时，属「跑错设备」假失败）；
 * - ANDROID_E2E_FLAVOR=webview 时整文件 skip：单引擎 webview 包无 LynxActivity，
 *   阶段 B/C 不可达。
 */
const TARGET_AVD = process.env.ANDROID_E2E_AVD || "pictelio_ui";
const SKIPPED = TARGET_AVD === "pictelio_low" || E2E_FLAVOR === "webview";
const SKIP_REASON =
  TARGET_AVD === "pictelio_low"
    ? `本用例阶段 A 需 webview 登录（WebView ≥ 85）；pictelio_low WebView 66 < 85 会触发 ` +
      `ADR-0153 自动降级（MainActivity → LynxActivity，无 WEBVIEW context），已整文件跳过。` +
      `请在 pictelio_ui 运行（缺省即 pictelio_ui）`
    : `本用例需要 full 包（Lynx 引擎）；当前 ANDROID_E2E_FLAVOR=webview，已整文件跳过`;
if (SKIPPED) {
  console.log(`[fab] SKIP: ${SKIP_REASON}`);
}

// ── 固定坐标（AVD pictelio_ui：物理 1080×2160，density 480，1vw = 10.8px）──
// 推导模型（GlobalFab.vue vw 几何 + 状态栏 inset，经旧 pictelio_low 常量校准）：
// - LynxView 顶 = 状态栏 inset（24dp × 3 = 72px），底 = 屏幕底（手势导航无底部 inset，
//   与 pictelio_low 旧常量反推一致）；vw 基准 = 屏宽 1080，
//   H_vw = (2160 - 72) / 1080 × 100 ≈ 193.33；
// - 主 FAB：fabCx = 100 - 4.267 - 14.933/2 = 88.2665vw；
//   fabCy = H_vw - 4.267 - 14.933/2 = H_vw - 11.7335vw（menu 模式）；
// - 外环「我的」项：R_OUTER = 35vw、末角 -88°（OUTER_END，polar: x=cx+sin(a)·r, y=cy-cos(a)·r）；
// - Me 页「我的收藏」行：TopAppBar 17.067vw + 卡片(mt-3 3.2vw + p-4 4.267vw +
//   头像行 14.933vw + pb-4 4.267vw) + 行半高(py-3.5 3.733vw + 16dp 文本半高) + 72 inset；
// - 遮罩空白区：屏宽中点、约 23% 屏高（远离 FAB 与环，点空白收起菜单）。
// ⚠ 坐标为静态推导（未实机逐点校准），验收首跑如几何断言失败，优先怀疑
//   状态栏 inset / 底部导航假设，用 uiautomator dump bounds 实测后微调。
const FAB_TAP = { x: 953, y: 2033 };
const ME_RING_TAP = { x: 576, y: 2020 };
const BOOKMARKS_ROW_TAP = { x: 300, y: 611 };
const SCRIM_CLOSE_TAP = { x: 540, y: 506 };

/** 校验目标 AVD 分辨率与密度（坐标常量按 pictelio_ui 1080×2160/density 480 实测 config 推导，防 AVD 漂移静默失效）。 */
function assertDeviceGeometry(serial: string): void {
  const size = runCapture(adbPath(), ["-s", serial, "shell", "wm", "size"]).stdout;
  const density = runCapture(adbPath(), ["-s", serial, "shell", "wm", "density"]).stdout;
  expect(size).toMatch(/1080x2160/u);
  expect(density).toMatch(/480/u);
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

/** 截屏（exec-out 直接取 PNG 字节流）。maxBuffer 放宽到 20MB——Node spawnSync
 *  默认 1MB，1080×2160 的 PNG 字节流会 ENOBUFS（pictelio_ui 实测）。 */
function screenshot(serial: string): Buffer {
  return execFileSync(adbPath(), ["-s", serial, "exec-out", "screencap", "-p"], {
    maxBuffer: 20 * 1024 * 1024,
  });
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

/** logcat 按 pid 过滤 dump（--pid 需 API≥24，两 AVD 均满足）；进程不存在视为致命（调用方等待中会超时）。 */
function logcatDumpByPid(serial: string): string {
  const pid = runCapture(adbPath(), ["-s", serial, "shell", "pidof", APP_PACKAGE]).stdout.trim();
  if (!pid) {
    throw new Error(`进程 ${APP_PACKAGE} 不存在（已崩溃或被杀），无法按 pid 过滤 logcat`);
  }
  return runCapture(adbPath(), ["-s", serial, "shell", "logcat", "-d", "--pid", pid]).stdout;
}

/** logcat 尾部 N 行（诊断输出用；获取失败不阻断，返回占位说明）。 */
function logcatTail(serial: string, lines = 50): string {
  try {
    return runCapture(adbPath(), ["-s", serial, "shell", "logcat", "-d", "-t", String(lines)])
      .stdout;
  } catch {
    return "(logcat tail 获取失败)";
  }
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
    if (/onPageChanged|OnPatchFinishForFiber/u.test(logcatDumpByPid(serial))) {
      console.log("[fab] ✓ Lynx 渲染就绪（logcat: onPageChanged/OnPatchFinishForFiber）");
      return;
    }
    await SLEEP(1_000);
  }
  throw new Error(
    `等待 Lynx 渲染就绪超时（${timeoutMs / 1000}s，信号: onPageChanged|OnPatchFinishForFiber）。\n` +
      `logcat 尾部 50 行:\n${logcatTail(serial, 50)}`,
  );
}

/**
 * 阶段 A：webview 侧真实登录（与 switch-client-oneway / roundtrip 内联流程同款）。
 * 前置：app 已以 client_kind=webview 重启且 MainActivity 前台（调用方负责）。
 * 流程：switchToWebView → 年龄确认（已过则跳过）→ token 注入 fluent-textarea
 * shadow DOM（custom element 直 setValue 报 invalid element state，必须操作内部
 * <textarea>：原生 value setter + composed input 事件）→ 等登录按钮 enabled →
 * 点击 → 等离开 /login（90s）。
 */
async function loginViaWebview(ctx: AndroidE2eContext): Promise<void> {
  const { driver } = ctx;
  await driver.switchToWebView(60_000);

  // 年龄确认页（/age-confirmation）：点「已满 18 岁」通过；已确认过则直接放行
  await driver.raw.waitUntil(
    async () => {
      const url = await driver.raw.getUrl();
      if (!url.includes("/age-confirmation")) return true;
      await clickByText(ctx, "已满 18 岁");
      return false;
    },
    { timeout: 60_000, timeoutMsg: "年龄确认页未通过", interval: 1_000 },
  );

  // 登录页：等输入框与登录按钮渲染
  await driver.raw.waitUntil(
    async () =>
      (await driver.raw.$("fluent-textarea").isExisting()) &&
      (await driver.raw.$("fluent-button=登录").isExisting()),
    { timeout: 30_000, timeoutMsg: "登录页未渲染", interval: 1_000 },
  );
  const token = process.env.PIXIV_REFRESH_TOKEN!;
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
  // 条件等待：登录按钮从 disabled 变为 enabled（token 注入生效），替代固定 sleep
  await driver.raw.waitUntil(
    async () => {
      const btn = await driver.raw.$("fluent-button=登录");
      return (await btn.getAttribute("disabled")) === null;
    },
    { timeout: 10_000, timeoutMsg: "token 注入后登录按钮未启用", interval: 300 },
  );
  await clickByText(ctx, "登录");

  // 等待登录完成（离开 /login 进入主界面）
  await driver.raw.waitUntil(async () => !(await driver.raw.getUrl()).includes("/login"), {
    timeout: 90_000,
    timeoutMsg: "登录失败（仍停留在 /login）",
    interval: 2_000,
  });
  console.log(`[fab] ✓ webview 登录成功，当前 URL: ${await driver.raw.getUrl()}`);
}

/**
 * 阶段 C：确认「已登录的 Lynx 主界面」。
 * Oracle：webview 登录的 token 落 WSSecureStorage，lynx 重启经
 * PictelioAuth.loginWithRefreshToken 种子恢复——该路径不产生
 * `PictelioSecureStorage.setItem.refresh_token` 登录写入 marker，故不能等 marker；
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
      `logcat 尾部 50 行:\n${logcatTail(serial, 50)}`,
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

      // ── 阶段 A：webview 登录 ──
      // 确定性基线：显式写 webview + 重启（setup 内已 pm clear，此处防串行执行残留）
      writeClientKind(serial, "webview");
      forceStopApp(serial);
      startMainActivity(serial);
      await waitForTopActivity(serial, MAIN_ACTIVITY, 60_000);
      await loginViaWebview(ctx);

      // ── 阶段 B：契约层切 lynx（跨引擎登录态共享：WSSecureStorage → 种子恢复）──
      expect(writeClientKind(serial, "lynx")).toBe("lynx");
      forceStopApp(serial);
      runOrThrow(adbPath(), ["-s", serial, "logcat", "-c"]);
      startMainActivity(serial);
      await waitForTopActivity(serial, LYNX_ACTIVITY, 60_000);
      // T7 口径：渲染就绪轮询（不再固定 sleep 盲等；超时附 logcat 尾部 50 行）
      await waitForLynxRenderReady(serial);

      // ── 阶段 C：确认已登录的 Lynx 主界面（种子恢复不触发登录写入 marker，见函数注释）──
      await waitForLynxLoggedInHome(serial);
      await SLEEP(5_000); // 主界面 settle：FAB 挂载完成（/recommended）
    }, 600_000);

    afterAll(async () => {
      // 先关 Appium session（app 可能已被 force-stop，dispose 内部逐项容错）
      await ctx?.teardown().catch(() => {});
      try {
        if (!serial) return;
        forceStopApp(serial);
        writeClientKind(serial, "webview"); // 恢复默认，避免污染后续用例
      } catch {
        // 收尾失败不阻断
      }
    });

    it("控制组：FAB 点击有反应（菜单展开，证明应用未假死）", async () => {
      const before = screenshot(serial);
      tap(serial, FAB_TAP.x, FAB_TAP.y);
      await SLEEP(1_200);
      const after = screenshot(serial);
      const changed = await pngDiff(before, after);
      expect(changed).toBeGreaterThan(100);
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
      const before = screenshot(serial);
      tap(serial, BOOKMARKS_ROW_TAP.x, BOOKMARKS_ROW_TAP.y);
      await SLEEP(2_000);
      const after = screenshot(serial);
      const changed = await pngDiff(before, after);
      expect(changed).toBeGreaterThan(500);
    }, 45_000);
  },
);

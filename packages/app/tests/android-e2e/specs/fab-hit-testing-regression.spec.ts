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
 * ADR-0159 根因 4 加固（登录渲染就绪）：android-28 慢渲染（帧耗时 0.7~3s）下，
 * 旧实现「固定 sleep 4s（唯一渲染等待）→ uiautomator 定位失败静默回退固定坐标 →
 * 裸 keyevent 4 收键盘」的盲操作链在 4s 内登录页未就绪时全链失效且无报错
 * （keyevent 4 = BACK 还会在 Lynx 根路由触发返回导航），最终 60s 登录超时 →
 * beforeAll 失败 → 整文件 2 用例被跳过。加固项：
 * 1. 登录操作前轮询 logcat 渲染就绪信号 `onPageChanged|OnPatchFinishForFiber`
 *    （与 switch-client-roundtrip* / lynx-boot-renders 同口径），60s 独立超时，
 *    超时失败消息附 logcat 尾部 50 行（可诊断）。
 * 2. 键入 token 后再次 uiautomator dump，能定位输入框则校验 text 含 token 前缀
 *    （逐步校验「输入是否入框」）；dump 不可用 / a11y 树无输入框（Lynx 4.0.1
 *    accessibility 只暴露表单元素、树常为空是已知 SDK 限制）→ console.warn 跳过，
 *    不静默、不失败。
 * 3. 收起键盘禁用裸 keyevent 4：改 tap 输入框外部空白处 + 校验 LynxActivity 仍前台
 *    （触发返回导航即刻报错）；软键盘未收起仅 warn（不静默），残留风险由整体重试兜底。
 * 4. 登录按钮点击后保留 logcat marker（refresh_token 持久化）轮询断言，并加整体重试
 *    （最多 2 次）：首次 marker 超时 → 重启 app（清残留输入态）→ 重新确认渲染就绪 →
 *    重跑登录序列。
 *
 * 纯 adb 驱动（仿 lynx-boot-renders.spec.ts 轻量模式，不依赖 Appium/WebView session）：
 * lynx 4.0.1 accessibility 树只暴露表单元素（input/EditText），view/text 不可定位，
 * 故登录输入框用 uiautomator 定位，其余交互用固定坐标（AVD pixel_4 720×1280/density 320，
 * 与既有 spec 的 `input tap 500 650` 硬编码坐标约定一致；beforeAll 校验分辨率防 AVD 漂移）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { ensureEmulator } from "../avd";
import {
  assertDebugApkInstalled,
  forceStopApp,
  startMainActivity,
  writeClientKind,
} from "../prefs";
import { buildDebugApk, installApk } from "../build-install";
import { adbPath, APP_PACKAGE, runCapture, runOrThrow } from "../env";
import { createCanvas, loadImage } from "canvas";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── 固定坐标（AVD pixel_4，逻辑屏 360×640，物理 720×1280，density 320）──
// 登录页：token 输入框 (360,574)、登录按钮 (360,688)——按钮是 lynx <view>，a11y 树不暴露。
// 登录页空白区 (360,300)（输入框上方页面背景，无 tap 处理器；收起键盘的安全替代，禁 keyevent 4）。
// 推荐页：主 FAB 圆心 (635,1195)；外环「我的」项 (384,1187)（几何：fabCx=88.27vw、R_OUTER=35、末角 -88°）。
// Me 页：「我的收藏」行 (200,400)（账户卡第一行，@tap → navigate('/bookmarks')）。
// 遮罩空白区 (360,300)（展开态点空白收起菜单）。
const LOGIN_INPUT_TAP = { x: 360, y: 574 };
const LOGIN_BUTTON_TAP = { x: 360, y: 688 };
const LOGIN_BLANK_TAP = { x: 360, y: 300 };
const FAB_TAP = { x: 635, y: 1195 };
const ME_RING_TAP = { x: 384, y: 1187 };
const BOOKMARKS_ROW_TAP = { x: 200, y: 400 };
const SCRIM_CLOSE_TAP = { x: 360, y: 300 };

/** 读当前前台 Activity 短名（dumpsys ResumedActivity 解析，失败返回空串）。 */
function resumedActivity(serial: string): string {
  const d = runCapture(adbPath(), ["-s", serial, "shell", "dumpsys", "activity", "activities"]);
  return /ResumedActivity:\s*ActivityRecord\{[^}]*u0\s+([^\s]+)/u.exec(d.stdout)?.[1] ?? "";
}

/** 等待前台 Activity 变为期望值（adb 轮询）。 */
async function waitForActivity(
  serial: string,
  expected: string,
  timeoutMs = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = resumedActivity(serial);
    if (last.endsWith(expected)) return last;
    await SLEEP(1_000);
  }
  throw new Error(`等待 Activity ${expected} 超时（${timeoutMs / 1000}s），当前: ${last}`);
}

/** 断言仍在登录界面（LynxActivity 前台）——keyevent 4 替代序列的安全校验点。 */
function assertLynxActivityForeground(serial: string, context: string): void {
  const current = resumedActivity(serial);
  if (!current.endsWith("LynxActivity")) {
    throw new Error(
      `${context}: LynxActivity 已不在前台（当前: ${current || "未知"}）——疑似触发返回导航`,
    );
  }
}

/** 校验目标 AVD 分辨率与密度（坐标常量按 pixel_4 720×1280/density 320 实测，防 AVD 漂移静默失效）。 */
function assertDeviceGeometry(serial: string): void {
  const size = runCapture(adbPath(), ["-s", serial, "shell", "wm", "size"]).stdout;
  const density = runCapture(adbPath(), ["-s", serial, "shell", "wm", "density"]).stdout;
  expect(size).toMatch(/720x1280/u);
  expect(density).toMatch(/320/u);
}

/** 截屏（exec-out 直接取 PNG 字节流）。 */
function screenshot(serial: string): Buffer {
  return execFileSync(adbPath(), ["-s", serial, "exec-out", "screencap", "-p"]);
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

/** 从 dump XML 提取首个 EditText 节点的中心坐标与当前 text（Lynx a11y 只暴露表单元素）。 */
function findEditText(xml: string): { x: number; y: number; text: string } | null {
  const node = /<node[^>]*class="android\.widget\.EditText"[^>]*>/u.exec(xml)?.[0];
  if (!node) return null;
  const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/u.exec(node);
  if (!bounds) return null;
  return {
    x: (Number(bounds[1]) + Number(bounds[3])) / 2,
    y: (Number(bounds[2]) + Number(bounds[4])) / 2,
    text: /\btext="([^"]*)"/u.exec(node)?.[1] ?? "",
  };
}

/** uiautomator 定位首个 EditText（lynx token 输入框 a11y 暴露），返回中心坐标；找不到回退固定坐标（warn，非静默）。 */
function locateTokenInput(serial: string): { x: number; y: number } {
  const xml = dumpUiXml(serial);
  if (xml) {
    const el = findEditText(xml);
    if (el) return { x: el.x, y: el.y };
    console.warn(
      "[fab] dump 中未找到 EditText（Lynx a11y 树可能为空），回退固定坐标 LOGIN_INPUT_TAP",
    );
  }
  return LOGIN_INPUT_TAP;
}

/**
 * 逐步校验 token 已入框（ADR-0159 根因 4「单发无逐步校验」的修复）：
 * - dump 可用且能定位输入框 → 断言 text 含 token 前缀（不匹配 = 键入丢失，硬失败）
 * - dump 不可用 / a11y 树未暴露输入框（Lynx SDK 已知限制）→ console.warn 跳过（不静默、不失败）
 */
function verifyTokenInInput(serial: string, tokenPrefix: string): void {
  const xml = dumpUiXml(serial);
  if (!xml) {
    console.warn(
      "[fab] 跳过 token 入框校验：uiautomator dump 不可用（Lynx a11y 树空是已知 SDK 限制）",
    );
    return;
  }
  const el = findEditText(xml);
  if (!el) {
    console.warn("[fab] 跳过 token 入框校验：a11y 树未暴露输入框节点（Lynx SDK 已知限制）");
    return;
  }
  expect(
    el.text.includes(tokenPrefix),
    `token 未入框：输入框 text="${el.text.slice(0, 40)}" 不含前缀 "${tokenPrefix}"`,
  ).toBe(true);
}

/** 软键盘是否仍弹出（dumpsys input_method mInputShown）；不可用时返回 null（状态未知）。 */
function isSoftKeyboardShown(serial: string): boolean | null {
  try {
    const out = runCapture(adbPath(), ["-s", serial, "shell", "dumpsys", "input_method"]).stdout;
    if (!out.includes("mInputShown=")) return null;
    return out.includes("mInputShown=true");
  } catch {
    return null;
  }
}

/** logcat 按 pid 过滤 dump（--pid 需 API≥24，android-28 满足）；进程不存在视为致命（调用方等待中会超时）。 */
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
 * 等待 Lynx 登录页渲染就绪（ADR-0159 根因 4：替代「固定 sleep 4s」盲等）。
 * 信号口径：`onPageChanged|OnPatchFinishForFiber`（Lynx SDK 页面更新日志，登录页首帧
 * 渲染后必现；与 switch-client-roundtrip* 的渲染断言同口径）。独立超时 60s，
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

/** lynx 登录序列（单次）：渲染就绪 → 定位输入框 → 键入 token → 入框校验 → 安全收起键盘 → 点登录。
 *  登录完成 marker（refresh_token 持久化）由调用方 waitForLogin 轮询，此处不等待。 */
async function performLynxLogin(serial: string, token: string): Promise<void> {
  await waitForLynxRenderReady(serial);
  const input = locateTokenInput(serial);
  tap(serial, input.x, input.y);
  await SLEEP(500);
  runOrThrow(adbPath(), ["-s", serial, "shell", "input", "text", token]);
  await SLEEP(500);
  verifyTokenInInput(serial, token.slice(0, 6));
  // 收起键盘（安全序列，ADR-0159 根因 4）：裸 keyevent 4 = BACK，Lynx 根路由会触发
  // 返回导航甚至退出 Activity，登录点击全链失效。改为 tap 输入框上方空白处（页面背景，
  // 无 tap 处理器），随后校验 LynxActivity 仍前台——若被导航即刻报错而非静默失效。
  tap(serial, LOGIN_BLANK_TAP.x, LOGIN_BLANK_TAP.y);
  await SLEEP(800);
  assertLynxActivityForeground(serial, "收起键盘（tap 空白处）后");
  if (isSoftKeyboardShown(serial) === true) {
    console.warn(
      "[fab] 软键盘未收起：登录按钮固定坐标可能被遮挡，若登录超时将由整体重试（重启 app）兜底",
    );
  }
  tap(serial, LOGIN_BUTTON_TAP.x, LOGIN_BUTTON_TAP.y);
}

/** 等待登录完成（logcat 出现 refresh_token 持久化标记，确定性信号）。
 *  marker 为 lynx 运行时 method_invoker 日志格式 `(PictelioSecureStorage.setItem.refresh_token)`，
 *  登录成功保存 token 时必现（模拟器实测）。超时附 logcat 尾部 50 行。 */
async function waitForLogin(serial: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const log = runCapture(adbPath(), ["-s", serial, "logcat", "-d"]).stdout;
    if (log.includes("PictelioSecureStorage.setItem.refresh_token")) return;
    await SLEEP(1_000);
  }
  throw new Error(
    `登录超时（${timeoutMs / 1000}s，未出现 refresh_token 持久化标记）。\n` +
      `logcat 尾部 50 行:\n${logcatTail(serial, 50)}`,
  );
}

/**
 * 登录整体编排（最多 2 次尝试，ADR-0159 根因 4）：单次尝试 = 渲染就绪确认 + 登录序列 +
 * marker 轮询。首次 marker 超时/序列失败 → 重启 app（顺带清掉可能残留的输入态，避免
 * 重试键入拼接成非法 token）→ logcat 清基线 → 重新确认渲染就绪（waitForLynxRenderReady
 * 在 performLynxLogin 内执行，即「重试须先重新确认渲染就绪」）→ 重跑登录序列。
 */
async function loginUntilMarker(serial: string, token: string): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) {
      console.warn(
        `[fab] 登录第 1 次尝试未完成（${lastError instanceof Error ? lastError.message.split("\n")[0] : String(lastError)}），重启 app 后重跑登录序列（第 2/2 次）`,
      );
      forceStopApp(serial);
      runOrThrow(adbPath(), ["-s", serial, "logcat", "-c"]);
      startMainActivity(serial);
      await waitForActivity(serial, "LynxActivity");
    }
    try {
      await performLynxLogin(serial, token);
      await waitForLogin(serial);
      console.log(`[fab] ✓ 登录成功（第 ${attempt} 次尝试，refresh_token 已持久化）`);
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`登录整体重试（2 次尝试）均失败`, { cause: lastError });
}

describe("ADR-0123 回归：页面点击恢复（FAB 全屏容器吞触摸修复）", () => {
  let serial: string;
  const token = process.env.PIXIV_REFRESH_TOKEN ?? "";

  beforeAll(async () => {
    expect(token.length).toBeGreaterThan(0);
    // 本 spec 的坐标常量绑定 pixel_4 720×1280/density 320（pictelio_low）；
    // 显式缺省用 pictelio_low，避免自动选择到 pictelio_ui(1080×2160) 时几何断言必然失败。
    // 用 || 而非 ??：空字符串（CI 里 ANDROID_E2E_AVD= 的常见形态）会绕过 ?? 但不该绕过本缺省
    const { serial: s } = await ensureEmulator(process.env.ANDROID_E2E_AVD || "pictelio_low");
    serial = s;
    assertDeviceGeometry(serial);
    assertDebugApkInstalled(serial);
    await buildDebugApk(); // ANDROID_E2E_SKIP_BUILD=1 时跳过
    await installApk(serial);
    // 基线：清空数据 → 写 lynx → 启动（MainActivity 分发到 LynxActivity）
    runOrThrow(adbPath(), ["-s", serial, "shell", "pm", "clear", APP_PACKAGE], 60_000);
    expect(writeClientKind(serial, "lynx")).toBe("lynx");
    forceStopApp(serial);
    runOrThrow(adbPath(), ["-s", serial, "logcat", "-c"]);
    startMainActivity(serial);
    await waitForActivity(serial, "LynxActivity");
    // ADR-0159 根因 4：不再「sleep 4s + 盲操作 + 裸 keyevent 4」，改为
    // 渲染就绪轮询 + 逐步入框校验 + 安全收键盘 + 失败整体重试（详见文件头注释）
    await loginUntilMarker(serial, token);
    await SLEEP(5_000); // 登录成功 → replace 到 /recommended + FAB 渲染
  }, 480_000);

  afterAll(() => {
    try {
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
});

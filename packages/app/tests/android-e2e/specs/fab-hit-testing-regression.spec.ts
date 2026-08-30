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
// 推荐页：主 FAB 圆心 (635,1195)；外环「我的」项 (384,1187)（几何：fabCx=88.27vw、R_OUTER=35、末角 -88°）。
// Me 页：「我的收藏」行 (200,400)（账户卡第一行，@tap → navigate('/bookmarks')）。
// 遮罩空白区 (360,300)（展开态点空白收起菜单）。
const LOGIN_INPUT_TAP = { x: 360, y: 574 };
const LOGIN_BUTTON_TAP = { x: 360, y: 688 };
const FAB_TAP = { x: 635, y: 1195 };
const ME_RING_TAP = { x: 384, y: 1187 };
const BOOKMARKS_ROW_TAP = { x: 200, y: 400 };
const SCRIM_CLOSE_TAP = { x: 360, y: 300 };

/** 等待前台 Activity 变为期望值（adb 轮询）。 */
async function waitForActivity(
  serial: string,
  expected: string,
  timeoutMs = 30_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const d = runCapture(adbPath(), ["-s", serial, "shell", "dumpsys", "activity", "activities"]);
    last = /ResumedActivity:\s*ActivityRecord\{[^}]*u0\s+([^\s]+)/u.exec(d.stdout)?.[1] ?? "";
    if (last.endsWith(expected)) return last;
    await SLEEP(1_000);
  }
  throw new Error(`等待 Activity ${expected} 超时（${timeoutMs / 1000}s），当前: ${last}`);
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

/** uiautomator 定位首个 EditText（lynx token 输入框 a11y 暴露），返回中心坐标；找不到回退固定坐标。 */
function locateTokenInput(serial: string): { x: number; y: number } {
  try {
    runOrThrow(adbPath(), ["-s", serial, "shell", "uiautomator", "dump", "/sdcard/ui.xml"]);
    const xml = runCapture(adbPath(), ["-s", serial, "shell", "cat", "/sdcard/ui.xml"]).stdout;
    const m =
      /<node[^>]*class="android\.widget\.EditText"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(
        xml,
      );
    if (m) {
      return {
        x: (Number(m[1]) + Number(m[3])) / 2,
        y: (Number(m[2]) + Number(m[4])) / 2,
      };
    }
  } catch {
    // dump 失败回退固定坐标
  }
  return LOGIN_INPUT_TAP;
}

/** lynx 登录：uiautomator 定位输入框 → 键入 refresh_token → 收起键盘 → 点登录。 */
async function loginViaAdb(serial: string, token: string): Promise<void> {
  const input = locateTokenInput(serial);
  tap(serial, input.x, input.y);
  await SLEEP(500);
  runOrThrow(adbPath(), ["-s", serial, "shell", "input", "text", token]);
  await SLEEP(500);
  // 收起键盘（布局恢复），再点登录按钮
  runOrThrow(adbPath(), ["-s", serial, "shell", "input", "keyevent", "4"]);
  await SLEEP(1_000);
  tap(serial, LOGIN_BUTTON_TAP.x, LOGIN_BUTTON_TAP.y);
}

/** 等待登录完成（logcat 出现 refresh_token 持久化标记，确定性信号）。
 *  marker 为 lynx 运行时 method_invoker 日志格式 `(PictelioSecureStorage.setItem.refresh_token)`，
 *  登录成功保存 token 时必现（模拟器实测）。 */
async function waitForLogin(serial: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const log = runCapture(adbPath(), ["-s", serial, "logcat", "-d"]).stdout;
    if (log.includes("PictelioSecureStorage.setItem.refresh_token")) return;
    await SLEEP(1_000);
  }
  throw new Error("登录超时（未出现 refresh_token 持久化标记）");
}

describe("ADR-0123 回归：页面点击恢复（FAB 全屏容器吞触摸修复）", () => {
  let serial: string;
  const token = process.env.PIXIV_REFRESH_TOKEN ?? "";

  beforeAll(async () => {
    expect(token.length).toBeGreaterThan(0);
    const { serial: s } = await ensureEmulator(process.env.ANDROID_E2E_AVD);
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
    await SLEEP(4_000); // lynx bundle 加载 + 登录页渲染
    await loginViaAdb(serial, token);
    await waitForLogin(serial);
    await SLEEP(5_000); // 登录成功 → replace 到 /recommended + FAB 渲染
  }, 300_000);

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

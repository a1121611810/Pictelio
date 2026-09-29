/**
 * Android E2E 环境常量子进程工具。
 *
 * 约定：adb / emulator 不在 PATH 中（macOS Android Studio 默认布局），
 * 一律通过 ANDROID_HOME / ANDROID_SDK_ROOT 定位全路径；GitHub API 相关
 * 请求不走代理（已知坑），这里仅针对 SDK 子进程剥离代理环境变量。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 宿主包根目录（本文件位于 packages/android-host/tests/android-e2e/ 下） */
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** monorepo 根目录 */
export const REPO_ROOT = resolve(APP_ROOT, "..", "..");

/**
 * E2E 目标构建布局。
 *
 * - `single`：**单引擎**（main 线）。#610 去 Capacitor 后 build.gradle 已无
 *   productFlavors，`java.srcDir 'src/lynx/java'` 提升进 main，产物落在
 *   `apk/debug/app-debug.apk`（实测 2026-09-28：aapt2 badging
 *   `launchable-activity: io.pictelio.app.LynxActivity`，无 MainActivity 类）。
 * - `full` / `webview`：过渡分支 `release/transition-6.2.0` 的双引擎布局
 *   （`apk/<flavor>/debug/app-<flavor>-debug.apk`）。
 */
export type E2eFlavor = "single" | "full" | "webview";

/** 环境变量原值 → flavor。**只认显式值，缺省 single**（不做产物探测，见下）。 */
export function resolveE2eFlavor(raw: string | undefined): E2eFlavor {
  return raw === "full" || raw === "webview" || raw === "single" ? raw : "single";
}

/** flavor → debug APK 相对路径（相对 packages/app） */
export function apkRelativePath(flavor: E2eFlavor): string {
  return flavor === "single"
    ? "android/app/build/outputs/apk/debug/app-debug.apk"
    : `android/app/build/outputs/apk/${flavor}/debug/app-${flavor}-debug.apk`;
}

/**
 * E2E 目标 flavor。`ANDROID_E2E_FLAVOR` 显式指定，缺省 `single`（main 单引擎）。
 *
 * **刻意不做「按产物存在性自动探测」**：`outputs/apk/` 下会残留其它分支的陈旧
 * flavor 目录——实测在 main 上跑完 `pnpm build:android` 后，`full/`、`lynx/`、
 * `webview/` 里仍躺着过渡分支 6.2.1 的包。自动探测会把单引擎 main 误判成
 * `full`，进而指向一个本次构建根本没产出的 APK。要跑过渡分支须显式
 * `ANDROID_E2E_FLAVOR=full`。
 */
export const E2E_FLAVOR: E2eFlavor = resolveE2eFlavor(process.env.ANDROID_E2E_FLAVOR);

/**
 * 非单引擎 flavor 的**显式失败**（#819）。
 *
 * 背景：本分支 build.gradle 已无 productFlavors（实测 `productFlavors` 计数 0），
 * `ANDROID_E2E_FLAVOR=full|webview` 会指向**本次构建根本没产出**的 APK 路径。
 * 此前各 spec 用 `E2E_FLAVOR === "webview" ⇒ 整文件 skip` 兜着——但那条守卫
 * ①恒不可达（永远走不到）、②静默，把「配置写错」伪装成「该设备上不可跑」。
 *
 * 改在 env.ts 收口：任何 spec / 工具只要 import env 就会立刻炸，并给出正确指令。
 * 不放在各 spec 里逐个删守卫——那样「漏一个 spec 又静默跳过」的洞会留着。
 */
if (E2E_FLAVOR !== "single") {
  throw new Error(
    `[android-e2e] ANDROID_E2E_FLAVOR=${E2E_FLAVOR} 在本分支不可用：build.gradle 已无 ` +
      `productFlavors（去 Capacitor 后唯一入口是 launcher LynxActivity），` +
      `不存在 flavor 维度产物 ${apkRelativePath(E2E_FLAVOR)}。` +
      `请去掉该环境变量（缺省即 single）；若确需跑双引擎，切到 release/transition-6.2.0 分支。`,
  );
}

/** debug APK 产物路径（随 flavor 变化） */
export const APK_PATH = resolve(APP_ROOT, apkRelativePath(E2E_FLAVOR));

/** App 包名与主入口 Activity（按 flavor 变化；冒烟测试断言目标） */
export const APP_PACKAGE = "io.pictelio.app";
export const LYNX_ACTIVITY = `${APP_PACKAGE}.LynxActivity`;

/** flavor → 主入口 Activity 全限定类名 */
export function mainActivityFor(flavor: E2eFlavor, pkg: string): string {
  if (flavor === "webview") return `${pkg}.MainActivityWebview`;
  if (flavor === "full") return `${pkg}.MainActivity`;
  return `${pkg}.LynxActivity`;
}

/**
 * 主入口 Activity。`single` 布局下 Lynx 是唯一引擎，入口即 LynxActivity——
 * 单引擎 APK 里**不存在** MainActivity / MainActivityWebview 两个类，
 * 仍按 `io.pictelio.app.MainActivity` 拉起会在 `am start` 阶段直接失败。
 */
export const MAIN_ACTIVITY = mainActivityFor(E2E_FLAVOR, APP_PACKAGE);

/**
 * 全部可能的入口 Activity。低 WebView 设备上 full 包的 MainActivity 会在
 * onCreate 内立即 finish 并路由/降级（ADR-0153），session 就绪等待必须接受
 * 「任一入口」而非单一 MainActivity。单引擎布局下两者重合，去重避免重复等待。
 */
export const ENTRY_ACTIVITIES: readonly string[] =
  MAIN_ACTIVITY === LYNX_ACTIVITY ? [LYNX_ACTIVITY] : [MAIN_ACTIVITY, LYNX_ACTIVITY];

/** 复用本机固定 AVD（ADR-0061：不新建/删除）。pictelio_ui（android-34）优先：
 *  WebView ≥ 85（项目 minWebviewVersion），可真实运行 App；pictelio_low（android-28）
 *  WebView 过老，仅能验证升级提示页路径。 */
export const KNOWN_AVDS = ["pictelio_ui", "pictelio_low"] as const;
export type AvdName = (typeof KNOWN_AVDS)[number];

/** 各 AVD 默认端口（emulator 控制台端口须为偶数） */
export const AVD_PORTS: Record<AvdName, number> = {
  pictelio_low: 5554,
  pictelio_ui: 5556,
};

/** 超时档位（毫秒） */
export const TIMEOUTS = {
  /** 模拟器 boot 完成等待：首次冷启动可能很慢 */
  boot: 300_000,
  /** adb 单条命令 */
  adb: 30_000,
  /** 编译 debug APK（复用增量构建时通常 < 2min） */
  build: 600_000,
  /** adb install */
  install: 180_000,
  /** Appium server /status 就绪 */
  appium: 60_000,
  /** WebdriverIO session 创建（含 uiautomator2 server 安装） */
  session: 180_000,
} as const;

/** 定位 Android SDK 根目录，找不到时给出可操作的报错 */
export function sdkRoot(): string {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    resolve(homedir(), "Library/Android/sdk"),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    if (existsSync(resolve(dir, "platform-tools", "adb"))) return dir;
  }
  throw new Error(
    `[android-e2e] 未找到 Android SDK。请设置 ANDROID_HOME（已尝试：${candidates.join(", ")}），` +
      `预期目录下应存在 platform-tools/adb`,
  );
}

export function adbPath(): string {
  return resolve(sdkRoot(), "platform-tools", "adb");
}

export function emulatorPath(): string {
  return resolve(sdkRoot(), "emulator", "emulator");
}

/** 剥离代理后的环境变量：adb/emulator 不需要代理，避免已知代理坑 */
export function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of [
    "http_proxy",
    "https_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "all_proxy",
    "ALL_PROXY",
  ]) {
    delete env[key];
  }
  // 显式声明 loopback 不走代理（防御下游工具读取 NO_PROXY）
  env.NO_PROXY = [env.NO_PROXY, "localhost", "127.0.0.1"].filter(Boolean).join(",");
  // driver 装到全局 ~/.appium（monorepo 内 npm 协议冲突，不能装项目本地）
  env.APPIUM_HOME ??= resolve(homedir(), ".appium");
  // uiautomator2 driver 需要 ANDROID_HOME/ANDROID_SDK_ROOT 定位 SDK 工具链；
  // 本机可能未导出，用探测值兜底注入
  env.ANDROID_HOME ??= sdkRoot();
  env.ANDROID_SDK_ROOT ??= sdkRoot();
  return env;
}

/**
 * 保留代理的环境变量：Appium server 需要。Chromedriver 自动下载走
 * chromedriver.storage.googleapis.com，本机直连大文件下载会超时（实测 curl
 * GET 超时、HEAD 200），必须走代理（实测代理 8.4MB 秒下）。
 * 其余约定与 cleanEnv 一致（APPIUM_HOME / ANDROID_HOME 注入）。
 */
export function proxyEnv(): NodeJS.ProcessEnv {
  const env = cleanEnv();
  // 不剥离代理，原样保留 process.env 的代理变量
  for (const key of [
    "http_proxy",
    "https_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "all_proxy",
    "ALL_PROXY",
  ]) {
    env[key] = process.env[key];
  }
  return env;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * runCapture 输出缓冲上界：logcat -d 逐帧日志（lynx OnPatchFinishForFiber 级）
 * 可达数 MB，Node 默认 1MB 会抛 ENOBUFS（#543 实测触发，导致空响应绕过重试）。
 * 先例：scripts/audit-real-interaction/run_regression.mjs adbBuffer 同款 64MB。
 */
const MAX_CAPTURE_BUFFER = 64 * 1024 * 1024;

/**
 * 同步执行命令并收集输出（默认不抛错，由调用方按退出码判断）。
 * 用于 adb 探测类命令——失败本身是合法状态（如设备未连接）。
 *
 * timeoutMs 显式标注 number（#543）：默认值 TIMEOUTS.adb 是 as const 字面量，
 * 不标注会把形参推断成 `30000`，调用点传其他超时即编译错误。
 */
export function runCapture(
  cmd: string,
  args: string[],
  timeoutMs: number = TIMEOUTS.adb,
  maxBufferBytes: number = MAX_CAPTURE_BUFFER,
): RunResult {
  const r = spawnSync(cmd, args, {
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: maxBufferBytes,
    env: cleanEnv(),
  });
  if (r.error) {
    // 超时 / ENOENT 统一包装为带上下文的错误
    const hint =
      (r.error as NodeJS.ErrnoException).code === "ENOENT"
        ? "命令不存在，请检查 SDK 路径"
        : "可能超时";
    throw new Error(
      `[android-e2e] 执行失败: ${cmd} ${args.join(" ")}（${hint}）: ${r.error.message}`,
    );
  }
  return { code: r.status ?? -1, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim() };
}

/**
 * 执行命令，非零退出即抛错（带 stderr 摘要）。用于必须成功的步骤（install 等）。
 */
export function runOrThrow(
  cmd: string,
  args: string[],
  timeoutMs: number = TIMEOUTS.adb,
  maxBufferBytes: number = MAX_CAPTURE_BUFFER,
): string {
  const r = runCapture(cmd, args, timeoutMs, maxBufferBytes);
  if (r.code !== 0) {
    throw new Error(
      `[android-e2e] 命令退出码 ${r.code}: ${cmd} ${args.join(" ")}\n` +
        `stderr: ${r.stderr || "(空)"}\nstdout: ${r.stdout || "(空)"}`,
    );
  }
  return r.stdout;
}

/** 异步 spawn（长驻进程：emulator / appium server），输出带前缀转发到控制台 */
export function spawnLongLived(
  label: string,
  cmd: string,
  args: string[],
  options: { detached?: boolean } = {},
) {
  const proc = spawn(cmd, args, {
    env: cleanEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: options.detached ?? false,
  });
  proc.stdout?.on("data", (d: Buffer) => {
    for (const line of d.toString().split("\n")) {
      if (line.trim()) console.log(`[${label}] ${line}`);
    }
  });
  proc.stderr?.on("data", (d: Buffer) => {
    for (const line of d.toString().split("\n")) {
      if (line.trim()) console.log(`[${label}:err] ${line}`);
    }
  });
  return proc;
}

/** 显式等待工具：轮询直到条件满足或超时（基建层允许 sleep 轮询；测试断言层用 WebdriverIO waitUntil） */
export async function waitFor(
  label: string,
  check: () => Promise<boolean> | boolean,
  timeoutMs: number,
  intervalMs = 2_000,
  failFast = false,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      if (await check()) {
        console.log(`[android-e2e] ✓ ${label}`);
        return;
      }
    } catch (e) {
      // failFast：调用方标记的致命错误（如子进程已退出）立即上抛，不等满超时
      if (failFast) throw e;
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const detail = lastError instanceof Error ? `（最后一次错误: ${lastError.message}）` : "";
  throw new Error(`[android-e2e] 等待超时（${timeoutMs / 1000}s）: ${label}${detail}`);
}

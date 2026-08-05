/**
 * 构建安装模块：编译 debug APK 并安装到目标模拟器。
 *
 * 构建复用根脚本 `pnpm build:android`（ADR-0059 委托约定）；支持
 * ANDROID_E2E_SKIP_BUILD=1 跳过编译直接使用既有产物（本地快速迭代）。
 */
import { existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  adbPath,
  APK_PATH,
  cleanEnv,
  REPO_ROOT,
  runCapture,
  runOrThrow,
  TIMEOUTS,
  waitFor,
} from "./env";

/** 编译 debug APK（在 monorepo 根目录跑 pnpm build:android），带超时与流式输出。
 *  E2E 构建用 --mode e2e（含 window.pictelioE2e 钩子）；普通 build:android 无钩子。 */
export async function buildDebugApk(): Promise<void> {
  if (process.env.ANDROID_E2E_SKIP_BUILD === "1") {
    console.log("[android-e2e] ANDROID_E2E_SKIP_BUILD=1，跳过编译，直接使用既有 APK");
  } else {
    // E2E 模式：完整 build:android 流程，但 web 构建带 --mode e2e（define __E2E__=true 保留钩子）。
    // 等价于 pnpm build:android 中 vp run build → vp build --mode e2e。
    const buildArgs =
      process.env.ANDROID_E2E_BUILD_MODE === "e2e"
        ? ["run", "build:android:e2e"]
        : ["run", "build:android"];
    console.log(`[android-e2e] 编译 debug APK（${buildArgs.join(" ")}，可能耗时数分钟）...`);
    const startedAt = Date.now();
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const proc = spawn("pnpm", buildArgs, {
        cwd: REPO_ROOT,
        env: cleanEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        rejectPromise(
          new Error(
            `[android-e2e] 编译超时（${TIMEOUTS.build / 1000}s）。可先手动跑 pnpm build:android 后用 ANDROID_E2E_SKIP_BUILD=1 跳过`,
          ),
        );
      }, TIMEOUTS.build);
      proc.stdout?.on("data", (d: Buffer) => process.stdout.write(`[build] ${d.toString()}`));
      proc.stderr?.on("data", (d: Buffer) => process.stdout.write(`[build:err] ${d.toString()}`));
      proc.on("error", (e) => {
        clearTimeout(timer);
        rejectPromise(new Error(`[android-e2e] 无法启动 pnpm: ${e.message}`));
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolvePromise();
        else
          rejectPromise(
            new Error(`[android-e2e] ${buildArgs.join(" ")} 退出码 ${code}，请先手动跑通该命令`),
          );
      });
    });
    console.log(`[android-e2e] ✓ APK 编译完成（${Math.round((Date.now() - startedAt) / 1000)}s）`);
  }

  if (!existsSync(APK_PATH)) {
    throw new Error(
      `[android-e2e] APK 产物不存在: ${APK_PATH}\n` +
        `请先在仓库根目录执行 pnpm build:android（或取消 ANDROID_E2E_SKIP_BUILD）`,
    );
  }
  const sizeMb = (statSync(APK_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`[android-e2e] APK 就绪: ${APK_PATH}（${sizeMb} MB）`);
}

/** 安装 APK 到指定模拟器并等待 package manager 就绪 */
export async function installApk(serial: string): Promise<void> {
  // 先确认 package manager 服务可用（boot 刚完成时 pm 可能尚未就绪）
  await waitFor(
    `设备 ${serial} package manager 就绪`,
    () => runCapture(adbPath(), ["-s", serial, "shell", "pm", "list", "packages", "-e"]).code === 0,
    60_000,
  );
  console.log(`[android-e2e] 安装 APK 到 ${serial}...`);
  runOrThrow(adbPath(), ["-s", serial, "install", "-r", "-d", APK_PATH], TIMEOUTS.install);
  console.log(`[android-e2e] ✓ APK 安装完成`);
}

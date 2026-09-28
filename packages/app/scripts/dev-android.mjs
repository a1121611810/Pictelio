#!/usr/bin/env node
/* eslint-disable no-await-in-loop */
/**
 * 一键构建并安装 Android debug APK（沙盒 #610：单引擎 Lynx）。
 *
 * 流程：
 * 1. 同步 versionCode/versionName 与 OAuth 凭据常量
 * 2. 构建 Lynx bundle（app-lynx）
 * 3. 同步 bundle 到 android assets
 * 4. 编译 debug APK
 * 5. 通过 adb 安装到已连接设备
 *
 * ⚠️ 沙盒 #610 的口径变更：原流程是「起 Vite dev server + cap:sync 把
 * CAPACITOR_DEV_SERVER_URL 写进 WebView 壳」。WebView/Capacitor 线整体下线后，
 * 该形态不存在——APK 直接从 assets 加载 main.lynx.bundle，没有 dev server 可指，
 * 故不再有热重载形态的 debug 构建。这里的 "dev" 仅指 debug 变体。
 *
 * 前置条件：
 * - adb 已连接设备（有线/无线均可）
 * - 项目依赖已安装（pnpm install）
 */
import { spawn } from "node:child_process";

const APK_PATH = "android/app/build/outputs/apk/debug/app-debug.apk";

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n▶ ${cmd} ${args.join(" ")}`);
    const proc = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });
    proc.on("close", (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`命令退出码 ${code}: ${cmd} ${args.join(" ")}`));
      }
    });
  });
}

async function main() {
  try {
    await run("node", ["scripts/sync-android-version.mjs"]);
    await run("node", ["scripts/sync-credentials.mjs"]);

    // Lynx 客户端本体：rspeedy bundle → android assets（LynxActivity 加载的就是它）
    await run("pnpm", ["--dir", "../app-lynx", "run", "build"], {
      env: { ...process.env, NODE_ENV: "production" },
    });
    await run("node", ["../app-lynx/scripts/sync-android-assets.mjs"]);

    await run("./gradlew", ["assembleDebug"], { cwd: "android" });
    await run("adb", ["install", "-r", APK_PATH]);

    console.log("\n✅ 完成！APK 已安装。");
    console.log("   启动：adb shell monkey -p io.pictelio.app 1");
  } catch (error) {
    console.error("\n❌ 出错:", error.message);
    process.exit(1);
  }
}

main();

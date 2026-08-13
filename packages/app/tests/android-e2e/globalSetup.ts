/**
 * Android 模拟器 E2E 的 global setup（轻量版）。
 *
 * 只做一件事：把 `packages/app/.env` 中的变量注入 `process.env`（若尚未设置），
 * 使登录类 spec（switch-client-oneway/roundtrip/roundtrip-3x）能读到
 * `PIXIV_REFRESH_TOKEN`，与 agent-browser E2E 的 `ai-shared/globalSetup.ts`
 * `loadEnvFile()` 行为一致。
 *
 * 刻意不启动 Vite dev server（Android E2E 编译真实 APK 走 WebView，不需要 dev server）。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

function loadEnvFile(): void {
  // 本文件位于 packages/app/tests/android-e2e/，env 文件在 packages/app/.env
  const envPath = pathResolve(fileURLToPath(import.meta.url), "../../../.env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && value && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

export default function setup(): void {
  loadEnvFile();
}

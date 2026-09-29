/**
 * Android 模拟器 E2E 的 global setup（轻量版）。
 *
 * 只做一件事：把 `packages/app-lynx/.env` 中的变量注入 `process.env`（若尚未设置），
 * 使需要登录的 spec 能读到 `PIXIV_REFRESH_TOKEN`——单引擎布局下走
 * `prefs.loginViaDevIntent()`（LynxActivity 的 dev intent hook），
 * 与 agent-browser E2E 的 `ai-shared/globalSetup.ts` `loadEnvFile()` 行为一致。
 *
 * 刻意不启动 Vite dev server（Android E2E 编译真实 APK，不需要 dev server）。
 *
 * ADR-0203：env 文件随凭证事实源一起归位到唯一客户端包 `packages/app-lynx`
 * （`credentials.json5` 同批迁移，决策 3）。本文件位于
 * `packages/android-host/tests/android-e2e/`，回退 4 级到 packages/ 再进 app-lynx。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

function loadEnvFile(): void {
  const envPath = pathResolve(fileURLToPath(import.meta.url), "../../../../app-lynx/.env");
  // 禁止静默降级（测试硬约束 3）：缺文件不是「没有 token」，而是「登录态 E2E 会
  // 在几百秒编译 + 模拟器 boot 之后才以一条看不懂的断言失败」。此处点名暴露。
  if (!existsSync(envPath)) {
    console.warn(
      `[android-e2e] 未找到 ${envPath}：需要登录的 spec 将拿不到 PIXIV_REFRESH_TOKEN。` +
        `请在 packages/app-lynx/.env 配置该键，或运行前显式 export。`,
    );
    return;
  }
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

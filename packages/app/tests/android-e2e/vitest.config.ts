import { defineConfig } from "vitest/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Android 模拟器 E2E（Appium + WebdriverIO）独立 vitest 配置。
 *
 * 与 agent-browser E2E 相同的「driver 封装 + vitest 断言」模式，
 * 但无需 dev server / AI 断言，因此不带 ai-shared 的 globalSetup。
 * 配置文件位于 tests/android-e2e/ 下，root 显式指向本目录使 include 相对解析。
 */
const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: configDir,
  test: {
    name: "android-e2e",
    include: ["specs/**/*.spec.ts"],
    environment: "node",
    // 完整链路：编译 APK（分钟级）+ 模拟器 boot + session 创建，超时必须宽松
    testTimeout: 300_000,
    // 覆盖 beforeAll 里 setupAndroidE2e 的最坏耗时（编译 600s + boot 300s + install 180s + session 180s）；
    // 各步骤内部另有自己的超时与报错（见 env.ts TIMEOUTS），hook 兜底放宽即可
    hookTimeout: 1_500_000,
    // 模拟器测试慢且状态共享，串行执行避免多 spec 争抢同一台模拟器
    fileParallelism: false,
    retry: 0,
  },
});

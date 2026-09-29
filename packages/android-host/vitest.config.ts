import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // 第二条 glob 是**修过一次门禁漏洞的成果**，不是顺手加的（issue #818）。
    // `tests/android-e2e/unit/**` 是 android-e2e 契约工具的**纯函数单测**
    // （不碰 adb / 模拟器）。它们原先只被 `tests/android-e2e/vitest.config.ts` 收，
    // 而跑该目录的唯一脚本要连带编译 APK + 起模拟器 ⇒ 这批单测**默认永不执行**，
    // 也不进 `pnpm test:all` / CI（CI 只跑 `test:all`）——静默失明数月。
    // `passWithNoTests: false` 只能发现「一个都没收集到」，发现不了「少了一个目录」，
    // 所以两条 glob 都**逐条列出**，不合并成一条 `tests/**`。
    // 回归防线：`tests/unit/e2eContractSuiteCollected.test.ts` 断言这 8 个文件既在
    // 磁盘上、又被本配置的 include 命中。守门人**故意放在 tests/unit/** 而不是
    // 被守目录里——放进去的话，glob 一被摘掉守门人自己也一起消失，防线归零
    // （2026-09-29 实测：放里面的那版，摘 glob 后 vitest 直接报 "No test files found"）。
    include: ["tests/unit/**/*.test.ts", "tests/android-e2e/unit/**/*.test.ts"],
    // 模拟器 spec（`specs/**.spec.ts`）由 tests/android-e2e/vitest.config.ts 收，
    // 需要真实 AVD，**不得**被本配置捞进来（否则 CI 会被拖死）。
    exclude: ["**/node_modules/**", "tests/android-e2e/specs/**"],
    // T0 门禁（ADR-0097，防空壳漂移）：测试文件被误删/被移出 include 必须立刻红。
    passWithNoTests: false,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // T0 门禁（ADR-0097，防空壳漂移）：本包目前只有「核心缝」一个测试文件，
    // 一旦被误删/被移出 include，必须立刻红，而不是静默 0 tests 通过。
    passWithNoTests: false,
  },
});

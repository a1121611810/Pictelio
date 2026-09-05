// @vitest-environment node
/**
 * splashBridge 单测（#365 FT-2 审查修复：markContentReady 是「splash 提前释放 +
 * 多调用点兜底」安全论证的承重墙，幂等契约与 web 降级路径必须有测试锁定）。
 *
 * oracle 溯源：
 * - 幂等语义 = src/native/splashBridge.ts 头注释「仅首次调用实际执行」——
 *   __root.tsx（双 rAF 主路径 + auth 兜底）、HomePage、Login 多调用点依赖
 *   「先到先释放、后到 no-op」才不会互相踩踏；
 * - web 降级 warn = 测试硬约束 #3（禁止静默降级）：AuthPlugin 在 Web 环境
 *   registerPlugin 不可用而 reject，必须 console.warn 暴露而非吞掉；
 * - 失败不重试 = contentReady 锁定先于 hideSplash 结果，失败后由后续调用点
 *   兜底语义承接（Android 侧 MainActivityWebview 另有原生 dismiss 路径）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const hideSplash = vi.hoisted(() => vi.fn());

vi.mock("@/native/AuthPlugin", () => ({
  AuthPlugin: { hideSplash },
}));

describe("splashBridge markContentReady", () => {
  beforeEach(() => {
    hideSplash.mockReset();
    // mockReset 会清掉实现（返回 undefined 而非 Promise）——默认补一个成功兑现
    hideSplash.mockResolvedValue(undefined);
    vi.resetModules();
  });

  it("幂等：多次调用仅首次触发 hideSplash", async () => {
    const { markContentReady } = await import("@/native/splashBridge");

    markContentReady();
    markContentReady();
    markContentReady();

    expect(hideSplash).toHaveBeenCalledTimes(1);
  });

  it("web 降级：AuthPlugin reject 时 console.warn 暴露，不静默吞掉", async () => {
    hideSplash.mockRejectedValue(new Error("AuthPlugin not available on web"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { markContentReady } = await import("@/native/splashBridge");

    markContentReady();
    await Promise.resolve();
    await Promise.resolve();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[splashBridge]"), expect.any(Error));
  });

  it("失败不重试：幂等锁定先于 hideSplash 结果，后续调用不再触发", async () => {
    hideSplash.mockRejectedValue(new Error("boom"));
    const { markContentReady } = await import("@/native/splashBridge");

    markContentReady();
    await Promise.resolve();
    await Promise.resolve();
    markContentReady();

    expect(hideSplash).toHaveBeenCalledTimes(1);
  });
});

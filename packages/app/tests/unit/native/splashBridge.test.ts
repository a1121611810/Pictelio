// @vitest-environment node
/**
 * splashBridge 单测（#365 FT-2 审查修复：markContentReady 是「splash 提前释放 +
 * 多调用点兜底」安全论证的承重墙，幂等契约与 web 守卫路径必须有测试锁定）。
 *
 * oracle 溯源：
 * - 幂等语义 = src/native/splashBridge.ts 头注释「仅首次调用实际执行」——
 *   __root.tsx（双 rAF 主路径 + auth 兜底）、HomePage、Login 多调用点依赖
 *   「先到先释放、后到 no-op」才不会互相踩踏；
 * - web 守卫 = isNativePlatform() === false 时早返回，根本不发 IPC——
 *   消除启动期「AuthPlugin not implemented on web」噪音（spec #422 D3）；
 * - 失败不重试 = contentReady 锁定先于 hideSplash 结果，失败后由后续调用点
 *   兜底语义承接（Android 侧 MainActivityWebview 另有原生 dismiss 路径）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const hideSplash = vi.hoisted(() => vi.fn());

vi.mock("@/native/AuthPlugin", () => ({
  AuthPlugin: { hideSplash },
}));

// 平台守卫 mock：默认 native=true（保留旧契约），web 用例单独 mockReturnValue(false)
const mockIsNativePlatform = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/utils/platform", () => ({
  isNativePlatform: () => mockIsNativePlatform(),
}));

describe("splashBridge markContentReady", () => {
  beforeEach(() => {
    hideSplash.mockReset();
    hideSplash.mockResolvedValue(undefined);
    mockIsNativePlatform.mockReset();
    mockIsNativePlatform.mockReturnValue(true); // 默认 native 行为
    vi.resetModules();
  });

  it("幂等：多次调用仅首次触发 hideSplash", async () => {
    const { markContentReady } = await import("@/native/splashBridge");

    markContentReady();
    markContentReady();
    markContentReady();

    expect(hideSplash).toHaveBeenCalledTimes(1);
  });

  it("native 环境：正常调 hideSplash", async () => {
    const { markContentReady } = await import("@/native/splashBridge");

    markContentReady();
    await Promise.resolve();
    await Promise.resolve();

    expect(hideSplash).toHaveBeenCalledTimes(1);
  });

  it("web 守卫：isNativePlatform=false 早返回，根本不发 IPC（消除 plugin-not-implemented 噪音）", async () => {
    mockIsNativePlatform.mockReturnValue(false);
    const { markContentReady } = await import("@/native/splashBridge");

    markContentReady();
    await Promise.resolve();
    await Promise.resolve();

    // 核心 oracle：web 环境 hideSplash 调用次数为 0（真因消除，非日志降级）
    expect(hideSplash).not.toHaveBeenCalled();
  });

  it("web 守卫后仍保持幂等标志：后续 native 调用也不会触发（contentReady 已锁）", async () => {
    mockIsNativePlatform.mockReturnValue(false);
    const { markContentReady } = await import("@/native/splashBridge");

    markContentReady();
    mockIsNativePlatform.mockReturnValue(true);
    markContentReady();

    expect(hideSplash).not.toHaveBeenCalled();
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

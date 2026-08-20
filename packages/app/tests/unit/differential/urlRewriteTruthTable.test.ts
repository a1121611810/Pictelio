// app 侧 rewriteUrl（web 分支）差分测试：以共享差分契约表为 oracle。
// 期望值来源 = 共享差分契约表（sharedUrlRewriteCases.ts；app ↔ app-lynx 同语义模块差分，
// spec #187 决策 2 / ticket #194；app 已按 ADR-0100 对齐 lynx #165，8 行双端一致，无契约差异 note）。
// web 模式 = Capacitor.isNativePlatform() 为 false：rewriteUrl 依赖模块级 isNative
// （client.ts 顶层环境探测）——用 vi.mock("@capacitor/core") + vi.hoisted isNativeMock
// 置 false，vi.resetModules() 后动态导入捕获（client.test.ts 的 loadModule 模式）；
// @/native/PixivApi 一并 mock，隔离原生桥。
import { describe, expect, it, vi } from "vitest";
import { URL_REWRITE_CASES } from "./sharedUrlRewriteCases";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => isNativeMock(),
  },
  registerPlugin: vi.fn(() => ({
    request: vi.fn(),
    syncToken: vi.fn(),
    prefetchImage: vi.fn(),
  })),
}));

const { isNativeMock } = vi.hoisted(() => ({ isNativeMock: vi.fn(() => false) }));

vi.mock("@/native/PixivApi", () => ({
  PixivApi: { request: vi.fn(), syncToken: vi.fn(), prefetchImage: vi.fn() },
}));

describe("rewriteUrl web 分支 × 共享差分契约表（URL 重写差分）", () => {
  it.each(URL_REWRITE_CASES)("$id → $expectedWebApp", async (c) => {
    vi.resetModules();
    const { rewriteUrl } = await import("@/api/client");
    expect(rewriteUrl(c.input)).toBe(c.expectedWebApp);
  });
});

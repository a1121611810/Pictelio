// app 侧 classifyError 差分测试：以共享差分契约表为 oracle。
// 期望值来源 = 真实 OAuth 快照（pixivpy#374 / gallery-dl#9331）+ 共享差分契约表
// （sharedOAuthErrorCases.ts；app ↔ app-lynx 同语义模块差分，ticket #194）。
// 断言用枚举成员 ApiErrorType[key]（T4 已统一两端枚举为大写），规避历史大小写差异。
// classifyError 为纯函数可直接测试；client.ts 顶层探测（Capacitor.isNativePlatform）
// 在模块加载时求值，仍需 mock（isNative 不参与本表路径），@/native/PixivApi 一并 mock。
import { describe, expect, it, vi } from "vitest";
import { ApiErrorType } from "@/api/types";
import { OAUTH_ERROR_CLASSIFY_CASES } from "./sharedOAuthErrorCases";

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

describe("classifyError × 共享差分契约表（OAuth 400 错误分类差分）", () => {
  it.each(OAUTH_ERROR_CLASSIFY_CASES)("$id → $expectedTypeKey", async (c) => {
    vi.resetModules();
    const { classifyError } = await import("@/api/client");
    const error = c.errorKind === "TypeError" ? new TypeError("fetch failed") : null;
    const err = classifyError(c.status, error, c.responseBody);
    expect(err.type).toBe(ApiErrorType[c.expectedTypeKey]);
  });
});

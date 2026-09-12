// Oracle 溯源（仓库测试硬约束 #6）：messageKey 的 zh 渲染必须与 classifyError 的
// message 快照逐字一致（差分断言，非实现重算）；en 期望值出自 docs/style-guides/ui-copy.md
// 校对样例（真实字面量）。
import { describe, expect, it, vi } from "vitest";
import { ApiErrorType } from "@/api/types";
import { classifyError, toApiError } from "@/api/client";
import { apiErrorMessage, setLanguage, t } from "@/i18n";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("B1 错误文案 key 化：messageKey 渲染 ≡ message 快照（zh 差分）", () => {
  const cases: Array<[number, unknown]> = [
    [401, undefined],
    [401, { errors: { system: { message: "invalid grant", code: 912 } } }],
    [403, undefined],
    [403, { message: "nope" }],
    [429, undefined],
    [400, { error: "invalid_grant" }],
    [500, undefined],
    [503, { message: "boom" }],
    [404, undefined],
    [0, undefined],
  ];

  it.each(cases)("HTTP %# → zh 渲染 ≡ message", (status, body) => {
    const err = classifyError(status, new TypeError("net"), body);
    expect(err.messageKey).toBeTruthy();
    expect(apiErrorMessage(err)).toBe(err.message);
  });

  it("proxy_error 优先于状态码分类，key 渲染一致", () => {
    const err = classifyError(502, null, { error: "proxy_error" });
    expect(err.type).toBe(ApiErrorType.PROXY);
    expect(apiErrorMessage(err)).toBe(err.message);
  });

  it("toApiError：默认 fallback 带 key；显式 fallback 不带；空串透传；带 type 透传", () => {
    expect(toApiError(null)).toMatchObject({
      message: "加载失败",
      messageKey: "error.fallback.loadFailed",
    });
    expect(toApiError(null, "自定义兜底")).toEqual({
      type: ApiErrorType.UNKNOWN,
      message: "自定义兜底",
    });
    expect(toApiError(new Error(""))).toEqual({ type: ApiErrorType.UNKNOWN, message: "" });
    // 带 type 的对象透传不加不改：messageKey 随原对象保留
    expect(
      toApiError({ type: ApiErrorType.PROXY, message: "x", messageKey: "error.api.proxy" }).messageKey,
    ).toBe("error.api.proxy");
    expect(toApiError({ type: ApiErrorType.PROXY, message: "x" }).messageKey).toBeUndefined();
  });

  it("en 渲染（风格基线样例）", async () => {
    setLanguage("en");
    // en chunk 异步就绪 + SolidJS 2 批处理 flush，用 waitFor 轮询（同 i18n/index.test.ts 模式）
    await vi.waitFor(() => {
      expect(apiErrorMessage(classifyError(500, null))).toBe("Server error (HTTP 500)");
    });
    expect(apiErrorMessage(classifyError(401, null))).toBe("Session expired (HTTP 401)");
    expect(apiErrorMessage(classifyError(401, null, { message: "bad token" }))).toBe(
      "Session expired (HTTP 401): bad token",
    );
    expect(t("error.api.network")).toBe("Network unavailable. Check your connection.");
    setLanguage("zh-CN");
    await flush();
  });
});

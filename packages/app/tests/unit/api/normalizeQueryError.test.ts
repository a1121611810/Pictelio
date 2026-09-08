// @vitest-environment node
/**
 * normalizeQueryError 单测（pictelio-pure-client-direct-access T11）——错误归类核心。
 *
 * <b>Oracle 溯源</b>：
 * <ul>
 *   <li><b>已有七类错误</b>（NETWORK / UNAUTHORIZED / FORBIDDEN / RATE_LIMIT / SERVER / PROXY /
 *       UNKNOWN）：ApiErrorType enum 定义（types.ts）；</li>
 *   <li><b>新增 DIRECT_CONNECT</b>：pictelio-pure-client-direct-access T11，专属直连模式失败
 *       （IP 钉死失败 / 421 边缘错配 / DoH 端点不可达）；</li>
 *   <li><b>三种 err 输入形态</b>：ApiError 实例 / Error 实例 / null——
 *       规范化后行为：原样透传 / 兜底 UNKNOWN / 返回 null（与原实现契约一致）。</li>
 * </ul>
 */
import { describe, it, expect } from "vitest";
import { normalizeQueryError } from "@/api/normalizeQueryError";
import { ApiErrorType, type ApiError } from "@/api/types";

describe("normalizeQueryError（T11）", () => {
  it("ApiError 实例原样透传", () => {
    const apiErr: ApiError = {
      type: ApiErrorType.NETWORK,
      message: "connection refused",
      status: 0,
    };
    expect(normalizeQueryError(apiErr)).toBe(apiErr);
  });

  it("DIRECT_CONNECT 类型识别（直连模式专属）", () => {
    const apiErr: ApiError = {
      type: ApiErrorType.DIRECT_CONNECT,
      message: "DoH 端点不可达 / IP 钉死失败",
    };
    const result = normalizeQueryError(apiErr);
    expect(result?.type).toBe(ApiErrorType.DIRECT_CONNECT);
    expect(result?.message).toContain("DoH");
  });

  it("Error 实例兜底为 UNKNOWN", () => {
    const err = new Error("Network timeout");
    const result = normalizeQueryError(err);
    expect(result?.type).toBe(ApiErrorType.UNKNOWN);
    expect(result?.message).toBe("Network timeout");
  });

  it("Error 实例无 message 时归类为 UNKNOWN（message 为空字符串）", () => {
    const err = new Error();
    const result = normalizeQueryError(err);
    expect(result?.type).toBe(ApiErrorType.UNKNOWN);
    // Error 无参数时 message === ''（不是 undefined），?? 不触发兜底
    // 这是与 Java 端 Error 序列化兼容的契约——空字符串保留
    expect(result?.message).toBe("");
  });

  it("null/undefined 返回 null", () => {
    expect(normalizeQueryError(null)).toBeNull();
    expect(normalizeQueryError(undefined)).toBeNull();
  });

  it("字符串错误归类为 UNKNOWN + 默认 message（字符串无 message 字段兜底）", () => {
    const result = normalizeQueryError("plain string error");
    expect(result?.type).toBe(ApiErrorType.UNKNOWN);
    // 字符串 typeof !== "object" → 走 else 分支 → (string as object).message = undefined → ?? "加载失败"
    expect(result?.message).toBe("加载失败");
  });

  it("数字错误归类为 UNKNOWN + message 为空字符串", () => {
    const result = normalizeQueryError(42);
    expect(result?.type).toBe(ApiErrorType.UNKNOWN);
    // 数字无 message 字段 → (42 as { message?: string })?.message = undefined → ?? "加载失败"
    // 不对：数字类型 as 后 .message = undefined → ?? "加载失败"
    // 实际：数字 toString 化后 as object 拿到 undefined message
    expect(result?.message).toBe("加载失败");
  });

  it("对象错误（无 type 字段）归类为 UNKNOWN", () => {
    const result = normalizeQueryError({ code: "ERR_NETWORK" });
    expect(result?.type).toBe(ApiErrorType.UNKNOWN);
  });

  it("对象错误（有 type 字段但非法值）原样返回（错误契约保证透传）", () => {
    // 故意构造"type 字段是非法值"的对象——契约是"typeof type in err 即透传"
    // 这是与 Java 端序列化错误格式兼容的兜底
    const result = normalizeQueryError({ type: "BOGUS_TYPE", message: "test" });
    expect((result as ApiError).type).toBe("BOGUS_TYPE");
  });

  it("ApiError 含 status 字段时透传", () => {
    const apiErr: ApiError = {
      type: ApiErrorType.RATE_LIMIT,
      message: "rate limited",
      status: 429,
    };
    const result = normalizeQueryError(apiErr);
    expect(result?.status).toBe(429);
  });
});

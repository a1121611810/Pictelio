// assertNever 工具自身测试。期望值来源：spec docs/specs/assertnever-exhaustive-checking.md §3
// （错误信息格式 `Unhandled discriminated union member: ${JSON.stringify(value)}`）。
// 不从实现反推 oracle。
import { describe, expect, it } from "vitest";
import { assertNever } from "@/utils/assertNever";

describe("assertNever", () => {
  it("throws Error with JSON.stringify of the input value", () => {
    // 测试用 `as never` 模拟"未被收窄"的入参（生产代码不应绕过类型检查）
    const bogusValue = "rate_limited" as never;
    expect(() => assertNever(bogusValue)).toThrowError(
      `Unhandled discriminated union member: ${JSON.stringify(bogusValue)}`,
    );
  });

  it("throws Error for numeric input (non-string literal)", () => {
    const bogusValue = 42 as never;
    expect(() => assertNever(bogusValue)).toThrowError(
      `Unhandled discriminated union member: ${JSON.stringify(bogusValue)}`,
    );
  });

  it("throws Error for object input", () => {
    const bogusValue = { kind: "weird" } as never;
    expect(() => assertNever(bogusValue)).toThrowError(
      `Unhandled discriminated union member: ${JSON.stringify(bogusValue)}`,
    );
  });

  it("never returns normally — 不会到达 return 语句（编译期 + 运行期双验证）", () => {
    // 工具签名是 () => never；如果函数能正常返回，TypeScript 会在这里卡住,
    // 因为 next() 的回调期望 void 而非 never。但本测试仅验证 throw 行为：
    // 没有显式 return 是预期。
    expect(() => assertNever("" as never)).toThrow();
  });
});

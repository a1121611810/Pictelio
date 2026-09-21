// assertNever 工具自身测试。期望值来源：spec docs/specs/assertnever-exhaustive-checking.md §3
// （错误信息格式 `Unhandled discriminated union member: ${JSON.stringify(value)}`）。
// 不从实现反推 oracle。spec 修订历史节解释本工具从 spec v1 的"app-lynx inline throw" 改为 v2 的双端复制。
import { describe, expect, it } from "vitest";
import { assertNever } from "@/utils/assertNever";

describe("assertNever", () => {
  it("throws Error with JSON.stringify of the input value (string)", () => {
    // 测试用 `as never` 模拟"未被收窄"的入参（生产代码不应绕过类型检查）
    const bogusValue = "rate_limited" as never;
    expect(() => assertNever(bogusValue)).toThrow(
      `Unhandled discriminated union member: ${JSON.stringify(bogusValue)}`,
    );
  });

  it("throws Error with JSON.stringify of numeric input", () => {
    const bogusValue = 42 as never;
    expect(() => assertNever(bogusValue)).toThrow(
      `Unhandled discriminated union member: ${JSON.stringify(bogusValue)}`,
    );
  });

  it("throws Error with JSON.stringify of object input", () => {
    const bogusValue = { kind: "weird" } as never;
    expect(() => assertNever(bogusValue)).toThrow(
      `Unhandled discriminated union member: ${JSON.stringify(bogusValue)}`,
    );
  });

  // 类型层契约（tsc-only）：assertNever 拒绝任何非 `never` 入参。
  // 生产代码中调用方必须把已收窄到 `never` 的变量传入；此注解守住该契约。
  // 用 `@ts-expect-error` 而非 `as never` cast（后者绕过类型检查，不构成 oracle）。
  it("rejects non-never input at compile time (type-level contract)", () => {
    // @ts-expect-error — string is not assignable to parameter of type 'never'
    expect(() => assertNever("hello" as never)).toThrow();
  });
});

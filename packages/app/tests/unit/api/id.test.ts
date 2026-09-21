// Branded Types seam 单测。期望值 oracle：spec docs/specs/branded-types-for-api-ids.md §3。
// 不从实现反推。
//
// 测试结构：
// 1. 运行时：工厂函数接受 number 输入，运行时透传（Branding 是编译期操作，运行时仅 cast）。
// 2. 类型层契约：`// @ts-expect-error` 钉死 "拒绝任何非 number 入参"——tsc-only 防线。
//    若 tsc 实际接受（注解失效），测试因编译失败而失败——这是契约机制本身。

import { describe, expect, it } from "vitest";
import { toChapterId, toIllustId, toNovelId, toSeriesId, toUserId } from "@/api/id";

describe("toIllustId", () => {
  it("returns the same value (positive int)", () => {
    const result = toIllustId(12345);
    expect(typeof result).toBe("number");
    expect(result).toBe(12345);
  });

  it("accepts 0 (structurally a number)", () => {
    expect(toIllustId(0)).toBe(0);
  });

  it("accepts float (no range validation in P2 scope)", () => {
    expect(toIllustId(3.14)).toBe(3.14);
  });

  // 类型层契约：拒绝任何非 number 入参（tsc-only）。
  // 函数运行时透传；本注解守住"编译期拒绝非 number"的契约。
  // 若 tsc 不再拒绝（注解失效），下方测试将编译失败——这是设计。
  it("rejects non-number input at compile time", () => {
    // @ts-expect-error — string is not assignable to parameter of type 'number'
    const _r = toIllustId("hello");
    // 运行时不会抛（函数体仅 cast），但类型层已拦住——这是契约的核心
    expect(typeof _r).toBe("string");
  });
});

describe("toNovelId", () => {
  it("returns the same value (positive int)", () => {
    expect(toNovelId(99999)).toBe(99999);
  });
  it("accepts 0", () => {
    expect(toNovelId(0)).toBe(0);
  });
  it("accepts float", () => {
    expect(toNovelId(2.5)).toBe(2.5);
  });
  it("rejects non-number input at compile time", () => {
    // @ts-expect-error — null is not assignable to parameter of type 'number'
    const _r = toNovelId(null);
    expect(_r).toBeNull();
  });
});

describe("toUserId", () => {
  it("returns the same value (positive int)", () => {
    expect(toUserId(9981)).toBe(9981);
  });
  it("accepts 0", () => {
    expect(toUserId(0)).toBe(0);
  });
  it("accepts float", () => {
    expect(toUserId(1.5)).toBe(1.5);
  });
  it("rejects non-number input at compile time", () => {
    // @ts-expect-error — undefined is not assignable to parameter of type 'number'
    const _r = toUserId(undefined);
    expect(_r).toBeUndefined();
  });
});

describe("toSeriesId", () => {
  it("returns the same value (positive int)", () => {
    expect(toSeriesId(1024)).toBe(1024);
  });
  it("accepts 0", () => {
    expect(toSeriesId(0)).toBe(0);
  });
  it("accepts float", () => {
    expect(toSeriesId(0.5)).toBe(0.5);
  });
  it("rejects non-number input at compile time", () => {
    // @ts-expect-error — object is not assignable to parameter of type 'number'
    const _r = toSeriesId({});
    expect(typeof _r).toBe("object");
  });
});

describe("toChapterId", () => {
  it("returns the same value (positive int)", () => {
    expect(toChapterId(42)).toBe(42);
  });
  it("accepts 0", () => {
    expect(toChapterId(0)).toBe(0);
  });
  it("accepts float", () => {
    expect(toChapterId(7.7)).toBe(7.7);
  });
  it("rejects non-number input at compile time", () => {
    // @ts-expect-error — array is not assignable to parameter of type 'number'
    const _r = toChapterId([]);
    expect(Array.isArray(_r)).toBe(true);
  });
});

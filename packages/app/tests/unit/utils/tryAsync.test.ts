import { describe, it, expect, vi } from "vitest";
import { tryAsync, trySync } from "@/utils/tryAsync";

// ── tryAsync ──

describe("tryAsync", () => {
  it("Promise resolve → [null, data]", async () => {
    const p = Promise.resolve(42);
    const [err, data] = await tryAsync(p);

    expect(err).toBeNull();
    expect(data).toBe(42);
  });

  it("Promise reject → [Error, undefined]", async () => {
    const p = Promise.reject(new Error("boom"));
    const [err, data] = await tryAsync(p);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("boom");
    expect(data).toBeUndefined();
  });

  it("Promise reject with string → 错误保持原类型", async () => {
    const p = Promise.reject("string error");
    const [err, data] = await tryAsync(p);

    expect(err).toBe("string error");
    expect(data).toBeUndefined();
  });

  it("errorExt 参数 → 错误对象获得额外属性", async () => {
    const p = Promise.reject(new Error("boom"));
    const [err] = await tryAsync(p, { code: 123, context: "test" });

    expect((err as Error & { code: number }).code).toBe(123);
    expect((err as Error & { context: string }).context).toBe("test");
  });

  it("Promise resolve with undefined → [null, undefined]", async () => {
    const p = Promise.resolve(undefined);
    const [err, data] = await tryAsync(p);

    expect(err).toBeNull();
    expect(data).toBeUndefined();
  });
});

// ── trySync ──

describe("trySync", () => {
  it("函数返回正常 → [null, value]", () => {
    const [err, data] = trySync(() => "hello");

    expect(err).toBeNull();
    expect(data).toBe("hello");
  });

  it("函数抛出错误 → [Error, undefined]", () => {
    const [err, data] = trySync(() => {
      throw new Error("sync boom");
    });

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("sync boom");
    expect(data).toBeUndefined();
  });

  it("函数抛出非 Error 类型 → 保持原类型", () => {
    const [err, data] = trySync(() => {
      throw "string error";
    });

    expect(err).toBe("string error");
    expect(data).toBeUndefined();
  });

  it("JSON.parse 成功 → 解析结果", () => {
    const [err, data] = trySync(() => JSON.parse('{"a":1}'));

    expect(err).toBeNull();
    expect(data).toEqual({ a: 1 });
  });

  it("JSON.parse 失败 → [Error, undefined]", () => {
    const [err, data] = trySync(() => JSON.parse("invalid json"));

    expect(err).toBeInstanceOf(Error);
    expect(data).toBeUndefined();
  });

  it("工厂函数惰性执行 — 不调用时不执行", () => {
    const fn = (() => 42) as () => number;

    // 只传引用，不调用
    const spy = vi.fn(fn);
    trySync(spy);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

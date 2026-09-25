import { describe, expect, it } from "vitest";
import { NATIVE_IMAGE_TIMEOUT_MS, withNativeImageTimeout } from "@/utils/imageLoader";

// 真实短定时器（不用 fake timers：实现内部的 setTimeout 与测试推进互相干扰）
describe("withNativeImageTimeout（#722：原生图片调用永不 settle → Solid flight 永挂 → 调度事务停摆）", () => {
  it("原生调用在超时内 resolve → 原样透传结果", async () => {
    const inner = new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 20));
    const r = await withNativeImageTimeout(inner, "getImage", 500);
    expect(r).toBe("ok");
  });

  it("原生调用超时未 settle → 到时拒绝（flight 得以完成，事务不再停摆）", async () => {
    const inner = new Promise<string>((resolve) => setTimeout(() => resolve("too-late"), 500));
    await expect(withNativeImageTimeout(inner, "prefetchImage", 50)).rejects.toThrow(
      /prefetchImage timeout/,
    );
  });

  it("原生调用 reject → 原样透传拒绝原因（不被超时吞掉）", async () => {
    const inner = new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("native err")), 20),
    );
    await expect(withNativeImageTimeout(inner, "getImage", 500)).rejects.toThrow("native err");
  });

  it("不传自定义超时 → 使用 20s 默认值（立即 settle 的调用不受影响）", async () => {
    expect(NATIVE_IMAGE_TIMEOUT_MS).toBe(20_000);
    const inner = new Promise<string>((resolve) => resolve("fast"));
    const r = await withNativeImageTimeout(inner, "getImage");
    expect(r).toBe("fast");
  });
});

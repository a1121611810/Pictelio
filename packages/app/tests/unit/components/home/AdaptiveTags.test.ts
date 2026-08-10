import { describe, expect, it } from "vitest";
import { computeVisibleTags } from "@/components/home/adaptiveTagFit";

// 契约数据：chip 宽度数组模拟 Pixiv 标签 chip 的真实 offsetWidth（40~110px 不等），
// 「+N」徽标实测宽度（+5 约 28px）
const CHIP_W = [90, 70, 80, 65, 110, 75, 96]; // 7 个标签
const PLUS = 28;

describe("computeVisibleTags（自适应标签动态折叠 v7）", () => {
  it("宽度足够（无预留也全放得下）→ 全部显示、无 +N（不提前折叠）", () => {
    const { visible, remaining } = computeVisibleTags(CHIP_W, PLUS, 720);
    expect(visible).toBe(CHIP_W.length);
    expect(remaining).toBe(0);
  });

  it("宽度不足 → 带 +N 预留贪心：完整 chip 放满 + 截断 chip 占剩余，其余折叠 +N", () => {
    const { visible, remaining, partialWidth } = computeVisibleTags(CHIP_W, PLUS, 260);
    // 完整贪心：90+28=118✓；94+70+4+28=196✓；168+80+4+28=280>260 ✗ → 2 个
    // 剩余 = 260−164−gap4−gap4−plus28 = 60 → 第 3 个截断占 60px，剩余 4 个折叠
    expect(visible).toBe(2);
    expect(partialWidth).toBe(60);
    expect(remaining).toBe(4);
    expect(visible + remaining + 1).toBe(CHIP_W.length);
  });

  it("宽度为 0 → 全部折叠（等容器就绪后重算）", () => {
    const { visible, remaining } = computeVisibleTags(CHIP_W, PLUS, 0);
    expect(visible).toBe(0);
    expect(remaining).toBe(CHIP_W.length);
  });

  it("溢出时预留 +N 从 0 贪心：完整 chip 放满 + 截断 chip 占剩余，其余折叠 +N", () => {
    // 完整贪心：前 5 个 431 + 4 + 75 + 28 = 538 > 514 → 5 个；剩余 514−431−4−4−28 = 47 → 第 6 个截断，剩余 1 个折叠
    const { visible, remaining, partialWidth } = computeVisibleTags(CHIP_W, PLUS, 514);
    expect(visible).toBe(5);
    expect(partialWidth).toBe(47);
    expect(remaining).toBe(1);
  });

  it("不跳过中间 chip（顺序贪心）：放不下就停止，剩余给 +N", () => {
    // 第 2 个（70）后第 3 个（80）放不下 → 停止，显示 2 个 + 剩余
    const { visible, remaining } = computeVisibleTags(CHIP_W, PLUS, 196);
    expect(visible).toBe(2);
    expect(remaining).toBe(5);
  });

  it("空标签 → 无 chip 无 +N", () => {
    const { visible, remaining, partialWidth } = computeVisibleTags([], PLUS, 300);
    expect(visible).toBe(0);
    expect(remaining).toBe(0);
    expect(partialWidth).toBeNull();
  });

  it("用户场景：一个完整 + 第二个占剩余宽度（截断省略号），无 +N", () => {
    // 容器 400：第一个 90 完整放下；第二个 400 完整放不下（90+4+400+28 > 400）→ 截断 chip 占剩余宽度
    const { visible, remaining, partialWidth } = computeVisibleTags([90, 400], PLUS, 400);
    expect(visible).toBe(1);
    // 剩余 = 400 − 90 − gap4 − gap4 − plus28 = 274
    expect(partialWidth).toBe(274);
    expect(remaining).toBe(0);
  });

  it("截断 chip 之后仍有剩余 → 截断 + 折叠 +N", () => {
    // 容器 300：前两个 80/70 完整；第三个 200 截断；之后 +N
    const { visible, remaining, partialWidth } = computeVisibleTags([80, 70, 200, 90], PLUS, 300);
    expect(visible).toBe(2);
    expect(partialWidth).toBe(300 - 80 - 4 - 70 - 4 - 4 - PLUS); // = 110
    expect(remaining).toBe(1); // 第 4 个折叠进 +N
  });

  it("剩余宽度小于最小可读宽度 → 不显示截断 chip，直接折叠 +N", () => {
    // 容器 140：第一个 90 完整；剩余 140-90-4-4-28 = 14 < 16 → 不截断，+1
    const { visible, remaining, partialWidth } = computeVisibleTags([90, 300], PLUS, 140);
    expect(visible).toBe(1);
    expect(partialWidth).toBeNull();
    expect(remaining).toBe(1);
  });
});

// @vitest-environment happy-dom
/**
 * ImageViewer 邻页预取候选纯函数（#366 FT-4）。
 * oracle 溯源：预取语义 = 预取「当前页前后各一页」，跳过已发起/已加载页；
 * 边界 = 首页无前邻、末页无后邻、单页无候选（ ImageViewer 翻页边界一致）。
 */
import { describe, it, expect } from "vitest";
import { neighborPages } from "@/components/ImageViewer";

describe("neighborPages 邻页预取候选", () => {
  const nothing = () => false;

  it("中间页：前后各一页", () => {
    expect(neighborPages(2, 5, nothing)).toEqual([1, 3]);
  });

  it("首页：仅后邻", () => {
    expect(neighborPages(0, 3, nothing)).toEqual([1]);
  });

  it("末页：仅前邻", () => {
    expect(neighborPages(2, 3, nothing)).toEqual([1]);
  });

  it("单页：无候选", () => {
    expect(neighborPages(0, 1, nothing)).toEqual([]);
  });

  it("已发起/已加载的页被跳过", () => {
    expect(neighborPages(2, 5, (i) => i === 1)).toEqual([3]);
    expect(neighborPages(2, 5, (i) => i === 1 || i === 3)).toEqual([]);
  });
});

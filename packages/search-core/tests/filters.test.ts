/**
 * 筛选状态工具真值表。oracle：spec §3.1/§6.3；七档带宽 = 官方 bookmark_ranges（研究文档 §1.2）。
 */
import { describe, expect, it } from "vitest";
import { BOOKMARK_BANDS, countActiveFilters, DEFAULT_SEARCH_FILTERS } from "../src/filters";

describe("BOOKMARK_BANDS", () => {
  it("七档 = 官方 bookmark_ranges（1000+ 无上界）", () => {
    expect(BOOKMARK_BANDS).toEqual([
      { min: 10, max: 29 },
      { min: 30, max: 49 },
      { min: 50, max: 99 },
      { min: 100, max: 299 },
      { min: 300, max: 499 },
      { min: 500, max: 999 },
      { min: 1000, max: null },
    ]);
  });
});

describe("countActiveFilters", () => {
  it("默认 = 0 激活", () => {
    expect(countActiveFilters(DEFAULT_SEARCH_FILTERS)).toBe(0);
  });

  it("逐维度计数（含 AI 覆盖非 follow）", () => {
    expect(
      countActiveFilters({ ...DEFAULT_SEARCH_FILTERS, period: { kind: "preset", preset: "1d" } }),
    ).toBe(1);
    expect(countActiveFilters({ ...DEFAULT_SEARCH_FILTERS, bookmark: BOOKMARK_BANDS[0]! })).toBe(1);
    expect(countActiveFilters({ ...DEFAULT_SEARCH_FILTERS, aiOverride: "hide" })).toBe(1);
    expect(
      countActiveFilters({
        period: { kind: "preset", preset: "1w" },
        bookmark: null,
        ratio: "square",
        minPixels: 1000,
        aiOverride: "all",
        target: "partial",
      }),
    ).toBe(4);
  });

  // oracle：spec docs/specs/search-target-mode.md §6「countActiveFilters：非默认档计 1
  // （筛选入口徽标随之亮）」
  it("档位维：partial 不计激活；exact / title_and_caption 各计 1", () => {
    expect(countActiveFilters({ ...DEFAULT_SEARCH_FILTERS, target: "partial" })).toBe(0);
    expect(countActiveFilters({ ...DEFAULT_SEARCH_FILTERS, target: "exact" })).toBe(1);
    expect(countActiveFilters({ ...DEFAULT_SEARCH_FILTERS, target: "title_and_caption" })).toBe(1);
  });
});

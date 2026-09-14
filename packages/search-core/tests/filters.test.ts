/**
 * 筛选状态工具真值表。oracle：spec §3.1/§6.3；七档带宽 = 官方 bookmark_ranges（研究文档 §1.2）。
 */
import { describe, expect, it } from "vitest";
import {
  BOOKMARK_BANDS,
  countActiveFilters,
  DEFAULT_SEARCH_FILTERS,
  isDefaultFilters,
  normalizeFilters,
} from "../src/filters";

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

describe("countActiveFilters / isDefaultFilters", () => {
  it("默认 = 0 激活", () => {
    expect(countActiveFilters(DEFAULT_SEARCH_FILTERS)).toBe(0);
    expect(isDefaultFilters(DEFAULT_SEARCH_FILTERS)).toBe(true);
  });

  it("逐维度计数（含 AI 覆盖非 follow）", () => {
    expect(countActiveFilters({ ...DEFAULT_SEARCH_FILTERS, period: { kind: "preset", preset: "1d" } })).toBe(1);
    expect(countActiveFilters({ ...DEFAULT_SEARCH_FILTERS, bookmark: BOOKMARK_BANDS[0]! })).toBe(1);
    expect(countActiveFilters({ ...DEFAULT_SEARCH_FILTERS, aiOverride: "hide" })).toBe(1);
    expect(
      countActiveFilters({
        period: { kind: "preset", preset: "1w" },
        bookmark: null,
        ratio: "square",
        minPixels: 1000,
        aiOverride: "all",
      }),
    ).toBe(4);
  });
});

describe("normalizeFilters（不可信输入逐字段校验，非法回默认）", () => {
  it("合法输入保留", () => {
    expect(
      normalizeFilters({
        period: { kind: "preset", preset: "6m" },
        bookmark: 2,
        ratio: "landscape",
        minPixels: 2000,
        aiOverride: "all",
      }),
    ).toEqual({
      period: { kind: "preset", preset: "6m" },
      bookmark: { min: 50, max: 99 },
      ratio: "landscape",
      minPixels: 2000,
      aiOverride: "all",
    });
  });

  it("custom 区间格式/顺序校验", () => {
    expect(normalizeFilters({ period: { kind: "custom", start: "2026-08-01", end: "2026-08-15" } }).period).toEqual({
      kind: "custom",
      start: "2026-08-01",
      end: "2026-08-15",
    });
    expect(normalizeFilters({ period: { kind: "custom", start: "2026-08-15", end: "2026-08-01" } }).period).toEqual({
      kind: "any",
    });
    expect(normalizeFilters({ period: { kind: "custom", start: "x", end: "y" } }).period).toEqual({ kind: "any" });
  });

  it("非法逐字段回默认", () => {
    expect(normalizeFilters({ bookmark: 99 }).bookmark).toBeNull();
    expect(normalizeFilters({ bookmark: -1 }).bookmark).toBeNull();
    expect(normalizeFilters({ bookmark: 1.5 }).bookmark).toBeNull();
    expect(normalizeFilters({ ratio: "wide" }).ratio).toBeNull();
    expect(normalizeFilters({ minPixels: "2000" }).minPixels).toBeNull();
    expect(normalizeFilters({ minPixels: 0 }).minPixels).toBeNull();
    expect(normalizeFilters({ aiOverride: "only" }).aiOverride).toBe("follow");
    expect(normalizeFilters({})).toEqual(DEFAULT_SEARCH_FILTERS);
  });
});

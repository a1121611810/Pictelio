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
  // （筛选入口徽标随之亮）」+ §6「isDefaultFilters 同步纳入 target === 'partial'」
  it("档位维：partial 不计激活；exact / title_and_caption 各计 1", () => {
    expect(countActiveFilters({ ...DEFAULT_SEARCH_FILTERS, target: "partial" })).toBe(0);
    expect(countActiveFilters({ ...DEFAULT_SEARCH_FILTERS, target: "exact" })).toBe(1);
    expect(countActiveFilters({ ...DEFAULT_SEARCH_FILTERS, target: "title_and_caption" })).toBe(1);
  });

  it("档位非默认即 isDefaultFilters=false（默认键的唯一判据）", () => {
    expect(isDefaultFilters({ ...DEFAULT_SEARCH_FILTERS, target: "partial" })).toBe(true);
    expect(isDefaultFilters({ ...DEFAULT_SEARCH_FILTERS, target: "exact" })).toBe(false);
    expect(isDefaultFilters({ ...DEFAULT_SEARCH_FILTERS, target: "title_and_caption" })).toBe(
      false,
    );
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
        target: "exact",
      }),
    ).toEqual({
      period: { kind: "preset", preset: "6m" },
      bookmark: { min: 50, max: 99 },
      ratio: "landscape",
      minPixels: 2000,
      aiOverride: "all",
      target: "exact",
    });
  });

  it("custom 区间格式/顺序校验", () => {
    expect(
      normalizeFilters({ period: { kind: "custom", start: "2026-08-01", end: "2026-08-15" } })
        .period,
    ).toEqual({
      kind: "custom",
      start: "2026-08-01",
      end: "2026-08-15",
    });
    expect(
      normalizeFilters({ period: { kind: "custom", start: "2026-08-15", end: "2026-08-01" } })
        .period,
    ).toEqual({
      kind: "any",
    });
    expect(normalizeFilters({ period: { kind: "custom", start: "x", end: "y" } }).period).toEqual({
      kind: "any",
    });
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

  // oracle：spec docs/specs/search-target-mode.md §6「normalizeFilters：逐字段校验，
  // 非法值回 partial（与既有一致回默认的纪律）」+ §3.1「档位名与 API 原始值不是一回事」
  it("档位逐值校验：三档原样保留；非法值与 API 原始值一律回 partial", () => {
    for (const mode of ["partial", "exact", "title_and_caption"] as const) {
      expect(normalizeFilters({ target: mode }).target).toBe(mode);
    }
    // 原始 search_target 值不是合法档位名——档位与线上值不可混用
    expect(normalizeFilters({ target: "partial_match_for_tags" }).target).toBe("partial");
    expect(normalizeFilters({ target: "exact_match_for_tags" }).target).toBe("partial");
    expect(normalizeFilters({ target: "keyword" }).target).toBe("partial");
    expect(normalizeFilters({ target: "text" }).target).toBe("partial");
    expect(normalizeFilters({ target: "" }).target).toBe("partial");
    expect(normalizeFilters({ target: 7 }).target).toBe("partial");
    expect(normalizeFilters({}).target).toBe("partial");
  });
});

/**
 * 缓存键真值表。oracle：spec §6.2（word_scope_sort + 筛选规范段；aiOverride=follow 不落键）。
 */
import { describe, expect, it } from "vitest";
import { buildCacheKey } from "../src/cacheKey";
import { BOOKMARK_BANDS, DEFAULT_SEARCH_FILTERS } from "../src/filters";

describe("buildCacheKey", () => {
  it("默认筛选 = 基础键（与既有缓存键完全一致，向后兼容）", () => {
    expect(buildCacheKey("東方", "all", "date_desc", DEFAULT_SEARCH_FILTERS)).toBe("東方_all_date_desc");
  });

  it("任一激活维度改变键", () => {
    const base = "東方_all_date_desc";
    const keys = [
      buildCacheKey("東方", "all", "date_desc", { ...DEFAULT_SEARCH_FILTERS, period: { kind: "preset", preset: "1w" } }),
      buildCacheKey("東方", "all", "date_desc", { ...DEFAULT_SEARCH_FILTERS, bookmark: BOOKMARK_BANDS[3]! }),
      buildCacheKey("東方", "all", "date_desc", { ...DEFAULT_SEARCH_FILTERS, ratio: "landscape" }),
      buildCacheKey("東方", "all", "date_desc", { ...DEFAULT_SEARCH_FILTERS, minPixels: 2000 }),
      buildCacheKey("東方", "all", "date_desc", { ...DEFAULT_SEARCH_FILTERS, aiOverride: "hide" }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k.startsWith(`${base}|`)).toBe(true);
  });

  it("aiOverride=follow 不落键（与账号设置态同键）", () => {
    expect(buildCacheKey("w", "all", "date_desc", DEFAULT_SEARCH_FILTERS)).toBe(
      buildCacheKey("w", "all", "date_desc", { ...DEFAULT_SEARCH_FILTERS, aiOverride: "follow" }),
    );
  });

  it("不同筛选间互异（防脏缓存核心断言）", () => {
    const a = buildCacheKey("w", "all", "date_desc", { ...DEFAULT_SEARCH_FILTERS, period: { kind: "preset", preset: "1w" } });
    const b = buildCacheKey("w", "all", "date_desc", { ...DEFAULT_SEARCH_FILTERS, period: { kind: "preset", preset: "1m" } });
    expect(a).not.toBe(b);
  });
});

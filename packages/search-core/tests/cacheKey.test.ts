/**
 * 缓存键真值表。oracle：docs/specs/search-advanced-filters.md §6.2
 * （word_scope_sort + 筛选规范段；aiOverride=follow 不落键）
 * + docs/specs/search-target-mode.md §6「档位落键规则」。
 *
 * ⚠️ 锚点纪律：只引小节号、禁引行号（行号必然随并行改文档漂移）；且裸 `§6.2` 会与
 * search-target-mode.md §6 混读（那里讲的是缓存键可达性），故此处一律带文件名。
 */
import { describe, expect, it } from "vitest";
import { buildCacheKey } from "../src/cacheKey";
import { BOOKMARK_BANDS, DEFAULT_SEARCH_FILTERS } from "../src/filters";

describe("buildCacheKey", () => {
  it("默认筛选 = 基础键（与既有缓存键完全一致，向后兼容）", () => {
    expect(buildCacheKey("東方", "all", "date_desc", DEFAULT_SEARCH_FILTERS)).toBe(
      "東方_all_date_desc",
    );
  });

  it("任一激活维度改变键", () => {
    const base = "東方_all_date_desc";
    const keys = [
      buildCacheKey("東方", "all", "date_desc", {
        ...DEFAULT_SEARCH_FILTERS,
        period: { kind: "preset", preset: "1w" },
      }),
      buildCacheKey("東方", "all", "date_desc", {
        ...DEFAULT_SEARCH_FILTERS,
        bookmark: BOOKMARK_BANDS[3]!,
      }),
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
    const a = buildCacheKey("w", "all", "date_desc", {
      ...DEFAULT_SEARCH_FILTERS,
      period: { kind: "preset", preset: "1w" },
    });
    const b = buildCacheKey("w", "all", "date_desc", {
      ...DEFAULT_SEARCH_FILTERS,
      period: { kind: "preset", preset: "1m" },
    });
    expect(a).not.toBe(b);
  });

  // oracle：docs/specs/search-target-mode.md §6「partial（默认）不落键」
  it("target=partial 与默认档逐字同键（含骨架断言，禁 ft 段）", () => {
    const key = buildCacheKey("東方", "all", "date_desc", {
      ...DEFAULT_SEARCH_FILTERS,
      target: "partial",
    });
    expect(key).toBe(buildCacheKey("東方", "all", "date_desc", DEFAULT_SEARCH_FILTERS));
    expect(key).toBe("東方_all_date_desc");
    expect(key).not.toContain("ft=");
    // 存量非默认筛选的键逐字不变（ft 追加在末尾 ⇒ 升级不撞旧缓存）
    expect(
      buildCacheKey("東方", "all", "date_desc", {
        ...DEFAULT_SEARCH_FILTERS,
        period: { kind: "preset", preset: "1w" },
        target: "partial",
      }),
    ).toBe("東方_all_date_desc|fp=1w");
  });

  // oracle：docs/specs/search-target-mode.md §6「非默认落 ft=exact / ft=title_and_caption」
  it("非默认档落对应 ft 段", () => {
    expect(
      buildCacheKey("東方", "all", "date_desc", { ...DEFAULT_SEARCH_FILTERS, target: "exact" }),
    ).toBe("東方_all_date_desc|ft=exact");
    expect(
      buildCacheKey("東方", "all", "date_desc", {
        ...DEFAULT_SEARCH_FILTERS,
        target: "title_and_caption",
      }),
    ).toBe("東方_all_date_desc|ft=title_and_caption");
  });

  // 段序 oracle：src/cacheKey.ts 追加顺序 fp/fd → fb → fr → fw → fa → ft（ft 在末尾，
  // 存量非默认筛选键逐字不变）。
  it("档位段与其他筛选段共存时键序稳定", () => {
    expect(
      buildCacheKey("東方", "illust", "date_desc", {
        period: { kind: "preset", preset: "1w" },
        bookmark: BOOKMARK_BANDS[3]!,
        ratio: "landscape",
        minPixels: 2000,
        aiOverride: "hide",
        target: "exact",
      }),
    ).toBe("東方_illust_date_desc|fp=1w|fb=3|fr=landscape|fw=2000|fa=hide|ft=exact");
    expect(
      buildCacheKey("東方", "illust", "date_desc", {
        period: { kind: "custom", start: "2026-08-01", end: "2026-08-15" },
        bookmark: null,
        ratio: null,
        minPixels: null,
        aiOverride: "follow",
        target: "title_and_caption",
      }),
    ).toBe("東方_illust_date_desc|fd=2026-08-01_2026-08-15|ft=title_and_caption");
  });

  it("档位维度互异且不与默认档同键（防脏缓存核心断言）", () => {
    const keys = [
      buildCacheKey("w", "all", "date_desc", DEFAULT_SEARCH_FILTERS),
      buildCacheKey("w", "all", "date_desc", { ...DEFAULT_SEARCH_FILTERS, target: "partial" }),
      buildCacheKey("w", "all", "date_desc", { ...DEFAULT_SEARCH_FILTERS, target: "exact" }),
      buildCacheKey("w", "all", "date_desc", {
        ...DEFAULT_SEARCH_FILTERS,
        target: "title_and_caption",
      }),
    ];
    expect(new Set(keys).size).toBe(3);
  });

  // oracle：docs/specs/search-user-scope.md §5.1「cacheKey.ts 无需改动：
  // ${word}_${scope}_${sort} 对 "user" 天然成立」+ §8.1 验收项 1。
  it("scope=user 天然成立（base 键，无需改 cacheKey）", () => {
    expect(buildCacheKey("水上", "user", "date_desc", DEFAULT_SEARCH_FILTERS)).toBe(
      "水上_user_date_desc",
    );
    expect(buildCacheKey("水上", "user", "date_asc", DEFAULT_SEARCH_FILTERS)).toBe(
      "水上_user_date_asc",
    );
    expect(buildCacheKey("水上", "user", "popular_desc", DEFAULT_SEARCH_FILTERS)).toBe(
      "水上_user_popular_desc",
    );
  });
});

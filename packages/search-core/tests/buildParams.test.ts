/**
 * 参数构建真值表。oracle：docs/research/pixiv-appapi-search-filter-params.md
 * - §1.1/§1.2 基础与筛选参数行（官方 iOS 抓包值）
 * - §3/§4 popular-preview：接受筛选但**无 sort、无分页、收藏数被忽略**
 * - §6.1 search_target 修复：Shaft #906（illust 显式 partial 丢标题命中→不传）、
 *   #1038（novel 不传退化为纯字面匹配→恒显式 partial）
 */
import { describe, expect, it } from "vitest";
import { buildIllustSearchRequest, buildNovelSearchRequest } from "../src/buildParams";
import { BOOKMARK_BANDS, DEFAULT_SEARCH_FILTERS } from "../src/filters";

const NOW = new Date("2026-09-12T15:00:00Z");
const input = (over: Partial<Parameters<typeof buildIllustSearchRequest>[0]> = {}) => ({
  word: "東方",
  sort: "date_desc" as const,
  filters: DEFAULT_SEARCH_FILTERS,
  now: NOW,
  ...over,
});

describe("buildIllustSearchRequest", () => {
  it("默认筛选：裸基础参 + 恒发两 bool，单词标签**不传 search_target**（#906）", () => {
    const r = buildIllustSearchRequest(input());
    expect(r.endpoint).toBe("/v1/search/illust");
    expect(r.params).toEqual({
      word: "東方",
      filter: "for_ios",
      merge_plain_keyword_results: "true",
      include_translated_tag_results: "true",
      sort: "date_desc",
    });
  });

  it("多标签（含空格）→ 显式 exact_match_for_tags", () => {
    const r = buildIllustSearchRequest(input({ word: "東方 フラン" }));
    expect(r.params.search_target).toBe("exact_match_for_tags");
  });

  it("热门路由 popular-preview：无 sort；单词标签无 search_target", () => {
    const r = buildIllustSearchRequest(input({ sort: "popular_desc" }));
    expect(r.endpoint).toBe("/v1/search/popular-preview/illust");
    expect(r.params).toEqual({
      word: "東方",
      filter: "for_ios",
      merge_plain_keyword_results: "true",
      include_translated_tag_results: "true",
    });
  });

  it("热门矩阵：期间/比例/分辨率透传，**收藏数不携带**，无 sort", () => {
    const r = buildIllustSearchRequest(
      input({
        sort: "popular_desc",
        filters: {
          period: { kind: "preset", preset: "1w" },
          bookmark: BOOKMARK_BANDS[3]!,
          ratio: "landscape",
          minPixels: 2000,
          aiOverride: "follow",
        },
      }),
    );
    expect(r.endpoint).toBe("/v1/search/popular-preview/illust");
    expect(r.params.start_date).toBe("2026-09-07");
    expect(r.params.end_date).toBe("2026-09-13");
    expect(r.params.ratio_pattern).toBe("landscape");
    expect(r.params.width_min).toBe("2000");
    expect(r.params.height_min).toBe("2000");
    expect(r.params.sort).toBeUndefined();
    expect(r.params.bookmark_num_min).toBeUndefined();
    expect(r.params.bookmark_num_max).toBeUndefined();
  });

  it("非热门 + 收藏数带宽：闭区间 min/max 落参（七档 oracle=官方 bookmark_ranges）", () => {
    const r = buildIllustSearchRequest(input({ filters: { ...DEFAULT_SEARCH_FILTERS, bookmark: BOOKMARK_BANDS[3]! } }));
    expect(r.params.bookmark_num_min).toBe("100");
    expect(r.params.bookmark_num_max).toBe("299");
    const open = buildIllustSearchRequest(input({ filters: { ...DEFAULT_SEARCH_FILTERS, bookmark: BOOKMARK_BANDS[6]! } }));
    expect(open.params.bookmark_num_min).toBe("1000");
    expect(open.params.bookmark_num_max).toBeUndefined();
  });

  it("期间自定义合法区间透传；非法区间省略（不静默半区间）", () => {
    const ok = buildIllustSearchRequest(
      input({ filters: { ...DEFAULT_SEARCH_FILTERS, period: { kind: "custom", start: "2026-08-01", end: "2026-08-15" } } }),
    );
    expect(ok.params.start_date).toBe("2026-08-01");
    expect(ok.params.end_date).toBe("2026-08-15");
    const bad = buildIllustSearchRequest(
      input({ filters: { ...DEFAULT_SEARCH_FILTERS, period: { kind: "custom", start: "2026-08-15", end: "2026-08-01" } } }),
    );
    expect(bad.params.start_date).toBeUndefined();
    expect(bad.params.end_date).toBeUndefined();
  });

  it("search_ai_type 永不出现（#479 裁决：AI 全客户端处理）", () => {
    const r = buildIllustSearchRequest(input());
    expect(Object.keys(r.params)).not.toContain("search_ai_type");
    expect(Object.keys(r.params)).not.toContain("duration");
    expect(Object.keys(r.params)).not.toContain("include_potential_violation_works");
  });
});

describe("buildNovelSearchRequest", () => {
  it("novel 端恒显式传 partial（单词标签；#1038 同义词展开）", () => {
    const r = buildNovelSearchRequest(input());
    expect(r.endpoint).toBe("/v1/search/novel");
    expect(r.params.search_target).toBe("partial_match_for_tags");
    expect(r.params.sort).toBe("date_desc");
  });

  it("多标签 → exact；比例/分辨率**永不进小说路**（插画专属维度，状态残留也不发）", () => {
    const r = buildNovelSearchRequest(
      input({
        word: "東方 フラン",
        filters: { ...DEFAULT_SEARCH_FILTERS, ratio: "portrait", minPixels: 3000 },
      }),
    );
    expect(r.params.search_target).toBe("exact_match_for_tags");
    expect(r.params.ratio_pattern).toBeUndefined();
    expect(r.params.width_min).toBeUndefined();
    expect(r.params.height_min).toBeUndefined();
  });

  it("热门路由 popular-preview/novel：无 sort、收藏数不携带、期间透传", () => {
    const r = buildNovelSearchRequest(
      input({
        sort: "popular_desc",
        filters: { ...DEFAULT_SEARCH_FILTERS, period: { kind: "preset", preset: "1d" }, bookmark: BOOKMARK_BANDS[0]! },
      }),
    );
    expect(r.endpoint).toBe("/v1/search/popular-preview/novel");
    expect(r.params.start_date).toBe("2026-09-13");
    expect(r.params.bookmark_num_min).toBeUndefined();
    expect(r.params.sort).toBeUndefined();
    expect(r.params.search_target).toBe("partial_match_for_tags");
  });
});

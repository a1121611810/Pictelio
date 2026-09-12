import { describe, it, expect, vi } from "vitest";
import { BOOKMARK_BANDS, DEFAULT_SEARCH_FILTERS } from "@pictelio/search-core";

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock("@/api/client", () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

async function loadApi() {
  vi.resetModules();
  return import("@/api/search");
}

/**
 * 本文件只断言「薄传输层」行为：参数构建的真值表单点在 @pictelio/search-core
 * （packages/search-core/tests/buildParams.test.ts，oracle=研究文档官方抓包值）。
 */
describe("api/search.ts（薄传输层）", () => {
  it("默认筛选：单词标签 illust 不传 search_target（#906），恒发两 bool", async () => {
    mockGet.mockResolvedValue({ illusts: [], next_url: null });
    const { searchIllust } = await loadApi();
    await searchIllust("星空");

    expect(mockGet).toHaveBeenCalledWith(
      "/v1/search/illust",
      {
        word: "星空",
        filter: "for_ios",
        merge_plain_keyword_results: "true",
        include_translated_tag_results: "true",
        sort: "date_desc",
      },
      undefined,
    );
  });

  it("多标签（含空格）→ exact_match_for_tags（target 规则单点在 search-core）", async () => {
    mockGet.mockResolvedValue({ illusts: [], next_url: null });
    const { searchIllust } = await loadApi();
    await searchIllust("東方 フラン");
    expect(mockGet).toHaveBeenCalledWith(
      "/v1/search/illust",
      expect.objectContaining({ word: "東方 フラン", search_target: "exact_match_for_tags" }),
      undefined,
    );
  });

  it("热门路由 popular-preview：无 sort、收藏数不携带、期间/比例透传", async () => {
    mockGet.mockResolvedValue({ illusts: [], next_url: null });
    const { searchIllust } = await loadApi();
    await searchIllust("Fate", "popular_desc", undefined, {
      ...DEFAULT_SEARCH_FILTERS,
      bookmark: BOOKMARK_BANDS[3]!,
      ratio: "landscape",
    });
    const [endpoint, params] = mockGet.mock.calls[0] as [string, Record<string, string>];
    expect(endpoint).toBe("/v1/search/popular-preview/illust");
    expect(params.sort).toBeUndefined();
    expect(params.bookmark_num_min).toBeUndefined();
    expect(params.ratio_pattern).toBe("landscape");
  });

  it("非热门 + 筛选：区间/比例/分辨率参数透传", async () => {
    mockGet.mockResolvedValue({ illusts: [], next_url: null });
    const { searchIllust } = await loadApi();
    await searchIllust("星空", "date_desc", undefined, {
      ...DEFAULT_SEARCH_FILTERS,
      bookmark: BOOKMARK_BANDS[3]!,
      ratio: "landscape",
      minPixels: 2000,
    });
    expect(mockGet).toHaveBeenCalledWith(
      "/v1/search/illust",
      expect.objectContaining({
        bookmark_num_min: "100",
        bookmark_num_max: "299",
        ratio_pattern: "landscape",
        width_min: "2000",
        height_min: "2000",
      }),
      undefined,
    );
  });

  it("novel：恒显式 partial（#1038）；比例/分辨率不进小说路", async () => {
    mockGet.mockResolvedValue({ novels: [], next_url: null });
    const { searchNovel } = await loadApi();
    await searchNovel("小説", "date_desc", undefined, {
      ...DEFAULT_SEARCH_FILTERS,
      ratio: "portrait",
      minPixels: 3000,
    });
    expect(mockGet).toHaveBeenCalledWith(
      "/v1/search/novel",
      expect.objectContaining({ search_target: "partial_match_for_tags" }),
      undefined,
    );
    const [, params] = mockGet.mock.calls[0] as [string, Record<string, string>];
    expect(params.ratio_pattern).toBeUndefined();
    expect(params.width_min).toBeUndefined();
  });

  it("searchIllustNext passes URL directly", async () => {
    mockGet.mockResolvedValue({ illusts: [], next_url: null });
    const { searchIllustNext } = await loadApi();
    await searchIllustNext("https://app-api.pixiv.net/v1/search/illust?word=test&offset=30");

    expect(mockGet).toHaveBeenCalledWith(
      "https://app-api.pixiv.net/v1/search/illust?word=test&offset=30",
      undefined,
      undefined,
    );
  });

  it("searchNovelNext passes URL directly", async () => {
    mockGet.mockResolvedValue({ novels: [], next_url: null });
    const { searchNovelNext } = await loadApi();
    await searchNovelNext("https://app-api.pixiv.net/v1/search/novel?word=test&offset=30");

    expect(mockGet).toHaveBeenCalledWith(
      "https://app-api.pixiv.net/v1/search/novel?word=test&offset=30",
      undefined,
      undefined,
    );
  });

  it("searchIllustNext throws on invalid URL", async () => {
    const { searchIllustNext } = await loadApi();
    expect(() => searchIllustNext("https://evil.com/steal")).toThrow(
      "searchIllustNext: invalid next_url",
    );
  });

  it("searchNovelNext throws on invalid URL", async () => {
    const { searchNovelNext } = await loadApi();
    expect(() => searchNovelNext("https://evil.com/steal")).toThrow(
      "searchNovelNext: invalid next_url",
    );
  });

  it("searchAutocomplete calls apiClient.get with correct params", async () => {
    mockGet.mockResolvedValue({ tags: [] });
    const { searchAutocomplete } = await loadApi();
    await searchAutocomplete("star");

    expect(mockGet).toHaveBeenCalledWith(
      "/v1/search/autocomplete",
      {
        word: "star",
        merge_dict: "true",
      },
      undefined,
    );
  });
});

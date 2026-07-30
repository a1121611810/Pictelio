import { describe, it, expect, vi } from "vitest";

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

describe("api/search.ts", () => {
  it("searchIllust calls apiClient.get with correct endpoint and params", async () => {
    mockGet.mockResolvedValue({ illusts: [], next_url: null });
    const { searchIllust } = await loadApi();
    await searchIllust("星空");

    expect(mockGet).toHaveBeenCalledWith(
      "/v1/search/illust",
      {
        word: "星空",
        sort: "date_desc",
        search_target: "partial_match_for_tags",
        filter: "for_ios",
      },
      undefined,
    );
  });

  it("searchIllust passes custom sort and searchTarget", async () => {
    mockGet.mockResolvedValue({ illusts: [], next_url: null });
    const { searchIllust } = await loadApi();
    await searchIllust("Fate", "date_asc", "title_and_caption");

    expect(mockGet).toHaveBeenCalledWith(
      "/v1/search/illust",
      {
        word: "Fate",
        sort: "date_asc",
        search_target: "title_and_caption",
        filter: "for_ios",
      },
      undefined,
    );
  });

  it("searchIllust with sort=popular_desc calls popular-preview endpoint", async () => {
    mockGet.mockResolvedValue({ illusts: [], next_url: null });
    const { searchIllust } = await loadApi();
    await searchIllust("Fate", "popular_desc", "title_and_caption");

    // popular_desc 应路由到独立预览端点，不含 sort 参数
    expect(mockGet).toHaveBeenCalledWith(
      "/v1/search/popular-preview/illust",
      {
        word: "Fate",
        search_target: "title_and_caption",
        filter: "for_ios",
      },
      undefined,
    );
  });

  it("searchNovel calls apiClient.get with correct endpoint and params", async () => {
    mockGet.mockResolvedValue({ novels: [], next_url: null });
    const { searchNovel } = await loadApi();
    await searchNovel("小説");

    expect(mockGet).toHaveBeenCalledWith(
      "/v1/search/novel",
      {
        word: "小説",
        sort: "date_desc",
        search_target: "partial_match_for_tags",
        filter: "for_ios",
      },
      undefined,
    );
  });

  it("searchNovel passes custom sort and searchTarget", async () => {
    mockGet.mockResolvedValue({ novels: [], next_url: null });
    const { searchNovel } = await loadApi();
    await searchNovel("test", "date_asc", "exact_match_for_tags");

    expect(mockGet).toHaveBeenCalledWith(
      "/v1/search/novel",
      {
        word: "test",
        sort: "date_asc",
        search_target: "exact_match_for_tags",
        filter: "for_ios",
      },
      undefined,
    );
  });

  it("searchNovel with sort=popular_desc calls popular-preview endpoint", async () => {
    mockGet.mockResolvedValue({ novels: [], next_url: null });
    const { searchNovel } = await loadApi();
    await searchNovel("test", "popular_desc", "exact_match_for_tags");

    expect(mockGet).toHaveBeenCalledWith(
      "/v1/search/popular-preview/novel",
      {
        word: "test",
        search_target: "exact_match_for_tags",
        filter: "for_ios",
      },
      undefined,
    );
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

  it("searchIllust returns PixivIllustListResponse", async () => {
    const expected = {
      illusts: [
        {
          id: 1,
          title: "Test",
          type: "illust",
          user: { id: 1, name: "a", account: "a", profile_image_urls: {} },
          image_urls: { square_medium: "", medium: "", large: "" },
          width: 100,
          height: 100,
          page_count: 1,
          is_bookmarked: false,
          total_bookmarks: 0,
          tags: [{ name: "tag1" }],
          x_restrict: 0,
          create_date: "2026-01-01T00:00:00Z",
          meta_pages: [],
          meta_single_page: {},
        },
      ],
      next_url: null,
    };
    mockGet.mockResolvedValue(expected);
    const { searchIllust } = await loadApi();
    const result = await searchIllust("test");

    expect(result).toEqual(expected);
    expect(result.illusts).toHaveLength(1);
  });

  it("searchNovel returns PixivNovelListResponse", async () => {
    const expected = {
      novels: [
        {
          id: 1,
          title: "Test Novel",
          user: { id: 1, name: "a", account: "a", profile_image_urls: {} },
          image_urls: { square_medium: "", medium: "", large: "" },
          tags: [],
          page_count: 1,
          text_length: 1000,
          is_bookmarked: false,
          total_bookmarks: 0,
          x_restrict: 0,
          create_date: "2026-01-01T00:00:00Z",
        },
      ],
      next_url: null,
    };
    mockGet.mockResolvedValue(expected);
    const { searchNovel } = await loadApi();
    const result = await searchNovel("test");

    expect(result).toEqual(expected);
    expect(result.novels).toHaveLength(1);
  });

  it("searchAutocomplete returns PixivAutocompleteResponse", async () => {
    const expected = { tags: [{ name: "star", translated_name: "星" }] };
    mockGet.mockResolvedValue(expected);
    const { searchAutocomplete } = await loadApi();
    const result = await searchAutocomplete("star");

    expect(result).toEqual(expected);
    expect(result.tags).toHaveLength(1);
  });
});

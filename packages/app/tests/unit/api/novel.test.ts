import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock apiClient
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockGetAccessToken = vi.fn().mockReturnValue("token");
const mockFetch = vi.fn();
// Native 分支：PixivApi 网关 mock + isNative 开关（novel.ts 模块级常量，需 resetModules 重载）
const mockPixivApiRequest = vi.fn();
let mockIsNative = false;

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mockIsNative },
}));

vi.mock("@/native/PixivApi", () => ({
  PixivApi: { request: (...args: unknown[]) => mockPixivApiRequest(...args) },
}));

vi.mock("@/api/client", () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
  getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
}));

vi.stubGlobal("fetch", mockFetch);

async function loadApi() {
  vi.resetModules();
  return import("@/api/novel");
}

describe("api/novel.ts", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockGetAccessToken.mockReturnValue("token");
    mockFetch.mockReset();
    mockPixivApiRequest.mockReset();
    mockIsNative = false;
  });

  it("loadDetail deduplicates concurrent requests for the same novel id", async () => {
    const expected: import("@/api/types").PixivNovelDetailResponse = {
      novel: {
        id: 42,
        title: "Test Novel",
        user: { id: 1, name: "Author", account: "author", profile_image_urls: {} },
        image_urls: { square_medium: "", medium: "", large: "" },
        tags: [],
        page_count: 1,
        text_length: 1000,
        is_bookmarked: false,
        total_bookmarks: 0,
        total_view: 0,
        x_restrict: 0,
        create_date: "2026-01-01T00:00:00Z",
      },
    };
    mockGet.mockResolvedValue(expected);

    const { loadDetail } = await loadApi();
    const [a, b] = await Promise.all([loadDetail(42), loadDetail(42)]);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith("/v2/novel/detail", { novel_id: "42" });
    expect(a).toEqual(expected);
    expect(b).toEqual(expected);
  });

  it("loadText deduplicates concurrent requests for the same novel id", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<script>window.pixiv={novel:{"text":"hello"}};</script>'),
    });

    const { loadText } = await loadApi();
    const [a, b] = await Promise.all([loadText(42), loadText(42)]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "/pixiv-api/webview/v2/novel?id=42",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      }),
    );
    const expectedHtml = '<script>window.pixiv={novel:{"text":"hello"}};</script>';
    expect(a).toBe(expectedHtml);
    expect(b).toBe(expectedHtml);
  });

  it("loadSeries calls apiClient.get with series_id", async () => {
    mockGet.mockResolvedValue({ novel_series_detail: {}, novels: [], next_url: null });
    const { loadSeries } = await loadApi();
    await loadSeries(123);

    expect(mockGet).toHaveBeenCalledWith("/v2/novel/series", {
      series_id: "123",
    });
  });

  it("loadSeries passes last_order when provided", async () => {
    mockGet.mockResolvedValue({ novel_series_detail: {}, novels: [], next_url: null });
    const { loadSeries } = await loadApi();
    await loadSeries(123, 5);

    expect(mockGet).toHaveBeenCalledWith("/v2/novel/series", {
      series_id: "123",
      last_order: "5",
    });
  });

  it("loadSeriesNext calls apiClient.get with next_url", async () => {
    const expected: import("@/api/novel").NovelSeriesDetailResponse = {
      novel_series_detail: {
        id: 1,
        title: "Series Title",
        user: {
          id: 456,
          name: "Author",
          account: "author",
          profile_image_urls: {
            px_16x16: "https://example.com/16.jpg",
            px_50x50: "https://example.com/50.jpg",
            px_170x170: "https://example.com/170.jpg",
          },
          is_followed: false,
        },
        create_date: "2025-01-01T00:00:00+00:00",
        total_character_count: 10_000,
        display_text_count: 5000,
      },
      novels: [],
      next_url: null,
    };
    mockGet.mockResolvedValue(expected);
    const { loadSeriesNext } = await loadApi();
    const result = await loadSeriesNext(
      "https://app-api.pixiv.net/v2/novel/series?series_id=123&last_order=30",
    );

    expect(mockGet).toHaveBeenCalledWith(
      "https://app-api.pixiv.net/v2/novel/series?series_id=123&last_order=30",
    );
    expect(result).toEqual(expected);
  });

  it("loadSeries returns a NovelSeriesDetailResponse", async () => {
    const expected: import("@/api/novel").NovelSeriesDetailResponse = {
      novel_series_detail: {
        id: 1,
        title: "Series Title",
        user: {
          id: 456,
          name: "Author",
          account: "author",
          profile_image_urls: {
            px_16x16: "https://example.com/16.jpg",
            px_50x50: "https://example.com/50.jpg",
            px_170x170: "https://example.com/170.jpg",
          },
          is_followed: false,
        },
        create_date: "2025-01-01T00:00:00+00:00",
        total_character_count: 10_000,
        display_text_count: 5000,
      },
      novels: [
        {
          id: 10,
          title: "Chapter 1",
          user: {
            id: 456,
            name: "Author",
            account: "author",
            profile_image_urls: { px_16x16: "", px_50x50: "", px_170x170: "" },
          },
          image_urls: {
            square_medium: "",
            medium: "",
            large: "",
          },
          tags: [{ name: "tag1" }],
          page_count: 1,
          text_length: 5000,
          series: { id: 1, title: "Series Title" },
          is_original: true,
          is_bookmarked: false,
          total_bookmarks: 10,
          total_view: 100,
          x_restrict: 0,
          create_date: "2025-01-01T00:00:00+00:00",
          caption: "A novel chapter",
        },
      ],
      next_url: null,
    };
    mockGet.mockResolvedValue(expected);
    const { loadSeries } = await loadApi();
    const result = await loadSeries(123);

    expect(result).toEqual(expected);
  });
});

describe("extractNovelTextFromHtml", () => {
  it("extracts text from window.pixiv.novel.text in HTML", async () => {
    const { extractNovelTextFromHtml } = await loadApi();
    const html = `<!DOCTYPE html><html><head><script>
Object.defineProperty(window, 'pixiv', { value: { novel: { "text": "这是第一段。\\n\\n这是第二段，有标点。\\n\\n这是第三段。" } } });
</script></head><body></body></html>`;

    expect(extractNovelTextFromHtml(html)).toBe(
      "这是第一段。\n\n这是第二段，有标点。\n\n这是第三段。",
    );
  });

  it("handles escaped characters in text", async () => {
    const { extractNovelTextFromHtml } = await loadApi();
    const html = `<script>Object.defineProperty(window, 'pixiv', { value: { novel: { "text": "她说:\\u201c你好\\u201d" } } });</script>`;

    expect(extractNovelTextFromHtml(html)).toBe("她说:“你好”");
  });

  it("returns empty string when no text found", async () => {
    const { extractNovelTextFromHtml } = await loadApi();
    expect(extractNovelTextFromHtml("<html><body>no script</body></html>")).toBe("");
  });

  it("matches the structure of the real Pixiv API response", async () => {
    const { extractNovelTextFromHtml } = await loadApi();
    // 模拟真实 API 返回的结构：pixiv.novel.text 中包含大段文本
    const realSample = `<!DOCTYPE html><html><head><script>
Object.defineProperty(window, 'pixiv', { value: { sessionUserId: 123, novel: { "id": "28374148", "title": "测试标题", "text": "我在一片软绵绵的黑暗里浮着。\\n\\n最先回来的不是视觉，是触觉。\\n\\n手腕被什么勒着。", "marker": null } } });
</script></head><body></body></html>`;

    const result = extractNovelTextFromHtml(realSample);
    expect(result).toContain("我在一片软绵绵的黑暗里浮着");
    expect(result).toContain("手腕被什么勒着");
  });
});

describe("extractNovelDataFromHtml", () => {
  it("extracts text and navigation from realistic HTML with Object.defineProperty syntax", async () => {
    const { extractNovelDataFromHtml } = await loadApi();
    const html = `<!DOCTYPE html><html><head><script>
Object.defineProperty(window, 'pixiv', { value: { sessionUserId: 123, novel: { "id": "1", "text": "正文内容\\n\\n第二段", "seriesNavigation": {"nextNovel": {"id": 2, "title": "第二章"}, "prevNovel": null} }, isOwnWork: false } });
</script></head><body></body></html>`;

    const result = extractNovelDataFromHtml(html);
    expect(result.text).toBe("正文内容\n\n第二段");
    expect(result.navigation.nextNovel?.id).toBe(2);
    expect(result.navigation.nextNovel?.title).toBe("第二章");
    expect(result.navigation.prevNovel).toBeNull();
  });

  it("returns empty text and navigation when HTML has no data", async () => {
    const { extractNovelDataFromHtml } = await loadApi();
    const result = extractNovelDataFromHtml("<html></html>");
    expect(result.text).toBe("");
    expect(result.navigation.nextNovel).toBeUndefined();
  });

  it("extracts both prev and next navigation", async () => {
    const { extractNovelDataFromHtml } = await loadApi();
    const html = `<script>Object.defineProperty(window, 'pixiv', { value: { novel: { "id": "2", "text": "middle", "seriesNavigation": {"nextNovel": {"id": 3, "title": "Next"}, "prevNovel": {"id": 1, "title": "Prev"}} } } });</script>`;

    const result = extractNovelDataFromHtml(html);
    expect(result.navigation.prevNovel?.id).toBe(1);
    expect(result.navigation.nextNovel?.id).toBe(3);
    expect(result.text).toBe("middle");
  });

  it("handles missing seriesNavigation field", async () => {
    const { extractNovelDataFromHtml } = await loadApi();
    const html = `<script>Object.defineProperty(window, 'pixiv', { value: { novel: { "id": "1", "text": "no nav" } } });</script>`;

    const result = extractNovelDataFromHtml(html);
    expect(result.text).toBe("no nav");
    expect(result.navigation.nextNovel).toBeUndefined();
  });
});

describe("loadFollow", () => {
  it("calls apiClient.get with /v1/novel/follow and restrict parameter", async () => {
    mockGet.mockResolvedValue({ novels: [], next_url: null });
    const { loadFollow } = await loadApi();
    await loadFollow("public");

    expect(mockGet).toHaveBeenCalledWith("/v1/novel/follow", { restrict: "public" });
  });

  it("defaults restrict to public", async () => {
    mockGet.mockResolvedValue({ novels: [], next_url: null });
    const { loadFollow } = await loadApi();
    await loadFollow();

    expect(mockGet).toHaveBeenCalledWith("/v1/novel/follow", { restrict: "public" });
  });

  it("returns PixivNovelListResponse", async () => {
    const expected: import("@/api/types").PixivNovelListResponse = {
      novels: [
        {
          id: 1,
          title: "test",
          user: { id: 1, name: "a", account: "a", profile_image_urls: {} },
          image_urls: { square_medium: "", medium: "", large: "" },
          tags: [],
          page_count: 1,
          text_length: 1000,
          is_bookmarked: false,
          total_bookmarks: 5,
          x_restrict: 0,
          create_date: "2026-01-01T00:00:00Z",
        } as import("@/api/types").PixivNovel,
      ],
      next_url: null,
    };
    mockGet.mockResolvedValue(expected);
    const { loadFollow } = await loadApi();
    const result = await loadFollow("private");

    expect(result).toEqual(expected);
    expect(result.novels).toHaveLength(1);
  });
});

describe("loadUserNovels", () => {
  it("calls apiClient.get with /v1/user/novels and user_id", async () => {
    mockGet.mockResolvedValue({ novels: [], next_url: null });
    const { loadUserNovels } = await loadApi();
    await loadUserNovels(42);

    expect(mockGet).toHaveBeenCalledWith("/v1/user/novels", {
      user_id: "42",
      filter: "for_ios",
    });
  });

  it("returns PixivNovelListResponse", async () => {
    const expected: import("@/api/types").PixivNovelListResponse = {
      novels: [
        {
          id: 1,
          title: "test novel",
          user: { id: 1, name: "a", account: "a", profile_image_urls: {} },
          image_urls: { square_medium: "", medium: "", large: "" },
          tags: [],
          page_count: 1,
          text_length: 1000,
          is_bookmarked: false,
          total_bookmarks: 5,
          x_restrict: 0,
          create_date: "2026-01-01T00:00:00Z",
        } as import("@/api/types").PixivNovel,
      ],
      next_url: null,
    };
    mockGet.mockResolvedValue(expected);
    const { loadUserNovels } = await loadApi();
    const result = await loadUserNovels(42);

    expect(result).toEqual(expected);
    expect(result.novels).toHaveLength(1);
  });
});

// ─── Native 分支：正文请求走 PixivApiPlugin 网关（bug 3 修复） ───
// native 模式下 access_token 只在 Java 堆（ADR-0037），loadTextRaw 必须走
// PixivApi.request 让 Java 侧注入 Authorization，不能 CapacitorHttp 直连。
describe("loadText native 分支（PixivApi 网关）", () => {
  it("native 模式走 PixivApi.request 网关并返回 HTML 正文", async () => {
    mockIsNative = true;
    mockPixivApiRequest.mockResolvedValue({
      status: 200,
      data: '<script>window.pixiv={novel:{"text":"hello"}};</script>',
    });

    const { loadText } = await loadApi();
    const html = await loadText(42);

    expect(mockPixivApiRequest).toHaveBeenCalledWith({
      method: "GET",
      path: "/webview/v2/novel",
      params: { id: "42" },
    });
    expect(html).toBe('<script>window.pixiv={novel:{"text":"hello"}};</script>');
  });

  it("native 模式 HTTP 400 时抛错（正文失败不再静默）", async () => {
    mockIsNative = true;
    mockPixivApiRequest.mockResolvedValue({
      status: 400,
      data: '{"error":{"message":"invalid_request"}}',
    });

    const { loadText } = await loadApi();
    await expect(loadText(42)).rejects.toThrow("小说正文加载失败 (HTTP 400)");
  });
});

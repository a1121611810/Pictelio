// Oracle: docs/specs/novel-export.md §3.3（NovelExportPayload / meta / block 形状与 URL 解析顺序）
//         + §3.4（构造器）；真实样例取自 packages/app/tests/unit/api/novel.test.ts 的 Pixiv 字段
//         （id/title/user/image_urls/tags/series/create_date/caption/x_restrict）
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NOVEL_EXPORT_OPTIONS,
  buildNovelExportPayload,
  type NovelExportOptions,
  type NovelImageSize,
  type NovelImageUrls,
  type NovelImagesMap,
  type PixivNovelLike,
} from "../src/index";

const REAL_NOVEL: PixivNovelLike = {
  id: 42,
  title: "Test Novel",
  user: { id: 456, name: "Author" },
  image_urls: {
    square_medium: "https://example.com/square.jpg",
    medium: "https://example.com/medium.jpg",
    large: "https://example.com/large.jpg",
  },
  tags: [
    { name: "tag1" },
    { name: "tag2", translated_name: "标签2" },
    { name: "tag3", translated_name: "tag3" },
  ],
  series: { id: 1, title: "Series Title" },
  create_date: "2025-01-01T00:00:00+00:00",
  caption: "简介[b]加粗[/b][ruby:漢字:かんじ]与[memo]备注[/memo]尾",
  x_restrict: 0,
};

function urls(partial: Partial<Record<NovelImageSize, string>>): NovelImageUrls {
  return partial as NovelImageUrls;
}

function imagesWith(imageUrls: NovelImageUrls): NovelImagesMap {
  return { "100": { novelImageId: "100", sl: "2", urls: imageUrls } };
}

const ALL_URLS = urls({
  "240mw": "https://example.com/240.jpg",
  "480mw": "https://example.com/480.jpg",
  "1200x1200": "https://example.com/1200.jpg",
  "128x128": "https://example.com/128.jpg",
  original: "https://example.com/original.png",
});

describe("buildNovelExportPayload — meta 映射", () => {
  const payload = buildNovelExportPayload({
    novel: REAL_NOVEL,
    text: "正文",
    images: null,
    options: DEFAULT_NOVEL_EXPORT_OPTIONS,
  });

  it("schema 恒为 1，meta 字段逐字映射", () => {
    expect(payload.schema).toBe(1);
    expect(payload.meta).toMatchObject({
      id: 42,
      title: "Test Novel",
      authorId: 456,
      authorName: "Author",
      seriesId: 1,
      seriesTitle: "Series Title",
      createDate: "2025-01-01T00:00:00+00:00",
      sourceUrl: "https://www.pixiv.net/novel/show.php?id=42",
      xRestrict: 0,
      coverUrl: "https://example.com/large.jpg",
    });
  });

  it("tags 在 translated_name 存在且不同时追加括号译文", () => {
    expect(payload.meta.tags).toEqual(["tag1", "tag2 (标签2)", "tag3"]);
  });

  it("description = caption 去 Pixiv 标记后的纯文本", () => {
    expect(payload.meta.description).toBe("简介加粗漢字与尾");
  });

  it("无 caption 时不含 description 字段", () => {
    const noCaption: PixivNovelLike = { ...REAL_NOVEL, caption: undefined };
    const p = buildNovelExportPayload({ novel: noCaption, text: "", images: null, options: DEFAULT_NOVEL_EXPORT_OPTIONS });
    expect("description" in p.meta).toBe(false);
  });

  it("coverUrl 回退顺序 large → medium → square_medium", () => {
    const mediumOnly: PixivNovelLike = {
      ...REAL_NOVEL,
      image_urls: { square_medium: "s", medium: "m" },
    };
    expect(
      buildNovelExportPayload({ novel: mediumOnly, text: "", images: null, options: DEFAULT_NOVEL_EXPORT_OPTIONS }).meta.coverUrl,
    ).toBe("m");

    const squareOnly: PixivNovelLike = { ...REAL_NOVEL, image_urls: { square_medium: "s" } };
    expect(
      buildNovelExportPayload({ novel: squareOnly, text: "", images: null, options: DEFAULT_NOVEL_EXPORT_OPTIONS }).meta.coverUrl,
    ).toBe("s");

    const none: PixivNovelLike = { ...REAL_NOVEL, image_urls: {} };
    expect(
      buildNovelExportPayload({ novel: none, text: "", images: null, options: DEFAULT_NOVEL_EXPORT_OPTIONS }).meta.coverUrl,
    ).toBeUndefined();
  });
});

describe("buildNovelExportPayload — options 快照", () => {
  it("原样复制内容开关（不共享可变引用语义）", () => {
    const options: NovelExportOptions = {
      includeMetadata: false,
      includeCover: true,
      includeInlineImages: false,
    };
    const payload = buildNovelExportPayload({ novel: REAL_NOVEL, text: "", images: null, options });
    expect(payload.options).toEqual(options);
  });

  it("DEFAULT_NOVEL_EXPORT_OPTIONS 三项全开", () => {
    expect(DEFAULT_NOVEL_EXPORT_OPTIONS).toEqual({
      includeMetadata: true,
      includeCover: true,
      includeInlineImages: true,
    });
  });
});

describe("buildNovelExportPayload — blocks 映射", () => {
  it("text/chapter/pageBreak/image/jump 五类块正确映射", () => {
    const text = "[chapter: 第一章]\n第一[b]段[/b]\n[newpage]\n[pixivimage:100]\n[jump:illust/456]";
    const payload = buildNovelExportPayload({
      novel: REAL_NOVEL,
      text,
      images: imagesWith(ALL_URLS),
      options: DEFAULT_NOVEL_EXPORT_OPTIONS,
    });
    expect(payload.blocks).toEqual([
      { type: "chapter", title: "第一章" },
      { type: "text", index: 0, text: "第一段", inlineRuns: [{ start: 2, end: 3, tag: "bold" }] },
      { type: "pageBreak" },
      { type: "image", imageId: "100", url: "https://example.com/1200.jpg" },
      { type: "jump", kind: "illust", target: "illust/456", url: "https://www.pixiv.net/artworks/456" },
    ]);
  });

  it("jump URL 映射：illust/novel/user/external/unknown", () => {
    const text = "[jump:illust/456]\n[jump:novel/123]\n[jump:user/789]\n[jump:https://example.com/a]\n[jump:unknown-thing]";
    const payload = buildNovelExportPayload({ novel: REAL_NOVEL, text, images: null, options: DEFAULT_NOVEL_EXPORT_OPTIONS });
    expect(payload.blocks).toEqual([
      { type: "jump", kind: "illust", target: "illust/456", url: "https://www.pixiv.net/artworks/456" },
      { type: "jump", kind: "novel", target: "novel/123", url: "https://www.pixiv.net/novel/show.php?id=123" },
      { type: "jump", kind: "user", target: "user/789", url: "https://www.pixiv.net/users/789" },
      { type: "jump", kind: "external", target: "https://example.com/a", url: "https://example.com/a" },
      { type: "jump", kind: "unknown", target: "unknown-thing", url: "unknown-thing" },
    ]);
  });
});

describe("buildNovelExportPayload — 图片 URL 回退顺序", () => {
  function firstImageUrl(imageUrls: NovelImageUrls): string | undefined {
    const payload = buildNovelExportPayload({
      novel: REAL_NOVEL,
      text: "[pixivimage:100]",
      images: imagesWith(imageUrls),
      options: DEFAULT_NOVEL_EXPORT_OPTIONS,
    });
    const block = payload.blocks[0];
    return block.type === "image" ? block.url : undefined;
  }

  it("1200x1200 优先", () => {
    expect(firstImageUrl(ALL_URLS)).toBe("https://example.com/1200.jpg");
  });

  it("无 1200x1200 回退 original", () => {
    expect(firstImageUrl(urls({ original: "o", "480mw": "m480", "240mw": "m240" }))).toBe("o");
  });

  it("无 1200x1200/original 回退 480mw", () => {
    expect(firstImageUrl(urls({ "480mw": "m480", "240mw": "m240" }))).toBe("m480");
  });

  it("仅有 240mw 时用 240mw", () => {
    expect(firstImageUrl(urls({ "240mw": "m240" }))).toBe("m240");
  });

  it("全部缺失时丢弃该块并 console.warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const payload = buildNovelExportPayload({
      novel: REAL_NOVEL,
      text: "[pixivimage:100]\n尾段",
      images: imagesWith(urls({})),
      options: DEFAULT_NOVEL_EXPORT_OPTIONS,
    });
    expect(payload.blocks).toEqual([{ type: "text", index: 0, text: "尾段" }]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

// 跨语言 golden payload 的规范输入（spec docs/specs/novel-export.md §3.3）。
// 供 packages/novel-export 的 golden 测试与 Java NovelExportModel 的解析测试共用同一份产出：
// TS 测试断言 buildNovelExportPayload(SAMPLE_INPUT) == fixtures/sample-payload.json；
// Java 测试读取同一 JSON（test resources 副本，由 differential 一致性测试守护字节相等）。
import type { NovelImagesMap, PixivNovelLike } from "../../src/index";

export const SAMPLE_NOVEL: PixivNovelLike = {
  id: 42,
  title: "Golden Novel 黄金样例",
  user: { id: 456, name: "作者甲" },
  image_urls: {
    square_medium: "https://i.pximg.net/c/128x128/novel/cover_sq.jpg",
    medium: "https://i.pximg.net/c/240x480/novel/cover_m.jpg",
    large: "https://i.pximg.net/novel/cover_l.jpg",
  },
  tags: [{ name: "tag1" }, { name: "tag2", translated_name: "标签2" }],
  series: { id: 7, title: "Sample Series" },
  create_date: "2025-01-01T00:00:00+00:00",
  caption: "简介[b]加粗[/b]与[memo]备注[/memo]尾",
  x_restrict: 0,
};

export const SAMPLE_TEXT = [
  "[chapter:第一章 起]",
  "这是[b]粗体[/b]与[i]斜体[/i]，还有[ruby:漢字:かんじ]。",
  "[pixivimage:100]",
  "[newpage]",
  "[jump:illust/12345]",
  "外部链接[jump:https://example.com] 保留为文本",
  "最后一段。",
].join("\n");

export const SAMPLE_IMAGES: NovelImagesMap = {
  "100": {
    novelImageId: "100",
    sl: "2",
    urls: {
      "240mw": "https://i.pximg.net/c/240x480/img/100.jpg",
      "480mw": "https://i.pximg.net/c/480x960/img/100.jpg",
      "1200x1200": "https://i.pximg.net/img/1200/100.jpg",
      "128x128": "https://i.pximg.net/c/128x128/img/100.jpg",
      original: "https://i.pximg.net/img-original/100.png",
    },
  },
};

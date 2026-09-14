// Oracle: docs/specs/novel-export.md §3.3（InlineRun / 块类型） + §5
//         真实样例复用自 packages/app/tests/unit/utils/novelBlocks.test.ts（真实 Pixiv 标记）
import { describe, expect, it } from "vitest";
import {
  buildSearchText,
  getImageBlocks,
  parseInlineRuns,
  parseJumpKind,
  parseNovelBlocks,
  selectInlineImageUrl,
  type NovelImageUrls,
  type NovelImagesMap,
} from "../src/index";

// 真实内嵌图片样例（取自 packages/app/tests/unit/routes/NovelDetail.test.tsx 的 Pixiv images 映射）
const REAL_IMAGES: NovelImagesMap = {
  "24980988": {
    novelImageId: "24980988",
    sl: "2",
    urls: {
      "240mw": "https://example.com/240.jpg",
      "480mw": "https://example.com/480.jpg",
      "1200x1200": "https://example.com/1200.jpg",
      "128x128": "https://example.com/128.jpg",
      original: "https://example.com/original.png",
    },
  },
};

describe("parseInlineRuns — 行内装饰标记", () => {
  it("[b]…[/b] 粗体 → 样式区间 + 净化文本", () => {
    const { cleanText, runs } = parseInlineRuns("这是[b]重点[/b]内容");
    expect(cleanText).toBe("这是重点内容");
    expect(runs).toEqual([{ start: 2, end: 4, tag: "bold" }]);
  });

  it("[i] 斜体 / [s] 删除线 / [u] 下划线 各自成区间", () => {
    expect(parseInlineRuns("甲[i]乙[/i]丙")).toEqual({
      cleanText: "甲乙丙",
      runs: [{ start: 1, end: 2, tag: "italic" }],
    });
    expect(parseInlineRuns("删除[s]线[/s]尾")).toEqual({
      cleanText: "删除线尾",
      runs: [{ start: 2, end: 3, tag: "strike" }],
    });
    expect(parseInlineRuns("下划线[u]部[/u]分")).toEqual({
      cleanText: "下划线部分",
      runs: [{ start: 3, end: 4, tag: "underline" }],
    });
  });

  it("嵌套标记各自成区间（[b][i] 叠加）", () => {
    const { cleanText, runs } = parseInlineRuns("A[b]B[i]C[/i]D[/b]E");
    expect(cleanText).toBe("ABCDE");
    // 闭合顺序 push（[/i] 先闭合）
    expect(runs).toEqual([
      { start: 2, end: 3, tag: "italic" },
      { start: 1, end: 4, tag: "bold" },
    ]);
  });

  it("[ruby:主:注音] 保留主文本剥离注音", () => {
    const { cleanText, runs } = parseInlineRuns("漢字[ruby:漢字:かんじ]です");
    expect(cleanText).toBe("漢字漢字です");
    expect(runs).toEqual([]);
  });

  it("[memo]…[/memo] 整体剥离", () => {
    const { cleanText } = parseInlineRuns("正文[memo]编辑备注[/memo]继续");
    expect(cleanText).toBe("正文继续");
  });

  it("未知 [1] 等方括号文本保留原样（不误剥）", () => {
    const { cleanText } = parseInlineRuns("引用[1]来源");
    expect(cleanText).toBe("引用[1]来源");
  });
});

describe("parseJumpKind — 跳转目标分类", () => {
  it("识别 illust / novel / user / external / unknown", () => {
    expect(parseJumpKind("illust/456")).toBe("illust");
    expect(parseJumpKind("novel/123")).toBe("novel");
    expect(parseJumpKind("user/789")).toBe("user");
    expect(parseJumpKind("https://example.com/a")).toBe("external");
    expect(parseJumpKind("unknown-thing")).toBe("unknown");
  });
});

describe("parseNovelBlocks — 块分类", () => {
  it("识别 [chapter:标题] 为 ChapterBlock（含空格，真实样例）", () => {
    expect(parseNovelBlocks("[chapter: 第一章：处理学生]", null)).toEqual([
      { type: "chapter", title: "第一章：处理学生" },
    ]);
  });

  it("chapter 不占用 textIndex（后续正文段落索引连续）", () => {
    const blocks = parseNovelBlocks("[chapter: 序章]\n第一段\n第二段", null);
    const textBlocks = blocks.filter((b) => b.type === "text");
    expect(textBlocks.map((b) => b.index)).toEqual([0, 1]);
  });

  it("识别独占一行的 [newpage] 为 pageBreak 块", () => {
    expect(parseNovelBlocks("[newpage]", null)).toEqual([{ type: "pageBreak" }]);
    expect(parseNovelBlocks("前\n[newpage]\n后", null)).toEqual([
      { type: "text", index: 0, text: "前" },
      { type: "pageBreak" },
      { type: "text", index: 1, text: "后" },
    ]);
    // 同一行内的 [newpage] 不识别（正则锚定整行）
    expect(parseNovelBlocks("尾[newpage]", null)).toEqual([
      { type: "text", index: 0, text: "尾[newpage]" },
    ]);
  });

  it("识别 [jump:novel/123] 与 [jump2:illust/456]", () => {
    expect(parseNovelBlocks("[jump:novel/123]", null)).toEqual([
      { type: "jump", kind: "novel", target: "novel/123" },
    ]);
    expect(parseNovelBlocks("[jump2:illust/456]", null)).toEqual([
      { type: "jump", kind: "illust", target: "illust/456" },
    ]);
  });

  it("全标记混合 + 索引对齐（真实样例）", () => {
    const text = "[chapter: 第一章]\n第一[b]段[/b]\n[newpage]\n[pixivimage:100]\n第二段";
    const images = {
      "100": { novelImageId: "100", sl: "2", urls: REAL_IMAGES["24980988"].urls },
    } as NovelImagesMap;
    const blocks = parseNovelBlocks(text, images);
    expect(blocks.map((b) => b.type)).toEqual(["chapter", "text", "pageBreak", "image", "text"]);
    const textBlocks = blocks.filter((b) => b.type === "text");
    expect(textBlocks.map((b) => b.index)).toEqual([0, 1]);
    expect(textBlocks[0].text).toBe("第一段");
    expect(textBlocks[0].inlineRuns).toEqual([{ start: 2, end: 3, tag: "bold" }]);
  });

  it("[uploadedimage:id] 与 [pixivimage:id] 均识别为 image（仅 id 存在时）", () => {
    expect(parseNovelBlocks("[uploadedimage:24980988]", REAL_IMAGES)).toEqual([
      { type: "image", imageId: "24980988", urls: REAL_IMAGES["24980988"].urls },
    ]);
    // 缺失 id 时降级为文本块（保留原样标记）
    const blocks = parseNovelBlocks("[pixivimage:404]", REAL_IMAGES);
    expect(blocks).toEqual([{ type: "text", index: 0, text: "[pixivimage:404]" }]);
  });

  it("buildSearchText 只含净化后的 text 段落（索引对齐）", () => {
    const blocks = parseNovelBlocks("[chapter: 序]\n甲[b]乙[/b]丙\n[newpage]\n丁", null);
    expect(buildSearchText(blocks)).toBe("甲乙丙\n\n丁");
  });

  it("getImageBlocks 只收集 image 块", () => {
    const blocks = parseNovelBlocks("[pixivimage:24980988]\n正文", REAL_IMAGES);
    expect(getImageBlocks(blocks)).toEqual([
      { type: "image", imageId: "24980988", urls: REAL_IMAGES["24980988"].urls },
    ]);
  });
});

describe("selectInlineImageUrl — 按容器宽度选 URL", () => {
  const urls = REAL_IMAGES["24980988"].urls as NovelImageUrls;
  it("≤480 用 480mw，>480 用 1200x1200", () => {
    expect(selectInlineImageUrl(urls, 480)).toBe("https://example.com/480.jpg");
    expect(selectInlineImageUrl(urls, 481)).toBe("https://example.com/1200.jpg");
  });
});

import { describe, expect, it } from "vitest";
import {
  buildSearchText,
  parseInlineRuns,
  parseJumpKind,
  parseNovelBlocks,
} from "@/utils/novelBlocks";

describe("parseNovelBlocks — 章节标记", () => {
  it("识别 [chapter:标题] 为 ChapterBlock（含空格，真实样例）", () => {
    const blocks = parseNovelBlocks("[chapter: 第一章：处理学生]", null);
    expect(blocks).toEqual([{ type: "chapter", title: "第一章：处理学生" }]);
  });

  it("chapter 不占用 textIndex（后续正文段落索引连续）", () => {
    const blocks = parseNovelBlocks("[chapter: 序章]\n第一段\n第二段", null);
    const textBlocks = blocks.filter((b) => b.type === "text");
    expect(textBlocks.map((b) => b.index)).toEqual([0, 1]);
  });
});

describe("parseNovelBlocks — jump 标记", () => {
  it("识别 [jump:novel/123] 为 JumpBlock（novel 类型）", () => {
    const blocks = parseNovelBlocks("[jump:novel/123]", null);
    expect(blocks).toEqual([{ type: "jump", kind: "novel", target: "novel/123" }]);
  });

  it("识别 [jump2:illust/456]（jump2 变体）与外部链接", () => {
    expect(parseJumpKind("illust/456")).toBe("illust");
    expect(parseJumpKind("user/789")).toBe("user");
    expect(parseJumpKind("https://example.com/a")).toBe("external");
    expect(parseJumpKind("unknown-thing")).toBe("unknown");
  });
});

describe("parseInlineRuns — 行内装饰标记", () => {
  it("[b]…[/b] 粗体 → 样式区间 + 净化文本", () => {
    const { cleanText, runs } = parseInlineRuns("这是[b]重点[/b]内容");
    expect(cleanText).toBe("这是重点内容");
    expect(runs).toEqual([{ start: 2, end: 4, tag: "bold" }]);
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

describe("parseNovelBlocks — 全标记混合 + 索引对齐", () => {
  it("混合样例：chapter + newpage + image + 行内装饰正文", () => {
    const images = { "100": { urls: { "480mw": "https://i.pximg.net/a.jpg" } } as never };
    const text = "[chapter: 第一章]\n第一[b]段[/b]\n[newpage]\n[pixivimage:100]\n第二段";
    const blocks = parseNovelBlocks(text, images as never);
    expect(blocks.map((b) => b.type)).toEqual(["chapter", "text", "pageBreak", "image", "text"]);
    const textBlocks = blocks.filter((b) => b.type === "text");
    expect(textBlocks.map((b) => b.index)).toEqual([0, 1]);
    expect(textBlocks[0].text).toBe("第一段");
    // 净化后 "第一段"：第=0 一=1 段=2 → [b] 包 "段"
    expect(textBlocks[0].inlineRuns).toEqual([{ start: 2, end: 3, tag: "bold" }]);
  });

  it("buildSearchText 只含净化后的 text 段落（索引对齐）", () => {
    const blocks = parseNovelBlocks("[chapter: 序]\n甲[b]乙[/b]丙\n[newpage]\n丁", null);
    expect(buildSearchText(blocks)).toBe("甲乙丙\n\n丁");
  });
});

// ─── novelBlocks 属性测试 ───
// 期望值来源 = 性质/不变量（oracle 为性质本身，不从实现反推）：
//
// parseInlineRuns 的问题定义（Pixiv 正文装饰标记语义，见 src/utils/novelBlocks.ts 注释）：
//   [b]/[i]/[s]/[u] 开闭标记 → 剥标记保留内容；[ruby:主:注音] → 保留主文剥离标记与注音；
//   [memo]…[/memo] → 整体剥离；未知 […] → 原样保留（正文可能含 [1] 等方括号文本，不得误剥）。
// 由此 round-trip 不变量：
//   - cleanText = 原文剥掉全部「已识别」标记（简单标记集输入下，cleanText 不含任何已识别标记语法）
//   - cleanText 与按标记语义独立剥离的参考结果一致（参考实现不计算样式区间，仅做文本剥离）
//
// parseNovelBlocks 的问题定义（实现注释声明）：
//   - 仅 TextBlock 占用 textIndex（chapter/jump/image/pageBreak 不占）⇒ text 块 index 从 0 连续递增
//   - inlineRuns 区间相对 cleanText（start 包含 / end 不包含）⇒ start ∈ [0, len)、end ∈ (start, len]
//     且（非嵌套标记输入下）区间两两不重叠
//
// 生成策略：简单标记集生成器（非嵌套、成对闭合，标记内部文本非空，杜绝空区间 run(0,0)）；
// 普通文本字符集排除 [ ] 与换行，避免未知标记/嵌套/未闭合等实现防御面干扰性质域
// （这些面的语义在实现注释中已声明，但不属于本性质声明的输入域）。
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseInlineRuns, parseNovelBlocks } from "@/utils/novelBlocks";
import type { NovelImagesMap } from "@/api/novel";

// ── 简单标记集生成器 ──

/** 普通文本字符（不含 [ ] 与换行，保证不引入未知标记/空行分隔） */
const plainChar = fc.constantFrom("a", "b", " ", ",", "1", "2");
/** 可空文本 token（普通文本） */
const text = fc.array(plainChar, { minLength: 0, maxLength: 10 }).map((cs) => cs.join(""));
/** 非空文本 token（标记内部内容，杜绝空区间） */
const innerText = fc.array(plainChar, { minLength: 1, maxLength: 10 }).map((cs) => cs.join(""));

const openClose = (tag: "b" | "i" | "s" | "u") =>
  fc
    .tuple(fc.constant(`[${tag}]`), innerText, fc.constant(`[/${tag}]`))
    .map(([open, t, close]) => open + t + close);

const ruby = fc
  .tuple(fc.constant("[ruby:"), innerText, fc.constant(":"), innerText, fc.constant("]"))
  .map(([open, main, colon, note, close]) => open + main + colon + note + close);

const memo = fc
  .tuple(fc.constant("[memo]"), innerText, fc.constant("[/memo]"))
  .map(([open, t, close]) => open + t + close);

const inlineToken = fc.oneof(
  text,
  openClose("b"),
  openClose("i"),
  openClose("s"),
  openClose("u"),
  ruby,
  memo,
);
const inlineText = fc.array(inlineToken, { minLength: 0, maxLength: 12 }).map((ts) => ts.join(""));

// ── 参考剥离器（oracle）：按标记语义剥除已识别标记，不计算样式区间 ──

function stripTags(raw: string): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] !== "[") {
      out += raw[i];
      i++;
      continue;
    }
    const close = raw.indexOf("]", i);
    if (close === -1) {
      out += raw[i];
      i++;
      continue;
    }
    const inner = raw.slice(i + 1, close);
    if (/^[bisu]$/u.test(inner)) {
      i = close + 1; // 开标记：剥除
      continue;
    }
    if (/^\/[bisu]$/u.test(inner)) {
      i = close + 1; // 闭标记：剥除
      continue;
    }
    const rubyMatch = inner.match(/^ruby:([^:]*):/u);
    if (rubyMatch) {
      out += rubyMatch[1]; // ruby：保留主文
      i = close + 1;
      continue;
    }
    if (inner === "memo") {
      const end = raw.indexOf("[/memo]", close); // memo：整体剥离
      i = end === -1 ? close + 1 : end + "[/memo]".length;
      continue;
    }
    out += raw.slice(i, close + 1); // 未知标记：原样保留
    i = close + 1;
  }
  return out;
}

const KNOWN_MARKERS = [
  "[b]",
  "[/b]",
  "[i]",
  "[/i]",
  "[s]",
  "[/s]",
  "[u]",
  "[/u]",
  "[ruby:",
  "[memo]",
  "[/memo]",
];

describe("parseInlineRuns 属性（oracle=性质/不变量）", () => {
  it("round-trip：cleanText 不含任何已识别标记语法", () => {
    fc.assert(
      fc.property(inlineText, (raw) => {
        const { cleanText } = parseInlineRuns(raw);
        for (const marker of KNOWN_MARKERS) {
          expect(cleanText.includes(marker)).toBe(false);
        }
      }),
    );
  });

  it("round-trip：cleanText 与按标记语义独立剥离的参考结果一致", () => {
    fc.assert(
      fc.property(inlineText, (raw) => {
        expect(parseInlineRuns(raw).cleanText).toBe(stripTags(raw));
      }),
    );
  });

  it("行内区间：start ∈ [0, len)、end ∈ (start, len]，且互不重叠（非嵌套标记输入）", () => {
    fc.assert(
      fc.property(inlineText, (raw) => {
        const { cleanText, runs } = parseInlineRuns(raw);
        for (const r of runs) {
          expect(r.start).toBeGreaterThanOrEqual(0);
          expect(r.start).toBeLessThan(cleanText.length);
          expect(r.end).toBeGreaterThan(r.start);
          expect(r.end).toBeLessThanOrEqual(cleanText.length);
        }
        const sorted = runs.toSorted((a, b) => a.start - b.start);
        for (let k = 1; k < sorted.length; k++) {
          expect(sorted[k].start).toBeGreaterThanOrEqual(sorted[k - 1].end);
        }
      }),
    );
  });
});

// ── parseNovelBlocks 生成器 ──

const imageIdArb = fc.integer({ min: 1, max: 9999 }).map(String);
const imageLineArb = fc
  .tuple(fc.constantFrom("[uploadedimage:", "[pixivimage:"), imageIdArb, fc.constant("]"))
  .map(([open, id, close]) => ({ line: open + id + close, id }));

const chapterLineArb = fc
  .tuple(fc.constant("[chapter:"), innerText, fc.constant("]"))
  .map(([open, t, close]) => open + t + close);

const jumpLineArb = fc
  .tuple(fc.constantFrom("[jump:", "[jump2:"), innerText, fc.constant("]"))
  .map(([open, t, close]) => open + t + close);

const newpageLineArb = fc.constant("[newpage]");

/** 任意行：文本行（含简单行内标记）或特殊块行 */
const anyLineArb = fc.oneof(inlineText, imageLineArb, chapterLineArb, jumpLineArb, newpageLineArb);

function makeImageItem(id: string) {
  return {
    novelImageId: id,
    sl: "",
    urls: { "240mw": "", "480mw": "", "1200x1200": "", "128x128": "", original: "" },
  };
}

/** 小说正文：行序列 join("\n")，images 映射保证覆盖所有生成的图片行 id */
const novelTextArb = fc.array(anyLineArb, { minLength: 0, maxLength: 15 }).map((lines) => {
  const images: Record<string, ReturnType<typeof makeImageItem>> = {};
  const parts: string[] = [];
  for (const l of lines) {
    if (typeof l === "string") {
      parts.push(l);
    } else {
      images[l.id] = makeImageItem(l.id);
      parts.push(l.line);
    }
  }
  return { text: parts.join("\n"), images: images as NovelImagesMap };
});

describe("parseNovelBlocks 属性（oracle=性质/不变量）", () => {
  it("text 块 index 从 0 连续递增、无重复无间隙", () => {
    fc.assert(
      fc.property(novelTextArb, ({ text: rawText, images }) => {
        const blocks = parseNovelBlocks(rawText, images);
        const indexes = blocks.filter((b) => b.type === "text").map((b) => b.index);
        expect(indexes).toEqual(indexes.map((_, i) => i));
      }),
    );
  });

  it("text 块的 inlineRuns 区间合法且互不重叠（相对 cleanText）", () => {
    fc.assert(
      fc.property(novelTextArb, ({ text: rawText, images }) => {
        const blocks = parseNovelBlocks(rawText, images);
        for (const b of blocks) {
          if (b.type !== "text") continue;
          const runs = b.inlineRuns ?? [];
          for (const r of runs) {
            expect(r.start).toBeGreaterThanOrEqual(0);
            expect(r.start).toBeLessThan(b.text.length);
            expect(r.end).toBeGreaterThan(r.start);
            expect(r.end).toBeLessThanOrEqual(b.text.length);
          }
          const sorted = runs.toSorted((a, b2) => a.start - b2.start);
          for (let k = 1; k < sorted.length; k++) {
            expect(sorted[k].start).toBeGreaterThanOrEqual(sorted[k - 1].end);
          }
        }
      }),
    );
  });
});

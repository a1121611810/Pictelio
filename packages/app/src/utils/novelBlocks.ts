import type { NovelImageUrls, NovelImagesMap } from "@/api/novel";

/** 文本段落块 */
export interface TextBlock {
  type: "text";
  /** 该文本段落在纯文本段落序列中的索引，用于搜索/进度映射 */
  index: number;
  /** 净化后纯文本（已去除行内标记语法）——布局/搜索/进度/翻译索引以它为准 */
  text: string;
  /** 行内样式区间（相对 text 的字符区间，start 包含 / end 不包含；可空） */
  inlineRuns?: InlineRun[];
}

/** 行内样式区间 */
export interface InlineRun {
  start: number;
  end: number;
  tag: "bold" | "italic" | "strike" | "underline";
}

/** 内嵌图片块 */
export interface ImageBlock {
  type: "image";
  imageId: string;
  urls: NovelImageUrls;
}

/** 分页标记块 */
interface PageBreakBlock {
  type: "pageBreak";
}

/** 章节标题块（`[chapter:标题]`） */
export interface ChapterBlock {
  type: "chapter";
  title: string;
}

/** 站内跳转块（`[jump:…]` / `[jump2:…]`） */
export interface JumpBlock {
  type: "jump";
  kind: "illust" | "novel" | "user" | "external" | "unknown";
  /** 原始目标（如 novel/123、illust/456、https://…） */
  target: string;
}

export type NovelBlock = TextBlock | ImageBlock | PageBreakBlock | ChapterBlock | JumpBlock;

const IMAGE_PLACEHOLDER_RE = /^\[(uploadedimage|pixivimage):(\d+)\]$/u;
const NEWPAGE_RE = /^\[newpage\]$/u;
const CHAPTER_RE = /^\[chapter:\s*(.+?)\s*\]$/u;
const JUMP_RE = /^\[jump2?:\s*(.+?)\s*\]$/u;

/** 行内开标记 → 样式 tag（Pixiv 正文装饰标记） */
const INLINE_OPEN_TAGS: Record<string, InlineRun["tag"]> = {
  b: "bold",
  i: "italic",
  s: "strike",
  u: "underline",
};

/**
 * 解析段落的行内标记，输出净化纯文本 + 样式区间。
 *
 * 支持（Pixiv 正文装饰标记）：
 * - `[b]…[/b]` 粗体 / `[i]…[/i]` 斜体 / `[s]…[/s]` 删除线 / `[u]…[/u]` 下划线 → 样式区间
 * - `[ruby:主:注音]` → 保留主文本，剥离标记与注音
 * - `[memo]…[/memo]` → 整体剥离（编辑备注，阅读不显示）
 * - 未知 `[…]` 保留原样（正文可能含 `[1]` 等方括号文本，不得误剥）
 *
 * 区间索引基于净化后的 text（与 TextBlock.text 对齐），保证布局/搜索/进度零偏移。
 */
export function parseInlineRuns(raw: string): { cleanText: string; runs: InlineRun[] } {
  const runs: InlineRun[] = [];
  const stack: { tag: InlineRun["tag"]; start: number }[] = [];
  let clean = "";
  let i = 0;
  const n = raw.length;

  while (i < n) {
    const ch = raw[i];
    if (ch !== "[") {
      clean += ch;
      i++;
      continue;
    }
    const close = raw.indexOf("]", i);
    if (close === -1) {
      clean += ch;
      i++;
      continue;
    }
    const inner = raw.slice(i + 1, close);

    // 开标记 [b]/[i]/[s]/[u]
    const openTag = INLINE_OPEN_TAGS[inner];
    if (openTag) {
      stack.push({ tag: openTag, start: clean.length });
      i = close + 1;
      continue;
    }
    // 闭标记 [/b] 等：找栈中最近同 tag（支持嵌套）
    const closeMatch = inner.match(/^\/([bisu])$/u);
    if (closeMatch) {
      const tag = INLINE_OPEN_TAGS[closeMatch[1]];
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].tag === tag) {
          runs.push({ start: stack[k].start, end: clean.length, tag });
          stack.splice(k, 1);
          break;
        }
      }
      i = close + 1;
      continue;
    }
    // [ruby:主:注音] → 只保留主文本
    const ruby = inner.match(/^ruby:([^:]*):/u);
    if (ruby) {
      clean += ruby[1];
      i = close + 1;
      continue;
    }
    // [memo]…[/memo] → 整体剥离
    if (inner === "memo") {
      const endTag = raw.indexOf("[/memo]", close);
      i = endTag === -1 ? close + 1 : endTag + "[/memo]".length;
      continue;
    }
    // 未知标记：保留原样
    clean += raw.slice(i, close + 1);
    i = close + 1;
  }

  return { cleanText: clean, runs };
}

/** 解析 jump 目标类型（illust/novel/user 站内 + 外部链接） */
export function parseJumpKind(target: string): JumpBlock["kind"] {
  const t = target.trim();
  if (t.startsWith("illust/")) return "illust";
  if (t.startsWith("novel/")) return "novel";
  if (t.startsWith("user/")) return "user";
  if (/^https?:\/\//u.test(t)) return "external";
  return "unknown";
}

/**
 * 将小说原始正文解析为混合块序列。
 *
 * - `[uploadedimage:id]` / `[pixivimage:id]` → ImageBlock（仅当 id 存在于 images 映射时）
 * - `[newpage]` → PageBreakBlock
 * - `[chapter:标题]` → ChapterBlock（章节标题特殊渲染）
 * - `[jump:…]` / `[jump2:…]` → JumpBlock（站内跳转链接）
 * - 其他非空行 → TextBlock（净化行内标记，含 inlineRuns 样式区间）
 *
 * 仅 TextBlock 占用 textIndex（chapter/jump/image/pageBreak 不占），
 * 保证搜索/进度/翻译的段落索引始终与纯文本段落对齐。
 */
export function parseNovelBlocks(text: string, images: NovelImagesMap | null): NovelBlock[] {
  const imageMap = images ?? {};
  const blocks: NovelBlock[] = [];
  let textIndex = 0;

  for (const part of text.split(/\n+/u)) {
    if (part.length === 0) {
      continue;
    }

    const imageMatch = part.match(IMAGE_PLACEHOLDER_RE);
    if (imageMatch) {
      const imageId = imageMatch[2];
      const item = imageMap[imageId];
      if (item) {
        blocks.push({ type: "image", imageId, urls: item.urls });
        continue;
      }
    }

    if (NEWPAGE_RE.test(part)) {
      blocks.push({ type: "pageBreak" });
      continue;
    }

    const chapterMatch = part.match(CHAPTER_RE);
    if (chapterMatch) {
      blocks.push({ type: "chapter", title: chapterMatch[1].trim() });
      continue;
    }

    const jumpMatch = part.match(JUMP_RE);
    if (jumpMatch) {
      const target = jumpMatch[1].trim();
      blocks.push({ type: "jump", kind: parseJumpKind(target), target });
      continue;
    }

    const { cleanText, runs } = parseInlineRuns(part);
    blocks.push({
      type: "text",
      index: textIndex,
      text: cleanText,
      ...(runs.length > 0 ? { inlineRuns: runs } : {}),
    });
    textIndex++;
  }

  return blocks;
}

/**
 * 从块序列中重建纯文本，供搜索使用。
 * 段落之间用 `\n\n` 拼接，保证搜索返回的 paragraphIndex 与 TextBlock.index 对齐。
 */
export function buildSearchText(blocks: NovelBlock[]): string {
  return blocks
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");
}

/**
 * 根据容器宽度选择适合 inline 显示的图片 URL。
 * ≤480 CSS px 使用 480mw，否则使用 1200x1200。
 */
export function selectInlineImageUrl(urls: NovelImageUrls, containerWidth: number): string {
  return containerWidth > 480 ? urls["1200x1200"] : urls["480mw"];
}

/**
 * 收集所有图片块，用于构建全屏查看器的 URL 列表。
 */
export function getImageBlocks(blocks: NovelBlock[]): ImageBlock[] {
  return blocks.filter((block): block is ImageBlock => block.type === "image");
}

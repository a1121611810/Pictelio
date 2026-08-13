import { prepareWithSegments, layoutNextLine } from "@chenglou/pretext";
import { ALLOWED_FONT_FAMILIES } from "@/stores/readerSettingsStore";

/** 段落内的单行范围 */
interface LineRange {
  /** 段落内字符起始索引 */
  start: number;
  /** 段落内字符结束索引（不包含） */
  end: number;
  /** 该行文本渲染宽度 px */
  width: number;
}

/** 单个段落的布局结果 */
export interface ParagraphLayout {
  /** 段落在原文中的索引 */
  index: number;
  /** 段落顶部距全文顶部的 px */
  offset: number;
  /** 段落高度 px */
  height: number;
  /** 段落行数 */
  lineCount: number;
  /** 每行字符范围 */
  lineRanges: LineRange[];
}

/** 布局函数输入 */
interface NovelTextLayoutInput {
  /** 已净化的纯文本段落数组 */
  paragraphs: string[];
  /** 容器有效宽度 px（已去除 padding） */
  containerWidth: number;
  /** 字号 px */
  fontSize: number;
  /** 字重 300~700 */
  fontWeight: number;
  /** 字体族，只允许 ReaderSettings 中定义的值 */
  fontFamily: string;
  /** 行高倍数，如 1.8 */
  lineHeight: number;
  /** 段落间距 px */
  paragraphSpacing: number;
  /** 首行缩进 px */
  textIndent: number;
}

/** 布局函数输出 */
export interface NovelTextLayoutResult {
  paragraphs: ParagraphLayout[];
  /** 全文总高度 px */
  totalHeight: number;
  /** 实际行高 px，等于 fontSize * lineHeight */
  lineHeightPx: number;
  /** 根据段落内字符索引获取其顶部距全文顶部的 px */
  getOffsetByCharIndex(paragraphIndex: number, charIndex: number): number;
  /** 根据全文像素偏移获取最近的段落与字符索引 */
  getCharIndexByOffset(offset: number): { paragraphIndex: number; charIndex: number };
}

/** 输入校验失败时抛出的错误 */
export class NovelTextLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NovelTextLayoutError";
  }
}

function validateInput(input: NovelTextLayoutInput): void {
  if (input.containerWidth <= 0) {
    throw new NovelTextLayoutError("containerWidth must be positive");
  }
  if (input.fontSize < 12 || input.fontSize > 28) {
    throw new NovelTextLayoutError("fontSize must be between 12 and 28");
  }
  if (!ALLOWED_FONT_FAMILIES.includes(input.fontFamily as (typeof ALLOWED_FONT_FAMILIES)[number])) {
    throw new NovelTextLayoutError(`fontFamily must be one of ${ALLOWED_FONT_FAMILIES.join(", ")}`);
  }
}

function buildFontString(fontWeight: number, fontSize: number, fontFamily: string): string {
  // 字体加载失败时统一回退到 sans-serif，确保 pretext 与浏览器渲染一致
  return `${fontWeight} ${fontSize}px ${fontFamily}, sans-serif`;
}

function computeParagraph(
  paragraph: string,
  index: number,
  prevOffset: number,
  containerWidth: number,
  firstLineWidth: number,
  lineHeightPx: number,
  fontString: string,
): ParagraphLayout {
  const lineRanges: LineRange[] = [];

  if (paragraph.length === 0) {
    return {
      index,
      offset: prevOffset,
      height: lineHeightPx,
      lineCount: 1,
      lineRanges: [{ start: 0, end: 0, width: 0 }],
    };
  }

  const prepared = prepareWithSegments(paragraph, fontString);
  let cursor = { segmentIndex: 0, graphemeIndex: 0 };
  let charIndex = 0;

  // 首行使用缩进后的可用宽度
  const firstLine = layoutNextLine(prepared, cursor, firstLineWidth);
  if (firstLine != null) {
    const end = charIndex + firstLine.text.length;
    lineRanges.push({
      start: charIndex,
      end,
      width: firstLine.width,
    });
    cursor = firstLine.end;
    charIndex = end;
  }

  // 剩余行使用完整宽度
  while (true) {
    const line = layoutNextLine(prepared, cursor, containerWidth);
    if (line == null) {
      break;
    }
    const end = charIndex + line.text.length;
    lineRanges.push({
      start: charIndex,
      end,
      width: line.width,
    });
    cursor = line.end;
    charIndex = end;
  }

  const lineCount = lineRanges.length;
  // +2px 安全边距补偿 Android WebView Canvas measureText vs DOM 渲染差异
  const height = lineCount * lineHeightPx + 2;

  return {
    index,
    offset: prevOffset,
    height,
    lineCount,
    lineRanges,
  };
}

/**
 * 基于 pretext 的小说纯文本段落布局计算。
 *
 * 输入纯文本段落、容器宽度与字体参数，输出每个段落的高度、行数、行范围，
 * 以及全文总高度和字符索引到像素位置的映射。
 *
 * 时间复杂度：O(P × L)，其中 P 为段落数，L 为平均每段行数。
 *
 * @param input 布局输入参数
 * @returns 布局结果
 */
export function createNovelTextLayout(input: NovelTextLayoutInput): NovelTextLayoutResult {
  validateInput(input);

  const {
    paragraphs,
    containerWidth,
    fontSize,
    fontWeight,
    fontFamily,
    lineHeight,
    paragraphSpacing,
    textIndent,
  } = input;

  const lineHeightPx = fontSize * lineHeight;
  // 缩小 3% 容器宽度补偿 Android WebView Canvas measureText vs DOM 字体度量差异。
  // 不同字体（如 Noto Sans CJK vs MiSans）的字符宽度不同，缩小宽度让 Canvas 提前换行，
  // 使计算行数 >= 实际行数，避免因少算行导致的文字溢出重叠。
  const adjustedWidth = Math.max(1, containerWidth * 0.97);
  const firstLineWidth = Math.max(0, adjustedWidth - textIndent);
  const fontString = buildFontString(fontWeight, fontSize, fontFamily);

  const paragraphLayouts: ParagraphLayout[] = [];
  let currentOffset = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i];
    const layout = computeParagraph(
      paragraph,
      i,
      currentOffset,
      adjustedWidth,
      firstLineWidth,
      lineHeightPx,
      fontString,
    );
    paragraphLayouts.push(layout);
    currentOffset += layout.height + paragraphSpacing;
  }

  // 去除最后一段的 paragraphSpacing
  const totalHeight = paragraphs.length > 0 ? currentOffset - paragraphSpacing : 0;

  function getOffsetByCharIndex(paragraphIndex: number, charIndex: number): number {
    const paragraph = paragraphLayouts[paragraphIndex];
    if (!paragraph) {
      return 0;
    }

    const clampedCharIndex = Math.max(
      0,
      Math.min(charIndex, paragraph.lineRanges[paragraph.lineRanges.length - 1]?.end ?? 0),
    );
    for (const line of paragraph.lineRanges) {
      if (clampedCharIndex >= line.start && clampedCharIndex < line.end) {
        return (
          paragraph.offset +
          Math.floor(
            line.end - line.start > 0
              ? ((clampedCharIndex - line.start) / (line.end - line.start)) * lineHeightPx
              : 0,
          )
        );
      }
    }
    // 落在最后一段末尾之后
    return paragraph.offset + paragraph.height;
  }

  function getCharIndexByOffset(offset: number): { paragraphIndex: number; charIndex: number } {
    if (paragraphLayouts.length === 0 || offset <= 0) {
      return { paragraphIndex: 0, charIndex: 0 };
    }

    // 二分查找：第一个 bottom 超过 offset 的段落
    let left = 0;
    let right = paragraphLayouts.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      const paragraph = paragraphLayouts[mid];
      if (offset < paragraph.offset + paragraph.height) {
        right = mid;
      } else {
        left = mid + 1;
      }
    }

    const paragraphIndex = Math.min(left, paragraphLayouts.length - 1);
    const paragraph = paragraphLayouts[paragraphIndex];

    if (offset <= paragraph.offset) {
      return { paragraphIndex: paragraph.index, charIndex: 0 };
    }
    if (offset >= paragraph.offset + paragraph.height) {
      const lastLine = paragraph.lineRanges[paragraph.lineRanges.length - 1];
      return { paragraphIndex: paragraph.index, charIndex: lastLine?.end ?? 0 };
    }

    const lineOffset = offset - paragraph.offset;
    const lineIndex = Math.min(
      Math.floor(lineOffset / lineHeightPx),
      paragraph.lineRanges.length - 1,
    );
    const line = paragraph.lineRanges[lineIndex];
    if (!line) {
      return { paragraphIndex: paragraph.index, charIndex: 0 };
    }

    const progressInLine = (lineOffset - lineIndex * lineHeightPx) / lineHeightPx;
    const charIndex = Math.floor(line.start + progressInLine * (line.end - line.start));
    return { paragraphIndex: paragraph.index, charIndex };
  }

  return {
    paragraphs: paragraphLayouts,
    totalHeight,
    lineHeightPx,
    getOffsetByCharIndex,
    getCharIndexByOffset,
  };
}

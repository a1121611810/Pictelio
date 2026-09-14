/**
 * 导出文档模型（IR）构造：NovelExportPayload / NovelExportTaskDraft。
 * 对齐 docs/specs/novel-export.md §3.2/§3.3/§3.4 与 ADR-0154 D3。
 */
import { parseNovelBlocks, parseInlineRuns, type InlineRun, type JumpBlock, type NovelBlock } from "./blocks";
import { extForNovelExportFormat, type NovelExportFormat } from "./formats";
import type { NovelImageUrls, NovelImagesMap } from "./types";

/** 内容开关（三项全局布尔；正文恒含） */
export interface NovelExportOptions {
  includeMetadata: boolean;
  includeCover: boolean;
  includeInlineImages: boolean;
}

export const DEFAULT_NOVEL_EXPORT_OPTIONS: NovelExportOptions = {
  includeMetadata: true,
  includeCover: true,
  includeInlineImages: true,
};

/** 导出文档元数据 */
export interface NovelExportMeta {
  id: number;
  title: string;
  authorId: number;
  authorName: string;
  tags: string[];
  seriesId?: number;
  seriesTitle?: string;
  createDate: string;
  sourceUrl: string;
  /** caption 去 Pixiv 标记后的纯文本 */
  description?: string;
  xRestrict: number;
  /** image_urls.large ?? medium ?? square_medium */
  coverUrl?: string;
}

/** 导出文档块（已把图片/跳转解析为可用的单 URL） */
export type NovelExportBlock =
  | { type: "text"; index: number; text: string; inlineRuns?: InlineRun[] }
  | { type: "image"; imageId: string; url: string }
  | { type: "pageBreak" }
  | { type: "chapter"; title: string }
  | {
      type: "jump";
      kind: "illust" | "novel" | "user" | "external" | "unknown";
      target: string;
      url: string;
    };

/** 导出文档模型（所有格式编码器的唯一输入） */
export interface NovelExportPayload {
  schema: 1;
  meta: NovelExportMeta;
  options: NovelExportOptions;
  blocks: NovelExportBlock[];
}

/** 入队草稿（kind="novel"；payloadJson 为 opaque 快照） */
export interface NovelExportTaskDraft {
  id: string;
  illustId: number;
  title: string;
  thumbnailUrl: string;
  kind: "novel";
  sourceUrl: string;
  targetFormat: NovelExportFormat;
  fileName: string;
  payloadJson: string;
}

/** 构造 payload 所需的小说最小结构字段（app / app-lynx 的 PixivNovel 均满足） */
export interface PixivNovelLike {
  id: number;
  title: string;
  user: { id: number; name: string };
  image_urls: {
    square_medium?: string;
    medium?: string;
    large?: string;
    original?: string;
  };
  tags: { name: string; translated_name?: string }[];
  series?: { id: number; title: string };
  create_date: string;
  caption?: string;
  x_restrict: number;
}

/** 图片 URL 解析顺序（spec §3.3） */
function resolveImageUrl(urls: NovelImageUrls): string | undefined {
  return urls["1200x1200"] ?? urls["original"] ?? urls["480mw"] ?? urls["240mw"];
}

/** jump 站内 id（target 形如 "illust/123"） */
function jumpTargetId(target: string, kind: "illust" | "novel" | "user"): string {
  return target.trim().slice(kind.length + 1);
}

/** jump URL 映射（spec §3.3；external/unknown 原样） */
function resolveJumpUrl(kind: JumpBlock["kind"], target: string): string {
  switch (kind) {
    case "illust":
      return `https://www.pixiv.net/artworks/${jumpTargetId(target, "illust")}`;
    case "novel":
      return `https://www.pixiv.net/novel/show.php?id=${jumpTargetId(target, "novel")}`;
    case "user":
      return `https://www.pixiv.net/users/${jumpTargetId(target, "user")}`;
    case "external":
    case "unknown":
      return target;
  }
}

/** 把块解析结果映射为导出块；图片无可用 URL 时丢弃并 warn（不静默伪造） */
function mapBlock(block: NovelBlock): NovelExportBlock | null {
  switch (block.type) {
    case "text":
      return {
        type: "text",
        index: block.index,
        text: block.text,
        ...(block.inlineRuns ? { inlineRuns: block.inlineRuns } : {}),
      };
    case "image": {
      const url = resolveImageUrl(block.urls);
      if (!url) {
        console.warn(`[novel-export] 图片 ${block.imageId} 缺少可用 URL，已丢弃该图片块`);
        return null;
      }
      return { type: "image", imageId: block.imageId, url };
    }
    case "pageBreak":
      return { type: "pageBreak" };
    case "chapter":
      return { type: "chapter", title: block.title };
    case "jump":
      return {
        type: "jump",
        kind: block.kind,
        target: block.target,
        url: resolveJumpUrl(block.kind, block.target),
      };
  }
}

/**
 * 构造导出文档模型。
 * - 标签：name，存在且不同的 translated_name 追加 ` (译文)`
 * - sourceUrl：原文展示链接
 * - description：caption 经 parseInlineRuns 去标记
 * - blocks：parseNovelBlocks 映射（图片解析为单 URL / 跳转解析为完整 URL）
 */
export function buildNovelExportPayload(input: {
  novel: PixivNovelLike;
  text: string;
  images: NovelImagesMap | null;
  options: NovelExportOptions;
}): NovelExportPayload {
  const { novel, text, images, options } = input;

  const meta: NovelExportMeta = {
    id: novel.id,
    title: novel.title,
    authorId: novel.user.id,
    authorName: novel.user.name,
    tags: novel.tags.map((tag) =>
      tag.translated_name && tag.translated_name !== tag.name
        ? `${tag.name} (${tag.translated_name})`
        : tag.name,
    ),
    createDate: novel.create_date,
    sourceUrl: `https://www.pixiv.net/novel/show.php?id=${novel.id}`,
    xRestrict: novel.x_restrict,
  };

  if (novel.series) {
    meta.seriesId = novel.series.id;
    meta.seriesTitle = novel.series.title;
  }
  if (novel.caption !== undefined) {
    meta.description = parseInlineRuns(novel.caption).cleanText;
  }
  const coverUrl =
    novel.image_urls.large ?? novel.image_urls.medium ?? novel.image_urls.square_medium;
  if (coverUrl) {
    meta.coverUrl = coverUrl;
  }

  const blocks = parseNovelBlocks(text, images)
    .map(mapBlock)
    .filter((block): block is NovelExportBlock => block !== null);

  return { schema: 1, meta, options: { ...options }, blocks };
}

/** 任务 id：novel_<id>_<format>_<sig>，sig=[metadata,cover,images].map(on=>on?"1":"0") */
export function novelExportTaskId(
  novelId: number,
  format: NovelExportFormat,
  options: NovelExportOptions,
): string {
  const sig = [options.includeMetadata, options.includeCover, options.includeInlineImages]
    .map((on) => (on ? "1" : "0"))
    .join("");
  return `novel_${novelId}_${format}_${sig}`;
}

/** 文件名：Pictelio_<id>.<ext> */
export function novelExportFileName(novelId: number, format: NovelExportFormat): string {
  return `Pictelio_${novelId}.${extForNovelExportFormat(format)}`;
}

/** 构造入队草稿（kind="novel" + payloadJson + targetFormat + fileName） */
export function buildNovelExportTaskDraft(input: {
  payload: NovelExportPayload;
  format: NovelExportFormat;
  title: string;
  thumbnailUrl: string;
}): NovelExportTaskDraft {
  const { payload, format, title, thumbnailUrl } = input;
  return {
    id: novelExportTaskId(payload.meta.id, format, payload.options),
    illustId: payload.meta.id,
    title,
    thumbnailUrl,
    kind: "novel",
    sourceUrl: payload.meta.sourceUrl,
    targetFormat: format,
    fileName: novelExportFileName(payload.meta.id, format),
    payloadJson: JSON.stringify(payload),
  };
}

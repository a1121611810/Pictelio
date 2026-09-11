/**
 * 导出格式白名单 / 默认值 / 标签 / 扩展名 / MIME（单一事实源）。
 * 对齐 docs/specs/novel-export.md §3.1 与 §4 D4。
 */

export type NovelExportFormat =
  | "txt"
  | "html"
  | "md"
  | "docx"
  | "pdf"
  | "epub"
  | "rtf"
  | "json"
  | "fb2";

export const NOVEL_EXPORT_FORMATS = [
  "txt",
  "html",
  "md",
  "docx",
  "pdf",
  "epub",
  "rtf",
  "json",
  "fb2",
] as const;

export const DEFAULT_NOVEL_EXPORT_FORMAT: NovelExportFormat = "txt";

export const NOVEL_EXPORT_FORMAT_LABELS: Record<NovelExportFormat, string> = {
  txt: "TXT",
  html: "HTML",
  md: "Markdown",
  docx: "Word (.docx)",
  pdf: "PDF",
  epub: "EPUB",
  rtf: "RTF",
  json: "JSON",
  fb2: "FB2",
};

/** 9 种格式的扩展名（DOC 口径为真 OOXML docx） */
const EXT_BY_FORMAT: Record<NovelExportFormat, string> = {
  txt: "txt",
  html: "html",
  md: "md",
  docx: "docx",
  pdf: "pdf",
  epub: "epub",
  rtf: "rtf",
  json: "json",
  fb2: "fb2",
};

/** 9 种格式的 MIME（对齐 spec §4 D4，未知不再回退 image/jpeg） */
const MIME_BY_FORMAT: Record<NovelExportFormat, string> = {
  txt: "text/plain",
  html: "text/html",
  md: "text/markdown",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  epub: "application/epub+zip",
  rtf: "application/rtf",
  json: "application/json",
  fb2: "application/x-fictionbook+xml",
};

export function extForNovelExportFormat(format: NovelExportFormat): string {
  return EXT_BY_FORMAT[format];
}

export function mimeForNovelExportFormat(format: NovelExportFormat): string {
  return MIME_BY_FORMAT[format];
}

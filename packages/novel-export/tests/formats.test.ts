// Oracle: docs/specs/novel-export.md §3.1（NovelExportFormat 白名单 / 默认值 / 标签）
//         + §4 D4 与 §5（9 格式的扩展名与 MIME 映射字面量）
import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOVEL_EXPORT_FORMAT,
  NOVEL_EXPORT_FORMATS,
  NOVEL_EXPORT_FORMAT_LABELS,
  extForNovelExportFormat,
  mimeForNovelExportFormat,
  type NovelExportFormat,
} from "../src/index";

// 期望值直接取自 spec 字面量，不从实现反推。
const EXPECTED_FORMATS = ["txt", "html", "md", "docx", "pdf", "epub", "rtf", "json", "fb2"] as const;

const EXPECTED_MIME: Record<NovelExportFormat, string> = {
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

describe("格式表（spec §3.1）", () => {
  it("NOVEL_EXPORT_FORMATS 恰为 9 项且顺序与 spec 一致", () => {
    expect(NOVEL_EXPORT_FORMATS).toEqual(EXPECTED_FORMATS);
    expect(NOVEL_EXPORT_FORMATS).toHaveLength(9);
  });

  it("默认格式为 txt", () => {
    expect(DEFAULT_NOVEL_EXPORT_FORMAT).toBe("txt");
  });

  it("标签表覆盖全部 9 种格式", () => {
    expect(NOVEL_EXPORT_FORMAT_LABELS).toEqual({
      txt: "TXT",
      html: "HTML",
      md: "Markdown",
      docx: "Word (.docx)",
      pdf: "PDF",
      epub: "EPUB",
      rtf: "RTF",
      json: "JSON",
      fb2: "FB2",
    });
  });
});

describe("ext / mime 映射（spec §4 D4 / §5）", () => {
  it.each(EXPECTED_FORMATS)("%s 的扩展名等于格式名", (format) => {
    expect(extForNovelExportFormat(format)).toBe(format);
  });

  it.each(EXPECTED_FORMATS)("%s 的 MIME 正确", (format) => {
    expect(mimeForNovelExportFormat(format)).toBe(EXPECTED_MIME[format]);
  });
});

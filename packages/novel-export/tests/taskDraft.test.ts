// Oracle: docs/specs/novel-export.md §3.3/§3.4（任务 id 签名 novel_<id>_<format>_<sig>、文件名 Pictelio_<id>.<ext>、payloadJson 快照）
//         + docs/adr/ADR-0154-novel-export.md D3（入队即快照 targetFormat 与内容开关）
import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOVEL_EXPORT_OPTIONS,
  buildNovelExportPayload,
  buildNovelExportTaskDraft,
  novelExportFileName,
  novelExportTaskId,
  type NovelExportOptions,
  type PixivNovelLike,
} from "../src/index";

const REAL_NOVEL: PixivNovelLike = {
  id: 42,
  title: "Test Novel",
  user: { id: 456, name: "Author" },
  image_urls: { large: "https://example.com/large.jpg" },
  tags: [{ name: "tag1" }],
  create_date: "2025-01-01T00:00:00+00:00",
  x_restrict: 0,
};

const payload = buildNovelExportPayload({
  novel: REAL_NOVEL,
  text: "第一段\n第二段",
  images: null,
  options: DEFAULT_NOVEL_EXPORT_OPTIONS,
});

describe("novelExportTaskId — 内容开关签名", () => {
  it("全开为 111", () => {
    expect(novelExportTaskId(42, "txt", DEFAULT_NOVEL_EXPORT_OPTIONS)).toBe("novel_42_txt_111");
  });

  it("签名顺序 metadata/cover/images，on=1 off=0", () => {
    expect(
      novelExportTaskId(42, "pdf", { includeMetadata: true, includeCover: false, includeInlineImages: false }),
    ).toBe("novel_42_pdf_100");
    expect(
      novelExportTaskId(7, "epub", { includeMetadata: false, includeCover: true, includeInlineImages: true }),
    ).toBe("novel_7_epub_011");
    expect(
      novelExportTaskId(7, "json", { includeMetadata: false, includeCover: false, includeInlineImages: false }),
    ).toBe("novel_7_json_000");
  });

  it("同格式同开关签名稳定（可去重），改开关则另存一条", () => {
    const a: NovelExportOptions = { includeMetadata: true, includeCover: true, includeInlineImages: true };
    const b: NovelExportOptions = { includeMetadata: true, includeCover: true, includeInlineImages: false };
    expect(novelExportTaskId(1, "txt", a)).toBe(novelExportTaskId(1, "txt", a));
    expect(novelExportTaskId(1, "txt", a)).not.toBe(novelExportTaskId(1, "txt", b));
  });
});

describe("novelExportFileName", () => {
  it("Pictelio_<id>.<ext>", () => {
    expect(novelExportFileName(42, "txt")).toBe("Pictelio_42.txt");
    expect(novelExportFileName(42, "docx")).toBe("Pictelio_42.docx");
    expect(novelExportFileName(24980988, "fb2")).toBe("Pictelio_24980988.fb2");
  });
});

describe("buildNovelExportTaskDraft", () => {
  it("草稿字段与下载队列契约一致（kind=novel / payloadJson 快照）", () => {
    const draft = buildNovelExportTaskDraft({
      payload,
      format: "txt",
      title: "Test Novel",
      thumbnailUrl: "https://example.com/thumb.jpg",
    });
    expect(draft).toEqual({
      id: "novel_42_txt_111",
      illustId: 42,
      title: "Test Novel",
      thumbnailUrl: "https://example.com/thumb.jpg",
      kind: "novel",
      sourceUrl: "https://www.pixiv.net/novel/show.php?id=42",
      targetFormat: "txt",
      fileName: "Pictelio_42.txt",
      payloadJson: JSON.stringify(payload),
    });
  });

  it("payloadJson 往返无损（JSON 解析后深等于原 payload）", () => {
    const draft = buildNovelExportTaskDraft({
      payload,
      format: "json",
      title: "t",
      thumbnailUrl: "u",
    });
    expect(JSON.parse(draft.payloadJson)).toEqual(payload);
    expect(draft.fileName).toBe("Pictelio_42.json");
  });

  it("临时覆盖格式不写回 payload.options，仅影响 id/文件名/目标格式", () => {
    const draft = buildNovelExportTaskDraft({ payload, format: "epub", title: "t", thumbnailUrl: "u" });
    expect(draft.targetFormat).toBe("epub");
    expect(draft.id).toContain("_epub_");
    expect(draft.fileName).toBe("Pictelio_42.epub");
    expect(JSON.parse(draft.payloadJson).options).toEqual(DEFAULT_NOVEL_EXPORT_OPTIONS);
  });
});

// Oracle: fixtures/sample-payload.json 由 buildNovelExportPayload 的真实产出生成（跨语言契约 TS 侧锚点）。
// 本测试锁定「构建器输出 == golden」；Java NovelExportModel 解析同一 golden（test resources 副本，
// 由 app differential 一致性测试守护字节相等）——任一侧字段重命名都会让链路断开。
import { describe, expect, it } from "vitest";
import { DEFAULT_NOVEL_EXPORT_OPTIONS, buildNovelExportPayload } from "../src/index";
import { SAMPLE_IMAGES, SAMPLE_NOVEL, SAMPLE_TEXT } from "./fixtures/sampleInput";
import goldenJson from "./fixtures/sample-payload.json";

describe("golden payload（跨语言契约 TS 侧）", () => {
  it("buildNovelExportPayload(SAMPLE_INPUT) 与 fixtures/sample-payload.json 深相等", () => {
    const built = buildNovelExportPayload({
      novel: SAMPLE_NOVEL,
      text: SAMPLE_TEXT,
      images: SAMPLE_IMAGES,
      options: DEFAULT_NOVEL_EXPORT_OPTIONS,
    });
    expect(built).toEqual(goldenJson);
  });
});

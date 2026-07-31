import { describe, it, expect, vi } from "vitest";
import {
  translateParagraphs,
  alignParagraphs,
  type NovelTranslatorDeps,
} from "@/primitives/createNovelTranslator";

describe("alignParagraphs", () => {
  it("aligns when translated count equals original count", () => {
    const original = ["段一", "段二", "段三"];
    const result = alignParagraphs("译文一\n\n译文二\n\n译文三", original);
    expect(result).toEqual(["译文一", "译文二", "译文三"]);
  });

  it("falls back to original paragraphs when translated count is fewer (warns)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = ["段一", "段二", "段三"];
    const result = alignParagraphs("译文一", original);
    expect(result).toEqual(["译文一", "段二", "段三"]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[createNovelTranslator]"));
    warnSpy.mockRestore();
  });

  it("truncates extra translated paragraphs (warns)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const original = ["段一", "段二"];
    const result = alignParagraphs("译文一\n\n译文二\n\n译文三", original);
    expect(result).toEqual(["译文一", "译文二"]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[createNovelTranslator]"));
    warnSpy.mockRestore();
  });
});

describe("translateParagraphs", () => {
  it("joins paragraphs into one request and returns aligned translation", async () => {
    const requestTranslate = vi
      .fn()
      .mockResolvedValue({ content: "译文一\n\n译文二", finishReason: "stop" });
    const deps: NovelTranslatorDeps = {
      requestTranslate: requestTranslate as never,
    };

    const result = await translateParagraphs(
      ["原文一", "原文二"],
      { apiKey: "sk-test", model: "deepseek-v4-flash", sourceLang: "ja" },
      deps,
    );

    expect(result).toEqual(["译文一", "译文二"]);
    const payload = requestTranslate.mock.calls[0][0] as {
      apiKey: string;
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(payload.apiKey).toBe("sk-test");
    expect(payload.model).toBe("deepseek-v4-flash");
    expect(payload.messages[0].role).toBe("system");
    expect(payload.messages[0].content).toContain("日语");
    expect(payload.messages[1]).toEqual({ role: "user", content: "原文一\n\n原文二" });
  });

  it("returns empty array for empty input without calling the API", async () => {
    const requestTranslate = vi.fn();
    const result = await translateParagraphs(
      [],
      { apiKey: "k", model: "deepseek-v4-flash" },
      {
        requestTranslate: requestTranslate as never,
      },
    );
    expect(result).toEqual([]);
    expect(requestTranslate).not.toHaveBeenCalled();
  });

  it("propagates translate errors (e.g. unauthorized)", async () => {
    const requestTranslate = vi.fn().mockRejectedValue(new Error("401"));
    await expect(
      translateParagraphs(
        ["x"],
        { apiKey: "bad", model: "deepseek-v4-flash" },
        {
          requestTranslate: requestTranslate as never,
        },
      ),
    ).rejects.toThrow("401");
  });
});

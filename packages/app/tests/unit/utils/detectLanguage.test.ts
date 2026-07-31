import { describe, it, expect } from "vitest";
import { detectNovelLanguage } from "@/utils/detectLanguage";

describe("detectNovelLanguage（MVP：ja/en/zh/other）", () => {
  it("detects Japanese by kana ratio (>1%)", () => {
    expect(
      detectNovelLanguage("図書館の奥で、彼女は古びた本を開いた。文字はかすかに滲んでいる。"),
    ).toBe("ja");
  });

  it("detects English by latin ratio (>10%)", () => {
    expect(
      detectNovelLanguage(
        "She opened an old book in the corner of the library. The pages were yellowed.",
      ),
    ).toBe("en");
  });

  it("detects simplified Chinese by CJK ratio", () => {
    expect(detectNovelLanguage("她在图书馆的角落里翻开一本旧书。书页已经泛黄，字迹模糊。")).toBe(
      "zh",
    );
  });

  it("returns other for empty or mixed text", () => {
    expect(detectNovelLanguage("")).toBe("other");
    expect(detectNovelLanguage("12345 !!!")).toBe("other");
  });

  it("samples only the first 500 characters", () => {
    const jp = "あ".repeat(600);
    expect(detectNovelLanguage(jp)).toBe("ja");
  });
});

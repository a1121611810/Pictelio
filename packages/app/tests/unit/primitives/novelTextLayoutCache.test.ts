import { describe, it, expect } from "vitest";
import {
  getNovelTextLayoutCache,
  clearNovelTextLayoutCache,
  buildCacheKey,
} from "@/primitives/novelTextLayoutCache";
import type { NovelTextLayoutResult } from "@/primitives/createNovelTextLayout";
import type { ReaderSettings } from "@/stores/readerSettingsStore";

function makeResult(totalHeight = 100): NovelTextLayoutResult {
  return {
    paragraphs: [],
    totalHeight,
    lineHeightPx: 24,
    getOffsetByCharIndex: () => 0,
    getCharIndexByOffset: () => ({ paragraphIndex: 0, charIndex: 0 }),
  };
}

function makeSettings(overrides: Partial<ReaderSettings> = {}): ReaderSettings {
  return {
    fontSize: 16,
    fontWeight: 400,
    fontFamily: "sans-serif",
    fontColor: "",
    lineHeight: 1.8,
    bgColor: "",
    ...overrides,
  };
}

describe("novelTextLayoutCache", () => {
  it("returns undefined for missing key", () => {
    clearNovelTextLayoutCache();
    const cache = getNovelTextLayoutCache();
    expect(cache.get(1, 400, makeSettings())).toBeUndefined();
  });

  it("stores and retrieves a result", () => {
    clearNovelTextLayoutCache();
    const cache = getNovelTextLayoutCache();
    const result = makeResult(123);
    cache.set(1, 400, makeSettings(), result);
    expect(cache.get(1, 400, makeSettings())?.totalHeight).toBe(123);
  });

  it("returns undefined when settings differ", () => {
    clearNovelTextLayoutCache();
    const cache = getNovelTextLayoutCache();
    cache.set(1, 400, makeSettings({ fontSize: 16 }), makeResult());
    expect(cache.get(1, 400, makeSettings({ fontSize: 18 }))).toBeUndefined();
  });

  it("returns undefined when containerWidth differs by more than 1px", () => {
    clearNovelTextLayoutCache();
    const cache = getNovelTextLayoutCache();
    cache.set(1, 400, makeSettings(), makeResult());
    expect(cache.get(1, 402, makeSettings())).toBeUndefined();
    expect(cache.get(1, 401, makeSettings())).toBeUndefined();
    expect(cache.get(1, 400.5, makeSettings())).toBeDefined();
  });

  it("evicts oldest entries when max size is exceeded", () => {
    clearNovelTextLayoutCache();
    const cache = getNovelTextLayoutCache();
    cache.set(1, 400, makeSettings(), makeResult(1));
    cache.set(2, 400, makeSettings(), makeResult(2));
    cache.set(3, 400, makeSettings(), makeResult(3));
    cache.set(4, 400, makeSettings(), makeResult(4));
    expect(cache.get(1, 400, makeSettings())).toBeUndefined();
    expect(cache.get(2, 400, makeSettings())?.totalHeight).toBe(2);
    expect(cache.get(3, 400, makeSettings())?.totalHeight).toBe(3);
    expect(cache.get(4, 400, makeSettings())?.totalHeight).toBe(4);
  });

  it("re-inserts accessed entries to protect them from eviction", () => {
    clearNovelTextLayoutCache();
    const cache = getNovelTextLayoutCache();
    cache.set(1, 400, makeSettings(), makeResult(1));
    cache.set(2, 400, makeSettings(), makeResult(2));
    cache.set(3, 400, makeSettings(), makeResult(3));
    // Access novel 1 so it becomes most recently used
    cache.get(1, 400, makeSettings());
    cache.set(4, 400, makeSettings(), makeResult(4));
    expect(cache.get(1, 400, makeSettings())?.totalHeight).toBe(1);
    expect(cache.get(2, 400, makeSettings())).toBeUndefined();
  });

  it("clears all entries", () => {
    clearNovelTextLayoutCache();
    const cache = getNovelTextLayoutCache();
    cache.set(1, 400, makeSettings(), makeResult());
    clearNovelTextLayoutCache();
    expect(cache.get(1, 400, makeSettings())).toBeUndefined();
  });
});

describe("buildCacheKey", () => {
  it("includes novelId, width and relevant settings", () => {
    const settings = makeSettings();
    expect(buildCacheKey(1, 400, settings)).toBe(
      [
        1,
        400,
        settings.fontSize,
        settings.fontWeight,
        settings.fontFamily,
        settings.lineHeight,
        "",
      ].join(":"),
    );
  });

  it("includes the translation variant when provided", () => {
    const settings = makeSettings();
    expect(buildCacheKey(1, 400, settings, "translated")).toBe(
      [
        1,
        400,
        settings.fontSize,
        settings.fontWeight,
        settings.fontFamily,
        settings.lineHeight,
        "translated",
      ].join(":"),
    );
  });

  it("keeps original and translated layouts separate", () => {
    clearNovelTextLayoutCache();
    const cache = getNovelTextLayoutCache();
    cache.set(1, 400, makeSettings(), makeResult(100), "translated");
    expect(cache.get(1, 400, makeSettings(), "translated")?.totalHeight).toBe(100);
    expect(cache.get(1, 400, makeSettings())).toBeUndefined();
    expect(cache.get(1, 400, makeSettings(), "translated")?.totalHeight).toBe(100);
  });
});

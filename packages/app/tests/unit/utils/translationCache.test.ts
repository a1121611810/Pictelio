import { describe, it, expect, beforeEach } from "vitest";
import {
  buildTranslationKey,
  getTranslation,
  setTranslation,
  clearTranslationCache,
  setTestStore,
  MAX_TRANSLATIONS,
} from "@/utils/translationCache";
import { createMemoryStore } from "@/stores/db";

beforeEach(() => {
  setTestStore(createMemoryStore());
});

const TARGET = "zh-Hans";
const MODEL = "deepseek-v4-flash";

describe("buildTranslationKey（维度隔离）", () => {
  it("produces deterministic keys", () => {
    expect(buildTranslationKey(1, TARGET, MODEL)).toBe(buildTranslationKey(1, TARGET, MODEL));
  });

  it("differs across novelId / targetLang / modelId", () => {
    const a = buildTranslationKey(1, TARGET, MODEL);
    expect(buildTranslationKey(2, TARGET, MODEL)).not.toBe(a);
    expect(buildTranslationKey(1, "zh-Hant", MODEL)).not.toBe(a);
    expect(buildTranslationKey(1, TARGET, "deepseek-v4-pro")).not.toBe(a);
  });
});

describe("translationCache 读写", () => {
  it("stores and retrieves paragraphs", async () => {
    await setTranslation(1, TARGET, MODEL, "hash-a", ["译文一", "译文二"]);
    const got = await getTranslation(1, TARGET, MODEL, "hash-a");
    expect(got).toEqual(["译文一", "译文二"]);
  });

  it("returns undefined for missing entry", async () => {
    expect(await getTranslation(999, TARGET, MODEL, "hash-x")).toBeUndefined();
  });

  it("invalidates on sourceHash change (作者改文自动失效)", async () => {
    await setTranslation(1, TARGET, MODEL, "hash-old", ["旧译文"]);
    expect(await getTranslation(1, TARGET, MODEL, "hash-old")).toEqual(["旧译文"]);
    expect(await getTranslation(1, TARGET, MODEL, "hash-new")).toBeUndefined();
  });

  it("isolates cache by model dimension", async () => {
    await setTranslation(1, TARGET, "deepseek-v4-flash", "hash-a", ["flash 译文"]);
    expect(await getTranslation(1, TARGET, "deepseek-v4-flash", "hash-a")).toEqual(["flash 译文"]);
    expect(await getTranslation(1, TARGET, "deepseek-v4-pro", "hash-a")).toBeUndefined();
  });

  it("isolates cache by target language dimension", async () => {
    await setTranslation(1, "zh-Hans", MODEL, "hash-a", ["简中译文"]);
    expect(await getTranslation(1, "zh-Hans", MODEL, "hash-a")).toEqual(["简中译文"]);
    expect(await getTranslation(1, "zh-Hant", MODEL, "hash-a")).toBeUndefined();
  });

  it("evicts oldest entries beyond LRU cap", async () => {
    for (let i = 0; i < MAX_TRANSLATIONS + 10; i++) {
      await setTranslation(1000 + i, TARGET, MODEL, `hash-${i}`, [`译文${i}`]);
    }
    // 最旧的 10 条被淘汰，最新 200 条存活
    for (let i = 0; i < 10; i++) {
      expect(await getTranslation(1000 + i, TARGET, MODEL, `hash-${i}`)).toBeUndefined();
    }
    for (let i = 10; i < 15; i++) {
      expect(await getTranslation(1000 + i, TARGET, MODEL, `hash-${i}`)).toEqual([`译文${i}`]);
    }
  });

  it("clears all translations", async () => {
    await setTranslation(1, TARGET, MODEL, "hash-a", ["译文"]);
    await clearTranslationCache();
    expect(await getTranslation(1, TARGET, MODEL, "hash-a")).toBeUndefined();
  });
});

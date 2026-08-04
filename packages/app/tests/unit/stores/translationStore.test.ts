// @vitest-environment happy-dom
/**
 * translationStore 单元测试 —— 注入式（memory adapter）+ SecureStorage mock。
 *
 * 设置类 5 项用 settings registry 托管；测试通过 getter mock + 每次 loadStore
 * 重建 settings 实例。ds_api_key 走 SecureStorage 独立路径，用 hoisted mock。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Settings } from "@/settings/types";

const secureStorageMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@aparajita/capacitor-secure-storage", () => ({
  SecureStorage: secureStorageMock,
}));

const mockState = vi.hoisted(() => ({
  current: null as Settings | null,
}));

vi.mock("@/settings", () => ({
  get settings() {
    return mockState.current;
  },
}));

async function loadStore(seed: Record<string, string> = {}) {
  vi.resetModules();
  vi.clearAllMocks();
  const { createSettings } = await import("@/settings/registry");
  const { createMemoryAdapter } = await import("@/settings/backends/memory");
  const mem = createMemoryAdapter(seed);
  const settings = createSettings({ storages: { preferences: mem } });
  mockState.current = settings;
  const store = await import("@/stores/translationStore");
  await settings.hydrateAll();
  return { store, mem };
}

describe("API key（BYOK）存储（SecureStorage 独立路径）", () => {
  it("loads a saved key from secure storage", async () => {
    const { store } = await loadStore();
    secureStorageMock.get.mockResolvedValue("sk-saved");
    await store.loadDsApiKey();
    expect(store.dsApiKey()).toBe("sk-saved");
    expect(secureStorageMock.get).toHaveBeenCalledWith("ds_api_key");
  });

  it("sets null when storage returns empty", async () => {
    const { store } = await loadStore();
    secureStorageMock.get.mockResolvedValue("");
    await store.loadDsApiKey();
    expect(store.dsApiKey()).toBeNull();
  });

  it("sets null and warns when storage read fails（静默降级必须 warn）", async () => {
    const { store } = await loadStore();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    secureStorageMock.get.mockRejectedValue(new Error("Keystore unavailable"));
    await store.loadDsApiKey();
    expect(store.dsApiKey()).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[translationStore]"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("saves and trims the key", async () => {
    const { store } = await loadStore();
    secureStorageMock.set.mockResolvedValue();
    await store.saveDsApiKey("  sk-new  ");
    expect(secureStorageMock.set).toHaveBeenCalledWith("ds_api_key", "sk-new");
    expect(store.dsApiKey()).toBe("sk-new");
  });

  it("clears the key when saving empty string", async () => {
    const { store } = await loadStore();
    secureStorageMock.remove.mockResolvedValue();
    await store.saveDsApiKey("   ");
    expect(secureStorageMock.remove).toHaveBeenCalledWith("ds_api_key");
    expect(store.dsApiKey()).toBeNull();
  });

  it("clears the key", async () => {
    const { store } = await loadStore();
    secureStorageMock.remove.mockResolvedValue();
    await store.clearDsApiKey();
    expect(secureStorageMock.remove).toHaveBeenCalledWith("ds_api_key");
    expect(store.dsApiKey()).toBeNull();
  });

  it("warns and rethrows when save fails", async () => {
    const { store } = await loadStore();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    secureStorageMock.set.mockRejectedValue(new Error("write fail"));
    await expect(store.saveDsApiKey("sk-x")).rejects.toThrow("write fail");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[translationStore]"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});

describe("详情页翻译显示状态", () => {
  it("tracks translated paragraphs and original/translated toggle", async () => {
    const { store } = await loadStore();
    store.setTranslatedParagraphs({ 0: "译文一", 1: "译文二" });
    expect(store.translatedParagraphs()).toEqual({ 0: "译文一", 1: "译文二" });
    store.setShowTranslation(true);
    expect(store.showTranslation()).toBe(true);
  });

  it("resets translation state on chapter switch", async () => {
    const { store } = await loadStore();
    store.setTranslatedParagraphs({ 0: "旧章译文" });
    store.setShowTranslation(true);
    store.resetTranslationState();
    expect(store.translatedParagraphs()).toEqual({});
    expect(store.showTranslation()).toBe(false);
  });

  it("tracks failed paragraphs and clears them on reset (S4 断点续翻)", async () => {
    const { store } = await loadStore();
    store.setFailedParagraphs(new Set([2, 5]));
    expect(store.failedParagraphs().has(2)).toBe(true);
    expect(store.failedParagraphs().has(5)).toBe(true);
    expect(store.failedParagraphs().has(0)).toBe(false);
    store.resetTranslationState();
    expect(store.failedParagraphs().size).toBe(0);
  });

  it("tracks thinking usage and clears on reset (S4 防思考译文混入非思考缓存)", async () => {
    const { store } = await loadStore();
    expect(store.translationUsedThinking()).toBe(false);
    store.setTranslationUsedThinking(true);
    expect(store.translationUsedThinking()).toBe(true);
    store.resetTranslationState();
    expect(store.translationUsedThinking()).toBe(false);
  });
});

describe("decideTranslatePolicy（x_restrict 分级决策函数全组合）", () => {
  it("allows all-age content regardless of switches", async () => {
    const { store } = await loadStore();
    expect(store.decideTranslatePolicy(0, false, false)).toBe("allow");
    expect(store.decideTranslatePolicy(0, true, true)).toBe("allow");
  });

  it("blocks R18 when the R18 switch is off, allows when on", async () => {
    const { store } = await loadStore();
    expect(store.decideTranslatePolicy(1, false, false)).toBe("block");
    expect(store.decideTranslatePolicy(1, false, true)).toBe("block");
    expect(store.decideTranslatePolicy(1, true, false)).toBe("allow");
  });

  it("blocks R18G when the R18G switch is off, allows when on", async () => {
    const { store } = await loadStore();
    expect(store.decideTranslatePolicy(2, true, false)).toBe("block");
    expect(store.decideTranslatePolicy(2, false, false)).toBe("block");
    expect(store.decideTranslatePolicy(2, false, true)).toBe("allow");
  });

  it("defensively allows unknown restrict levels", async () => {
    const { store } = await loadStore();
    expect(store.decideTranslatePolicy(3, false, false)).toBe("allow");
  });
});

describe("R18/R18G 开关持久化（默认关）", () => {
  it("defaults both switches to off", async () => {
    const { store } = await loadStore();
    expect(store.translateR18()).toBe(false);
    expect(store.translateR18G()).toBe(false);
  });

  it("persists switch state", async () => {
    const { store, mem } = await loadStore();
    await store.setTranslateR18(true);
    expect(store.translateR18()).toBe(true);
    await vi.waitFor(() => expect(mem.dump().get("translation_r18")).toBe("true"));
    await store.setTranslateR18G(true);
    expect(store.translateR18G()).toBe(true);
    await vi.waitFor(() => expect(mem.dump().get("translation_r18g")).toBe("true"));
  });

  it("tracks R18 risk confirmation and persists it", async () => {
    const { store, mem } = await loadStore();
    expect(store.getR18Confirmed()).toBe(false);
    await store.markR18Confirmed();
    expect(store.getR18Confirmed()).toBe(true);
    await vi.waitFor(() => expect(mem.dump().get("translation_r18_confirmed")).toBe("true"));
  });

  it("hydrateAll 恢复持久化的开关与确认标记", async () => {
    const { store } = await loadStore({
      translation_r18: "true",
      translation_r18g: "false",
      translation_r18_confirmed: "true",
    });
    expect(store.translateR18()).toBe(true);
    expect(store.translateR18G()).toBe(false);
    expect(store.getR18Confirmed()).toBe(true);
  });
});

describe("翻译档位与思考开关（S6，决策 #22）", () => {
  it("defaults to standard tier (flash) with thinking off", async () => {
    const { store } = await loadStore();
    expect(store.defaultTier()).toBe("flash");
    expect(store.thinkingEnabled()).toBe(false);
  });

  it("maps tiers to DeepSeek models", async () => {
    const { store } = await loadStore();
    expect(store.TIER_MODELS.flash).toBe("deepseek-v4-flash");
    expect(store.TIER_MODELS.pro).toBe("deepseek-v4-pro");
  });

  it("persists tier and thinking switches", async () => {
    const { store, mem } = await loadStore();
    await store.setDefaultTier("pro");
    expect(store.defaultTier()).toBe("pro");
    await vi.waitFor(() => expect(mem.dump().get("translation_default_tier")).toBe("pro"));
    await store.setThinkingEnabled(true);
    expect(store.thinkingEnabled()).toBe(true);
    await vi.waitFor(() => expect(mem.dump().get("translation_thinking")).toBe("true"));
  });

  it("hydrateAll 恢复档位与思考", async () => {
    const { store } = await loadStore({ translation_default_tier: "pro", translation_thinking: "true" });
    expect(store.defaultTier()).toBe("pro");
    expect(store.thinkingEnabled()).toBe(true);
  });
});

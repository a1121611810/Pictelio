import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@aparajita/capacitor-secure-storage", () => ({
  SecureStorage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
}));

import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import {
  dsApiKey,
  loadDsApiKey,
  saveDsApiKey,
  clearDsApiKey,
  translatedParagraphs,
  setTranslatedParagraphs,
  showTranslation,
  setShowTranslation,
  resetTranslationState,
} from "@/stores/translationStore";

const secureGet = vi.mocked(SecureStorage.get);
const secureSet = vi.mocked(SecureStorage.set);
const secureRemove = vi.mocked(SecureStorage.remove);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("API key（BYOK）存储", () => {
  it("loads a saved key from secure storage", async () => {
    secureGet.mockResolvedValue("sk-saved");
    await loadDsApiKey();
    expect(dsApiKey()).toBe("sk-saved");
    expect(secureGet).toHaveBeenCalledWith("ds_api_key");
  });

  it("sets null when storage returns empty", async () => {
    secureGet.mockResolvedValue("");
    await loadDsApiKey();
    expect(dsApiKey()).toBeNull();
  });

  it("sets null and warns when storage read fails（静默降级必须 warn）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    secureGet.mockRejectedValue(new Error("Keystore unavailable"));
    await loadDsApiKey();
    expect(dsApiKey()).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[translationStore]"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("saves and trims the key", async () => {
    secureSet.mockResolvedValue();
    await saveDsApiKey("  sk-new  ");
    expect(secureSet).toHaveBeenCalledWith("ds_api_key", "sk-new");
    expect(dsApiKey()).toBe("sk-new");
  });

  it("clears the key when saving empty string", async () => {
    secureRemove.mockResolvedValue();
    await saveDsApiKey("   ");
    expect(secureRemove).toHaveBeenCalledWith("ds_api_key");
    expect(dsApiKey()).toBeNull();
  });

  it("clears the key", async () => {
    secureRemove.mockResolvedValue();
    await clearDsApiKey();
    expect(secureRemove).toHaveBeenCalledWith("ds_api_key");
    expect(dsApiKey()).toBeNull();
  });

  it("warns and rethrows when save fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    secureSet.mockRejectedValue(new Error("write fail"));
    await expect(saveDsApiKey("sk-x")).rejects.toThrow("write fail");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[translationStore]"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});

describe("详情页翻译显示状态", () => {
  it("tracks translated paragraphs and original/translated toggle", () => {
    setTranslatedParagraphs({ 0: "译文一", 1: "译文二" });
    expect(translatedParagraphs()).toEqual({ 0: "译文一", 1: "译文二" });
    setShowTranslation(true);
    expect(showTranslation()).toBe(true);
  });

  it("resets translation state on chapter switch", () => {
    setTranslatedParagraphs({ 0: "旧章译文" });
    setShowTranslation(true);
    resetTranslationState();
    expect(translatedParagraphs()).toEqual({});
    expect(showTranslation()).toBe(false);
  });
});

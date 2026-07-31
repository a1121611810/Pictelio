import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@aparajita/capacitor-secure-storage", () => ({
  SecureStorage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
}));

import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { Preferences } from "@capacitor/preferences";
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
  decideTranslatePolicy,
  translateR18,
  translateR18G,
  setTranslateR18,
  setTranslateR18G,
  markR18Confirmed,
  getR18Confirmed,
  loadTranslateRestrictSettings,
} from "@/stores/translationStore";

const secureGet = vi.mocked(SecureStorage.get);
const secureSet = vi.mocked(SecureStorage.set);
const secureRemove = vi.mocked(SecureStorage.remove);
const prefGet = vi.mocked(Preferences.get);
const prefSet = vi.mocked(Preferences.set);

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

describe("decideTranslatePolicy（x_restrict 分级决策函数全组合）", () => {
  it("allows all-age content regardless of switches", () => {
    expect(decideTranslatePolicy(0, false, false)).toBe("allow");
    expect(decideTranslatePolicy(0, true, true)).toBe("allow");
  });

  it("blocks R18 when the R18 switch is off, allows when on", () => {
    expect(decideTranslatePolicy(1, false, false)).toBe("block");
    expect(decideTranslatePolicy(1, false, true)).toBe("block"); // R18G 开关不影响 R18
    expect(decideTranslatePolicy(1, true, false)).toBe("allow");
  });

  it("blocks R18G when the R18G switch is off, allows when on", () => {
    expect(decideTranslatePolicy(2, true, false)).toBe("block"); // R18 开关不影响 R18G
    expect(decideTranslatePolicy(2, false, false)).toBe("block");
    expect(decideTranslatePolicy(2, false, true)).toBe("allow");
  });

  it("defensively allows unknown restrict levels", () => {
    expect(decideTranslatePolicy(3, false, false)).toBe("allow");
  });
});

describe("R18/R18G 开关持久化（默认关）", () => {
  it("defaults both switches to off", () => {
    expect(translateR18()).toBe(false);
    expect(translateR18G()).toBe(false);
  });

  it("persists switch state to Preferences", async () => {
    prefSet.mockResolvedValue();
    await setTranslateR18(true);
    expect(translateR18()).toBe(true);
    expect(prefSet).toHaveBeenCalledWith({ key: "translation_r18", value: "true" });
    await setTranslateR18G(true);
    expect(translateR18G()).toBe(true);
    expect(prefSet).toHaveBeenCalledWith({ key: "translation_r18g", value: "true" });
  });

  it("tracks R18 risk confirmation and persists it", async () => {
    prefSet.mockResolvedValue();
    expect(getR18Confirmed()).toBe(false);
    await markR18Confirmed();
    expect(getR18Confirmed()).toBe(true);
    expect(prefSet).toHaveBeenCalledWith({
      key: "translation_r18_confirmed",
      value: "true",
    });
  });

  it("loads persisted switches and confirmation", async () => {
    prefGet.mockImplementation(async ({ key }: { key: string }) => {
      if (key === "translation_r18") return { value: "true" };
      if (key === "translation_r18g") return { value: "false" };
      if (key === "translation_r18_confirmed") return { value: "true" };
      return { value: null };
    });
    await loadTranslateRestrictSettings();
    expect(translateR18()).toBe(true);
    expect(translateR18G()).toBe(false);
    expect(getR18Confirmed()).toBe(true);
  });
});

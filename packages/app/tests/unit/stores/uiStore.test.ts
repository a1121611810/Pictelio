import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: vi.fn(), isNativePlatform: vi.fn(() => false) },
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: vi.fn(), set: vi.fn() },
}));

let originalDocument: unknown;

beforeAll(() => {
  originalDocument = (globalThis as any).document;
  (globalThis as any).document = {
    documentElement: {
      classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
    },
  };
  // Mock window.matchMedia for theme system
  vi.stubGlobal("window", {
    matchMedia: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  // Mock localStorage for theme persistence dual-write
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((k) => delete store[k]);
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  });
});

afterAll(() => {
  (globalThis as any).document = originalDocument;
});

/** 原 loadStore 已废弃 — settings 相关测试使用 loadSettingsStore，ui 相关使用 loadBothStores */

async function loadSettingsStore() {
  vi.resetModules();
  const mod = await import("@/stores/settingsStore");
  return mod;
}

async function loadBothStores() {
  vi.resetModules();
  const uiMod = await import("@/stores/uiStore");
  const settingsMod = await import("@/stores/settingsStore");
  return { ...uiMod, ...settingsMod };
}

describe("age preference", () => {
  beforeEach(() => {
    (globalThis as any).window = { dispatchEvent: vi.fn() };
    (globalThis as any).CustomEvent = class CustomEvent {
      constructor(public type: string) {}
    };
    vi.mocked(Preferences.set).mockResolvedValue(undefined);
  });

  it("defaults ageConfirmed and isAdult to false", async () => {
    const { ageConfirmed, isAdult } = await loadSettingsStore();

    expect(ageConfirmed()).toBe(false);
    expect(isAdult()).toBe(false);
  });

  it("loading persisted minor state forces showR18 and showR18G to false", async () => {
    vi.mocked(Preferences.get).mockImplementation(async ({ key }) => {
      if (key === "age_confirmed") {
        return { value: "true" };
      }
      if (key === "is_adult") {
        return { value: "false" };
      }
      return { value: null };
    });

    const { loadAgePreference, setShowR18, setShowR18G, showR18, showR18G } =
      await loadSettingsStore();
    await setShowR18(true);
    await setShowR18G(true);
    await loadAgePreference();

    expect(showR18()).toBe(false);
    expect(showR18G()).toBe(false);
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "show_r18",
      value: "false",
    });
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "show_r18g",
      value: "false",
    });
  });

  it("loading persisted adult state leaves showR18 and showR18G as persisted", async () => {
    vi.mocked(Preferences.get).mockImplementation(async ({ key }) => {
      if (key === "age_confirmed") {
        return { value: "true" };
      }
      if (key === "is_adult") {
        return { value: "true" };
      }
      if (key === "show_r18") {
        return { value: "true" };
      }
      if (key === "show_r18g") {
        return { value: "true" };
      }
      return { value: null };
    });

    const { loadAgePreference, loadShowR18Preference, loadShowR18GPreference, showR18, showR18G } =
      await loadSettingsStore();
    await loadShowR18Preference();
    await loadShowR18GPreference();
    await loadAgePreference();

    expect(showR18()).toBe(true);
    expect(showR18G()).toBe(true);
  });

  it("setAgeConfirmation(true, false) sets minor and disables adult content", async () => {
    const { setAgeConfirmation, ageConfirmed, isAdult, showR18, showR18G } =
      await loadSettingsStore();

    await setAgeConfirmation(true, false);

    expect(ageConfirmed()).toBe(true);
    expect(isAdult()).toBe(false);
    expect(showR18()).toBe(false);
    expect(showR18G()).toBe(false);
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "age_confirmed",
      value: "true",
    });
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "is_adult",
      value: "false",
    });
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "show_r18",
      value: "false",
    });
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "show_r18g",
      value: "false",
    });
  });

  it("setAgeConfirmation(true, true) sets adult", async () => {
    const { setAgeConfirmation, ageConfirmed, isAdult } = await loadSettingsStore();

    await setAgeConfirmation(true, true);

    expect(ageConfirmed()).toBe(true);
    expect(isAdult()).toBe(true);
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "age_confirmed",
      value: "true",
    });
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "is_adult",
      value: "true",
    });
  });
});

describe("resetUiStore", () => {
  beforeEach(() => {
    (globalThis as any).window = { dispatchEvent: vi.fn() };
    (globalThis as any).CustomEvent = class CustomEvent {
      constructor(public type: string) {}
    };
    vi.mocked(Capacitor.getPlatform).mockReturnValue("web");
    vi.mocked(Preferences.set).mockResolvedValue(undefined);
  });

  it("resets all ui signals to defaults and persists preferences", async () => {
    const {
      resetUiStore,
      setShowR18,
      setShowR18G,
      setLayoutMode,
      setAutoHideNavBar,
      setShowDetailStairs,
      setAgeConfirmation,
      showR18,
      showR18G,
      layoutMode,
      autoHideNavBar,
      showDetailStairs,
      ageConfirmed,
      isAdult,
      imageCacheDisk,
      imageCacheBrowser,
      imageCachePrefetch,
    } = await loadBothStores();

    await setShowR18(true);
    await setShowR18G(true);
    await setLayoutMode("grid");
    await setAutoHideNavBar(false);
    await setShowDetailStairs(true);
    await setAgeConfirmation(true, true);

    await resetUiStore();

    expect(showR18()).toBe(false);
    expect(showR18G()).toBe(false);
    expect(layoutMode()).toBe("waterfall");
    expect(autoHideNavBar()).toBe(true);
    expect(showDetailStairs()).toBe(false);
    expect(ageConfirmed()).toBe(false);
    expect(isAdult()).toBe(false);
    expect(imageCacheDisk()).toBe(true);
    expect(imageCacheBrowser()).toBe(true);
    expect(imageCachePrefetch()).toBe(true);
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "show_r18",
      value: "false",
    });
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "show_r18g",
      value: "false",
    });
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "layout_mode",
      value: "waterfall",
    });
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "auto_hide_nav_bar",
      value: "true",
    });
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "show_detail_stairs",
      value: "false",
    });
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "age_confirmed",
      value: "false",
    });
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "is_adult",
      value: "false",
    });
  });

  describe("contentType", () => {
    it("defaults to illust", async () => {
      const { contentType } = await loadBothStores();
      expect(contentType()).toBe("illust");
    });

    it("persists and updates on setContentType", async () => {
      const { contentType, setContentType } = await loadBothStores();
      await setContentType("novel");
      expect(contentType()).toBe("novel");
      expect(Preferences.set).toHaveBeenCalledWith({
        key: "content_type",
        value: "novel",
      });
    });

    it("loads persisted contentType via loadContentTypePreference", async () => {
      vi.mocked(Preferences.get).mockResolvedValue({ value: "novel" });
      const { contentType, loadContentTypePreference } = await loadBothStores();
      await loadContentTypePreference();
      expect(contentType()).toBe("novel");
    });

    it("ignores invalid persisted values", async () => {
      vi.mocked(Preferences.get).mockResolvedValue({ value: "invalid" });
      const { contentType, loadContentTypePreference } = await loadBothStores();
      await loadContentTypePreference();
      expect(contentType()).toBe("illust"); // Default unchanged
    });

    it("dispatches contentTypeChanged event", async () => {
      const { setContentType } = await loadBothStores();
      const dispatchSpy = vi.fn();
      const origDispatch = window.dispatchEvent;
      window.dispatchEvent = dispatchSpy;
      await setContentType("novel");
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: "contentTypeChanged" }),
      );
      window.dispatchEvent = origDispatch;
    });
  });
});

describe("lastDismissedVersion", () => {
  beforeEach(() => {
    vi.mocked(Preferences.set).mockResolvedValue(undefined);
  });

  it("defaults to empty string", async () => {
    const { lastDismissedVersion } = await loadSettingsStore();
    expect(lastDismissedVersion()).toBe("");
  });

  it("setLastDismissedVersion updates state and persists", async () => {
    const { setLastDismissedVersion, lastDismissedVersion } = await loadSettingsStore();
    await setLastDismissedVersion("1.2.3");
    expect(lastDismissedVersion()).toBe("1.2.3");
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "dismissed_update_version",
      value: "1.2.3",
    });
  });

  it("loadLastDismissedVersionPreference restores persisted value", async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: "2.0.0" });
    const { loadLastDismissedVersionPreference, lastDismissedVersion } = await loadSettingsStore();
    await loadLastDismissedVersionPreference();
    expect(lastDismissedVersion()).toBe("2.0.0");
    expect(Preferences.get).toHaveBeenCalledWith({ key: "dismissed_update_version" });
  });

  it("loadLastDismissedVersionPreference leaves default when no persisted value", async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });
    const { loadLastDismissedVersionPreference, lastDismissedVersion } = await loadSettingsStore();
    await loadLastDismissedVersionPreference();
    expect(lastDismissedVersion()).toBe("");
  });

  it("resetUiStore clears lastDismissedVersion and persists", async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue("web");
    vi.mocked(Preferences.set).mockResolvedValue(undefined);
    const { setLastDismissedVersion, resetUiStore, lastDismissedVersion } = await loadBothStores();
    await setLastDismissedVersion("1.0.0");
    await resetUiStore();
    expect(lastDismissedVersion()).toBe("");
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "dismissed_update_version",
      value: "",
    });
  });
});

describe("showUpdateDialog", () => {
  it("defaults to false", async () => {
    const { showUpdateDialog } = await loadSettingsStore();
    expect(showUpdateDialog()).toBe(false);
  });

  it("can be toggled via setShowUpdateDialog", async () => {
    const { setShowUpdateDialog, showUpdateDialog } = await loadSettingsStore();
    setShowUpdateDialog(true);
    expect(showUpdateDialog()).toBe(true);
    setShowUpdateDialog(false);
    expect(showUpdateDialog()).toBe(false);
  });
});

describe("novelLayoutMode", () => {
  beforeEach(() => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue("web");
    vi.mocked(Preferences.set).mockResolvedValue(undefined);
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });
    (globalThis as any).window = { dispatchEvent: vi.fn() };
    (globalThis as any).CustomEvent = class CustomEvent {
      constructor(public type: string) {}
    };
  });

  it("defaults to list", async () => {
    const { novelLayoutMode } = await loadSettingsStore();
    expect(novelLayoutMode()).toBe("list");
  });

  it("persists textList", async () => {
    const { setNovelLayoutMode, novelLayoutMode } = await loadSettingsStore();
    await setNovelLayoutMode("textList");
    expect(novelLayoutMode()).toBe("textList");
    expect(Preferences.set).toHaveBeenCalledWith({
      key: "novel_layout_mode",
      value: "textList",
    });
  });

  it("loads persisted textList", async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: "textList" });
    const { loadNovelLayoutModePreference, novelLayoutMode } = await loadSettingsStore();
    await loadNovelLayoutModePreference();
    expect(novelLayoutMode()).toBe("textList");
  });

  it("ignores invalid persisted values", async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: "invalid" });
    const { loadNovelLayoutModePreference, novelLayoutMode } = await loadSettingsStore();
    await loadNovelLayoutModePreference();
    expect(novelLayoutMode()).toBe("list");
  });
});

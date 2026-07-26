// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrefStore = new Map<string, string>();
let mockSet = vi.fn();
let mockGet = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  mockPrefStore.clear();
  mockSet = vi.fn(async ({ key, value }: { key: string; value: string }) => {
    mockPrefStore.set(key, value);
  });
  mockGet = vi.fn(async ({ key }: { key: string }) => ({
    value: mockPrefStore.get(key) ?? null,
  }));
});

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: (...args: unknown[]) => mockGet(...args),
    set: (...args: unknown[]) => mockSet(...args),
  },
}));

vi.mock("@/utils/themeApplier", () => ({
  applyPageStyleClass: vi.fn(),
  applyDarkClass: vi.fn(),
}));

async function loadStore() {
  return await import("@/stores/themeStore");
}

// ── setThemePersisted ──

describe("setThemePersisted", () => {
  it("成功路径：更新状态 + 持久化 Preferences + localStorage", async () => {
    const { setThemePersisted, getTheme, getResolvedTheme } = await loadStore();
    await setThemePersisted("dark");
    expect(getTheme()).toBe("dark");
    expect(getResolvedTheme()).toBe("dark");
    expect(mockPrefStore.get("theme")).toBe("dark");
  });

  it("Preferences.set 失败 → state 已更新，不抛异常", async () => {
    mockSet.mockRejectedValue(new Error("fail"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { setThemePersisted, getTheme, getResolvedTheme } = await loadStore();

    await expect(setThemePersisted("light")).resolves.toBeUndefined();
    expect(getTheme()).toBe("light");
    expect(getResolvedTheme()).toBe("light");
    // 至少有一次 console.warn 来自 setThemePersisted 的失败
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ── loadThemePreference ──

describe("loadThemePreference", () => {
  it("加载有效值 'dark' → 应用 dark", async () => {
    mockPrefStore.set("theme", "dark");
    const { loadThemePreference, getTheme, getResolvedTheme } = await loadStore();
    await loadThemePreference();
    expect(getTheme()).toBe("dark");
    expect(getResolvedTheme()).toBe("dark");
  });

  it("加载 'system' → resolved 跟随系统", async () => {
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn() }),
      writable: true,
    });
    mockPrefStore.set("theme", "system");
    const { loadThemePreference, getTheme, getResolvedTheme } = await loadStore();
    await loadThemePreference();
    expect(getTheme()).toBe("system");
    expect(getResolvedTheme()).toBe("dark");
  });

  it("Preferences.get 失败 → 兜底系统主题 + console.warn", async () => {
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }),
      writable: true,
    });
    mockGet.mockRejectedValueOnce(new Error("fail"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loadThemePreference, getResolvedTheme } = await loadStore();

    await expect(loadThemePreference()).resolves.toBeUndefined();
    expect(getResolvedTheme()).toBe("light");
    expect(warnSpy).toHaveBeenCalledWith(
      "[themeStore] Failed to load theme preference",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});

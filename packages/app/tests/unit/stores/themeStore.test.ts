import { describe, it, expect, vi, beforeEach } from "vitest";

// Module-level mock store for Preferences (avoids vi.mock hoisting closure issues)
const mockPrefStore = new Map<string, string>();

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  mockPrefStore.clear();
});

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({
      value: mockPrefStore.get(key) ?? null,
    })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      mockPrefStore.set(key, value);
    }),
  },
}));

// Mock themeApplier to avoid DOM dependency in node test environment
vi.mock("@/utils/themeApplier", () => ({
  applyPageStyleClass: vi.fn(),
  applyDarkClass: vi.fn(),
}));

async function loadStore() {
  return await import("@/stores/themeStore");
}

describe("pageStyleTheme", () => {
  it("defaults to fluent", async () => {
    const { pageStyleTheme } = await loadStore();
    expect(pageStyleTheme()).toBe("fluent");
  });

  it("updates when setPageStyleTheme is called", async () => {
    const { setPageStyleTheme, pageStyleTheme } = await loadStore();
    setPageStyleTheme("card");
    expect(pageStyleTheme()).toBe("card");
  });

  it("restores persisted preference on loadPageStyleThemePreference", async () => {
    mockPrefStore.set("page_style_theme", "card");
    const { loadPageStyleThemePreference, pageStyleTheme } = await loadStore();
    await loadPageStyleThemePreference();
    expect(pageStyleTheme()).toBe("card");
  });

  it("falls back to fluent when persisted value is invalid", async () => {
    mockPrefStore.set("page_style_theme", "invalid_value");
    const { loadPageStyleThemePreference, pageStyleTheme } = await loadStore();
    await loadPageStyleThemePreference();
    expect(pageStyleTheme()).toBe("fluent");
  });

  it("falls back to fluent when no preference is stored", async () => {
    const { loadPageStyleThemePreference, pageStyleTheme } = await loadStore();
    await loadPageStyleThemePreference();
    expect(pageStyleTheme()).toBe("fluent");
  });
});

import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  imageCacheDisk,
  setImageCacheDisk,
  imageCacheBrowser,
  setImageCacheBrowser,
  imageCachePrefetch,
  setImageCachePrefetch,
  imageCacheDiskSize,
  setImageCacheDiskSize,
  resetSettingsStore,
} from "@/stores/settingsStore";

vi.mock("@capacitor/core", () => {
  const mockCapacitor = {
    Capacitor: { getPlatform: vi.fn(() => "web"), isNativePlatform: vi.fn(() => false) },
    registerPlugin: vi.fn(() => ({
      getImage: vi.fn(),
      saveImage: vi.fn(),
      getCachedKeys: vi.fn(),
      clearCache: vi.fn(),
    })),
  };
  return mockCapacitor;
});
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: vi.fn().mockResolvedValue({ value: null }), set: vi.fn().mockResolvedValue(undefined) },
}));

const store: Record<string, string> = {};
beforeAll(() => {
  (globalThis as any).document = {
    documentElement: { classList: { add: vi.fn(), remove: vi.fn() } },
  };
  vi.stubGlobal("window", {
    matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    dispatchEvent: vi.fn(),
    CustomEvent: vi.fn(),
  });
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(store)) {
        delete store[k];
      }
    }),
  });
});

describe("imageCache A/B/C 开关", () => {
  it("A 磁盘缓存默认开启", () => {
    expect(imageCacheDisk()).toBe(true);
  });

  it("B 浏览器缓存默认开启", () => {
    expect(imageCacheBrowser()).toBe(true);
  });

  it("C 后台预取默认开启", () => {
    expect(imageCachePrefetch()).toBe(true);
  });

  it("setImageCacheDisk 切换后值变化", () => {
    setImageCacheDisk(false);
    expect(imageCacheDisk()).toBe(false);
    setImageCacheDisk(true);
    expect(imageCacheDisk()).toBe(true);
  });

  it("setImageCacheBrowser 切换后值变化", () => {
    setImageCacheBrowser(false);
    expect(imageCacheBrowser()).toBe(false);
    setImageCacheBrowser(true);
    expect(imageCacheBrowser()).toBe(true);
  });

  it("setImageCachePrefetch 切换后值变化", () => {
    setImageCachePrefetch(false);
    expect(imageCachePrefetch()).toBe(false);
    setImageCachePrefetch(true);
    expect(imageCachePrefetch()).toBe(true);
  });

  it("resetSettingsStore 将三个开关重置为 true", async () => {
    await setImageCacheDisk(false);
    await setImageCacheBrowser(false);
    await setImageCachePrefetch(false);
    await resetSettingsStore();
    expect(imageCacheDisk()).toBe(true);
    expect(imageCacheBrowser()).toBe(true);
    expect(imageCachePrefetch()).toBe(true);
  });

  it("loadImageCachePrefs 从 Preferences 恢复值", async () => {
    // 模拟持久化 false
    await setImageCacheDisk(false);
    await setImageCacheBrowser(false);
    await setImageCachePrefetch(false);

    // 重置模块模拟冷启动
    vi.resetModules();
    const mod = await import("@/stores/settingsStore");
    // 模拟 Preferences.get 返回 false
    const { Preferences } = await import("@capacitor/preferences");
    vi.mocked(Preferences.get).mockImplementation(async ({ key }) => {
      if (key === "image_cache_disk") {
        return { value: "false" };
      }
      if (key === "image_cache_browser") {
        return { value: "false" };
      }
      if (key === "image_cache_prefetch") {
        return { value: "false" };
      }
      return { value: null };
    });
    await mod.loadImageCachePrefs();
    expect(mod.imageCacheDisk()).toBe(false);
    expect(mod.imageCacheBrowser()).toBe(false);
    expect(mod.imageCachePrefetch()).toBe(false);
  });
});

describe("imageCacheDiskSize 磁盘缓存上限", () => {
  it("默认值为 300 MB", () => {
    expect(imageCacheDiskSize()).toBe(300);
  });

  it("setImageCacheDiskSize(150) 更新值", () => {
    setImageCacheDiskSize(150);
    expect(imageCacheDiskSize()).toBe(150);
  });

  it("低于下限 30 被 clamp 到 50", () => {
    setImageCacheDiskSize(30);
    expect(imageCacheDiskSize()).toBe(50);
  });

  it("高于上限 1200 被 clamp 到 1000", () => {
    setImageCacheDiskSize(1200);
    expect(imageCacheDiskSize()).toBe(1000);
  });

  it("resetSettingsStore 重置为 300", async () => {
    await setImageCacheDiskSize(500);
    await resetSettingsStore();
    expect(imageCacheDiskSize()).toBe(300);
  });
});

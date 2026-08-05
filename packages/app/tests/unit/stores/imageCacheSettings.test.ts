// @vitest-environment happy-dom
/**
 * imageCache 设置（settingsStore 的一部分）单元测试 —— 注入式。
 *
 * 数据由 settings registry 管理；测试通过 getter mock + 每次 loadStore 重建
 * settings 实例（memory adapter），与 settingsStore.test.ts 同一模式。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Settings } from "@/settings/types";

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
  const { createSettings } = await import("@/settings/registry");
  const { createMemoryAdapter } = await import("@/settings/backends/memory");
  const mem = createMemoryAdapter(seed);
  const settings = createSettings({ storages: { preferences: mem } });
  mockState.current = settings;
  const mod = await import("@/stores/settingsStore");
  await settings.hydrateAll();
  return { ...mod, mem };
}

describe("imageCache A/B/C 开关", () => {
  it("A 磁盘缓存默认开启", async () => {
    const { imageCacheDisk } = await loadStore();
    expect(imageCacheDisk()).toBe(true);
  });

  it("B 浏览器缓存默认开启", async () => {
    const { imageCacheBrowser } = await loadStore();
    expect(imageCacheBrowser()).toBe(true);
  });

  it("C 后台预取默认开启", async () => {
    const { imageCachePrefetch } = await loadStore();
    expect(imageCachePrefetch()).toBe(true);
  });

  it("setImageCacheDisk 切换后值变化并持久化", async () => {
    const { setImageCacheDisk, imageCacheDisk, mem } = await loadStore();
    setImageCacheDisk(false);
    expect(imageCacheDisk()).toBe(false);
    await vi.waitFor(() => expect(mem.dump().get("image_cache_disk")).toBe("false"));
    setImageCacheDisk(true);
    expect(imageCacheDisk()).toBe(true);
  });

  it("setImageCacheBrowser 切换后值变化", async () => {
    const { setImageCacheBrowser, imageCacheBrowser } = await loadStore();
    setImageCacheBrowser(false);
    expect(imageCacheBrowser()).toBe(false);
    setImageCacheBrowser(true);
    expect(imageCacheBrowser()).toBe(true);
  });

  it("setImageCachePrefetch 切换后值变化", async () => {
    const { setImageCachePrefetch, imageCachePrefetch } = await loadStore();
    setImageCachePrefetch(false);
    expect(imageCachePrefetch()).toBe(false);
    setImageCachePrefetch(true);
    expect(imageCachePrefetch()).toBe(true);
  });

  it("resetSettingsStore 将三个开关重置为 true", async () => {
    const {
      setImageCacheDisk,
      setImageCacheBrowser,
      setImageCachePrefetch,
      resetSettingsStore,
      imageCacheDisk,
      imageCacheBrowser,
      imageCachePrefetch,
    } = await loadStore();
    await setImageCacheDisk(false);
    await setImageCacheBrowser(false);
    await setImageCachePrefetch(false);
    await resetSettingsStore();
    expect(imageCacheDisk()).toBe(true);
    expect(imageCacheBrowser()).toBe(true);
    expect(imageCachePrefetch()).toBe(true);
  });

  it("hydrateAll 从持久化值恢复三开关", async () => {
    const { imageCacheDisk, imageCacheBrowser, imageCachePrefetch } = await loadStore({
      image_cache_disk: "false",
      image_cache_browser: "false",
      image_cache_prefetch: "false",
    });
    expect(imageCacheDisk()).toBe(false);
    expect(imageCacheBrowser()).toBe(false);
    expect(imageCachePrefetch()).toBe(false);
  });
});

describe("imageCacheDiskSize 磁盘缓存上限", () => {
  it("默认值为 300 MB", async () => {
    const { imageCacheDiskSize } = await loadStore();
    expect(imageCacheDiskSize()).toBe(300);
  });

  it("setImageCacheDiskSize(150) 更新值", async () => {
    const { setImageCacheDiskSize, imageCacheDiskSize } = await loadStore();
    setImageCacheDiskSize(150);
    expect(imageCacheDiskSize()).toBe(150);
  });

  it("低于下限 30 被 clamp 到 50", async () => {
    const { setImageCacheDiskSize, imageCacheDiskSize } = await loadStore();
    setImageCacheDiskSize(30);
    expect(imageCacheDiskSize()).toBe(50);
  });

  it("高于上限 1200 被 clamp 到 1000", async () => {
    const { setImageCacheDiskSize, imageCacheDiskSize } = await loadStore();
    setImageCacheDiskSize(1200);
    expect(imageCacheDiskSize()).toBe(1000);
  });

  it("resetSettingsStore 重置为 300", async () => {
    const { setImageCacheDiskSize, resetSettingsStore, imageCacheDiskSize } = await loadStore();
    await setImageCacheDiskSize(500);
    await resetSettingsStore();
    expect(imageCacheDiskSize()).toBe(300);
  });
});

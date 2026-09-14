// @vitest-environment happy-dom
/**
 * settingsStore WebDAV 连接配置单测（spec docs/specs/webdav-backup.md §7/§8）。
 * 复用 settingsStore.test.ts 的注入式 harness（memory adapter + 每次重建实例）。
 */
import { describe, it, expect, vi } from "vitest";
import type { Settings } from "@/settings/types";

const mockState = vi.hoisted(() => ({
  current: null as Settings | null,
}));

vi.mock("@/stores/authStore", () => ({
  user: () => null,
}));

vi.mock("@/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/settings")>();
  return {
    ...actual,
    get settings() {
      return mockState.current;
    },
  };
});

async function loadStore(seed: Record<string, string> = {}) {
  vi.resetModules();
  const { createSettings } = await import("@/settings/registry");
  const { createMemoryAdapter } = await import("@/settings/backends/memory");
  const mem = createMemoryAdapter(seed);
  const settings = createSettings({ storages: { preferences: mem } });
  mockState.current = settings;
  const store = await import("@/stores/settingsStore");
  await settings.hydrateAll();
  return { store, mem };
}

describe("settingsStore — WebDAV 连接配置（spec §7/§8）", () => {
  it("默认值：全关、目录 Pictelio/backup、周期 7、排除清单空", async () => {
    const { store } = await loadStore();
    expect(store.webdavEnabled()).toBe(false);
    expect(store.webdavUrl()).toBe("");
    expect(store.webdavUsername()).toBe("");
    expect(store.webdavDir()).toBe("Pictelio/backup");
    expect(store.webdavAutoBackup()).toBe(false);
    expect(store.webdavAutoBackupDays()).toBe(7);
    expect(store.webdavLastBackup()).toBe("");
    expect(store.webdavExcludedKeys()).toEqual([]);
  });

  it("成功路径：set 后持久化到 preferences 键", async () => {
    const { store, mem } = await loadStore();
    await store.setWebdavEnabled(true);
    await store.setWebdavUrl("https://dav.example.com");
    await store.setWebdavDir("Pictelio/backup");
    await store.setWebdavExcludedKeys(["show_r18_12345", "show_r18g_12345"]);
    expect(mem.dump().get("settings_webdav_enabled")).toBe("true");
    expect(mem.dump().get("settings_webdav_url")).toBe("https://dav.example.com");
    expect(mem.dump().get("settings_webdav_excluded_keys")).toBe(
      '["show_r18_12345","show_r18g_12345"]',
    );
  });

  it("恢复路径：seed 值经 hydrate 生效", async () => {
    const { store } = await loadStore({
      settings_webdav_enabled: "true",
      settings_webdav_url: "https://dav.example.com",
      settings_webdav_auto_backup_days: "30",
      settings_webdav_excluded_keys: '["show_r18_1"]',
    });
    expect(store.webdavEnabled()).toBe(true);
    expect(store.webdavUrl()).toBe("https://dav.example.com");
    expect(store.webdavAutoBackupDays()).toBe(30);
    expect(store.webdavExcludedKeys()).toEqual(["show_r18_1"]);
  });

  it("降级路径：周期非法值 → 保持默认 7（validate 拒绝）", async () => {
    const { store } = await loadStore({ settings_webdav_auto_backup_days: "999" });
    expect(store.webdavAutoBackupDays()).toBe(7);
  });

  it("排除清单非字符串数组 → 保持默认空", async () => {
    const { store } = await loadStore({ settings_webdav_excluded_keys: '{"not":"array"}' });
    expect(store.webdavExcludedKeys()).toEqual([]);
  });
});

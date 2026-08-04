// @vitest-environment happy-dom
/**
 * themeStore 单元测试 —— 注入式（memory adapter）。
 *
 * themeStore 使用模块级单例 settings（@/settings），测试无法直接注入，
 * 因此 mock "@/settings" 导出测试用 settings 实例（createSettings +
 * createMemoryAdapter 构建），借助 vi.resetModules() 让 themeStore 每次
 * 以新实例重新 define。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Settings } from "@/settings/types";
import type { createMemoryAdapter } from "@/settings/backends/memory";

const testState = vi.hoisted(() => ({
  settings: undefined as Settings | undefined,
  primary: undefined as ReturnType<typeof createMemoryAdapter> | undefined,
  mirror: undefined as ReturnType<typeof createMemoryAdapter> | undefined,
}));

vi.mock("@/settings", async () => {
  const { createSettings } = await import("@/settings/registry");
  const { createMemoryAdapter } = await import("@/settings/backends/memory");
  const { createMirroredAdapter } = await import("@/settings/backends/mirrored");
  return {
    get settings() {
      return testState.settings;
    },
    __test: {
      install(seed: Record<string, string> = {}) {
        const primary = createMemoryAdapter(seed);
        const mirror = createMemoryAdapter();
        const settings = createSettings({
          storages: {
            preferences: primary,
            localStorage: mirror,
            mirrored: createMirroredAdapter(primary, mirror),
          },
          defaultStorage: "preferences",
        });
        testState.settings = settings;
        testState.primary = primary;
        testState.mirror = mirror;
      },
      get primary() {
        return testState.primary;
      },
      get mirror() {
        return testState.mirror;
      },
    },
  };
});

type TestMod = {
  settings: Settings;
  __test: {
    install(seed?: Record<string, string>): void;
    readonly primary: ReturnType<typeof createMemoryAdapter>;
    readonly mirror: ReturnType<typeof createMemoryAdapter>;
  };
};

async function setup(seed: Record<string, string> = {}) {
  const mod = (await import("@/settings")) as unknown as TestMod;
  mod.__test.install(seed);
  const store = await import("@/stores/themeStore");
  return { mod, store };
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("themeStore (settings registry)", () => {
  it("模块加载不写存储（bug 回归：define 后无 page_style_theme 落盘）", async () => {
    const { mod } = await setup();
    expect(mod.__test.primary.dump().size).toBe(0);
    expect(mod.__test.mirror.dump().size).toBe(0);
  });

  it("预置值不被覆盖：seed { theme: 'dark' } hydrate 后仍为 'dark'", async () => {
    const { mod, store } = await setup({ theme: "dark", page_style_theme: "card" });
    await mod.settings.hydrateAll();
    expect(store.getTheme()).toBe("dark");
    expect(store.pageStyleTheme()).toBe("card");
  });

  it("预置值经 syncInitAll 首屏同步生效（localStorage 镜像）", async () => {
    const { mod, store } = await setup();
    mod.__test.mirror.setSync("theme", "dark");
    mod.settings.syncInitAll();
    expect(store.getTheme()).toBe("dark");
  });

  it("显式 setThemePersisted 才写存储（双写 Preferences + 镜像）", async () => {
    const { mod, store } = await setup();
    await mod.settings.hydrateAll();
    store.setThemePersisted("dark");
    await vi.waitFor(() => {
      expect(mod.__test.primary.dump().get("theme")).toBe("dark");
      expect(mod.__test.mirror.dump().get("theme")).toBe("dark");
    });
  });

  it("setPageStyleTheme 持久化 page_style_theme", async () => {
    const { mod, store } = await setup();
    await mod.settings.hydrateAll();
    store.setPageStyleTheme("card");
    await vi.waitFor(() => {
      expect(mod.__test.primary.dump().get("page_style_theme")).toBe("card");
    });
  });

  it("hydrate 后 apply 钩子被调：dark class 与 page-card 已应用", async () => {
    const { mod, store } = await setup({ theme: "dark", page_style_theme: "card" });
    await mod.settings.hydrateAll();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("page-card")).toBe(true);
    expect(store.getResolvedTheme()).toBe("dark");
  });

  it("损坏数据降级默认值且不回写覆盖", async () => {
    const { mod, store } = await setup({ theme: "neon-rainbow" });
    await mod.settings.hydrateAll();
    expect(store.getTheme()).toBe("system");
    expect(mod.__test.primary.dump().get("theme")).toBe("neon-rainbow");
  });
});

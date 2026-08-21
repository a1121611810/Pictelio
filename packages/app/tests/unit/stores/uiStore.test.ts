import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";

// ── 注入式 Settings 实例 ──
// uiStore（及依赖的 settingsStore / themeStore）使用模块级 settings 单例；
// 测试通过 vi.resetModules() + vi.mock("@/settings")（返回用 createSettings +
// createMemoryAdapter 构建的实例）隔离。断言方式从「Preferences.set 被调」改为
// 「memory adapter dump 内容」。
//
// 时序约定：
// - registry 的 write gate 初始为 cold，handle.set 只更新内存不落盘；
//   warm()（hydrateAll）负责翻转 gate 并加载持久化值，等价 Phase 4 启动流程。
// - 每次 setup(seed) 重建 settings 与 adapter（seed 用于预置持久化数据）。

type TestAdapter = {
  dump(): Map<string, string>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

const testState = vi.hoisted(() => ({
  settings: undefined as { hydrateAll(): Promise<void> } | undefined,
  primary: undefined as TestAdapter | undefined,
  mirror: undefined as TestAdapter | undefined,
}));

/** 账号级 R18 测试用：可控制的 authStore.user（ADR-0103，uid 键控 show_r18_${uid}） */
const mockUser = vi.hoisted(() => ({ current: null as { id: number } | null }));
vi.mock("@/stores/authStore", () => ({
  user: () => mockUser.current,
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
  settings: { hydrateAll(): Promise<void> };
  __test: {
    install(seed?: Record<string, string>): void;
    readonly primary: TestAdapter;
    readonly mirror: TestAdapter;
  };
};

let originalDocument: unknown;

beforeAll(() => {
  originalDocument = (globalThis as any).document;
  (globalThis as any).document = {
    documentElement: {
      classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
    },
  };
});

afterAll(() => {
  (globalThis as any).document = originalDocument;
});

/** 重建模块并注入新 settings 实例（seed 预置持久化数据）；返回 uiStore + settingsStore 导出 */
async function setup(seed: Record<string, string> = {}) {
  const mod = (await import("@/settings")) as unknown as TestMod;
  mod.__test.install(seed);
  const uiMod = await import("@/stores/uiStore");
  const settingsMod = await import("@/stores/settingsStore");
  return { mod, ...uiMod, ...settingsMod };
}

/** 打开 write gate 并加载持久化值（模拟 Phase 4 启动流程中的 hydrateAll 调用） */
async function warm(mod: TestMod): Promise<void> {
  await mod.settings.hydrateAll();
}

beforeEach(() => {
  vi.resetModules();
  (globalThis as any).window = {
    dispatchEvent: vi.fn(),
    matchMedia: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  };
  (globalThis as any).CustomEvent = class CustomEvent {
    constructor(public type: string) {}
  };
});

describe("resetUiStore", () => {
  it("resets all ui signals to defaults and persists preferences", async () => {
    const {
      mod,
      resetUiStore,
      setShowR18,
      setShowR18G,
      setLayoutMode,
      setAutoHideNavBar,
      setShowDetailStairs,
      showR18,
      showR18G,
      layoutMode,
      autoHideNavBar,
      showDetailStairs,
      imageCacheDisk,
      imageCacheBrowser,
      imageCachePrefetch,
    } = await setup();
    await warm(mod);

    mockUser.current = { id: 42 }; // 账号级 R18：写入 show_r18_42（ADR-0103）
    await setShowR18(true);
    await setShowR18G(true);
    await setLayoutMode("grid");
    await setAutoHideNavBar(false);
    await setShowDetailStairs(true);

    await resetUiStore();

    expect(showR18()).toBe(false);
    expect(showR18G()).toBe(false);
    expect(layoutMode()).toBe("waterfall");
    expect(autoHideNavBar()).toBe(true);
    expect(showDetailStairs()).toBe(false);
    expect(imageCacheDisk()).toBe(true);
    expect(imageCacheBrowser()).toBe(true);
    expect(imageCachePrefetch()).toBe(true);
    await vi.waitFor(() => {
      const dump = mod.__test.primary.dump();
      expect(dump.get("show_r18_42")).toBe("false");
      expect(dump.get("show_r18g_42")).toBe("false");
      expect(dump.get("layout_mode")).toBe("waterfall");
      expect(dump.get("auto_hide_nav_bar")).toBe("true");
      expect(dump.get("show_detail_stairs")).toBe("false");
    });
  });

  describe("contentType", () => {
    it("defaults to illust", async () => {
      const { contentType } = await setup();
      expect(contentType()).toBe("illust");
    });

    it("persists and updates on setContentType", async () => {
      const { mod, contentType, setContentType } = await setup();
      await warm(mod);
      await setContentType("novel");
      expect(contentType()).toBe("novel");
      await vi.waitFor(() => expect(mod.__test.primary.dump().get("content_type")).toBe("novel"));
    });

    it("hydrateAll 恢复持久化的 contentType", async () => {
      const { mod, contentType } = await setup({ content_type: "novel" });
      await warm(mod);
      expect(contentType()).toBe("novel");
    });

    it("ignores invalid persisted values", async () => {
      const { mod, contentType } = await setup({ content_type: "invalid" });
      await warm(mod);
      expect(contentType()).toBe("illust"); // Default unchanged
    });

    it("dispatches contentTypeChanged event", async () => {
      const { setContentType } = await setup();
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

  describe("persistScrollRestoration", () => {
    it("defaults to false（关闭 = 冷启动回顶）", async () => {
      const { persistScrollRestoration } = await setup();
      expect(persistScrollRestoration()).toBe(false);
    });

    it("setPersistScrollRestoration(true) 持久化", async () => {
      const { mod, persistScrollRestoration, setPersistScrollRestoration } = await setup();
      await warm(mod);
      setPersistScrollRestoration(true);
      expect(persistScrollRestoration()).toBe(true);
      await vi.waitFor(() =>
        expect(mod.__test.primary.dump().get("persist_scroll_restoration")).toBe("true"),
      );
    });

    it("hydrateAll 恢复持久化的开关值", async () => {
      const { mod, persistScrollRestoration } = await setup({
        persist_scroll_restoration: "true",
      });
      await warm(mod);
      expect(persistScrollRestoration()).toBe(true);
    });

    it("忽略无效持久化值（非 boolean 回退默认 false）", async () => {
      const { mod, persistScrollRestoration } = await setup({
        persist_scroll_restoration: "not-a-boolean",
      });
      await warm(mod);
      expect(persistScrollRestoration()).toBe(false);
    });
  });
});

describe("lastDismissedVersion", () => {
  it("defaults to empty string", async () => {
    const { lastDismissedVersion } = await setup();
    expect(lastDismissedVersion()).toBe("");
  });

  it("setLastDismissedVersion updates state and persists", async () => {
    const { mod, setLastDismissedVersion, lastDismissedVersion } = await setup();
    await warm(mod);
    await setLastDismissedVersion("1.2.3");
    expect(lastDismissedVersion()).toBe("1.2.3");
    await vi.waitFor(() =>
      expect(mod.__test.primary.dump().get("dismissed_update_version")).toBe("1.2.3"),
    );
  });

  it("hydrateAll 恢复持久化值", async () => {
    const { mod, lastDismissedVersion } = await setup({ dismissed_update_version: "2.0.0" });
    await warm(mod);
    expect(lastDismissedVersion()).toBe("2.0.0");
  });

  it("hydrateAll leaves default when no persisted value", async () => {
    const { mod, lastDismissedVersion } = await setup();
    await warm(mod);
    expect(lastDismissedVersion()).toBe("");
  });

  it("resetUiStore clears lastDismissedVersion and persists", async () => {
    const { mod, setLastDismissedVersion, resetUiStore, lastDismissedVersion } = await setup();
    await warm(mod);
    await setLastDismissedVersion("1.0.0");
    await resetUiStore();
    expect(lastDismissedVersion()).toBe("");
    await vi.waitFor(() =>
      expect(mod.__test.primary.dump().get("dismissed_update_version")).toBe(""),
    );
  });
});

describe("showUpdateDialog", () => {
  it("defaults to false", async () => {
    const { showUpdateDialog } = await setup();
    expect(showUpdateDialog()).toBe(false);
  });

  it("can be toggled via setShowUpdateDialog", async () => {
    const { setShowUpdateDialog, showUpdateDialog } = await setup();
    setShowUpdateDialog(true);
    expect(showUpdateDialog()).toBe(true);
    setShowUpdateDialog(false);
    expect(showUpdateDialog()).toBe(false);
  });
});

describe("novelLayoutMode", () => {
  it("defaults to list", async () => {
    const { novelLayoutMode } = await setup();
    expect(novelLayoutMode()).toBe("list");
  });

  it("persists textList", async () => {
    const { mod, setNovelLayoutMode, novelLayoutMode } = await setup();
    await warm(mod);
    await setNovelLayoutMode("textList");
    expect(novelLayoutMode()).toBe("textList");
    await vi.waitFor(() =>
      expect(mod.__test.primary.dump().get("novel_layout_mode")).toBe("textList"),
    );
  });

  it("hydrateAll 恢复持久化的 textList", async () => {
    const { mod, novelLayoutMode } = await setup({ novel_layout_mode: "textList" });
    await warm(mod);
    expect(novelLayoutMode()).toBe("textList");
  });

  it("ignores invalid persisted values", async () => {
    const { mod, novelLayoutMode } = await setup({ novel_layout_mode: "invalid" });
    await warm(mod);
    expect(novelLayoutMode()).toBe("list");
  });
});

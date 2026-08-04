// @vitest-environment happy-dom
/**
 * settingsStore 单元测试 —— 注入式（memory adapter）。
 *
 * settingsStore 使用模块级单例 settings（@/settings）；测试通过 getter mock
 * （每次访问返回最新 mockState.current）+ 每次 loadStore 重建 settings 实例，
 * 规避 vi.mock factory 只执行一次导致的 duplicate key。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Settings } from "@/settings/types";
import type { createMemoryAdapter } from "@/settings/backends/memory";

type MemoryAdapter = ReturnType<typeof createMemoryAdapter>;

const mockState = vi.hoisted(() => ({
  current: null as Settings | null,
  failWrite: false,
  failRead: false,
}));

vi.mock("@/settings", () => ({
  get settings() {
    return mockState.current;
  },
}));

async function loadStore(seed: Record<string, string> = {}) {
  vi.resetModules();
  mockState.failWrite = false;
  mockState.failRead = false;
  const { createSettings } = await import("@/settings/registry");
  const { createMemoryAdapter } = await import("@/settings/backends/memory");
  const base = createMemoryAdapter(seed);
  const mem: MemoryAdapter = {
    ...base,
    async set(key, value) {
      if (mockState.failWrite) throw new Error("storage full");
      return base.set(key, value);
    },
    async get(key) {
      if (mockState.failRead) throw new Error("corrupted storage");
      return base.get(key);
    },
  };
  const settings = createSettings({ storages: { preferences: mem } });
  mockState.current = settings;
  const store = await import("@/stores/settingsStore");
  await settings.hydrateAll();
  return { store, mem };
}

describe("settingsStore — setLayoutMode", () => {
  it("成功路径：更新 state + 持久化 + 派发事件", async () => {
    const { store, mem } = await loadStore();
    const events: string[] = [];
    const handler = (e: Event) => events.push(e.type);
    window.addEventListener("layoutModeChanged", handler);

    await store.setLayoutMode("single");

    expect(store.layoutMode()).toBe("single");
    await vi.waitFor(() => expect(mem.dump().get("layout_mode")).toBe("single"));
    expect(events).toContain("layoutModeChanged");
    window.removeEventListener("layoutModeChanged", handler);
  });

  it("持久化失败 → state 已更新，不抛异常，仅 warn", async () => {
    const { store } = await loadStore();
    mockState.failWrite = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(store.setLayoutMode("grid")).resolves.toBeUndefined();
    expect(store.layoutMode()).toBe("grid");
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());

    warnSpy.mockRestore();
  });
});

describe("settingsStore — hydrateAll 加载恢复", () => {
  it("有效值 → 恢复 state", async () => {
    const { store } = await loadStore({ layout_mode: "single" });
    expect(store.layoutMode()).toBe("single");
  });

  it("无记录 → state 保持默认", async () => {
    const { store } = await loadStore();
    expect(store.layoutMode()).toBe("waterfall");
  });

  it("无效值 → state 保持默认", async () => {
    const { store } = await loadStore({ layout_mode: "invalid-mode" });
    expect(store.layoutMode()).toBe("waterfall");
  });

  it("读取失败 → 保持当前值，仅 warn（读失败不清空内存）", async () => {
    // 先正常加载（layout_mode=single），再让 get 失败后 hydrate（保持已恢复的值）
    const { store } = await loadStore({ layout_mode: "single" });
    mockState.failRead = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await mockState.current!.get("layout_mode")!.hydrate();

    expect(store.layoutMode()).toBe("single");
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());

    warnSpy.mockRestore();
  });
});

describe("settingsStore — ugoiraMode", () => {
  it("默认 fflate", async () => {
    const { store } = await loadStore();
    expect(store.ugoiraMode()).toBe("fflate");
  });

  it("setUgoiraMode 更新 state + 持久化", async () => {
    const { store, mem } = await loadStore();
    await store.setUgoiraMode("range");
    expect(store.ugoiraMode()).toBe("range");
    await vi.waitFor(() => expect(mem.dump().get("settings_ugoira_mode")).toBe("range"));
  });

  it("hydrateAll 恢复合法值", async () => {
    const { store } = await loadStore({ settings_ugoira_mode: "range" });
    expect(store.ugoiraMode()).toBe("range");
  });

  it("非法值忽略（保持默认）", async () => {
    const { store } = await loadStore({ settings_ugoira_mode: "bogus" });
    expect(store.ugoiraMode()).toBe("fflate");
  });
});

describe("settingsStore — 年龄确认联动", () => {
  it("setAgeConfirmation(true, false)：非成人强制关闭 R18/R18G 并持久化", async () => {
    const { store, mem } = await loadStore();
    await store.setAgeConfirmation(true, false);

    expect(store.ageConfirmed()).toBe(true);
    expect(store.isAdult()).toBe(false);
    expect(store.showR18()).toBe(false);
    expect(store.showR18G()).toBe(false);
    await vi.waitFor(() => {
      const dump = mem.dump();
      expect(dump.get("age_confirmed")).toBe("true");
      expect(dump.get("is_adult")).toBe("false");
      expect(dump.get("show_r18")).toBe("false");
      expect(dump.get("show_r18g")).toBe("false");
    });
  });

  it("hydrateAll 恢复 isAdult=false 时强制关闭 R18", async () => {
    const { store } = await loadStore({ is_adult: "false" });
    expect(store.isAdult()).toBe(false);
    expect(store.showR18()).toBe(false);
  });
});

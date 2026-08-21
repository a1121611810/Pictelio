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

/** 账号级 R18 测试用：可控制的 authStore.user（ADR-0103，uid 键控 show_r18_${uid}） */
const mockUser = vi.hoisted(() => ({ current: null as { id: number } | null }));
vi.mock("@/stores/authStore", () => ({
  user: () => mockUser.current,
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

// ADR-0075：设置页布局模式 UI 已移除（ticket #177），但 settingsStore 的 layoutMode
// 字段与 setLayoutMode 保留（仍被 resetSettingsStore 及各 Feed 组件使用，默认 waterfall），
// 以下断言继续验证 store 层可设置/持久化/事件语义（非设置 UI 行为）。
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

describe("settingsStore — 账号级 R18/R18G（ADR-0103）", () => {
  beforeEach(() => {
    mockUser.current = null;
  });

  it("未登录：showR18/showR18G 恒 false，set 不落盘", async () => {
    const { store, mem } = await loadStore();
    expect(store.showR18()).toBe(false);
    await store.setShowR18(true);
    expect(store.showR18()).toBe(false);
    expect(mem.dump().has("show_r18")).toBe(false);
  });

  it("登录后 loadAccountR18 加载 show_r18_42 持久化值", async () => {
    mockUser.current = { id: 42 };
    const { store } = await loadStore({ show_r18_42: "true", show_r18g_42: "false" });
    await store.loadAccountR18();
    expect(store.showR18()).toBe(true);
    expect(store.showR18G()).toBe(false);
  });

  it("setShowR18 写 show_r18_42（账号键）", async () => {
    mockUser.current = { id: 42 };
    const { store, mem } = await loadStore();
    await store.setShowR18(true);
    expect(store.showR18()).toBe(true);
    await vi.waitFor(() => expect(mem.dump().get("show_r18_42")).toBe("true"));
  });

  it("登出后 accessor 回默认；换账号独立（互不污染）", async () => {
    mockUser.current = { id: 42 };
    const { store } = await loadStore();
    await store.setShowR18(true);
    mockUser.current = null;
    expect(store.showR18()).toBe(false);
    mockUser.current = { id: 7 };
    expect(store.showR18()).toBe(false); // 新账号 handle 未 hydrate → 默认
    await store.loadAccountR18();
    expect(store.showR18()).toBe(false);
  });

  it("迁移：老键 show_r18 播种当前账号并删老键（先写后删）", async () => {
    mockUser.current = { id: 42 };
    const { store, mem } = await loadStore({ show_r18: "true" });
    await store.loadAccountR18();
    expect(store.showR18()).toBe(true);
    await vi.waitFor(() => {
      expect(mem.dump().get("show_r18_42")).toBe("true");
      expect(mem.dump().has("show_r18")).toBe(false);
    });
  });

  it("存储读失败 → warn + 默认值（静默降级规则）", async () => {
    mockUser.current = { id: 42 };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store } = await loadStore();
    mockState.failRead = true; // loadStore 会重置标志，须在之后开启
    await store.loadAccountR18();
    expect(store.showR18()).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("孤儿键清理：loadAccountR18 删除 age_confirmed/is_adult", async () => {
    mockUser.current = { id: 42 };
    const { store, mem } = await loadStore({ age_confirmed: "true", is_adult: "true" });
    await store.loadAccountR18();
    await vi.waitFor(() => {
      expect(mem.dump().has("age_confirmed")).toBe(false);
      expect(mem.dump().has("is_adult")).toBe(false);
    });
  });
});

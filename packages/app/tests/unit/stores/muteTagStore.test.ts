// muteTagStore 单测（ADR-0187 / spec docs/specs/tag-mute.md）。
// harness 复制 blockStore.test.ts：vi.hoisted + 真实 settings registry + memory adapter；
// 账号级键 mute_tags_${uid} 经 mock authStore 注入 uid（对齐 settingsStore 的账号级语义）。
// IO 边界硬约束：持久化成功 + 读失败（get 拒绝 / 数据损坏）降级 warn 双路径全覆盖。
import { describe, it, expect, vi } from "vitest";
import type { Settings } from "@/settings/registry";
import type { KVStorage } from "@/settings/types";

const mockState = vi.hoisted(() => ({
  current: null as Settings | null,
  uid: 42 as number | null,
}));

vi.mock("@/settings", () => ({
  get settings() {
    return mockState.current;
  },
  jsonCodec: {
    encode: (v: unknown) => JSON.stringify(v),
    decode: (raw: string) => JSON.parse(raw),
  },
}));

vi.mock("@/stores/authStore", () => ({
  user: () =>
    mockState.uid === null
      ? null
      : { id: mockState.uid, name: "tester", account: "tester", profile_image_urls: {} },
}));

async function loadStore(seed: Record<string, string> = {}) {
  vi.resetModules();
  const { createSettings } = await import("@/settings/registry");
  const { createMemoryAdapter } = await import("@/settings/backends/memory");
  const mem = createMemoryAdapter(seed);
  const settings = createSettings({
    storages: { preferences: mem, memory: mem },
    defaultStorage: "preferences",
  });
  mockState.current = settings;
  const mod = await import("@/stores/muteTagStore");
  await settings.hydrateAll();
  return { ...mod, mem };
}

/** get 恒拒绝的后端（模拟存储层读失败，spec 边界 #7） */
function createBrokenReadAdapter(): KVStorage {
  return {
    sync: true,
    get: () => Promise.reject(new Error("storage read failed")),
    set: () => Promise.reject(new Error("storage write failed")),
    remove: () => Promise.resolve(),
    getSync: () => null,
    setSync: () => {},
  };
}

async function loadStoreWithBrokenRead() {
  vi.resetModules();
  const { createSettings } = await import("@/settings/registry");
  const settings = createSettings({
    storages: { preferences: createBrokenReadAdapter() },
    defaultStorage: "preferences",
  });
  mockState.current = settings;
  const mod = await import("@/stores/muteTagStore");
  return { ...mod, settings };
}

describe("muteTagStore（账号级键 mute_tags_${uid}，ADR-0187）", () => {
  it("从存储装载当前账号的静音标签", async () => {
    const { loadMuteTags, mutedTags, isTagMuted } = await loadStore({
      mute_tags_42: JSON.stringify(["R-18G", "AI生成"]),
    });

    await loadMuteTags();
    expect(mutedTags()).toEqual(new Set(["R-18G", "AI生成"]));
    expect(isTagMuted("R-18G")).toBe(true);
    expect(isTagMuted("R-18")).toBe(false);
  });

  it("无持久化记录时返回空集合（优雅降级）", async () => {
    const { loadMuteTags, mutedTags, isTagMuted } = await loadStore();
    await loadMuteTags();

    expect(mutedTags().size).toBe(0);
    expect(isTagMuted("R-18G")).toBe(false);
  });

  it("静音标签并持久化（trim 后原始标签名）", async () => {
    const { muteTag, isTagMuted, mem } = await loadStore();
    await muteTag("  グロ  ");

    expect(isTagMuted("グロ")).toBe(true);
    expect(mem.dump().get("mute_tags_42")).toBe(JSON.stringify(["グロ"]));
  });

  it("重复静音幂等（Set 语义，trim 归一后判定）", async () => {
    const { muteTag, mutedTags, mem } = await loadStore();
    await muteTag("R-18G");
    await muteTag("  R-18G  ");

    expect(mutedTags().size).toBe(1);
    expect(mem.dump().get("mute_tags_42")).toBe(JSON.stringify(["R-18G"]));
  });

  it("取消静音并持久化", async () => {
    const { muteTag, unmuteTag, isTagMuted, mem } = await loadStore();
    await muteTag("R-18G");
    await muteTag("グロ");
    await unmuteTag("R-18G");

    expect(isTagMuted("R-18G")).toBe(false);
    expect(isTagMuted("グロ")).toBe(true);
    expect(mem.dump().get("mute_tags_42")).toBe(JSON.stringify(["グロ"]));
  });

  it("取消未静音的标签是 no-op（不产生写入）", async () => {
    const { unmuteTag, mutedTags, mem } = await loadStore();
    await unmuteTag("R-18G");

    expect(mutedTags().size).toBe(0);
    expect(mem.dump().has("mute_tags_42")).toBe(false);
  });

  it("reset 清空集合并持久化空数组", async () => {
    const { muteTag, resetMuteTags, mutedTags, isTagMuted, mem } = await loadStore();
    await muteTag("R-18G");
    await muteTag("グロ");
    resetMuteTags();
    flush(); // 2.0 批处理语义：set 后同步读返回旧值，先 flush 再断言

    expect(mutedTags().size).toBe(0);
    expect(isTagMuted("R-18G")).toBe(false);
    // 持久化断言（review Nit1）：空集合必须落盘，重启后不复活旧词表
    expect(mem.dump().get("mute_tags_42")).toBe("[]");
  });

  it("损坏数据（非 JSON）→ 空集合 + console.warn 可见（禁静默降级）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loadMuteTags, mutedTags, isTagMuted } = await loadStore({ mute_tags_42: "not-json" });
    // factory handle 惰性注册（对齐 settingsStore 账号级先例），须经 load 触发读路径
    await loadMuteTags();

    expect(mutedTags().size).toBe(0);
    expect(isTagMuted("R-18G")).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[settings] read mute_tags_42"),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("读失败（存储 get 拒绝）→ 空集合 + console.warn 可见（spec 边界 #7）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loadMuteTags, mutedTags } = await loadStoreWithBrokenRead();

    await loadMuteTags();
    expect(mutedTags().size).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[settings] read mute_tags_42"),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("未登录（uid null）：不落盘、集合为空（账号级语义）", async () => {
    mockState.uid = null;
    const { muteTag, mutedTags, isTagMuted, mem } = await loadStore();

    await muteTag("R-18G");
    expect(mutedTags().size).toBe(0);
    expect(isTagMuted("R-18G")).toBe(false);
    expect(mem.dump().has("mute_tags_42")).toBe(false);
    mockState.uid = 42;
  });

  it("长按轻提示信号：muteTag 写入待提示数据，clearMuteTagHint 清除", async () => {
    const { muteTag, currentMuteTagHint, clearMuteTagHint } = await loadStore();
    await muteTag("グロ");
    flush();

    expect(currentMuteTagHint()).toEqual({ name: "グロ" });
    clearMuteTagHint();
    flush(); // 2.0 批处理语义：set 后同步读返回旧值
    expect(currentMuteTagHint()).toBeNull();
  });
});

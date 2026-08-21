// @vitest-environment happy-dom
/**
 * Settings registry 单元测试 —— 注入式（memory adapter），零 vi.mock。
 *
 * 测试跨的 seam 与生产代码相同：createSettings({ storages }) 的注入点。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSettings } from "@/settings/registry";
import { createMemoryAdapter } from "@/settings/backends/memory";
import { numCodec } from "@/settings/codecs";

function make() {
  const mem = createMemoryAdapter();
  const settings = createSettings({
    storages: { preferences: mem, memory: mem },
    defaultStorage: "preferences",
  });
  return { settings, mem };
}

describe("Settings registry", () => {
  // ── write gate ──

  it("hydrate 前 set 只更新内存，不落盘（write gate）", async () => {
    const { settings, mem } = make();
    const s = settings.define({ key: "foo", default: "a" });
    s.set("b");
    expect(s.value()).toBe("b");
    expect(mem.dump().has("foo")).toBe(false);

    await settings.hydrateAll();
    s.set("c");
    expect(mem.dump().get("foo")).toBe("c");
  });

  it("hydrateAll 完成后 write gate 打开", async () => {
    const { settings, mem } = make();
    settings.define({ key: "foo", default: "a" });
    await settings.hydrateAll();
    settings.get("foo")!.set("b");
    expect(mem.dump().get("foo")).toBe("b");
  });

  // ── parse 兼容通道（旧数据格式）──

  it('旧 bool 字符串 "true" 兼容读取', async () => {
    const { settings, mem } = make();
    mem.setSync("flag", "true");
    const s = settings.define({ key: "flag", default: false });
    await settings.hydrateAll();
    expect(s.value()).toBe(true);
  });

  it('旧 number 字符串 "300" 兼容读取', async () => {
    const { settings, mem } = make();
    mem.setSync("size", "300");
    const s = settings.define({ key: "size", default: 50, codec: numCodec });
    await settings.hydrateAll();
    expect(s.value()).toBe(300);
  });

  it('裸字符串 "medium" 兼容读取（default 为字符串枚举）', async () => {
    const { settings, mem } = make();
    mem.setSync("quality", "medium");
    const s = settings.define({
      key: "quality",
      default: "low" as string,
      validate: (v): v is string => v === "low" || v === "medium" || v === "high",
    });
    await settings.hydrateAll();
    expect(s.value()).toBe("medium");
  });

  // ── corrupt 回退 ──

  it("损坏数据回退 default 且不回写覆盖", async () => {
    const { settings, mem } = make();
    mem.setSync("mode", "neon-rainbow");
    const s = settings.define({
      key: "mode",
      default: "system" as string,
      validate: (v): v is string => v === "system" || v === "dark" || v === "light",
    });
    await settings.hydrateAll();
    expect(s.value()).toBe("system");
    expect(mem.dump().get("mode")).toBe("neon-rainbow"); // 未回写
  });

  it("onCorrupt 可提供修复值并写回（phase warm）", async () => {
    const { settings, mem } = make();
    mem.setSync("mode", "neon-rainbow");
    const s = settings.define({
      key: "mode",
      default: "system" as string,
      validate: (v): v is string => v === "system" || v === "dark" || v === "light",
      onCorrupt: () => "dark" as string,
    });
    await settings.hydrateAll();
    expect(s.value()).toBe("dark");
    expect(mem.dump().get("mode")).toBe("dark"); // onCorrupt 修复后写回
  });

  // ── key 冲突 / syncInit 校验 ──

  it("重复 key 抛错", () => {
    const { settings } = make();
    settings.define({ key: "dup", default: 1 });
    expect(() => settings.define({ key: "dup", default: 2 })).toThrow(/duplicate key/);
  });

  it("syncInit 要求 sync 后端，否则抛错", () => {
    const asyncOnly = { ...createMemoryAdapter(), sync: false as const };
    const s2 = createSettings({ storages: { prefs: asyncOnly }, defaultStorage: "prefs" });
    expect(() => s2.define({ key: "x", default: 1, syncInit: true })).toThrow(
      /syncInit requires sync storage/,
    );
  });

  // ── apply 钩子 ──

  it("set/hydrate/syncInit 后同步调用 apply", async () => {
    const { settings, mem } = make();
    const apply = vi.fn();
    const s = settings.define({ key: "t", default: "a", apply });
    s.set("b");
    expect(apply).toHaveBeenLastCalledWith("b");

    apply.mockClear();
    mem.setSync("t", "c");
    await settings.hydrateAll();
    expect(apply).toHaveBeenLastCalledWith("c");
  });

  // ── legacyKeys 迁移 ──

  it("legacyKeys 命中时迁移写新删旧", async () => {
    const { settings, mem } = make();
    mem.setSync("old_key", "v1");
    const s = settings.define({ key: "new_key", default: "", legacyKeys: ["old_key"] });
    await settings.hydrateAll();
    expect(s.value()).toBe("v1");
    expect(mem.dump().get("new_key")).toBe("v1");
    expect(mem.dump().has("old_key")).toBe(false);
  });

  // ── debounce ──

  it("debounceMs 合并连续写，防抖窗口内只落盘一次", async () => {
    vi.useFakeTimers();
    try {
      const { settings, mem } = make();
      const s = settings.define({ key: "n", default: 0, debounceMs: 100 });
      await settings.hydrateAll();
      s.set(1);
      s.set(2);
      s.set(3);
      expect(mem.dump().has("n")).toBe(false); // 防抖窗口内未落盘
      await vi.advanceTimersByTimeAsync(150);
      expect(mem.dump().get("n")).toBe("3"); // 只写最后值
    } finally {
      vi.useRealTimers();
    }
  });

  // ── defineFactory 动态 key ──

  it("defineFactory 动态 key + 同 id 缓存同 handle", async () => {
    const { settings, mem } = make();
    const f = settings.defineFactory({
      keyPrefix: "novel_progress",
      default: { p: 0 },
      storage: "memory",
    });
    const h1 = f.forId(42);
    const h2 = f.forId(42);
    expect(h1).toBe(h2);

    await settings.hydrateAll();
    h1.set({ p: 5 });
    expect(mem.dump().get("novel_progress_42")).toBe(JSON.stringify({ p: 5 }));
  });

  it("defineFactory LRU 淘汰后重访问同 id 不抛 duplicate key（回归）", () => {
    const { settings } = make();
    const f = settings.defineFactory({
      keyPrefix: "novel_progress",
      default: { p: 0 },
    });
    // 塞满 LRU（MAX_CACHE=200），触发最早 id 淘汰
    for (let i = 0; i < 210; i++) {
      f.forId(i);
    }
    // 重访问被淘汰的 id：不应抛 duplicate key（完整注销 defs/handles）
    expect(() => f.forId(0)).not.toThrow();
    const h = f.forId(0);
    expect(h).toBeDefined();
  });

  // ── subscribe / onChange ──

  it("subscribe 监听变化并可退订", () => {
    const { settings } = make();
    const s = settings.define({ key: "sub", default: 1 });
    const fn = vi.fn();
    const unsub = s.subscribe(fn);
    s.set(2);
    expect(fn).toHaveBeenCalledWith(2);
    unsub();
    s.set(3);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("onChange 全局监听", () => {
    const { settings } = make();
    const s = settings.define({ key: "g", default: 1 });
    const cb = vi.fn();
    settings.onChange(cb);
    s.set(9);
    expect(cb).toHaveBeenCalledWith("g", 9);
  });

  // ── persist: false ──

  it("persist: false 永不落盘", async () => {
    const { settings, mem } = make();
    const s = settings.define({ key: "mem", default: "a", persist: false });
    await settings.hydrateAll();
    s.set("b");
    expect(mem.dump().has("mem")).toBe(false);
  });

  // ── snapshot / resetAll ──

  it("snapshot 返回全部当前值", async () => {
    const { settings } = make();
    settings.define({ key: "a", default: 1 });
    settings.define({ key: "b", default: "x" });
    const snap = settings.snapshot();
    expect(snap).toEqual({ a: 1, b: "x" });
  });

  it("resetAll 全部回默认并持久化", async () => {
    const { settings, mem } = make();
    const s = settings.define({ key: "r", default: "d" });
    await settings.hydrateAll();
    s.set("changed");
    await settings.resetAll();
    expect(s.value()).toBe("d");
    expect(mem.dump().get("r")).toBe("d");
  });

  // ── remove（ADR-0103 孤儿键清理）──

  it("remove 删除无 handle 的孤儿键（默认后端）", async () => {
    const { settings, mem } = make();
    await mem.set("age_confirmed", "true");
    await settings.remove("age_confirmed");
    expect(mem.dump().has("age_confirmed")).toBe(false);
  });

  it("remove 对已定义键同样生效，且不回写默认值", async () => {
    const { settings, mem } = make();
    const s = settings.define({ key: "foo", default: "a" });
    await settings.hydrateAll();
    s.set("b");
    await settings.remove("foo");
    expect(mem.dump().has("foo")).toBe(false);
  });
});

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
    flush(); // 2.0 批处理语义：set 后同步读返回旧值，先 flush 再断言
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

describe("Settings registry — backup rawValues / setRawValues（spec webdav-backup §3.2/§6）", () => {
  it("rawValues：只含存储层有记录的键（原始字符串），默认值不写入", async () => {
    const { settings, mem } = make();
    settings.define({ key: "a", default: "d1" });
    settings.define<number>({ key: "b", default: 2 });
    await settings.hydrateAll();

    expect(await settings.rawValues()).toEqual({});

    await mem.set("a", "x");
    await mem.set("b", "7");
    expect(await settings.rawValues()).toEqual({ a: "x", b: "7" });
  });

  it("rawValues：动态工厂已实例化的账号级键包含、未实例化 uid 不出现", async () => {
    const { settings, mem } = make();
    const factory = settings.defineFactory<string>({ keyPrefix: "show_r18", default: "false" });
    await settings.hydrateAll();
    factory.forId(42);
    await mem.set("show_r18_42", "true");
    await mem.set("show_r18_99", "true"); // 未实例化 → 不进快照（当前账号语义）

    const raw = await settings.rawValues();
    expect(raw.show_r18_42).toBe("true");
    expect(raw.show_r18_99).toBeUndefined();
  });

  it("setRawValues：已注册键写回并触发内存更新；未注册键跳过（merge-by-keys）", async () => {
    const { settings } = make();
    const s = settings.define({ key: "a", default: "d" });
    await settings.hydrateAll();

    const res = await settings.setRawValues({ a: "restored", foreign_key: "x" });
    expect(res.applied).toEqual(["a"]);
    expect(res.skipped).toEqual(["foreign_key"]);
    expect(s.value()).toBe("restored");
  });

  it("setRawValues：损坏值（validate 拒绝）不写回且计入 skipped + warn", async () => {
    const { settings } = make();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = settings.define<number>({
      key: "n",
      default: 1,
      validate: (v): v is number => typeof v === "number" && v >= 1 && v <= 30,
    });
    await settings.hydrateAll();

    const res = await settings.setRawValues({ n: "999" });
    expect(res.applied).toEqual([]);
    expect(res.skipped).toEqual(["n"]);
    expect(s.value()).toBe(1); // 保持本地值（不触碰）
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rawValues：存储读取失败 → 该键省略 + warn（不静默，硬约束 #3）", async () => {
    const { settings } = make();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    settings.define({ key: "a", default: "d" });
    await settings.hydrateAll();
    const original = settings.rawValues;
    expect(typeof original).toBe("function");
    // 用注入 adapter 的抛错路径：memory adapter 的 get 被替换为抛错
    const broken = createMemoryAdapter();
    broken.get = async () => {
      throw new Error("disk io");
    };
    const brokenSettings = createSettings({ storages: { preferences: broken } });
    brokenSettings.define({ key: "a", default: "d" });
    await brokenSettings.hydrateAll().catch(() => {});
    expect(await brokenSettings.rawValues()).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("setRawValues 写回后落盘（持久化经 handle.set 正常管线）", async () => {
    const { settings, mem } = make();
    settings.define({ key: "a", default: "d" });
    await settings.hydrateAll();
    await settings.setRawValues({ a: "persisted" });
    await vi.waitFor(() => expect(mem.dump().get("a")).toBe("persisted"));
  });
});

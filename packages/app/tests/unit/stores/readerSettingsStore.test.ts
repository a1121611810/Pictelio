// @vitest-environment happy-dom
/**
 * readerSettingsStore 单元测试 —— 注入式（memory adapter）。
 *
 * readerSettingsStore 使用模块级单例 settings（@/settings）；测试通过 getter mock
 * + 每次 loadStore 重建 settings 实例，规避 duplicate key。
 * 注意：store 模块体内有 `void settings.hydrateAll()`（fire-and-forget 打开 write gate），
 * loadStore 中再次 await hydrateAll 确保 gate 已开、setter 落盘可靠。
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
  jsonCodec: {
    encode: (v: unknown) => JSON.stringify(v),
    decode: (raw: string) => JSON.parse(raw),
  },
}));

async function loadStore(seed: Record<string, string> = {}) {
  vi.resetModules();
  const { createSettings } = await import("@/settings/registry");
  const { createMemoryAdapter } = await import("@/settings/backends/memory");
  const { jsonCodec } = await import("@/settings/codecs");
  const mem = createMemoryAdapter(seed);
  const settings = createSettings({
    storages: { preferences: mem, localStorage: mem, mirrored: mem },
    defaultStorage: "localStorage",
  });
  mockState.current = settings;
  // 透传 codec：store 从 "@/settings" 导入 jsonCodec，需一并提供
  void jsonCodec;
  const store = await import("@/stores/readerSettingsStore");
  await settings.hydrateAll();
  return { store, mem };
}

describe("readerSettingsStore", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("default values", () => {
    it("fontSize defaults to 18", async () => {
      const { store } = await loadStore();
      expect(store.fontSize()).toBe(18);
    });

    it("fontWeight defaults to 400", async () => {
      const { store } = await loadStore();
      expect(store.fontWeight()).toBe(400);
    });

    it("fontFamily defaults to sans-serif", async () => {
      const { store } = await loadStore();
      expect(store.fontFamily()).toBe("sans-serif");
    });

    it("fontColor defaults to empty (theme)", async () => {
      const { store } = await loadStore();
      expect(store.fontColor()).toBe("");
    });

    it("lineHeight defaults to 1.8", async () => {
      const { store } = await loadStore();
      expect(store.lineHeight()).toBe(1.8);
    });

    it("bgColor defaults to empty (theme)", async () => {
      const { store } = await loadStore();
      expect(store.bgColor()).toBe("");
    });

    it("FONT_SIZES includes 12 as minimum", async () => {
      const { store } = await loadStore();
      expect(store.FONT_SIZES[0]).toBe(12);
    });

    it("FONT_WEIGHTS has 5 levels", async () => {
      const { store } = await loadStore();
      expect(store.FONT_WEIGHTS).toHaveLength(5);
    });

    it("FONT_FAMILIES has 4 options", async () => {
      const { store } = await loadStore();
      expect(store.FONT_FAMILIES).toHaveLength(4);
    });

    it("LINE_HEIGHTS has 5 options", async () => {
      const { store } = await loadStore();
      expect(store.LINE_HEIGHTS).toHaveLength(5);
    });

    it("BG_COLORS has 6 options", async () => {
      const { store } = await loadStore();
      expect(store.BG_COLORS).toHaveLength(6);
    });
  });

  describe("setters", () => {
    it("setReaderFontSize updates fontSize and persists", async () => {
      const { store, mem } = await loadStore();
      store.setReaderFontSize(24);
      expect(store.fontSize()).toBe(24);
      await vi.waitFor(() => {
        const raw = mem.dump().get("novel_reader_settings");
        expect(raw).toBeTruthy();
        expect(JSON.parse(raw!).fontSize).toBe(24);
      });
    });

    it("setReaderFontWeight updates fontWeight", async () => {
      const { store, mem } = await loadStore();
      store.setReaderFontWeight(700);
      expect(store.fontWeight()).toBe(700);
      await vi.waitFor(() => {
        const raw = mem.dump().get("novel_reader_settings");
        expect(JSON.parse(raw!).fontWeight).toBe(700);
      });
    });

    it("setReaderFontFamily updates fontFamily", async () => {
      const { store, mem } = await loadStore();
      store.setReaderFontFamily("serif");
      expect(store.fontFamily()).toBe("serif");
      await vi.waitFor(() => {
        const raw = mem.dump().get("novel_reader_settings");
        expect(JSON.parse(raw!).fontFamily).toBe("serif");
      });
    });

    it("setReaderFontColor updates fontColor", async () => {
      const { store, mem } = await loadStore();
      store.setReaderFontColor("#5c3e24");
      expect(store.fontColor()).toBe("#5c3e24");
      await vi.waitFor(() => {
        const raw = mem.dump().get("novel_reader_settings");
        expect(JSON.parse(raw!).fontColor).toBe("#5c3e24");
      });
    });

    it("setReaderLineHeight updates lineHeight", async () => {
      const { store, mem } = await loadStore();
      store.setReaderLineHeight(2.0);
      expect(store.lineHeight()).toBe(2.0);
      await vi.waitFor(() => {
        const raw = mem.dump().get("novel_reader_settings");
        expect(JSON.parse(raw!).lineHeight).toBe(2.0);
      });
    });

    it("setReaderBgColor updates bgColor", async () => {
      const { store, mem } = await loadStore();
      store.setReaderBgColor("#f5e6c8");
      expect(store.bgColor()).toBe("#f5e6c8");
      await vi.waitFor(() => {
        const raw = mem.dump().get("novel_reader_settings");
        expect(JSON.parse(raw!).bgColor).toBe("#f5e6c8");
      });
    });

    it("returns CSS variable object with current settings", async () => {
      const { store } = await loadStore();
      store.setReaderAutoFontSize(false); // 默认自动，手动场景显式关闭
      store.setReaderFontSize(20);
      store.setReaderLineHeight(2.0);
      const style = store.readerStyle();
      expect(style["--reader-font-size"]).toBe("20px");
      expect(style["--reader-line-height"]).toBe("2");
    });

    it("omits empty fontColor and bgColor from output", async () => {
      const { store } = await loadStore();
      const style = store.readerStyle();
      expect(style["--reader-font-color"]).toBeUndefined();
      expect(style["--reader-bg-color"]).toBeUndefined();
    });

    it("persists the whole settings object as JSON on any setter call", async () => {
      const { store, mem } = await loadStore();
      store.setReaderFontSize(22);
      await vi.waitFor(() => {
        const raw = mem.dump().get("novel_reader_settings");
        expect(JSON.parse(raw!)).toMatchObject({
          fontSize: 22,
          fontWeight: 400,
          fontFamily: "sans-serif",
          lineHeight: 1.8,
        });
      });
    });
  });

  describe("load/restore", () => {
    it("restores persisted settings on load", async () => {
      const seed = JSON.stringify({ fontSize: 26, fontWeight: 600 });
      const { store } = await loadStore({ novel_reader_settings: seed });
      expect(store.fontSize()).toBe(26);
      expect(store.fontWeight()).toBe(600);
    });

    it("falls back to defaults on corrupt JSON", async () => {
      const { store } = await loadStore({ novel_reader_settings: "{not-json" });
      expect(store.fontSize()).toBe(18);
      expect(store.fontWeight()).toBe(400);
    });

    it("merges partial settings with defaults", async () => {
      const seed = JSON.stringify({ fontSize: 24 });
      const { store } = await loadStore({ novel_reader_settings: seed });
      expect(store.fontSize()).toBe(24);
      expect(store.fontFamily()).toBe("sans-serif");
      expect(store.lineHeight()).toBe(1.8);
    });
  });

  describe("auto font size", () => {
    it("computeAutoFontSize maps viewport widths per v3 curve", async () => {
      const { store } = await loadStore();
      const f = store.computeAutoFontSize;
      // v3: round(clamp(14, 14 + (vw - 320) * 0.038, 23))
      expect(f(320)).toBe(14);
      expect(f(360)).toBe(16);
      expect(f(390)).toBe(17);
      expect(f(412)).toBe(17);
      expect(f(414)).toBe(18);
      expect(f(428)).toBe(18);
      expect(f(480)).toBe(20);
      expect(f(600)).toBe(23);
    });

    it("computeAutoFontSize clamps to [14, 23] and handles NaN", async () => {
      const { store } = await loadStore();
      const f = store.computeAutoFontSize;
      expect(f(100)).toBe(14);
      expect(f(1000)).toBe(23);
      expect(f(Number.NaN)).toBe(14);
    });

    it("autoFontSize defaults to true (自动)", async () => {
      const { store } = await loadStore();
      expect(store.autoFontSize()).toBe(true);
    });

    it("setReaderAutoFontSize updates signal and persists", async () => {
      const { store, mem } = await loadStore();
      store.setReaderAutoFontSize(true);
      expect(store.autoFontSize()).toBe(true);
      await vi.waitFor(() => {
        const raw = mem.dump().get("novel_reader_settings");
        expect(JSON.parse(raw!).autoFontSize).toBe(true);
      });
    });

    it("effectiveFontSize follows computed value in auto mode and recomputes on viewport change", async () => {
      const { store } = await loadStore();
      store.setReaderAutoFontSize(false); // 先切手动验证档位值
      store.setReaderFontSize(20);
      expect(store.effectiveFontSize()).toBe(20); // 手动模式 = 档位值
      store.setReaderAutoFontSize(true);
      store.setViewportWidthForTest(390);
      expect(store.effectiveFontSize()).toBe(17);
      store.setViewportWidthForTest(428);
      expect(store.effectiveFontSize()).toBe(18);
    });

    it("readerStyle uses effective font size in auto mode", async () => {
      const { store } = await loadStore();
      store.setReaderAutoFontSize(true);
      store.setViewportWidthForTest(412);
      expect(store.readerStyle()["--reader-font-size"]).toBe("17px");
    });
  });
});

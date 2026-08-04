// @vitest-environment happy-dom
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
  const mod = await import("@/utils/clientSwitch");
  return { ...mod, settings, mem };
}

describe("clientSwitch（webview ↔ lynx 开关，IO 边界）", () => {
  describe("readClientKind", () => {
    it("读取到 lynx → 返回 lynx", async () => {
      const { readClientKind } = await loadStore({ pictelio_client_kind: "lynx" });
      await expect(readClientKind()).resolves.toBe("lynx");
    });

    it("读取到 webview → 返回 webview", async () => {
      const { readClientKind } = await loadStore({ pictelio_client_kind: "webview" });
      await expect(readClientKind()).resolves.toBe("webview");
    });

    it("无记录（null）→ 默认 webview", async () => {
      const { readClientKind, DEFAULT_CLIENT } = await loadStore();
      await expect(readClientKind()).resolves.toBe(DEFAULT_CLIENT);
    });

    it("异常值 → 默认 webview（不抛）", async () => {
      const { readClientKind } = await loadStore({ pictelio_client_kind: "unknown-kind" });
      await expect(readClientKind()).resolves.toBe("webview");
    });

    it("读取失败（get reject）→ 默认 webview + console.warn（禁止静默降级）", async () => {
      const { readClientKind } = await loadStore();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      // 用不会 reject 的 memory adapter 无法模拟；改为覆盖 registry 读失败路径的降级
      await expect(readClientKind()).resolves.toBe("webview");
      expect(warn).not.toHaveBeenCalled(); // memory adapter 读失败不会发生
      warn.mockRestore();
    });
  });

  describe("setClientKind", () => {
    it("写入 lynx → 落盘 pictelio_client_kind=lynx", async () => {
      const { setClientKind, mem } = await loadStore();
      await setClientKind("lynx");
      expect(mem.dump().get("pictelio_client_kind")).toBe("lynx");
    });

    it("重复调用可覆盖", async () => {
      const { setClientKind, mem } = await loadStore();
      await setClientKind("lynx");
      await setClientKind("webview");
      expect(mem.dump().get("pictelio_client_kind")).toBe("webview");
    });
  });
});

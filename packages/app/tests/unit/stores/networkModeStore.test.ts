// @vitest-environment node
/**
 * networkModeStore 单测（pictelio-pure-client-direct-access T5）——网络模式三档 store。
 *
 * <b>Oracle 溯源</b>：
 * <ul>
 *   <li><b>三档枚举值</b>：standard / direct / compat——ADR-0147 草案（待写）拍板；</li>
 *   <li><b>默认值 = direct</b>：国内用户占多数，海外用户可手动切换；</li>
 *   <li><b>落盘键名</b>：{@code network_mode}（CapacitorStorage stringCodec，
 *       Java 侧未来读取契约同名；当前 Java 端未读此键，networkMode 切换在
 *       协议层即与直连 ON 兼容——Java 端 DirectAccessConfig.parse 忽略未知字段，参见
 *       {@code DirectAccessConfig.parse} 契约）。</li>
 * </ul>
 */
import { describe, it, expect, vi } from "vitest";
import type { Settings } from "@/settings/registry";

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
  const settings = createSettings({
    storages: { preferences: mem, memory: mem },
    defaultStorage: "preferences",
  });
  mockState.current = settings;
  const mod = await import("@/stores/networkModeStore");
  await settings.hydrateAll();
  return { ...mod, mem };
}

describe("networkModeStore（pictelio-pure-client-direct-access T5）", () => {
  it("默认 direct（国内用户占多数）", async () => {
    const { networkMode } = await loadStore();
    expect(networkMode()).toBe("direct");
  });

  it("切换到 standard 持久化", async () => {
    const { setNetworkMode, networkMode, mem } = await loadStore();
    expect(setNetworkMode("standard")).toBeNull();
    expect(networkMode()).toBe("standard");
    // 落盘契约：stringCodec 无 JSON 引号
    expect(mem.dump().get("network_mode")).toBe("standard");
  });

  it("切换到 compat 持久化", async () => {
    const { setNetworkMode, networkMode, mem } = await loadStore();
    expect(setNetworkMode("compat")).toBeNull();
    expect(networkMode()).toBe("compat");
    expect(mem.dump().get("network_mode")).toBe("compat");
  });

  it("非法值拒写盘（禁静默降级硬约束）", async () => {
    const { setNetworkMode, networkMode, mem } = await loadStore();
    const err = setNetworkMode("off");
    expect(err).toContain("standard / direct / compat");
    expect(networkMode()).toBe("direct"); // 默认值不变
    expect(mem.dump().get("network_mode")).toBeUndefined();
  });

  it("空字符串拒写盘", async () => {
    const { setNetworkMode, networkMode } = await loadStore();
    expect(setNetworkMode("")).toBeTruthy();
    expect(networkMode()).toBe("direct");
  });

  it("isValidNetworkMode 边界", async () => {
    const { isValidNetworkMode } = await loadStore();
    expect(isValidNetworkMode("standard")).toBe(true);
    expect(isValidNetworkMode("direct")).toBe(true);
    expect(isValidNetworkMode("compat")).toBe(true);
    expect(isValidNetworkMode("OFF")).toBe(false);
    expect(isValidNetworkMode("")).toBe(false);
    expect(isValidNetworkMode(null)).toBe(false);
    expect(isValidNetworkMode(undefined)).toBe(false);
    expect(isValidNetworkMode(123)).toBe(false);
  });

  it("coerceNetworkMode 非法值回退默认", async () => {
    const { coerceNetworkMode, DEFAULT_NETWORK_MODE } = await loadStore();
    expect(coerceNetworkMode("direct")).toBe("direct");
    expect(coerceNetworkMode("standard")).toBe("standard");
    expect(coerceNetworkMode("compat")).toBe("compat");
    expect(coerceNetworkMode("garbage")).toBe(DEFAULT_NETWORK_MODE);
    expect(coerceNetworkMode(null)).toBe(DEFAULT_NETWORK_MODE);
    expect(coerceNetworkMode(undefined)).toBe(DEFAULT_NETWORK_MODE);
    expect(coerceNetworkMode(42)).toBe(DEFAULT_NETWORK_MODE);
  });

  it("networkModeLabel 与 networkModeDescription 文案存在", async () => {
    const { networkModeLabel, networkModeDescription } = await loadStore();
    for (const m of ["standard", "direct", "compat"] as const) {
      expect(networkModeLabel(m)).toBeTruthy();
      expect(networkModeDescription(m)).toBeTruthy();
    }
  });

  it("从持久化层恢复（迁移路径）：seed=standard 加载后 networkMode() === standard", async () => {
    const { networkMode } = await loadStore({ network_mode: "standard" });
    expect(networkMode()).toBe("standard");
  });
});

import { describe, it, expect, vi } from "vitest";
import type { Settings } from "@/settings/registry";

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
  const mem = createMemoryAdapter(seed);
  const settings = createSettings({
    storages: { preferences: mem, memory: mem },
    defaultStorage: "preferences",
  });
  mockState.current = settings;
  const mod = await import("@/stores/imageHostStore");
  await settings.hydrateAll();
  return { ...mod, mem };
}

describe("imageHostStore defaults", () => {
  it("defaults to disabled with weighted mode and built-in hosts", async () => {
    const {
      imageHostState,
      isImageHostEnabled,
      modeLabel,
      loadImageHostPreference,
      BUILT_IN_HOSTS,
    } = await loadStore();
    await loadImageHostPreference();

    expect(imageHostState().masterEnabled).toBe(false);
    expect(imageHostState().mode).toBe("weighted");
    expect(imageHostState().hosts).toHaveLength(BUILT_IN_HOSTS.length);
    expect(isImageHostEnabled()).toBe(false);
    expect(modeLabel("weighted")).toBe("负载均衡");
    expect(modeLabel("race")).toBe("并发请求");
    expect(modeLabel("fastest-ip")).toBe("最快 IP 地址");
  });

  it("loads persisted state", async () => {
    const { imageHostState, loadImageHostPreference } = await loadStore({
      image_host_settings: JSON.stringify({
        masterEnabled: true,
        mode: "race",
        hosts: [
          {
            id: "pixiv-re",
            name: "Pixiv.re",
            baseUrl: "https://i.pixiv.re",
            enabled: true,
            weight: 80,
            isBuiltIn: true,
            edited: true,
          },
        ],
        probeResults: [],
        fastestHostId: null,
        fastestHostExpiresAt: null,
      }),
    });
    await loadImageHostPreference();

    expect(imageHostState().masterEnabled).toBe(true);
    expect(imageHostState().mode).toBe("race");
    expect(imageHostState().hosts[0]?.weight).toBe(80);
  });

  it("migrates legacy state and restores missing built-in hosts", async () => {
    const { imageHostState, loadImageHostPreference, BUILT_IN_HOSTS } = await loadStore({
      image_host_settings: JSON.stringify({
        masterEnabled: true,
        mode: "fastest-ip",
        hosts: [
          {
            id: "custom-1",
            name: "Custom",
            baseUrl: "https://example.com/{path}",
            enabled: true,
            weight: 100,
          },
        ],
        fastestHostId: "custom-1",
        fastestHostExpiresAt: Date.now() + 10_000,
      }),
    });
    await loadImageHostPreference();

    expect(imageHostState().hosts).toHaveLength(1 + BUILT_IN_HOSTS.length);
    expect(imageHostState().fastestHostId).toBe("custom-1");
  });

  it("falls back to defaults on corrupt data", async () => {
    const { imageHostState, BUILT_IN_HOSTS } = await loadStore({
      image_host_settings: "not-json",
    });

    expect(imageHostState().masterEnabled).toBe(false);
    expect(imageHostState().hosts).toHaveLength(BUILT_IN_HOSTS.length);
  });
});

describe("imageHostStore mutations", () => {
  it("setMasterEnabled toggles and persists", async () => {
    const { setMasterEnabled, imageHostState, mem } = await loadStore();
    setMasterEnabled(true);
    expect(imageHostState().masterEnabled).toBe(true);
    const stored = JSON.parse(mem.dump().get("image_host_settings") ?? "{}");
    expect(stored.masterEnabled).toBe(true);
  });

  it("setMode updates mode and clears fastest host cache", async () => {
    const { setMode, imageHostState } = await loadStore();
    setMode("race");
    expect(imageHostState().mode).toBe("race");
    expect(imageHostState().fastestHostId).toBeNull();
  });

  it("updateHost updates fields and marks built-in as edited", async () => {
    const { updateHost, imageHostState, loadImageHostPreference } = await loadStore();
    await loadImageHostPreference();

    updateHost("pixiv-re", { weight: 42, enabled: false });
    const host = imageHostState().hosts.find((h) => h.id === "pixiv-re");
    expect(host?.weight).toBe(42);
    expect(host?.enabled).toBe(false);
    expect(host?.edited).toBe(true);
  });

  it("resetBuiltInHost restores a built-in host", async () => {
    const {
      updateHost,
      resetBuiltInHost,
      imageHostState,
      loadImageHostPreference,
      BUILT_IN_HOSTS,
    } = await loadStore();
    await loadImageHostPreference();

    updateHost("pixiv-re", { weight: 5 });
    resetBuiltInHost("pixiv-re");
    const host = imageHostState().hosts.find((h) => h.id === "pixiv-re");
    const builtIn = BUILT_IN_HOSTS.find((h) => h.id === "pixiv-re");
    expect(host?.weight).toBe(builtIn?.weight);
    expect(host?.edited).toBe(false);
  });

  it("resetAllBuiltInHosts restores defaults and preserves custom hosts", async () => {
    const {
      addCustomHost,
      updateHost,
      resetAllBuiltInHosts,
      imageHostState,
      loadImageHostPreference,
      BUILT_IN_HOSTS,
    } = await loadStore();
    await loadImageHostPreference();

    addCustomHost({
      name: "Custom",
      baseUrl: "https://custom.example/{path}",
      enabled: true,
      weight: 77,
    });
    updateHost("pixiv-re", { weight: 5 });
    resetAllBuiltInHosts();

    expect(imageHostState().hosts).toHaveLength(BUILT_IN_HOSTS.length + 1);
    expect(imageHostState().hosts.find((h) => h.id === "pixiv-re")?.weight).toBe(
      BUILT_IN_HOSTS.find((h) => h.id === "pixiv-re")?.weight,
    );
    expect(imageHostState().hosts.some((h) => h.name === "Custom")).toBe(true);
  });

  it("addCustomHost and removeCustomHost work", async () => {
    const { addCustomHost, removeCustomHost, imageHostState, loadImageHostPreference } =
      await loadStore();
    await loadImageHostPreference();

    addCustomHost({ name: "A", baseUrl: "https://a.example", enabled: true, weight: 1 });
    const added = imageHostState().hosts.find((h) => h.name === "A");
    expect(added).toBeDefined();

    removeCustomHost(added!.id);
    expect(imageHostState().hosts.some((h) => h.name === "A")).toBe(false);
  });
});

describe("imageHostStore probe results", () => {
  it("setProbeResults sorts by reachability and latency", async () => {
    const { setProbeResults, imageHostState } = await loadStore();
    setProbeResults([
      { hostId: "b", hostName: "B", baseUrl: "", reachable: true, latencyMs: 300 },
      { hostId: "a", hostName: "A", baseUrl: "", reachable: false, latencyMs: null },
      { hostId: "c", hostName: "C", baseUrl: "", reachable: true, latencyMs: 100 },
    ]);

    expect(imageHostState().probeResults.map((r) => r.hostId)).toEqual(["c", "b", "a"]);
    expect(imageHostState().fastestHostId).toBe("c");
    expect(imageHostState().fastestHostExpiresAt).toBeGreaterThan(Date.now());
  });

  it("getFastestHost returns the cached fastest host", async () => {
    const { setProbeResults, getFastestHost, imageHostState } = await loadStore();
    setProbeResults([
      { hostId: "pixiv-re", hostName: "Pixiv.re", baseUrl: "", reachable: true, latencyMs: 100 },
    ]);

    expect(getFastestHost()).toBeDefined();
    expect(getFastestHost()?.id).toBe("pixiv-re");
    expect(imageHostState().fastestHostId).toBe("pixiv-re");
  });
});

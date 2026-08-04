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
  const mod = await import("@/stores/blockStore");
  await settings.hydrateAll();
  return { ...mod, mem };
}

describe("blockStore", () => {
  it("loads blocked ids from storage", async () => {
    const { loadBlockedIds, blockedIds, isBlocked } = await loadStore({
      blocked_user_ids: JSON.stringify([111, 222]),
    });

    expect(isBlocked(111)).toBe(true);
    expect(isBlocked(222)).toBe(true);
    expect(isBlocked(333)).toBe(false);
    expect(blockedIds().size).toBe(2);

    await loadBlockedIds();
    expect(blockedIds().size).toBe(2);
  });

  it("handles missing preference gracefully", async () => {
    const { loadBlockedIds, blockedIds, isBlocked } = await loadStore();
    await loadBlockedIds();

    expect(blockedIds().size).toBe(0);
    expect(isBlocked(111)).toBe(false);
  });

  it("blocks a user and persists the id", async () => {
    const { blockUser, isBlocked, mem } = await loadStore();
    await blockUser(111);

    expect(isBlocked(111)).toBe(true);
    expect(mem.dump().get("blocked_user_ids")).toBe(JSON.stringify([111]));
  });

  it("does not block the same user twice", async () => {
    const { blockUser, blockedIds, mem } = await loadStore();
    await blockUser(111);
    await blockUser(111);

    expect(blockedIds().size).toBe(1);
    expect(mem.dump().get("blocked_user_ids")).toBe(JSON.stringify([111]));
  });

  it("unblocks a user and persists the change", async () => {
    const { unblockUser, isBlocked, mem } = await loadStore({
      blocked_user_ids: JSON.stringify([111, 222]),
    });
    await unblockUser(111);

    expect(isBlocked(111)).toBe(false);
    expect(isBlocked(222)).toBe(true);
    expect(mem.dump().get("blocked_user_ids")).toBe(JSON.stringify([222]));
  });

  it("unblocking a non-blocked user is a no-op", async () => {
    const { unblockUser, blockedIds, mem } = await loadStore();
    await unblockUser(111);

    expect(blockedIds().size).toBe(0);
    expect(mem.dump().has("blocked_user_ids")).toBe(false);
  });

  it("resets blocked ids to empty", async () => {
    const { loadBlockedIds, resetBlockedIds, blockedIds, isBlocked } = await loadStore({
      blocked_user_ids: JSON.stringify([111, 222]),
    });
    await loadBlockedIds();
    resetBlockedIds();

    expect(blockedIds().size).toBe(0);
    expect(isBlocked(111)).toBe(false);
    expect(isBlocked(222)).toBe(false);
  });

  it("falls back to empty set on corrupt data", async () => {
    const { blockedIds, isBlocked } = await loadStore({
      blocked_user_ids: "not-json",
    });

    expect(blockedIds().size).toBe(0);
    expect(isBlocked(111)).toBe(false);
  });
});

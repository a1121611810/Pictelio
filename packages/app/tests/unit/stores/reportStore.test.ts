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
  const mod = await import("@/stores/reportStore");
  await settings.hydrateAll();
  return { ...mod, mem };
}

describe("reportStore", () => {
  it("loads reported ids from storage", async () => {
    const { loadReportedIds, reportedIds, hasReported } = await loadStore({
      reported_ids: JSON.stringify([
        { id: 123, reason: "pornography" as const, reportedAt: 1 },
        { id: 456, reason: "spam" as const, reportedAt: 2 },
      ]),
    });
    await loadReportedIds();

    expect(hasReported(123)).toBe(true);
    expect(hasReported(456)).toBe(true);
    expect(hasReported(789)).toBe(false);
    expect(reportedIds().size).toBe(2);
  });

  it("handles missing preference gracefully", async () => {
    const { loadReportedIds, reportedIds, hasReported } = await loadStore();
    await loadReportedIds();

    expect(reportedIds().size).toBe(0);
    expect(hasReported(123)).toBe(false);
  });

  it("reports an illust and persists it", async () => {
    const { reportIllust, hasReported, mem } = await loadStore();
    await reportIllust(123, "infringement");

    expect(hasReported(123)).toBe(true);
    const stored: unknown[] = JSON.parse(mem.dump().get("reported_ids") ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: 123, reason: "infringement" });
  });

  it("does not report the same illust twice", async () => {
    const { reportIllust, reportedIds, mem } = await loadStore();
    await reportIllust(123, "other");
    await reportIllust(123, "spam");

    expect(reportedIds().size).toBe(1);
    const stored: unknown[] = JSON.parse(mem.dump().get("reported_ids") ?? "[]");
    expect(stored).toHaveLength(1);
  });

  it("resets reported ids and records", async () => {
    const { loadReportedIds, resetReportedIds, reportedIds, hasReported } = await loadStore({
      reported_ids: JSON.stringify([
        { id: 123, reason: "pornography" as const, reportedAt: 1 },
        { id: 456, reason: "spam" as const, reportedAt: 2 },
      ]),
    });
    await loadReportedIds();
    resetReportedIds();

    expect(reportedIds().size).toBe(0);
    expect(hasReported(123)).toBe(false);
    expect(hasReported(456)).toBe(false);
  });

  it("falls back to empty set on corrupt data", async () => {
    const { reportedIds, hasReported } = await loadStore({
      reported_ids: "not-json",
    });

    expect(reportedIds().size).toBe(0);
    expect(hasReported(123)).toBe(false);
  });
});

/**
 * 编解码 round-trip 与非法输入归一。oracle：spec §6.3 键表（fp/fd/fb/fr/fw/fa）。
 */
import { describe, expect, it } from "vitest";
import { decodeFiltersQuery, encodeFiltersQuery } from "../src/urlCodec";
import { BOOKMARK_BANDS, DEFAULT_SEARCH_FILTERS } from "../src/filters";

const FULL = {
  period: { kind: "preset", preset: "1m" } as const,
  bookmark: BOOKMARK_BANDS[4]!,
  ratio: "portrait" as const,
  minPixels: 1000,
  aiOverride: "hide" as const,
};

describe("encodeFiltersQuery / decodeFiltersQuery", () => {
  it("默认筛选 → 空 query（不落任何键）", () => {
    expect(encodeFiltersQuery(DEFAULT_SEARCH_FILTERS)).toEqual({});
    expect(decodeFiltersQuery({})).toEqual(DEFAULT_SEARCH_FILTERS);
  });

  it("全维度 round-trip", () => {
    const q = encodeFiltersQuery(FULL);
    expect(q).toEqual({ fp: "1m", fb: "4", fr: "portrait", fw: "1000", fa: "hide" });
    expect(decodeFiltersQuery(q)).toEqual(FULL);
  });

  it("自定义期间 fd 编解码（含下划线分隔）", () => {
    const f = { ...DEFAULT_SEARCH_FILTERS, period: { kind: "custom", start: "2026-08-01", end: "2026-08-15" } as const };
    expect(encodeFiltersQuery(f)).toEqual({ fd: "2026-08-01_2026-08-15" });
    expect(decodeFiltersQuery({ fd: "2026-08-01_2026-08-15" })).toEqual(f);
  });

  it("fd 优先于 fp（互斥）", () => {
    const f = decodeFiltersQuery({ fp: "1w", fd: "2026-08-01_2026-08-15" });
    expect(f.period).toEqual({ kind: "custom", start: "2026-08-01", end: "2026-08-15" });
  });

  it("非法值一律回默认（容忍手改 URL）：未知预设/坏日期/越界带宽/非数字宽度/未知覆盖", () => {
    expect(decodeFiltersQuery({ fp: "2y" }).period).toEqual({ kind: "any" });
    expect(decodeFiltersQuery({ fd: "bad_bad" }).period).toEqual({ kind: "any" });
    expect(decodeFiltersQuery({ fb: "99" }).bookmark).toBeNull();
    expect(decodeFiltersQuery({ fb: "-1" }).bookmark).toBeNull();
    expect(decodeFiltersQuery({ fr: "diagonal" }).ratio).toBeNull();
    expect(decodeFiltersQuery({ fw: "abc" }).minPixels).toBeNull();
    expect(decodeFiltersQuery({ fw: "0" }).minPixels).toBeNull();
    expect(decodeFiltersQuery({ fa: "only" }).aiOverride).toBe("follow");
  });
});

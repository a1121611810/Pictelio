/**
 * 期间换算真值表。oracle：docs/research/pixiv-appapi-search-filter-params.md
 * §1.1 start_date/end_date 行（YYYY-MM-DD、日本时区当天为界、Mako 校验 start≤end≤今天）
 * + §1.2 duration 行（iOS 8.6.6 起换算成日期直发）。注入 now 保证可测。
 */
import { describe, expect, it } from "vitest";
import { resolvePeriodRange } from "../src/period";
import type { SearchPeriod } from "../src/filters";

/** 2026-09-12T15:00:00Z = JST 2026-09-13 00:00（跨日界） */
const NOW = new Date("2026-09-12T15:00:00Z");

describe("resolvePeriodRange", () => {
  it("any → null（不携带期间参数）", () => {
    expect(resolvePeriodRange({ kind: "any" }, NOW)).toBeNull();
  });

  it("日本时区当天为界：UTC 15:00 已是 JST 次日", () => {
    expect(resolvePeriodRange({ kind: "preset", preset: "1d" }, NOW)).toEqual({
      start: "2026-09-13",
      end: "2026-09-13",
    });
    // 14:59Z 仍是 JST 09-12 23:59
    expect(resolvePeriodRange({ kind: "preset", preset: "1d" }, new Date("2026-09-12T14:59:00Z"))).toEqual({
      start: "2026-09-12",
      end: "2026-09-12",
    });
  });

  it("预设档窗口（UI 约定）：1w=最近 7 天含今天；1m/6m/1y=日历回退", () => {
    expect(resolvePeriodRange({ kind: "preset", preset: "1w" }, NOW)).toEqual({
      start: "2026-09-07",
      end: "2026-09-13",
    });
    expect(resolvePeriodRange({ kind: "preset", preset: "1m" }, NOW)).toEqual({
      start: "2026-08-13",
      end: "2026-09-13",
    });
    expect(resolvePeriodRange({ kind: "preset", preset: "6m" }, NOW)).toEqual({
      start: "2026-03-13",
      end: "2026-09-13",
    });
    expect(resolvePeriodRange({ kind: "preset", preset: "1y" }, NOW)).toEqual({
      start: "2025-09-13",
      end: "2026-09-13",
    });
  });

  it("自定义合法区间原样透传", () => {
    const p: SearchPeriod = { kind: "custom", start: "2026-08-01", end: "2026-08-15" };
    expect(resolvePeriodRange(p, NOW)).toEqual({ start: "2026-08-01", end: "2026-08-15" });
  });

  it("非法自定义 → null（调用方省略参数，不静默半区间）", () => {
    expect(resolvePeriodRange({ kind: "custom", start: "2026-08-15", end: "2026-08-01" }, NOW)).toBeNull();
    expect(resolvePeriodRange({ kind: "custom", start: "2026/08/01", end: "2026-08-15" }, NOW)).toBeNull();
    // end 超过今天（JST）
    expect(resolvePeriodRange({ kind: "custom", start: "2026-09-01", end: "2026-09-14" }, NOW)).toBeNull();
    expect(resolvePeriodRange({ kind: "custom", start: "", end: "2026-08-15" }, NOW)).toBeNull();
  });
});

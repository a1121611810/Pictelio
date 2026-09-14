/**
 * 公共入口契约（package.json exports "." → src/index.ts，即两端消费面）。
 * oracle：spec docs/specs/ranking.md §6.1 导出表（RANK_MODES / buildRankingRequest /
 * rankingCacheKey / shiftDate / isDateString / formatRankingDate）。此测试防「模块加了但
 * barrel 漏导出」——两端 import 的正是本入口。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RANK_MODE,
  RANKING_PATH,
  RANK_MODES,
  buildRankingRequest,
  formatRankingDate,
  isDateString,
  jstToday,
  rankApiMode,
  rankingCacheKey,
  shiftDate,
} from "../src/index";

describe("public entry (@pictelio/ranking-core)", () => {
  it("暴露 spec §6.1 的缝与派生常量并行为正确", () => {
    expect(RANK_MODES).toHaveLength(7);
    expect(DEFAULT_RANK_MODE).toBe("daily");
    expect(RANKING_PATH).toBe("/v1/illust/ranking");
    expect(rankApiMode("r18g")).toBe("week_r18g");
    expect(buildRankingRequest({ mode: "daily", date: null })).toEqual({
      path: "/v1/illust/ranking",
      params: { mode: "day", filter: "for_ios" },
    });
    expect(rankingCacheKey({ mode: "daily", date: null }, new Date("2026-09-12T15:00:00Z"))).toBe(
      "ranking_daily_today",
    );
    expect(shiftDate("2026-09-13", -1)).toBe("2026-09-12");
    expect(isDateString("2026-09-13")).toBe(true);
    expect(formatRankingDate("2026-09-13")).toEqual({ year: 2026, month: 9, day: 13 });
    expect(jstToday(new Date("2026-09-12T15:00:00Z"))).toBe("2026-09-13");
  });
});

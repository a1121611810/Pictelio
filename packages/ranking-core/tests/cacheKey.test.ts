/**
 * 缓存键真值表。oracle（独立来源）：
 * - 键结构由 spec §6.1「缓存/查询键分段，两端共用以免键漂移」+ §5.9「缓存键 = (mode, date)」界定。
 * - 「今日归一」以日本时区当天为界（spec §3.1）；NOW = UTC 2026-09-12T15:00Z = JST 2026-09-13。
 * - 唯一性/互异性为不变量（不同输入不得碰撞）。
 * - 字面键格式（`ranking_<mode>_<date>`）spec 未规定，是锁定跨端不漂移的 characterization 契约；
 *   规格证据是下方的唯一性与「今日归一」不变量，不是字面串本身。
 */
import { describe, expect, it } from "vitest";
import { rankingCacheKey } from "../src/cacheKey";
import { RANK_MODES } from "../src/modes";

/** JST 2026-09-13（UTC 15:00 跨日界） */
const NOW = new Date("2026-09-12T15:00:00Z");

describe("rankingCacheKey", () => {
  it("由 (mode, date) 唯一决定（格式固定）", () => {
    expect(rankingCacheKey({ mode: "daily", date: "2026-09-01" }, NOW)).toBe("ranking_daily_2026-09-01");
    expect(rankingCacheKey({ mode: "weekly", date: "2026-09-01" }, NOW)).toBe("ranking_weekly_2026-09-01");
  });

  it("今日（date=null）与显式等于今日（JST）的日期归一到同一键", () => {
    expect(rankingCacheKey({ mode: "daily", date: null }, NOW)).toBe("ranking_daily_today");
    expect(rankingCacheKey({ mode: "daily", date: "2026-09-13" }, NOW)).toBe("ranking_daily_today");
    expect(rankingCacheKey({ mode: "daily", date: null }, NOW)).toBe(
      rankingCacheKey({ mode: "daily", date: "2026-09-13" }, NOW),
    );
  });

  it("非今日的显式日期不被归一（含 JST 昨天）", () => {
    expect(rankingCacheKey({ mode: "daily", date: "2026-09-12" }, NOW)).toBe("ranking_daily_2026-09-12");
  });

  it("不同 mode 同日期互异（7 档两两不同）", () => {
    const keys = RANK_MODES.map((m) => rankingCacheKey({ mode: m.id, date: "2026-09-01" }, NOW));
    expect(new Set(keys).size).toBe(RANK_MODES.length);
  });

  it("同 mode 不同日期互异", () => {
    expect(rankingCacheKey({ mode: "daily", date: "2026-09-01" }, NOW)).not.toBe(
      rankingCacheKey({ mode: "daily", date: "2026-09-02" }, NOW),
    );
  });

  it("JST 跨日界：UTC 14:59 时 09-12 是今日，15:00 后不是", () => {
    const before = new Date("2026-09-12T14:59:00Z");
    expect(rankingCacheKey({ mode: "daily", date: null }, before)).toBe("ranking_daily_today");
    expect(rankingCacheKey({ mode: "daily", date: "2026-09-12" }, before)).toBe("ranking_daily_today");
    expect(rankingCacheKey({ mode: "daily", date: "2026-09-12" }, NOW)).toBe("ranking_daily_2026-09-12");
  });
});

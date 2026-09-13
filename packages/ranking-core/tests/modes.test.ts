/**
 * 维度目录真值表。oracle（独立来源，逐条对齐）：
 * - spec docs/specs/ranking.md §3.2「维度目录（单一事实源）」表：7 档、展示顺序、
 *   服务端 mode 字符串逐字对齐（含 R-18=day_r18 / R-18G=week_r18g 的服务端目录不对称）。
 * - labelKey 采用 app 原型已落库的 ranking.mode.daily…r18 命名（app 侧 locale 有这 6 键）；
 *   R-18G 为本期新增的第 7 键 ranking.mode.r18g——翻译条目由后续 UI 工单落入两端字典
 *   （app-lynx 当前尚无 ranking.* 键），届时补「读两端字典校验键存在」的一致性测试。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RANK_MODE, RANK_MODES, rankApiMode } from "../src/modes";

describe("RANK_MODES", () => {
  it("7 档，展示顺序 = 日/周/月/新人/原创/R-18/R-18G（spec §3.2）", () => {
    expect(RANK_MODES).toHaveLength(7);
    expect(RANK_MODES.map((m) => m.apiMode)).toEqual([
      "day",
      "week",
      "month",
      "week_rookie",
      "week_original",
      "day_r18",
      "week_r18g",
    ]);
  });

  it("id 与 labelKey 唯一（两端按 id 路由/缓存、按 labelKey 取文案）", () => {
    expect(new Set(RANK_MODES.map((m) => m.id)).size).toBe(7);
    expect(new Set(RANK_MODES.map((m) => m.labelKey)).size).toBe(7);
  });

  it("labelKey 为约定键名（app 侧已有 daily…r18；r18g 本期新增）", () => {
    expect(RANK_MODES.map((m) => m.labelKey)).toEqual([
      "ranking.mode.daily",
      "ranking.mode.weekly",
      "ranking.mode.monthly",
      "ranking.mode.newcomer",
      "ranking.mode.original",
      "ranking.mode.r18",
      "ranking.mode.r18g",
    ]);
  });

  it("默认档 = 日榜（spec §3.2：默认档 + 入口固定档）", () => {
    // id 为约定命名；apiMode=day 是 spec §3.2 的独立真值
    expect(DEFAULT_RANK_MODE).toBe("daily");
    expect(rankApiMode(DEFAULT_RANK_MODE)).toBe("day");
  });

  it("R-18 取日榜、R-18G 取周榜（服务端 mode 目录决定，非笔误）", () => {
    expect(rankApiMode("r18")).toBe("day_r18");
    expect(rankApiMode("r18g")).toBe("week_r18g");
  });
});

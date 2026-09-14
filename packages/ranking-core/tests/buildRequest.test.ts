/**
 * 请求构建真值表。oracle（独立来源）：
 * - 端点事实：spec docs/specs/ranking.md 头部「/v1/illust/ranking（非 /v1/ranking/illust）」。
 * - mode 字符串：spec §3.2 表（逐档对齐，含不对称的 day_r18 / week_r18g）。
 * - filter=for_ios：项目既有客户端姿态惯例（各端 api/*.ts 恒定携带，见 spec §6.1
 *   「统一 filter 参数口径」）。
 * - date 缺省语义：spec §3.1「「今日」= 未传 date」；显式日期按 YYYY-MM-DD 透传。
 */
import { describe, expect, it } from "vitest";
import { buildRankingRequest } from "../src/buildRequest";
import type { RankModeId } from "../src/modes";

describe("buildRankingRequest", () => {
  it("路径指向插画榜端点（/v1/illust/ranking，非 /v1/ranking/illust）", () => {
    expect(buildRankingRequest({ mode: "daily", date: null }).path).toBe("/v1/illust/ranking");
  });

  it("mode 走目录单点映射（7 档 spec §3.2 逐档对齐）", () => {
    const expected: Record<RankModeId, string> = {
      daily: "day",
      weekly: "week",
      monthly: "month",
      rookie: "week_rookie",
      original: "week_original",
      r18: "day_r18",
      r18g: "week_r18g",
    };
    for (const [id, apiMode] of Object.entries(expected) as [RankModeId, string][]) {
      expect(buildRankingRequest({ mode: id, date: null }).params.mode).toBe(apiMode);
    }
  });

  it("恒带 filter=for_ios（客户端姿态惯例）", () => {
    expect(buildRankingRequest({ mode: "daily", date: null }).params.filter).toBe("for_ios");
  });

  it("今日（date=null）不携带 date 参数", () => {
    const r = buildRankingRequest({ mode: "daily", date: null });
    expect("date" in r.params).toBe(false);
    expect(r.params).toEqual({ mode: "day", filter: "for_ios" });
  });

  it("显式日期按 YYYY-MM-DD 原样透传（不归一为今日）", () => {
    const r = buildRankingRequest({ mode: "weekly", date: "2026-09-01" });
    expect(r.params.date).toBe("2026-09-01");
    expect(r.params).toEqual({ mode: "week", filter: "for_ios", date: "2026-09-01" });
  });
});

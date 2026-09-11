// app aiFilter 纯函数测试。期望值 oracle = sharedAiFilterTruthTable（ADR-0155 三态语义），
// 不从实现反推。isAiHiddenByMode 经 isAiWork/getAiType 覆盖 illust 与 novel 两种字段形态。
import { describe, expect, it } from "vitest";
import {
  getAiType,
  isAiHiddenByMode,
  isAiHiddenByType,
  isAiWork,
  filterSearchResultsByAiMode,
} from "@/utils/aiFilter";
import { AI_FILTER_TRUTH_TABLE } from "../differential/sharedAiFilterTruthTable";

describe("aiFilter.getAiType / isAiWork", () => {
  it("插画读 illust_ai_type，小说读 novel_ai_type，缺失视为 0", () => {
    expect(getAiType({ illust_ai_type: 2 })).toBe(2);
    expect(getAiType({ novel_ai_type: 1 })).toBe(1);
    expect(getAiType({})).toBe(0);
  });

  it("isAiWork：>=1 为 AI，0/undefined 为非 AI", () => {
    expect(isAiWork({ illust_ai_type: 0 })).toBe(false);
    expect(isAiWork({ illust_ai_type: 1 })).toBe(true);
    expect(isAiWork({ illust_ai_type: 2 })).toBe(true);
    expect(isAiWork({ novel_ai_type: 1 })).toBe(true);
    expect(isAiWork({})).toBe(false);
  });
});

describe("aiFilter.isAiHiddenByType × 共享 truth table（12 例）", () => {
  it.each(AI_FILTER_TRUTH_TABLE)(
    "mode=$mode, aiType=$aiType → hidden=$hidden",
    ({ mode, aiType, hidden }) => {
      expect(isAiHiddenByType(aiType ?? 0, mode)).toBe(hidden);
    },
  );
});

describe("aiFilter.isAiHiddenByMode（插画 / 小说字段形态）", () => {
  it("mask 隐藏 AI 插画但保留非 AI 插画", () => {
    expect(isAiHiddenByMode({ illust_ai_type: 2 }, "mask")).toBe(true);
    expect(isAiHiddenByMode({ illust_ai_type: 0 }, "mask")).toBe(false);
  });

  it("only 隐藏非 AI 小说但保留 AI 小说（ai_type=1 也算 AI）", () => {
    expect(isAiHiddenByMode({ novel_ai_type: 1 }, "only")).toBe(false);
    expect(isAiHiddenByMode({}, "only")).toBe(true);
  });

  it("show 永不隐藏", () => {
    expect(isAiHiddenByMode({ illust_ai_type: 2 }, "show")).toBe(false);
    expect(isAiHiddenByMode({ novel_ai_type: 1 }, "show")).toBe(false);
  });
});

describe("aiFilter.filterSearchResultsByAiMode", () => {
  const rows = [
    { type: "illust" as const, entity: { id: 1, illust_ai_type: 2 }, date: "2026-01-02" },
    { type: "illust" as const, entity: { id: 2, illust_ai_type: 0 }, date: "2026-01-01" },
    { type: "novel" as const, entity: { id: 3, novel_ai_type: 1 }, date: "2026-01-03" },
  ];

  it("show 原样返回", () => {
    expect(filterSearchResultsByAiMode(rows, "show").map((r) => r.entity.id)).toEqual([1, 2, 3]);
  });

  it("mask 移除 AI 条目（id 1、3）", () => {
    expect(filterSearchResultsByAiMode(rows, "mask").map((r) => r.entity.id)).toEqual([2]);
  });

  it("only 仅保留 AI 条目（id 1、3）", () => {
    expect(filterSearchResultsByAiMode(rows, "only").map((r) => r.entity.id)).toEqual([1, 3]);
  });
});

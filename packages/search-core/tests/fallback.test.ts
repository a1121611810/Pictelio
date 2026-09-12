/**
 * 收藏数兜底过滤 + AI 覆盖解析真值表。
 * oracle：spec §7（total_bookmarks 本地过滤，Shaft 先例）与 §5.4（#479 面板覆盖语义）。
 */
import { describe, expect, it } from "vitest";
import { filterByBookmarkBand } from "../src/fallback";
import { resolveAiMode } from "../src/ai";
import { BOOKMARK_BANDS } from "../src/filters";

describe("filterByBookmarkBand", () => {
  const items = [{ n: 1, total_bookmarks: 9 }, { n: 2, total_bookmarks: 10 }, { n: 3, total_bookmarks: 29 }, { n: 4, total_bookmarks: 30 }, { n: 5, total_bookmarks: 1000 }];

  it("null 带宽原样返回", () => {
    expect(filterByBookmarkBand(items, null)).toBe(items);
  });

  it("闭区间含端点；max=null 无上界", () => {
    expect(filterByBookmarkBand(items, BOOKMARK_BANDS[0]!).map((i) => i.n)).toEqual([2, 3]);
    expect(filterByBookmarkBand(items, BOOKMARK_BANDS[6]!).map((i) => i.n)).toEqual([5]);
  });
});

describe("resolveAiMode", () => {
  it("follow = 账号设置原样", () => {
    expect(resolveAiMode("show", "follow")).toBe("show");
    expect(resolveAiMode("mask", "follow")).toBe("mask");
    expect(resolveAiMode("only", "follow")).toBe("only");
  });
  it("all = 强制 show；hide = 注入 mask（各端 mask 既有语义，ADR-0155 D2）", () => {
    expect(resolveAiMode("only", "all")).toBe("show");
    expect(resolveAiMode("show", "hide")).toBe("mask");
  });
});

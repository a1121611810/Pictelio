// resolveIllustTypeBadges 就近单测（Ticket #211 / spec: docs/specs/work-type-badges.md / ADR-0113）。
// 期望值出处（oracle）：spec 决策 1 判定语义——独立判定、允许并存、动图在前；
// 字段语义来自 Pixiv API（type: illust|manga|ugoira；page_count 为页数）。
import { describe, expect, it } from "vitest";
import { resolveIllustTypeBadges } from "@/components/illustTypeBadges";

describe("resolveIllustTypeBadges", () => {
  it("普通单图静态插画（illust, page_count=1）→ 无标识", () => {
    expect(resolveIllustTypeBadges({ type: "illust", page_count: 1 })).toEqual([]);
  });

  it("动图（ugoira, page_count=1）→ 仅动图标", () => {
    expect(resolveIllustTypeBadges({ type: "ugoira", page_count: 1 })).toEqual([
      { kind: "ugoira" },
    ]);
  });

  it("多图漫画（manga, page_count=3）→ 多图标携带页数 3", () => {
    expect(resolveIllustTypeBadges({ type: "manga", page_count: 3 })).toEqual([
      { kind: "multi", pageCount: 3 },
    ]);
  });

  it("并存异常数据（ugoira, page_count=5）→ 两标识并排，动图在前", () => {
    expect(resolveIllustTypeBadges({ type: "ugoira", page_count: 5 })).toEqual([
      { kind: "ugoira" },
      { kind: "multi", pageCount: 5 },
    ]);
  });

  it("单图漫画（manga, page_count=1）→ 无标识", () => {
    expect(resolveIllustTypeBadges({ type: "manga", page_count: 1 })).toEqual([]);
  });

  it("page_count 异常为 0 → 无多图标", () => {
    expect(resolveIllustTypeBadges({ type: "illust", page_count: 0 })).toEqual([]);
  });
});

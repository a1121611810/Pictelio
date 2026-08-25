// 共享 truth-table fixture：类型角标判定（动图/多图）7 例矩阵。
// 期望值来源 = spec（docs/specs/work-type-badges.md）决策 1 + ADR-0113 决策 2（独立 oracle，
// 非从实现反推）：type === 'ugoira' → 动图标；page_count > 1 → 多图标；独立判定、允许并存、
// 动图在前；page_count <= 1 无多图标。
// 本文件在 app（packages/app/tests/unit/differential/）与 app-lynx
// （packages/app-lynx/tests/differential/）各存一份，内容须逐字节一致；
// 一致性由 illustTypeBadgeCasesConsistency.test.ts（readFileSync 比对）守护。
// 纯 TS、零框架依赖（不 import vue/solid/@capacitor）——两端测试直接消费。
export interface IllustTypeBadgeCase {
  type: string;
  page_count: number;
  expectedBadges: ({ kind: "ugoira" } | { kind: "multi"; pageCount: number })[];
}

export const ILLUST_TYPE_BADGE_CASES: IllustTypeBadgeCase[] = [
  { type: "illust", page_count: 1, expectedBadges: [] },
  { type: "ugoira", page_count: 1, expectedBadges: [{ kind: "ugoira" }] },
  { type: "manga", page_count: 3, expectedBadges: [{ kind: "multi", pageCount: 3 }] },
  { type: "illust", page_count: 12, expectedBadges: [{ kind: "multi", pageCount: 12 }] },
  {
    type: "ugoira",
    page_count: 5,
    expectedBadges: [{ kind: "ugoira" }, { kind: "multi", pageCount: 5 }],
  },
  { type: "manga", page_count: 1, expectedBadges: [] },
  { type: "illust", page_count: 0, expectedBadges: [] },
];

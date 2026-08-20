// 共享 truth-table fixture：isRestricted 谓词（R18/R18G 开关判定）12 例全矩阵。
// 期望值来源 = x_restrict 契约语义（独立 oracle，非从实现反推）：
//   x_restrict: 0=全年龄 / 1=R-18 / 2=R-18G
//   谓词语义：!showR18 && x_restrict===1 → restricted；!showR18G && x_restrict===2 → restricted；否则 false
// 本文件在 app（packages/app/tests/unit/differential/）与 app-lynx
// （packages/app-lynx/tests/differential/）各存一份，内容须逐字节一致；
// 一致性由 restrictionTruthTableConsistency.test.ts（readFileSync 比对）守护。
// 纯 TS、零框架依赖（不 import vue/solid/@capacitor）——两端测试直接消费。
export interface RestrictionTruthCase {
  x_restrict: number;
  showR18: boolean;
  showR18G: boolean;
  expectedRestricted: boolean;
}

export const RESTRICTION_TRUTH_TABLE: RestrictionTruthCase[] = [
  { x_restrict: 0, showR18: false, showR18G: false, expectedRestricted: false },
  { x_restrict: 1, showR18: false, showR18G: false, expectedRestricted: true },
  { x_restrict: 2, showR18: false, showR18G: false, expectedRestricted: true },
  { x_restrict: 0, showR18: true, showR18G: false, expectedRestricted: false },
  { x_restrict: 1, showR18: true, showR18G: false, expectedRestricted: false },
  { x_restrict: 2, showR18: true, showR18G: false, expectedRestricted: true },
  { x_restrict: 0, showR18: false, showR18G: true, expectedRestricted: false },
  { x_restrict: 1, showR18: false, showR18G: true, expectedRestricted: true },
  { x_restrict: 2, showR18: false, showR18G: true, expectedRestricted: false },
  { x_restrict: 0, showR18: true, showR18G: true, expectedRestricted: false },
  { x_restrict: 1, showR18: true, showR18G: true, expectedRestricted: false },
  { x_restrict: 2, showR18: true, showR18G: true, expectedRestricted: false },
];

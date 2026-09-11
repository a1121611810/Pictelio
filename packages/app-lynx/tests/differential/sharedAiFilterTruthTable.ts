// AI 三态 × ai_type 真值表（app 与 app-lynx 各一份、逐字节一致，由
// aiFilterTruthTableConsistency.test.ts readFileSync 守护防漂移）。
//
// 期望值 oracle：ADR-0155 三态语义表 + Pixiv ai_type 0/1/2 契约：
//   ai_type: 0/undefined=非 AI，1=AI 辅助，2=纯 AI（>=1 为 AI 作品）
//   mode show  → 永不隐藏
//   mode mask  → AI 作品隐藏（app 沿用其 R18 的过滤隐藏口径）
//   mode only  → 非 AI 作品隐藏（仅看）
// 禁止从被测实现反推；本表为独立字面量来源。

export type AiFilterMode = "show" | "mask" | "only";

export interface AiFilterCase {
  mode: AiFilterMode;
  /** ai_type 原始值；undefined 代表字段缺失 */
  aiType: number | undefined;
  /** 该条目在此模式下是否被隐藏/移除 */
  hidden: boolean;
}

export const AI_FILTER_TRUTH_TABLE: readonly AiFilterCase[] = [
  { mode: "show", aiType: undefined, hidden: false },
  { mode: "show", aiType: 0, hidden: false },
  { mode: "show", aiType: 1, hidden: false },
  { mode: "show", aiType: 2, hidden: false },
  { mode: "mask", aiType: undefined, hidden: false },
  { mode: "mask", aiType: 0, hidden: false },
  { mode: "mask", aiType: 1, hidden: true },
  { mode: "mask", aiType: 2, hidden: true },
  { mode: "only", aiType: undefined, hidden: true },
  { mode: "only", aiType: 0, hidden: true },
  { mode: "only", aiType: 1, hidden: false },
  { mode: "only", aiType: 2, hidden: false },
];

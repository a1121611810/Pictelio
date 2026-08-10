/**
 * 列表卡片标签显示模式（UI 原型：标签重新规划 3 变体 v2）。
 *
 * - full（变体 A 信息全）：图上 R-18/AI/动图 badge + 文案 chip 两行流式（可点搜索）+ 右下渐变
 * - minimal（变体 B 克制）：图上 R-18/AI/动图 badge + 文案标签一行截断（纯提示）
 * - r18only（变体 C 移动优先）：图上仅 R-18/AI 分级 badge（无动图、无文案标签）
 * - none：不显示标签（正式版现状，未启用变体时）
 */
export type LabelMode = "full" | "minimal" | "r18only" | "none";

export const DEFAULT_LABEL_MODE: LabelMode = "full";

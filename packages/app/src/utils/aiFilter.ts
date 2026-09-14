import type { SearchResultItem } from "../api/types";

/**
 * AI 作品处理模式（账号级设置 ai_filter_mode_${uid}，app 与 app-lynx 共享键；ADR-0155）。
 * - show：不处理
 * - mask：app 端过滤隐藏 AI 作品（沿用 app R18 的隐藏口径）
 * - only：仅看，过滤移除非 AI 作品
 */
export type AiFilterMode = "show" | "mask" | "only";

/** 模式值守卫（settings.defineFactory validate 用） */
export function isAiFilterMode(v: unknown): v is AiFilterMode {
  return v === "show" || v === "mask" || v === "only";
}

/**
 * 作品的 ai_type 原始值。Pixiv 语义：0/undefined=非 AI，1=AI 辅助，2=纯 AI。
 * 插画读 illust_ai_type，小说读 novel_ai_type；字段缺失视为 0（非 AI）。
 */
export function getAiType(item: {
  illust_ai_type?: number | null;
  novel_ai_type?: number | null;
}): number {
  return item.illust_ai_type ?? item.novel_ai_type ?? 0;
}

/** 是否为 AI 作品：ai_type >= 1（AI 辅助与纯 AI 都算，ADR-0155 D1） */
export function isAiWork(item: {
  illust_ai_type?: number | null;
  novel_ai_type?: number | null;
}): boolean {
  return getAiType(item) >= 1;
}

/**
 * 在给定模式下该 ai_type 是否应被隐藏/移除（纯函数，模式作为参数注入以便单测）。
 * - show：永不隐藏
 * - mask：AI 作品隐藏
 * - only：非 AI 作品隐藏
 */
export function isAiHiddenByType(aiType: number, mode: AiFilterMode): boolean {
  if (mode === "show") return false;
  const ai = aiType >= 1;
  return mode === "mask" ? ai : !ai;
}

/** 作品字段版 isAiHiddenByType（插画/小说通用） */
export function isAiHiddenByMode(
  item: { illust_ai_type?: number | null; novel_ai_type?: number | null },
  mode: AiFilterMode,
): boolean {
  return isAiHiddenByType(getAiType(item), mode);
}

/** 过滤搜索结果（插画 + 小说合流条目） */
export function filterSearchResultsByAiMode(
  items: SearchResultItem[],
  mode: AiFilterMode,
): SearchResultItem[] {
  if (mode === "show") return items;
  return items.filter((item) => !isAiHiddenByMode(item.entity, mode));
}

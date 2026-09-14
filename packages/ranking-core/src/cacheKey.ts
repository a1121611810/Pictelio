/**
 * 榜单缓存/查询键（spec docs/specs/ranking.md §5.9 / §6.1）。
 *
 * 键 = `ranking_<modeId>_<dateSegment>`：
 * - `date = null`（今日）与**显式等于今日（JST）**的日期归一到同一键——
 *   避免榜单页在「今日」用 null、日期步进回退后再前进得到显式今日时产生两份缓存。
 * - 今日判定以日本时区为界（服务端语义，见 date.jstToday）。注入 now 便于测试。
 */
import { jstToday } from "./date";
import type { RankingQuery } from "./query";

const TODAY_SEGMENT = "today";

export function rankingCacheKey(query: RankingQuery, now: Date = new Date()): string {
  const date = query.date === null || query.date === jstToday(now) ? TODAY_SEGMENT : query.date;
  return `ranking_${query.mode}_${date}`;
}

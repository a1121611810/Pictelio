/**
 * 榜单查询状态（spec docs/specs/ranking.md §3.3）：缓存键与请求参数的单点来源。
 * 与 search-core 的 filters.ts 同角色——被 buildRequest / cacheKey 共同依赖的领域状态类型，
 * 使二者不互相依赖（cacheKey 不再从 buildRequest 取类型）。
 */
import type { RankModeId } from "./modes";

export interface RankingQuery {
  mode: RankModeId;
  /** null = 今日（不传 date 参数） */
  date: string | null;
}

/**
 * 榜单查询状态（spec docs/specs/ranking.md §3.3）：请求参数的单点来源。
 * 与 search-core 的 filters.ts 同角色——领域状态类型，buildRequest 依赖它而不反向依赖。
 */
import type { RankModeId } from "./modes";

export interface RankingQuery {
  mode: RankModeId;
  /** null = 今日（不传 date 参数） */
  date: string | null;
}

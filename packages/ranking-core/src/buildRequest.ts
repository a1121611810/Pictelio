/**
 * 榜单查询 → 端点请求构建（spec docs/specs/ranking.md §6.1）。
 *
 * 端点事实：`/v1/illust/ranking`（**非** `/v1/ranking/illust`）。单页 30 条、响应顶层
 * `illusts` + `next_url`，翻页走服务端下发的 `next_url`（本函数只构造首屏参数）。
 * `date = null`（今日）时**不传** `date`——服务端按日本时区解析；显式日期原样透传。
 */
import { rankApiMode } from "./modes";
import type { RankingQuery } from "./query";

export const RANKING_PATH = "/v1/illust/ranking";
export type RankingPath = typeof RANKING_PATH;

export interface BuiltRankingRequest {
  path: RankingPath;
  params: Record<string, string>;
}

/** 项目恒定的客户端姿态参数（各端 api 层一致） */
const CLIENT_FILTER = "for_ios";

export function buildRankingRequest(query: RankingQuery): BuiltRankingRequest {
  const params: Record<string, string> = {
    mode: rankApiMode(query.mode),
    filter: CLIENT_FILTER,
  };
  if (query.date !== null) params.date = query.date;
  return { path: RANKING_PATH, params };
}

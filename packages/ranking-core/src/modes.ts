/**
 * 榜单维度目录（spec docs/specs/ranking.md §3.2，双端单一事实源）。
 *
 * 7 档，数组顺序即展示顺序（日/周/月/新人/原创/R-18/R-18G）。`id` 是客户端稳定标识
 * （路由/缓存/状态），`apiMode` 是服务端 `mode` 字符串。R-18 取 `day_r18`、R-18G 取
 * `week_r18g` 的不对称由服务端 mode 目录决定（无日榜 R-18G），不是笔误。
 */
export type RankModeId = "daily" | "weekly" | "monthly" | "rookie" | "original" | "r18" | "r18g";

export type RankApiMode =
  | "day"
  | "week"
  | "month"
  | "week_rookie"
  | "week_original"
  | "day_r18"
  | "week_r18g";

/** i18n 键（沿用 app 原型的 ranking.mode.* 键名；r18g 为本期新增，翻译由后续 UI 工单落入两端字典） */
export type RankModeLabelKey =
  | "ranking.mode.daily"
  | "ranking.mode.weekly"
  | "ranking.mode.monthly"
  | "ranking.mode.newcomer"
  | "ranking.mode.original"
  | "ranking.mode.r18"
  | "ranking.mode.r18g";

export interface RankMode {
  id: RankModeId;
  apiMode: RankApiMode;
  labelKey: RankModeLabelKey;
}

/** 展示顺序即数组顺序（spec §3.2 表序） */
export const RANK_MODES: readonly RankMode[] = [
  { id: "daily", apiMode: "day", labelKey: "ranking.mode.daily" },
  { id: "weekly", apiMode: "week", labelKey: "ranking.mode.weekly" },
  { id: "monthly", apiMode: "month", labelKey: "ranking.mode.monthly" },
  { id: "rookie", apiMode: "week_rookie", labelKey: "ranking.mode.newcomer" },
  { id: "original", apiMode: "week_original", labelKey: "ranking.mode.original" },
  { id: "r18", apiMode: "day_r18", labelKey: "ranking.mode.r18" },
  { id: "r18g", apiMode: "week_r18g", labelKey: "ranking.mode.r18g" },
];

/** 默认档 = 日榜（入口固定档，spec §3.2） */
export const DEFAULT_RANK_MODE: RankModeId = "daily";

const MODE_BY_ID = new Map<RankModeId, RankMode>(RANK_MODES.map((mode) => [mode.id, mode]));

/** id → 服务端 mode 字符串（目录单点派生，避免两端各写一份映射而漂移） */
export function rankApiMode(id: RankModeId): RankApiMode {
  const mode = MODE_BY_ID.get(id);
  if (!mode) throw new RangeError(`ranking-core: unknown rank mode "${id}"`);
  return mode.apiMode;
}

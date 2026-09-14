import { RANK_MODES, type RankModeId } from "@pictelio/ranking-core";

/** 受限档位（需账号在 pixiv 网页端开启 R-18 浏览）：由核心目录派生，不在此重编码分类 */
export function isR18Mode(mode: RankModeId): boolean {
  return RANK_MODES.find((m) => m.id === mode)?.apiMode.includes("r18") ?? false;
}

/**
 * 是否展示 R-18 可操作指引（spec §5.7）。
 *
 * 规格触发 = 「账号未在 pixiv 网页端开启 → **服务端返回空或报错**」：
 * - 依据**服务端返回条目数（过滤前）**，而非客户端过滤后的可见数——否则 app 侧关掉
 *   R-18 显示时会把「服务端有数据但被本地过滤光」误判为 pixiv 设置未开（指错设置）。
 * - 报错分支同样要求服务端无数据：已渲染的列表不能被一次瞬时刷新错误替换为指引。
 * - 分页失败（列表仍保留）由 FeedList 的底部内联重试承担，不走整页指引。
 */
export function shouldShowR18Notice(input: {
  mode: RankModeId;
  hasError: boolean;
  paginationError: boolean;
  /** 服务端返回条目数（过滤前） */
  serverCount: number;
  loading: boolean;
}): boolean {
  if (!isR18Mode(input.mode)) return false;
  if (input.hasError && !input.paginationError && input.serverCount === 0) return true;
  return input.serverCount === 0 && !input.loading;
}

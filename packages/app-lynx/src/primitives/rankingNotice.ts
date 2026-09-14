import { RANK_MODES, type RankModeId } from "@pictelio/ranking-core"

/** 受限档位（需账号在 pixiv 网页端开启 R-18 浏览）：由核心目录派生，不在此重编码分类 */
export function isR18Mode(mode: RankModeId): boolean {
  return RANK_MODES.find((m) => m.id === mode)?.apiMode.includes("r18") ?? false
}

/**
 * 是否展示 R-18 可操作指引（spec §5.7）：档位为 R-18/R-18G 且首载报错或落定为空。
 * 本端不过滤受限条目（保留 + 遮罩），故 serverCount 即服务端返回数。
 * 加载中优先骨架（不显示指引）；报错分支亦要求已加载完成 + 无数据。
 * 分页失败保留列表，由底部重试承担。
 */
export function shouldShowR18Notice(input: {
  mode: RankModeId
  hasError: boolean
  /** 服务端返回条目数 */
  serverCount: number
  loading: boolean
}): boolean {
  if (!isR18Mode(input.mode)) return false
  if (input.loading) return false
  if (input.hasError && input.serverCount === 0) return true
  return input.serverCount === 0 && !input.loading
}

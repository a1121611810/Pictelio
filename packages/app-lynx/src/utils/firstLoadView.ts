// 页级首载三态判定（ADR-0150 / CONTEXT「页级首载骨架」「首载落定」）。
//
// 单一纯函数 seam：所有「首载数据来自网络」的页面 / 组件共用同一优先级规则，
// 不再各自拼 loading && items.length === 0。
//
// 为什么不能依赖 loading 标志：IFR（首屏直出）在后台线程启动前用组件初始状态
// 绘制首帧，骨架必须落在初始状态分支（未落定即骨架）。落定 = 该数据源首页
// 成功返回过（含 0 条），失败不算——见 CONTEXT「首载落定」。

export type FirstLoadView = 'content' | 'skeleton' | 'error' | 'empty'

export interface FirstLoadViewInput {
  /** 渲染流是否已有数据（页面快照值——刷新期间保留旧数据即靠快照，而非 primitive 实时值） */
  hasItems: boolean
  /** 首页请求是否在途（页面在发起刷新 / 重试前同步置真） */
  loading: boolean
  /** 该数据源是否已成功落定过一次（成功含 0 条；失败不算） */
  settled: boolean
  /** 是否已有错误文案 */
  hasError: boolean
}

export function deriveFirstLoadView(input: FirstLoadViewInput): FirstLoadView {
  if (input.hasItems) return 'content'
  if (input.loading) return 'skeleton'
  if (input.hasError) return 'error'
  if (!input.settled) return 'skeleton'
  return 'empty'
}

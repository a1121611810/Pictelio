// ─── Ugoira 诊断日志（T0-DIAG 临时通道，真机取证用；验证后移除） ───
// 背景：真机无法 adb 线连，播放器事件（换帧/@load/@error/流式批次）进环形缓冲，
// 经 PictelioApp.exportDiagLog（Java 预置通道）写盘 + 系统分享面板回传。
// 注意：
// - ADR-0115 曾移除 T0-DIAG 通道；本次经用户批准**临时**重建（真机取证），验证后移除。
// - **单实例前提**：headLines/buffer 为模块级可变状态，仅支持同一时刻一个播放器
//   实例（IllustDetail 单实例）；多实例同时挂载会相互清空/混写。
// - 仅原生模式记录（web-core 预览无闪烁问题且无导出出口，热路径零开销）。
// 纯模块无 Vue 依赖，机制可单测（环形上限/文本格式/重置/模式门控）。
export const UGOIRA_DIAG_MAX_LINES = 300

let headLines: string[] = []
let buffer: string[] = []
let mode: 'native' | 'web' = 'native'

/**
 * 初始化诊断上下文（每次播放器挂载调用一次）：头部信息 + 清空缓冲。
 * @param info illustId / 渲染模式 / 帧数（未加载完传 null）/ defer 绑定值 / ugoiraMode
 */
export function diagInit(info: {
  illustId: number
  mode: 'native' | 'web'
  totalFrames: number | null
  deferSrcInvalidation: boolean
  ugoiraMode: string
}): void {
  mode = info.mode
  headLines = [
    '## ugoira diag',
    `ts=${Date.now()}`,
    `illustId=${info.illustId}`,
    `mode=${info.mode}`,
    `totalFrames=${info.totalFrames ?? 'pending'}`,
    `defer-src-invalidation=${info.deferSrcInvalidation}`,
    `ugoiraMode=${info.ugoiraMode}`,
  ]
  buffer = []
}

/** 记录一条事件（环形缓冲；超限丢最旧）。detail 仅放原始数据，JSON 序列化后单行。
 *  仅原生模式生效（诊断目标 = 真机原生渲染；web 模式跳过，热路径零开销）。 */
export function diagLog(event: string, detail?: Record<string, unknown>): void {
  if (mode !== 'native') return
  const line = `[${Date.now()}] ${event}${detail ? ` ${JSON.stringify(detail)}` : ''}`
  buffer.push(line)
  if (buffer.length > UGOIRA_DIAG_MAX_LINES) {
    buffer.shift()
  }
}

/** 导出完整诊断文本（头部 + 事件缓冲，按时间序） */
export function diagText(): string {
  return headLines.concat(buffer).join('\n')
}

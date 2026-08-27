// ─── [T0-DIAG] 临时诊断通道（修复验证完成后整体删除本文件与所有引用） ───
// 背景：lynx JS console.log 不进 logcat（2026-08-29 模拟器实测，LynxLogService 仅桥
// 原生侧日志），诊断信息走「UI 横幅 + 历史导出」双通道：
//   - 横幅（App.vue 顶部渲染最近 6 条）用于模拟器截图即时观测
//   - 历史环形缓冲（t0History，带时间戳，最近 500 条）供「我的」页一键导出分享
//     （t0Export → PictelioApp.exportDiagLog → Android 分享面板，真机取证主通道）
// 同时保留 console.log（web-core 预览下可见，双通道）。
import { ref } from 'vue'

/** 最近 6 条诊断行（App.vue 横幅渲染） */
export const t0Lines = ref<string[]>([])

/** 历史环形缓冲上限（导出用） */
const MAX_HISTORY = 500

/** 带时间戳的历史诊断行（t0Export 导出） */
const t0History: string[] = []

let seq = 0

/** 追加一条诊断行（tag 建议 [mixfeed]/[recommended]/[novel]/[watchlist]/[router]） */
export function t0log(tag: string, msg: string): void {
  seq += 1
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  t0Lines.value = [...t0Lines.value.slice(-5), `#${seq}${tag} ${msg}`]
  t0History.push(`[${ts}]${tag} ${msg}`)
  if (t0History.length > MAX_HISTORY) t0History.splice(0, t0History.length - MAX_HISTORY)
  console.log(`[T0]${tag} ${msg}`)
}

/** 清空诊断行（阶段切换时调用） */
export function t0clear(): void {
  t0Lines.value = []
  t0History.length = 0
}

/** 是否已有可导出的诊断日志 */
export function t0HasLogs(): boolean {
  return seq > 0
}

/** 导出完整诊断日志文本（我的页「导出诊断日志」调用） */
export function t0Export(): string {
  const header = [
    'Pictelio app-lynx 诊断日志（T0-DIAG 临时通道）',
    `导出时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    `日志条目数: ${seq}（保留最近 ${MAX_HISTORY} 条）`,
    '',
  ].join('\n')
  return header + t0History.join('\n')
}

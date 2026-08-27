// ─── [T0-DIAG] 临时诊断通道（修复验证完成后整体删除本文件与所有引用） ───
// 背景：lynx JS console.log 不进 logcat（2026-08-29 模拟器实测，LynxLogService 仅桥
// 原生侧日志），诊断信息改走「UI 横幅 + 截图」取证——App.vue 顶部渲染最近 6 条。
// 同时保留 console.log（web-core 预览下可见，双通道）。
import { ref } from 'vue'

/** 最近 6 条诊断行（App.vue 横幅渲染） */
export const t0Lines = ref<string[]>([])

let seq = 0

/** 追加一条诊断行（tag 建议 [mixfeed]/[recommended]/[novel]/[watchlist]/[router]） */
export function t0log(tag: string, msg: string): void {
  seq += 1
  t0Lines.value = [...t0Lines.value.slice(-5), `#${seq}${tag} ${msg}`]
  console.log(`[T0]${tag} ${msg}`)
}

/** 清空诊断行（阶段切换时调用） */
export function t0clear(): void {
  t0Lines.value = []
}

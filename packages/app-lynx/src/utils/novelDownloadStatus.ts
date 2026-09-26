// ─── 小说下载状态派生（spec docs/specs/app-lynx-novel-intro-action-row.md §3.3 / §4 US4）───
// 纯函数：判定某小说是否至少成功导出一次。
// 数据来源：downloadQueueCore 中 kind='novel' && illustId === targetId && status='completed' 至少一条。
// 纯本地状态、无独立持久层；进入 App / 重启 / 清空下载队列后归零。
import type { QueueState } from './downloadQueueCore'

/**
 * 判定某小说是否至少已被成功导出（下载）一次。
 *
 * @param state 下载队列状态（来自 downloadStore.downloadState）
 * @param novelId 小说 id
 * @returns true = 至少一次成功导出；false = 从未成功或不在 novel 任务里
 */
export function isNovelDownloaded(state: QueueState, novelId: number): boolean {
  return state.tasks.some(
    (t) => t.kind === 'novel' && t.illustId === novelId && t.status === 'completed',
  )
}
import { ref } from 'vue'

/**
 * 追更切换状态机（issue #225 / spec app-lynx-novel-series-watchlist §US7）。
 *
 * 镜像 createBookmarkToggle 的 seam 形态（deps 注入 + busy 锁 + error 槽），
 * 差异：无动画延迟（列表取消追更无 delight 动效），onChange 在 API 成功后即触发。
 *
 * 语义：
 * - 乐观触发：toggle() 同步翻转 added 后才发 API；失败静息回滚 + errorMsg + warn
 * - busy 锁：API pending 期间重复 toggle 忽略（防连点并发提交）
 * - 失败不静默：errorMsg 置「操作失败」并 console.warn 带模块前缀
 *
 * 设计为可 node 单测的内部 seam，组件只读状态并调 toggle()。
 */

export interface WatchlistToggleDeps {
  add: (seriesId: number) => Promise<void>
  remove: (seriesId: number) => Promise<void>
  /** API 成功后回调（列表页据此移除条目并写 watchlistStore） */
  onChange?: (added: boolean) => void
}

export interface WatchlistToggleState {
  readonly added: boolean
  readonly busy: boolean
  readonly errorMsg: string
  toggle(): Promise<void>
}

export function createWatchlistToggle(
  seriesId: number,
  initialAdded: boolean,
  deps: WatchlistToggleDeps,
): WatchlistToggleState {
  const added = ref(initialAdded)
  const busy = ref(false)
  const errorMsg = ref('')

  async function toggle(): Promise<void> {
    if (busy.value) return
    busy.value = true
    errorMsg.value = ''
    const target = !added.value
    added.value = target
    try {
      if (target) {
        await deps.add(seriesId)
      } else {
        await deps.remove(seriesId)
      }
      deps.onChange?.(target)
    } catch (err) {
      // 失败静息回滚 + 错误槽；不静默降级（AGENTS.md 测试硬约束 §3）
      added.value = !target
      errorMsg.value = '操作失败'
      console.warn('[createWatchlistToggle] 追更切换失败', err)
    } finally {
      busy.value = false
    }
  }

  return {
    get added() {
      return added.value
    },
    get busy() {
      return busy.value
    },
    get errorMsg() {
      return errorMsg.value
    },
    toggle,
  }
}

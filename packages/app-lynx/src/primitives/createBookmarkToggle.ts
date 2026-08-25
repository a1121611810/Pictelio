import { ref } from 'vue'

/**
 * 收藏切换状态机（ADR-0112）。
 *
 * 语义：
 * - 乐观触发：toggle() 同步翻转 bookmarked/count 后**才**发 API（delight 动效依赖即时反馈，
 *   悲观等待会被网络延迟废掉）；失败静息回滚 + errorMsg（不播反向动画，由组件层保证）
 * - busy 锁：API pending 期间重复 toggle 忽略（防连点并发提交）
 * - change 回调延迟到动画播完（BOOKMARK_ANIMATION_MS）后触发——「动画完成态」，
 *   Bookmarks 页据此移除条目不被动画截断；无 animationend（ADR-0111），
 *   setTimeout 仅做事件延迟，不驱动动画帧
 *
 * 设计为可 node 单测的内部 seam（同 createFabMenu 风格），组件只读状态并调 toggle()。
 */

/** 收藏动画总时长（双向最长 = 收藏侧环扩散 350ms）：change 延迟与特效节点清理共用 */
export const BOOKMARK_ANIMATION_MS = 350

export interface BookmarkToggleDeps {
  add: (illustId: number) => Promise<void>
  remove: (illustId: number) => Promise<void>
  /** 动画播完后回调（组件的 change 事件上抛点） */
  onChange?: (bookmarked: boolean) => void
}

export interface BookmarkToggleState {
  readonly bookmarked: boolean
  readonly count: number
  readonly busy: boolean
  readonly errorMsg: string
  toggle(): Promise<void>
}

export function createBookmarkToggle(
  illustId: number,
  initialBookmarked: boolean,
  initialCount: number,
  deps: BookmarkToggleDeps,
): BookmarkToggleState {
  const bookmarked = ref(initialBookmarked)
  const count = ref(Math.max(0, initialCount))
  const busy = ref(false)
  const errorMsg = ref('')

  async function toggle(): Promise<void> {
    if (busy.value) return
    busy.value = true
    errorMsg.value = ''
    // 乐观：立即翻转（ADR-0112 决策 3）
    const target = !bookmarked.value
    bookmarked.value = target
    count.value = Math.max(0, count.value + (target ? 1 : -1))
    try {
      if (target) {
        await deps.add(illustId)
      } else {
        await deps.remove(illustId)
      }
      // 动画播完才上抛（ADR-0112 决策 4）
      setTimeout(() => deps.onChange?.(target), BOOKMARK_ANIMATION_MS)
    } catch {
      // 失败静息回滚（状态直接复位，不触发反向动画）+ 既有错误槽提示
      bookmarked.value = !target
      count.value = Math.max(0, count.value + (target ? -1 : 1))
      errorMsg.value = '操作失败'
    } finally {
      busy.value = false
    }
  }

  return {
    get bookmarked() {
      return bookmarked.value
    },
    get count() {
      return count.value
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

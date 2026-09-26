// ─── 追更直击切换 composable（spec #734 §4 US2）───
//
// 介绍页追更按钮交互：点击 = 立即追更/取消追更，无二次确认（spec D4 直击切换）。
// 乐观触发 + 静息回滚 + 跨入口状态共享（通过 watchlistStore.setWatchState）。
//
// 不变量（来自 useBookmarkMutation 范式，6 条全保留——与收藏范式 1:1 对齐）：
//   1. 乐观翻转（toggle 同步翻转 added 后才发 API）
//   2. busy 锁（API pending 期间重复 toggle no-op）
//   3. 失败静息回滚 + errorMsg + console.warn('[useNovelWatchlistToggle]')（禁静默降级）
//   4. 350ms 后 onChange 回调（动画完成态）
//   5. 再次触发前 errorMsg 清空
//   6. 跨入口状态共享：成功调 watchlistStore.setWatchState（createWatchlistPrompt 通过
//      getWatchState 同步读取，正文页 prompt.watchAdded 自动跟随）
//
// 与 useBookmarkMutation 的差异（范式对齐 + 简化）：
//   - 无 count 字段（追更是系列级二元状态，无计数概念）
//   - 无 saveWith 变体（追更面板语义不存在——介绍页只 toggle）
//   - mutationKey 省略（追更无 query 失效场景，详 spec US2 末注；如需可走文件内部局部 const）
//   - errorMsg i18n key（useNovelWatchlistToggle.actionFailed）已注册到 zh-CN/en 字典
//     （spec #734 T5c）。'...' as I18nKey 强转保留以对齐 apiErrorMessage 既有强转范式。
import { ref, type Ref } from 'vue'
import { useMutation } from '@tanstack/vue-query'
import { t, type I18nKey } from '../i18n'
import { addNovelWatchlist, deleteNovelWatchlist } from '../api/novel'
import { toSeriesId } from '../api/id'
import { setWatchState } from '../stores/watchlistStore'

/** 追更动画总时长（与收藏一致，沿用 BOOKMARK_ANIMATION_MS 范式） */
export const WATCHLIST_ANIMATION_MS = 350

/** 错误文案 i18n key（模块内部局部 const，避免污染 queryKeys；T5 补 zh-CN/en 时再合并到 Dict） */
const ACTION_FAILED_KEY = 'useNovelWatchlistToggle.actionFailed' as I18nKey

export interface UseNovelWatchlistToggleOptions {
  /** 系列 id（SeriesId 是 branded number，外部传 number 即可，内部经 toSeriesId 转 branded） */
  seriesId: number
  /** 初始追更状态（来自父组件 prop；首次加载快照） */
  initialAdded: boolean
  /** 可选：动画完成后回调，参数为目标态（true=追更 / false=取消） */
  onChange?: (added: boolean) => void
}

export interface UseNovelWatchlistToggleReturn {
  readonly added: Ref<boolean>
  readonly busy: Ref<boolean>
  readonly errorMsg: Ref<string>
  /** 触发 toggle：乐观翻转 + 调 API；busy 中 no-op */
  toggle(): Promise<void>
}

export function useNovelWatchlistToggle(
  options: UseNovelWatchlistToggleOptions,
): UseNovelWatchlistToggleReturn {
  const { seriesId, initialAdded, onChange } = options

  const added = ref(initialAdded)
  const busy = ref(false)
  const errorMsg = ref('')

  const mutation = useMutation<void, Error, boolean>({
    mutationFn: async (target: boolean) => {
      if (target) {
        await addNovelWatchlist(toSeriesId(seriesId))
        return
      }
      await deleteNovelWatchlist(toSeriesId(seriesId))
    },
  })

  async function toggle(): Promise<void> {
    if (busy.value) return // 不变量 2：busy 锁
    busy.value = true
    errorMsg.value = '' // 不变量 5：再次触发前清空
    const target = !added.value
    added.value = target // 不变量 1：乐观翻转（同步，未等 API 结算）
    try {
      await mutation.mutateAsync(target)
      // 不变量 6：跨入口状态共享——createWatchlistPrompt 通过 getWatchState 同步
      setWatchState(seriesId, target)
      // 不变量 4：350ms 后上抛 onChange（动画完成态）
      setTimeout(() => onChange?.(target), WATCHLIST_ANIMATION_MS)
    } catch (e) {
      // 不变量 3：失败静息回滚 + 显式 warn（禁静默降级，测试硬约束 #3）
      console.warn('[useNovelWatchlistToggle] toggle failed', e)
      added.value = !target
      errorMsg.value = t(ACTION_FAILED_KEY)
    } finally {
      busy.value = false
    }
  }

  return { added, busy, errorMsg, toggle }
}
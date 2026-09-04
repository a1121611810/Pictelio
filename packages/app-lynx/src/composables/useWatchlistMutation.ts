// ─── useWatchlistMutation composable（spec app-lynx-novel-series-watchlist §US7 / T4）───
//
// 替代 createWatchlistToggle primitive：
// - 镜像 createBookmarkToggle 的 seam 形态（deps 注入 + busy 锁 + error 槽）
// - 差异：无 350ms 动画延迟（追更无 delight 动效，spec §US7），onChange 在 API
//   成功时立即触发
// - 内部 API 调用从 deps.add/remove 升级为 useMutation
// - 失败不静默：errorMsg 置「操作失败」并 console.warn（AGENTS.md 测试硬约束 §3）

import { ref, type Ref } from 'vue'
import { useMutation } from '@tanstack/vue-query'
import { apiClient } from '../api/client'
import { mutationKeys } from '../api/queryKeys'

export interface UseWatchlistMutationOptions {
  seriesId: number
  initialAdded: boolean
  /** 可选：API 成功时立即回调（追更无动画），参数为目标态（true=追更 / false=取消追更） */
  onChange?: (added: boolean) => void
}

export interface UseWatchlistMutationReturn {
  readonly added: Ref<boolean>
  readonly busy: Ref<boolean>
  readonly errorMsg: Ref<string>
  toggle(): Promise<void>
}

export function useWatchlistMutation(
  options: UseWatchlistMutationOptions,
): UseWatchlistMutationReturn {
  const { seriesId, initialAdded, onChange } = options

  const added = ref(initialAdded)
  const busy = ref(false)
  const errorMsg = ref('')

  const mutation = useMutation<void, Error, boolean>({
    mutationKey: mutationKeys.novelWatchlist(),
    mutationFn: async (target: boolean) => {
      const path = target
        ? '/v1/watchlist/novel/add'
        : '/v1/watchlist/novel/delete'
      await apiClient.post(path, { series_id: String(seriesId) })
    },
  })

  async function toggle(): Promise<void> {
    if (busy.value) return
    busy.value = true
    errorMsg.value = ''
    const target = !added.value
    added.value = target
    try {
      await mutation.mutateAsync(target)
      // 追更无动画：API 成功立即上抛
      onChange?.(target)
    } catch (err) {
      added.value = !target
      errorMsg.value = '操作失败'
      // 失败不静默（AGENTS.md 测试硬约束 §3）
      console.warn('[useWatchlistMutation] 追更切换失败', err)
    } finally {
      busy.value = false
    }
  }

  return { added, busy, errorMsg, toggle }
}
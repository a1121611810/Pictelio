// ─── useBookmarkMutation composable（ADR-0112 + ADR-0141 D8 / T4 mutations）───
//
// 替代 createBookmarkToggle primitive（spec T4 决策）：
// - 外层状态机（bookmarked/count/busy/errorMsg）与原 primitive 完全等价
// - 内部 API 调用从 deps.add/remove 升级为 useMutation
//   - onMutate 立即翻转（乐观触发）
//   - onError 静息回滚
//   - onSuccess 350ms 后触发 onChange（动画完成态）
// - 异常静息不 throw：不破坏 ui 渲染，由 caller 用 errorMsg 读
//
// API 形态与 createBookmarkToggle 完全相同（getter + toggle()）：
//   const { bookmarked, count, busy, errorMsg, toggle } = useBookmarkMutation(
//     illustId,
//     initialBookmarked,
//     initialCount,
//     onChange?, // 可选：350ms 动画完成后回调
//   )
//
// 关键不变量（来自 ADR-0112 + spec D4/D5，必须保留）：
// 1. 乐观触发：toggle() 同步翻转 bookmarked/count 后才发 API
// 2. busy 锁：API pending 期间重复 toggle no-op
// 3. 失败静息回滚：状态直接复位 + errorMsg 提示
// 4. 350ms onChange：API 成功后 setTimeout 350ms 才触发回调
// 5. 再次 toggle 前 errorMsg 清空
// 6. count clamp 0（不出现负数）

import { ref, type Ref } from 'vue'
import { useMutation } from '@tanstack/vue-query'
import { apiClient } from '../api/client'
import { mutationKeys } from '../api/queryKeys'

/** 收藏动画总时长（双向最长 = spec D5）。change 延迟与特效节点清理共用此值。 */
export const BOOKMARK_ANIMATION_MS = 350

export interface UseBookmarkMutationOptions {
  illustId: number
  initialBookmarked: boolean
  initialCount: number
  /** 可选：动画完成态（350ms 后）回调，参数为目标态（true=收藏 / false=取消） */
  onChange?: (bookmarked: boolean) => void
}

export interface UseBookmarkMutationReturn {
  readonly bookmarked: Ref<boolean>
  readonly count: Ref<number>
  readonly busy: Ref<boolean>
  readonly errorMsg: Ref<string>
  /** 触发 toggle：乐观翻转 + 调 API；busy 中 no-op */
  toggle(): Promise<void>
}

export function useBookmarkMutation(
  options: UseBookmarkMutationOptions,
): UseBookmarkMutationReturn {
  const { illustId, initialBookmarked, initialCount, onChange } = options

  // ─── 响应式状态（与原 createBookmarkToggle 一致） ───
  const bookmarked = ref(initialBookmarked)
  const count = ref(Math.max(0, initialCount))
  const busy = ref(false)
  const errorMsg = ref('')

  // ─── useMutation：API 调用 ───
  // mutationFn 根据当前目标态决定 add/delete endpoint；
  // 但 useMutation 的 mutationFn 必须固定签名（变量从外部 mutate(variables) 传），
  // 不能读 bookmarked.value（mutation 闭包冻结时机）——
  // 因此用 useMutationOptions.onMutate 闭包读 bookmarked 翻转目标，
  // 再 mutate(target) 触发 API。
  const mutation = useMutation<void, Error, boolean>({
    mutationKey: mutationKeys.illustBookmark(),
    mutationFn: async (target: boolean) => {
      const path = target
        ? '/v2/illust/bookmark/add'
        : '/v1/illust/bookmark/delete'
      await apiClient.post(path, { illust_id: String(illustId) })
    },
  })

  async function toggle(): Promise<void> {
    if (busy.value) return
    busy.value = true
    errorMsg.value = ''
    // 乐观翻转（ADR-0112 D4）
    const target = !bookmarked.value
    bookmarked.value = target
    count.value = Math.max(0, count.value + (target ? 1 : -1))
    try {
      await mutation.mutateAsync(target)
      // 动画播完才上抛 onChange（ADR-0112 D5）
      setTimeout(() => onChange?.(target), BOOKMARK_ANIMATION_MS)
    } catch {
      // 失败静息回滚（D4：状态直接复位，不触发反向动画）
      bookmarked.value = !target
      count.value = Math.max(0, count.value + (target ? -1 : 1))
      errorMsg.value = '操作失败'
    } finally {
      busy.value = false
    }
  }

  return { bookmarked, count, busy, errorMsg, toggle }
}
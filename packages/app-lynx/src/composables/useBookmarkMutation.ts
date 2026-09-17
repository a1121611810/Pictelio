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
// T4 收藏面板扩展（spec docs/specs/bookmark-tags.md D5/D6/D9 + ADR-0160 D2/D6）：
// 新增 saveWith(restrict, tags) 面板保存变体——恒为「收藏/覆盖」方向（面板没有
// 取消收藏语义），携带可见性 + 收藏标签经 addBookmark 覆盖式保存（spec D2：
// 对已收藏作品重发 add 即整体覆盖，不先 delete）。六条不变量同样约束 saveWith，
// 差异仅在乐观方向：bookmarked 恒置 true；count 仅原态未收藏时 +1（覆盖式编辑
// 不改变收藏数）。快速收藏路径 toggle() 签名不变，行为差异仅在显式发送 restrict="public"
// （spec D3 恒公开；此前省略依赖服务端默认值，仓库内无 oracle）。
//
// 关键不变量（来自 ADR-0112 + spec D4/D5，必须保留，toggle 与 saveWith 共享）：
// 1. 乐观触发：toggle() 同步翻转 bookmarked/count 后才发 API
//    （saveWith 恒置 bookmarked=true，count 仅原态未收藏时 +1）
// 2. busy 锁：API pending 期间重复 toggle / saveWith no-op（同一把锁，互斥）
// 3. 失败静息回滚：状态直接复位 + errorMsg 提示 + saveWith 返回 false
// 4. 350ms onChange：API 成功后 setTimeout 350ms 才触发回调
// 5. 再次触发前 errorMsg 清空
// 6. count clamp 0（不出现负数）
//
// 快速收藏可见性（spec D3「恒公开」）：toggle 的 add 分支**显式**发送 restrict="public"
// （经 addBookmark(illustId, 'public')）——省略 restrict 时的服务端默认值在仓库内无 oracle，
// 显式传入使「恒公开」成为可断言的线上事实；同时不带收藏标签（零决策）。
//
// 显式成败通道（FIX-2）：saveWith 返回 Promise<boolean>（true=成功 / false=失败静息回滚；
// busy no-op 非成功、保守返回 false），面板据返回值判定成败，errorMsg 仅用于文案渲染。

import { ref, type Ref } from 'vue'
import { useMutation } from '@tanstack/vue-query'
import { t } from '../i18n'
import { apiClient } from '../api/client'
import { addBookmark } from '../api/illust'
import { addNovelBookmark, deleteNovelBookmark } from '../api/novel'
import type { RestrictType } from '../api/types'
import { mutationKeys } from '../api/queryKeys'

/** 收藏动画总时长（双向最长 = spec D5）。change 延迟与特效节点清理共用此值。 */
export const BOOKMARK_ANIMATION_MS = 350

export interface UseBookmarkMutationOptions {
  illustId: number
  initialBookmarked: boolean
  initialCount: number
  /** 可选：动画完成态（350ms 后）回调，参数为目标态（true=收藏 / false=取消） */
  onChange?: (bookmarked: boolean) => void
  /**
   * 收藏目标类型（spec #585 / 票 #587）：'illust'（默认，现状）| 'novel'（小说介绍页）。
   * 小说端点无 tags 载荷（Pixiv 端点差异，oracle=webview api/novel.ts addBookmark）——
   * novel 形态下 saveWith 的 tags 无法上送，将显式 warn 后按 restrict 保存（禁静默丢载荷）。
   */
  targetKind?: 'illust' | 'novel'
}

export interface UseBookmarkMutationReturn {
  readonly bookmarked: Ref<boolean>
  readonly count: Ref<number>
  readonly busy: Ref<boolean>
  readonly errorMsg: Ref<string>
  /** 触发 toggle：乐观翻转 + 调 API；busy 中 no-op。恒公开（显式 restrict=public）、无 tags（spec D3 快速收藏） */
  toggle(): Promise<void>
  /**
   * 面板保存变体（spec D5/D6 + ADR-0160 D2，T4 #533）：恒为「收藏/覆盖」方向，
   * 携带可见性 + 收藏标签覆盖式保存；busy 中 no-op（与 toggle 互斥）。
   * 成功 350ms 后 onChange(true) 并返回 true；失败静息回滚到保存前原态 + errorMsg 并
   * 返回 false；busy no-op 非成功，同样返回 false。调用方据返回值判定成败（FIX-2）。
   */
  saveWith(restrict: RestrictType, tags: string[]): Promise<boolean>
}

/** mutation variables（「mutationFn 固定签名、变量从 mutate(variables) 传参」既有模式）：
 * toggle 形态传目标态；saveWith 形态传 restrict + tags 载荷（按调用形态分派）。 */
type BookmarkMutationVars =
  | { kind: 'toggle'; target: boolean }
  | { kind: 'save'; restrict: RestrictType; tags: string[] }

export function useBookmarkMutation(
  options: UseBookmarkMutationOptions,
): UseBookmarkMutationReturn {
  const { illustId, initialBookmarked, initialCount, onChange, targetKind = 'illust' } = options
  const isNovel = targetKind === 'novel'

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
  const mutation = useMutation<void, Error, BookmarkMutationVars>({
    mutationKey: isNovel ? mutationKeys.novelBookmark() : mutationKeys.illustBookmark(),
    mutationFn: async (vars: BookmarkMutationVars) => {
      if (vars.kind === 'save') {
        if (isNovel) {
          // 小说收藏端点无 tags 载荷（Pixiv 端点差异）——面板路径当前无小说宿主；
          // 万一被调用，显式 warn 后按 restrict 保存（禁静默丢载荷，测试硬约束 3）
          console.warn('[useBookmarkMutation] novel saveWith 不支持 tags，按 restrict 保存', vars.tags)
          await addNovelBookmark(illustId, vars.restrict)
          return
        }
        // 面板保存恒为「收藏/覆盖」方向（spec D5/D6 + ADR-0160 D2 覆盖式编辑）：
        // 经 T3 addBookmark 序列化 restrict + tags（空格 join 单值、tags[] 字段名）。
        await addBookmark(illustId, vars.restrict, vars.tags)
        return
      }
      if (vars.target) {
        // 快速收藏恒公开（spec D3）：显式 restrict=public + 无 tags（零决策）；
        // 经 addBookmark 单点序列化，避免此处再手拼 payload（FIX-1）
        if (isNovel) {
          await addNovelBookmark(illustId, 'public')
          return
        }
        await addBookmark(illustId, 'public')
        return
      }
      if (isNovel) {
        await deleteNovelBookmark(illustId)
        return
      }
      await apiClient.post('/v1/illust/bookmark/delete', { illust_id: String(illustId) })
    },
  })

  async function toggle(): Promise<void> {
    if (busy.value) return
    busy.value = true
    errorMsg.value = ''
    // 乐观翻转（不变量 1，ADR-0112 D4）
    const target = !bookmarked.value
    bookmarked.value = target
    count.value = Math.max(0, count.value + (target ? 1 : -1))
    try {
      await mutation.mutateAsync({ kind: 'toggle', target })
      // 动画播完才上抛 onChange（不变量 4，ADR-0112 D5）
      setTimeout(() => onChange?.(target), BOOKMARK_ANIMATION_MS)
    } catch (e) {
      // 测试硬约束 #3：禁止静默降级 — 失败必 console.warn 带模块前缀
      console.warn('[useBookmarkMutation] toggle failed', e)
      // 失败静息回滚（不变量 3，D4：状态直接复位，不触发反向动画）
      bookmarked.value = !target
      count.value = Math.max(0, count.value + (target ? -1 : 1))
      errorMsg.value = t('useBookmarkMutation.actionFailed') // i18n: 赋值时快照（瞬态）
    } finally {
      busy.value = false
    }
  }

  /**
   * 面板保存变体（spec D5/D6/D9 + ADR-0160 D2/D6，T4 #533）：面板没有取消收藏
   * 语义，恒为「收藏/覆盖」方向——对已收藏作品重发 add 即整体覆盖（spec D2，
   * 不先 delete）。六条不变量与 toggle 共享：busy 锁互斥（不变量 2）、调用前
   * errorMsg 清空（不变量 5）、乐观置位仅原态未收藏时 count+1（覆盖式编辑不
   * 改变收藏数）、失败静息回滚到保存前原态（不变量 3 + count clamp 0 不变量 6）、
   * 成功 350ms 后 onChange(true)（不变量 4）。
   * 返回值：true=成功；false=失败静息回滚（或 busy no-op）——显式成败通道，调用方
   * 不再依赖 errorMsg 文案推断（FIX-2）。
   */
  async function saveWith(restrict: RestrictType, tags: string[]): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    errorMsg.value = ''
    // 乐观置位（不变量 1 的 saveWith 方向）：bookmarked 恒置 true；
    // count 仅原态未收藏时 +1（覆盖式编辑不改变收藏数，spec D2）
    const wasBookmarked = bookmarked.value
    bookmarked.value = true
    if (!wasBookmarked) count.value = count.value + 1
    try {
      await mutation.mutateAsync({ kind: 'save', restrict, tags })
      // 动画播完才上抛 onChange（不变量 4；保存目标恒为 true）
      setTimeout(() => onChange?.(true), BOOKMARK_ANIMATION_MS)
      return true
    } catch (e) {
      // 测试硬约束 #3：禁止静默降级 — 失败必 console.warn 带模块前缀
      console.warn('[useBookmarkMutation] saveWith failed', e)
      // 失败静息回滚（不变量 3）：复位到保存前原态；count clamp 0（不变量 6）
      bookmarked.value = wasBookmarked
      if (!wasBookmarked) count.value = Math.max(0, count.value - 1)
      errorMsg.value = t('useBookmarkMutation.actionFailed') // i18n: 赋值时快照（瞬态）
      return false
    } finally {
      busy.value = false
    }
  }

  return { bookmarked, count, busy, errorMsg, toggle, saveWith }
}

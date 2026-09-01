// ─── 搜索弹层开合（app-lynx 全局搜索，spec D4 / issue #293 T3） ───
// 全局单例（glossary「弹层全局单例」）：SearchSheet 只在 App.vue 挂载一份
// （v-if="isOpen"），开合经本 store 控制——各入口（FAB / 放射内环项）都
// 打开同一个弹层，各页面不各自 v-if（区别于 CommentOverlay 的页面内 v-if）。
// 返回键联动（ADR-0066 扩展）：open 时 registerModal(closeSearch)（后进先出，
// 弹层优先于页面返回），close 时调用注销函数（registerModal 的返回值必须
// 保存并在关闭时调用）。重复 open 幂等：单例共用同一关闭回调，不重复入栈。
import { ref } from "vue"
import { registerModal } from "./modalStack"

const _isOpen = ref(false)

export const isOpen = _isOpen

/** registerModal 返回的注销函数：打开时保存，关闭时调用并置空 */
let unregisterModal: (() => void) | null = null

/**
 * 打开搜索弹层（幂等：已打开时不重复注册）。
 * 输入框聚焦 / loadHistory 由 SearchSheet 组件负责（store 不做，见 spec D4）。
 */
export function openSearch(): void {
  if (_isOpen.value) return
  _isOpen.value = true
  unregisterModal = registerModal(closeSearch)
}

/**
 * 关闭搜索弹层（幂等：已关闭时 no-op）。
 * 所有关闭路径收敛于此：遮罩 @tap / 面板 × / 点结果行跳详情 /
 * 返回键（modalStack 回调，closeTopModal 弹出后调用）。
 */
export function closeSearch(): void {
  _isOpen.value = false
  unregisterModal?.()
  unregisterModal = null
}

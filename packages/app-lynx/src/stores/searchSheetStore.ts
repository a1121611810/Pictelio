// ─── 搜索弹层开合（app-lynx 全局搜索，spec D4 / issue #293 T3） ───
// 全局单例（glossary「弹层全局单例」）：SearchSheet 只在 App.vue 挂载一份
// （v-if="isOpen"），开合经本 store 控制——各入口（FAB / 放射内环项）都
// 打开同一个弹层，各页面不各自 v-if（区别于 CommentOverlay 的页面内 v-if）。
// 返回键联动（ADR-0066 扩展）：open 时 registerModal(closeSearch)（后进先出，
// 弹层优先于页面返回），close 时调用注销函数（registerModal 的返回值必须
// 保存并在关闭时调用）。重复 open 幂等：单例共用同一关闭回调，不重复入栈。
// Pinia 化（ADR-0139 / spec #337）：setup store——state/actions 移入 defineStore
// 闭包，逻辑逐字不变（纯重构约束）。注销句柄 unregisterModal 非响应式状态，
// 保持模块级（per-spec，setup 内 action 仍引用此模块级 let）。
import { ref } from "vue"
import { defineStore } from "pinia"
import { useModalStack } from "./modalStack"

export const useSearchSheetStore = defineStore("searchSheet", () => {
  const _isOpen = ref(false)
  const _prefillKeyword = ref("")

  /**
   * 打开搜索弹层（幂等：已打开时不重复注册）。
   * initialKeyword 传入时写入预填词（搜索弹层挂载后消费）；无参 = 普通打开（FAB 入口，行为不变）。
   */
  function openSearch(initialKeyword?: string): void {
    if (_isOpen.value) return
    if (initialKeyword !== undefined) {
      _prefillKeyword.value = initialKeyword
    }
    _isOpen.value = true
    unregisterModal = useModalStack().registerModal(closeSearch)
  }

  /**
   * 关闭搜索弹层（幂等：已关闭时 no-op）。
   * 所有关闭路径收敛于此：遮罩 @tap / 面板 × / 点结果行跳详情 /
   * 返回键（modalStack 回调，closeTopModal 弹出后调用）。
   */
  function closeSearch(): void {
    _isOpen.value = false
    _prefillKeyword.value = ""
    unregisterModal?.()
    unregisterModal = null
  }

  /** 读取并清空预填词（SearchSheet 挂载时消费；为空 = 无预填） */
  function consumePrefillKeyword(): string {
    const word = _prefillKeyword.value
    _prefillKeyword.value = ""
    return word
  }

  return { isOpen: _isOpen, prefillKeyword: _prefillKeyword, openSearch, closeSearch, consumePrefillKeyword }
})

// ─── 非响应式状态：注销句柄（per-spec，保留模块级）───
// registerModal 返回的注销函数：打开时保存，关闭时调用并置空。
// 不放进 setup 闭包——它是「最近一次 registerModal 的产物」，跨调用持有同一引用；
// setup 内每次 useSearchSheetStore() 是单例返回，模块级 let 与之等价（per-instance）。
let unregisterModal: (() => void) | null = null

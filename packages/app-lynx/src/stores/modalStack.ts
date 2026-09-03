// ─── 全局 modal 拦截注册表（app-lynx，issue #163 / spec #161） ───
// 返回键优先关弹层（ADR-0066 扩展）：router.handleSystemBack 先查本注册表，
// 有打开的 modal 则调用其关闭回调并 return——不触发页面返回/退出提示。
// 弹层组件（如 CommentOverlay）挂载时 registerModal(关闭回调)，卸载/关闭时注销。
// Pinia 化（ADR-0139 / spec #337）：setup store——state/actions 移入 defineStore
// 闭包，逻辑逐字不变（纯重构约束）；模块顶层导出同名包装函数保留给 router.ts 等
// 非组件上下文使用（语义完全等价于 useModalStack().xxx()）。
import { ref } from "vue"
import { defineStore } from "pinia"

type ModalClose = () => void

export const useModalStack = defineStore("modalStack", () => {
  /** 已打开 modal 的关闭回调栈（后进先出：后打开的先关，支持弹层叠弹层） */
  const _modalStack = ref<ModalClose[]>([])

  /** 注册一个已打开 modal 的关闭回调；返回注销函数（关闭回调执行 / 组件卸载时调用） */
  function registerModal(close: ModalClose): () => void {
    _modalStack.value.push(close)
    return () => {
      const idx = _modalStack.value.indexOf(close)
      if (idx !== -1) _modalStack.value.splice(idx, 1)
    }
  }

  /** 是否有打开的 modal */
  function hasOpenModal(): boolean {
    return _modalStack.value.length > 0
  }

  /** 关闭最上层 modal：弹出其关闭回调并调用（由 router.handleSystemBack 在返回键时触发） */
  function closeTopModal(): void {
    const close = _modalStack.value.pop()
    close?.()
  }

  return { registerModal, hasOpenModal, closeTopModal }
})

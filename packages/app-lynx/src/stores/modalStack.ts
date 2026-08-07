// ─── 全局 modal 拦截注册表（app-lynx，issue #163 / spec #161） ───
// 返回键优先关弹层（ADR-0066 扩展）：router.handleSystemBack 先查本注册表，
// 有打开的 modal 则调用其关闭回调并 return——不触发页面返回/退出提示。
// 弹层组件（如 CommentOverlay）挂载时 registerModal(关闭回调)，卸载/关闭时注销。
import { ref } from "vue"

type ModalClose = () => void

/** 已打开 modal 的关闭回调栈（后进先出：后打开的先关，支持弹层叠弹层） */
const modalStack = ref<ModalClose[]>([])

/** 注册一个已打开 modal 的关闭回调；返回注销函数（关闭回调执行 / 组件卸载时调用） */
export function registerModal(close: ModalClose): () => void {
  modalStack.value.push(close)
  return () => {
    const idx = modalStack.value.indexOf(close)
    if (idx !== -1) modalStack.value.splice(idx, 1)
  }
}

/** 是否有打开的 modal */
export function hasOpenModal(): boolean {
  return modalStack.value.length > 0
}

/** 关闭最上层 modal：弹出其关闭回调并调用（由 router.handleSystemBack 在返回键时触发） */
export function closeTopModal(): void {
  const close = modalStack.value.pop()
  close?.()
}

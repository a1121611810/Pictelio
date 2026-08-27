import { ref } from 'vue'

/**
 * RefreshableList FAB menu 扩展菜单项配置（T4，spec: app-lynx-feed-pagination-buttons §3.3）。
 * 页面通过 props 传入，组件只管渲染与菜单状态机，不感知业务。
 */
export interface FabMenuExtraItem {
  /** 唯一 key（v-for） */
  key: string
  /** 图标 unicode 符号（Lynx 无图标库约定） */
  icon: string
  /** label 文本 */
  label: string
  /** accessibility-label（菜单项 label 与 UI 文本一致；扩展项 label 由页面定，组件不硬编码） */
  accessibilityLabel: string
  /** 是否可见（页面按 hasPrev/hasNext 等响应式状态传入，每次渲染求值） */
  visible: () => boolean
  /** 点击回调；返回 Promise 时组件接管 busy（操作中禁展开/禁其他项） */
  onTap: () => Promise<void> | void
}

/**
 * FAB menu 纯逻辑状态机（ADR-0111）。
 *
 * 负责维护两个互斥维度：
 * - open：菜单是否展开
 * - busy：刷新是否进行中（刷新中禁止展开）
 *
 * 所有状态转移都通过本状态机，组件模板只读 open/busy 并调用动作函数。
 * 设计为可 node 单测的内部 seam。
 */
export interface FabMenuState {
  readonly isOpen: boolean
  readonly isBusy: boolean
  /** 点 FAB：在 open/close 之间切换；busy 时忽略 */
  toggle(): void
  /** 显式展开；busy 时忽略 */
  open(): void
  /** 显式收起 */
  close(): void
  /** 开始刷新：收起菜单 + busy=true */
  startRefresh(): void
  /** 刷新结束：busy=false */
  endRefresh(): void
  /** 卸载/清理：归零 */
  reset(): void
}

export function createFabMenuState(): FabMenuState {
  const open = ref(false)
  const busy = ref(false)

  return {
    get isOpen() {
      return open.value
    },
    get isBusy() {
      return busy.value
    },
    toggle() {
      if (busy.value) return
      open.value = !open.value
    },
    open() {
      if (busy.value) return
      open.value = true
    },
    close() {
      open.value = false
    },
    startRefresh() {
      open.value = false
      busy.value = true
    },
    endRefresh() {
      busy.value = false
    },
    reset() {
      open.value = false
      busy.value = false
    },
  }
}

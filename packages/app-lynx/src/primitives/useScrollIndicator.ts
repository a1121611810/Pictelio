// ─── 列表滚动指示条状态原语（spec #319 / ticket #321 T2；公共层持有者 = RefreshableList，spec #325） ───
// RefreshableList（公共层，spec #325）把 <list> 的 @scroll 喂给 onScroll（scroll-event-throttle="0"，
// ~60Hz 派发），本原语负责：33ms 节流（~30Hz UI 更新）→ calcScrollIndicator（T1，几何纯函数）→
// 写 top/height refs → visible=true → 重置 500ms 淡出 timer。
// （页面零接线——指示条状态/渲染内收公共组件，页面经 scoped slot 消费 onScroll。）
//
// 契约（T1 → 本原语）：
// - calcScrollIndicator 返回 null = 无有效信号（scrollHeight<=0 / 缺失）：onScroll 直接 return，
//   不更新 top/height、不动可见性（避免闪烁）；null 也不消耗节流窗口（上游有值时立即恢复）。
// - 可见性只由「成功计算 → true」与「500ms hide timer → false」两个转移驱动；
//   dispose() 只清理 timer，不主动改 visible（组件卸载后无谓写 ref）。
// - onUnmounted 在 hook 内部注册（页面零清理负担）；dispose 仍暴露给手动清理/测试场景。
import { onUnmounted, ref } from "vue"
import type { Ref } from "vue"
import { calcScrollIndicator } from "./calcScrollIndicator"

/** 节流窗口（ms）：~60Hz 滚动事件 → ~30Hz UI 更新（spec §Implementation Decisions） */
export const THROTTLE_MS = 33
/** 滚动停止后淡出延迟（ms） */
export const HIDE_DELAY_MS = 500

export interface ScrollIndicatorState {
  topPx: Ref<number>
  heightPx: Ref<number>
  visible: Ref<boolean>
  /** 处理 list 的 @scroll 事件（payload 形状与 calcScrollIndicator 一致） */
  onScroll: (e: {
    detail?: { scrollTop?: number; scrollHeight?: number; listHeight?: number }
  }) => void
  /** 清理 500ms 定时器（onUnmounted 调用） */
  dispose: () => void
}

export function useScrollIndicator(): ScrollIndicatorState {
  const topPx = ref(0)
  const heightPx = ref(0)
  const visible = ref(false)

  let hideTimer: ReturnType<typeof setTimeout> | null = null
  /** 上次真正更新 refs 的时刻（ms）；-Infinity 保证首帧必更新（fake clock 从 0 起也成立） */
  let lastUpdateAt = Number.NEGATIVE_INFINITY

  function clearHideTimer(): void {
    if (hideTimer === null) return
    clearTimeout(hideTimer)
    hideTimer = null
  }

  function onScroll(e: {
    detail?: { scrollTop?: number; scrollHeight?: number; listHeight?: number }
  }): void {
    // 33ms 节流：距上次真正更新 < THROTTLE_MS → 直接 return（不更新 refs，不计算）
    const now = Date.now()
    if (now - lastUpdateAt < THROTTLE_MS) return

    // T1：无有效信号（scrollHeight<=0）→ return，状态与可见性均不动（避免闪烁）
    // （T1 参数为必传对象：e.detail 缺失时传 {}，字段缺失经 Number() 归一为 NaN → null，语义与 undefined 相同）
    const geo = calcScrollIndicator(e?.detail ?? {})
    if (geo === null) return

    topPx.value = geo.top
    heightPx.value = geo.height
    visible.value = true
    lastUpdateAt = now

    // 重置 500ms 淡出 timer（滚动中持续可见；timer 始终只有一个）
    clearHideTimer()
    hideTimer = setTimeout(() => {
      hideTimer = null
      visible.value = false
    }, HIDE_DELAY_MS)
  }

  function dispose(): void {
    clearHideTimer()
  }

  onUnmounted(dispose)

  return { topPx, heightPx, visible, onScroll, dispose }
}

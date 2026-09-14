// ─── 长按手势 composable（T5 / issue #534，spec docs/specs/bookmark-tags.md D3 + ADR-0160 D4）───
//
// 详情页心形的「双轨收藏」长按半轨：按住 500ms 唤出收藏面板（单击仍为快速收藏）。
// 口径与 webview 一致（packages/app/src/routes/IllustDetail.tsx onBookmarkPointerDown/Up）：
// 按下起计时，到点即触发（长按态，不等松手）；提前松手 = 快速动作（tap 路径，宿主自理）。
// 差异仅在事件源——原生 LynxView 无 pointer 事件，用 @touchstart/@touchmove/@touchend
// （CarouselSwiper 同款后台线程触摸通道，ADR-0115「T5 验证修订」）。
//
// 两条守卫：
// 1. 位移容差：触摸移动超容差（滚动/拖拽页面）即取消计时——防「按住后滑动」在 500ms 后误开面板。
// 2. 吞 tap：长按已触发时随后的 tap 必须被吞掉（consumeLongPress），否则会额外走一次快速收藏。
//
// 判定收敛在纯函数 isLongPressHeld（node 单测覆盖时长/位移边界，无需真实 DOM 手势）。

/** 长按判定时长（与 webview 500ms 口径一致） */
export const LONG_PRESS_MS = 500

/** 位移容差（px）：超过即判定为滚动手势，放弃长按 */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10

/** Lynx 触摸事件载荷（@touchstart / @touchmove 的 detail；仅取位移判定所需字段） */
export interface TouchLikeEvent {
  touches?: Array<{ clientX?: number; clientY?: number }>
}

/**
 * 长按判定（纯函数）：按住时长 ≥ durationMs 且累计位移 ≤ moveTolerancePx。
 * 时长与位移双条件——只有「按住够久且基本没动」才算长按。
 */
export function isLongPressHeld(
  elapsedMs: number,
  movedPx: number,
  durationMs: number = LONG_PRESS_MS,
  moveTolerancePx: number = LONG_PRESS_MOVE_TOLERANCE_PX,
): boolean {
  return elapsedMs >= durationMs && movedPx <= moveTolerancePx
}

export interface UseLongPressOptions {
  /** 长按成立时回调（宿主：打开收藏面板） */
  onTrigger: () => void
  /** 判定时长（默认 LONG_PRESS_MS；测试可调） */
  durationMs?: number
  /** 位移容差（默认 LONG_PRESS_MOVE_TOLERANCE_PX；测试可调） */
  moveTolerancePx?: number
}

export interface UseLongPressReturn {
  onTouchStart(e: TouchLikeEvent): void
  onTouchMove(e: TouchLikeEvent): void
  onTouchEnd(): void
  /** 读取并清除「长按已触发」标记：true = 本手势已按长按处理，随后的 tap 必须忽略 */
  consumeLongPress(): boolean
  /** 取消在途计时并复位标记（组件卸载） */
  cancel(): void
}

export function useLongPress(options: UseLongPressOptions): UseLongPressReturn {
  const durationMs = options.durationMs ?? LONG_PRESS_MS
  const moveTolerancePx = options.moveTolerancePx ?? LONG_PRESS_MOVE_TOLERANCE_PX

  let timer: ReturnType<typeof setTimeout> | null = null
  let startAt = 0
  let startX = 0
  let startY = 0
  let movedPx = 0
  /** 计时器在飞（触摸尚未被判为滚动/抬起） */
  let armed = false
  let fired = false

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function onTouchStart(e: TouchLikeEvent): void {
    clearTimer()
    const point = e.touches?.[0]
    startAt = Date.now()
    startX = point?.clientX ?? 0
    startY = point?.clientY ?? 0
    movedPx = 0
    armed = true
    fired = false
    timer = setTimeout(() => {
      timer = null
      armed = false
      // 到点判定走同一纯函数（真实时长：计时器到点即 elapsed ≥ durationMs）
      if (!isLongPressHeld(Date.now() - startAt, movedPx, durationMs, moveTolerancePx)) return
      fired = true
      options.onTrigger()
    }, durationMs)
  }

  function onTouchMove(e: TouchLikeEvent): void {
    if (!armed) return
    const point = e.touches?.[0]
    if (!point) return
    const dx = (point.clientX ?? startX) - startX
    const dy = (point.clientY ?? startY) - startY
    movedPx = Math.max(movedPx, Math.hypot(dx, dy))
    // 超容差 = 滚动手势，本次触摸不再可能是长按（到点判定也会被 isLongPressHeld 拒绝）
    if (movedPx > moveTolerancePx) {
      clearTimer()
      armed = false
    }
  }

  function onTouchEnd(): void {
    clearTimer()
    armed = false
  }

  function consumeLongPress(): boolean {
    const wasFired = fired
    fired = false
    return wasFired
  }

  function cancel(): void {
    clearTimer()
    armed = false
    fired = false
  }

  return { onTouchStart, onTouchMove, onTouchEnd, consumeLongPress, cancel }
}

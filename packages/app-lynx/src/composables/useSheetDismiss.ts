// ─── 弹层两段式进退场协议（issue #878；契约见 ADR-0211 决策 3 / 决策 4）───
//
// 本模块是**弹层可见性时序的唯一实现**：入场动画、退场动画、退场计时器、幂等守卫都在这里，
// 7 个弹层组件只做两件事——把 `panelStyle` / `scrimStyle` 绑到模板、把关闭请求接到 `requestClose()`。
// 组件内**禁止**出现时长 / 曲线 / 计时器字面量（唯一入口是 `composables/motion.ts`）。
//
// ── 为什么退场必须显式建模（决策 3 的硬约束）───
// Lynx **没有 `transitionend` 事件**（ADR-0111），所以「播完再卸载」无法用事件回调实现。
// 且本仓弹层是**卸载式显隐**（ADR-0123，宿主页 v-if 控制挂载）——卸载即消失，
// 不存在「已挂载但正在淡出」的中间态。⇒ 协议只能是：
//
//   关闭请求 → 摘入场动画、挂退场动画 → 启动计时器 → 到点才 emit('close')（宿主此刻才卸载）
//
// 计时器时长取 `exit()` 预设返回的 `holdMs`，它与退场动画**同一个对象、同一个 duration 档**
// （不是另抄一份数值）。`useReducedMotion` 的 R1 开启时该预设整体降级为 `none` / `holdMs = 0`
// ⇒ 关弹层不会卡住一段「动画已停但遮罩仍滞留」的空窗期。
//
// ── 已知代价（决策 3 已登记，不假装免费）───
// 退场窗口内弹层仍占位。本模块的 `exiting` 是给交互守卫用的（连点 / 返回键不再重复排队），
// 但**没有**动 `overflow` / 滚动锁定 —— 原生 Lynx 不识别 `pointer-events`，
// 靠 CSS 关不掉交互，只能靠各组件在 tap 入口处读 `exiting` 自行短路。
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { enter, exit, useMotion, type UseReducedMotionOptions } from './motion'

/** 弹层时序相位：`enter` 静止可见 / `exit` 退场动画播放中 / `gone` 已卸载 */
export type SheetPhase = 'enter' | 'exit' | 'gone'

/**
 * 四个动画名的登记表。
 * ⚠️ 与 `composables/motion.ts` 的约束 ① 同源：这些是 **`@keyframes` 名**（不是 Tailwind 类名），
 * 帧体在 `components/SheetShell.vue` 的 `<style>` 块里，全仓唯一。
 * 面板与遮罩必须**分开两对**：面板是位移（滑上 / 滑下），遮罩是淡入 / 淡出，
 * 复用同一条 keyframes 会让遮罩跟着位移。
 */
export interface SheetAnimationNames {
  /** 面板（或居中卡片）入场 */
  enter: string
  /** 面板（或居中卡片）退场 */
  exit: string
  /** 遮罩入场（纯 opacity） */
  scrimEnter: string
  /** 遮罩退场（纯 opacity） */
  scrimExit: string
}

/** 底部弹层（贴底面板）动画名 —— `components/SheetShell.vue` 定义帧体 */
export const SHEET_ANIMATION: SheetAnimationNames = {
  enter: 'sheet-enter',
  exit: 'sheet-exit',
  scrimEnter: 'sheet-scrim-enter',
  scrimExit: 'sheet-scrim-exit',
}

/**
 * 居中对话框动画名 —— 与底部弹层**分名**（几何不同：对话框入场是 scale + fade，不是上滑）。
 * 遮罩那对与弹层共用：遮罩就是一层淡入淡出，与宿主几何无关。
 */
export const DIALOG_ANIMATION: SheetAnimationNames = {
  enter: 'dialog-enter',
  exit: 'dialog-exit',
  scrimEnter: SHEET_ANIMATION.scrimEnter,
  scrimExit: SHEET_ANIMATION.scrimExit,
}

/** 绑 `:style` 的值形态（Lynx 侧唯一无歧义的通道，见 motion.ts 预设形态节） */
export type SheetMotionStyle = Record<string, string>

export interface UseSheetMotionOptions extends UseReducedMotionOptions {
  /** 动画名登记表（`SHEET_ANIMATION` / `DIALOG_ANIMATION`） */
  names: SheetAnimationNames
}

export interface SheetMotion {
  /** 减弱动效偏好（来自 useReducedMotion，R1/R2 降级已在预设里生效） */
  reduced: Ref<boolean>
  /** 面板/卡片动画：绑 `:style`，值恒为 `{ animation: <简写> }`；R1/R2 降级时为 `none` */
  panelStyle(phase: SheetPhase): SheetMotionStyle
  /** 遮罩动画：同上，几何与面板分离 */
  scrimStyle(phase: SheetPhase): SheetMotionStyle
}

/**
 * 只做「相位 → 动画样式」的映射，**不持有相位**。
 * 供壳组件使用（`BottomSheet.vue` / `SheetShell.vue`）：相位的所有权在调用方
 * （BottomSheet 由宿主页的 `v-if` + 父组件的 `motionPhase` prop 决定，组件不自管挂载）。
 */
export function useSheetMotion(options: UseSheetMotionOptions): SheetMotion {
  const { names } = options
  const motion = useMotion(options)
  const reduced = motion.reduced

  // 四个预设各自 computed：偏好可在运行中切换，快照形态会拿到过期档位（与 motion.ts 同理由）
  const enterPreset = computed(() => enter({ animationName: names.enter, reduced: reduced.value }))
  const exitPreset = computed(() => exit({ animationName: names.exit, reduced: reduced.value }))
  const scrimEnterPreset = computed(() =>
    enter({ animationName: names.scrimEnter, reduced: reduced.value }),
  )
  const scrimExitPreset = computed(() =>
    exit({ animationName: names.scrimExit, reduced: reduced.value }),
  )

  /** 相位 → 预设；`gone` 与 `enter` 同形（都不挂退场动画） */
  function pick<T extends { animation: string }>(phase: SheetPhase, a: T, b: T): T {
    return phase === 'exit' ? b : a
  }

  return {
    reduced,
    panelStyle: (phase) => ({ animation: pick(phase, enterPreset.value, exitPreset.value).animation }),
    scrimStyle: (phase) => ({
      animation: pick(phase, scrimEnterPreset.value, scrimExitPreset.value).animation,
    }),
  }
}

export interface UseSheetDismissOptions extends UseSheetMotionOptions {
  /**
   * 退场计时器到点的终态动作。默认无动作。
   * 底部弹层传 `() => emit('close')` —— 宿主页正是在这一刻才把 v-if 置 false（ADR-0123 卸载式显隐）。
   */
  onDismissed?: () => void
}

export interface SheetDismiss extends SheetMotion {
  /** 当前相位（绑 `:motion-phase` 给壳组件 / 读 `exiting` 做交互守卫） */
  phase: Ref<SheetPhase>
  /** 退场中（含已卸载）：交互入口据此短路，防连点重复排队 */
  exiting: ComputedRef<boolean>
  /** 关闭请求（遮罩 / × / 把手 / 返回键统一入口）：幂等 */
  requestClose(): void
  /** 外部把相位拉回入场（弹层被复用再次显示时用；`open=true` 语义） */
  reopen(): void
  /** 宿主把 `open` 置 false 时调用：等价于 `requestClose()`，但显式命名便于读懂接线 */
  syncOpen(open: boolean): void
  /** 卸载时清计时器（组件内应在 onBeforeUnmount 调用，避免卸载后再 emit） */
  dispose(): void
}

/**
 * 弹层两段式显隐状态机。
 *
 * 时序（`requestClose` → 计时器到期）：
 *   phase: enter → exit → gone
 *   样式: 入场动画 → 退场动画 → （宿主已卸载 / 调用方读 gone 隐藏）
 *   计时器时长 = 退场预设的 `holdMs`（与退场动画同源；R1 降级时同步归零）
 */
export function useSheetDismiss(options: UseSheetDismissOptions): SheetDismiss {
  const motion = useSheetMotion(options)
  const phase = ref<SheetPhase>('enter')
  let timer: ReturnType<typeof setTimeout> | undefined

  function clearTimer(): void {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  function requestClose(): void {
    // 幂等：退场中再来一次关闭请求（连点 / 返回键与遮罩同时）不再起第二个计时器，
    // 否则会 emit 两次 close，把宿主的「打开」状态一起吃掉。
    if (phase.value !== 'enter') return
    phase.value = 'exit'
    // holdMs 与退场动画同源：同一个 exit() 预设对象里的同一个值，不是另抄的数值
    const holdMs = exit({
      animationName: options.names.exit,
      reduced: motion.reduced.value,
    }).holdMs
    timer = setTimeout(() => {
      timer = undefined
      phase.value = 'gone'
      options.onDismissed?.()
    }, holdMs)
  }

  function reopen(): void {
    clearTimer()
    phase.value = 'enter'
  }

  function dispose(): void {
    clearTimer()
  }

  return {
    ...motion,
    phase,
    exiting: computed(() => phase.value !== 'enter'),
    requestClose,
    reopen,
    syncOpen: (open) => (open ? reopen() : requestClose()),
    dispose,
  }
}

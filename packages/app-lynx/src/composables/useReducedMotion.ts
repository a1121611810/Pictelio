// ─── 减弱动效偏好统一能力（T03 / issue #851；术语见 docs/adr/glossary-md3-alignment.md「动效域」）───
//
// 收敛全仓对「用户系统偏好减弱动效」的处理：此前只有 GlobalFab.vue 自行
// `window.matchMedia('(prefers-reduced-motion: reduce)')`，其余含动画组件各写各的（= 没写）。
// 本文件是**唯一**的偏好事实源：组件只读 `reducedMotion` / 两个降级值，禁止再自建 matchMedia。
//
// ── 降级规则（偏好开启时的确定形态；ADR-0205 决策 6「代码里写了 ≠ 真机生效」，
//    故规则必须可被单测逐条钉死，而不是散在各组件的三元里）────────────────
//
// R1 过渡（transition / transition-colors 等）：
//     整条声明置 `none` —— 等价「时长归零 + 去曲线」，状态**瞬切**而非慢速插值。
//     Tailwind 侧 = 不挂 `transition-* duration-* ease-*` 类（挂 0ms 时长是同义反复）。
//     颜色/透明度类过渡一并瞬切：这两类不触发前庭反应，保留反而与 R1 语义割裂。
//
// R2 关键帧动画（animation / @keyframes）：
//     整条声明置 `none`，**含 `infinite` 循环动画**（刷新转圈 fab-ring-spin、列表下拉转圈
//     fab-spin、骨架屏 shimmer）。循环动画对前庭障碍影响最大，必须停而不是放慢。
//     静息态图标仍在原位（busy 态仍可见），加载/进行中的可感知性不丢。
//
// R3 弹性与错峰（弹簧 pop、液态弹性跟手、逐项 stagger 延迟）：
//     动效**本身**不生成——不创建动画节点、不改几何、stagger 延迟恒 0。
//     这类是「运动」而非「淡入淡出」，只降时长无效（前庭反应与位移量成正比）。
//
// 三条规则都**不是**「只把时长调小」：偏好开启时位移、缩放、旋转、循环全部不发生，
// 组件只保留状态本身的颜色/内容变化。
//
// ── 降级路径的显式性（禁静默降级）────────────────────────────────────────
// - 环境无 matchMedia（SSR / vitest node / Lynx 原生未实现）：按「未开启」处理并 `console.warn`
//   报模块前缀，不假装已尊重偏好；
// - MediaQueryList 缺 addEventListener（旧宿主 / 假实现）：只在挂载时读一次，运行中切换不生效，warn。
//
// ── 可测性（票 #851 验收 5）───────────────────────────────────────────────
// `options.matchMedia` 是注入口：单测在无 window 的 node 环境注入假实现，即可覆盖
// 偏好开 / 关两条路径与运行时切换，无需真实 DOM。显式传 `matchMedia: undefined`
// 与「不传」（自动探测 globalThis.window）语义不同，便于确定性地测无 matchMedia 分支。
// 生命周期：组件内自动挂 `onUnmounted(dispose)`；裸调用（无当前实例，如单测）需自行 `dispose()`。
import { computed, getCurrentInstance, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'

/** 媒体查询串——单一事实源；组件内禁止重抄字面量 */
export const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)'

/** R1 过渡降级值：整条 transition 声明置此值（等价时长归零 + 去曲线） */
export const REDUCED_MOTION_TRANSITION = 'none'

/** R2 关键帧降级值：整条 animation 声明置此值（覆盖 1 次性与 infinite 循环动画） */
export const REDUCED_MOTION_ANIMATION = 'none'

/** `matchMedia` 返回值的最小形状（原生 `MediaQueryList` 的子集；单测注入假实现） */
export interface MediaQueryListLike {
  matches: boolean
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
}

/** 注入口：matchMedia 提供方（缺省探测 `globalThis.window.matchMedia`） */
export type MatchMediaLike = (query: string) => MediaQueryListLike

export interface UseReducedMotionOptions {
  /**
   * 注入 matchMedia。单测传假实现即可在无 window 环境覆盖两条偏好路径；
   * 显式传 `undefined` = 声明「本环境确定无 matchMedia」（与不传的自动探测区分开）。
   */
  matchMedia?: MatchMediaLike | undefined
}

export interface UseReducedMotionReturn {
  /** 偏好是否开启（响应式）。环境无 matchMedia 时恒 false 且已 warn（不假装已尊重偏好） */
  reducedMotion: Ref<boolean>
  /** R1 过渡降级：开启偏好 = `none`；否则 `''`（空串 = 不覆盖，保留组件原有 transition 声明） */
  transitionStyle: ComputedRef<string>
  /** R2 关键帧降级：开启偏好 = `none`；否则 `''`（语义同上，覆盖 infinite 循环动画） */
  animationStyle: ComputedRef<string>
  /** R3 逐项错峰：开启偏好时恒 0ms（错峰本身即「运动」，降时长无效） */
  staggerMs(index: number, stepMs: number): number
  /** 解除 change 监听（组件内自动挂 onUnmounted；裸调用需手动调） */
  dispose(): void
}

/** 探测宿主 matchMedia；无 window / 非函数实现时返回 undefined（由调用方 warn，不静默） */
function detectMatchMedia(): MatchMediaLike | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
  return (query: string) => window.matchMedia(query)
}

/**
 * 读取并跟随「减弱动效」系统偏好，按 R1/R2/R3 三条规则给出降级值。
 *
 * 典型用法（组件内）：
 * ```ts
 * const { reducedMotion, transitionStyle, animationStyle, staggerMs } = useReducedMotion()
 * // 内联 style 组件：'none' 覆盖，'' 走原声明
 * const style = computed(() => ({ animation: animationStyle.value || 'ring-in 300ms ease both' }))
 * // Tailwind 类组件：偏好开启时整组动效类不挂
 * :class="[reducedMotion ? '' : 'transition-colors duration-200', trackClass(checked)]"
 * ```
 */
export function useReducedMotion(options: UseReducedMotionOptions = {}): UseReducedMotionReturn {
  // hasOwnProperty 判别「显式注入 undefined」与「未传 → 自动探测」两种语义
  const hasInjection = Object.prototype.hasOwnProperty.call(options, 'matchMedia')
  const matchMedia = hasInjection ? options.matchMedia : detectMatchMedia()

  const reducedMotion = ref(false)
  let mq: MediaQueryListLike | undefined
  let disposed = false

  function sync(): void {
    reducedMotion.value = mq?.matches ?? false
  }
  function handleChange(): void {
    sync()
  }

  if (!matchMedia) {
    console.warn(
      '[useReducedMotion] matchMedia 不可用（无 window 或 Lynx 原生未实现）：减弱动效偏好按「未开启」处理，动效保持原样。',
    )
  } else {
    mq = matchMedia(REDUCED_MOTION_MEDIA_QUERY)
    sync()
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handleChange)
    } else {
      console.warn(
        '[useReducedMotion] MediaQueryList 缺 addEventListener：偏好只在初始化时读一次，运行中切换系统偏好不生效。',
      )
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    mq?.removeEventListener?.('change', handleChange)
  }

  // 组件内自动随卸载解除监听；裸调用（无当前实例，如单测）由调用方 dispose()
  if (getCurrentInstance()) onUnmounted(dispose)

  const transitionStyle = computed(() => (reducedMotion.value ? REDUCED_MOTION_TRANSITION : ''))
  const animationStyle = computed(() => (reducedMotion.value ? REDUCED_MOTION_ANIMATION : ''))
  function staggerMs(index: number, stepMs: number): number {
    return reducedMotion.value ? 0 : index * stepMs
  }

  return { reducedMotion, transitionStyle, animationStyle, staggerMs, dispose }
}

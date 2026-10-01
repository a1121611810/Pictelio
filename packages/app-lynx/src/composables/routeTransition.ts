// ─── 路由转场（issue #880；契约见 ADR-0211 决策 6，能力边界见 ADR-0210）───
//
// Lynx 侧**无路由 transition 能力**（vue-router 的 `<Transition>` / `transition` 配置项不生效），
// 因此转场只能在**导航发起侧**自建：本模块持有「方向 + 阶段」状态，`router.ts` 的 `afterEach`
// 在导航落定的同一微任务里写入方向，`App.vue` 的页面容器按状态挂一次性入场动画。
// 现有 `navigate()` / `goBack()` 的调用面**一字未改**（本模块不要求任何调用点传方向）。
//
// ── 已登记的能力削减（ADR-0211 决策 6 约束 2，**不假装做到完整双向转场**）───
// back **不是** forward 的倒放：Lynx 上无法做「旧页退出、新页等待」（无 `transitionend`
// 可挂，ADR-0111；双页并存的生命周期成本也高），而 vue-router 的 push/back 是**硬替换**——
// 旧页在动画开始前就已离开渲染树。⇒ back 只能给**重新进入的旧页**一个自左侧的滑入，
// 旧页**没有**滑出过程。
// 代价（真机可见，已在 issue #880 验收 6 登记）：滑入过程中页面未覆盖的一侧露出
// `.Root` 的 surface 底色，而不是「旧页正在滑走」。
//
// ── 时序取证（为什么方向由 `afterEach` 写，而不是在 `navigate()` 里同步写）───
// 取自 `node_modules/vue-router/dist/vue-router.js`：
//   `finalizeNavigation()` 内 `currentRoute.value = toLocation`（L1409）→ Vue 的渲染 flush
//   在此刻被排进微任务队列；`triggerAfterEach()`（L1334 / L1446）与它**同一个 `.then` 回调
//   内同步执行**，即排在 flush 微任务**之前**。
// ⇒ 在 `afterEach` 里写方向时，新页面的**首帧**就已经带上动画：
//   · 不会先渲染一帧「无动画的新页」再补动画（无闪帧）；
//   · 也不会让**旧页**先动（方向写在渲染 flush 之前，旧页来不及用新方向重绘）。
//   反之，若在 `navigate()` 里同步写：渲染 flush 早于 `currentRoute` 落定后的方向生效点，
//   会退化成「旧页先滑一下、再硬切新页」——这是本实现刻意排除的失败形态。
//
// ── 时长/曲线唯一入口（决策 1 + 决策 3）───
// 动画简写由 `motion.ts` 的 `enter()` 拼装（`--durationGentle` + `--motion-emphasized-decelerate`），
// 两段式计时器取**同一档**的数值镜像 `MOTION_DURATION_MS`（决策 3 的「令牌同源计时器」）。
// 本文件**不出现任何时长/曲线字面量**，也不 import 任何 transform 族工具类（ADR-0210 路径 E：
// 那些是死类名——产出规则但引用的 `--tw-*` 从未定义 ⇒ 渲染 `transform: none`）。
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import {
  MOTION_DURATION_MS,
  enter,
  useMotion,
  type MotionDurationKey,
  type MotionEasingKey,
  type UseReducedMotionOptions,
} from './motion'

/**
 * 转场方向。
 * - `forward` 进入更深层级：新页面**从右侧**滑入 + fade（平台约定：前进 = 内容右移）
 * - `back` 返回上层：重新进入的旧页**从左侧**滑入（**不是** forward 的倒放，见头注削减登记）
 * - `none` 不挂转场（replace 语义的导航：登录/登出/首路由/深链直达/tab 切换）
 */
export type RouteDirection = 'forward' | 'back' | 'none'

/** 转场阶段：`idle` = 容器上没有任何 animation 声明；`enter` = 一次性入场动画播放中 */
export type RouteTransitionPhase = 'idle' | 'enter'

export interface RouteDirectionInput {
  /**
   * replace 语义导航（不入历史栈）。现有调用点全部是「不是进入更深层级」的导航：
   * 登录 / 登出 / 首路由 / 会话错误页 / 深链 benchNav / tab 切换
   * （`createGlobalFab` 的 `select` 走 `navigate(path, { replace: true })`）。
   * ⇒ 一律不挂转场：否则深链直达会凭空滑一下（#880 验收 4「深链直达不出现异常转场」）。
   */
  replace?: boolean
  /** 显式方向（`goBack()` 声明：返回手势无论物理上走 back 还是 replace-to-root，语义都是 back） */
  declared?: RouteDirection
}

/**
 * 方向裁决（纯函数，node 可单测，不依赖 router）。
 *
 * 规则只有两条，刻意不分叉：
 *  ① `replace === true` → `none`（见 `RouteDirectionInput.replace` 的理由）
 *  ② 否则取显式声明；未声明即 `forward`（push = 进入更深层级，本仓 push 的既有语义）
 */
export function decideRouteDirection(input: RouteDirectionInput = {}): RouteDirection {
  if (input.replace === true) return 'none'
  return input.declared ?? 'forward'
}

// ─── 档位与动画名登记（约束：字面量整段查表，不做参数化拼接）───

/**
 * 时长档：`gentle` = 300ms。
 * 依据 = M3 **shared axis X** 转场的官方时长（medium2 档 = 300ms）——
 * shared axis 正是 M3 对「前进/后退共享轴」这一形态的官方命名，本实现做的是它的降级版。
 * 刻意**不用** `medium` 档：`enterSheet` / `enterListItem` 已占用它，且 250ms 对整页位移偏急。
 */
export const ROUTE_TRANSITION_DURATION: MotionDurationKey = 'gentle'

/**
 * 缓动档：`decelerate`（进场减速落位）。
 * 依据 = ADR-0211 决策 2/3 的进场语义（弹层入场、列表项浮出均为 decelerate）；
 * 路由转场是同一类「一次性进场位移」，沿用同一档不另立标准。
 */
export const ROUTE_TRANSITION_EASING: MotionEasingKey = 'decelerate'

/**
 * 两个方向的 `@keyframes` 名（帧体在 `App.vue` 的非 scoped `<style>` 块，全仓唯一定义方）。
 *
 * ⚠️ 每方向**两个**同帧体变体，不是冗余：同向连续两次导航时 animation-name 必须**变化**
 * 才会重播（同名 animation 在同一元素上不重放——ADR-0111 同源约束：Lynx 无 animationend /
 * transitionend 可挂）。变体名切换是本仓**已在用**的重播形态：`useSheetDismiss` 的
 * `sheet-enter` ⇄ `sheet-exit` 就是在同一元素上靠换名重播退场。
 */
export const ROUTE_TRANSITION_ANIMATION: Readonly<
  Record<'forward' | 'back', readonly [string, string]>
> = {
  forward: ['route-forward-in', 'route-forward-in-alt'],
  back: ['route-back-in', 'route-back-in-alt'],
}

/**
 * 两段式计时器时长（ms）：与入场动画**同一档**的数值镜像。
 * 与决策 3 的 `useSheetDismiss` 同款义务——计时器与动画必须同源，
 * 否则「动画已停但状态未归位」的空窗期会漂移（本处表现为 transform 残留 ⇒
 * 容器持续成为 `position:absolute` 后代的包含块，见 `App.vue` 的注释）。
 */
export const ROUTE_TRANSITION_HOLD_MS: number = MOTION_DURATION_MS[ROUTE_TRANSITION_DURATION]

/**
 * 静息 / 降级态的 `:style` 值：**空对象** = 元素上不挂任何过渡声明。
 * 共享同一实例（而不是每次 `return {}`）是为了让 computed 的返回值在静息期**恒等**——
 * 否则每次求值都产生新对象，绑定层会把它当变更，重挂一层无意义的样式写入。
 */
const EMPTY_STYLE: Record<string, string> = {}

// ─── 模块级状态（router.ts 写，App.vue 读）───

interface RouteTransitionState {
  direction: RouteDirection
  /** 每次方向落定自增：既驱动「重挂」也让 animation-name 变体轮换（同向连续导航必须重播） */
  epoch: number
}

const _state = ref<RouteTransitionState>({ direction: 'none', epoch: 0 })

/**
 * 写入一次转场意图（由 `router.ts` 的 `afterEach` 调用）。
 *
 * 幂等性说明：`none` **也**自增 epoch —— 它承担「取消上一次未播完的入场」的职责
 * （深链直达 / tab 切换必须把上一次 forward 的 transform 摘掉）。
 */
export function beginRouteTransition(direction: RouteDirection): void {
  _state.value = { direction, epoch: _state.value.epoch + 1 }
}

/** 当前方向（只读派生；`none` = 不挂转场） */
export const routeTransitionDirection: ComputedRef<RouteDirection> = computed(
  () => _state.value.direction,
)

/** 只读测试/诊断口：重置模块级状态（单测之间隔离用；生产不调用） */
export function resetRouteTransitionForTest(): void {
  _state.value = { direction: 'none', epoch: 0 }
}

export interface UseRouteTransitionOptions extends UseReducedMotionOptions {}

export interface UseRouteTransition {
  /** 当前方向 */
  direction: ComputedRef<RouteDirection>
  /** 当前阶段（`enter` = 容器上挂着入场动画） */
  phase: Ref<RouteTransitionPhase>
  /** 减弱动效偏好（来自 `useReducedMotion`；R1/R2 降级已在 `style` 里生效） */
  reduced: Ref<boolean>
  /** 当前挂的 `@keyframes` 名（`idle` / `none` 时为空串）——门禁与单测的观察口 */
  animationName: ComputedRef<string>
  /** 绑页面容器 `:style` 的值：R1/R2 降级或 `idle` 时为**空对象**（不挂任何过渡声明） */
  style: ComputedRef<Record<string, string>>
  /** 解除监听与计时器（组件内已随卸载自动挂；裸调用需手动） */
  dispose(): void
}

/**
 * 路由转场的唯一时序实现。
 *
 * 时序（`beginRouteTransition` → 归位）：
 *   方向落定 → phase `enter`（容器挂入场 animation）→ `ROUTE_TRANSITION_HOLD_MS` → phase `idle`
 *   计时器时长与动画同源（同一 duration 档），故「动画停」与「transform 摘除」同刻发生。
 */
export function useRouteTransition(options: UseRouteTransitionOptions = {}): UseRouteTransition {
  const motion = useMotion(options)
  const phase = ref<RouteTransitionPhase>('idle')
  let timer: ReturnType<typeof setTimeout> | undefined

  function clearTimer(): void {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  // watch 的默认 flush='pre'：与页面换页在**同一次渲染 flush** 内完成
  // ⇒ 新页面首帧即带动画（时序取证的依据见文件头）。
  const stopWatch = watch(
    () => _state.value.epoch,
    () => {
      clearTimer()
      // 减弱动效：动效**本身不生成**（R1 过渡 + R2 关键帧）——比挂 `animation: none` 更强，
      // 元素上不留 animation 属性，也就没有 transform 残留。
      if (_state.value.direction === 'none' || motion.reduced.value) {
        phase.value = 'idle'
        return
      }
      phase.value = 'enter'
      timer = setTimeout(() => {
        timer = undefined
        phase.value = 'idle'
      }, ROUTE_TRANSITION_HOLD_MS)
    },
  )

  const animationName = computed<string>(() => {
    const d = _state.value.direction
    if (d === 'none') return ''
    return ROUTE_TRANSITION_ANIMATION[d][_state.value.epoch % 2]!
  })

  const style = computed<Record<string, string>>(() => {
    if (motion.reduced.value || phase.value !== 'enter') return EMPTY_STYLE
    return {
      animation: enter({
        animationName: animationName.value,
        duration: ROUTE_TRANSITION_DURATION,
        easing: ROUTE_TRANSITION_EASING,
        reduced: false,
      }).animation,
    }
  })

  return {
    direction: routeTransitionDirection,
    phase,
    reduced: motion.reduced,
    animationName,
    style,
    dispose() {
      clearTimer()
      stopWatch()
      motion.dispose()
    },
  }
}

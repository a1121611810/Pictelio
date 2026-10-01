// ─── 动效唯一入口（issue #876；契约见 ADR-0211 决策 1 / 2 / 9，能力边界见 ADR-0210）───
//
// 本文件是**全项目动效时长与曲线的唯一来源**。组件内禁止出现时长/曲线字面量，
// 也不得从其他路径取得动效参数——本文件是唯一起点。
//
// ── 三个必须遵守的实现约束（都是会静默失效的坑，不是风格偏好）───
//
// ① **类名必须以字面量出现在本文件里**，不能运行时拼接。
//    `tailwind.config.ts` 的 `content: ['./src/**/*.{vue,js,ts}']` 包含 `.ts`（已复算），
//    字面量能被扫到；但 `` `duration-[${x}]` `` 这类拼接结果扫不到
//    ⇒ **产物零规则、渲染零过渡，且没有任何构建期信号**。
//    ⇒ 所以类形态不做参数化：`MOTION_CLASS` 是**字面量登记表**，按档位名整段查表；
//      需要按参数变化的量（错峰延迟）一律走 inline `:style` 值，不走类名。
//
// ② **transform / scale / translate / rotate 工具类一律是死类名**（ADR-0210 路径 E）。
//    它们**确实产出 CSS 规则**，但规则里的 9 个 `--tw-*` 变量从未被定义
//    （preset 不注入 base/preflight 层，仓内 `--tw-` 定义 0 处）
//    ⇒ 按 CSS 规范该声明在**计算值阶段非法** ⇒ 渲染为 `transform: none`。
//    这是「构建全绿、类型过、单测过、产物有规则，只有真机看得见」的一格。
//    ⇒ 本文件不导出任何 transform 族工具类；跟手位移走 inline `:style` 值。
//
// ③ **on-primary 档的状态层类名不得搬进本文件**（ADR-0211 决策 8）。
//    门禁 `tests/stateLayerOnPrimary.test.ts` 的 C3 逐标签扫 `.vue`，要求
//    「写了 on-primary 档状态层 ⇒ 同元素必须带实心底色」；把类名挪进 `.ts`
//    会主动制造 ADR-0207 已登记的 `.ts` 全文盲区，让消费约束失去机器防线。
//    ⇒ 本文件**不导出任何 active:bg-layer-*-on-primary 字面量**。
//
// ── 减弱动效接入（ADR-0211 决策 9）───
// 唯一偏好事实源是 `useReducedMotion`（R1 过渡 / R2 关键帧 / R3 弹性与错峰），
// **禁自建 matchMedia**。R1 开启时返回「不挂类」的空串（挂 0ms 时长是同义反复），
// R2 开启时 animation 为 `none`，R3 开启时错峰步长恒 0。
//
// ── 数值出处（全部取自 src/styles/tokens.css 的既有令牌，本文件不新增令牌）───
// 时长：--durationFast 150ms / --durationNormal 200ms / --durationMedium1 250ms
//       / --durationGentle 300ms / --durationMedium3 350ms / --durationExtraLong4 1000ms
// 曲线：--motion-standard (0.2,0,0,1) / --motion-emphasized (0.2,0,0,1)
//       / --motion-emphasized-accelerate (0.3,0,0.8,0.15) / --motion-emphasized-decelerate (0.05,0.7,0.1,1)
// ⚠️ standard 与 emphasized 同值是 material-web v0.192 的**官方事实**，不是笔误，勿「修正」。
import { computed, type ComputedRef, type Ref } from 'vue'
import { useReducedMotion, type UseReducedMotionOptions } from './useReducedMotion'

// 类型再导出：消费方只需从本模块 import，不必知道偏好能力住在哪个文件
export type { UseReducedMotionOptions }

// ───────────────────────────────────────────────────────────────────────────
// 档位表
//
// `MOTION_DURATION` 是 CSS 侧取值（供工具类与 inline style 用，是渲染期唯一事实源）。
// `MOTION_DURATION_MS` 是同一批令牌的**数值镜像**，只服务于「JS 需要一个 number」的
// 场景（两段式退场的 setTimeout、错峰延迟的 animation-delay）——CSS 令牌拿不到
// 计算值（Lynx 侧无 getComputedStyle），故必须有一份数字。
// ⚠️ 这份镜像**不是新的事实源**：`tests/motionContract.test.ts` 会现场解析
//    `src/styles/tokens.css` 并逐档比对，令牌改了而镜像没改即当场转红。
// ───────────────────────────────────────────────────────────────────────────

/** 时长档 → CSS `var()` 引用 */
export const MOTION_DURATION = {
  /** 150ms：全项目最短档；与 Tailwind `transition-colors` 内置默认 .15s 同值 */
  fast: 'var(--durationFast)',
  /** 200ms：常规过渡 */
  normal: 'var(--durationNormal)',
  /** 250ms：中档；列表项浮出的既定档位 */
  medium: 'var(--durationMedium1)',
  /** 300ms：长一点的一次性动画 */
  gentle: 'var(--durationGentle)',
  /** 350ms：更长的一次性动画（收环等） */
  longer: 'var(--durationMedium3)',
  /** 1000ms：循环动画周期（骨架屏 shimmer / 无限转圈） */
  loop: 'var(--durationExtraLong4)',
} as const

export type MotionDurationKey = keyof typeof MOTION_DURATION

/** 时长档 → 毫秒数（tokens.css 同名令牌的数值镜像；由门禁逐档比对钉住） */
export const MOTION_DURATION_MS: Readonly<Record<MotionDurationKey, number>> = {
  fast: 150,
  normal: 200,
  medium: 250,
  gentle: 300,
  longer: 350,
  loop: 1000,
}

/** 缓动档 → CSS `var()` 引用 */
export const MOTION_EASING = {
  /** (0.2,0,0,1)：标准进出；按压反馈的既定档位（ADR-0211 决策 2） */
  standard: 'var(--motion-standard)',
  /** (0.2,0,0,1)：与 standard 官方同值，用于「需要更强调的观感」处（值相同是有意保留） */
  emphasized: 'var(--motion-emphasized)',
  /** (0.3,0,0.8,0.15)：出场/退出语义 */
  accelerate: 'var(--motion-emphasized-accelerate)',
  /** (0.05,0.7,0.1,1)：入场/进场语义（减速落位） */
  decelerate: 'var(--motion-emphasized-decelerate)',
} as const

export type MotionEasingKey = keyof typeof MOTION_EASING

// ───────────────────────────────────────────────────────────────────────────
// 工具类登记表（约束 ①：整段字面量，按档位名查表，**不做参数化拼接**）
//
// `.transition-colors` 的 transition-property 只含 background-color / border-color / color
// 三条（产物实测），**不含 opacity、不含 box-shadow**；`duration-[…]` / `ease-[…]`
// 是 ADR-0210 路径 A 的既定写法（真机 2026-10-01 取证通过）。
// ───────────────────────────────────────────────────────────────────────────

/** 可按名查表的类形态档位 */
export type MotionClassKey =
  | 'pressStateLayer'
  | 'switchTrack'
  | 'enterSheet'
  | 'exitSheet'
  | 'enterListItem'

/** 字面量类名登记表。值必须是**写死的完整类名字符串**。
 *  ⚠️ 新增档位只允许在这里追加整条字面量，不允许写拼接表达式。 */
export const MOTION_CLASS: Readonly<Record<MotionClassKey, string>> = {
  /** 按压状态层：150ms + standard。依据 ADR-0211 决策 2 映射表第 1/2 行
   *  （alpha 档与预计算实色档**同档**：12% 明度差上曲线差异不可分辨，分档属凭感觉）。 */
  pressStateLayer: 'transition-colors duration-[var(--durationFast)] ease-[var(--motion-standard)]',
  /** 开关轨道态切换：200ms（normal）+ standard。
   *  **档位出处 = M3 switch spec v0.192 该控件自身的动效令牌**，不是本表其余档位的选型结论：
   *  ADR-0179 §背景的实跑提取清单把 12 处开关 markup 的动效逐字记为
   *  `var(--durationNormal)` + `var(--motion-standard)`，spec `docs/specs/app-lynx-m3-switch.md` §4 同款。
   *  **为何不取 fast（150ms）**：决策 2 的 fast 档只映射**按压/状态层**形态（映射表 6 行消费点
   *  全是 `active:*`）；轨道换的是 checked⇄unchecked 的**常驻控件终态**（背景色 + 边框色），
   *  不属按压反馈，套 fast 等于把「控件态切换」压到「按压反馈」的量级。
   *  ⚠️ 本条**保持既有 200ms 不动**：本次只是把组件里的字面量**收口**到本表（ADR-0211 决策 1），
   *    不改观感。换档属产品决策，且会让 ADR-0179 与 spec 的逐字断言同时转红。 */
  switchTrack: 'transition-colors duration-[var(--durationNormal)] ease-[var(--motion-standard)]',
  /** 弹层入场：250ms + decelerate（进场减速落位）。 */
  enterSheet: 'transition-colors duration-[var(--durationMedium1)] ease-[var(--motion-emphasized-decelerate)]',
  /** 弹层退场：150ms + accelerate（出场加速离场）。
   *  时长取 fast 而非 medium：退场期间弹层仍占位且不响应滚动（决策 3 的已知代价），
   *  窗口越短代价越小。 */
  exitSheet: 'transition-colors duration-[var(--durationFast)] ease-[var(--motion-emphasized-accelerate)]',
  /** 列表项浮出：250ms + decelerate，与既有 RefreshableList 的 item-rise 同档。 */
  enterListItem: 'transition-colors duration-[var(--durationMedium1)] ease-[var(--motion-emphasized-decelerate)]',
}

// ───────────────────────────────────────────────────────────────────────────
// 预设形态
//
// 两种形态**必须分开**（ADR-0211 决策 1 约束 2）：引擎实际可过渡的属性不同。
//   - 颜色 / 边框 / 文字色 → 工具类（`.transition-colors` 覆盖内，已验证）
//   - opacity / 尺寸 / transform → inline `:style`（`.transition-colors` **不含** opacity，
//     挂类是静默失效；inline 是唯一无歧义路径，已被 GlassCard / GlobalFab 实证）
//   - 一次性进出场 → `<style>` 块内 @keyframes + animation 简写（走本文件的档位拼装）
// ───────────────────────────────────────────────────────────────────────────

/** 工具类形态：整段绑 `:class` */
export interface MotionClassPreset {
  /** 绑 `:class`；R1 降级时为**空串**（不挂类 = 挂 0ms 时长的同义反复） */
  readonly className: string
}

/** inline style 形态：整段绑 `:style` 的 transition 值 */
export interface MotionStylePreset {
  /** 绑 `:style` 的 `transition` 值；R1 降级时为 `none` */
  readonly transition: string
}

/** 入场预设：类 + 一次性动画简写 */
export interface MotionEnterPreset extends MotionClassPreset {
  /** `<style>` 块里 `@keyframes <name>` 的动画简写值（不含 animation 属性名）；
   *  消费方把它拼进 `animation: <value>`。R2 降级时为 `none`。 */
  readonly animation: string
}

/** 退场预设：类 + 一次性动画简写 + 两段式计时器 */
export interface MotionExitPreset extends MotionEnterPreset {
  /** 两段式显隐（ADR-0211 决策 3）里「播完再卸载」的计时器时长（ms）。
   *  **必须与退场动画同源**：R1 降级时为 0 —— 否则关弹层会卡住一段
   *  「动画已停但遮罩仍滞留」的空窗期。⚠️ Lynx 无 transitionend，只能靠它。 */
  readonly holdMs: number
}

/** 按压预设：类 + 非颜色属性过渡（跟手 transform 走 `pressTransform()`，理由见该函数） */
export interface MotionPressPreset extends MotionClassPreset {
  /** 非颜色属性的 `transition` 值（inline）。未指定 property 时给颜色版。 */
  readonly transition: string
}

/** 错峰预设：逐项延迟步长 */
export interface MotionStaggerPreset {
  /** 逐项延迟步长（ms），供消费方算 `index * stepMs` 写进 inline `animation-delay`。
   *  R3 降级时恒 0（错峰本身即「运动」，只降时长无效）。 */
  readonly stepMs: number
}

// ───────────────────────────────────────────────────────────────────────────
// 参数化构造：inline 形态可参数化（它是运行时拼的 `var()` 引用，不经 JIT）
// ───────────────────────────────────────────────────────────────────────────

/** 可过渡的非颜色属性（`.transition-colors` 覆盖外的那几个） */
export type MotionProperty = 'opacity' | 'width' | 'height'

export interface EnterOptions {
  /** 时长档（缺省 `medium` 250ms） */
  duration?: MotionDurationKey
  /** 缓动档（缺省 `decelerate`，进场减速落位） */
  easing?: MotionEasingKey
  /** `@keyframes` 的动画名（帧体由消费方的 `<style>` 块定义） */
  animationName: string
  /** R2 降级标记：true 时 animation 置 `none` */
  reduced?: boolean
}

export interface ExitOptions extends EnterOptions {
  /** 退场缓动档（缺省 `accelerate`，出场加速离场） */
  easing?: MotionEasingKey
  /** 两段式计时器时长覆盖（缺省取 `duration` 档的数值镜像） */
  holdMs?: number
  /** R1 降级标记：true 时计时器归零 */
  reduced?: boolean
}

export interface PressOptions {
  /** 时长档（缺省 `fast` 150ms，ADR-0211 决策 2 的选档依据） */
  duration?: MotionDurationKey
  /** 缓动档（缺省 `standard`） */
  easing?: MotionEasingKey
  /** 过渡的属性名；不传 = 颜色版（`background-color`） */
  property?: MotionProperty
  /** R1 降级标记：类置空串、transition 置 none */
  reduced?: boolean
}

export interface StaggerOptions {
  /** 步长覆盖（ms） */
  stepMs?: number
  /** R3 降级标记 */
  reduced?: boolean
}

// ───────────────────────────────────────────────────────────────────────────
// 预设一：入场 ENTER
// ───────────────────────────────────────────────────────────────────────────

/** 入场：类形态（按档位名查字面量表，不拼接）。 */
export function enterClass(key: MotionClassKey = 'enterSheet', reduced = false): MotionClassPreset {
  // R1：整条过渡置 none ⇒ 不挂类（挂 0ms 时长是同义反复）
  return { className: reduced ? '' : MOTION_CLASS[key] }
}

/** 入场：一次性动画简写（inline 拼装，走 `var()` 引用不经 JIT）。 */
export function enter(options: EnterOptions): MotionEnterPreset {
  const name = options.animationName
  const duration = MOTION_DURATION[options.duration ?? 'medium']
  const easing = MOTION_EASING[options.easing ?? 'decelerate']
  return {
    className: MOTION_CLASS.enterSheet,
    // R2：整条 animation 置 none（含 infinite 循环）
    animation: options.reduced ? 'none' : `${name} ${duration} ${easing} both`,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 预设二：退场 EXIT
// ───────────────────────────────────────────────────────────────────────────

/** 退场：类形态 + 一次性动画简写 + 两段式计时器。
 *  ⚠️ `holdMs` 与 `animation` **同源**：都取自同一个 `duration` 档，
 *   且 R1 降级时**同时**归零（决策 3 的硬要求）。 */
export function exit(options: ExitOptions): MotionExitPreset {
  const durationKey = options.duration ?? 'fast'
  const name = options.animationName
  const duration = MOTION_DURATION[durationKey]
  const easing = MOTION_EASING[options.easing ?? 'accelerate']
  if (options.reduced) {
    return { className: '', animation: 'none', holdMs: 0 }
  }
  return {
    className: MOTION_CLASS.exitSheet,
    animation: `${name} ${duration} ${easing} both`,
    holdMs: options.holdMs ?? MOTION_DURATION_MS[durationKey],
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 预设三：按压 PRESS
// ───────────────────────────────────────────────────────────────────────────

/** 按压：类形态（颜色状态层走工具类）+ 非颜色属性 inline 过渡。
 *  R1 降级 ⇒ 类置空串、transition 置 none。
 *  ⚠️ 本函数**不返回 transform**：跟手缩放是「持续跟手」的几何变化（路径 B），
 *  其 scale 数值属控件自己的设计决策（不同控件按压深度不同），收进本文件会
 *  让本文件从「时长与曲线的事实源」变成「几何的事实源」，反而制造第二个入口。
 *  需要时走 `pressTransform()`，它保证只产出 inline 值、且在 R3 下不生成。 */
export function press(options: PressOptions = {}): MotionPressPreset {
  const duration = MOTION_DURATION[options.duration ?? 'fast']
  const easing = MOTION_EASING[options.easing ?? 'standard']
  const property = options.property ?? 'background-color'
  if (options.reduced) {
    return { className: '', transition: 'none' }
  }
  return {
    className: MOTION_CLASS.pressStateLayer,
    transition: `${property} ${duration} ${easing}`,
  }
}

/** 按压跟手的 transform 值（inline，路径 B）。
 *  ⚠️ **scale 数值由调用方给**：`scale(0.96)` 里的 0.96 是几何量不是时长/曲线。
 *  R3 降级时返回 `none` —— 即**动效本身不生成**（不是「不加过渡」）：
 *  前庭反应与位移量成正比，只降时长无效（ADR-0211 决策 9 的 R3 增量第 2 条）。 */
export function pressTransform(scale: number, motionReduced = false): string {
  if (motionReduced) return 'none'
  return `scale(${scale})`
}

// ───────────────────────────────────────────────────────────────────────────
// 预设四：错峰 STAGGER
// ───────────────────────────────────────────────────────────────────────────

/** 错峰步长（ms）。⚠️ **无 M3 官方值**：M3 duration scale 里没有「延迟」档，
 *  错峰是本项目的时序编排量（既有点阵 0 / 60 / 120ms，见 RefreshableList 的
 *  item-rise-1/2/extra）。收口在本文件一处，组件内不再各写一份。 */
export const STAGGER_STEP_MS = 60

/** 错峰上限：**只对首屏可见的前 N 项施加错峰**，其余直接终态。
 *  虚拟滚动下若对全部项逐项延迟，长列表末项的入场时间会随长度线性漂移。 */
export const STAGGER_MAX_ITEMS = 8

/** 错峰：逐项延迟步长。R3 降级时恒 0。 */
export function stagger(options: StaggerOptions = {}): MotionStaggerPreset {
  return { stepMs: options.reduced ? 0 : (options.stepMs ?? STAGGER_STEP_MS) }
}

/** 错峰：第 index 项的 inline `animation-delay` 值（ms）。
 *  超过 `STAGGER_MAX_ITEMS` 的项直接 0ms（终态），防长列表末项入场时间线性漂移。 */
export function staggerDelay(index: number, options: StaggerOptions = {}): number {
  const { stepMs } = stagger(options)
  if (stepMs === 0) return 0
  return index < STAGGER_MAX_ITEMS ? index * stepMs : 0
}

// ───────────────────────────────────────────────────────────────────────────
// 组合入口：把 useReducedMotion 的 R1/R2/R3 判定接到四类预设上
// ───────────────────────────────────────────────────────────────────────────

export interface UseMotionOptions extends UseReducedMotionOptions {}

/** 一次拿到四类预设 + 偏好状态，供组件绑定。组件**只读本返回值**，
 *  不再自行判断偏好、不再自建 matchMedia（ADR-0211 决策 9）。
 *
 *  ```ts
 *  const motion = useMotion()
 *  // 颜色状态层：R1 降级时 className 自动为空串
 *  :class="[motion.pressColor.value.className, 'active:bg-layer-pressed-on-surface']"
 *  // 一次性入场：R2 降级时 animation 自动为 none
 *  const sheet = motion.enterSheet.value
 *  // 两段式退场：R1 降级时 holdMs 自动为 0
 *  setTimeout(() => (open.value = false), motion.exitSheet.value.holdMs)
 *  // 错峰：R3 降级时 stepMs 自动为 0
 *  `animation-delay: ${index * motion.staggerStepMs.value.stepMs}ms`
 *  ```
 */
export function useMotion(options: UseMotionOptions = {}): {
  /** 偏好是否开启（响应式；来自 useReducedMotion 的 R1/R2/R3 判定） */
  reduced: Ref<boolean>
  enterClass: ComputedRef<MotionClassPreset>
  enterSheet: ComputedRef<MotionEnterPreset>
  enterListItem: ComputedRef<MotionEnterPreset>
  exitSheet: ComputedRef<MotionExitPreset>
  exitListItem: ComputedRef<MotionExitPreset>
  pressColor: ComputedRef<MotionPressPreset>
  pressOpacity: ComputedRef<MotionPressPreset>
  pressSize: ComputedRef<MotionPressPreset>
  staggerStepMs: ComputedRef<MotionStaggerPreset>
  /** 逐项错峰延迟（ms）—— 已内建上限与 R3 归零 */
  staggerDelay(index: number): number
  /** 解除偏好监听（组件内自动；裸调用需手动） */
  dispose(): void
} {
  const rm = useReducedMotion(options)
  const reduced = rm.reducedMotion
  // R1 过渡 / R2 关键帧 / R3 弹性与错峰：三条既有规则各有确定形态，直接映射到四类预设。
  // ⚠️ 全部走 computed：偏好可在运行中切换（matchMedia 的 change 监听），
  //   快照形态会让切换后拿到过期预设 —— 故这里刻意不做 setup 期求值。
  return {
    reduced,
    enterClass: computed(() => enterClass('enterSheet', reduced.value)),
    enterSheet: computed(() =>
      enter({ animationName: 'sheet-enter', reduced: reduced.value }),
    ),
    enterListItem: computed(() =>
      enter({ animationName: 'item-rise', duration: 'medium', reduced: reduced.value }),
    ),
    // 退场时长取 fast 档（决策 3 的已知代价：退场期间占位且不响应滚动，窗口越短越好）
    exitSheet: computed(() => exit({ animationName: 'sheet-exit', duration: 'fast', reduced: reduced.value })),
    exitListItem: computed(() =>
      exit({ animationName: 'item-rise-out', duration: 'fast', reduced: reduced.value }),
    ),
    // R1 ⇒ 类空串 + transition none。R3 不在此判定：按压跟手缩放是独立的几何变化，
    // 由消费方按需经 pressTransform(value, motionReduced) 传入。
    pressColor: computed(() => press({ reduced: reduced.value })),
    pressOpacity: computed(() => press({ property: 'opacity', reduced: reduced.value })),
    pressSize: computed(() => press({ property: 'width', reduced: reduced.value })),
    staggerStepMs: computed(() => stagger({ reduced: reduced.value })),
    staggerDelay: (index: number) => staggerDelay(index, { reduced: reduced.value }),
    dispose: rm.dispose,
  }
}

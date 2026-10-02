// ─── 顶部让位归属与几何（#900 T1 / #901，收口于 #907）───
//
// ## 为什么有这个模块
//
// 顶部让位（状态栏 inset）原先由 App.vue 根容器集中补偿（paddingTop = safeTop）。
// 集中补偿的代价是**任何页面都无法把内容放到状态栏底下** —— 内容盒恒从状态栏下方开始。
// 本模块把「谁负责让位」变成一个**可按路由声明的选择**，并成为该决策的**唯一数值来源**。
//
// ## 两个模式（封闭清单；**只有两个**，且「不特意做什么」不是其中之一）
//
// - 'self'  页面自带一个零内容 spacer 让位。**绝大多数页面。**
// - 'bleed' 两侧都不让位：内容铺到状态栏底下。**沉浸式页专用**（首页 B 变体）。
//
// ## ⚠️ 为什么没有第三种「由根容器补偿」的模式（票 #907 收口时删除）
//
// 它曾经是默认值，但根容器补偿已在收口时**整体删除**（见 App.vue rootStyle）。
// 于是该模式退化成「**完全不让位**」—— 与 'bleed' 逐字节同义，却长得完全不像。
// 留着它等于留一个静默破版的脚枪：任何人给新路由写 'root'（很自然，因为它曾是默认值），
// 页面就会顶到状态栏底下，而**编译过、测试绿、门禁全绿**，只有真机上肉眼可见。
// ⇒ 把它删掉，让「我不管顶部」必须**显式写成 'bleed'**，语义与后果一眼可见。
//
// ## 三条不可让步的约束
//
// 1. **换算比率不在本模块。** safeTop 进来时**已经是逻辑像素**（safeArea.ts 是唯一的
//    物理→逻辑换算点）。本模块与任何消费方都不得再乘除 density —— 上一轮的
//    「每处补偿被放大 density 倍」就是漏了这道换算。
// 2. **让位用零内容元素 + 显式高度，不用父容器 padding。** Lynx 的 border-box UA 默认
//    使 padding 在 border-box 下吃掉内容高度，而 web-core 预览**不复刻**该默认
//    （App.vue 转场包裹层的 pb-18 已登记过这个坑）。spacer 方案两种渲染器下同义。
// 3. **失效方向 = 不让位。** 未知模式回落到 'self'（= 绝大多数页面的正常行为）并告警，
//    绝不静默产生破版布局（测试硬约束 #3 禁静默降级）。
//
// 纯模块（无组件 / 无 DOM / 无 import 副作用）⇒ node 可直接单测，是本仓几何类逻辑的
// 既有形态（对照 swiperMath / feedHelpers）。

/**
 * 顶部让位归属模式（封闭清单，两值）。
 * 路由表必须逐条显式声明（RouteMeta 必填），因此「哪个页面没迁移」是编译期可判的，
 * 而不是靠默认值静默兜底。
 */
export type TopInsetMode = 'self' | 'bleed'

/** 模式词汇表（契约测试据此锁住取值集合，防止悄悄加第三个模式） */
export const TOP_INSET_MODES: readonly TopInsetMode[] = ['self', 'bleed']

/**
 * 一次让位裁决的结果：让位高度恒等于 safeTop 或 0。
 *
 * 只有「让位高度」一个数值字段——顶栏顶边 y 恒等于它本身，作为独立字段曾与
 * barSpacerHeight 逐字节同值（同一表达式赋两字段）且**零消费方**，
 * 留着只会让人误以为「顶栏位置」与「让位高度」是两个可独立调的量。
 */
export interface TopInsetOwnership {
  /** 生效模式（已归一化：非法输入回落到 'self'） */
  readonly mode: TopInsetMode
  /** 页面顶栏自带的让位高度（逻辑 px）。仅 'self' 非 0 */
  readonly barSpacerHeight: number
}

/** 输入归一：非有限 / 负数一律归 0（与 safeArea「非有限值归 0，不污染现值」同策略） */
function normalizeInset(safeTop: number): number {
  return Number.isFinite(safeTop) && safeTop > 0 ? safeTop : 0
}

/** 模式归一：未知模式回落到 'self'（= 绝大多数页面的正常行为）并告警一次 */
let unknownModeWarned = false
function normalizeMode(mode: TopInsetMode): TopInsetMode {
  if (TOP_INSET_MODES.includes(mode)) return mode
  if (!unknownModeWarned) {
    unknownModeWarned = true
    console.warn('[topInset] unknown mode, falling back to self:', mode)
  }
  return 'self'
}

/**
 * 纯函数：给定模式与状态栏安全高度（**逻辑像素**），产出让位的完整归属。
 *
 * 两个模式的结果（safeTop = S ≥ 0）：
 * - 'self'  → barSpacerHeight = S
 * - 'bleed' → barSpacerHeight = 0
 */
export function resolveTopInsetOwnership(mode: TopInsetMode, safeTop: number): TopInsetOwnership {
  const m = normalizeMode(mode)
  return { mode: m, barSpacerHeight: m === 'self' ? normalizeInset(safeTop) : 0 }
}

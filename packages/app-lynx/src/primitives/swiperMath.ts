// ─── 自研 swipe 轮播的纯数学函数（ADR-0115 / spec: app-lynx-recommended-carousel §3.1；
// 吸附阈值 + fling 判定 = ADR-0118 / spec: app-lynx-recommended-carousel-polish-r2 §2.2/§3.1）。
// 无依赖、纯 TS，node 可测（与 createMixFeed / mergeByTime 同「深模块可测」惯例）。
// calcNearestPage 的 oracle = vue-lynx 教程《商品详情页图片轮播》语义（吸附最近页 round + 边界钳制）；
// calcSnapTarget 的 oracle = ADR-0118 决策 2（1/3 屏宽阈值 + fling 甩动，双向对称）。
//
// ⚠️ **本模块是轮播吸附逻辑的唯一实现**，`CarouselSwiper.vue:15` 直接 import
//   `calcSnapTarget` / `clampOffset`；本文件的单测**直接覆盖线上代码**（非规格副本）。
//
//   **为什么此前有人以为它「无生产调用方」**：票 #920 期间曾尝试把轮播改成 vue-lynx 官方
//   主线程（MTS）方案。MTS 形态下 helper 必须内联进组件（主线程打包器对**不含
//   `'main thread'` 指令的模块**只保留 import、剥离函数体** ⇒ MT 函数跨模块 import 本文件
//   会在原生端拿到 `undefined`，表现为组件整块空白，见 docs/research/vue-lynx-swiper-tutorial.md:23）。
//   该重写**未落地**，轮播保持后台线程方案。
//
//   ⚠️ **「主线程不可用」的归因已被证伪并裁决**（2026-10-03，票 #920）：
//     · ADR-0115:88 原写「T5 真机验证判定不通过：主线程方案不可用」；
//     · CONTEXT.md:580 写「完整可用且真机验证通过，ADR-0115 判定需修订」；
//     · 本轮**逐级单变量对照**复刻原型（最小 view → +useMainThreadRef → +main-thread-ref
//       → +单个 bind* → 完整 MTS）：每级均正常渲染（69.9k~70.4k 品红像素），
//       拖动实测蓝条经 `setStyleProperty` 精确跟随平移。
//   ⇒ **MTS 机制本身完整可用**；当年空白的真因是**跨模块 import 无 'main thread'
//     指令的模块**（helper 被 MT 打包器剥离）—— 是**用法**问题，不是机制缺陷。
//     完整裁决记录见 ADR-0115 的「裁决」块与 issue #920。
//   ⇒ 本文件仍是**吸附逻辑的唯一实现**，BG 形态下由 `CarouselSwiper.vue` 直接 import。
//     「仍用 BG」的理由已改为**性能取舍**（MTS 收益仅为跟手增量，不消除 48ms 输入派发地板），
//     不再是「MTS 不可用」。
//
//   ⇒ **若将来再尝试 MTS**：本文件的函数将再次失去生产调用方，届时必须同步处理
//     ① 本注释（改回「无生产调用方」形态）② CarouselSwiper.test.ts 的门禁形态
//     （其条件式判据已按 BG/MTS 双形态写好，见该文件「若采用主线程（MTS）绑定…」一条）。
//     不要留下「已无调用方」的登记却让代码仍 import 它——
//     那是一条**反事实登记**，比不登记更危险：门禁冻结线 #5「会骗人的门禁会被人信」。

/** 吸附阈值（屏宽比例）：拖过 1/3 屏宽松手即翻页，未过回弹（ADR-0118 决策 2） */
export const SNAP_THRESHOLD_RATIO = 1 / 3

/** fling 甩动速度阈值（px/ms）：速度超阈值且位移未到 1/3 时，也沿速度方向翻页（ADR-0118 决策 2） */
export const FLING_VELOCITY_PX_PER_MS = 0.4

/**
 * 松手吸附目标页（ADR-0118 决策 2，替代 calcNearestPage 的 50% round 语义）：
 * - 以**手势起点**（startOffset）为基准：位移（offset - startOffset）过 1/3 屏宽
 *   （|dragFrac| >= SNAP_THRESHOLD_RATIO）→ 沿位移方向翻一页；
 * - 否则若甩动速度超阈值（|velocity| >= FLING_VELOCITY_PX_PER_MS）→ 沿速度方向翻一页
 *   （快甩短距离也翻页）；
 * - 否则回弹起点页。
 * ⚠️ 必须基于起点而非仅最终 offset：位移跨过 50% 中点时 round(offset/W) 已翻页，
 *    仅凭最终 offset 的 frac 会符号反转 → 错误回弹（真实滑动复现，见测试「跨过 50% 中点」回归用例）。
 * startOffset 缺省 0（手势起点 = 第 0 页），调用方（CarouselSwiper）必须传 touchStartOffset。
 * 返回目标 offset（px，**不钳制**——由调用方 clampOffset / updateOffset 边界处理）。
 * 位移方向与速度方向符号约定一致：负 = 左滑 = 下一页（offset 负向）。
 * 非法输入（offset 非有限 / itemWidth <= 0）返回 0（避免 NaN 污染 transform）。
 */
export function calcSnapTarget(
  offset: number,
  itemWidth: number,
  opts?: { velocityPxPerMs?: number; startOffset?: number },
): number {
  if (!Number.isFinite(offset) || itemWidth <= 0) return 0
  const velocity = opts?.velocityPxPerMs ?? 0
  const startOffset = Number.isFinite(opts?.startOffset) ? (opts?.startOffset as number) : 0
  const startPage = Math.round(startOffset / itemWidth)
  const dragFrac = (offset - startOffset) / itemWidth
  let targetPage = startPage
  if (Math.abs(dragFrac) >= SNAP_THRESHOLD_RATIO) {
    targetPage = startPage + Math.sign(dragFrac)
  } else if (Number.isFinite(velocity) && Math.abs(velocity) >= FLING_VELOCITY_PX_PER_MS) {
    targetPage = startPage + Math.sign(velocity)
  }
  // Math.round(-0.32) === -0 → targetPage 为 -0 时返回 -0 会污染 transform（同 clampOffset 的正零归一化惯例）
  return targetPage === 0 ? 0 : targetPage * itemWidth
}

/**
 * 松手吸附到最近页：`round(offset / itemWidth) * itemWidth`。
 * 教程语义：`Math.round(offset / itemWidth) * itemWidth`（offset 为负，向下取整到最近整页）。
 * ⚠️ ADR-0118 后轮播已改用 calcSnapTarget（1/3 阈值 + fling）；本函数保留为教程原义 oracle 对照，
 * 不再被轮播调用。
 * 非法输入（offset 非有限 / itemWidth <= 0）返回 0（避免 NaN 污染 transform）。
 */
export function calcNearestPage(offset: number, itemWidth: number): number {
  if (!Number.isFinite(offset) || itemWidth <= 0) return 0
  return Math.round(offset / itemWidth) * itemWidth
}

/**
 * 边界钳制：上界 0，下界 `-(dataLength - 1) * itemWidth`（教程 `updateOffset` 的 clamp）。
 * dataLength 或 itemWidth 非法返回 0；单条（dataLength=1）上下界均为 0（无滑动空间）。
 */
export function clampOffset(offset: number, dataLength: number, itemWidth: number): number {
  if (!Number.isFinite(offset) || dataLength <= 0 || itemWidth <= 0) return 0
  const upperBound = 0
  // 单条（dataLength <= 1）下界收敛到 0（正零），避免 Math.min(0, -0) 产生 -0 污染 transform
  const lowerBound = dataLength <= 1 ? 0 : -(dataLength - 1) * itemWidth
  return Math.min(upperBound, Math.max(lowerBound, offset))
}

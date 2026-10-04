// 正文「是否高于视口」的几何前置（ADR-0219 §2.3 触底前置 / 票 #930）。
//
// ## 为什么有这个模块（缺陷的形状）
//   单本小说正文**一屏放得下**时，`<list>` 首帧就处在下边界 ⇒ 原生 `@scrolltolower`
//   立即派发 ⇒ 完成判定当场成立 ⇒ 条目立刻离开书架段 3，而用户一字未读。
//   引擎报告的「在底部」在这里是**几何必然**，不是用户行为。
//   故「触底」的口径从「引擎报告在底部」收紧为「**有可滚动的内容** 且 确实滚到了底部」：
//   没有东西可滚，就谈不上「读到了底」。这是语义精化，不是新增规则。
//
// ## [单位] 全程 @375 基准设计 px —— 换算错在这里就会把缺陷放回去
//   两个高度必须**同一基准**才能比：
//   - 正文高：`estimatedHeightPx`（`primitives/novelParagraphEstimate` 的中位段高）**已经是
//     @375 基准设计 px**（该模块头注：行高 22px = 44rpx @375，随屏宽由 vw 缩放但估算取 375 基准）。
//     它是**不随屏宽变**的定数。
//   - 视口高：`utils/viewportGeometry.screenHeightVw()` 产出的是 **vw**（100vw = 屏宽）。
//     vw 是**屏宽的百分数**、随屏宽缩放，直接当 px 用就是错基准。
//   ⇒ 换算：`(vw / 100) × 375`，把视口折到与正文同一个 @375 基准上。
//   这也正是「一屏放得下」这个判断正确的形式：两个量都回到设计稿后比，比的是**比例**，
//   屏宽变化（旋转 / 分屏）不会把结论带偏。
//
// ⚠️ **反例（换算写错的两个方向，各自会让缺陷以不同形式回来）**：
//   ① 忘乘 375/100（拿 216.4vw 当 216.4px）⇒ 视口**小 3.75 倍** ⇒ 几乎所有正文都「高于视口」
//      ⇒ 一屏放得下的短文照样判完成 ⇒ **原缺陷原样复发**；
//   ② 忘除 100（拿 216.4vw 当 81075px）⇒ 视口**大到离谱** ⇒ 任何正文都「放得下」
//      ⇒ 长篇也永远判不出完成 ⇒ 功能反向失效。
//   两个方向都由 `novelContentFitsViewport.test.ts` 的反例用例钉死。
//
// ## 禁静默降级（测试硬约束 #3）
//   视口高**拿不到真实测量**时（既无内容区契约尺寸、也无 SystemInfo —— 只剩 web-core 兜底猜测）
//   ⇒ `viewportHeightPx = null` + `viewportMeasured = false`，
//   **不猜**、**不静默**当「可完成」也不当「不可完成」：本模块返回**保守侧**
//   （`contentExceedsViewport = false` = 不判完成），由调用方**显式 console.warn**。
//   为什么这一侧保守：判错的代价不对称 —— 误完成 = 软删用户书架里的书（吞数据，
//   条目当场离场）；漏完成 = 条目多留一会儿，用户读完再触底一次就补上（自愈）。
//   与 `decideNovelCompletion` 里「章节坐标不可确定 ⇒ 不完成」同一口径。
//
// ## 📌 「为何不用停留时长」（票 #930，防后人重复发明同一道被否决的方案）
//   「一屏放得下就被立刻判完成」最直觉的修法是加一道「停留 ≥ N 毫秒」门槛，
//   而本仓**确有**现成先例：`primitives/watchlistPrompt.ts` 的 `WATCHLIST_PROMPT_MIN_DWELL_MS`
//   （追更询问弹窗用的最小停留时长），停留时长本身也拿得到。**产品负责人已明确否决该方案**，故在此留痕：
//   - 那是**任意阈值**：要拍一个秒数，而秒数长短与「读没读完」**没有因果关系**——
//     慢读者被误伤（读完了却没到时长，条目赖在书架上）、快读者漏判（划一下就过阈值）。
//   - 本前置用的是**客观事实**：内容高度 / 视口高度。**没有东西可滚，就谈不上读到了底**——
//     这是定义，不是估计。屏再大、书再短，这个结论都成立。
//   一句话：**一个是要拍的数，一个是要测的量**。要拍的数迟早会被重提，故写在这里。
//   （展开版决策理由另见 `stores/continueReadingStore.ts` 的 `decideNovelCompletion` 头注；
//     那份不复述本仓另一子系统的常量名——`continueReadingCompletion.test.ts` 的
//    「术语文档易混辨析 #1」守卫刻意禁止续读 store 出现稍后看/追更任何标识符。）
//
// 无 Vue / 无原生模块依赖、纯函数、node 可测（同 utils/viewportGeometry.ts 的分层惯例）；
// 组件只做薄接线。

import {
  screenHeightVw,
  type ViewportContentSize,
  type ViewportSystemInfo,
} from '../utils/viewportGeometry'

/**
 * 设计基准屏宽（@375）。**唯一**的 vw ↔ 设计 px 换算基准。
 * 与 `glossary-lynx-units.md`（375 设计稿，1sp = 2rpx、1dp = 0.2667vw）同源。
 */
export const DESIGN_BASE_WIDTH_PX = 375

/**
 * vw → @375 基准设计 px。
 *
 * [单位] vw 是「屏宽的百分数」（100vw = 屏宽），不是 px。漏掉 `/100 × DESIGN_BASE_WIDTH_PX`
 * 就是上面头注登记的两个反例方向之一，故本函数是**唯一**的换算入口，调用点不得自行折算。
 */
export function viewportHeightDesignPx(screenHeightVwValue: number): number {
  return (screenHeightVwValue / 100) * DESIGN_BASE_WIDTH_PX
}

/**
 * 正文总高估算（@375 基准设计 px）= 段数 × 中位段高。
 *
 * 用「中位段高 × 段数」而非逐段求和：`estimatedHeightPx` 取的就是中位口径
 * （对长文常见的「少数超长段 + 多数短段」形态，中位比均值更稳），
 * 乘法是它在列表级估算里的同口径外推。空正文（段数 0）⇒ 0，一并由调用方按「不判完成」处理。
 */
export function novelContentHeightPx(paragraphCount: number, avgParagraphHeightPx: number): number {
  if (paragraphCount <= 0) return 0
  return paragraphCount * avgParagraphHeightPx
}

/** 几何解算结果（三量同基准：@375 基准设计 px） */
export interface NovelContentGeometry {
  /** 视口高（@375 基准设计 px）；**`viewportMeasured === false` 时为 null**（拿不到，不猜） */
  viewportHeightPx: number | null
  /** 视口高是否有**真实测量来源**（内容区契约 or SystemInfo）；false = 只剩 web-core 兜底猜测 */
  viewportMeasured: boolean
  /** 正文总高估算（@375 基准设计 px） */
  contentHeightPx: number
  /**
   * 前置条件：正文内容**高于**视口（严格 `>`）。
   * `viewportMeasured === false` 时恒为 `false`（保守侧，见头注「禁静默降级」）。
   */
  contentExceedsViewport: boolean
}

/** 解算入参：视口两个来源 + 正文两件套（与 `NovelDetail.vue` 里的同名量一一对应） */
export interface NovelContentGeometryInput {
  /** 原生内容区尺寸（ADR-0131 契约；未布局/异常为 null） */
  contentSize: ViewportContentSize | null
  /** 全屏物理尺寸（lynx 全局 `SystemInfo`；web-core 预览为 undefined） */
  systemInfo: ViewportSystemInfo | undefined
  /** 段落数（正文切段后的长度） */
  paragraphCount: number
  /** 中位段高（`estimatedHeightPx`，**已是 @375 基准设计 px**） */
  avgParagraphHeightPx: number
}

/** 尺寸有效：number、有限、> 0（NaN / Infinity / <=0 均无效——含原生未布局哨兵 -1×-1） */
function isPositiveSize(n: number): boolean {
  return Number.isFinite(n) && n > 0
}

/**
 * 解算「正文是否高于视口」。
 *
 * 视口高沿用 `screenHeightVw` 的三路径优先级（内容区 > SystemInfo > web-core 兜底，
 * ADR-0131 决策 2/3）；本模块额外把**「只是兜底猜的」**标出来（`viewportMeasured = false`），
 * 好让调用方能显式 warn —— `screenHeightVw` 本身恒返回一个数，那个数是猜测还是测量它不区分。
 */
export function resolveNovelContentGeometry(
  input: NovelContentGeometryInput,
): NovelContentGeometry {
  const { contentSize, systemInfo, paragraphCount, avgParagraphHeightPx } = input
  const contentHeightPx = novelContentHeightPx(paragraphCount, avgParagraphHeightPx)
  // 「有真实测量」= 内容区契约有效 **或** SystemInfo 存在。两者皆无 ⇒ 只剩 216.4vw 兜底猜测。
  const measured = isPositive(contentSize) || systemInfo != null
  if (!measured) {
    return {
      viewportHeightPx: null,
      viewportMeasured: false,
      contentHeightPx,
      contentExceedsViewport: false, // 保守侧：宁可不判完成，也不软删用户书架里的书
    }
  }
  const viewportHeightPx = viewportHeightDesignPx(screenHeightVw(contentSize, systemInfo))
  return {
    viewportHeightPx,
    viewportMeasured: true,
    contentHeightPx,
    contentExceedsViewport: contentHeightPx > viewportHeightPx,
  }
}

function isPositive(size: ViewportContentSize | null): size is ViewportContentSize {
  return size != null && isPositiveSize(size.w) && isPositiveSize(size.h)
}

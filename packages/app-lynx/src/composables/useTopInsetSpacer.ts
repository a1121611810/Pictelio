// ─── 顶部安全区让位 spacer 高度（#900 T1 的公共层）───
//
// ## 为什么抽这个 composable
//
// 让位高度只有一条规则：读当前路由的 meta.topInset 裁决，让位高 = safeTop（'bleed' 时 0）。
// 这条规则此前在 11 个页面里**逐字重复**了 11 遍（还分裂成三个名字：barSpacerHeight /
// topInsetSpacerHeight / topBarSpacer）。逐字重复的代价不是"多打几行"——
// 它让"漏一处"成为**结构性必然**而非偶然：将来改规则（多一个模式、换算口径调整、
// 单位边界变更）要改 11 个文件，任何一处漏改的后果是内容顶进状态栏，而
// **编译过、测试绿、门禁全绿**，只有真机上肉眼可见。
//
// 这与 ADR-0194 把六个页级顶栏收进公共组件是同一条判断的延伸：公共层的价值不在
// "少写几行"，而在**让修一处成为可能**。抽取后改规则只有 utils/topInset.ts 一处真相。
//
// 约束不变（照搬原注释，仍然有效）：
// - safeTop 进来**已是逻辑像素**（safeArea.ts 是物理→逻辑的唯一换算点），此处不得乘除 density。
// - 数值唯一来源仍是 utils/topInset.ts；本文件不做任何模式判断、默认值或兜底。
// - 页面仍需自己渲染那个零内容 spacer（Lynx 的 border-box UA 下 padding 会吃掉内容高度）。
import { computed, type ComputedRef } from 'vue'
import { routeState } from '../router'
import { safeTop } from '../utils/safeArea'
import { resolveTopInsetOwnership } from '../utils/topInset'

/**
 * 当前路由的顶部让位 spacer 高度（逻辑 px），随 meta.topInset 与 safeTop 响应式变化。
 *
 * - 'self'（绝大多数页面）→ 让位高 = safeTop
 * - 'bleed'（沉浸式页）    → 恒 0，spacer 渲染成 0 高、不让位
 *
 * 调用方把它绑到顶栏行**之前**的零内容 view 的行内 height 上。
 */
export function useTopInsetSpacer(): ComputedRef<number> {
  return computed(() => resolveTopInsetOwnership(routeState.value.topInset, safeTop.value).barSpacerHeight)
}

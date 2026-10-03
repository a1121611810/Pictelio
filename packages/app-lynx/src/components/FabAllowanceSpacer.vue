<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useGlobalFabStore } from '../stores/globalFab'
import { fabAllowanceHeightVw } from '../utils/fabGeometry'

const fab = useGlobalFabStore()
const { view } = storeToRefs(fab)

/**
 * 让位高度（vw）。
 *
 * ⚠️ **必须**把 `view.value.routeMode` **原样**传给 `fabAllowanceHeightVw`，不要在组件里
 * 写降级三元。原因：`hidden` 的降级逻辑住在 `fabGeometry` 内、被数值判据覆盖；
 * 若挪到组件侧，它就只剩「文件里出现过 routeMode 这个词」的文本判据守着 ——
 * 实测那种判据可被「硬编码 `'menu'` + 留一个读 routeMode 的死变量」骗过而全绿。
 */
const heightVw = computed(() => fabAllowanceHeightVw(view.value.routeMode))

// FabAllowanceSpacer —— 底部遮挡让位占位（ADR-0217 / 票 #922 / spec docs/specs/bottom-occlusion-allowance.md）
// 术语文档：docs/adr/glossary-bottom-occlusion-allowance.md（**权威**）
//
// ## 它是什么
// 一个**零业务、零内容**的占位块，高度由 `utils/fabGeometry.ts` 的 `fabAllowanceHeightVw(mode)`
// 求值（**不是** Tailwind 档位），供**滚动容器末尾**挂载，让末项能滚到 GlobalFab 之上。
//
// ## 高度按**路由**自动分档（本组件最重要的一条）
//
// `GlobalFab` 在两种路由下几何完全不同（ADR-0132 决策 2 / 票 #922）：
//
// | 档位 | 页面 | FAB 底边 | 让位高度 |
// |---|---|---|---|
// | `menu` | 4 个顶层 tab 页 | 4.267vw | **19.2vw** |
// | `search` | 其余全部非 tab 内容页 | 43.734vw | **58.668vw** |
//
// ⇒ 本组件读 `globalFab.view.routeMode`（**路由派生**档位）自动取档，**页面不传任何高度**。
// 这不是省事，是**防呆**：此前 9 个非 tab 页各自按 19.2vw 让位、比真实遮挡源少 39.467vw，
// 真机实测末项被搜索 FAB 压住（点末项右侧开的是搜索弹层）。若让页面自己声明档位，
// 新页面漏写就会静默落到 19.2vw —— 正是这次事故的形态。
//
// ⚠️ 必须用 `routeMode` 而**不是** `mode`：`mode` 叠加了「弹层打开 → hidden」，
// 跟着它走会让让位高度在弹层开关的瞬间跳变 ⇒ 内容整体重排。
//
// ⚠️ 非 `menu` 一律取高档：档位算小了会**遮挡内容**（末项点不到），
// 算大了只多一段看不见的空白（零内容透明块）。失败方向不对称 ⇒ 取保守侧。
//
// ## 为什么是这个形态（三条业界共识 + 一条 Lynx 约束）
//
// 1. **共识 A（内容级 inset）**：Android 官方要求内容滚到遮挡物之下、靠**内容级** padding 让末项
//    不被遮（`contentPadding` ≠ 容器 padding —— 后者会 clip 内容、阻止滚到栏下）。
//    本项目用「滚动内容末尾的零内容块」承担同一语义。
// 2. **共识 B（局部解决）**：要点转述「系统默认已处理安全区，**只有自加的遮挡物才需要额外 inset**」
//    ——⚠️ 这是**要点转述，非 iOS HIG 逐字原话**：所链是 SwiftUI `safeAreaInset` API 参考页，正文极短、
//    不是 HIG 原文（口径与来源见 ADR-0217 §1.3 B 条与其 §5）。GlobalFab 正是自绘遮挡物
//    ⇒ 归内容侧解决，**不升级为根容器级固定带**。
// 3. **共识 C（单一消费）**：系统栏 inset 仍由根容器消费一次（`App.vue` 的 `paddingBottom: safeBottom`）；
//    本占位只算 FAB 几何，**两者正交、互不叠加**。
// 4. **Lynx 约束**：原生 `<list>` 无 `contentPadding`（唯二的 list 专属 CSS 是
//    `list-main-axis-gap` / `list-cross-axis-gap`），且瀑布流 list-item **插入=丢弃 / 移除=留空位 /
//    替换=错位**（ADR-0162）⇒ 只能在**末尾追加**（已 T0 spike 真机验证安全，ADR-0217 §3）。
//
// ## 为什么用零内容块而不用父容器 padding
// 与顶部让位同因（`utils/topInset.ts` 约束 2）：Lynx 的 border-box UA 默认会让 padding 吃掉内容
// 高度，而 web-core 预览**不复刻**该默认 ⇒ 同一串类在两套渲染器下不同义。
//
// ## 为什么高度走 `utils/fabGeometry` 共享模块
// 让位高度 = FAB 自身几何。跟随成立的**唯一机制**是 `GlobalFab` 与本占位
// **同 import 这一组 JS 常量** —— 改 FAB 尺寸 / 改 search 抬高推导，两边一起变。
// 换成 Tailwind 编译期档位或任何字面量，这个数就**多出一个独立来源**；而档位与 JS 几何不同源、
// 根本带不动对方：code-review 实测把 `spacing.18` 改成 30vw，占位高度纹丝不动。
// ⇒ 高度不得回退为档位或字面量，必须经共享模块求值（spec C4）。
//
// ## 使用约束
// - 原生 `<list>` 里必须由外层 `<list-item full-span>` 包裹（本组件只出内容，与
//   `FeedListFooter` 完全同构 —— 原生 list 只认 list-item 子节点）。
// - **不得**被 `v-if` 条件化：那样在最常见的「有数据、未加载更多、未到底」态下会整个消失
//   （spec C1 / ADR-0217 §2.2）。
// - 本组件**不含业务**：不判 FAB 可见性、不随滚动变化、不随弹层开关变化；
//   它只读**路由派生**的几何档位。
</script>

<template>
  <!-- 零内容：只撑高度。视觉上与页面底色同色（透明），用户看不到「带」，
       只感到「末项不再被 FAB 压住」。

       ⚠️ 高度走 **inline :style 从 fabGeometry 按路由档位算出**，不是 Tailwind 的 `h-18` 档位：
         档位是编译期常量，与 FAB 的 JS 几何无关联 —— 两者并存时「改 FAB 尺寸占位跟随」
         是假的（code-review Spec B1 实测：spacing.18 改 30vw 门禁仍全绿）。
         走共享模块后这句话才成立：GlobalFab 与本占位读**同一**个 FAB_SIZE_VW / FAB_EDGE_VW。 -->
  <view class="w-full" :style="{ height: `${heightVw}vw` }" />
</template>

<script setup lang="ts">
// PageTopBar —— 页级顶栏（公共层六组件之一，ADR-0194 / T1 #748；术语表「PageTopBar（页级顶栏）」）。
//
// 两变体（零行为变化抽取：类串 / a11y 挂法逐字对齐各页存量手写头，spec D2）：
//   a) 居中标题变体（一级页，无返回）：back 缺省 → items-center justify-center 容器 + 单行标题
//   b) ‹返回 + 标题 + 右动作变体（二级页）：back → items-center 容器 + py-1 pr-2 返回键
//      + flex-1 标题 + action slot
//
// 接口（调用方需要知道的全部）：
//   :title              已解析标题文案（调用方 i18n 传入；组件零文案，noDeadKeys 面不变）
//   :back               true = 渲染 ‹ 返回键（变体 b）；缺省 false = 变体 a
//   :back-a11y-label    返回键 a11y 标签（a11y 注册表 value 或 t() 动态结果，
//                       M3SegmentedButton 同款双形态契约）；缺省 = 返回键不标注
//                       （与存量无 a11y 页面逐字一致，ADR-0061：element + label 成对）
//   :title-a11y-label   标题 a11y 标签；缺省 = 标题不标注
//   :title-class        标题附加类（存量差异单点保留：text-center / [max-line:1]），
//                       基类恒为 flex-1 text-title-large font-medium text-surface-on
//   @back               返回键 tap → 上抛；goBack / requestBack 决策留调用方（spec D2）
//   #action             右动作 slot（变体 b；存量页为空，为后续页面预留）
//
// 顶部安全区让位（#900 T1）：让位归属按路由 meta.topInset 声明，数值唯一来源 =
// utils/topInset.ts。本组件在 'self' 模式下自带让位（顶栏行**之前**一个零内容 spacer），
// 'bleed'（沉浸式页）下高度恒 0 ⇒ 渲染成 0 高、不让位。消费页零改动即生效。
//
// 平台事实：返回键 @tap 绑在 view 上——text 根级 @tap 原生无效（ADR-0055 家族）。
import { computed } from 'vue'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { safeTop } from '../utils/safeArea'
import { resolveTopInsetOwnership } from '../utils/topInset'
import { routeState } from '../router'
import AppIcon from './AppIcon.vue'

defineProps<{
  /** 已解析标题文案（调用方经 i18n 传入，组件零文案） */
  title: string
  /** true = ‹返回 + 标题变体（二级页）；缺省 = 居中标题变体（一级页） */
  back?: boolean
  /** 返回键 a11y 标签；缺省不标注（存量无 a11y 页面保持逐字一致） */
  backA11yLabel?: string
  /** 标题 a11y 标签；缺省不标注 */
  titleA11yLabel?: string
  /** 标题附加类（存量差异：text-center / [max-line:1]），基类不动 */
  titleClass?: string
}>()

const emit = defineEmits<{ (e: 'back'): void }>()

// ─── 顶部安全区让位高度（逻辑 px）───
// 走零内容元素 + 行内 height，**不给顶栏行加 paddingTop / pt-***：Lynx 的 border-box UA
// 默认会让 padding 吃掉内容高度，而 web-core 预览不复刻该默认（App.vue 转场包裹层的 pb-18
// 已登记过这个坑）⇒ 同一串类在两种渲染器下不同义。底部弹层家族的 safeBottom spacer 是同款范本。
// 单位边界：safeTop 进来**已是逻辑像素**（safeArea.ts 是物理→逻辑的唯一换算点），此处不得再乘除 density。
// 'bleed' 恒为 0 是正确行为（0 高 spacer = 透明不可见），不特判。
const barSpacerHeight = computed(
  () => resolveTopInsetOwnership(routeState.value.topInset, safeTop.value).barSpacerHeight,
)
</script>

<template>
  <!-- 单根纵向容器：spacer 必须与顶栏行同属一个纵向流才能把行顶下去。
       ⚠️ 不做 fragment 多根（spacer 无条件 + 变体行条件 = 真多根）：vue-lynx 的多根支持
       未验证，ADR-0123 已把「多根模板」列为否决方案 ⇒ 这里坚持单根。 -->
  <view class="w-full flex flex-col">
    <!-- 顶部安全区让位（'self' 模式非 0；其余模式 0 高）。零内容 + 行内 height，**不染色**：
         状态栏区域的底色透出页面根容器的 surface 背景（与底部弹层家族同款做法）。 -->
    <view :style="{ height: barSpacerHeight + 'px' }" />

    <!-- 变体 b：‹返回 + 标题（+ 右动作 slot）。返回键 a11y 双分支 = 存量两种挂法逐字保留：
         有 label → element + label 成对（ADR-0061）；无 label → 裸 view（不进 a11y 树）。
         同理标题 a11y 也双分支（绑 undefined 的平台行为未验证，不用条件绑定混挂）。 -->
    <view v-if="back" class="flex flex-row items-center h-[17.067vw] px-4 bg-surface">
      <view
        v-if="backA11yLabel"
        class="py-1 pr-2"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="backA11yLabel"
        @tap="emit('back')"
      >
        <AppIcon name="arrow_back" class="text-surface-on" />
      </view>
      <view v-else class="py-1 pr-2" @tap="emit('back')">
        <AppIcon name="arrow_back" class="text-surface-on" />
      </view>
      <text
        v-if="titleA11yLabel"
        class="flex-1 text-title-large font-medium text-surface-on"
        :class="titleClass"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="titleA11yLabel"
        >{{ title }}</text
      >
      <text v-else class="flex-1 text-title-large font-medium text-surface-on" :class="titleClass">{{ title }}</text>
      <!-- 右动作 slot：变体 b 预留（存量页为空） -->
      <slot name="action" />
    </view>
    <!-- 变体 a：居中标题（一级页）。存量消费页（IllustList/NovelList）均无 a11y，不开接口 -->
    <view v-else class="flex flex-row items-center justify-center h-[17.067vw] px-4 bg-surface">
      <text class="text-title-large font-medium text-surface-on">{{ title }}</text>
    </view>
  </view>
</template>

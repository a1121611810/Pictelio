<!-- ─── app-lynx M3 segmented button single source of truth ───
     spec: docs/specs/app-lynx-m3-segmented-button.md §4
     ADR: docs/adr/ADR-0190-app-lynx-m3-segmented-button-component.md
     Interface: { options, v-model, disabled? } — 段级 a11y 自持（每段独立焦点 + 静态 label），选择事件组件自持
     ─────────────────────────────────────────────────── -->
<script lang="ts">
/** 分段控件段选项：公开数据契约（spec §4.2 / ADR-0190） */
export interface M3SegmentOption<T extends string> {
  /** 枚举值：选中即 v-model 的值 */
  value: T
  /** label = 已解析文案（调用方传 t() 的结果；options 须用 computed 构建以随语言切换重算） */
  label: string
  /** a11yLabel = 静态 a11y label（调用方引用 ME_A11Y_LABELS 注册表 key，注册表完整性测试继续生效） */
  a11yLabel: string
}
</script>

<script setup lang="ts" generic="T extends string">
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'

const modelValue = defineModel<T>({ required: true })

const props = withDefaults(
  defineProps<{
    options: M3SegmentOption<T>[]
    /** 禁用：容器置灰 + 段 tap 忽略（TranslateModeSwitch 需求，spec §4.2） */
    disabled?: boolean
  }>(),
  { disabled: false },
)

/** 内部私有纯函数——组件自测专用，不进公开接口（spec §4.3 / §5.2）。
 *  段间分隔线按 index 自动生成（index > 0 恒带 border-l border-l-outline），
 *  N 段 = N-1 条，根治「修 2 漏 1」式 drift（spec §2） */
function segmentClass(selected: boolean, index: number): string {
  const base =
    'flex-1 h-[10.667vw] flex items-center justify-center active:bg-layer-pressed-on-surface'
  const divider = index > 0 ? ' border-l border-l-outline' : ''
  const tone = selected ? ' bg-secondary-container' : ' bg-surface-container-lowest'
  return base + divider + tone
}

/** 内部私有纯函数——组件自测专用，不进公开接口（spec §4.3 / §5.2） */
function textClass(selected: boolean): string {
  return selected ? 'text-secondary-on-container' : 'text-surface-on'
}

/** 段选中：disabled 或选中当前段时短路（spec §4.2 disabled 语义） */
function select(value: T): void {
  if (props.disabled || value === modelValue.value) return
  modelValue.value = value
}
</script>

<template>
  <view
    class="flex flex-row gap-0 rounded-[var(--md-shape-full)] border border-outline overflow-hidden"
    :class="disabled ? 'opacity-50' : ''"
  >
    <!-- 段级 a11y 组件自持（与 M3Switch 相反，spec §4.2）：每段独立焦点 + 各自静态 label -->
    <view
      v-for="(option, index) in options"
      :key="option.value"
      :class="segmentClass(modelValue === option.value, index)"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="option.a11yLabel"
      @tap="select(option.value)"
    >
      <text
        class="text-label-large"
        :class="textClass(modelValue === option.value)"
      >{{ option.label }}</text>
    </view>
  </view>
</template>

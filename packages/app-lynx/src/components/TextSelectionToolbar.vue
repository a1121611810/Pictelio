<script setup lang="ts">
// 选中操作菜单视图（spec docs/specs/app-lynx-novel-text-selection.md §ID 4）。
//
// 哑组件：`view` 进、`copy`/`search` 出，零决策（会话状态与收起规则全在 createTextSelection）。
// 视觉 = 原型方案 E + 图标 I1（浅色 M3 浮层 + 线性图标在上文字在下；
// docs/prototypes/lynx-novel-text-selection-toolbar.html，分支 prototype/lynx-text-selection-toolbar）。
// 尺寸取自 selectionToolbarGeometry 的常量（「量=画」同源）；不铺全屏层（ADR-0123）。
import { computed } from 'vue'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import AppIcon from './AppIcon.vue'
import {
  TOOLBAR_ITEM_GAP_VW,
  TOOLBAR_ITEM_VW,
  TOOLBAR_PADDING_H_VW,
  TOOLBAR_PADDING_V_VW,
} from '../primitives/selectionToolbarGeometry'
import type { ToolbarItem } from '../primitives/createTextSelection'

const props = defineProps<{
  /** 会话视图：visible=false 或 style=null → 不渲染任何元素（页面忘写 v-if 也不会画出幽灵层） */
  view: {
    visible: boolean
    style: Record<string, string> | null
    items: readonly ToolbarItem[]
  }
}>()

const emit = defineEmits<{
  /** 条目动作（会话据此执行；组件不关自己） */
  action: [key: ToolbarItem['key']]
}>()

/** 定位（会话给）+ 尺寸（常量给）合并成一份 style */
const containerStyle = computed<Record<string, string>>(() => ({
  ...(props.view.style ?? {}),
  padding: `${TOOLBAR_PADDING_V_VW}vw ${TOOLBAR_PADDING_H_VW}vw`,
}))

const itemStyle = computed<Record<string, string>>(() => ({
  width: `${TOOLBAR_ITEM_VW}vw`,
  height: `${TOOLBAR_ITEM_VW}vw`,
}))
</script>

<template>
  <view
    v-if="view.visible && view.style"
    class="absolute z-30 flex flex-row items-center bg-surface-container-high rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-3)]"
    :style="containerStyle"
    @tap.stop
  >
    <view
      v-for="(item, index) in view.items"
      :key="item.key"
      class="flex flex-col items-center justify-center"
      :style="{ ...itemStyle, marginLeft: index === 0 ? '0' : `${TOOLBAR_ITEM_GAP_VW}vw` }"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="item.label"
      @tap.stop="emit('action', item.key)"
    >
      <!-- 「复制」图标：<AppIcon name="content_copy">（ADR-0208 决策 5——Material Symbols
           有对应字形，手绘矩形已删；保留手绘只会让「登记了字形却零消费」长期共存）。
           :size=4.2667 = 16sp 标准图标尺寸（1sp=0.2667vw），全仓 AppIcon 调用同口径（裸数字 + vw）。
           ⚠️ **不是与手绘版视觉等价**：手绘墨迹是 w-[2.8vw] × h-[3.2vw] 的描边矩形，
           新字形是 4.2667vw 的 em 盒（Material Symbols 在 24 网格上内容约占 20/24
           ⇒ 墨迹 ≈3.56vw），线度量级差 1.4–1.5×，实际是**变大**。
           这里选 16sp 是因为它是 MD3 标准图标尺寸，不是因为「看起来一样」。
           条目盒恒为 TOOLBAR_ITEM_VW（几何常量，12.2vw），故换图标不动布局。
           配色承接原来的 border-on-surface——手绘矩形里的
           bg-surface-container-high 只是为了「挖空」下层描边的衬底，不是配色选择。 -->
      <AppIcon v-if="item.key === 'copy'" name="content_copy" :size="4.2667" class="text-on-surface" />
      <!-- 「搜索」图标：仍是 view 绘制（border + rotate）。ADR-0208 决策 5 的手绘替换范围
           只写了「复制」，本轮不扩到搜索项——它没有登记字形，替换要连带登记
           iconMap + 重跑子集字体，属另一次改动。 -->
      <view v-else class="relative w-[4.9vw] h-[4.9vw]">
        <view
          class="absolute left-[0.2vw] top-[0.2vw] w-[2.8vw] h-[2.8vw] border-[0.28vw] border-solid border-on-surface rounded-full"
        />
        <view
          class="absolute left-[2.9vw] top-[3vw] w-[1.7vw] h-[0.33vw] bg-on-surface rounded-full rotate-45 origin-left"
        />
      </view>
      <text
        class="text-[2.4vw] leading-[3vw]"
        :class="item.state === 'error' ? 'text-error' : 'text-on-surface'"
        >{{ item.label }}</text
      >
    </view>
  </view>
</template>

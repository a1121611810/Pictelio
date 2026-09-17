<script setup lang="ts">
// 选中操作菜单视图（spec docs/specs/app-lynx-novel-text-selection.md §ID 4）。
//
// 哑组件：`view` 进、`copy`/`search` 出，零决策（会话状态与收起规则全在 createTextSelection）。
// 视觉 = 原型方案 E + 图标 I1（浅色 M3 浮层 + 线性图标在上文字在下；
// docs/prototypes/lynx-novel-text-selection-toolbar.html，分支 prototype/lynx-text-selection-toolbar）。
// 尺寸取自 selectionToolbarGeometry 的常量（「量=画」同源）；不铺全屏层（ADR-0123）。
import { computed } from 'vue'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
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
      <!-- 线性图标（view 绘制：border + border-radius + rotate；spec 禁回退为 emoji/字形） -->
      <view v-if="item.key === 'copy'" class="relative w-[4.9vw] h-[4.9vw]">
        <view
          class="absolute left-[1.5vw] top-[0.2vw] w-[2.8vw] h-[3.2vw] border-[0.28vw] border-solid border-on-surface rounded-[0.65vw]"
        />
        <view
          class="absolute left-[0.2vw] top-[1.5vw] w-[2.8vw] h-[3.2vw] border-[0.28vw] border-solid border-on-surface rounded-[0.65vw] bg-surface-container-high"
        />
      </view>
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

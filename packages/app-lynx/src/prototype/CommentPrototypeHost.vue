<script setup lang="ts">
// ─── PROTOTYPE（throwaway）：评论区 UI 形态验证宿主 ───
// 3 个结构不同的变体 + 底部浮动切换条（A/B/C 循环）。
// 验证问题：「评论在 lynx 里用什么形态呈现」——底部弹层 / 全屏页 / 页内区块。
// 验证完整体移入 throwaway branch，不入 main。
import { ref, computed, markRaw, type Component } from 'vue'
import VariantSheet from './variantSheet.vue'
import VariantFullPage from './variantFullPage.vue'
import VariantInline from './variantInline.vue'

interface VariantDef {
  key: string
  label: string
  comp: Component
}

const variants: VariantDef[] = [
  { key: 'A', label: '底部弹层', comp: markRaw(VariantSheet) },
  { key: 'B', label: '全屏页', comp: markRaw(VariantFullPage) },
  { key: 'C', label: '页内区块', comp: markRaw(VariantInline) },
]

const idx = ref(0)
const current = computed(() => variants[idx.value])

function next() {
  idx.value = (idx.value + 1) % variants.length
}
function prev() {
  idx.value = (idx.value + 2) % variants.length
}
</script>

<template>
  <view class="w-full h-full">
    <component :is="current.comp" />

    <!-- 浮动切换条：DOM 顺序最后 = 最上层（规避 lynx z-index 坑，调研报告 §3.1）；
         高对比 pill，明显不属于被评审的设计 -->
    <view class="absolute left-0 right-0 bottom-[6vw] flex justify-center">
      <view
        class="flex flex-row items-center gap-4 bg-brand rounded-[var(--borderRadiusCircular)] px-5 py-2.5 shadow-[var(--elevation4)]"
      >
        <text class="text-xl text-onBrand px-2" @tap="prev">‹</text>
        <view class="flex flex-col items-center">
          <text class="text-base font-semibold text-onBrand">{{ current.key }} — {{ current.label }}</text>
          <text class="text-xs text-onBrand opacity-80">PROTOTYPE · 点 ‹ › 切换</text>
        </view>
        <text class="text-xl text-onBrand px-2" @tap="next">›</text>
      </view>
    </view>
  </view>
</template>

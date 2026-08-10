<script setup lang="ts">
// ─── 错误页 UI 原型外壳（仅 web 预览入口使用） ───
// 3 个结构变体 + 浮动切换条。数据（detail）在壳层计算后传入各变体，
// 与 UI skill 的「数据获取在切换器之上」一致。
import { ref } from 'vue'
import { fatalError, presentError } from '../utils/errorPresentation'
import VariantA from './VariantA.vue'
import VariantB from './VariantB.vue'
import VariantC from './VariantC.vue'
import PrototypeSwitcher from './PrototypeSwitcher.vue'

const variants = [
  { key: 'A', name: '居中极简' },
  { key: 'B', name: '详情卡片' },
  { key: 'C', name: '全屏色块' },
]
const current = ref('A')
// 统一分档文案（presentError 对 UNAUTHORIZED 样例输出「登录已过期 (HTTP 401)。请重新登录」）
const detail = presentError(fatalError, '登录已过期')

function onVariantChange(key: string): void {
  current.value = key
}
</script>

<template>
  <view class="w-full h-full relative">
    <VariantA v-if="current === 'A'" :detail="detail" />
    <VariantB v-else-if="current === 'B'" :detail="detail" />
    <VariantC v-else :detail="detail" />
    <PrototypeSwitcher :variants="variants" :current="current" @change="onVariantChange" />
  </view>
</template>

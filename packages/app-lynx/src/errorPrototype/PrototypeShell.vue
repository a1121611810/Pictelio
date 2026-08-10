<script setup lang="ts">
// ─── 错误页 UI 原型外壳（仅 web 预览入口使用） ───
// 3 个结构变体 + 浮动切换条。数据（detail）在壳层计算后传入各变体。
// 注意：web-core 预览下 Tailwind utility 类 / tokens CSS 变量 / rpx 均不生效
//（全局 CSS 未注入 lynx-view shadowRoot），故变体全部使用内联 style + 具体色值 + px。
// 真机 lynx 环境不受此限制；选定变体 fold 进生产时换回 Tailwind 类 + Fluent 令牌。
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
// 注意：script 内访问 ref 必须 .value（模板中才会自动解包）
const detail = presentError(fatalError.value, '登录已过期')

function onVariantChange(key: string): void {
  current.value = key
}
</script>

<template>
  <view style="width: 100%; height: 100%; position: relative;">
    <VariantA v-if="current === 'A'" :detail="detail" />
    <VariantB v-else-if="current === 'B'" :detail="detail" />
    <VariantC v-else :detail="detail" />
    <PrototypeSwitcher :variants="variants" :current="current" @change="onVariantChange" />
  </view>
</template>

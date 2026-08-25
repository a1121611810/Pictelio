<script setup lang="ts">
// ─── [PROTOTYPE 用完即弃] 收藏/取消收藏动效选型舞台 ───
// 问题：app-lynx BookmarkButton 的收藏/取消收藏该用哪种动效？
// 4 个变体（A 粒子爆发 / B 纯弹跳 / C 波纹环 / D 浮心飘出），底部悬浮条 ‹ › 或键盘 ←/→ 切换。
// 每个变体展示两种尺寸：stage（大舞台）与 inline（列表卡片真实尺寸 text-[6.4vw]）。
// 纯视觉原型：无 API 调用、无持久化。选型确认后删除本页 + components/prototype/ 全部文件。
import { ref, computed, onMounted, onUnmounted, markRaw } from 'vue'
import PbaVariantA from '../components/prototype/PbaVariantA.vue'
import PbaVariantB from '../components/prototype/PbaVariantB.vue'
import PbaVariantC from '../components/prototype/PbaVariantC.vue'
import PbaVariantD from '../components/prototype/PbaVariantD.vue'
import PbaVariantE from '../components/prototype/PbaVariantE.vue'

const variants = [
  {
    key: 'A',
    name: '粒子爆发',
    desc: '收藏：红粒子向外爆发；取消：灰粒子向内收缩（对齐主 app HeartBurstEffect 语义）',
    comp: markRaw(PbaVariantA),
  },
  {
    key: 'B',
    name: '纯弹跳',
    desc: '无粒子：收藏 overshoot 弹入填色；取消收缩下沉回弹褪色（最轻量）',
    comp: markRaw(PbaVariantB),
  },
  {
    key: 'C',
    name: '波纹环',
    desc: '收藏：圆环向外扩散；取消：圆环向内收拢（"收回"语义）',
    comp: markRaw(PbaVariantC),
  },
  {
    key: 'D',
    name: '浮心飘出',
    desc: '收藏/取消：一颗小心向上飘出淡出 + 主心跳动（双向同构）',
    comp: markRaw(PbaVariantD),
  },
  {
    key: 'E',
    name: 'M3 规范版',
    desc: 'state-layer 环扩散/收拢 + Expressive spring 弹心；缓动时长全部映射 M3 令牌（推荐）',
    comp: markRaw(PbaVariantE),
  },
] as const

const idx = ref(0)
const current = computed(() => variants[idx.value])

function cycle(delta: number) {
  idx.value = (idx.value + delta + variants.length) % variants.length
}

// 键盘 ←/→ 切换（仅 web 预览；原生无 window，守卫跳过）
function onKeydown(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
  if (e.key === 'ArrowLeft') cycle(-1)
  else if (e.key === 'ArrowRight') cycle(1)
}
onMounted(() => {
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <view class="flex flex-col w-full h-full bg-surface">
    <!-- 标题区 -->
    <view class="flex flex-col items-center mt-[8vh] px-6">
      <text class="text-title-large text-surface-on">收藏动效原型（PROTOTYPE）</text>
      <text class="text-body-medium text-outline mt-2 text-center">
        变体 {{ current.key }} — {{ current.name }}
      </text>
      <text class="text-body-small text-outline mt-1 text-center">{{ current.desc }}</text>
    </view>

    <!-- 大舞台：点按心形切换收藏/取消 -->
    <view class="flex flex-col items-center justify-center mt-[6vh]">
      <component :is="current.comp" :key="current.key" size="stage" />
      <text class="text-body-small text-outline mt-6">点按心形切换 收藏 / 取消收藏</text>
    </view>

    <!-- inline 场景：模拟列表卡片中的真实尺寸 -->
    <view class="flex flex-col mt-[8vh] px-6">
      <text class="text-label-medium text-outline mb-2">列表卡片场景（真实尺寸）</text>
      <view class="flex flex-row items-center bg-surface-container rounded-[var(--md-shape-medium)] p-4">
        <view class="flex flex-col flex-1">
          <text class="text-body-medium text-surface-on">作品标题示例</text>
          <text class="text-body-small text-outline mt-1">作者名</text>
        </view>
        <component :is="current.comp" :key="`${current.key}-inline`" size="inline" />
      </view>
    </view>

    <!-- 底部悬浮切换条（视觉上有意区别于页面：高对比 pill） -->
    <view class="absolute bottom-10 left-0 right-0 flex flex-row items-center justify-center">
      <view
        class="flex flex-row items-center rounded-full px-2 py-2"
        style="background-color: rgba(0, 0, 0, 0.72)"
      >
        <view class="w-[10vw] h-[10vw] flex items-center justify-center active:opacity-60" @tap="cycle(-1)">
          <text class="text-[6vw] leading-none" style="color: #ffffff">‹</text>
        </view>
        <text class="text-label-large mx-3" style="color: #ffffff">
          {{ current.key }} — {{ current.name }}（{{ idx + 1 }}/{{ variants.length }}）
        </text>
        <view class="w-[10vw] h-[10vw] flex items-center justify-center active:opacity-60" @tap="cycle(1)">
          <text class="text-[6vw] leading-none" style="color: #ffffff">›</text>
        </view>
      </view>
    </view>
  </view>
</template>

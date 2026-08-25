<script setup lang="ts">
// ─── [PROTOTYPE 用完即弃] 变体 E：M3 规范版（state-layer 环 + Expressive spring 弹心） ───
// 设计锚点：
//  · 环 = M3 icon button 的 state-layer ripple 语义延伸（规范内模式）
//  · 主心 overshoot = M3 Expressive spring 动效的 keyframes 近似（0.75→1.18→0.97→1）
//  · 缓动/时长全部映射 M3 令牌（转正时字面量换回变量）：
//      cubic-bezier(0.05,0.7,0.1,1)  = --motion-emphasized-decelerate（进入）
//      cubic-bezier(0.3,0,0.8,0.15)  = --motion-emphasized-accelerate（退出）
//      cubic-bezier(0.2,0,0,1)       = --motion-standard
//      300ms = --durationGentle / 250ms = M3 medium2 / 200ms = --durationNormal
// 收藏：环 emphasized-decelerate 扩散 + 主心 spring pop 填红
// 取消：环 emphasized-accelerate 收拢（"收回"）+ 主心 standard 下沉回稳褪灰
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{ size?: 'stage' | 'inline'; initialBookmarked?: boolean }>(),
  { size: 'stage', initialBookmarked: false },
)

const bookmarked = ref(props.initialBookmarked)
const animSeq = ref(0)

interface Ring {
  id: number
  mode: 'out' | 'in'
}
const rings = ref<Ring[]>([])
let nextId = 1

function toggle() {
  bookmarked.value = !bookmarked.value
  animSeq.value += 1
  const id = nextId++
  rings.value.push({ id, mode: bookmarked.value ? 'out' : 'in' })
  // 无 animationend/transitionend（ADR-0111），按最长动画时长清理
  setTimeout(() => {
    rings.value = rings.value.filter((r) => r.id !== id)
  }, 450)
}
</script>

<template>
  <view class="relative flex items-center justify-center" @tap="toggle">
    <!-- state-layer 环层（主心下层） -->
    <view
      v-for="r in rings"
      :key="r.id"
      class="absolute left-0 top-0 right-0 bottom-0 flex items-center justify-center"
    >
      <view
        class="rounded-full border-2 border-solid"
        :class="[
          size === 'stage' ? 'w-[15vw] h-[15vw]' : 'w-[5.6vw] h-[5.6vw]',
          r.mode === 'out' ? 'border-error pba-e-ring-out' : 'border-outline pba-e-ring-in',
        ]"
      />
    </view>
    <!-- 主心 -->
    <view :key="animSeq" :class="animSeq > 0 ? (bookmarked ? 'pba-e-pop-add' : 'pba-e-pop-remove') : ''">
      <text
        class="leading-none"
        :class="[size === 'stage' ? 'text-[18vw]' : 'text-[6.4vw]', bookmarked ? 'text-error' : 'text-outline']"
        >♥</text
      >
    </view>
  </view>
</template>

<!-- [PROTOTYPE] pba-e- 前缀全仓唯一；删除本组件时一并删除本 style 块。 -->
<style>
/* 主心 spring pop（M3 Expressive spring 近似）：300ms emphasized-decelerate = --durationGentle */
@keyframes pba-e-pop-add {
  0% { transform: scale(0.75); }
  55% { transform: scale(1.18); }
  80% { transform: scale(0.97); }
  100% { transform: scale(1); }
}
.pba-e-pop-add { animation: pba-e-pop-add 300ms cubic-bezier(0.05, 0.7, 0.1, 1) both; }

/* 主心下沉回稳（退出）：200ms standard = --durationNormal */
@keyframes pba-e-pop-remove {
  0% { transform: scale(1); }
  50% { transform: scale(0.88); }
  100% { transform: scale(1); }
}
.pba-e-pop-remove { animation: pba-e-pop-remove 200ms cubic-bezier(0.2, 0, 0, 1) both; }

/* state-layer 环扩散（收藏）：350ms emphasized-decelerate */
@keyframes pba-e-ring-out {
  from { opacity: 0.4; transform: scale(0.6); }
  to { opacity: 0; transform: scale(2.1); }
}
.pba-e-ring-out { animation: pba-e-ring-out 350ms cubic-bezier(0.05, 0.7, 0.1, 1) both; }

/* state-layer 环收拢（取消收藏）：250ms emphasized-accelerate（M3 medium2） */
@keyframes pba-e-ring-in {
  from { opacity: 0.35; transform: scale(1.8); }
  to { opacity: 0; transform: scale(0.6); }
}
.pba-e-ring-in { animation: pba-e-ring-in 250ms cubic-bezier(0.3, 0, 0.8, 0.15) both; }
</style>

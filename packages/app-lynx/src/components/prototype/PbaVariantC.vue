<script setup lang="ts">
// ─── [PROTOTYPE 用完即弃] 变体 C：波纹环（Ring） ───
// 收藏 = 红色圆环从主心向外扩散淡出 + 主心 pop；
// 取消收藏 = 灰色圆环从外向内收缩进主心（"收回"语义）+ 主心下沉回弹。
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
  setTimeout(() => {
    rings.value = rings.value.filter((r) => r.id !== id)
  }, 700)
}
</script>

<template>
  <view class="relative flex items-center justify-center" @tap="toggle">
    <!-- 波纹环层（在主心下层渲染，先声明） -->
    <view
      v-for="r in rings"
      :key="r.id"
      class="absolute left-0 top-0 right-0 bottom-0 flex items-center justify-center"
    >
      <view
        class="rounded-full border-2 border-solid"
        :class="[
          size === 'stage' ? 'w-[15vw] h-[15vw]' : 'w-[5.6vw] h-[5.6vw]',
          r.mode === 'out' ? 'border-error pba-c-ring-out' : 'border-outline pba-c-ring-in',
        ]"
      />
    </view>
    <!-- 主心 -->
    <view :key="animSeq" :class="animSeq > 0 ? (bookmarked ? 'pba-c-pop-add' : 'pba-c-pop-remove') : ''">
      <text
        class="leading-none"
        :class="[size === 'stage' ? 'text-[18vw]' : 'text-[6.4vw]', bookmarked ? 'text-error' : 'text-outline']"
        >♥</text
      >
    </view>
  </view>
</template>

<!-- [PROTOTYPE] pba-c- 前缀全仓唯一；删除本组件时一并删除本 style 块。 -->
<style>
@keyframes pba-c-pop-add {
  0% { transform: scale(1); }
  40% { transform: scale(1.3); }
  70% { transform: scale(0.94); }
  100% { transform: scale(1); }
}
.pba-c-pop-add { animation: pba-c-pop-add 380ms cubic-bezier(0.05, 0.7, 0.1, 1) both; }

@keyframes pba-c-pop-remove {
  0% { transform: scale(1); }
  45% { transform: scale(0.75); }
  100% { transform: scale(1); }
}
.pba-c-pop-remove { animation: pba-c-pop-remove 280ms cubic-bezier(0.2, 0, 0, 1) both; }

/* 波纹扩散（收藏） */
@keyframes pba-c-ring-out {
  from { opacity: 0.55; transform: scale(0.5); }
  to { opacity: 0; transform: scale(1.9); }
}
.pba-c-ring-out { animation: pba-c-ring-out 450ms cubic-bezier(0.05, 0.7, 0.1, 1) both; }

/* 波纹收拢（取消收藏） */
@keyframes pba-c-ring-in {
  from { opacity: 0.5; transform: scale(1.9); }
  to { opacity: 0; transform: scale(0.5); }
}
.pba-c-ring-in { animation: pba-c-ring-in 350ms cubic-bezier(0.3, 0, 0.8, 0.15) both; }
</style>

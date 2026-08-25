<script setup lang="ts">
// ─── [PROTOTYPE 用完即弃] 变体 B：纯弹跳（Pop，无粒子） ───
// 收藏 = 主心从小弹入 overshoot（0.4→1.4→0.9→1）+ 瞬间填红；
// 取消收藏 = 主心收缩下沉再回弹（1→0.65→1.08→1）+ 瞬间褪灰。
// 最轻量方案：零额外节点、零清理逻辑，仅靠 :key 重挂载重播主心 keyframes。
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{ size?: 'stage' | 'inline'; initialBookmarked?: boolean }>(),
  { size: 'stage', initialBookmarked: false },
)

const bookmarked = ref(props.initialBookmarked)
const animSeq = ref(0)

function toggle() {
  bookmarked.value = !bookmarked.value
  animSeq.value += 1
}
</script>

<template>
  <view class="relative flex items-center justify-center" @tap="toggle">
    <view :key="animSeq" :class="animSeq > 0 ? (bookmarked ? 'pba-b-pop-add' : 'pba-b-pop-remove') : ''">
      <text
        class="leading-none"
        :class="[size === 'stage' ? 'text-[18vw]' : 'text-[6.4vw]', bookmarked ? 'text-error' : 'text-outline']"
        >♥</text
      >
    </view>
  </view>
</template>

<!-- [PROTOTYPE] pba-b- 前缀全仓唯一；删除本组件时一并删除本 style 块。 -->
<style>
@keyframes pba-b-pop-add {
  0% { transform: scale(0.4); }
  55% { transform: scale(1.4); }
  75% { transform: scale(0.9); }
  100% { transform: scale(1); }
}
.pba-b-pop-add { animation: pba-b-pop-add 450ms cubic-bezier(0.05, 0.7, 0.1, 1) both; }

@keyframes pba-b-pop-remove {
  0% { transform: scale(1); }
  40% { transform: scale(0.65); }
  75% { transform: scale(1.08); }
  100% { transform: scale(1); }
}
.pba-b-pop-remove { animation: pba-b-pop-remove 350ms cubic-bezier(0.2, 0, 0, 1) both; }
</style>

<script setup lang="ts">
// ─── [PROTOTYPE 用完即弃] 变体 D：浮心飘出（Float） ───
// 收藏 = 一颗小红心从主心向上飘出淡出 + 主心填色 pop；
// 取消收藏 = 一颗灰心向上飘出淡出（"心意离体"语义）+ 主心收缩回弹褪灰。
// 双向共用同一 float keyframes，仅颜色不同。
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{ size?: 'stage' | 'inline'; initialBookmarked?: boolean }>(),
  { size: 'stage', initialBookmarked: false },
)

const bookmarked = ref(props.initialBookmarked)
const animSeq = ref(0)

interface FloatHeart {
  id: number
  bookmarked: boolean
}
const hearts = ref<FloatHeart[]>([])
let nextId = 1

function toggle() {
  bookmarked.value = !bookmarked.value
  animSeq.value += 1
  const id = nextId++
  hearts.value.push({ id, bookmarked: bookmarked.value })
  setTimeout(() => {
    hearts.value = hearts.value.filter((h) => h.id !== id)
  }, 800
  )
}
</script>

<template>
  <view class="relative flex items-center justify-center" @tap="toggle">
    <!-- 飘出心层 -->
    <view
      v-for="h in hearts"
      :key="h.id"
      class="absolute left-0 top-0 right-0 bottom-0 flex items-center justify-center"
    >
      <view class="pba-d-float">
        <text
          class="leading-none"
          :class="[size === 'stage' ? 'text-[8vw]' : 'text-[4.4vw]', h.bookmarked ? 'text-error' : 'text-outline']"
          >♥</text
        >
      </view>
    </view>
    <!-- 主心 -->
    <view :key="animSeq" :class="animSeq > 0 ? (bookmarked ? 'pba-d-pop-add' : 'pba-d-pop-remove') : ''">
      <text
        class="leading-none"
        :class="[size === 'stage' ? 'text-[18vw]' : 'text-[6.4vw]', bookmarked ? 'text-error' : 'text-outline']"
        >♥</text
      >
    </view>
  </view>
</template>

<!-- [PROTOTYPE] pba-d- 前缀全仓唯一；删除本组件时一并删除本 style 块。 -->
<style>
@keyframes pba-d-pop-add {
  0% { transform: scale(1); }
  40% { transform: scale(1.3); }
  70% { transform: scale(0.94); }
  100% { transform: scale(1); }
}
.pba-d-pop-add { animation: pba-d-pop-add 380ms cubic-bezier(0.05, 0.7, 0.1, 1) both; }

@keyframes pba-d-pop-remove {
  0% { transform: scale(1); }
  45% { transform: scale(0.75); }
  100% { transform: scale(1); }
}
.pba-d-pop-remove { animation: pba-d-pop-remove 280ms cubic-bezier(0.2, 0, 0, 1) both; }

/* 小心向上飘出淡出（双向共用） */
@keyframes pba-d-float {
  0% { opacity: 0; transform: translateY(4px) scale(0.5); }
  15% { opacity: 1; }
  100% { opacity: 0; transform: translateY(-56px) scale(1.05); }
}
.pba-d-float { animation: pba-d-float 560ms cubic-bezier(0.05, 0.7, 0.1, 1) both; }
</style>

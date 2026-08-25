<script setup lang="ts">
// ─── [PROTOTYPE 用完即弃] 变体 A：粒子爆发（Burst） ───
// 对齐主 app HeartBurstEffect 语义：收藏 = 红色 ♥ 粒子向外爆发 + 主心 overshoot pop；
// 取消收藏 = 灰色 ♥ 粒子向内收缩消散 + 主心回弹。
// Lynx 约束：keyframes 全局非 scoped（scoped keyframes 未验证面，同 RefreshableList 约定）；
// transform 承载用 view 不用 text（ADR-0108）；粒子随机性用 6 个固定方向 keyframes 代替
// CSS var()（keyframes 内 var() 在 Lynx 未验证）；清理用 setTimeout（无 transitionend）。
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{ size?: 'stage' | 'inline'; initialBookmarked?: boolean }>(),
  { size: 'stage', initialBookmarked: false },
)

const bookmarked = ref(props.initialBookmarked)
/** 递增触发主心 pop 动画重挂载（:key 重播） */
const animSeq = ref(0)

interface Burst {
  id: number
  mode: 'out' | 'in'
}
const bursts = ref<Burst[]>([])
let nextId = 1

const PARTICLES = [1, 2, 3, 4, 5, 6]

function toggle() {
  bookmarked.value = !bookmarked.value
  animSeq.value += 1
  const id = nextId++
  bursts.value.push({ id, mode: bookmarked.value ? 'out' : 'in' })
  // 无 animationend/transitionend（ADR-0111），固定时长后清理粒子节点
  setTimeout(() => {
    bursts.value = bursts.value.filter((b) => b.id !== id)
  }, 800)
}
</script>

<template>
  <view class="relative flex items-center justify-center" @tap="toggle">
    <!-- 主心（:key 重挂载重播 pop） -->
    <view :key="animSeq" :class="animSeq > 0 ? (bookmarked ? 'pba-a-pop-add' : 'pba-a-pop-remove') : ''">
      <text
        class="leading-none"
        :class="[size === 'stage' ? 'text-[18vw]' : 'text-[6.4vw]', bookmarked ? 'text-error' : 'text-outline']"
        >♥</text
      >
    </view>
    <!-- 粒子层：absolute 全铺居中，粒子自身 transform 从中心飞出/收拢 -->
    <view
      v-for="b in bursts"
      :key="b.id"
      class="absolute left-0 top-0 right-0 bottom-0 flex items-center justify-center"
    >
      <view
        v-for="p in PARTICLES"
        :key="p"
        class="absolute left-0 top-0 right-0 bottom-0 flex items-center justify-center"
        :class="`pba-a-${b.mode}-${p}`"
      >
        <text
          class="leading-none"
          :class="[size === 'stage' ? 'text-[6vw]' : 'text-[4vw]', b.mode === 'out' ? 'text-error' : 'text-outline']"
          >♥</text
        >
      </view>
    </view>
  </view>
</template>

<!-- [PROTOTYPE] pba-a- 前缀全仓唯一；删除本组件时一并删除本 style 块。
     缓动硬编码为字面量（web-core 预览 var() 不解析）；转正时替换为 --motion-* 令牌。 -->
<style>
@keyframes pba-a-pop-add {
  0% { transform: scale(1); }
  40% { transform: scale(1.35); }
  70% { transform: scale(0.92); }
  100% { transform: scale(1); }
}
.pba-a-pop-add { animation: pba-a-pop-add 400ms cubic-bezier(0.05, 0.7, 0.1, 1) both; }

@keyframes pba-a-pop-remove {
  0% { transform: scale(1); }
  45% { transform: scale(0.72); }
  100% { transform: scale(1); }
}
.pba-a-pop-remove { animation: pba-a-pop-remove 300ms cubic-bezier(0.2, 0, 0, 1) both; }

/* 向外爆发（收藏）：520ms emphasized-decelerate */
@keyframes pba-a-out-1 { from { opacity: 1; transform: translate(0px, 0px) scale(0.5) rotate(0deg); } to { opacity: 0; transform: translate(52px, -10px) scale(1.05) rotate(35deg); } }
@keyframes pba-a-out-2 { from { opacity: 1; transform: translate(0px, 0px) scale(0.5) rotate(0deg); } to { opacity: 0; transform: translate(26px, -46px) scale(0.9) rotate(-25deg); } }
@keyframes pba-a-out-3 { from { opacity: 1; transform: translate(0px, 0px) scale(0.5) rotate(0deg); } to { opacity: 0; transform: translate(-30px, -44px) scale(1.1) rotate(40deg); } }
@keyframes pba-a-out-4 { from { opacity: 1; transform: translate(0px, 0px) scale(0.5) rotate(0deg); } to { opacity: 0; transform: translate(-52px, -6px) scale(0.85) rotate(-35deg); } }
@keyframes pba-a-out-5 { from { opacity: 1; transform: translate(0px, 0px) scale(0.5) rotate(0deg); } to { opacity: 0; transform: translate(-28px, 42px) scale(1) rotate(25deg); } }
@keyframes pba-a-out-6 { from { opacity: 1; transform: translate(0px, 0px) scale(0.5) rotate(0deg); } to { opacity: 0; transform: translate(30px, 44px) scale(0.95) rotate(-40deg); } }
.pba-a-out-1 { animation: pba-a-out-1 520ms cubic-bezier(0.05, 0.7, 0.1, 1) both; }
.pba-a-out-2 { animation: pba-a-out-2 480ms cubic-bezier(0.05, 0.7, 0.1, 1) both; }
.pba-a-out-3 { animation: pba-a-out-3 560ms cubic-bezier(0.05, 0.7, 0.1, 1) both; }
.pba-a-out-4 { animation: pba-a-out-4 500ms cubic-bezier(0.05, 0.7, 0.1, 1) both; }
.pba-a-out-5 { animation: pba-a-out-5 540ms cubic-bezier(0.05, 0.7, 0.1, 1) both; }
.pba-a-out-6 { animation: pba-a-out-6 490ms cubic-bezier(0.05, 0.7, 0.1, 1) both; }

/* 向内收缩消散（取消收藏）：380ms emphasized-accelerate */
@keyframes pba-a-in-1 { from { opacity: 0.9; transform: translate(52px, -10px) scale(1) rotate(35deg); } to { opacity: 0; transform: translate(0px, 0px) scale(0.25) rotate(0deg); } }
@keyframes pba-a-in-2 { from { opacity: 0.9; transform: translate(26px, -46px) scale(0.9) rotate(-25deg); } to { opacity: 0; transform: translate(0px, 0px) scale(0.25) rotate(0deg); } }
@keyframes pba-a-in-3 { from { opacity: 0.9; transform: translate(-30px, -44px) scale(1.1) rotate(40deg); } to { opacity: 0; transform: translate(0px, 0px) scale(0.25) rotate(0deg); } }
@keyframes pba-a-in-4 { from { opacity: 0.9; transform: translate(-52px, -6px) scale(0.85) rotate(-35deg); } to { opacity: 0; transform: translate(0px, 0px) scale(0.25) rotate(0deg); } }
@keyframes pba-a-in-5 { from { opacity: 0.9; transform: translate(-28px, 42px) scale(1) rotate(25deg); } to { opacity: 0; transform: translate(0px, 0px) scale(0.25) rotate(0deg); } }
@keyframes pba-a-in-6 { from { opacity: 0.9; transform: translate(30px, 44px) scale(0.95) rotate(-40deg); } to { opacity: 0; transform: translate(0px, 0px) scale(0.25) rotate(0deg); } }
.pba-a-in-1 { animation: pba-a-in-1 380ms cubic-bezier(0.3, 0, 0.8, 0.15) both; }
.pba-a-in-2 { animation: pba-a-in-2 360ms cubic-bezier(0.3, 0, 0.8, 0.15) both; }
.pba-a-in-3 { animation: pba-a-in-3 400ms cubic-bezier(0.3, 0, 0.8, 0.15) both; }
.pba-a-in-4 { animation: pba-a-in-4 370ms cubic-bezier(0.3, 0, 0.8, 0.15) both; }
.pba-a-in-5 { animation: pba-a-in-5 390ms cubic-bezier(0.3, 0, 0.8, 0.15) both; }
.pba-a-in-6 { animation: pba-a-in-6 350ms cubic-bezier(0.3, 0, 0.8, 0.15) both; }
</style>

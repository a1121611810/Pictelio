<script setup lang="ts">
// 收藏按钮（列表卡片 ♥ + 详情页 ♥ 复用）
// ADR-0112：M3 动效（state-layer 环扩散/收拢 + Expressive spring 弹心）+ 乐观触发。
// 状态机在 primitives/createBookmarkToggle（node 可测 seam）；本组件只管渲染与特效节点。
// @tap.stop：阻止冒泡到卡片 tap（进详情），需实测 vue-lynx 是否支持 .stop。
import { ref } from 'vue'
import { addBookmark, deleteBookmark } from '../api/illust'
import { createBookmarkToggle, BOOKMARK_ANIMATION_MS } from '../primitives/createBookmarkToggle'

const props = defineProps<{
  illustId: number
  initialBookmarked: boolean
  /** 收藏数（可选，传入则显示计数） */
  bookmarkCount?: number
}>()

// change 事件：动画播完后上抛（动画完成态，ADR-0112 决策 4；供收藏列表等宿主移除已取消收藏的项）
const emit = defineEmits<{ change: [bookmarked: boolean] }>()

const bm = createBookmarkToggle(props.illustId, props.initialBookmarked, props.bookmarkCount ?? 0, {
  add: addBookmark,
  remove: deleteBookmark,
  onChange: (bookmarked) => emit('change', bookmarked),
})

/** 主心 pop 重播代（:key 重挂载触发动画重播） */
const animSeq = ref(0)
/** tap 时刻的目标态快照：pop 动画类绑定快照而非实时态——
 * 失败静息回滚时 bm.bookmarked 翻转回来也不会触发反向 pop（ADR-0112 决策 3） */
const lastTarget = ref(false)

interface Ring {
  id: number
  mode: 'out' | 'in'
}
const rings = ref<Ring[]>([])
let nextRingId = 1

function onTap() {
  if (bm.busy) return
  const target = !bm.bookmarked
  lastTarget.value = target
  animSeq.value++
  const id = nextRingId++
  rings.value.push({ id, mode: target ? 'out' : 'in' })
  // 无 animationend（ADR-0111）：固定时长后清理环节点（仅节点清理，不驱动动画帧）
  setTimeout(() => {
    rings.value = rings.value.filter((r) => r.id !== id)
  }, BOOKMARK_ANIMATION_MS)
  void bm.toggle()
}
</script>

<template>
  <view class="flex flex-row items-center" @tap.stop="onTap">
    <view class="relative flex items-center justify-center">
      <!-- state-layer 环层（主心下层）：收藏红环扩散 / 取消灰环收拢 -->
      <view
        v-for="r in rings"
        :key="r.id"
        class="absolute left-0 top-0 right-0 bottom-0 flex items-center justify-center"
      >
        <view
          class="rounded-full border-2 border-solid w-[5.6vw] h-[5.6vw]"
          :class="r.mode === 'out' ? 'border-error bookmark-ring-out' : 'border-outline bookmark-ring-in'"
        />
      </view>
      <!-- 主心（transform 承载用 view 不用 text，ADR-0108 决策 2；:key 重挂载重播 pop） -->
      <view :key="animSeq" :class="animSeq > 0 ? (lastTarget ? 'bookmark-pop-add' : 'bookmark-pop-remove') : ''">
        <!-- ♥\uFE0E：U+FE0E 强制 text presentation——裸 U+2665 在 Lynx 原生被解析为彩色 emoji
             字形（固有色 #fa242f），CSS color 完全失效（心形恒红，真机实测 2026-08-25，ADR-0112） -->
        <text class="text-[6.4vw] leading-none" :class="bm.bookmarked ? 'text-error' : 'text-outline'">♥︎</text>
      </view>
    </view>
    <text v-if="bookmarkCount !== undefined" class="text-label-medium text-outline ml-1">{{ bm.count }}</text>
    <text v-if="bm.errorMsg" class="text-label-medium text-error ml-1">{{ bm.errorMsg }}</text>
  </view>
</template>

<!-- 收藏动效样式（ADR-0112）：全局 <style>（scoped keyframes 未验证面，同 RefreshableList 约定）；
     类名 bookmark-pop-* / bookmark-ring-* 全仓唯一。
     红线：缓动/时长一律引用 M3 令牌变量，禁止 bezier/ms 字面量。 -->
<style>
/* 主心 spring pop（M3 Expressive spring 近似）：300ms = --durationGentle */
@keyframes bookmark-pop-add {
  0% { transform: scale(0.75); }
  55% { transform: scale(1.18); }
  80% { transform: scale(0.97); }
  100% { transform: scale(1); }
}
.bookmark-pop-add {
  animation: bookmark-pop-add var(--durationGentle) var(--motion-emphasized-decelerate) both;
}

/* 主心下沉回稳（取消）：200ms = --durationNormal */
@keyframes bookmark-pop-remove {
  0% { transform: scale(1); }
  50% { transform: scale(0.88); }
  100% { transform: scale(1); }
}
.bookmark-pop-remove {
  animation: bookmark-pop-remove var(--durationNormal) var(--motion-standard) both;
}

/* state-layer 环扩散（收藏）：350ms = --durationMedium3 */
@keyframes bookmark-ring-out {
  from { opacity: 0.4; transform: scale(0.6); }
  to { opacity: 0; transform: scale(2.1); }
}
.bookmark-ring-out {
  animation: bookmark-ring-out var(--durationMedium3) var(--motion-emphasized-decelerate) both;
}

/* state-layer 环收拢（取消，"收回"语义）：250ms = --durationMedium1 */
@keyframes bookmark-ring-in {
  from { opacity: 0.35; transform: scale(1.8); }
  to { opacity: 0; transform: scale(0.6); }
}
.bookmark-ring-in {
  animation: bookmark-ring-in var(--durationMedium1) var(--motion-emphasized-accelerate) both;
}
</style>

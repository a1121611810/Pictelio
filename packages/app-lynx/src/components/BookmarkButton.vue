<script setup lang="ts">
// 收藏按钮（列表卡片 ♥ + 详情页 ♥ 复用）
// 本地维护 bookmarked/count，点击调 API 切换；默认收藏到 public（对齐主项目）。
// @tap.stop：阻止冒泡到卡片 tap（进详情），需实测 vue-lynx 是否支持 .stop。
import { ref } from 'vue'
import { addBookmark, deleteBookmark } from '../api/illust'

const props = defineProps<{
  illustId: number
  initialBookmarked: boolean
  /** 收藏数（可选，传入则显示计数） */
  bookmarkCount?: number
}>()

const bookmarked = ref(props.initialBookmarked)
const count = ref(props.bookmarkCount ?? 0)
const busy = ref(false)
const errorMsg = ref('')

// change 事件：收藏状态切换后上抛（供收藏列表等宿主移除已取消收藏的项）
const emit = defineEmits<{ change: [bookmarked: boolean] }>()

async function toggle() {
  if (busy.value) return
  busy.value = true
  errorMsg.value = ''
  try {
    if (bookmarked.value) {
      await deleteBookmark(props.illustId)
      bookmarked.value = false
      if (count.value > 0) count.value -= 1
    } else {
      await addBookmark(props.illustId)
      bookmarked.value = true
      count.value += 1
    }
    emit('change', bookmarked.value)
  } catch {
    errorMsg.value = '操作失败'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <view class="flex flex-row items-center" @tap.stop="toggle">
    <text class="text-xl" :class="bookmarked ? 'text-danger' : 'text-foreground-3'">♥</text>
    <text v-if="bookmarkCount !== undefined" class="text-xs text-foreground-3 ml-1">{{ count }}</text>
    <text v-if="errorMsg" class="text-xs text-danger ml-1">{{ errorMsg }}</text>
  </view>
</template>

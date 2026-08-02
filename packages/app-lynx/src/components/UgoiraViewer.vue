<script setup lang="ts">
// Ugoira 播放器（T5）：帧 data URL 按 meta.delay setTimeout 循环切换。
// 原生 LynxView + web-core 预览双环境（base64 data URL 是 <image> 官方支持格式）。
// 卸载竞态防护：下载完成时若已卸载则丢弃（disposed）+ AbortController 中断下载。
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { downloadUgoiraFrames, type UgoiraFrameData } from '../api/ugoira'

const props = defineProps<{
  illustId: number
}>()

const currentSrc = ref('')
const loading = ref(true)
const errorMsg = ref('')

let frames: UgoiraFrameData[] = []
let frameCursor = 0
let timer: ReturnType<typeof setTimeout> | null = null
let disposed = false
let abort: AbortController | null = null

function playFrom(index: number) {
  if (disposed) return
  frameCursor = index
  if (timer) clearTimeout(timer)
  const tick = () => {
    if (disposed || frames.length === 0) return
    const f = frames[frameCursor]!
    currentSrc.value = f.dataUrl
    frameCursor = (frameCursor + 1) % frames.length
    timer = setTimeout(tick, f.delay)
  }
  timer = setTimeout(tick, 0)
}

function stop() {
  if (timer) clearTimeout(timer)
  timer = null
  frames = []
  currentSrc.value = ''
}

onMounted(async () => {
  loading.value = true
  errorMsg.value = ''
  abort = new AbortController()
  try {
    frames = await downloadUgoiraFrames(props.illustId, abort.signal)
    if (disposed) {
      frames = [] // 已卸载：丢弃帧数组（不启动播放，防 timer/frames 泄漏）
      return
    }
    if (frames.length === 0) {
      errorMsg.value = '动图无帧数据'
    } else {
      playFrom(0)
    }
  } catch (err) {
    if (!disposed && !abort.signal.aborted) {
      errorMsg.value = (err as { message?: string }).message ?? '动图加载失败'
    }
  } finally {
    if (!disposed) loading.value = false
  }
})

onBeforeUnmount(() => {
  disposed = true
  abort?.abort()
  stop()
})
</script>

<template>
  <view class="w-full flex flex-col items-center">
    <view v-if="loading" class="shimmer w-full aspect-[1/1] rounded-[var(--borderRadiusLarge)]" />
    <image v-else-if="currentSrc" class="w-full aspect-[1/1] rounded-[var(--borderRadiusLarge)]" :src="currentSrc" :mode="'aspectFit'" />
    <text v-if="errorMsg" class="text-sm text-danger p-4">{{ errorMsg }}</text>
  </view>
</template>

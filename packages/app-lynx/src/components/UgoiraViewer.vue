<script setup lang="ts">
// Ugoira 播放器（T5）：帧按 meta.delay setTimeout 循环切换。
// 双管线（ADR-0125）：
//   - web 模式：downloadUgoiraFrames（fflate/range + base64 data URL）
//   - 原生模式：ugoiraExtractFrames（Java 解压写盘 + file:// 帧 URL，二进制零进 JS 堆）
// 卸载竞态防护：下载完成时若已卸载则丢弃（disposed）+ AbortController 中断下载。
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { downloadUgoiraFrames, ugoiraExtractFrames, type UgoiraFrameData, type UgoiraFrameFile } from '../api/ugoira'
import { isNativeMode } from '../api/client'
import { ugoiraMode } from '../stores/settingsStore'
import { presentError } from '../utils/errorPresentation'

const props = withDefaults(defineProps<{
  illustId: number
  /** 容器显式高度（vw 字符串，如 "150vw"）：详情页按原图比例传入（spec：详情比例显示）；
   *  默认 "100vw"（1:1 正方形）。原生 LynxView 下 aspect-ratio 容器不可靠，显式高度已验证（issue #138） */
  heightVw?: string
}>(), {
  heightVw: '100vw',
})

const currentSrc = ref('')
const loading = ref(true)
const errorMsg = ref('')

// 帧源统一抽象：web 用 dataUrl，原生用 url（file://）
interface FrameLike {
  src: string
  delay: number
}

let frames: FrameLike[] = []
let frameCursor = 0
let timer: ReturnType<typeof setTimeout> | null = null
let disposed = false
let abort: AbortController | null = null

function toFrameLike(list: UgoiraFrameData[] | UgoiraFrameFile[]): FrameLike[] {
  return list.map((f) => ('dataUrl' in f ? { src: (f as UgoiraFrameData).dataUrl, delay: f.delay } : { src: (f as UgoiraFrameFile).url, delay: f.delay }))
}

function playFrom(index: number) {
  if (disposed) return
  frameCursor = index
  if (timer) clearTimeout(timer)
  const tick = () => {
    if (disposed || frames.length === 0) return
    const f = frames[frameCursor]!
    currentSrc.value = f.src
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
    // 原生模式走 Java 解压写盘管线（ADR-0125）；web 模式走 fflate/range + base64。
    // ugoiraMode 设置（fflate/range）仅对 web 模式生效（原生管线与其无关）。
    const raw = isNativeMode()
      ? await ugoiraExtractFrames(props.illustId, abort.signal)
      : await downloadUgoiraFrames(props.illustId, ugoiraMode.value, abort.signal)
    if (disposed) {
      frames = [] // 已卸载：丢弃帧数组（不启动播放，防 timer/frames 泄漏）
      return
    }
    frames = toFrameLike(raw)
    if (frames.length === 0) {
      errorMsg.value = '动图无帧数据'
    } else {
      playFrom(0)
    }
  } catch (err) {
    if (!disposed && !abort.signal.aborted) {
      errorMsg.value = presentError(err, '动图加载失败')
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
    <view v-if="loading" class="shimmer w-full rounded-[var(--md-shape-medium)]" :style="{ height: heightVw }" />
    <image v-else-if="currentSrc" class="w-full rounded-[var(--md-shape-medium)]" :style="{ height: heightVw }" :src="currentSrc" :mode="'aspectFit'" />
    <text v-if="errorMsg" class="text-body-small text-error p-4">{{ errorMsg }}</text>
  </view>
</template>

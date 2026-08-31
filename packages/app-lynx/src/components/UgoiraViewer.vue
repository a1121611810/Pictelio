<script setup lang="ts">
// Ugoira 播放器（T5）：帧按 meta.delay setTimeout 循环切换。
// 双管线（ADR-0125 + ADR-0128）：
//   - web 模式：downloadUgoiraFrames（fflate/range + base64 data URL）
//   - 原生模式：ugoiraExtractStreamFrames（ADR-0128 流式渐进，Java 边下边解压写盘 + 分批交付）
//     —— 失败降级 ugoiraExtractFrames 全量（帧序不一致/损坏等）
// 卸载竞态防护：下载完成时若已卸载则丢弃（disposed）+ AbortController 中断下载（原生流式 → cancel）。
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { downloadUgoiraFrames, ugoiraExtractFrames, ugoiraExtractStreamFrames, type UgoiraFrameData } from '../api/ugoira'
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
/** ADR-0128：流式渐进是否已结束（false = 播放器到列表尾部时等待新帧而非循环） */
let streamDone = true

/**
 * 播放调度：播当前帧 → 按 delay 调度下一帧。
 * 流式渐进中：到达当前列表尾部且未 done → 50ms 轮询等待新帧（不停止不报错）；done 后循环。
 */
function playFrom(index: number) {
  if (disposed) return
  frameCursor = index
  if (timer) clearTimeout(timer)
  const tick = () => {
    if (disposed) return
    if (frames.length === 0) {
      timer = setTimeout(tick, 50)
      return
    }
    if (frameCursor >= frames.length) {
      if (!streamDone) {
        timer = setTimeout(tick, 50) // 尾部等待新帧
        return
      }
      frameCursor = 0 // done：从头循环
    }
    const f = frames[frameCursor]!
    currentSrc.value = f.src
    frameCursor = frameCursor + 1
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

/** 原生模式（ADR-0128）：流式渐进，失败降级全量 */
async function loadNativeStreaming() {
  streamDone = false
  let started = false
  try {
    await ugoiraExtractStreamFrames(
      props.illustId,
      (batch) => {
        if (disposed) return
        for (const f of batch) {
          frames.push({ src: f.dataUrl, delay: f.delay })
        }
        if (!started && frames.length > 0) {
          started = true
          playFrom(0) // 首批帧就绪即播
        }
      },
      abort!.signal,
    )
    streamDone = true
  } catch (err) {
    if (disposed || abort?.signal.aborted) return
    // 降级全量（帧序不一致/损坏/下载中断等）——warn 可见，禁止静默
    console.warn('[ugoira] 流式渐进失败，降级全量:', (err as Error).message)
    stop()
    streamDone = true
    const bundle = await ugoiraExtractFrames(props.illustId, abort!.signal)
    if (disposed) {
      return
    }
    frames = bundle.urls.map((url, i) => ({ src: url, delay: bundle.delays[i]! }))
    playFrom(0)
  }
}

onMounted(async () => {
  loading.value = true
  errorMsg.value = ''
  abort = new AbortController()
  try {
    // 原生模式走流式渐进（ADR-0128，失败降级全量）；web 模式走 fflate/range + base64。
    // ugoiraMode 设置（fflate/range）仅对 web 模式生效（原生管线与其无关）。
    if (isNativeMode()) {
      await loadNativeStreaming()
    } else {
      const dataFrames = await downloadUgoiraFrames(props.illustId, ugoiraMode.value, abort.signal)
      if (disposed) {
        frames = []
        return
      }
      frames = dataFrames.map((f) => ({ src: f.dataUrl, delay: f.delay }))
    }
    if (disposed) return
    if (frames.length === 0) {
      errorMsg.value = '动图无帧数据'
    } else if (!isNativeMode()) {
      // 原生渐进模式已在首批回调时开播
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
    <!-- ADR-0126：defer-src-invalidation 防换帧闪烁（官方语义：新加载成功后才清除已展示图片；
         原型实测 374/374 帧零空白，见 docs/research/ugoira-playback-flicker-range-proto.md）。
         ⚠️ 必须布尔绑定 :defer-src-invalidation="true"——裸属性被 vue-lynx 编译为 ""（字符串），
         真机原生 <image> 按 truthy 判断时不生效（2026-08-31 真机回归实测：绑定 true 后 116 帧
         零空白；防线：ugoiraViewerTemplate.test.ts）。 -->
    <image
      v-else-if="currentSrc"
      :defer-src-invalidation="true"
      class="w-full rounded-[var(--md-shape-medium)]"
      :style="{ height: heightVw }"
      :src="currentSrc"
      :mode="'aspectFit'"
    />
    <text v-if="errorMsg" class="text-body-small text-error p-4">{{ errorMsg }}</text>
  </view>
</template>

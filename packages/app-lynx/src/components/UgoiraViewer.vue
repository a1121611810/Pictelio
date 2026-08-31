<script setup lang="ts">
// Ugoira 播放器（T5）：帧按 meta.delay setTimeout 循环切换。
// 双管线（ADR-0125 + ADR-0128）：
//   - web 模式：downloadUgoiraFrames（fflate/range + base64 data URL）
//   - 原生模式：ugoiraExtractStreamFrames（ADR-0128 流式渐进，Java 边下边解压写盘 + 分批交付）
//     —— 失败降级 ugoiraExtractFrames 全量（帧序不一致/损坏等）
// 卸载竞态防护：下载完成时若已卸载则丢弃（disposed）+ AbortController 中断下载（原生流式 → cancel）。
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { downloadUgoiraFrames, ugoiraExtractFrames, ugoiraExtractStreamFrames, type UgoiraFrameData } from '../api/ugoira'
import { isNativeMode, getNativeModules } from '../api/client'
import { ugoiraMode } from '../stores/settingsStore'
import { presentError } from '../utils/errorPresentation'
import { diagInit, diagLog, diagText } from '../utils/ugoiraDiag'

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
// T0-DIAG 临时诊断（真机取证，验证后移除）：导出按钮提示文案
const diagHint = ref('')

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
// T0-DIAG 临时诊断：当前展示帧索引 + 最近一次换帧时刻（@load/@error 打点用）
let currentSrcIdx = -1
let lastSetAt = 0

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
    currentSrcIdx = frameCursor
    lastSetAt = Date.now()
    diagLog('frame-set', { i: frameCursor, delay: f.delay })
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
        diagLog('stream-batch', { size: batch.length, total: frames.length })
        if (!started && frames.length > 0) {
          started = true
          playFrom(0) // 首批帧就绪即播
        }
      },
      abort!.signal,
    )
    streamDone = true
    diagLog('stream-done', { frames: frames.length })
  } catch (err) {
    if (disposed || abort?.signal.aborted) return
    // 降级全量（帧序不一致/损坏/下载中断等）——warn 可见，禁止静默
    console.warn('[ugoira] 流式渐进失败，降级全量:', (err as Error).message)
    diagLog('fallback', { reason: (err as Error).message })
    stop()
    streamDone = true
    const bundle = await ugoiraExtractFrames(props.illustId, abort!.signal)
    if (disposed) {
      return
    }
    frames = bundle.urls.map((url, i) => ({ src: url, delay: bundle.delays[i]! }))
    diagLog('fallback-ready', { count: frames.length })
    playFrom(0)
  }
}

onMounted(async () => {
  loading.value = true
  errorMsg.value = ''
  abort = new AbortController()
  // T0-DIAG 临时诊断：初始化日志头部。
  // deferSrcInvalidation 为**规格期望值**（ADR-0126/本次修复要求绑定 true，非运行时反射）；
  // 模板实际绑定由源级防线测试把守（src/components/ugoiraViewerTemplate.test.ts）。
  diagInit({
    illustId: props.illustId,
    mode: isNativeMode() ? 'native' : 'web',
    totalFrames: null,
    deferSrcInvalidation: true,
    ugoiraMode: ugoiraMode.value,
  })
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
      diagLog('frames-ready', { count: frames.length })
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

// ── T0-DIAG 临时诊断（真机取证，验证后移除）：@load/@error 打点 + 日志导出 ──

/** @load：新帧解码完成（dt = 换帧→load 耗时，诊断速度与空白窗口的证据）。
 *  归属按 src 反查帧索引（避免跨帧解码时记到错误帧——见 Standards review finding 6） */
function onFrameLoad() {
  const i = frames.findIndex((f) => f.src === currentSrc.value)
  diagLog('image-load', { i, dt: Date.now() - lastSetAt })
}

/** @error：帧解码/加载失败（file:// 损坏或 base64 异常时会触发） */
function onFrameError() {
  const i = frames.findIndex((f) => f.src === currentSrc.value)
  diagLog('image-error', { i })
}

/** 导出诊断日志：经 Java 预置通道 exportDiagLog（写盘 + 系统分享面板） */
async function onExportDiag() {
  try {
    // 与仓库既有桥接 peer 模式一致（updateStore.ts）：as 收窄类型（getNativeModules 返回 unknown）
    const api = getNativeModules()?.PictelioApp as
      | { exportDiagLog?: (text: string, cb: (err: string | null) => void) => void }
      | undefined
    if (!api?.exportDiagLog) {
      throw new Error('exportDiagLog 不可用（非原生模式或模块未注册）')
    }
    // Java 契约：无可用分享应用时日志已写盘、回调非空字符串提示（降级成功，非失败）——区分展示
    const outcome = await new Promise<'shared' | 'written'>((resolve, reject) => {
      api.exportDiagLog!(diagText(), (err) => {
        if (!err) {
          resolve('shared')
          return
        }
        if (err.includes('日志已写入')) {
          resolve('written')
          return
        }
        reject(new Error(err))
      })
    })
    diagHint.value =
      outcome === 'shared'
        ? '已打开分享面板'
        : '已写入日志文件（无分享应用；可经系统文件管理器导出）'
  } catch (err) {
    diagHint.value = `导出失败: ${(err as Error).message}`
  }
}
</script>

<template>
  <view class="relative w-full flex flex-col items-center">
    <view v-if="loading" class="shimmer w-full rounded-[var(--md-shape-medium)]" :style="{ height: heightVw }" />
    <!-- ADR-0126：defer-src-invalidation 防换帧闪烁（官方语义：新加载成功后才清除已展示图片；
         原型实测 374/374 帧零空白，见 docs/research/ugoira-playback-flicker-range-proto.md）。
         ⚠️ 必须布尔绑定 :defer-src-invalidation="true"——裸属性被 vue-lynx 编译为 ""（字符串）
         真机原生 <image> 按 truthy 判断时不生效（本次修复要点）；原型验证写法即绑定 true。 -->
    <image
      v-else-if="currentSrc"
      :defer-src-invalidation="true"
      class="w-full rounded-[var(--md-shape-medium)]"
      :style="{ height: heightVw }"
      :src="currentSrc"
      :mode="'aspectFit'"
      @load="onFrameLoad"
      @error="onFrameError"
    />
    <text v-if="errorMsg" class="text-body-small text-error p-4">{{ errorMsg }}</text>
    <!-- T0-DIAG 临时诊断（真机取证，验证后移除）：日志导出按钮。
         ⚠️ 必须 absolute 悬浮在图片区域内——IllustDetail 将本组件包在
         定高 + overflow-hidden 容器（detailImageHeight）里，按钮放在图片下方
         会被裁剪不可见（2026-08-31 真机取证发现）；悬浮于右上角同时更易发现。 -->
    <view
      v-if="isNativeMode() && (currentSrc || errorMsg)"
      class="absolute top-[2.133vw] right-[2.133vw] rounded-full bg-secondary-container px-4 py-2.5 active:bg-layer-pressed-on-surface"
      @tap="onExportDiag"
    >
      <text class="text-label-large text-secondary-on-container">导出诊断日志</text>
    </view>
    <text
      v-if="diagHint"
      class="absolute top-[12vw] right-[2.133vw] rounded-[var(--md-shape-small)] bg-surface-container-highest px-3 py-1.5 text-body-small"
      :class="diagHint.startsWith('导出失败') ? 'text-error' : 'text-surface-on-variant'"
    >{{ diagHint }}</text>
  </view>
</template>

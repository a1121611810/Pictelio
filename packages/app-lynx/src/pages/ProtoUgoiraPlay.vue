<script setup lang="ts">
// ────────────────────────────────────────────────────────────
// PROTOTYPE — throwaway（验证 <image> 闪烁修复候选，验证后整分支丢弃）
// 背景：#00ff00 纯绿约定用于自动取证分析（空白帧 = 全屏高占比绿色，
// 见 /tmp/analyze_flicker.py）。按钮行顶部深色，占屏比例小。
// 作品：148861562（52 帧 ugoira）
// ────────────────────────────────────────────────────────────
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { downloadUgoiraFrames, ugoiraExtractFrames, type UgoiraFrameData } from '../api/ugoira'
import { isNativeMode } from '../api/client'

const ILLUST_ID = 148861562

const variant = ref(1)
const statusText = ref('加载中...')
const frameIdx = ref(-1)
const total = ref(0)
const lastSwitchMs = ref('')

// V1/V2/V4：单 <image>
const src1 = ref('')
// V3：双图层叠
const srcA = ref('')
const srcB = ref('')
const showA = ref(true)

interface FrameLike { src: string; delay: number }

let frames: FrameLike[] = []
let cursor = 0
let timer: ReturnType<typeof setTimeout> | null = null
let disposed = false
// V3 状态机
let layerVis: 'A' | 'B' = 'A'
let shownIdx = 0
let loadingLayer: 'A' | 'B' | null = null
// V4 状态机
let v4SetAt = 0

function clearTimer() {
  if (timer) { clearTimeout(timer); timer = null }
}

// ── V1/V2：定时驱动 ──
function tickSimple(i: number) {
  if (disposed || frames.length === 0) return
  cursor = i
  frameIdx.value = i
  const f = frames[i]!
  src1.value = f.src
  console.log(`[PROTO] variant=${variant.value} frame=${i} t=${Date.now()}`)
  clearTimer()
  timer = setTimeout(() => tickSimple((i + 1) % frames.length), f.delay)
}

// ── V3：双缓冲（@load 驱动）──
function preload(idx: number, layer: 'A' | 'B') {
  if (disposed) return
  loadingLayer = layer
  const f = frames[idx]!
  if (layer === 'A') srcA.value = f.src
  else srcB.value = f.src
  // 看门狗：@load 未触发（事件不可用/隐藏层不加载）→ 强制推进并留证
  clearTimer()
  timer = setTimeout(() => {
    if (loadingLayer === layer && Date.now() - lastPreloadAt > 1500) {
      console.log(`[PROTO] variant=3 load-timeout layer=${layer} idx=${idx}`)
      onLayerLoad(layer)
    }
  }, 1500)
  lastPreloadAt = Date.now()
}
let lastPreloadAt = 0
function onLayerLoad(layer: 'A' | 'B') {
  if (variant.value !== 3 || disposed) return
  if (loadingLayer !== layer) return
  layerVis = layer
  showA.value = layerVis === 'A'
  const f = frames[shownIdx]!
  frameIdx.value = shownIdx
  lastSwitchMs.value = `${Date.now()}ms`
  console.log(`[PROTO] variant=3 frame=${shownIdx} t=${Date.now()} shownLayer=${layer}`)
  clearTimer()
  timer = setTimeout(() => {
    loadingLayer = null
    const next = (shownIdx + 1) % frames.length
    shownIdx = next
    preload(next, layer === 'A' ? 'B' : 'A')
  }, f.delay)
}

// ── V4：defer + @load 调度（防解码堆积）──
function tickV4(i: number) {
  if (disposed || frames.length === 0) return
  cursor = i
  frameIdx.value = i
  const f = frames[i]!
  src1.value = f.src
  v4SetAt = Date.now()
  console.log(`[PROTO] variant=4 frame=${i} t=${v4SetAt}`)
  // 看门狗：@load 未触发（如事件不推）则按 delay 兜底推进并留证
  clearTimer()
  timer = setTimeout(() => {
    if (Date.now() - v4SetAt > 800) {
      console.log(`[PROTO] variant=4 load-timeout frame=${i}`)
      tickV4((i + 1) % frames.length)
    }
  }, Math.max(f.delay, 800))
}
function onSingleLoad() {
  if (variant.value !== 4 || disposed || frames.length === 0) return
  const f = frames[cursor]!
  lastSwitchMs.value = `${Date.now()}ms`
  clearTimer()
  timer = setTimeout(() => tickV4((cursor + 1) % frames.length), f.delay)
}

function playFrom(i: number) {
  clearTimer()
  frameIdx.value = i
  const v = variant.value
  if (v === 1 || v === 2) {
    tickSimple(i)
  } else if (v === 3) {
    shownIdx = 0
    layerVis = 'A'
    loadingLayer = null
    srcA.value = ''
    srcB.value = ''
    showA.value = true
    preload(0, 'A')
  } else {
    tickV4(i)
  }
}

function setVariant(v: number) {
  variant.value = v
  statusText.value = `V${v}`
  playFrom(0)
}

onMounted(async () => {
  statusText.value = '加载中...'
  try {
    let list: FrameLike[] = []
    if (isNativeMode()) {
      const bundle = await ugoiraExtractFrames(ILLUST_ID)
      list = bundle.urls.map((url, i) => ({ src: url, delay: bundle.delays[i]! }))
    } else {
      const data: UgoiraFrameData[] = await downloadUgoiraFrames(ILLUST_ID, 'fflate')
      list = data.map((f) => ({ src: f.dataUrl, delay: f.delay }))
    }
    if (disposed) return
    frames = list
    total.value = list.length
    statusText.value = `V1 (${list.length} 帧)`
    playFrom(0)
  } catch (err) {
    statusText.value = `加载失败: ${(err as Error).message}`
    console.log(`[PROTO] load-failed ${(err as Error).message}`)
  }
})

onBeforeUnmount(() => {
  disposed = true
  clearTimer()
})
</script>

<template>
  <view style="background-color: #00ff00; min-height: 100vh; display: flex; flex-direction: column; align-items: center;">
    <view style="background-color: #222222; width: 100%; padding: 8px; display: flex; gap: 8px;">
      <text style="color: #fff; font-size: 24rpx;" v-for="v in [1, 2, 3, 4]" :key="v"
        @tap="setVariant(v)"
        :style="'width:25vw; height:18vw; display:flex; align-items:center; justify-content:center; background:' + (variant === v ? '#4c8' : '#555')">
        V{{ v }}
      </text>
    </view>
    <text style="color: #000; font-size: 28rpx; padding: 8px;">{{ statusText }} | frame={{ frameIdx }}/{{ total }} | {{ lastSwitchMs }}</text>

    <!-- V1/V2/V4：单图（V2/V4 带 defer-src-invalidation） -->
    <image v-if="variant !== 3" :src="src1"
      :defer-src-invalidation="variant === 2 || variant === 4"
      @load="onSingleLoad"
      style="width: 80vw; height: 80vw; background-color: #00ff00;" mode="aspectFit" />

    <!-- V3：双图层叠 -->
    <view v-else style="position: relative; width: 80vw; height: 80vw; background-color: #00ff00;">
      <image :src="srcA" v-show="showA" @load="onLayerLoad('A')" style="width: 100%; height: 100%;" mode="aspectFit" />
      <image :src="srcB" v-show="!showA" @load="onLayerLoad('B')" style="width: 100%; height: 100%;" mode="aspectFit" />
    </view>
  </view>
</template>

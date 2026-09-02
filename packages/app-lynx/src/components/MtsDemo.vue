<script setup lang="ts">
// [prototype] MTS 复核（#313）：官方姿势在原生 4.0.1 真机可用（2026-09-02，绿条跟随平移实证）。
// 本版加时延打印：MT 内 touchstart→首次 move 处理时延（对比后台线程 48ms 基线）。
import { useMainThreadRef } from 'vue-lynx'

const barRef = useMainThreadRef(null)
const startX = useMainThreadRef(0)
const offset = useMainThreadRef(0)
const dragging = useMainThreadRef(false)
const t0 = useMainThreadRef(0)

function mtStart(e: { touches: { clientX: number }[] }) {
  'main thread'
  startX.current = e.touches[0].clientX
  dragging.current = true
  t0.current = Date.now()
}

function mtMove(e: { touches: { clientX: number }[] }) {
  'main thread'
  if (!dragging.current) return
  const dx = e.touches[0].clientX - startX.current
  offset.current = dx
  barRef.current?.setStyleProperty('transform', `translateX(${offset.current}px)`)
  if (t0.current > 0) {
    console.log(`[BENCH_MT] t0=${t0.current} t1=${Date.now()} latency=${Date.now() - t0.current}`)
    t0.current = 0
  }
}

function mtEnd() {
  'main thread'
  dragging.current = false
}
</script>

<template>
  <view
    class="absolute top-0 left-0 w-full h-[30vw]"
    :main-thread-bindtouchstart="mtStart"
    :main-thread-bindtouchmove="mtMove"
    :main-thread-bindtouchend="mtEnd"
  >
    <view
      :main-thread-ref="barRef"
      class="absolute top-[5vw] left-0 h-[20vw] w-[180px]"
      style="background-color: rgb(76, 175, 80);"
    />
    <text class="absolute top-0 left-0 w-full text-[3vw] text-center">MTS 复核（时延版）</text>
  </view>
</template>

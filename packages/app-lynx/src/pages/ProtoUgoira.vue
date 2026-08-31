<script setup lang="ts">
// 【PROTOTYPE】Ugoira 播放管线三方案 + 基线对照（throwaway，验证后删除）
// 目的：pictelio_ui 模拟器上实测
//   - 基线：现状（相对路径 /pixiv-img fetch，预期 issue #218 复现）
//   - A   ：原生 fetch 绝对 URL（尝试带 Referer）
//   - B   ：Java 网关下载（protoDownloadFile, base64 回传）→ JS fflate 取帧
//   - C   ：Java 解压写盘（protoExtractUgoira, file:// 帧 URL）→ <image> 直接播放
// 每个方案展示：耗时 / 帧数 / 错误 / 首帧渲染。
import { ref } from 'vue'
import { loadUgoiraMetadata } from '../api/illust'
import { unzipFrames } from '@pictelio/ugoira'
import { getNativeModules } from '../api/client'
import { proxyImageUrl } from '../utils/imageUrl'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
/** [PROTOTYPE] lynx 原生环境无 btoa（实测），内联纯 JS base64 编码 */
function bytesToDataUrlProto(bytes: Uint8Array, mime: string): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0
    out += B64[b0 >> 2]! + B64[((b0 & 3) << 4) | (b1 >> 4)]! +
      (i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)]! : '=') +
      (i + 2 < bytes.length ? B64[b2 & 63]! : '=')
  }
  return `data:${mime};base64,${out}`
}
/** [PROTOTYPE] lynx 原生环境无 atob（实测），内联纯 JS base64 解码 */
function atobProto(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let oi = 0
  let acc = 0
  let bits = 0
  for (const ch of clean) {
    const v = B64.indexOf(ch)
    if (v < 0) continue
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[oi++] = (acc >> bits) & 0xff
    }
  }
  return out.subarray(0, oi)
}

interface ProtoResult {
  name: string
  status: 'pending' | 'ok' | 'fail'
  ms: number
  frames: number
  error: string
  firstSrc: string
}

const illustId = ref(148861562)
const results = ref<ProtoResult[]>([])
const running = ref(false)
/** [PROTOTYPE] C 方案独立结果（排除数组响应式干扰） */
const cResult = ref<ProtoResult | null>(null)
const cImgLog = ref('')

function mk(name: string): ProtoResult {
  return { name, status: 'pending', ms: 0, frames: 0, error: '', firstSrc: '' }
}

async function withTiming(name: string, fn: () => Promise<string | null>): Promise<ProtoResult> {
  const r = mk(name)
  results.value.push(r)
  const t0 = Date.now()
  try {
    const src = await fn()
    r.ms = Date.now() - t0
    r.status = 'ok'
    r.firstSrc = src ?? ''
  } catch (err) {
    r.ms = Date.now() - t0
    r.status = 'fail'
    r.error = err instanceof Error ? err.message : String(err)
  }
  return r
}

async function fetchMeta() {
  const meta = await loadUgoiraMetadata(illustId.value)
  return { meta, zipUrl: meta.zip_urls.medium }
}

/** 基线：现状逻辑（相对路径 + 原生 fetch —— 预期复现 #218） */
async function runBaseline() {
  return withTiming('基线(现状：/pixiv-img 相对路径)', async () => {
    const { meta, zipUrl } = await fetchMeta()
    const rel = proxyImageUrl(zipUrl)
    const resp = await fetch(rel)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const buf = new Uint8Array(await resp.arrayBuffer())
    const files = meta.frames.map((f) => f.file)
    const segs = unzipFrames(buf, files)
    return segs.length > 0 ? bytesToDataUrlProto(segs[0]!, 'image/jpeg') : null
  })
}

/** 方案 A：原生 fetch 绝对 URL（无 Referer 尝试） */
async function runA() {
  return withTiming('A: 原生 fetch 绝对 URL(无 Referer)', async () => {
    const { meta, zipUrl } = await fetchMeta()
    const resp = await fetch(zipUrl)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const buf = new Uint8Array(await resp.arrayBuffer())
    const files = meta.frames.map((f) => f.file)
    const segs = unzipFrames(buf, files)
    return segs.length > 0 ? bytesToDataUrlProto(segs[0]!, 'image/png') : null
  })
}

/** 方案 A2：原生 fetch 绝对 URL + Referer 头 */
async function runA2() {
  return withTiming('A2: 原生 fetch 绝对 URL+Referer', async () => {
    const { meta, zipUrl } = await fetchMeta()
    const resp = await fetch(zipUrl, { headers: { Referer: 'https://app-api.pixiv.net/' } })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const buf = new Uint8Array(await resp.arrayBuffer())
    const files = meta.frames.map((f) => f.file)
    const segs = unzipFrames(buf, files)
    return segs.length > 0 ? bytesToDataUrlProto(segs[0]!, 'image/png') : null
  })
}

/** 方案 B：Java 网关下载 zip(bytes) → base64 → JS fflate 取帧 */
async function runB() {
  return withTiming('B: Java 网关下载(base64)+JS fflate', async () => {
    const { meta, zipUrl } = await fetchMeta()
    const ok = await new Promise<{ data: string }>((resolve, reject) => {
      const nm = getNativeModules() as { PictelioApi?: { protoDownloadFile: (u: string, cb: (s: number, d: string) => void) => void } }
      nm?.PictelioApi?.protoDownloadFile(zipUrl, (s, d) => {
        if (s === 0) resolve({ data: d })
        else reject(new Error(d))
      })
    })
    const buf = atobProto(ok.data)
    const files = meta.frames.map((f) => f.file)
    const segs = unzipFrames(buf, files)
    return segs.length > 0 ? bytesToDataUrlProto(segs[0]!, 'image/png') : null
  })
}

/** 方案 C：Java 解压写盘 → file:// 帧 URL 列表（独立 ref 显示，排除数组响应式干扰） */
async function runC() {
  const r = mk('C: Java 解压写盘(file:// 帧)')
  cResult.value = r
  const t0 = Date.now()
  try {
    const { meta, zipUrl } = await fetchMeta()
    const namesJson = JSON.stringify(meta.frames.map((f) => f.file))
    const urls = await new Promise<string>((resolve, reject) => {
      const nm = getNativeModules() as { PictelioApi?: { protoExtractUgoira: (u: string, n: string, cb: (s: number, d: string) => void) => void } }
      console.log('[PROTO] C 调用 protoExtractUgoira', zipUrl)
      nm?.PictelioApi?.protoExtractUgoira(zipUrl, namesJson, (s, d) => {
        console.log('[PROTO] C 回调 status=', s, 'd.len=', d.length)
        if (s === 0) resolve(d)
        else reject(new Error(d))
      })
    })
    console.log('[PROTO] C resolved urls.len=', urls.length)
    const urlsArr: string[] = JSON.parse(urls)
    // 整体替换 ref 值（vue-lynx 对对象属性变更不触发模板更新，实测）
    cResult.value = {
      ...r,
      ms: Date.now() - t0,
      status: 'ok',
      frames: urlsArr.length,
      firstSrc: urlsArr[0] ?? '',
    }
    console.log('[PROTO] C 完成 ok frames=', urlsArr.length, 'src=', (urlsArr[0] ?? '').slice(0, 60))
    return cResult.value
  } catch (err) {
    cResult.value = {
      ...r,
      ms: Date.now() - t0,
      status: 'fail',
      error: err instanceof Error ? err.message : String(err),
    }
    console.log('[PROTO] C 失败', cResult.value.error)
    return cResult.value
  }
}

function onImgLoad(which: string) {
  cImgLog.value = `${which} onLoad`
  console.log('[PROTO] image onLoad:', which)
}
function onImgError(which: string) {
  cImgLog.value = `${which} onError`
  console.log('[PROTO] image onError:', which)
}

async function runAll() {
  if (running.value) return
  running.value = true
  results.value = []
  cResult.value = null
  try {
    await runBaseline()
    await runA()
    await runA2()
    await runB()
    await runC()
  } finally {
    running.value = false
  }
}
</script>

<template>
  <view class="w-full h-full bg-surface flex flex-col">
    <view class="p-4">
      <text class="text-title-large text-surface-on">PROTO: ugoira 三方案对比</text>
      <text class="text-body-small text-surface-on-variant block mt-1">作品 ID（默认 148861562，issue #218 复现作品）</text>
      <view class="flex flex-row items-center gap-2 mt-2">
        <text class="text-body-medium text-surface-on flex-1">{{ illustId }}</text>
        <view class="px-4 py-2 bg-primary rounded-[var(--md-shape-small)]" @tap="runAll">
          <text class="text-label-large text-primary-on">运行全部</text>
        </view>
      </view>
    </view>
    <view class="flex-1 min-h-0 overflow-y-auto">
      <!-- [PROTOTYPE] C 方案独立结果卡（置顶显示，避免滚动） -->
      <view v-if="cResult" class="mx-4 mb-3 p-3 rounded-[var(--md-shape-medium)] bg-surface-container-lowest">
        <view class="flex flex-row items-center justify-between">
          <text class="text-label-large text-surface-on">{{ cResult.name }}</text>
          <text class="text-label-medium" :class="cResult.status === 'ok' ? 'text-primary' : 'text-error'">
            {{ cResult.status === 'ok' ? `OK ${cResult.ms}ms / ${cResult.frames}帧` : 'FAIL' }}
          </text>
        </view>
        <text v-if="cResult.error" class="text-body-small text-error block mt-1">{{ cResult.error }}</text>
        <image
          v-if="cResult.firstSrc"
          class="w-full mt-2 rounded-[var(--md-shape-extra-small)]"
          style="height: 240rpx"
          :src="cResult.firstSrc"
          mode="aspectFit"
          @load="onImgLoad('C')"
          @error="onImgError('C')"
        />
        <text class="text-body-small text-surface-on-variant block mt-1">img: {{ cImgLog }}</text>
      </view>

      <view v-for="r in results" :key="r.name" class="mx-4 mb-3 p-3 rounded-[var(--md-shape-medium)] bg-surface-container-lowest">
        <view class="flex flex-row items-center justify-between">
          <text class="text-label-large text-surface-on">{{ r.name }}</text>
          <text
            class="text-label-medium"
            :class="r.status === 'ok' ? 'text-primary' : r.status === 'fail' ? 'text-error' : 'text-outline'"
          >{{ r.status === 'ok' ? `OK ${r.ms}ms / ${r.frames || '?'}帧` : r.status === 'fail' ? `FAIL ${r.ms}ms` : '运行中…' }}</text>
        </view>
        <text v-if="r.error" class="text-body-small text-error block mt-1">{{ r.error }}</text>
        <image v-if="r.firstSrc && r.status === 'ok'" class="w-full mt-2 rounded-[var(--md-shape-extra-small)]" style="height: 240rpx" :src="r.firstSrc" mode="aspectFit" />
      </view>
    </view>
  </view>
</template>

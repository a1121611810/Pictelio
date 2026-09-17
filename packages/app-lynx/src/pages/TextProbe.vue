<script setup lang="ts">
// 【探针页 · wayfinder #559（throwaway 分支 probe/text-selection-559，不入 main）】
// 目的：在真机/模拟器上回答 lynx 4.0.1 的选中能力问题——
//   ① <list list-type="single"> 虚拟化的 <text> 能否选中（长按 vs 滚动）
//   ② custom-context-menu 是否替换系统 ActionMode；自绘菜单能否按 getTextBoundingRect 定位
//   ③ getSelectedText / selectionchange 是否派发
//   ④ 跨段 setTextSelection（custom-text-selection）是否可行
//   ⑤ 滚动/回收（recyclable）对选中态的影响；flatten={false} 的观感代价
//   ⑥ 运行时环境：navigator.clipboard / lynx 全局 API 面
// 不联网、不登录；probe 构建把初始路由指向本页（router.ts PROBE 注释处临时改）。
import { ref, computed, onMounted } from 'vue'

type Mode = 'native' | 'custom-menu' | 'cross' | 'static-attrs'

const mode = ref<Mode>('native')
const flatten = ref(false) // false = flatten={false}（文档要求：选中必须非扁平化）
const recyclable = ref(true) // list-item 回收开关（回收实验）

const logs = ref<string[]>([])
function log(msg: string): void {
  logs.value = [`${logs.value.length + 1}. ${msg}`, ...logs.value].slice(0, 4)
}

const BASE = ['这是一段用于选中实证的正文，长按试试。', '第二句用来观察选区手柄与菜单定位。', '第三句让段落足够长以便滚动与回收实验。']
const paragraphs = Array.from(
  { length: 30 },
  (_, i) => `第 ${i + 1} 段．${BASE[i % 3]}${BASE[(i + 1) % 3]}${BASE[(i + 2) % 3]}`,
)

const selStart = ref(-1)
const selEnd = ref(-1)
const selDir = ref('')
const selTarget = ref('')
const selectedText = ref('')
const rect = ref<{ left: number; top: number; width: number; height: number } | null>(null)
const screenW = ref(0)

const menuVisible = computed(() => mode.value === 'custom-menu' && selStart.value >= 0 && rect.value !== null)
const selSummary = computed(
  () => `start=${selStart.value} end=${selEnd.value} dir=${selDir.value} target=${selTarget.value}`,
)
const rectSummary = computed(() =>
  rect.value
    ? `l=${Math.round(rect.value.left)} t=${Math.round(rect.value.top)} w=${Math.round(rect.value.width)} h=${Math.round(rect.value.height)}`
    : 'null',
)
const envSummary = computed(() => {
  const nav = (globalThis as any).navigator
  return `nav=${typeof nav} clip=${typeof nav?.clipboard} wt=${typeof nav?.clipboard?.writeText}`
})
// 菜单定位：boundingRect(px) → vw（原生定位锚点语义：安全模式 = (0,0) 锚点 + left/top vw + translate）
// 校准：同时投放 A（rect 当 px，页原点）与 B（rect 当 dp ×3）两个标记，截图比对哪个落在选区上
const DP_RATIO = 3 // 480dpi / 160
function toVw(v: number): number {
  return screenW.value > 0 ? (v / screenW.value) * 100 : 0
}
const menuStyle = computed(() => {
  const r = rect.value
  if (!r || !screenW.value) return 'left: 4vw; top: 26vw'
  // rect 单位 = 内容区 dp（实证：node w=329dp=987px、h=63dp=189px）→ 先 ×density 得 px
  const leftVw = toVw((r.left + r.width / 2) * DP_RATIO)
  const topVw = toVw((r.top - 6) * DP_RATIO)
  return `left: ${leftVw}vw; top: ${Math.max(2, topVw)}vw; transform: translate(-50%, -100%)`
})
const markerAStyle = computed(() => {
  const r = rect.value
  if (!r || !screenW.value) return 'display: none'
  return `left: ${toVw(r.left)}vw; top: ${toVw(r.top)}vw`
})
const markerBStyle = computed(() => {
  const r = rect.value
  if (!r || !screenW.value) return 'display: none'
  return `left: ${toVw(r.left * DP_RATIO)}vw; top: ${toVw(r.top * DP_RATIO)}vw`
})

function lynxGlobal(): any {
  return (globalThis as any).lynx ?? (typeof lynx !== 'undefined' ? (lynx as any) : undefined)
}
function queryNode(id: string): any | null {
  const L = lynxGlobal()
  if (!L?.createSelectorQuery) {
    log('[q] createSelectorQuery 不可用')
    return null
  }
  return L.createSelectorQuery().select(`#${id}`)
}
function invokeRect(id: string, start: number, end: number): void {
  const q = queryNode(id)
  if (!q) return
  q.invoke({
    method: 'getTextBoundingRect',
    params: { start, end },
    success: (res: any) => {
      const r = res?.boundingRect
      rect.value = r && typeof r.left === 'number' ? { left: r.left, top: r.top, width: r.width, height: r.height } : null
      log(`[rect] ${JSON.stringify(r)}`)
    },
    fail: (res: any) => log(`[rect] FAIL ${JSON.stringify(res)}`),
  }).exec()
}
function invokeSelectedText(id: string): void {
  const q = queryNode(id)
  if (!q) return
  q.invoke({
    method: 'getSelectedText',
    params: {},
    success: (res: any) => {
      const t = typeof res === 'string' ? res : (res?.selectedText ?? JSON.stringify(res))
      selectedText.value = String(t).slice(0, 36)
      log(`[text] ${selectedText.value}`)
    },
    fail: (res: any) => log(`[text] FAIL ${JSON.stringify(res)}`),
  }).exec()
}
function onSelectionChange(e: any): void {
  const d = e?.detail ?? {}
  selStart.value = typeof d.start === 'number' ? d.start : -1
  selEnd.value = typeof d.end === 'number' ? d.end : -1
  selDir.value = String(d.direction ?? '')
  selTarget.value = String(e?.target?.id ?? '?')
  log(`[sel] ${selSummary.value}`)
  if (selStart.value === -1) {
    rect.value = null
    selectedText.value = ''
    return
  }
  invokeRect(selTarget.value, selStart.value, selEnd.value)
  invokeSelectedText(selTarget.value)
}
function setTextSelectionOn(id: string, r: { width: number; height: number }, showStart: boolean, showEnd: boolean): void {
  const q = queryNode(id)
  if (!q) return
  q.invoke({
    method: 'setTextSelection',
    params: { startX: 0, startY: 0, endX: r.width, endY: r.height, showStartHandle: showStart, showEndHandle: showEnd },
    success: (res: any) => log(`[cross] ${id} ok boxes=${Array.isArray(res?.boxes) ? res.boxes.length : 'n/a'}`),
    fail: (res: any) => log(`[cross] ${id} FAIL ${JSON.stringify(res)}`),
  }).exec()
}
function nodeRect(id: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const L = lynxGlobal()
    if (!L?.createSelectorQuery) {
      resolve(null)
      return
    }
    L.createSelectorQuery()
      .select(`#${id}`)
      .invoke({
        method: 'boundingClientRect',
        success: (res: any) => resolve(res && typeof res.width === 'number' ? { width: res.width, height: res.height } : null),
        fail: () => resolve(null),
      })
      .exec()
  })
}
async function selectWhole(id: string): Promise<void> {
  const r = await nodeRect(id)
  log(`[rect] ${id} nodeRect=${r ? `${Math.round(r.width)}x${Math.round(r.height)}` : 'null'}`)
  if (r) setTextSelectionOn(id, r, true, true)
}
async function crossSelect(): Promise<void> {
  for (const [i, id] of ['p0', 'p1'].entries()) {
    const r = await nodeRect(id)
    if (!r) {
      log(`[cross] ${id} nodeRect null`)
      continue
    }
    setTextSelectionOn(id, r, i === 0, i === 1)
  }
}
function clearSelection(): void {
  setTextSelectionOn('p0', { width: 0, height: 0 }, false, false)
  const q = queryNode('p0')
  if (!q) return
  q.invoke({
    method: 'setTextSelection',
    params: { startX: -1, startY: -1, endX: -1, endY: -1, showStartHandle: false, showEndHandle: false },
    success: () => log('[clear] ok'),
    fail: (res: any) => log(`[clear] FAIL ${JSON.stringify(res)}`),
  }).exec()
}
function envProbe(): void {
  const L = lynxGlobal()
  log(`[env] ${envSummary.value}`)
  log(`[env] lynxKeys=${L ? Object.keys(L).slice(0, 14).join(',') : 'none'}`)
  let info: unknown = null
  try {
    info = L?.getSystemInfo?.() ?? null
  } catch (err) {
    log(`[env] getSystemInfo 抛错 ${String(err)}`)
  }
  log(`[env] sysinfo=${JSON.stringify(info).slice(0, 90)}`)
}
// 坐标系判定：同节点取 boundingClientRect（页面坐标权威）与 getTextBoundingRect（全选区）对比
function probeFrames(): void {
  const L = lynxGlobal()
  if (!L?.createSelectorQuery) {
    log('[frame] createSelectorQuery 不可用')
    return
  }
  L.createSelectorQuery()
    .select('#p0')
    .invoke({
      method: 'boundingClientRect',
      success: (res: any) =>
        log(`[frame] node l=${Math.round(res?.left)} t=${Math.round(res?.top)} w=${Math.round(res?.width)} h=${Math.round(res?.height)}`),
      fail: (res: any) => log(`[frame] node FAIL ${JSON.stringify(res)}`),
    })
    .exec()
  const q = queryNode('p0')
  if (!q) return
  q.invoke({
    method: 'getTextBoundingRect',
    params: { start: 0, end: 9999 },
    success: (res: any) => {
      const r = res?.boundingRect
      log(`[frame] text l=${Math.round(r?.left)} t=${Math.round(r?.top)} w=${Math.round(r?.width)} h=${Math.round(r?.height)}`)
    },
    fail: (res: any) => log(`[frame] text FAIL ${JSON.stringify(res)}`),
  }).exec()
}
// 模板处理器一律走方法（内联赋值在 vue-lynx 编译下行为待证，先规避）
function setMode(m: Mode): void {
  mode.value = m
  log(`[ctl] mode=${m}`)
}
function toggleFlatten(): void {
  flatten.value = !flatten.value
  log(`[ctl] flatten=${flatten.value}`)
}
function toggleRecyclable(): void {
  recyclable.value = !recyclable.value
  log(`[ctl] recyclable=${recyclable.value}`)
}

onMounted(() => {
  const L = lynxGlobal()
  let info: any = null
  try {
    info = L?.getSystemInfo?.() ?? null
  } catch {
    info = null
  }
  screenW.value = Number(info?.screenWidth ?? info?.windowWidth ?? 0)
  log(`[boot] screenW=${screenW.value} sysinfoKeys=${info ? Object.keys(info).join(',') : 'none'}`)
  // lynx.getSystemInfo 在本构建不可用 → 取原生内容区尺寸契约（ADR-0131，PictelioApp.getViewportSize）
  // 注意：NativeModules 在 Lepus 里是词法全局，globalThis 上可能没有（与 api/client 同款裸引用）
  let nm: any
  try {
    nm = typeof NativeModules !== 'undefined' ? NativeModules : (globalThis as any).NativeModules
  } catch {
    nm = (globalThis as any).NativeModules
  }
  log(`[env] nm=${typeof nm} keys=${nm ? Object.keys(nm).slice(0, 6).join(',') : 'none'}`)
  const api = nm?.PictelioApp?.getViewportSize
  if (typeof api === 'function') {
    try {
      api((w: number, h: number) => {
        screenW.value = w
        log(`[env] viewport=${w}x${h}`)
      })
      log('[env] viewportSize 契约已注册')
    } catch (err) {
      log(`[env] viewportSize 抛错 ${String(err)}`)
    }
  } else {
    screenW.value = 1080 // 探针兜底：仅本模拟器（1080x2160）有效
    log('[env] viewportSize 契约缺失，兜底 screenW=1080')
  }
  log(`[boot] mode=${mode.value} flatten=${flatten.value} recyclable=${recyclable.value}`)
})
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- 状态区（固定顶部）：所有证据同时上屏，截图即取证 -->
    <view class="px-3 pt-3 pb-2 bg-surface-container">
      <text class="text-[24rpx] text-surface-on">mode={{ mode }} · flatten={{ flatten }} · recyclable={{ recyclable }}</text>
      <text class="text-[24rpx] text-surface-on">sel: {{ selSummary }}</text>
      <text class="text-[24rpx] text-surface-on">rect: {{ rectSummary }}</text>
      <text class="text-[24rpx] text-surface-on">text: «{{ selectedText }}»</text>
      <view class="flex flex-row flex-wrap gap-2 mt-2">
        <view class="px-2 py-1 bg-primary rounded-[var(--md-shape-small)]" @tap="setMode('native')">
          <text class="text-[24rpx] text-primary-on">[原生菜单]</text>
        </view>
        <view class="px-2 py-1 bg-primary rounded-[var(--md-shape-small)]" @tap="setMode('custom-menu')">
          <text class="text-[24rpx] text-primary-on">[自绘菜单]</text>
        </view>
        <view class="px-2 py-1 bg-primary rounded-[var(--md-shape-small)]" @tap="setMode('cross')">
          <text class="text-[24rpx] text-primary-on">[跨段模式]</text>
        </view>
        <view class="px-2 py-1 bg-primary rounded-[var(--md-shape-small)]" @tap="setMode('static-attrs')">
          <text class="text-[24rpx] text-primary-on">[静态属性]</text>
        </view>
        <view class="px-2 py-1 bg-secondary rounded-[var(--md-shape-small)]" @tap="toggleFlatten">
          <text class="text-[24rpx] text-secondary-on">[flatten 翻转]</text>
        </view>
        <view class="px-2 py-1 bg-secondary rounded-[var(--md-shape-small)]" @tap="toggleRecyclable">
          <text class="text-[24rpx] text-secondary-on">[recyclable 翻转]</text>
        </view>
        <view class="px-2 py-1 bg-secondary rounded-[var(--md-shape-small)]" @tap="envProbe">
          <text class="text-[24rpx] text-secondary-on">[环境探测]</text>
        </view>
        <view class="px-2 py-1 bg-tertiary rounded-[var(--md-shape-small)]" @tap="selectWhole('p0')">
          <text class="text-[24rpx] text-tertiary-on">[全选 p0]</text>
        </view>
        <view class="px-2 py-1 bg-tertiary rounded-[var(--md-shape-small)]" @tap="crossSelect">
          <text class="text-[24rpx] text-tertiary-on">[跨段 p0+p1]</text>
        </view>
        <view class="px-2 py-1 bg-tertiary rounded-[var(--md-shape-small)]" @tap="probeFrames">
          <text class="text-[24rpx] text-tertiary-on">[测坐标系]</text>
        </view>
        <view class="px-2 py-1 bg-tertiary rounded-[var(--md-shape-small)]" @tap="clearSelection">
          <text class="text-[24rpx] text-tertiary-on">[清空选择]</text>
        </view>
      </view>
      <text v-for="(l, i) in logs" :key="i" class="text-[20rpx] text-on-surface-variant">{{ l }}</text>
    </view>

    <!-- 正文列表：结构对齐 NovelDetail.vue（list single + 每段一个 list-item + 单个 <text>） -->
    <list class="w-full flex-1 min-h-0" list-type="single" scroll-orientation="vertical">
      <!-- 取证锚点（洋红条）：adb 取点脚本据此定位正文首行（色值 #ff00ff） -->
      <list-item :item-key="'anchor'" :estimated-main-axis-size-px="8" class="w-full">
        <view class="w-full h-[2vw] bg-[#ff00ff]" />
      </list-item>
      <list-item
        v-for="(p, idx) in paragraphs"
        :key="`p-${idx}`"
        :item-key="`p-${idx}`"
        :estimated-main-axis-size-px="120"
        :recyclable="recyclable"
        class="w-full px-4 mb-4"
      >
        <text
          v-if="mode === 'static-attrs'"
          :id="`p${idx}`"
          class="text-body-large leading-[44rpx] text-surface-on"
          text-selection="true"
          custom-context-menu="true"
          flatten="true"
          :bindselectionchange="onSelectionChange"
          >{{ p }}</text
        >
        <text
          v-else
          :id="`p${idx}`"
          class="text-body-large leading-[44rpx] text-surface-on"
          :text-selection="true"
          :flatten="flatten"
          :custom-context-menu="mode === 'custom-menu'"
          :custom-text-selection="mode === 'cross'"
          :bindselectionchange="onSelectionChange"
          >{{ p }}</text
        >
      </list-item>
    </list>

    <!-- 校准标记：A = rect 当 px（红），B = rect 当 dp×3（绿）；比对哪个落在选区上 -->
    <view v-if="rect && screenW" class="absolute z-40 w-[3vw] h-[3vw] bg-[#ff0000]" :style="markerAStyle" />
    <view v-if="rect && screenW" class="absolute z-40 w-[3vw] h-[3vw] bg-[#00ff00]" :style="markerBStyle" />

    <!-- 自绘菜单（custom-context-menu 模式）：位置由 getTextBoundingRect 驱动 -->
    <view
      v-if="menuVisible"
      class="absolute z-50 bg-inverse-surface rounded-[var(--md-shape-medium)] px-3 py-2 flex flex-row"
      :style="menuStyle"
    >
      <text class="text-[26rpx] text-inverse-on-surface" @tap="log('[menu] 复制（占位：无剪贴板通道）')">复制</text>
      <text class="text-[26rpx] text-inverse-on-surface ml-4" @tap="log('[menu] 搜索（占位）')">搜索</text>
    </view>
  </view>
</template>

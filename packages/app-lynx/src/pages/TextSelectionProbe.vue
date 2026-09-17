<script setup lang="ts">
// 【清选策略探针 · PROBE-ONLY（结论落地后删除；证据归档 probe/text-selection-559）】
// 目的：找出**真能让引擎侧原生高亮消失**的调用。当前实现用 S1（全负坐标 + 不显示手柄），
// 设备实测滚动收起后高亮残留 → 逐个试替代方案。
// 设计：策略按钮放在**页脚**（列表之外的空白区，实测点这里不清选），避免「点按钮」本身把选区清掉混淆结论。
import { ref } from 'vue'
import { useTextSelection } from '../composables/useTextSelection'
import TextSelectionToolbar from '../components/TextSelectionToolbar.vue'

const SAMPLE = [
  '这是一段用于清选实验的正文，长按可以选中它。',
  '第二段：选中后点页脚按钮，逐个试不同的清选调用。',
  '第三段：观察蓝色高亮与圆形手柄是否消失。',
  '第四段：每次实验前都要重新长按选中。',
  '第五段：继续加内容让列表可滚动。',
]
const paragraphs = ref<readonly string[]>(SAMPLE)
const selection = useTextSelection({ paragraphs })
/** 最近一次选中的节点 id（清选调用要用它） */
const lastNodeId = ref('p-0')
const log = ref('(未实验)')
type Mode = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5'
/** 当前模式（页脚按钮切换；按钮点击发生在无选中态，不干扰实验） */
const mode = ref<Mode>('S0')
let pendingTimer: ReturnType<typeof setTimeout> | undefined
/** 列表重建实验用的 epoch */
const epoch = ref(0)

function onProbeSelection(e: unknown): void {
  const ev = e as { target?: { id?: string }; detail?: { start?: number; end?: number } }
  const hasSelection =
    typeof ev?.target?.id === 'string' && ev.detail?.start !== undefined && ev.detail.start >= 0
  if (hasSelection && ev.target?.id !== undefined) {
    lastNodeId.value = ev.target.id
  }
  selection.onSelectionChange(e as never)
  // 自动执行：选中建立后 2.5s 跑当前模式（无点击 → 结论不被「点一下就清」混淆）
  clearTimeout(pendingTimer)
  if (hasSelection && mode.value !== 'S0') {
    log.value = `等待执行 ${mode.value} …`
    pendingTimer = setTimeout(() => runStrategy(mode.value), 2500)
  }
}

function query(): { select(s: string): { invoke(o: Record<string, unknown>): { exec(): void } } } | undefined {
  const L = (typeof lynx !== 'undefined' ? lynx : (globalThis as { lynx?: unknown }).lynx) as
    | { createSelectorQuery?: () => unknown }
    | undefined
  return L?.createSelectorQuery?.() as never
}

/** 在指定节点上发一次 setTextSelection（不同策略的差异只在参数） */
function invokeSelection(
  nodeId: string,
  params: Record<string, unknown>,
  onDone: (ok: boolean) => void,
): void {
  const q = query()
  if (!q) {
    onDone(false)
    return
  }
  let settled = false
  const finish = (ok: boolean): void => {
    if (settled) return
    settled = true
    onDone(ok)
  }
  q.select('#' + nodeId)
    .invoke({
      method: 'setTextSelection',
      params: { showStartHandle: false, showEndHandle: false, ...params },
      success: () => finish(true),
      fail: () => finish(false),
    })
    .exec()
  setTimeout(() => finish(false), 1200)
}

function runStrategy(key: string): void {
  const node = lastNodeId.value
  const results: string[] = []
  const done = (label: string) => (ok: boolean): void => {
    results.push(`${label}:${ok ? 'ok' : 'fail'}`)
    log.value = `${key} → ${results.join(' ')} （节点 ${node}）`
  }
  if (key === 'S1') {
    // 现状：全负坐标 + 不显示手柄
    invokeSelection(node, { startX: -1, startY: -1, endX: -1, endY: -1 }, done('全负'))
  } else if (key === 'S2') {
    // 零长度 range（0,0）
    invokeSelection(node, { startX: 0, startY: 0, endX: 0, endY: 0 }, done('零长'))
  } else if (key === 'S3') {
    // 先给极小区间，再清
    invokeSelection(node, { startX: 0, startY: 0, endX: 2, endY: 2 }, done('极小区间'))
    setTimeout(() => invokeSelection(node, { startX: -1, startY: -1, endX: -1, endY: -1 }, done('再全负')), 250)
  } else if (key === 'S4') {
    // 对全部段落节点各发一次（引擎可能把选区记在别的节点上）
    let pending = paragraphs.value.length
    for (const [idx] of paragraphs.value.entries()) {
      invokeSelection(`p-${idx}`, { startX: -1, startY: -1, endX: -1, endY: -1 }, (ok) => {
        done(`p-${idx}`)(ok)
        if (--pending === 0) log.value = `${key} → 全部节点已发（${results.filter((r) => r.endsWith(':ok')).length}/${results.length} ok）`
      })
    }
  } else if (key === 'S5') {
    // 整表重建（epoch 换 key → 引擎丢弃节点，选区随之消失；代价是滚动位置回顶）
    epoch.value += 1
    log.value = `${key} → 已触发整表重建（epoch=${epoch.value}）`
  }
}

function setMode(key: Mode): void {
  mode.value = key
  log.value = `模式 = ${key}（长按选中后自动执行）`
}

function onSelectionAction(key: 'copy' | 'search'): void {
  if (key === 'copy') {
    selection.copy()
    return
  }
  selection.search()
}
</script>

<template>
  <view
    :id="selection.rootId"
    class="w-full h-full flex flex-col relative bg-surface"
    @tap="selection.onTapAway"
    @longpress="selection.notifyLongPress"
  >
    <view class="px-3 pt-2 pb-1 bg-surface-container">
      <text class="text-[26rpx] text-surface-on">清选策略探针 · S1 全负 / S2 零长 / S3 极小区间 / S4 全节点 / S5 整表重建</text>
      <text class="text-[24rpx] text-surface-on">visible={{ selection.view.visible }} · node={{ lastNodeId }}</text>
      <text class="text-[24rpx] text-on-surface-variant">{{ log }}</text>
    </view>

    <list
      :key="epoch"
      class="w-full flex-1 min-h-0"
      list-type="single"
      scroll-orientation="vertical"
      :scroll-event-throttle="0"
      @scroll="selection.onScroll"
    >
      <list-item :item-key="'anchor'" :estimated-main-axis-size-px="8" class="w-full">
        <view class="w-full h-[2vw] bg-[#ff00ff]" />
      </list-item>
      <list-item
        v-for="(p, idx) in paragraphs"
        :key="selection.paragraphId(idx)"
        :item-key="selection.paragraphId(idx)"
        :estimated-main-axis-size-px="120"
        class="w-full px-4 mb-4"
      >
        <text
          :id="selection.paragraphId(idx)"
          class="text-body-large leading-[44rpx] text-surface-on"
          text-selection="true"
          flatten="false"
          custom-context-menu="true"
          :bindselectionchange="onProbeSelection"
          >{{ p }}</text
        >
      </list-item>
    </list>

    <!-- 策略按钮放页脚（列表外的空白区；实测点这里不清选，避免混淆结论） -->
    <view class="w-full flex flex-row flex-wrap gap-2 px-3 py-2 bg-surface-container">
      <view
        v-for="key in ['S0', 'S1', 'S2', 'S3', 'S4', 'S5']"
        :key="key"
        class="px-3 py-1 rounded-[var(--md-shape-small)]"
        :class="mode === key ? 'bg-primary' : 'bg-surface-container-highest'"
        @tap="setMode(key as Mode)"
      >
        <text class="text-[26rpx]" :class="mode === key ? 'text-primary-on' : 'text-surface-on'">{{ key }}</text>
      </view>
    </view>

    <TextSelectionToolbar :view="selection.view" @action="onSelectionAction" />
  </view>
</template>

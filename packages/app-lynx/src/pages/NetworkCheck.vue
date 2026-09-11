<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'network-check' })
import { ref } from 'vue'
import { evaluate, formatReport, type DiagInput, type DiagReport, type DiagStatus } from '@pictelio/net-diagnostics'
import { collectNetDiagInput } from '../utils/netDiagnostics'
import { useAuthStore } from '../stores/authStore'
import { goBack } from '../router'

const auth = useAuthStore()
const report = ref<DiagReport | null>(null)
const input = ref<DiagInput | null>(null)
const running = ref(false)
const copied = ref(false)

const STATUS_LABEL: Record<DiagStatus, string> = { ok: '通过', warn: '注意', fail: '失败', skipped: '跳过' }
const STATUS_CLASS: Record<DiagStatus, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  fail: 'text-error',
  skipped: 'text-outline',
}

async function run() {
  if (running.value) return
  running.value = true
  copied.value = false
  try {
    const uid = auth.currentUser?.id
    const inp = await collectNetDiagInput(__APP_VERSION__, uid === undefined ? undefined : String(uid))
    input.value = inp
    report.value = evaluate(inp)
  } catch (e) {
    console.warn('[network-check] 自检失败:', e)
    const fallback: DiagInput = {
      platform: 'android',
      engine: 'lynx',
      appVersion: __APP_VERSION__,
      probes: [],
      degraded: true,
      capturedAt: new Date().toISOString(),
    }
    input.value = fallback
    report.value = evaluate(fallback)
  } finally {
    running.value = false
  }
}

async function copyReport() {
  if (!input.value) return
  try {
    const nav = globalThis.navigator as
      | { clipboard?: { writeText?: (t: string) => Promise<void> } }
      | undefined
    await nav?.clipboard?.writeText?.(formatReport(input.value))
    copied.value = true
  } catch (e) {
    console.warn('[network-check] 复制失败:', e)
  }
}

void run()
</script>

<!--
  网络自检页（spec docs/specs/network-self-check.md）：判定/文案/报告来自共享包
  @pictelio/net-diagnostics，本页只渲染 + 触发探测（NativeModule，web-core 降级）。
-->
<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <view class="flex flex-row items-center h-[17.067vw] px-4 bg-surface">
      <view class="py-1 pr-2" @tap="goBack()">
        <text class="text-label-large text-primary pr-4">返回</text>
      </view>
      <text class="flex-1 text-title-large font-medium text-surface-on">网络自检</text>
    </view>

    <scroll-view scroll-orientation="vertical" class="w-full flex-1 px-4">
      <view class="bg-surface-container-lowest mt-[4vw] p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)] flex flex-col">
        <text v-if="report" :class="'text-title-medium font-medium ' + STATUS_CLASS[report.overall]">{{ report.headline }}</text>
        <text v-else class="text-body-medium text-outline">正在自检…</text>
        <text v-if="report?.degraded" class="text-body-small text-outline mt-1">开发态降级：仅覆盖部分检查项</text>
        <text v-if="report?.action" class="text-body-small text-surface-on-variant mt-1">建议：{{ report.action }}</text>
      </view>

      <view
        v-if="report"
        class="bg-surface-container-lowest mt-3 p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)] flex flex-col"
      >
        <view v-for="c in report.checks" :key="c.id" class="py-2 flex flex-col">
          <text class="text-title-small text-surface-on">
            <text :class="STATUS_CLASS[c.status]">[{{ STATUS_LABEL[c.status] }}] </text>{{ c.title }}<text v-if="c.latencyMs !== undefined"> · {{ c.latencyMs }}ms</text>
          </text>
          <text class="text-body-small text-surface-on-variant leading-snug">{{ c.detail }}</text>
          <text v-if="c.hint" class="text-body-small text-outline leading-snug">{{ c.hint }}</text>
        </view>
      </view>

      <view
        class="mt-[6vw] h-[10.667vw] bg-primary active:bg-state-pressed-primary rounded-[var(--md-shape-full)] flex items-center justify-center"
        @tap="run()"
      >
        <text class="text-label-large text-primary-on font-medium">{{ running ? '自检中…' : '重新自检' }}</text>
      </view>
      <view
        class="mt-3 h-[10.667vw] bg-surface-container-high rounded-[var(--md-shape-full)] flex items-center justify-center"
        @tap="copyReport()"
      >
        <text class="text-label-large text-surface-on font-medium">{{ copied ? '已复制' : '复制诊断报告' }}</text>
      </view>
      <view class="h-[8vw]" />
    </scroll-view>
  </view>
</template>

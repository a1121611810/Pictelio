<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'platform-check' })
import { ref, computed } from 'vue'
import { extractHostname } from '../utils/safeParseUrl'
import { unquoteNativeString } from '../utils/tokenStorage'
import { getNativeModules } from '../api/client'
import { goBack } from '../router'

// ─── 平台一致性自检页（spec docs/specs/qa-defense-lines.md §3.T4，issue #550）───
// debug 自检路由：对项目依赖的平台 API 面跑规范派生断言，渲染 PASS/FAIL 矩阵，
// 把 lynx 平台事实（如 URL 全局 .hostname 为 undefined，取证 2026-09-15，ADR-0163）
// 常驻可见。仅 benchNav 深链可达（pictelioBenchNavPlatformCheck），不进任何导航入口。
// 预期基线：矩阵项 1 预期 FAIL（记录平台事实）、项 2~5 预期 PASS——页面如实展示，
// 不做「预期即通过」的美化（FAIL 掩蔽 = 本页要防的事故本身）。

type ItemStatus = 'pass' | 'fail' | 'skip'
interface CheckItem {
  /** 矩阵项名称（PlatformCheck.template.test.ts 锁定存在） */
  name: string
  status: ItemStatus
  /** 实际值（探针原始输出，FAIL/SKIP 时据此定位） */
  actual: string
  /** 期望/说明（oracle 注脚） */
  expect: string
}

const STATUS_LABEL: Record<ItemStatus, string> = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' }
const STATUS_CLASS: Record<ItemStatus, string> = {
  pass: 'text-success',
  fail: 'text-error',
  skip: 'text-outline',
}

// ── 矩阵项 1 探针：URL 全局 hostname（lynx 预期 undefined/throw → FAIL） ──
// 刻意的例外：本函数是全页唯一允许出现 new URL 的位置——它是「探针本身」，
// 用于记录平台事实；任何业务判定禁止裸用 URL 全局（模板守卫测试锁定此边界）。
function probeUrlGlobalHostname(): string {
  try {
    return String(new URL('https://app-api.pixiv.net/v1/x').hostname)
  } catch (e) {
    return 'THREW: ' + String(e)
  }
}

// ── 矩阵项 3 探针：URLSearchParams 序列化/反序列化往返（中文值经 % 编码须无损） ──
function probeUrlSearchParamsRoundtrip(): { pass: boolean; actual: string } {
  const serialized = new URLSearchParams({ a: '1', b: '好' }).toString()
  const back = new URLSearchParams(serialized)
  const pass = back.get('a') === '1' && back.get('b') === '好'
  return { pass, actual: `${serialized} → a=${back.get('a')}, b=${back.get('b')}` }
}

// ── 矩阵项 4 探针：JSON 往返（中文键/值 + 数字须深对比无损） ──
interface JsonProbe {
  中文键: string
  num: number
  nested: { list: (number | string)[] }
}
function probeJsonRoundtrip(): { pass: boolean; actual: string } {
  const original: JsonProbe = { 中文键: '值', num: 42, nested: { list: [1, '二'] } }
  const parsed = JSON.parse(JSON.stringify(original)) as JsonProbe
  // 逐字段深对比（非 stringify 同义反复）：中文键/值、数字、嵌套结构逐项断言
  const pass =
    parsed['中文键'] === '值' &&
    parsed.num === 42 &&
    parsed.nested.list[0] === 1 &&
    parsed.nested.list[1] === '二' &&
    Object.keys(parsed).length === Object.keys(original).length
  return { pass, actual: JSON.stringify(parsed) }
}

// ── 同步矩阵项（1~4）：setup 时立即执行 ──
const urlGlobal = probeUrlGlobalHostname()
const searchParams = probeUrlSearchParamsRoundtrip()
const jsonRoundtrip = probeJsonRoundtrip()

const items = ref<CheckItem[]>([
  {
    name: 'URL 全局 hostname',
    status: urlGlobal === 'app-api.pixiv.net' ? 'pass' : 'fail',
    actual: urlGlobal,
    expect: '预期 FAIL（lynx 平台事实：.hostname 为 undefined，取证 2026-09-15，ADR-0163）',
  },
  {
    name: 'safeParseUrl 解析',
    status: extractHostname('https://app-api.pixiv.net/v1/x') === 'app-api.pixiv.net' ? 'pass' : 'fail',
    actual: String(extractHostname('https://app-api.pixiv.net/v1/x')),
    expect: '预期 PASS（收口函数对照；业务判定唯一入口）',
  },
  {
    name: 'URLSearchParams 往返',
    status: searchParams.pass ? 'pass' : 'fail',
    actual: searchParams.actual,
    expect: '预期 PASS（序列化/反序列化往返，中文值无损）',
  },
  {
    name: 'JSON 往返',
    status: jsonRoundtrip.pass ? 'pass' : 'fail',
    actual: jsonRoundtrip.actual,
    expect: '预期 PASS（含中文键与数字的对象深对比无损）',
  },
  {
    // 桥接项初始占位：native 回调到达后原位更新；web-core 无 NativeModules 保持 SKIP
    name: 'bridge 引号契约',
    status: 'skip',
    actual: '检测中…',
    expect: '已知契约：键不存在返回 ""、字符串值带 JSON 引号需 unquote（对齐 settingsStore）',
  },
])

// ── 矩阵项 5：bridge 回调引号契约（NativeModules.PictelioPrefs.prefsGet）──
// 用肯定不存在的键探针，只验证回调通道契约本身，不触碰任何真实设置键。
function runBridgeProbe(): void {
  // 与 settingsStore.nativePrefs 同款断言：getNativeModules 的 PictelioPrefs 槽位为 unknown
  const mod = getNativeModules()?.PictelioPrefs as
    | { prefsGet(key: string, callback: (value: string, err: string | null) => void): void }
    | undefined
  const item = items.value[4]
  if (!mod) {
    item.status = 'skip'
    item.actual = 'web-core 无 NativeModules → SKIP'
    return
  }
  mod.prefsGet('qa_probe_absent_key', (value, err) => {
    if (err) {
      item.status = 'fail'
      item.actual = `err: ${err}`
      return
    }
    const unquoted = value === '' ? '（空串 → null，契约成立）' : String(unquoteNativeString(value))
    // 契约判定：键不存在时回调值为空串 ""（settingsStore nativePrefs 同款契约）
    item.status = value === '' ? 'pass' : 'fail'
    item.actual = `raw=${JSON.stringify(value)} → unquote=${unquoted}`
  })
}
void runBridgeProbe()

const passCount = computed(() => items.value.filter((i) => i.status === 'pass').length)
const summaryClass = computed(() => {
  if (passCount.value === items.value.length) return 'text-success'
  if (items.value.some((i) => i.status === 'fail')) return 'text-error'
  return 'text-outline'
})
</script>

<!--
  平台一致性自检页（spec docs/specs/qa-defense-lines.md §3.T4 / issue #550）：
  仅 benchNav 深链可达的 debug 页。矩阵 5 项 = 平台 API 面规范派生断言；
  顶部大字 N/M PASS 总体结论。样式对齐 M3（不求美化，求可读）。
-->
<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <view class="flex flex-row items-center h-[17.067vw] px-4 bg-surface">
      <view class="py-1 pr-2" @tap="goBack()">
        <text class="text-label-large text-primary pr-4">‹ 返回</text>
      </view>
      <text class="flex-1 text-title-large font-medium text-surface-on">平台一致性自检</text>
    </view>

    <scroll-view scroll-orientation="vertical" class="w-full flex-1 px-4">
      <!-- 总体结论：N/M PASS -->
      <view class="bg-surface-container-lowest mt-[4vw] p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)] flex flex-col">
        <text :class="'text-title-large font-medium ' + summaryClass">{{ passCount }}/{{ items.length }} PASS</text>
        <text class="text-body-small text-outline mt-1">预期基线：URL 全局项 FAIL = lynx 平台事实（非缺陷）；其余项应 PASS</text>
      </view>

      <!-- 自检矩阵：名称 / PASS|FAIL|SKIP / 实际值 -->
      <view
        class="bg-surface-container-lowest mt-3 p-4 rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)] flex flex-col"
      >
        <view v-for="item in items" :key="item.name" class="py-2 flex flex-col">
          <text class="text-title-small text-surface-on">
            <text :class="STATUS_CLASS[item.status]">[{{ STATUS_LABEL[item.status] }}] </text>{{ item.name }}
          </text>
          <text class="text-body-small text-surface-on-variant leading-snug">{{ item.actual }}</text>
          <text class="text-body-small text-outline leading-snug">{{ item.expect }}</text>
        </view>
      </view>
      <view class="h-[8vw]" />
    </scroll-view>
  </view>
</template>

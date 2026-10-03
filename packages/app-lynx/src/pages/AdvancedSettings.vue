<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）；本页无缓存语义，不入 include
defineOptions({ name: 'advanced' })
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { goBack, navigate } from '../router'
import { t } from '../i18n'
import { useSettingsStore } from '../stores/settingsStore'
import { useUsageMetricsStore } from '../stores/usageMetrics'
import {
  DISCOVER_SUB_TAB_METRIC_ROWS,
  UPDATE_SECTION_METRIC_ROWS,
  emptySectionRate,
  subTabShare,
  tabShare,
} from '../primitives/usageMetrics'
import { NAV_TABS } from '../components/navTabs'
import {
  RATE_LIMIT_MAX_RETRIES_OPTIONS,
  RATE_LIMIT_BASE_DELAY_MS_OPTIONS,
  RATE_LIMIT_MAX_DELAY_MS_OPTIONS,
} from '../api/rateLimitBackoff'
import { useTopInsetSpacer } from '../composables/useTopInsetSpacer'
import { useMotion } from '../composables/motion'
import PageTopBar from '../components/PageTopBar.vue'
import AppIcon from '../components/AppIcon.vue'
import M3Switch from '../components/M3Switch.vue'
import FabAllowanceSpacer from '../components/FabAllowanceSpacer.vue'
import { A11Y_ELEMENT_ENABLED, ADVANCED_A11Y_LABELS } from '../utils/accessibility'
import type { I18nKey } from '../i18n'

// ─── 「高级」页（/advanced）[维度重构 2026-10-03] ───
// 承接原「我的」页里的**调试 / 自检**项：网络自检、限流退避调参、平台一致性自检。
//
// 为什么要搬（这是本页存在的唯一理由）：
//   改造前「我的」把 7 个复访资产（收藏/稍后看/追更/好P友/下载/通知/…）与 4 个调试项
//   （网络自检 / 限流退避调参 / 引擎降级 / 平台自检）**平级混排在同一页**。
//   NN/g：可发现性失败的四因里有一条是"视觉噪声"——当业务入口与调试项共享一个面，
//   两者都变得不可发现。搬运让「我的」只留账号与外观，让调试项有一个自洽的落点。
//
// ⚠️ 决策 4 = B：**只搬调试项**。账号信息区与外观（主题色 / 全屏）**留在「我的」不动** ——
//   那部分是 Me.vue 里风险最低的部分，搬它不产生任何可发现性收益。
//
// ⚠️ 引擎降级提示**不在本页**：它是 App.vue 根层的全局横幅（engineFallbackStore，
//   引擎切换失败时浮现），不是「我的」的行，故无处可搬。
const topInsetSpacer = useTopInsetSpacer()
const { listItemStyle } = useMotion()

const settings = useSettingsStore()
const { rateLimitBackoffEnabled, rateLimitMaxRetries, rateLimitBaseDelayMs, rateLimitMaxDelayMs } =
  storeToRefs(settings)

function toggleRateLimitBackoff(): void {
  settings.setRateLimitBackoffEnabled(!rateLimitBackoffEnabled.value)
}
function pickRateLimitMaxRetries(n: number): void {
  settings.setRateLimitMaxRetries(n)
}
function pickRateLimitBaseDelayMs(ms: number): void {
  settings.setRateLimitBaseDelayMs(ms)
}
function pickRateLimitMaxDelayMs(ms: number): void {
  settings.setRateLimitMaxDelayMs(ms)
}
/** 档位毫秒 → 秒显示值（500→0.5、1000→1、…、60000→60；单一换算点供两个 delay 行复用）。
 *  逐字沿用搬移前的实现（advancedNetworkTemplate 断言 `return ms / 1000`）——搬移不做行为变化。 */
function toSeconds(ms: number): number {
  return ms / 1000
}

// ─── 本地使用度量（spec §4 P0.5 的唯一读出口）───────────────────────────
// 【为什么在本页】四个指标此前只写不读：计数在 App.vue / globalFab / Recommended / Updates
//   四处落点，但**没有任何地方把比率呈现给任何人** ⇒ 指标存在却无人消费。
//   「高级」是本页既有的诊断面（网络自检 / 平台一致性自检都在这），度量子集放在这里
//   既不污染「我的」的业务入口，也不需要新建一个导航目的地（外环封闭 4 项，见 navTabs.ts）。
//
// 【读点即承诺】比率**只**从 primitives/usageMetrics.ts 的三个纯函数取，
//   不在此处重算 —— 否则「口径」会分裂成两份实现，正是本组要防的反面。
const usage = useUsageMetricsStore()
const { snap } = storeToRefs(usage)

/** 比率 → 百分比文案。**null 显示"暂无数据"而不是 0%**：
 *  三个比率函数对"分母为 0"返回 null 是刻意契约（primitives/usageMetrics.ts:120/127/134
 *  "从未观察到的段不得谎报 0%"）。把它压成 0% 就是在制造一个假指标。 */
function toPercent(rate: number | null): string {
  return rate === null ? t('advanced.metrics.noData') : `${Math.round(rate * 100)}%`
}

/** 顶层触达率：键取自 NAV_TABS（顶层 tab 的**单点事实源**），不另写一份名字数组 */
const topShareRows = computed(() =>
  NAV_TABS.map((tab) => ({ key: tab.name, label: t(tab.labelKey), value: toPercent(tabShare(snap.value, tab.name)) })),
)

/** 二级使用占比：键与展示 label 均来自 primitives 的 DISCOVER_SUB_TAB_METRIC_ROWS
 *  —— 与 Recommended.vue 的写入侧**同一份定义**（不再手写字面量，见 I-3）。 */
const subShareRows = computed(() =>
  DISCOVER_SUB_TAB_METRIC_ROWS.map((r) => ({
    key: r.key,
    label: t(r.labelKey),
    value: toPercent(subTabShare(snap.value, r.key)),
  })),
)

/** 空段出现率：键与展示 label 均来自 primitives 的 UPDATE_SECTION_METRIC_ROWS
 *  —— 与 Updates.vue noteSection 的写入侧**同一份定义**（不再手写字面量，见 I-3）。
 *  ⚠️ 此前注释写「updates.section.* 同源」，实际只有 labelKey 共享命名空间、键是两份
 *     手写字面量 ⇒ 注释在撒谎，已随本次收敛一并改正。 */
const emptyRateRows = computed(() =>
  UPDATE_SECTION_METRIC_ROWS.map((r) => ({
    key: r.key,
    label: t(r.labelKey),
    value: toPercent(emptySectionRate(snap.value, r.key)),
  })),
)

/** 最近一次复访间隔（ms）。无样本返回 null —— 首装后只有 1 次启动，间隔还不存在。 */
function lastRevisitMs(): number | null {
  const arr = snap.value.revisitIntervalsMs
  return arr.length > 0 ? arr[arr.length - 1] : null
}

const revisitLastText = computed(() => {
  const ms = lastRevisitMs()
  return ms === null ? t('advanced.metrics.noData') : t('advanced.metrics.hours', { hours: (ms / 3_600_000).toFixed(1) })
})
const revisitSampleText = computed(() => t('advanced.metrics.samples', { count: snap.value.revisitIntervalsMs.length }))

</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <view :style="{ height: topInsetSpacer + 'px' }" />

    <!-- 次级页：返回箭头 + 标题（从「我的」进入，PageTopBar 变体 b） -->
    <PageTopBar
      back
      :title="t('advanced.title')"
      :back-a11y-label="ADVANCED_A11Y_LABELS.back"
      :title-a11y-label="ADVANCED_A11Y_LABELS.pageTitle"
      @back="goBack"
    />

    <scroll-view class="w-full flex-1" scroll-orientation="vertical">
      <!-- ══ 自检入口组 ══ -->
      <view class="bg-surface-container-lowest mt-3 mx-3 rounded-[var(--md-shape-medium)]" :style="listItemStyle(0)">
        <view
          class="flex flex-row items-center justify-between py-3.5 px-4"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ADVANCED_A11Y_LABELS.networkCheck"
          @tap="navigate('/network-check')"
        >
          <text class="text-title-medium text-surface-on">{{ t('advanced.networkCheck') }}</text>
          <AppIcon name="arrow_forward" :size="4.27" class="text-surface-on-variant" />
        </view>
        <view
          class="flex flex-row items-center justify-between py-3.5 px-4 border-t-[1px] border-t-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ADVANCED_A11Y_LABELS.platformCheck"
          @tap="navigate('/platform-check')"
        >
          <text class="text-title-medium text-surface-on">{{ t('advanced.platformCheck') }}</text>
          <AppIcon name="arrow_forward" :size="4.27" class="text-surface-on-variant" />
        </view>
      </view>

      <!-- ══ 限流退避调参组（原样搬移，行为零变化）══ -->
      <view class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)]" :style="listItemStyle(1)">
        <text
          class="text-title-small font-medium text-surface-on"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ADVANCED_A11Y_LABELS.networkGroupTitle"
          >{{ t('advanced.network.title') }}</text
        >
        <text class="text-label-medium text-surface-on-variant mt-1 mb-3">{{ t('advanced.network.hint') }}</text>

        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ADVANCED_A11Y_LABELS.rateLimitBackoff"
          @tap="toggleRateLimitBackoff"
        >
          <view class="flex flex-col">
            <text class="text-title-medium text-surface-on">{{ t('advanced.network.backoff') }}</text>
            <text class="text-label-medium text-surface-on-variant mt-0.5">{{ t('advanced.network.backoffDesc') }}</text>
          </view>
          <M3Switch :checked="rateLimitBackoffEnabled" />
        </view>

        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
        >
          <text class="text-title-medium text-surface-on">{{ t('advanced.network.maxRetries') }}</text>
          <view
            class="flex flex-row gap-2"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ADVANCED_A11Y_LABELS.rateLimitMaxRetries"
          >
            <view
              v-for="n in RATE_LIMIT_MAX_RETRIES_OPTIONS"
              :key="n"
              class="px-3 py-1 rounded-[var(--md-shape-full)]"
              :class="rateLimitMaxRetries === n ? 'bg-primary' : 'bg-surface-container-high'"
              @tap="pickRateLimitMaxRetries(n)"
            >
              <text
                class="text-label-medium"
                :class="rateLimitMaxRetries === n ? 'text-primary-on' : 'text-surface-on'"
                >{{ n }}</text
              >
            </view>
          </view>
        </view>

        <view
          class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
        >
          <text class="text-title-medium text-surface-on">{{ t('advanced.network.baseDelay') }}</text>
          <view
            class="flex flex-row gap-2"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ADVANCED_A11Y_LABELS.rateLimitBaseDelay"
          >
            <view
              v-for="ms in RATE_LIMIT_BASE_DELAY_MS_OPTIONS"
              :key="ms"
              class="px-3 py-1 rounded-[var(--md-shape-full)]"
              :class="rateLimitBaseDelayMs === ms ? 'bg-primary' : 'bg-surface-container-high'"
              @tap="pickRateLimitBaseDelayMs(ms)"
            >
              <text
                class="text-label-medium"
                :class="rateLimitBaseDelayMs === ms ? 'text-primary-on' : 'text-surface-on'"
                >{{ t('advanced.network.delaySeconds', { seconds: toSeconds(ms) }) }}</text
              >
            </view>
          </view>
        </view>

        <view class="flex flex-row items-center justify-between py-3.5">
          <text class="text-title-medium text-surface-on">{{ t('advanced.network.maxDelay') }}</text>
          <view
            class="flex flex-row gap-2"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ADVANCED_A11Y_LABELS.rateLimitMaxDelay"
          >
            <view
              v-for="ms in RATE_LIMIT_MAX_DELAY_MS_OPTIONS"
              :key="ms"
              class="px-3 py-1 rounded-[var(--md-shape-full)]"
              :class="rateLimitMaxDelayMs === ms ? 'bg-primary' : 'bg-surface-container-high'"
              @tap="pickRateLimitMaxDelayMs(ms)"
            >
              <text
                class="text-label-medium"
                :class="rateLimitMaxDelayMs === ms ? 'text-primary-on' : 'text-surface-on'"
                >{{ t('advanced.network.delaySeconds', { seconds: toSeconds(ms) }) }}</text
              >
            </view>
          </view>
        </view>
      </view>

      <!-- ══ 本地使用度量组（spec §4 P0.5 四指标的唯一读出口）══ -->
      <view
        class="bg-surface-container-lowest mt-3 mx-3 p-4 rounded-[var(--md-shape-medium)]"
        :style="listItemStyle(2)"
      >
        <text
          class="text-title-small font-medium text-surface-on"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ADVANCED_A11Y_LABELS.metricsGroupTitle"
          >{{ t('advanced.metrics.title') }}</text
        >
        <text class="text-label-medium text-surface-on-variant mt-1 mb-2">{{ t('advanced.metrics.hint') }}</text>

        <text
          class="text-label-large text-surface-on-variant mt-1"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ADVANCED_A11Y_LABELS.metricsRevisitGroup"
          >{{ t('advanced.metrics.revisit') }}</text
        >
        <view class="flex flex-row items-center justify-between py-2">
          <text class="text-body-medium text-surface-on">{{ t('advanced.metrics.revisitLast') }}</text>
          <text class="text-body-medium text-surface-on">{{ revisitLastText }}</text>
        </view>
        <view class="flex flex-row items-center justify-between py-2">
          <text class="text-body-medium text-surface-on">{{ t('advanced.metrics.sampleCount') }}</text>
          <text class="text-body-medium text-surface-on">{{ revisitSampleText }}</text>
        </view>

        <text
          class="text-label-large text-surface-on-variant mt-3"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ADVANCED_A11Y_LABELS.metricsTopShareGroup"
          >{{ t('advanced.metrics.topShare') }}</text
        >
        <view
          v-for="row in topShareRows"
          :key="row.key"
          class="flex flex-row items-center justify-between py-2"
        >
          <text class="text-body-medium text-surface-on">{{ row.label }}</text>
          <text class="text-body-medium text-surface-on-variant">{{ row.value }}</text>
        </view>

        <text
          class="text-label-large text-surface-on-variant mt-3"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ADVANCED_A11Y_LABELS.metricsSubShareGroup"
          >{{ t('advanced.metrics.subShare') }}</text
        >
        <view
          v-for="row in subShareRows"
          :key="row.key"
          class="flex flex-row items-center justify-between py-2"
        >
          <text class="text-body-medium text-surface-on">{{ row.label }}</text>
          <text class="text-body-medium text-surface-on-variant">{{ row.value }}</text>
        </view>

        <text
          class="text-label-large text-surface-on-variant mt-3"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="ADVANCED_A11Y_LABELS.metricsEmptyRateGroup"
          >{{ t('advanced.metrics.emptyRate') }}</text
        >
        <view
          v-for="row in emptyRateRows"
          :key="row.key"
          class="flex flex-row items-center justify-between py-2"
        >
          <text class="text-body-medium text-surface-on">{{ row.label }}</text>
          <text class="text-body-medium text-surface-on-variant">{{ row.value }}</text>
        </view>
      </view>

      <FabAllowanceSpacer />
    </scroll-view>
  </view>
</template>

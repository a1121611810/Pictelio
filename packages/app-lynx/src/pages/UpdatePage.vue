<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'update' })
import { useUpdateStore } from '../stores/updateStore'
import { useTopInsetSpacer } from '../composables/useTopInsetSpacer'
import { UPDATE_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { t } from '../i18n'
import { useMotion } from '../composables/motion'

/** 按压反馈载体（ADR-0211 决策 2）：颜色状态层走 transition-colors 工具类——`background-color` 在其 transition-property 覆盖内（已验证）。
 *  时长与曲线一律取自 composables/motion.ts（唯一入口），本组件不写时长/曲线字面量；
 *  R1 降级（prefers-reduced-motion）由 useMotion 统一处理，组件内不自行判断偏好。 */
const { pressColor } = useMotion()

/** 列表项逐项铺开（ADR-0211 决策 5 / issue 879）：更新日志逐行错峰入场，延迟来自预设。
 *  ⚠️ changelog 行数不定（上游文本长度不可控）⇒ STAGGER_MAX_ITEMS 上限在此页最关键：
 *  超过上限的行直接落终态，不会出现「日志越长、最后一行出现得越晚」的漂移。 */
const { listItemStyle } = useMotion()


const update = useUpdateStore()

// __APP_VERSION__：构建时从 app 包注入的 APK 版本号（与版本单一事实源一致）
const appVersion = __APP_VERSION__

const changelogLines = () =>
  (update.updateResult?.latestChangelog ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

// ─── 顶部安全区让位（#900 T1，数值唯一来源 utils/topInset.ts）───
// 公共入口 = composables/useTopInsetSpacer（11 个页面共用一处，避免"改规则漏 N 处"）。
// 'bleed' 时恒 0 ⇒ spacer 渲染为 0 高，属正确行为，不特判。
const topInsetSpacer = useTopInsetSpacer()
</script>

<!--
  强制更新页（无法返回）：
  - 无返回按钮（顶部原"返回"位置是「退出应用」）
  - 返回键由路由 backBehavior: 'exit' 兜底为退出应用
  - 唯一主动作「下载新版本」→ 系统浏览器（独立 task，无法返回 app 内）
  accessibility 标注遵循项目约定（issue #103 / ADR-0061）：交互元素与页面标识
  必须登记 UPDATE_A11Y_LABELS + accessibility-element（单测断言模板消费）。
-->
<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- 顶部安全区让位（#900 T1）：零内容 spacer + 显式 height，数值由 composables/useTopInsetSpacer
         统一裁决（理由全文见该 composable）。⚠️ **不要**改成给顶栏行加 paddingTop —— Lynx 的
         border-box UA 默认会让 padding 吃掉内容高度，而 web-core 预览不复刻该默认（App.vue
         转场包裹层 pb-18 已登记此坑）。'bleed' 模式恒 0 高，属正确行为，不要特判。 -->
    <view :style="{ height: topInsetSpacer + 'px' }" />

    <view class="flex flex-row items-center h-[17.067vw] px-4 bg-surface">
      <view
        class="py-1 pr-2"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="UPDATE_A11Y_LABELS.exit"
        @tap="update.exitUpdatePage"
      >
        <text class="text-label-large text-error pr-4">{{ t('update.exit') }}</text>
      </view>
      <text
        class="flex-1 text-title-large font-medium text-surface-on"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="UPDATE_A11Y_LABELS.pageTitle"
        >{{ t('update.title') }}</text
      >
    </view>

    <scroll-view scroll-orientation="vertical" class="w-full flex-1 px-4">
      <!-- 版本信息 -->
      <view class="mt-[8vw] flex flex-col items-center">
        <text class="text-body-medium text-outline">{{ t('update.newVersion') }}</text>
        <!-- T07 档位清理：原为 700 字重。headline-medium 官方字重为 regular(400)，
             MD3 emphasized 变体为 500；版本号已是本块最大字号（大于两侧 body-small / outline），
             焦点由字号承担，700 属冗余强调且不在该档位字重刻度内 → 500。 -->
        <text class="text-headline-medium font-regular text-surface-on mt-2">v{{ update.updateResult?.latestVersion }}</text>
        <text class="text-body-small text-outline mt-2">{{ t('update.currentVersion', { version: appVersion }) }}</text>
      </view>

      <!-- 更新内容（changelog 多行） -->
      <view class="bg-surface-container-lowest mt-[6vw] p-4 rounded-[var(--md-shape-medium)]">
        <text class="text-title-small font-medium text-surface-on">{{ t('update.changelogTitle') }}</text>
        <view v-if="changelogLines().length" class="mt-3 flex flex-col gap-1">
          <text
            v-for="(line, i) in changelogLines()"
            :key="i"
            class="text-body-small text-surface-on-variant"
            :style="listItemStyle(i)"
            >{{ line }}</text
          >
        </view>
        <text v-else class="text-body-small text-outline mt-3">{{ t('update.noChangelog') }}</text>
      </view>

      <!-- 下载新版本（页面唯一主动作） -->
      <view
        class="mt-[8vw] h-[10.667vw] bg-primary active:bg-layer-pressed-on-primary rounded-[var(--md-shape-full)] flex items-center justify-center"
        :class="pressColor.className"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="UPDATE_A11Y_LABELS.download"
        @tap="update.openReleasePage"
      >
        <text class="text-label-large text-primary-on font-medium">{{ t('update.download') }}</text>
      </view>

      <!-- 底部留白 -->
      <view class="h-[8vw]" />
    </scroll-view>
  </view>
</template>

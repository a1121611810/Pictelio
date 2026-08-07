<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'update' })
import { updateResult, openReleasePage, exitUpdatePage } from '../stores/updateStore'
import { UPDATE_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'

// __APP_VERSION__：构建时从 app 包注入的 APK 版本号（与版本单一事实源一致）
const appVersion = __APP_VERSION__

const changelogLines = () =>
  (updateResult.value?.latestChangelog ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
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
  <view class="w-full h-full flex flex-col bg-background-2">
    <view class="flex flex-row items-center h-[11.733vw] px-4 bg-background border-b-[1px] border-b-stroke-2">
      <view
        class="py-1 pr-2"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="UPDATE_A11Y_LABELS.exit"
        @tap="exitUpdatePage"
      >
        <text class="text-lg text-danger pr-4">退出应用</text>
      </view>
      <text
        class="flex-1 text-2xl font-semibold text-foreground"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="UPDATE_A11Y_LABELS.pageTitle"
        >更新</text
      >
    </view>

    <scroll-view scroll-orientation="vertical" class="w-full flex-1 px-4">
      <!-- 版本信息 -->
      <view class="mt-[8vw] flex flex-col items-center">
        <text class="text-base text-foreground-3">发现新版本</text>
        <text class="text-5xl font-bold text-foreground mt-2">v{{ updateResult?.latestVersion }}</text>
        <text class="text-sm text-foreground-3 mt-2">当前版本 v{{ appVersion }}</text>
      </view>

      <!-- 更新内容（changelog 多行） -->
      <view class="bg-background mt-[6vw] p-4 rounded-[var(--borderRadiusXLarge)]">
        <text class="text-lg font-semibold text-foreground">更新内容</text>
        <view v-if="changelogLines().length" class="mt-3 flex flex-col gap-1">
          <text
            v-for="(line, i) in changelogLines()"
            :key="i"
            class="text-sm text-foreground-2 leading-snug"
            >{{ line }}</text
          >
        </view>
        <text v-else class="text-sm text-foreground-3 mt-3">暂无更新说明</text>
      </view>

      <!-- 下载新版本（页面唯一主动作） -->
      <view
        class="mt-[8vw] py-4 bg-brand rounded-[var(--borderRadiusXLarge)] flex items-center justify-center"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="UPDATE_A11Y_LABELS.download"
        @tap="openReleasePage"
      >
        <text class="text-xl text-onBrand font-semibold">下载新版本</text>
      </view>

      <!-- 底部留白 -->
      <view class="h-[8vw]" />
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
// ─── 静音标签管理页（ADR-0187 D5 / #732，路由 /mute-tags）───
// 信息架构对齐 Watchlist.vue：M3 TopAppBar（返回 + 标题）+ 列表行「标签名 + 移除」+ 空态。
// 数据 = settingsStore 账号级静音集合（mute_tags_${uid}，ADR-0103 跨引擎共享键）：
// 本地同步读取，无网络请求 → 无骨架/加载态（三态单链退化为 内容/空态 二态，与 Watchlist
// 的差异为有意：数据源不是 feed 而是内存集合）。
// 移除 = unmuteTag（集合删除 + 持久化，未静音 no-op）；下次列表组装恢复显示。
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）；本页不在 include 白名单
// （卸载即释放，重进重读集合）。
defineOptions({ name: 'mute-tags' })
import { computed } from 'vue'
import { goBack } from '../router'
import { useSettingsStore } from '../stores/settingsStore'
import { MUTE_TAGS_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { t } from '../i18n'

const settings = useSettingsStore()

/** 静音标签列表（插入序 = 静音先后，最新在后）；computed 内调 mutedTags() 建立响应依赖 */
const tags = computed<string[]>(() => Array.from(settings.mutedTags()))

/** 取消静音：从集合删除并持久化 */
function removeTag(name: string): void {
  settings.unmuteTag(name)
}
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：次级页，返回箭头 + 居中标题（对齐 Watchlist 头部模式） -->
    <view class="flex flex-row items-center h-[17.067vw] px-4 bg-surface">
      <view
        class="py-1 pr-2"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="MUTE_TAGS_A11Y_LABELS.back"
        @tap="goBack"
      >
        <text class="text-[6.4vw] leading-none text-surface-on">‹</text>
      </view>
      <text
        class="flex-1 text-title-large font-medium text-surface-on"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="MUTE_TAGS_A11Y_LABELS.pageTitle"
        >{{ t('muteTags.title') }}</text
      >
    </view>

    <!-- 空态 -->
    <view v-if="tags.length === 0" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">◇</text>
        <text class="text-body-large text-surface-on mt-3">{{ t('muteTags.empty.title') }}</text>
        <text class="text-body-medium text-surface-on-variant mt-1.5">{{ t('muteTags.empty.hint') }}</text>
      </view>
    </view>

    <!-- 列表态：本地集合（量级小）不做虚拟化，纵列平铺于 scroll-view -->
    <scroll-view v-else class="w-full flex-1 min-h-0" scroll-orientation="vertical">
      <view
        v-for="name in tags"
        :key="name"
        class="flex flex-row items-center justify-between m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="name"
      >
        <text class="flex-1 text-body-medium text-surface-on [max-line:2]">{{ name }}</text>
        <view
          class="self-center h-[10.667vw] px-3 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)] active:bg-layer-pressed-on-surface"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="MUTE_TAGS_A11Y_LABELS.remove"
          @tap="removeTag(name)"
        >
          <text class="text-label-large text-error">{{ t('muteTags.remove') }}</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

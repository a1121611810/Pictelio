<!-- ─── 小说翻译显示模式开关（spec §6.3 segmented button） ───
     2 段：「原文」/「译文」；中间是 sliding indicator（M3 secondary-container 高亮）。
     ───────────────────────────────────────────────────────────────── -->
<script setup lang="ts">
import { computed } from "vue"
import { useNovelTranslateStore } from "../stores/novelTranslateStore"
import { t } from "../i18n"

interface Props {
  /** 是否启用开关：未配置 endpoint / 翻译失败 / 章节未翻译时禁用 */
  enabled?: boolean
}

const props = withDefaults(defineProps<Props>(), { enabled: true })

const store = useNovelTranslateStore()

const showOriginal = computed<boolean>(() => !store.showTranslation)

async function pick(mode: "original" | "translation"): Promise<void> {
  if (!props.enabled) return
  const want = mode === "translation"
  if (store.showTranslation !== want) await store.toggleMode()
}
</script>

<template>
  <view
    class="flex flex-row gap-0 rounded-[var(--md-shape-full)] border border-outline overflow-hidden"
    :class="props.enabled ? '' : 'opacity-50'"
    :hover-class="props.enabled ? '' : 'opacity-50'"
  >
    <!-- 原文段 -->
    <view
      class="flex-1 h-[10.667vw] flex items-center justify-center active:bg-layer-pressed-on-surface"
      :class="showOriginal ? 'bg-secondary-container' : 'bg-surface-container-lowest'"
      :accessibility-element="true"
      :accessibility-label="t('novelTranslate.action.viewOriginal')"
      @tap="pick('original')"
    >
      <text
        class="text-label-large"
        :class="showOriginal ? 'text-secondary-on-container' : 'text-surface-on'"
        >{{ t("novelTranslate.action.viewOriginal") }}</text
      >
    </view>
    <!-- 译文段 -->
    <view
      class="flex-1 h-[10.667vw] flex items-center justify-center border-l border-l-outline active:bg-layer-pressed-on-surface"
      :class="!showOriginal ? 'bg-secondary-container' : 'bg-surface-container-lowest'"
      :accessibility-element="true"
      :accessibility-label="t('novelTranslate.action.viewTranslation')"
      @tap="pick('translation')"
    >
      <text
        class="text-label-large"
        :class="!showOriginal ? 'text-secondary-on-container' : 'text-surface-on'"
        >{{ t("novelTranslate.action.viewTranslation") }}</text
      >
    </view>
  </view>
</template>
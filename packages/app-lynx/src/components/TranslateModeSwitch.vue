<!-- ─── 小说翻译显示模式开关 ───
     spec docs/specs/app-lynx-m3-segmented-button.md §4 / ADR-0190；渲染委托 M3SegmentedButton 组件
     2 段：「原文」/「译文」；disabled 语义（容器置灰 + tap 短路）由组件接管。
     ───────────────────────────────────────────────────────────────── -->
<script setup lang="ts">
import { computed } from "vue"
import { useNovelTranslateStore } from "../stores/novelTranslateStore"
import { t } from "../i18n"
import M3SegmentedButton, { type M3SegmentOption } from "./M3SegmentedButton.vue"

/** 分段枚举值：与 pick 参数类型对齐（spec §4.4） */
type TranslateMode = "original" | "translation"

interface Props {
  /** 是否启用开关：未配置 endpoint / 翻译失败 / 章节未翻译时禁用 */
  enabled?: boolean
}

const props = withDefaults(defineProps<Props>(), { enabled: true })

const store = useNovelTranslateStore()

// options 必须 computed 构建：t() 语言切换时 label 自动重算（spec §4.2）
const options = computed<M3SegmentOption<TranslateMode>[]>(() => [
  {
    value: "original",
    label: t("novelTranslate.action.viewOriginal"),
    a11yLabel: t("novelTranslate.action.viewOriginal"),
  },
  {
    value: "translation",
    label: t("novelTranslate.action.viewTranslation"),
    a11yLabel: t("novelTranslate.action.viewTranslation"),
  },
])

async function pick(mode: TranslateMode): Promise<void> {
  if (!props.enabled) return
  const want = mode === "translation"
  if (store.showTranslation !== want) await store.toggleMode()
}
</script>

<template>
  <!-- 分解写法：modelValue 由 store.showTranslation 派生，副作用经 pick 接回（spec §4.4） -->
  <M3SegmentedButton
    :model-value="store.showTranslation ? 'translation' : 'original'"
    :options="options"
    :disabled="!props.enabled"
    @update:modelValue="pick"
  />
</template>

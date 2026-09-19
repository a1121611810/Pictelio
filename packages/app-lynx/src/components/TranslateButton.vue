<!-- ─── 小说翻译按钮（spec docs/specs/app-lynx-novel-translation.md §6.3） ───
     M3 FAB 形态：默认态=翻译图标，触发后=进度圆环，完成后=✓+「已缓存」标签，失败=重试图标。
     与 novelTranslateStore 单向绑定：props 进、emits 出。
     ───────────────────────────────────────────────────────────────── -->
<script setup lang="ts">
import { computed } from "vue"
import { useNovelTranslateStore } from "../stores/novelTranslateStore"
import { t } from "../i18n"

interface Props {
  novelId: number
  chapterId: number
  paragraphs: string[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: "translate-start"): void
  (e: "translate-done"): void
  (e: "translate-error", code: string): void
}>()

const store = useNovelTranslateStore()

/** 该章节是否正在翻译中（且 store 当前在跟踪的就是该 chapter） */
const isTranslatingThis = computed<boolean>(() => {
  return (
    (store.status === "translating" || store.status === "pending") &&
    store.currentChapter === props.chapterId
  )
})

/** 是否已完成且已缓存 */
const isDoneCached = computed<boolean>(() => {
  return store.status === "completed" && store.currentChapter === props.chapterId
})

/** 是否失败 */
const isFailed = computed<boolean>(() => {
  return store.status === "failed" && store.currentChapter === props.chapterId
})

/** 进度百分比（0-1），用于圆环视觉 */
const progressFraction = computed<number>(() => {
  const p = store.progress
  if (!p || p.total === 0) return 0
  if (p.chapterId !== props.chapterId) return 0
  return Math.min(1, Math.max(0, p.done / p.total))
})

/** 是否按钮 disabled（含 R18 blocked / aborted 等终态；UI 表现为不可点击） */
const disabled = computed<boolean>(() => {
  if (store.status === "aborted" && store.error?.code === "R18_BLOCKED") return true
  return isTranslatingThis.value
})

/** 标签：FAB 内可见文案 */
const label = computed<string>(() => {
  if (isDoneCached.value) return t("novelTranslate.action.cached")
  if (isFailed.value) return t("novelTranslate.action.retry")
  if (isTranslatingThis.value) return t("novelTranslate.status.translating")
  return t("novelTranslate.action.start")
})

/** 用户点击：起翻译 */
async function onTap(): Promise<void> {
  if (disabled.value) return
  if (isFailed.value) {
    // 重试路径：保留原 chapterId + paragraphs，由 store 接管新一轮 translation
    emit("translate-start")
    try {
      await store.translateChapter(props.novelId, props.chapterId, props.paragraphs, 0)
      if (store.status === "completed") emit("translate-done")
      else if (store.status === "failed") {
        emit("translate-error", store.error?.code ?? "unknown")
      }
    } catch (err) {
      emit("translate-error", err instanceof Error ? err.message : "unknown")
    }
    return
  }
  if (isDoneCached.value) {
    // 已缓存：点击切换显示原文/译文（FAB 兼任开关）
    void store.toggleMode()
    return
  }
  // 首次触发
  emit("translate-start")
  try {
    await store.translateChapter(props.novelId, props.chapterId, props.paragraphs, 0)
    if (store.status === "completed") emit("translate-done")
    else if (store.status === "failed") {
      emit("translate-error", store.error?.code ?? "unknown")
    }
  } catch (err) {
    emit("translate-error", err instanceof Error ? err.message : "unknown")
  }
}
</script>

<template>
  <view
    class="h-[10.667vw] px-4 rounded-[var(--md-shape-full)] flex flex-row items-center justify-center bg-primary active:bg-layer-pressed-on-primary"
    :class="disabled ? 'opacity-50' : ''"
    :hover-class="disabled ? '' : 'bg-layer-hovered-on-primary'"
    :accessibility-element="true"
    :accessibility-label="label"
    @tap="onTap"
  >
    <!-- 默认态：翻译图标 -->
    <text
      v-if="!isTranslatingThis && !isDoneCached && !isFailed"
      class="text-[5.333vw] leading-none text-on-primary mr-1"
      >Aあ</text
    >
    <!-- 进度态：简易文字 + 百分比 -->
    <text
      v-else-if="isTranslatingThis"
      class="text-label-medium text-on-primary"
      >{{ Math.round(progressFraction * 100) }}%</text
    >
    <!-- 完成态：✓ -->
    <text
      v-else-if="isDoneCached"
      class="text-[5.333vw] leading-none text-on-primary mr-1"
      >✓</text
    >
    <!-- 失败态：↻ -->
    <text v-else class="text-[5.333vw] leading-none text-on-primary mr-1">↻</text>
    <text class="text-label-large text-on-primary">{{ label }}</text>
  </view>
</template>
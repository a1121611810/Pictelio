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
  /** 当前作品的 R-18 等级（0 全年龄 / 1 R18 / 2 R18G）——必须透传给 store 闸门（spec §9.7） */
  xRestrict: 0 | 1 | 2
  /** 是否已配置 LLM endpoint（未配置时按钮态 = 「配置翻译」→ 跳设置页，spec §6.2） */
  configured: boolean
}

/**
 * 按钮态（spec §6.2 收敛为 4 态，ADR-0173 D6）：
 * - configure：未配置 endpoint → 点击跳设置页（不再「点下去然后失败」）
 * - translating：翻译中 → **可点 = abort**（此前 disabled → onTap 直接 return，用户无法停止）
 * - retranslate：已缓存 → 点击失效本章缓存并重译
 * - retry：翻译失败 → 点击重试
 * - start：首次翻译
 */
type ButtonState = "configure" | "translating" | "retranslate" | "retry" | "start"

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: "translate-start"): void
  (e: "translate-done"): void
  (e: "translate-error", code: string): void
  /** 未配置 endpoint → 宿主负责跳设置页 */
  (e: "translate-configure"): void
  (e: "translate-abort"): void
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

/** 当前按钮态（唯一事实源；标签、可点性、点击行为全部由它派生） */
const buttonState = computed<ButtonState>(() => {
  if (isTranslatingThis.value) return "translating"
  if (isDoneCached.value) return "retranslate"
  if (isFailed.value) return "retry"
  if (!props.configured) return "configure"
  return "start"
})

/** 仅 R18 拦截是真正不可点（翻译中可点 = abort，见 buttonState） */
const disabled = computed<boolean>(() =>
  store.status === "aborted" && store.error?.code === "R18_BLOCKED",
)

/** 标签：FAB 内可见文案（显式映射表，i18n 键是字面量联合类型） */
const LABEL_KEYS = {
  translating: "novelTranslate.status.translating",
  retranslate: "novelTranslate.action.retranslate",
  retry: "novelTranslate.action.retry",
  configure: "novelTranslate.action.configure_translate",
  start: "novelTranslate.action.start",
} as const

const label = computed<string>(() => t(LABEL_KEYS[buttonState.value]))

/** 用户点击：起翻译 */
async function onTap(): Promise<void> {
  if (disabled.value) return
  // 翻译中 → abort（spec §6.2：翻译中点击 = 停止）
  if (buttonState.value === "translating") {
    store.abort()
    emit("translate-abort")
    return
  }
  // 未配置 endpoint → 跳设置页（spec §6.2「配置翻译」）
  if (buttonState.value === "configure") {
    emit("translate-configure")
    return
  }
  // 已缓存 → 失效本章缓存后重译（ADR-0173 D6）；未捕获 rejection 在 PrimJS 上是静默失败
  if (buttonState.value === "retranslate") {
    emit("translate-start")
    try {
      await store.retranslate(props.novelId, props.chapterId, props.paragraphs, props.xRestrict)
      if (store.status === "completed") emit("translate-done")
      else if (store.status === "failed") emit("translate-error", store.error?.code ?? "unknown")
    } catch (err) {
      emit("translate-error", err instanceof Error ? err.message : "unknown")
    }
    return
  }
  if (buttonState.value === "retry") {
    // 重试路径：保留原 chapterId + paragraphs，由 store 接管新一轮 translation
    emit("translate-start")
    try {
      await store.translateChapter(
        props.novelId,
        props.chapterId,
        props.paragraphs,
        props.xRestrict,
      )
      if (store.status === "completed") emit("translate-done")
      else if (store.status === "failed") {
        emit("translate-error", store.error?.code ?? "unknown")
      }
    } catch (err) {
      emit("translate-error", err instanceof Error ? err.message : "unknown")
    }
    return
  }
  // 首次触发
  emit("translate-start")
  try {
    await store.translateChapter(
      props.novelId,
      props.chapterId,
      props.paragraphs,
      props.xRestrict,
    )
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
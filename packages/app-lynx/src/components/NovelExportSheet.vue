<script setup lang="ts">
// ─── 小说导出面板（app-lynx，spec docs/specs/novel-export.md §7.2 / ADR-0154 D7）───
// 弹层主体沿用 CommentOverlay 的挂载契约：根 view relative 提供定位上下文 + absolute 遮罩 +
// 底部面板（DOM 顺序靠后，天然覆盖宿主），面板 @tap.stop 防穿透；挂载时注册 modalStack，
// 返回键优先关面板（ADR-0066 扩展）。确认导出不做任何 IO——只 emit 本次选中的格式，
// 由父页构造 payload 并入队（web-core 无原生模块，入队纯 JS 可用；编码失败在执行器）。
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  NOVEL_EXPORT_FORMATS,
  NOVEL_EXPORT_FORMAT_LABELS,
  type NovelExportFormat,
  type NovelExportOptions,
} from '@pictelio/novel-export'
import { useModalStack } from '../stores/modalStack'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'

const props = defineProps<{
  /** 打开态（父页 v-if 挂载，本属性用于打开时重置选择） */
  open: boolean
  /** 设置页的全局默认格式（每次打开预选） */
  defaultFormat: NovelExportFormat
  /** 设置页的内容开关快照（只读展示，在设置页修改） */
  options: NovelExportOptions
}>()

const emit = defineEmits<{
  /** 请求关闭（遮罩 / × / 返回键）→ 外部 v-if 卸载本组件 */
  close: []
  /** 确认导出（本次临时格式，不写回全局设置） */
  export: [format: NovelExportFormat]
}>()

/** 本次选择的格式（临时覆盖，不写回设置页） */
const selected = ref<NovelExportFormat>(props.defaultFormat)

// 每次打开重置为全局默认格式（临时覆盖不写回设置）
watch(
  () => props.open,
  (open) => {
    if (open) selected.value = props.defaultFormat
  },
  { immediate: true },
)

// 返回键拦截：挂载期间注册关闭回调（modalStack 后进先出），卸载时注销
let unregisterModal: (() => void) | null = null

onMounted(() => {
  unregisterModal = useModalStack().registerModal(() => emit('close'))
})

onBeforeUnmount(() => {
  unregisterModal?.()
  unregisterModal = null
})

/** 统一关闭路径：遮罩 / × / 返回键都走这里 */
function onClose(): void {
  emit('close')
}

/** 确认：只上抛本次选中的格式（payload 构造与入队由父页负责） */
function onConfirm(): void {
  emit('export', selected.value)
}
</script>

<template>
  <!-- 根 view：relative 定位上下文；与宿主内容平级、DOM 顺序靠后 → 天然覆盖上层 -->
  <view class="w-full h-full relative">
    <!-- 遮罩：absolute inset-0，@tap 关闭 -->
    <view class="absolute inset-0 bg-scrim" @tap="onClose" />

    <!-- 底部面板：@tap.stop 防面板内点击穿透到遮罩 -->
    <view
      class="absolute bottom-0 left-0 right-0 bg-surface-container-lowest rounded-t-[var(--md-shape-extra-large)] flex flex-col"
      @tap.stop
    >
      <!-- 顶部：居中标题 + 关闭 -->
      <view class="flex flex-row items-center h-[11.733vw] px-4 flex-shrink-0">
        <view class="w-[8vw]" />
        <text class="flex-1 text-center text-title-large font-medium text-surface-on">导出小说</text>
        <view
          class="w-[8vw] h-[8vw] flex items-center justify-center"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          accessibility-label="关闭导出面板"
          @tap="onClose"
        >
          <text class="text-[6.4vw] leading-none text-surface-on-variant">×</text>
        </view>
      </view>

      <!-- 格式选择：M3 chip 行（视觉同 Me.vue 导出格式 chip：选中 secondary-container，未选 outline） -->
      <view class="px-4 pt-2">
        <text class="text-title-small font-medium text-surface-on">导出格式</text>
        <view class="flex flex-row flex-wrap gap-2 mt-2">
          <view
            v-for="fmt in NOVEL_EXPORT_FORMATS"
            :key="fmt"
            class="h-[10.667vw] px-4 flex items-center justify-center rounded-[var(--md-shape-full)] border"
            :class="selected === fmt ? 'bg-secondary-container border-secondary-container' : 'bg-surface-container-lowest border-outline'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="'选择导出格式' + NOVEL_EXPORT_FORMAT_LABELS[fmt]"
            @tap="selected = fmt"
          >
            <text
              class="text-label-large"
              :class="selected === fmt ? 'text-secondary-on-container' : 'text-surface-on'"
            >{{ NOVEL_EXPORT_FORMAT_LABELS[fmt] }}</text>
          </view>
        </view>
        <text class="text-label-medium text-surface-on-variant mt-2 leading-snug">
          默认使用设置页选择的格式；此处修改仅作用于本次导出。
        </text>
      </view>

      <!-- 内容摘要（只读）：正文恒含，三项开关取设置页快照 -->
      <view class="px-4 pt-3">
        <text class="text-title-small font-medium text-surface-on">导出内容</text>
        <text class="text-label-medium text-surface-on-variant mt-1 leading-snug">
          正文（必含） · 元数据 {{ options.includeMetadata ? '开' : '关' }} · 封面 {{ options.includeCover ? '开' : '关' }} · 正文插图 {{ options.includeInlineImages ? '开' : '关' }}
        </text>
        <text class="text-label-medium text-outline mt-1 leading-snug">内容开关在设置页「导出」中修改</text>
      </view>

      <!-- 确认导出 -->
      <view class="px-4 pt-4 pb-6">
        <view
          class="w-full h-[12.8vw] bg-primary active:bg-state-pressed-primary rounded-[var(--md-shape-full)] flex items-center justify-center"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          accessibility-label="导出"
          @tap="onConfirm"
        >
          <text class="text-label-large font-medium text-primary-on">导出</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
// ─── 多图作品选页面板（app-lynx，spec docs/specs/image-save-download.md §5）───
// 底部弹层形态对齐 CommentOverlay：遮罩 @tap 关闭、面板 @tap.stop 防穿透、
// DOM 顺序靠后覆盖（不依赖 z-index）；返回键拦截经 modalStack（ADR-0066 扩展）。
// 打开（挂载）默认全选（批量语义默认值）；确认上抛升序 0-based 页号数组，
// 保存流程由宿主（IllustDetail）编排。
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useModalStack } from '../stores/modalStack'
import { proxyImageUrl } from '../utils/imageUrl'
import SkeletonImage from './SkeletonImage.vue'

const props = defineProps<{
  /** 各页展示用 URL（medium/large，作缩略图） */
  pageUrls: string[]
  /** 批量保存进行中（禁用确认） */
  busy?: boolean
}>()

const emit = defineEmits<{
  /** 请求关闭（遮罩 / 取消 / 返回键）→ 外部 v-if 卸载本组件 */
  close: []
  confirm: [pages: number[]]
}>()

// 选中页号（数组便于 vue-lynx 响应式；确认时升序输出）
const selected = ref<number[]>(props.pageUrls.map((_, i) => i))

function isSelected(i: number): boolean {
  return selected.value.includes(i)
}

function toggle(i: number): void {
  selected.value = isSelected(i) ? selected.value.filter((p) => p !== i) : [...selected.value, i]
}

const allSelected = (): boolean => selected.value.length === props.pageUrls.length

function toggleAll(): void {
  selected.value = allSelected() ? [] : props.pageUrls.map((_, i) => i)
}

function confirm(): void {
  if (!selected.value.length || props.busy) return
  emit('confirm', [...selected.value].sort((a, b) => a - b))
}

// 返回键拦截：挂载期间注册关闭回调（modalStack 后进先出），卸载时注销
let unregisterModal: (() => void) | null = null

onMounted(() => {
  unregisterModal = useModalStack().registerModal(() => emit('close'))
})

onBeforeUnmount(() => {
  unregisterModal?.()
  unregisterModal = null
})
</script>

<template>
  <!-- 根 view：relative 提供绝对定位上下文；与宿主内容平级、DOM 顺序靠后 → 天然覆盖上层 -->
  <view class="w-full h-full relative">
    <view class="absolute inset-0 bg-scrim" @tap="emit('close')" />

    <!-- 底部面板：@tap.stop 防穿透 -->
    <view class="absolute left-0 right-0 bottom-0 bg-surface-container-lowest rounded-t-[var(--md-shape-large)] p-4" @tap.stop>
      <view class="flex flex-row items-center mb-2">
        <text class="text-title-medium font-medium text-surface-on flex-1">选择要保存的页</text>
        <view class="px-2 py-1" @tap="toggleAll">
          <text class="text-label-large text-primary">{{ allSelected() ? '清除全选' : '全选' }}</text>
        </view>
      </view>

      <!-- 缩略图网格：3 列方形（flex wrap） -->
      <scroll-view scroll-y class="h-[72vw]">
        <view class="flex flex-row flex-wrap">
          <view
            v-for="(url, i) in pageUrls"
            :key="i"
            class="w-[28vw] h-[28vw] m-[1.6vw] relative overflow-hidden rounded-[var(--md-shape-medium)] border-2 border-solid"
            :class="isSelected(i) ? 'border-primary' : 'border-outline'"
            @tap="toggle(i)"
          >
            <SkeletonImage :src="proxyImageUrl(url)" height="27.4vw" :lazy-load="i > 8" />
            <!-- 选中角标：left:0 + w-full + flex 右对齐（ADR-0123 锚点约定，禁 right/bottom） -->
            <view v-if="isSelected(i)" class="absolute left-0 top-0 w-full flex flex-row justify-end p-1">
              <view class="w-[6vw] h-[6vw] rounded-full bg-primary flex items-center justify-center">
                <text class="text-[3.2vw] leading-none text-surface-on">✓</text>
              </view>
            </view>
            <!-- 页码条：bottom 禁用（ADR-0123 锚点约定）→ 页码贴角标行下方左侧，v-if 显隐 -->
            <view v-if="!isSelected(i)" class="absolute left-0 top-[7vw] w-full">
              <text class="text-label-small text-surface-on bg-[rgba(0,0,0,0.45)] px-1">P{{ i + 1 }}</text>
            </view>
          </view>
        </view>
      </scroll-view>

      <view class="flex flex-row items-center mt-3">
        <text class="text-label-large text-outline flex-1">已选 {{ selected.length }} / {{ pageUrls.length }} 页</text>
        <view
          class="h-[11vw] px-6 rounded-full bg-primary flex items-center justify-center"
          :class="!selected.length || busy ? 'opacity-40' : ''"
          @tap="confirm"
        >
          <text class="text-label-large text-surface-on">{{ busy ? '保存中…' : `保存（${selected.length}）` }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
// ─── 多图作品选页面板（app-lynx，spec docs/specs/image-save-download.md §5）───
// 底部弹层形态对齐 CommentOverlay：遮罩 @tap 关闭、面板 @tap.stop 防穿透、
// DOM 顺序靠后覆盖（不依赖 z-index）；返回键拦截经 modalStack（ADR-0066 扩展）。
// 打开（挂载）默认全选（批量语义默认值）；确认上抛升序 0-based 页号数组，
// 保存流程由宿主（IllustDetail）编排。
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { t } from '../i18n'
import { useModalStack } from '../stores/modalStack'
import { proxyImageUrl } from '../utils/imageUrl'
import { safeBottom } from '../utils/safeArea'
import SkeletonImage from './SkeletonImage.vue'
import AppIcon from './AppIcon.vue'

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
      <!-- 色调层（tonal elevation 的着色层，ADR-0207 决策 7）：
           MD3 表达层级的主要手段是给表面**染上主色**（surface tint），box-shadow 仅为辅。
           本层让 elevated 弹层顶部带 8% 主色调，与面板底色 bg-surface-container-lowest 叠加成
           「被抬起的着色表面」，而不是一片纯白。
           高度 10.667vw = p-4 内边距 16px(4.267vw) + 标题档位 title-medium 行高 48rpx(6.4vw)；
           该数值与本文件确认按钮的 h-[10.667vw] 同值，取值不是随手写的魔数。
           ⚠️ 为什么用 opacity-* 合成、而不是「背景色 / N」透明度修饰符：--md-surface-tint 在
           tailwind.config.ts 里是**裸 var() 字符串**（非 <alpha-value> 形式），Tailwind 因此
           无法给它注入 alpha ⇒「背景色 / 8」这种写法在真实构建产物中**不产出任何规则**
           （死类名、静默无样式）。
           ⚠️ 更正一条此前的错误结论：本注释原先写「color-mix() 的 arbitrary utility 同样被丢弃」，
           这是**假的** —— 实测（Tailwind CLI + 项目真实 config，lightningcss 按
           chrome80 / safari13 / android8 三档实变换）color-mix 的 arbitrary utility **会产出且原样保留**。
           仍然选 opacity-* 的真实理由只是更简单：它直接复用已登记的 opacity 档，
           不必在模板里写一整条 color-mix() 函数。结论没变，依据换成了真的那个。
           ⚠️ 为什么不禁点击：关闭点击穿透的那个 utility 在本 preset 下同样不产出规则（死类名）。
           故靠 **DOM 顺序**保证交互：本层是面板的首个子元素、位于头部行**之前**，后画的
           头部行压在其上并优先吃点击；点在本层裸露区的 tap 仍冒泡到面板的 @tap.stop，
           遮罩关闭的防穿透语义不变。
           ⚠️ 满幅着色层做不了：面板是 auto 高度父级，百分比高度解析为 auto 会塌成 0，
           而 bottom/right 锚点被 ADR-0123 禁用 ⇒ 只能做**有界**色带。 -->
      <view class="absolute left-0 top-0 w-full h-[10.667vw] bg-surface-tint opacity-[0.08]" />
      <view class="flex flex-row items-center mb-2">
        <text class="text-title-medium font-medium text-surface-on flex-1">{{ t('pagePicker.title') }}</text>
        <view class="px-2 py-1" @tap="toggleAll">
          <text class="text-label-large text-primary">{{ allSelected() ? t('pagePicker.clearAll') : t('pagePicker.selectAll') }}</text>
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
                <!-- 选中角标 ✓ → Material Symbols check（ADR-0208 决策 3）。字号 3.2vw
                     与原 text-[3.2vw] 同口径；装饰性标记，语义由角标所在的整格 tap 目标承担。 -->
                <AppIcon name="check" :size="3.2" class="text-surface-on" />
              </view>
            </view>
            <!-- 页码条：bottom 禁用（ADR-0123 锚点约定）→ 页码贴角标行下方左侧，v-if 显隐。
                 走 --md-scrim token（M3 通用遮罩语义，明暗均为 rgba(0,0,0,0.5)）；原硬编码
                 rgba(0,0,0,0.45) 在 T4 替换（spec docs/specs/lynx-night-mode-audit.md §3.2 P1-2）。 -->
            <view v-if="!isSelected(i)" class="absolute left-0 top-[7vw] w-full">
              <text class="text-label-small text-[var(--colorOverlayForeground)] bg-[var(--md-scrim)] px-1">P{{ i + 1 }}</text>
            </view>
          </view>
        </view>
      </scroll-view>

      <view class="flex flex-row items-center mt-3">
        <text class="text-label-large text-outline flex-1">{{ t('pagePicker.selectedCount', { selected: selected.length, total: pageUrls.length }) }}</text>
        <view
          class="h-[11vw] px-6 rounded-full bg-primary flex items-center justify-center"
          :class="!selected.length || busy ? 'opacity-40' : ''"
          @tap="confirm"
        >
          <text class="text-label-large text-surface-on">{{ busy ? t('pagePicker.saving') : t('pagePicker.save', { count: selected.length }) }}</text>
        </view>
      </view>
      <!-- 系统栏安全区（spec lynx-systembars §4.2）：底部面板抬离手势/导航区 -->
      <view :style="{ height: safeBottom + 'px' }" />
    </view>
  </view>
</template>

<script setup lang="ts">
// ─── 多图作品选页面板（app-lynx，spec docs/specs/image-save-download.md §5）───
// 底部弹层形态对齐 CommentOverlay：遮罩 @tap 关闭、面板 @tap.stop 防穿透、
// DOM 顺序靠后覆盖（不依赖 z-index）；返回键拦截经 modalStack（ADR-0066 扩展）。
// 打开（挂载）默认全选（批量语义默认值）；确认上抛升序 0-based 页号数组，
// 保存流程由宿主（IllustDetail）编排。
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { t } from '../i18n'
import { useModalStack } from '../stores/modalStack'
import { useSheetDismiss, SHEET_ANIMATION } from '../composables/useSheetDismiss'
import { proxyImageUrl } from '../utils/imageUrl'
import { safeBottom } from '../utils/safeArea'
import SkeletonImage from './SkeletonImage.vue'
import AppIcon from './AppIcon.vue'
import SheetShell from './SheetShell.vue'

// 面板类串（迁移前本组件自绘面板的逐字节快照，搬进 SheetShell 后仍由本组件持有：
// 几何壳是共用的，这一串是本面板特有的 —— 与 BottomSheet 的三变体同类，不同值）
const PANEL_CLASS =
  'absolute left-0 right-0 bottom-0 bg-surface-container-lowest rounded-t-[var(--md-shape-large)] p-4'

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

// 关闭时序：两段式退场（ADR-0211 决策 3）。壳（遮罩 + 面板）收口 SheetShell，
// 相位由本组件的 useSheetDismiss 驱动并经 :phase 下传；计时器与退场动画同源，
// 到点才 emit('close')，宿主（IllustDetail）那一刻才卸载。
const dismiss = useSheetDismiss({ names: SHEET_ANIMATION, onDismissed: () => emit('close') })

/**
 * 相位 → 壳的 `phase` prop（顶层 computed 才有模板解包）。
 * ⚠️ 写成 `:motion-phase="dismiss.phase"` 编译期就报 TS2325：Vue 只解包**顶层** setup 绑定，
 *    `dismiss` 是普通对象，其 `.phase` 字段在模板里仍是 Ref 实例 ⇒ prop 收到的是对象不是相位。
 * `gone`（已卸载）归到 exit：那一刻退场动画正处于末态，语义上仍是退场。
 */
const motionPhase = computed<'enter' | 'exit'>(() => (dismiss.phase.value === 'enter' ? 'enter' : 'exit'))


onMounted(() => {
  unregisterModal = useModalStack().registerModal(() => dismiss.requestClose())
})

onBeforeUnmount(() => {
  unregisterModal?.()
  unregisterModal = null
  // 卸载时清退场计时器（宿主可能先于计时器到点卸载，如保存成功后直接收起面板）
  dismiss.dispose()
})
</script>

<template>
  <!-- 根 view：relative 提供绝对定位上下文；与宿主内容平级、DOM 顺序靠后 → 天然覆盖上层 -->
  <view class="w-full h-full relative">
    <!-- 壳（遮罩 + 底部面板）收口 SheetShell（ADR-0211 决策 4：本面板几何与 BottomSheet 同款，
         差别只在面板类串与内容，故几何壳复用、内容留在本组件插槽里）。
         相位由本组件的 useSheetDismiss 驱动：enter 挂入场动画、exit 挂退场动画，
         退场计时器（与动画同源）到点才 emit('close')。 -->
    <SheetShell :phase="motionPhase" :panel-class="PANEL_CLASS" @close="dismiss.requestClose()">
      <!-- 色调层（着色层，ADR-0207 决策 7；tint 的职责边界更正见 ADR-0212 决策 5）：
           ⚠️ 更正一条此前的错误归因：本注释原先写「MD3 表达层级的主要手段是给表面**染上主色**
           （surface tint），box-shadow 仅为辅」—— 那是 **MD3 官方口径**，本项目**照字面执行不了**。
           MD3 之所以能用 tint 表达层级，靠的是 **tint 强度随 level 递增**；而本项目 14 套色板里
           `--md-surface-tint` 与 `--md-primary` **逐个取同值**（复算：tokens.css 中两者的取值比对，
           14/14 相同、无一例外）⇒ tint 是**单一值、没有强度阶梯**，套上去只会让所有层级染同一种色，
           **表达不出层级差**。
           ⇒ 本项目的「主」是 `surface-container-*` 五档**明度分档**（面板底色取最低档
           `bg-surface-container-lowest`），不是 tint；tint 在本项目只作**状态层式叠加**，不承载层级。
           本层即该用法：让弹层顶部带 8% 主色调（8% 口径对齐 hover 层），与面板底色叠加成
           「被抬起的着色表面」，而不是一片纯白。**是着色叠加，不是层级手段** —— 着色层本身保留不动，
           要改的只是上面那句错误归因。
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
    </SheetShell>
  </view>
</template>

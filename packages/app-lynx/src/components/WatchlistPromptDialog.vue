<script setup lang="ts">
// ─── 追更询问弹窗（app-lynx，issue #224 / spec app-lynx-novel-series-watchlist §US5） ───
// M3 Dialog：fixed scrim + surface-container-high 居中卡片 + md-shape-extra-large
// （结构对齐 Me.vue ugoiraConfirm Dialog 与 Watchlist.vue 取消追更确认）。
//
// 语义边界（与 createWatchlistPrompt 一一对应）：
//   decline（「暂不」按钮）→ dismiss + 关弹窗，页面层**继续原返回动作**
//   cancel （返回键关弹窗）→ dismiss + 关弹窗，页面层**留在详情页**
//   两者是不同事件，页面层据此区分后续动作；dismiss 语义在 primitive 内完成。
//   ⚠️ 两者都**晚于退场动画**上抛（ADR-0211 决策 3 的两段式退场，见下方 requestDismiss）；
//   confirm 追更是动作不是关闭请求，不走退场（失败要留在弹窗里报错可重试）。
//
// 返回键拦截：open 期间 registerModal 注册关闭回调（= cancel），
// router.handleSystemBack 的 modalStack 优先于页面返回（ADR-0066 扩展）；
// 关闭/卸载时注销。closeTopModal pop 后调用 → 本组件 emit('cancel')。
import { computed, watch, onBeforeUnmount } from 'vue'
import { t } from '../i18n'
import { useModalStack } from '../stores/modalStack'
import { useSheetDismiss, DIALOG_ANIMATION } from '../composables/useSheetDismiss'
import { WATCHLIST_PROMPT_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { useMotion } from '../composables/motion'

/** 按压反馈载体（ADR-0211 决策 2）：颜色状态层走工具类；透明度/尺寸类走 inline `:style`——`.transition-colors` 的 transition-property 不含 opacity，挂工具类是静默失效。
 *  时长与曲线一律取自 composables/motion.ts（唯一入口），本组件不写时长/曲线字面量；
 *  R1 降级（prefers-reduced-motion）由 useMotion 统一处理，组件内不自行判断偏好。 */
const { pressColor, pressOpacity } = useMotion()


const props = defineProps<{
  /** 弹窗显隐（createWatchlistPrompt.dialogOpen） */
  open: boolean
  /** 系列标题（当前小说 novel.series.title） */
  seriesTitle: string
  /** 作者名（当前小说 novel.user.name） */
  authorName: string
  /** 追更请求在飞（dialogBusy）：禁用「追更」防连点 */
  busy: boolean
  /** 追更失败错误信息（dialogError）：非空显示错误条，「追更」保留可重试 */
  errorMsg: string
}>()

const emit = defineEmits<{
  /** 「追更」：primitive.confirm() */
  confirm: []
  /** 「暂不」：primitive.decline()（页面层继续返回） */
  decline: []
  /** 返回键关弹窗：primitive.cancel()（页面层留在详情页） */
  cancel: []
}>()

function onConfirm(): void {
  if (props.busy) return
  // ⚠️ confirm 不走两段式退场：它不是「关闭请求」而是「动作提交」——追更失败时弹窗要留着
  // 显示 errorMsg 并允许重试（见模板的错误条分支）。先退场再提交会把失败反馈藏掉。
  emit('confirm')
}

/** review P2-3：busy 期间「暂不」也禁用——防在飞 add 结果与 dismiss/返回竞争 */
function onDecline(): void {
  if (props.busy) return
  requestDismiss(() => emit('decline'))
}

// ─── 关闭时序：两段式退场（ADR-0211 决策 3；本组件是两段式退场的**首个试点**）───
// 几何是居中对话框 ⇒ 入场是 scale + fade 而不是上滑（ADR-0211 决策 4 的 ❌ 不进 SheetShell）。
// 时序与弹层同款：关闭请求 → exit 相位播退场 → 计时器（与退场动画同源，减弱动效开启时归零）
// 到点 → 本组件自己隐藏（phase=gone，v-if 生效）→ 此刻才把「关闭意图」事件上抛，
// 页面层据此继续原返回动作（decline）或留在详情页（cancel）。
// ⚠️ 事件必须**晚于**隐藏发出：decline/cancel 的语义差别由页面层消费，提前发会让页面先动、
//    弹窗还在屏幕上退场，观感割裂。
let pendingEmit: (() => void) | undefined

const dismiss = useSheetDismiss({
  names: DIALOG_ANIMATION,
  onDismissed: () => {
    const fire = pendingEmit
    pendingEmit = undefined
    fire?.()
  },
})

/**
 * 相位驱动的动画样式（顶层 computed 才有模板解包；`dismiss.phase` 是对象内嵌 Ref，模板不解包）。
 * 遮罩只淡入淡出、面板上下滑 ⇒ 两套 keyframes，不共用（共用会让遮罩跟着位移）。
 */
const scrimStyle = computed(() => dismiss.scrimStyle(dismiss.phase.value))
const panelStyle = computed(() => dismiss.panelStyle(dismiss.phase.value))


/**
 * 可见性 = `props.open` 与本地相位的合取。
 * ⚠️ 不能只看相位（`phase !== 'gone'`）：宿主**始终挂载**本组件并用 `open` 表达显隐
 * （NovelDetail 不加 v-if），相位初值是 `enter` ⇒ 只看相位会让 `open=false` 时首帧就闪现。
 * ⚠️ 也不能只看 `props.open`：`open` 变 false 的那一刻若立刻隐藏，退场动画就一帧都播不到。
 * ⇒ 进入相位听 `open`，退场相位听自己（播完才 gone）。
 */
const visible = computed(() =>
  dismiss.phase.value === 'enter' ? props.open : dismiss.phase.value === 'exit',
)

/** 关闭请求（幂等由 useSheetDismiss 保证）：排队一个终态事件后启动退场 */
function requestDismiss(fire: () => void): void {
  if (pendingEmit || dismiss.exiting.value) return
  pendingEmit = fire
  dismiss.requestClose()
}

// 返回键拦截：open 翻转时注册/注销关闭回调（modalStack 后进先出）
let unregisterModal: (() => void) | null = null
/** 本组件是否真的显示过（区分「宿主程序性关闭」与「首次就 open=false」） */
let wasShown = false

watch(
  () => props.open,
  (open) => {
    if (open && !unregisterModal) {
      unregisterModal = useModalStack().registerModal(() => requestDismiss(() => emit('cancel')))
      // 重新打开：清掉上一轮的排队事件（弹层被复用时不会把旧的 cancel 带到新一轮）
      pendingEmit = undefined
      dismiss.reopen()
    } else if (!open && unregisterModal) {
      unregisterModal()
      unregisterModal = null
    }
    if (open) {
      wasShown = true
    } else if (wasShown) {
      wasShown = false
      // 宿主程序性关闭（如页面直接收起弹窗）同样走退场，且**不排任何事件** ——
      // 程序性关闭不是用户关闭意图，页面层不需要 decline/cancel 的语义。
      // 幂等：用户关闭路径到点时相位已是 gone，这里是无操作。
      dismiss.requestClose()
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  unregisterModal?.()
  unregisterModal = null
  // 卸载时清退场计时器与排队事件（宿主可能先于计时器到点卸载，如页面直接 pop）
  dismiss.dispose()
  pendingEmit = undefined
})
</script>

<template>
  <!-- M3 Dialog：fixed 全屏 scrim 遮罩 + 居中卡片（对齐 Me.vue ugoiraConfirm / Watchlist.vue 确认弹窗）。
       显隐走两段式协议（ADR-0211 决策 3）：v-if 绑 `visible`（= props.open 与本地相位的合取，见其定义）——
       遮罩淡入淡出、卡片 scale+fade 各自独立（居中几何不上滑）。 -->
  <view
    v-if="visible"
    class="fixed inset-0 bg-scrim z-50 flex items-center justify-center"
    :style="scrimStyle"
    :accessibility-element="A11Y_ELEMENT_ENABLED"
    :accessibility-label="WATCHLIST_PROMPT_A11Y_LABELS.dialog"
  >
    <view
      class="w-[74.667vw] max-w-[74.667vw] bg-surface-container-high rounded-[var(--md-shape-extra-large)] px-6 pt-5 pb-3 shadow-[var(--md-elevation-3)]"
      :style="panelStyle"
    >
      <text class="text-headline-small font-medium text-surface-on">{{ t('watchlistPrompt.title') }}</text>
      <text class="text-body-medium text-surface-on-variant mt-4">
        《{{ seriesTitle }}》· {{ authorName }}
      </text>
      <text class="text-body-small text-surface-on-variant mt-1.5">
        {{ t('watchlistPrompt.hint') }}
      </text>

      <!-- 追更失败错误条（M3 error token）：保留「追更」可重试 -->
      <view v-if="errorMsg" class="mt-3 px-3 py-2 bg-error-container rounded-[var(--md-shape-small)]">
        <text class="text-label-medium text-error-on-container">{{ errorMsg }}</text>
      </view>

      <view class="flex flex-row justify-end mt-6 gap-2">
        <view
          class="h-[10.667vw] px-4 flex items-center justify-center"
          :class="[pressColor.className, busy ? 'opacity-40' : 'active:bg-layer-pressed-primary']"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="WATCHLIST_PROMPT_A11Y_LABELS.decline"
          @tap="onDecline"
        >
          <text class="text-label-large font-medium text-primary">{{ t('watchlistPrompt.decline') }}</text>
        </view>
        <!-- busy 禁用态：opacity-40 + tap 守卫（防连点，对齐 createBookmarkToggle busy 语义） -->
        <view
          class="h-[10.667vw] px-4 flex items-center justify-center"
          :class="[pressColor.className, busy ? 'opacity-40' : 'active:bg-layer-pressed-primary']"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="WATCHLIST_PROMPT_A11Y_LABELS.confirm"
          @tap="onConfirm"
        >
          <text class="text-label-large font-medium" :class="busy ? 'text-surface-on-variant' : 'text-primary'">{{ t('watchlistPrompt.confirm') }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

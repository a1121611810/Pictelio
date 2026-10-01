<script setup lang="ts">
// ─── 收藏面板（app-lynx，T5 #534 / spec docs/specs/bookmark-tags.md D8 + ADR-0160）───
// 形态蓝本 = CommentOverlay / PagePickerSheet / SearchSheet：遮罩 @tap 关闭、面板 @tap.stop
// 防穿透、DOM 顺序靠后覆盖（不依赖 z-index）、modalStack 注册（系统返回先关面板）。
//
// 平台约束（违反即真机故障，见 CONTEXT.md「覆盖层与命中测试」，ADR-0123）：
//  - 全屏层必须 v-if 条件渲染：宿主 IllustDetail 以 v-if 挂载本组件，关闭即卸载
//    （渲染树无全屏幽灵层，不用 pointer-events 指望穿透——原生 LynxView 不识别）；
//  - 绝对定位只用 left/top 正向锚点：面板 = top-[20vh] + h-[80vh]（与 bottom-0 贴底等价
//    的几何，但避开 right/bottom 按最近 view 祖先解析的锚点语义）；
//  - 面板挂页面层（宿主根 view 的 absolute 覆盖层），与 list-item 无关。
//
// 数据/交互状态全部收敛在 composable useBookmarkPanel（预填 detail + 标签库分库 + 竞态守护）；
// 保存经 props.saveWith（宿主 useBookmarkMutation.saveWith 覆盖式保存变体）——面板不直连
// addBookmark，保留乐观状态机与六条不变量；成败由该调用的布尔返回值判定（FIX-2），失败回滚
// 预填态、宿主 errorMsg 仅用于 footer 文案渲染。
// a11y 标注直接用 i18n 文案键（不新增静态注册表：面板文案随 locale 变化，E2E 定位以
// accessibility-element 暴露 + 文案锚定为准）。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { t } from '../i18n'
import type { RestrictType } from '../api/types'
import { BOOKMARK_TAG_LIMIT } from '../utils/bookmarkTags'
import { useBookmarkPanel } from '../composables/useBookmarkPanel'
import { useAuthStore } from '../stores/authStore'
import { useModalStack } from '../stores/modalStack'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { INPUT_PLACEHOLDER_COLOR } from '../utils/lynxPlatformColors'
import { safeBottom } from '../utils/safeArea'
import { useSheetDismiss, SHEET_ANIMATION } from '../composables/useSheetDismiss'
import { useMotion } from '../composables/motion'

/** 按压反馈载体（ADR-0211 决策 2）：颜色状态层走 transition-colors 工具类——`background-color` 在其 transition-property 覆盖内（已验证）。
 *  时长与曲线一律取自 composables/motion.ts（唯一入口），本组件不写时长/曲线字面量；
 *  R1 降级（prefers-reduced-motion）由 useMotion 统一处理，组件内不自行判断偏好。 */
const { pressColor } = useMotion()


const props = defineProps<{
  /** 目标作品 id（面板内预填/标签库请求的作用域；变化即重载） */
  illustId: number
  /** 作品自带标签名（建议来源，spec D5；原形 name，不取 translated_name） */
  workTags?: string[]
  /** 宿主收藏状态机的保存变体（T4 saveWith）——面板保存的唯一通道；
   * 返回 true=成功 / false=失败静息回滚（成败判定唯一依据，FIX-2） */
  saveWith: (restrict: RestrictType, tags: string[]) => Promise<boolean>
  /** 宿主 mutation 的 errorMsg（仅用于保存失败文案渲染，不作成败判定） */
  saveError: string
  /** 宿主 mutation 的 busy（保存中禁用保存按钮，与快速收藏共用互斥锁） */
  saving: boolean
}>()

const emit = defineEmits<{
  /** 请求关闭（遮罩 / × / 系统返回键）→ 宿主 v-if 卸载本组件 */
  close: []
  /** 保存成功（宿主更新页面收藏态并关面板）——无参：宿主不消费可见性 */
  saved: []
}>()

const auth = useAuthStore()

const panel = useBookmarkPanel({
  getIllustId: () => props.illustId,
  getUserId: () => auth.currentUser?.id ?? null,
  saveWith: (restrict, tags) => props.saveWith(restrict, tags),
  getSaving: () => props.saving,
  onSaved: () => emit('saved'),
})

const { restrict, selected, input, feedback, universeTags, detailStatus, detailError, universeStatus, prefillBookmarked, canSave } =
  panel

/** 保存按钮文案：预填已收藏 = 覆盖式编辑（「保存修改」），未收藏 = 「收藏」 */
const saveLabel = computed(() =>
  prefillBookmarked.value ? t('bookmarkPanel.saveEdit') : t('bookmarkPanel.save'),
)

/** 输入/选择反馈文案（瞬态，2.5s 自动清除由 composable 承担） */
const feedbackText = computed(() => {
  if (feedback.value === 'limit') return t('bookmarkPanel.limitReached', { limit: BOOKMARK_TAG_LIMIT })
  if (feedback.value === 'empty') return t('bookmarkPanel.newTagEmpty')
  if (feedback.value === 'duplicate') return t('bookmarkPanel.newTagDuplicate')
  return ''
})

// ── 标签 chip 类（M3 语义色，同 SearchSheet 的 scope/sort 段约定）──
const chipCls = (active: boolean) =>
  active ? 'bg-secondary-container' : 'bg-surface-container-high'
const chipTextCls = (active: boolean) =>
  active ? 'text-secondary-on-container' : 'text-surface-on-variant'
const visibilityCls = (active: boolean) =>
  active ? 'bg-primary-container' : 'bg-surface-container-high'
const visibilityTextCls = (active: boolean) =>
  active ? 'text-primary-on-container font-medium' : 'text-surface-on-variant'

function isSelected(name: string): boolean {
  return selected.value.includes(name)
}

interface LynxInputEvent {
  detail?: { value?: string; isComposing?: boolean }
}

// ─── M3 filled text field 聚焦态（ADR-0209 决策 2）───
// 死的是 `:focus` 伪类（ADR-0207 决策 5），活的是 bindfocus/bindblur 事件（官方文档 Events 段，
// Android/iOS/Harmony since 3.4）⇒ 指示条加粗转 primary 走事件驱动。
// 竞态防护与 onInput 同源：blur 记录当时值，input 见值变了才把聚焦态抢回来。
const focused = ref(false)
let valueAtBlur = ''

function onFocus(): void {
  focused.value = true
}

function onBlur(): void {
  valueAtBlur = input.value
  focused.value = false
}

/** 指示条动态类：聚焦 2px + primary（静止态的 1px + on-surface-variant 走静态 class，
 *  官方 active-indicator-color = on-surface-variant，见 ADR-0209 决策 1）。 */
const inputCls = computed(() => (focused.value ? 'border-b-[2px] border-b-primary' : ''))

/** 输入事件：v-model 已先赋值（vue-lynx injectVModelEvent 保证顺序，SearchSheet 同约定）。
 * spec D11：空格即提交当前 token（与服务端空格分隔语义一致）——输入值以空格结尾即提交，
 * 提交后输入清空（trim 吃掉尾空格）；IME 组合态（isComposing）不提交。
 *
 * 兼 M3 filled text field 的聚焦闸门（ADR-0209 决策 2）：失焦瞬间仍可能在途 input 事件，
 * 无脑接受迟到的 blur 会把正在编辑的字段留在静止态（指示条退回 1px）。闸门取「失焦瞬间的值快照」——
 * blur 之后只有值真的变了才认定仍在编辑；真离开时值不变 ⇒ 不留假的 2px primary 指示条。
 */
function onInput(data: LynxInputEvent): void {
  if (!focused.value && input.value !== valueAtBlur) focused.value = true
  if (data?.detail?.isComposing) return
  const value = data?.detail?.value ?? input.value
  if (value.endsWith(' ')) {
    panel.commitInput()
  }
}

/** 键盘确认键（Enter）同义提交（spec D11） */
function onInputConfirm(): void {
  panel.commitInput()
}

// 关闭时序：两段式退场（ADR-0211 决策 3）。本面板自绘壳（不用 SheetShell：内容与面板类串
// 逐字节锁在本组件门禁里），所以相位与动画样式直接绑在自有的遮罩 / 面板两个 view 上；
// 计时器与退场动画同源（减弱动效开启时归零），到点才 emit('close')，宿主那一刻才卸载。
const dismiss = useSheetDismiss({ names: SHEET_ANIMATION, onDismissed: () => emit('close') })

/**
 * 相位驱动的动画样式（顶层 computed 才有模板解包；`dismiss.phase` 是对象内嵌 Ref，模板不解包）。
 * 遮罩只淡入淡出、面板上下滑 ⇒ 两套 keyframes，不共用（共用会让遮罩跟着位移）。
 */
const scrimStyle = computed(() => dismiss.scrimStyle(dismiss.phase.value))
const panelStyle = computed(() => dismiss.panelStyle(dismiss.phase.value))

function onClose(): void {
  dismiss.requestClose()
}

function onSave(): void {
  void panel.save()
}

// 系统返回键：挂载期间注册关闭回调（modalStack 后进先出），卸载注销——与 CommentOverlay 同机制
let unregisterModal: (() => void) | null = null

onMounted(() => {
  unregisterModal = useModalStack().registerModal(onClose)
  // 打开即并行预填 + 标签库（spec D6）；关闭 = 卸载 = dispose（中止在途请求）
  void panel.load()
})

onBeforeUnmount(() => {
  unregisterModal?.()
  unregisterModal = null
  panel.dispose()
  // 卸载时清退场计时器（宿主可能先于计时器到点卸载，如保存成功后宿主直接收起面板）
  dismiss.dispose()
})
</script>

<template>
  <!-- 全屏层（仅挂载期间存在；absolute 同族定位上下文 = 宿主根 view） -->
  <view class="absolute left-0 top-0 w-full h-full z-40">
    <!-- 遮罩：@tap 关闭（原生 hit-testing：全屏层本身即交互面，ADR-0123）；
         淡入 / 淡出走两段式协议（ADR-0211 决策 3），动画简写来自 composables/motion.ts -->
    <view
      class="absolute left-0 top-0 w-full h-full bg-scrim"
      :style="scrimStyle"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="t('bookmarkPanel.closeScrimAria')"
      @tap="onClose"
    />

    <!-- 底部面板（80vh）：@tap.stop 防面板内点击穿透到遮罩。
         定位只用 left/top（禁 right/bottom：ADR-0123 定位锚点规则）；
         上滑 / 下滑同样走 inline 动画（Tailwind transform 族是死类名，ADR-0210 路径 E） -->
    <view
      class="absolute left-0 top-[20vh] w-full h-[80vh] bg-surface-container-lowest rounded-t-[var(--md-shape-extra-large)] flex flex-col"
      :style="panelStyle"
      @tap.stop
    >
      <!-- 标题栏：居中标题（title-large）+ × 关闭 -->
      <view class="flex flex-row items-center h-[11.733vw] px-4 flex-shrink-0">
        <view class="w-[8vw]" />
        <text class="flex-1 text-center text-title-large font-medium text-surface-on">{{ t('bookmarkPanel.title') }}</text>
        <view
          class="w-[8vw] h-[8vw] flex items-center justify-center"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="t('bookmarkPanel.closeAria')"
          @tap="onClose"
        >
          <text class="text-[6.4vw] leading-none text-surface-on-variant">×</text>
        </view>
      </view>

      <!-- 内容区（可滚动）：预填态 / 可见性 / 已选 / 新建 / 标签库 / 作品标签建议 -->
      <scroll-view scroll-orientation="vertical" class="w-full flex-1 min-h-0 px-4">
        <!-- 预填加载中 -->
        <text v-if="detailStatus === 'loading'" class="text-label-medium text-outline block mt-1">
          {{ t('bookmarkPanel.detailLoading') }}
        </text>

        <!-- 预填失败：显式错误 + 保存禁用（D6：无真值不覆盖） -->
        <text
          v-else-if="detailStatus === 'error'"
          class="text-label-medium text-error block mt-1"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="t('bookmarkPanel.detailFailed', { detail: detailError })"
        >
          {{ t('bookmarkPanel.detailFailed', { detail: detailError }) }}
        </text>

        <!-- 可见性（公开/私密；切换后标签库候选按分库重拉，spec D6） -->
        <view class="mt-4">
          <text class="text-label-medium text-outline">{{ t('bookmarkPanel.visibilityLabel') }}</text>
          <view class="flex flex-row flex-wrap gap-2 mt-2">
            <view
              class="h-[10.667vw] px-4 rounded-[var(--md-shape-full)] flex items-center"
              :class="visibilityCls(restrict === 'public')"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="t('bookmarkPanel.visibilityPublic')"
              @tap="restrict = 'public'"
            >
              <text class="text-body-small" :class="visibilityTextCls(restrict === 'public')">{{ t('bookmarkPanel.visibilityPublic') }}</text>
            </view>
            <view
              class="h-[10.667vw] px-4 rounded-[var(--md-shape-full)] flex items-center"
              :class="visibilityCls(restrict === 'private')"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="t('bookmarkPanel.visibilityPrivate')"
              @tap="restrict = 'private'"
            >
              <text class="text-body-small" :class="visibilityTextCls(restrict === 'private')">{{ t('bookmarkPanel.visibilityPrivate') }}</text>
            </view>
          </view>
        </view>

        <!-- 已选区（chip 可移除；上限 10 由 reducer 强制 + 反馈，spec D5） -->
        <view class="mt-4">
          <text class="text-label-medium text-outline">
            {{ t('bookmarkPanel.selectedLabel', { count: selected.length, limit: BOOKMARK_TAG_LIMIT }) }}
          </text>
          <text v-if="selected.length === 0" class="text-label-medium text-outline block mt-2">
            {{ t('bookmarkPanel.selectedEmpty') }}
          </text>
          <view v-else class="flex flex-row flex-wrap gap-2 mt-2">
            <view
              v-for="name in selected"
              :key="name"
              class="h-[10.667vw] px-3 rounded-[var(--md-shape-full)] flex items-center bg-secondary-container"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="t('bookmarkPanel.removeTagAria', { tag: name })"
              @tap="panel.toggleTag(name)"
            >
              <text class="text-body-small text-secondary-on-container [max-line:1]" style="word-break: break-all">{{ name }}</text>
              <text class="text-body-small text-secondary-on-container ml-2 flex-shrink-0">×</text>
            </view>
          </view>
        </view>

        <!-- 内联新建（空格 / Enter 提交 token，spec D11）；反馈瞬态 -->
        <view class="mt-4">
          <text class="text-label-medium text-outline">{{ t('bookmarkPanel.newTagLabel') }}</text>
          <view class="flex flex-row items-center gap-2 mt-2">
            <!-- M3 filled text field（ADR-0209 决策 1）：42dp 药丸 → 56dp + 顶 4dp/底 0 + 底部 1px 指示条。
                 placeholder-color 是 Lynx **平台属性**（非 CSS）：实测不解析 var()（FIX-5），
                 颜色值以常量承载（lynxPlatformColors.ts 单点定义），禁止散写十六进制。
                 label 不另起：上方 newTagLabel 已是常驻可见字段名，MD3 不用「常驻 label + 浮动 label」双份，
                 二选一取常驻那份（ADR-0209 决策 3 要求的 label 浮动在本控件不成立，理由见交付汇报）。 -->
            <input
              v-model="input"
              class="flex-1 h-[14.933vw] box-border bg-surface-container-highest rounded-t-[var(--md-shape-extra-small)] rounded-b-none border-b-[1px] border-b-surface-on-variant text-body-large text-surface-on px-5"
              :class="inputCls"
              :placeholder="t('bookmarkPanel.newTagPlaceholder')"
              :placeholder-color="INPUT_PLACEHOLDER_COLOR"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="t('bookmarkPanel.newTagLabel')"
              @focus="onFocus"
              @blur="onBlur"
              @input="onInput"
              @confirm="onInputConfirm"
            />
            <view
              class="h-[11.2vw] px-4 rounded-[var(--md-shape-full)] flex items-center justify-center bg-surface-container-high"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="t('bookmarkPanel.newTagAddAria')"
              @tap="panel.commitInput()"
            >
              <text class="text-label-large text-surface-on">{{ t('bookmarkPanel.newTagAddAria') }}</text>
            </view>
          </view>
          <text v-if="feedbackText" class="text-label-medium text-error block mt-2">{{ feedbackText }}</text>
        </view>

        <!-- 标签库（按可见性分库；失败降级提示、保存不受阻，spec D6） -->
        <view class="mt-4">
          <text class="text-label-medium text-outline">{{ t('bookmarkPanel.universeLabel') }}</text>
          <text v-if="universeStatus === 'loading'" class="text-label-medium text-outline block mt-2">
            {{ t('bookmarkPanel.universeLoading') }}
          </text>
          <text
            v-else-if="universeStatus === 'error'"
            class="text-label-medium text-error block mt-2"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="t('bookmarkPanel.universeFailed')"
          >
            {{ t('bookmarkPanel.universeFailed') }}
          </text>
          <text v-else-if="universeTags.length === 0" class="text-label-medium text-outline block mt-2">
            {{ t('bookmarkPanel.universeEmpty') }}
          </text>
          <view v-else class="flex flex-row flex-wrap gap-2 mt-2">
            <view
              v-for="tag in universeTags"
              :key="tag.name"
              class="h-[10.667vw] px-3 rounded-[var(--md-shape-full)] flex items-center"
              :class="chipCls(isSelected(tag.name))"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="t('bookmarkPanel.universeTagAria', { name: tag.name, count: tag.count })"
              @tap="panel.toggleTag(tag.name)"
            >
              <text class="text-body-small [max-line:1]" :class="chipTextCls(isSelected(tag.name))" style="word-break: break-all">{{ tag.name }}</text>
              <text class="text-label-small ml-2 flex-shrink-0 opacity-70" :class="chipTextCls(isSelected(tag.name))">{{ tag.count }}</text>
            </view>
          </view>
        </view>

        <!-- 作品标签建议（作品自带标签，仅作建议来源，spec D5） -->
        <view v-if="workTags && workTags.length > 0" class="mt-4">
          <text class="text-label-medium text-outline">{{ t('bookmarkPanel.suggestionsLabel') }}</text>
          <view class="flex flex-row flex-wrap gap-2 mt-2">
            <view
              v-for="name in workTags"
              :key="name"
              class="h-[10.667vw] px-3 rounded-[var(--md-shape-full)] flex items-center"
              :class="chipCls(isSelected(name))"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="t('bookmarkPanel.suggestionAria', { name })"
              @tap="panel.toggleTag(name)"
            >
              <text class="text-body-small [max-line:1]" :class="chipTextCls(isSelected(name))" style="word-break: break-all">{{ name }}</text>
            </view>
          </view>
        </view>

        <view class="h-4" />
      </scroll-view>

      <!-- 保存区：失败错误（宿主 errorMsg）+ 保存按钮（预填失败禁存） -->
      <view class="w-full px-4 pt-3 pb-[5.333vw] flex-shrink-0">
        <text
          v-if="saveError"
          class="text-label-medium text-error block mb-2"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="t('bookmarkPanel.saveFailed', { detail: saveError })"
        >
          {{ t('bookmarkPanel.saveFailed', { detail: saveError }) }}
        </text>
        <view
          class="h-[12vw] rounded-[var(--md-shape-full)] flex items-center justify-center"
          :class="[pressColor.className, canSave ? 'bg-primary active:bg-layer-pressed-on-primary' : 'bg-surface-container-high relative']"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="saveLabel"
          @tap="onSave"
        >
          <!-- MD3 disabled container = 「底色叠 on-surface 12%」。**必须作为独立覆盖层**
               （真机实证，见 ADR-0209 引擎约束 §disabled 叠加）：若与 `bg-surface-container-high`
               写在**同一元素**上，两者都是 `background-color`，Tailwind 产物里
               `bg-surface-container-high` 声明在后 ⇒ 12% alpha 层被整条覆盖、静默不生效。
               拆成父子两层后 alpha 才真正与底色合成。 -->
          <view
            v-if="!canSave"
            class="absolute inset-0 rounded-[var(--md-shape-full)] bg-state-disabled-container"
          />
          <text
            class="relative text-label-large font-medium"
            :class="canSave ? 'text-primary-on' : 'text-surface-on-variant'"
          >
            {{ saving ? t('bookmarkPanel.saving') : saveLabel }}
          </text>
        </view>
      </view>
      <!-- 系统栏安全区（spec lynx-systembars §4.2）：top-[20vh]+h-[80vh] 与 bottom-0 贴底
           等价（ADR-0123 正向锚点），保存区末尾同样要抬离手势/导航区 -->
      <view :style="{ height: safeBottom + 'px' }" />
    </view>
  </view>
</template>

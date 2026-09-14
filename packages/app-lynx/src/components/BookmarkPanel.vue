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
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { t } from '../i18n'
import type { RestrictType } from '../api/types'
import { BOOKMARK_TAG_LIMIT } from '../utils/bookmarkTags'
import { useBookmarkPanel } from '../composables/useBookmarkPanel'
import { useAuthStore } from '../stores/authStore'
import { useModalStack } from '../stores/modalStack'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { INPUT_PLACEHOLDER_COLOR } from '../utils/lynxPlatformColors'

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

/**
 * 输入事件：v-model 已先赋值（vue-lynx injectVModelEvent 保证顺序，SearchSheet 同约定）。
 * spec D11：空格即提交当前 token（与服务端空格分隔语义一致）——输入值以空格结尾即提交，
 * 提交后输入清空（trim 吃掉尾空格）；IME 组合态（isComposing）不提交。
 */
function onInput(data: LynxInputEvent): void {
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

function onClose(): void {
  emit('close')
}

function onSave(): void {
  void panel.save()
}

// 系统返回键：挂载期间注册关闭回调（modalStack 后进先出），卸载注销——与 CommentOverlay 同机制
let unregisterModal: (() => void) | null = null

onMounted(() => {
  unregisterModal = useModalStack().registerModal(() => emit('close'))
  // 打开即并行预填 + 标签库（spec D6）；关闭 = 卸载 = dispose（中止在途请求）
  void panel.load()
})

onBeforeUnmount(() => {
  unregisterModal?.()
  unregisterModal = null
  panel.dispose()
})
</script>

<template>
  <!-- 全屏层（仅挂载期间存在；absolute 同族定位上下文 = 宿主根 view） -->
  <view class="absolute left-0 top-0 w-full h-full z-40">
    <!-- 遮罩：@tap 关闭（原生 hit-testing：全屏层本身即交互面，ADR-0123） -->
    <view
      class="absolute left-0 top-0 w-full h-full bg-scrim"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="t('bookmarkPanel.closeScrimAria')"
      @tap="onClose"
    />

    <!-- 底部面板（80vh）：@tap.stop 防面板内点击穿透到遮罩。
         定位只用 left/top（禁 right/bottom：ADR-0123 定位锚点规则） -->
    <view
      class="absolute left-0 top-[20vh] w-full h-[80vh] bg-surface-container-lowest rounded-t-[var(--md-shape-extra-large)] flex flex-col"
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
            <!-- placeholder-color 是 Lynx **平台属性**（非 CSS）：实测不解析 var()（FIX-5），
                 颜色值以常量承载（lynxPlatformColors.ts 单点定义），禁止散写十六进制 -->
            <input
              v-model="input"
              class="flex-1 h-[11.2vw] box-border bg-surface-container-highest rounded-[var(--md-shape-full)] text-body-medium text-surface-on px-5"
              :placeholder="t('bookmarkPanel.newTagPlaceholder')"
              :placeholder-color="INPUT_PLACEHOLDER_COLOR"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="t('bookmarkPanel.newTagLabel')"
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
          :class="canSave ? 'bg-primary active:bg-state-pressed-primary' : 'bg-surface-container-high opacity-40'"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="saveLabel"
          @tap="onSave"
        >
          <text class="text-label-large font-medium" :class="canSave ? 'text-primary-on' : 'text-surface-on-variant'">
            {{ saving ? t('bookmarkPanel.saving') : saveLabel }}
          </text>
        </view>
      </view>
    </view>
  </view>
</template>

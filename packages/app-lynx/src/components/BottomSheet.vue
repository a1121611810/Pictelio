<script setup lang="ts">
// BottomSheet —— 底部弹层壳（公共层，ADR-0194 D5/D6 / spec docs/specs/lynx-common-components.md D6）。
// 收口各弹层手写的「scrim + 80vh 面板 + 标题栏 + × 关闭」壳结构，命中测试语义单点化
// （ADR-0123 / ADR-0147 平台约束，迁移前各弹层逐字节快照 = 本组件类串的 oracle）。
//
// 接口（调用方需要知道的全部）：
//   :title                       标题栏文案（已解析字符串，调用方经 i18n 传入；响应式绑定即可，
//                                如 :title="t('commentOverlay.title', { count })"。组件零 i18n 内置）
//   #title                       可选：整体替换标题元素（仅当需要非标准标题 markup 时使用；
//                                默认标题 = 居中 title-large，类串由组件单点持有）
//   default slot                 面板内容（标题栏之下全部业务内容；面板尾部安全区 spacer
//                                （safeBottom，ADR-0168）由调用方放在 default slot 末尾）
//   :handle                      拖把手柄变体（SeriesSheet 形态）：渲染顶部把手（可点关闭）
//                                替代「标题栏 + ×」；标题/内容全部走 default slot
//   :panel-height                面板高度三变体（迁移前实例快照逐字节对应）：
//                                  'fixed'（默认）= h-[80vh]（CommentOverlay / SearchSheet）
//                                  'fit'          = max-h-[80vh]（SeriesSheet，内容自适应上限 80vh）
//                                  'content'      = 不设高（NovelExportSheet，纯内容高）
//   :scrim-accessibility-label   scrim a11y 文案（可选；缺省不渲染 a11y 属性——
//                                CommentOverlay/SearchSheet 现状无、BookmarkPanel/SeriesSheet 有）
//   :close-accessibility-label   ×/把手 a11y 文案（可选；缺省不渲染 a11y 属性——
//                                CommentOverlay 现状无、SearchSheet/NovelExportSheet/SeriesSheet 有）
//   @close                       关闭请求（scrim / × / 把手点击上抛）；系统返回键与挂载生命周期
//                                留在调用方（modalStack 注册 + 宿主 v-if 卸载，组件不感知）
//
// 命中测试语义四要素（逐字节保留，禁止改动；ADR-0123/0147 + glossary「BottomSheet」）：
//   ① 挂载由父级 v-if 控制（卸载式显隐；本组件不自管 open 状态，禁止 v-show/visibility 化）；
//   ② scrim @tap 关闭（原生 LynxView hit-testing：全屏层必须自身是交互面）；
//   ③ 面板根 @tap.stop 防面板内点击穿透到 scrim；
//   ④ z 序 scrim < 面板（同层兄弟按 DOM 顺序，不依赖 z-index）。
//
// 结构说明：组件根 = absolute inset-0 全屏层（只作 scrim/面板的定位上下文，自身不挂 @tap——
// scrim 全覆盖即交互面，SeriesSheet 既有同款层级形态）；调用方既有的根 view / 宿主
// absolute inset-0 包裹（issue #139 挂载契约）原样保留在组件之外，z 序挂法逐例不动。
import { computed } from 'vue'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'

const props = withDefaults(
  defineProps<{
    /** 标题栏文案（已解析字符串；#title slot 优先） */
    title?: string
    /** 拖把手柄变体：渲染把手（可点关闭）替代「标题栏 + ×」 */
    handle?: boolean
    /** 面板高度变体（默认 fixed = h-[80vh]） */
    panelHeight?: 'fixed' | 'fit' | 'content'
    /** scrim a11y 文案（缺省不渲染 a11y 属性） */
    scrimAccessibilityLabel?: string
    /** ×/把手 a11y 文案（缺省不渲染 a11y 属性） */
    closeAccessibilityLabel?: string
  }>(),
  { panelHeight: 'fixed' },
)

const emit = defineEmits<{
  close: []
}>()

/**
 * 面板类串（纯函数便于 template 测试求值；三变体 = 迁移前 CommentOverlay+SearchSheet /
 * SeriesSheet / NovelExportSheet 的面板类串逐字节快照，禁止增删任何 token）。
 */
function buildPanelClass(panelHeight: 'fixed' | 'fit' | 'content' | undefined): string {
  const height =
    panelHeight === 'fit' ? 'max-h-[80vh]' : panelHeight === 'content' ? '' : 'h-[80vh]'
  return [
    'absolute bottom-0 left-0 right-0',
    height,
    'bg-surface-container-lowest rounded-t-[var(--md-shape-extra-large)] flex flex-col',
  ]
    .filter(Boolean)
    .join(' ')
}

const panelClass = computed(() => buildPanelClass(props.panelHeight))
</script>

<template>
  <!-- 全屏层：挂载由父级 v-if 控制（ADR-0123 卸载式显隐）；本层只作定位上下文不挂 @tap——
       scrim 全覆盖即交互面（SeriesSheet 既有层级形态） -->
  <view class="absolute inset-0">
    <!-- scrim：@tap 关闭（ADR-0123：全屏层本身即交互面）；a11y 文案可选，缺省分文与
         CommentOverlay/SearchSheet 现状逐字节一致（无 a11y 属性） -->
    <view
      v-if="scrimAccessibilityLabel"
      class="absolute inset-0 bg-scrim"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="scrimAccessibilityLabel"
      @tap="emit('close')"
    />
    <view v-else class="absolute inset-0 bg-scrim" @tap="emit('close')" />

    <!-- 底部面板：@tap.stop 防面板内点击穿透到 scrim（高度三变体见 buildPanelClass） -->
    <view :class="panelClass" @tap.stop>
      <!-- 变体：拖把手柄（SeriesSheet 形态）——把手可点关闭，标题/内容全部走 default slot -->
      <template v-if="handle">
        <view class="w-full flex justify-center pt-2 pb-1">
          <view
            v-if="closeAccessibilityLabel"
            class="w-12 h-1 rounded-full bg-outline"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="closeAccessibilityLabel"
            @tap="emit('close')"
          />
          <view v-else class="w-12 h-1 rounded-full bg-outline" @tap="emit('close')" />
        </view>
      </template>

      <!-- 默认：标题栏（居中标题 title-large + 右侧 × 关闭） -->
      <view v-else class="flex flex-row items-center h-[11.733vw] px-4 flex-shrink-0">
        <view class="w-[8vw]" />
        <slot name="title">
          <text class="flex-1 text-center text-title-large font-medium text-surface-on">{{ title }}</text>
        </slot>
        <view
          v-if="closeAccessibilityLabel"
          class="w-[8vw] h-[8vw] flex items-center justify-center"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="closeAccessibilityLabel"
          @tap="emit('close')"
        >
          <text class="text-[6.4vw] leading-none text-surface-on-variant">×</text>
        </view>
        <view v-else class="w-[8vw] h-[8vw] flex items-center justify-center" @tap="emit('close')">
          <text class="text-[6.4vw] leading-none text-surface-on-variant">×</text>
        </view>
      </view>

      <slot />
    </view>
  </view>
</template>

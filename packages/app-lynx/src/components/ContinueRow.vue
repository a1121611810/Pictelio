<script setup lang="ts">
// ─── 续读行（ContinueReading row）[ADR-0219 §2.1 / 票 #926] ───
// 书架段 3 预览与 /continue 完整列表**共用**同一行组件：两处若各写一份，形态必然漂移
// （这正是 listItemStaggerContract L2 要求统一出口的同一类问题）。
//
// 📌 **受限态零网络判定**：快照存 `xRestrict`，本组件据此**本地**决定是否走受限呈现，
//   不发任何请求。依据术语文档「受限内容」词条：列表**全量渲染**受限条目、不隐藏不删除。
//
// ⚠️ **不复用 `RestrictedNovelCard`**：那张卡高度写死 40vw，是为小说列表大卡设计的；
//   续读行是 18.667vw 的紧凑行，套上去会撑高段 3。受限**徽章块**改用 `RestrictOverlay`
//   的流内模式（`overlay: false`）——那是徽章的单一事实源，两种尺寸下都适用。
import { computed } from 'vue'
import RestrictOverlay from './RestrictOverlay.vue'
import SkeletonImage from './SkeletonImage.vue'
import { proxyImageUrl } from '../utils/imageUrl'
import { artworkTitle } from '../utils/artworkTitle'
import { t } from '../i18n'
import { decideContinueLabel, type ContinueReadingItem } from '../stores/continueReadingStore'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { useMotion } from '../composables/motion'

const props = defineProps<{
  item: ContinueReadingItem
  /** true = /continue 完整列表（展示移除按钮 + 失效占位）；false = 书架段 3 预览（紧凑） */
  detailed?: boolean
  /** 缩略图 → 大图转场锚点 id（composables/heroTransition 的 sourceId 返回 string，
   *  直接透传给 SkeletonImage；不传则不参与转场测量） */
  thumbId?: string
}>()

const emit = defineEmits<{ (e: 'open', item: ContinueReadingItem): void; (e: 'remove', item: ContinueReadingItem): void }>()

/** 按压反馈载体（ADR-0211 决策 2）：`background-color` 须在 transition-property 覆盖内，
 *  否则 active: 状态层挂错载体 = 静默失效（本仓既有门禁 pressStateLayerTransition 会转红）。
 *  时长与曲线一律取自 composables/motion.ts（唯一入口），本组件不写字面量。 */
const { pressColor } = useMotion()

/** 受限（0 = 全部年龄）——本地判定，零网络（ADR-0219 §2.5） */
const restricted = computed(() => props.item.xRestrict > 0)
const restrictLevel = computed<1 | 2>(() => (props.item.xRestrict === 2 ? 2 : 1))

/**
 * 行无障碍标签：受限行**不可点**，不能宣称「打开」——那会让屏读用户得到一个
 * 承诺了动作却没有动作的条目（假承诺）。失效行同样不可点，标签说明原因。
 */
const rowA11yLabel = computed(() => {
  if (props.item.unavailable === true) return t('continue.unavailable')
  if (restricted.value) return t('continue.restricted')
  return t('continue.open')
})

/** 是否可点：受限或失效行均不导航（ADR-0219 §2.5 不静默隐藏，但也不假装能打开） */
const openable = computed(() => !restricted.value && props.item.unavailable !== true)


/** 行内状态文案参数：不可确定时为 null ⇒ **不渲染该行**（单本小说无系列坐标，不推算） */
const chapterLabel = computed(() => {
  const hit = decideContinueLabel(props.item)
  return hit === null ? null : t('continue.label.chapter', { n: String(hit.chapterNo) })
})
</script>

<template>
  <view
    class="flex flex-row items-center mx-3 mb-1.5 p-2 bg-surface-container-lowest rounded-[var(--md-shape-medium)]"
    :class="restricted ? '' : pressColor.className"
    :accessibility-element="A11Y_ELEMENT_ENABLED"
    :accessibility-label="rowA11yLabel"
    @tap="openable ? emit('open', item) : undefined"
  >
    <!-- 受限：流内徽章块占封面位，标题/作者仍可见（不隐藏条目）；点击不导航 -->
    <view
      v-if="restricted"
      class="w-[18.667vw] h-[18.667vw] flex items-center justify-center rounded-[var(--md-shape-small)]"
      :style="{ background: 'var(--md-scrim)' }"
    >
      <RestrictOverlay :overlay="false" :level="restrictLevel" />
    </view>
    <SkeletonImage
      v-else-if="item.coverUrl"
      :id="thumbId"
      :src="proxyImageUrl(item.coverUrl)"
      height="18.667vw"
      class="w-[18.667vw] rounded-[var(--md-shape-small)]"
      lazy-load
    />
    <view class="flex-1 flex flex-col ml-2.5 min-w-0">
      <text class="text-body-large text-surface-on [max-line:1]">{{ artworkTitle(item.title) }}</text>
      <text class="text-body-small text-surface-on-variant mt-0.5 [max-line:1]">{{ item.userName }}</text>
      <!-- 作品失效（票 #926 AC #9）：显式标注不可用，**不隐藏该条目**、不移除入口 -->
      <text v-if="item.unavailable === true" class="text-label-medium text-error mt-1 [max-line:1]">
        {{ t('continue.unavailable') }}
      </text>
      <!-- 「上次读到 第N话」：仅小说有坐标可算时出现（插画浏览历史无此概念） -->
      <text v-if="chapterLabel && item.unavailable !== true" class="text-label-medium text-primary mt-1 [max-line:1]">
        {{ chapterLabel }}
      </text>
    </view>
    <!-- 单条移除（@tap.stop 防卡片导航误触） -->
    <view
      v-if="detailed"
      class="self-center ml-2 h-[10.667vw] px-3 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)]"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="t('continue.remove')"
      @tap.stop="emit('remove', item)"
    >
      <text class="text-label-large text-primary">{{ t('continue.remove') }}</text>
    </view>
  </view>
</template>

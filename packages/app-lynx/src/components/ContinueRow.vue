<script setup lang="ts">
// ─── 继续读行（ContinueReading row）[ADR-0219 §2.1 / 票 #926 + 票 #927] ───
// 书架段 3 预览与 /continue 完整列表**共用**同一行组件：两处若各写一份，形态必然漂移
// （这正是 listItemStaggerContract L2 要求统一出口的同一类问题）。
//
// 📌 **两轴同段同页**（票 #927）：本行同时渲染小说「续读条目」与插画「浏览记录条目」，
//   入参是聚合后的行视图模型（primitives/continueEntries），本组件**不认 store**。
//   两类的可辨认性 = **行内状态文案的有无**（小说「上次读到 第N话」/ 插画无）
//   **+ 类型徽章**（ADR-0219 §2.1 拍板，刻意不靠分段）。
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
import type { ContinueEntry } from '../primitives/continueEntries'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { useMotion } from '../composables/motion'

const props = defineProps<{
  entry: ContinueEntry
  /** true = /continue 完整列表（展示移除按钮 + 失效占位）；false = 书架段 3 预览（紧凑） */
  detailed?: boolean
  /** 缩略图 → 大图转场锚点 id（composables/heroTransition 的 sourceId 返回 string，
   *  直接透传给 SkeletonImage；不传则不参与转场测量） */
  thumbId?: string
}>()

const emit = defineEmits<{ (e: 'open', entry: ContinueEntry): void; (e: 'remove', entry: ContinueEntry): void }>()

/** 按压反馈载体（ADR-0211 决策 2）：`background-color` 须在 transition-property 覆盖内，
 *  否则 active: 状态层挂错载体 = 静默失效（本仓既有门禁 pressStateLayerTransition 会转红）。
 *  时长与曲线一律取自 composables/motion.ts（唯一入口），本组件不写字面量。 */
const { pressColor } = useMotion()

/** 受限（0 = 全部年龄）——本地判定，零网络（ADR-0219 §2.5） */
const restricted = computed(() => props.entry.xRestrict > 0)
const restrictLevel = computed<1 | 2>(() => (props.entry.xRestrict === 2 ? 2 : 1))

/** 类型徽章文案（ADR-0219 §2.1：两轴靠行内文案的有无 + 类型徽章区分，不靠分段） */
const typeBadge = computed(() =>
  props.entry.kind === 'novel' ? t('continue.badge.novel') : t('continue.badge.illust'),
)

/**
 * 行无障碍标签：受限行**不可点**，不能宣称「打开」——那会让屏读用户得到一个
 * 承诺了动作却没有动作的条目（假承诺）。失效行同样不可点，标签说明原因。
 *
 * 📌 正常态带 `{type}` 参数：整行挂了 accessibility-label 后子文本不再被朗读，
 *   徽章若不进标签，屏读用户就分不出「在读」与「刷过」——视觉上的区分对他是空的。
 *   受限/失效态以状态为主（两轴同构），不重复类型。
 */
const rowA11yLabel = computed(() => {
  if (props.entry.unavailable) return t('continue.unavailable')
  if (restricted.value) return t('continue.restricted')
  return t('continue.open', { type: typeBadge.value })
})

/**
 * ⚠️ **已知失效面（真机取证 2026-10-04 发现，票 #929，未修复）**
 *
 * 现象：同一行在**冷启动 + benchNav `shelf`** 下整行渲染为**暗色底**（深色字几乎不可读），
 * 而 FAB 点进书架 / `/continue` 页均正常。
 * 📌 **受害行数不是固定的 1 行**（2026-10-04 复验修订）：`36-continue-shelf3-short-novel-still-present.png`
 *   里段 3 的**前两行**同时中招（小说行 + 插画行），第三行正常；早期存证只可见首行。
 *   ⇒ 「首个可复用节点先中招」只是**观测到的顺序**，不是「只有首行会坏」——
 *   污染范围随重建竞态的时序变化，**不要**据此认为只有一行需要防护。像素取证：黑区 x 35–1044 / y 1507–1753，
 * 采样色 **(11,15,18) = `#0b0f12`**，等于 `styles/tokens.css:757` 的
 * `.theme-sky.dark --md-surface-container-lowest`——**全仓唯一产出该色值之处**；
 * 而设备实测处于**亮色**（`settings_dark_mode=light`）。⇒ 该行的背景令牌被解析成了
 * 暗色板的值，属节点复用导致的**令牌继承链污染**，非主题切换、非 overlay、非布局漂移。
 *
 * 触发条件：**同一路由被连续 `replace` 重建**。benchNav 在 `BuildConfig.DEBUG` 下
 * 于 1.5/3/4.5/6s 各广播一次 ⇒ 书架实例 ~4.5s 内被 replace 4 次；行根 view 是段 3
 * 的**第一个可复用节点**（裸 `v-for`，无 `<list-item item-key>` 包裹），故先中招。
 *
 * **当前可达性：benchNav 侧不可达**（原四次广播整体在 `BuildConfig.DEBUG` 内，release
 * 移除）⇒ **不是现行生产缺陷**。但 `createGlobalFab` 的 tab 切换同样走
 * `navigate(path, { replace: true })`，**快速连点导航环项**理论上可造出同型竞态——
 * ⚠️ **未验证**（取证时 FAB 路径 4 次试验均未复现）。
 *
 * 建议处置（未实施）：优先给 benchNav 监听器加幂等守卫（同一目标只 replace 一次），
 * 这同时消掉一类真实竞态；**不要**用换背景色绕过（属掩盖，且污染可能波及其它
 * `var(--md-*)` 消费点）。段 3 改用 `<list-item item-key>` 只降低复现概率、不消除成因。
 *
 * 存证：`29-`（首行）、`31-`（首行）、`33-`（首行）、`36-`（**前两行**）、`37-`。
 * **已查官方（2026-10-04）结论：未发现我们漏点，属引擎侧。** 三条线索逐一核过：
 *  ① Lynx 官方 CSS 变量文档明写「未定义时**从父元素继承**」，且 Android 3.2+
 *     `custom-property` Full support ⇒ 本仓的用法（主题类挂根 `<page>` + 整树
 *     `var(--md-*)` 级联）是官方文档规定的标准形态，**观察到的暗色解析与该规定矛盾**。
 *  ② `enableCSSInvalidation`（4.0 文档，失效计算总闸）本仓**未配置** ⇒ 取默认
 *     `true`；且该开关只对「后代 / 兄弟等组合选择器」相关，本仓 `tokens.css`
 *     实测 **0 处组合选择器**（只有 `.theme-X.dark` 复合类选择器）⇒ 该线索不成立。
 *  ③ 官方把 `getElementById().setProperty()` 描述为处理 CSS 变量的主 API，但其
 *     主题示例自带告警「**用 JS 改过变量后就不能再靠 class 改**」⇒ 官方亦承认两条
 *     机制混用脆弱；本仓**只用 class 路线**，未踩该冲突。
 *  同类上游缺陷可佐证：`lynx-stack#3349`「元素连接时缓存了 fallback 样式，
 *  样式表到达后不刷新」——计算值正确但缓存属性陈旧，与本案「令牌解析陈旧」同类。
 *  ⇒ 结论：**不要**为此改我们的令牌/主题架构；正确处置是修 benchNav 的重复 replace。
 *
 * 未闭合环节：充分性未反向确认（恢复该类后 benchNav 路径未取到黑底样本，被 carousel 竞态干扰）；
 * 「令牌为何被染成 dark 值」的 LynxView 内部路径未做到引擎级确证。
 */
// ↑ 本行的 `bg-surface-container-lowest` 是下述失效面的受害面，勿因「换色绕过」而改动

/** 是否可点：受限或失效行均不导航（ADR-0219 §2.5 不静默隐藏，但也不假装能打开） */
const openable = computed(() => !restricted.value && !props.entry.unavailable)


/** 行内状态文案：仅小说有坐标可算时出现（插画浏览历史无此概念，恒不渲染） */
const chapterLabel = computed(() =>
  props.entry.chapterNo === null ? null : t('continue.label.chapter', { n: String(props.entry.chapterNo) }),
)
</script>

<template>
  <view
    class="flex flex-row items-center mx-3 mb-1.5 p-2 bg-surface-container-lowest rounded-[var(--md-shape-medium)]"
    :class="restricted ? '' : pressColor.className"
    :accessibility-element="A11Y_ELEMENT_ENABLED"
    :accessibility-label="rowA11yLabel"
    @tap="openable ? emit('open', entry) : undefined"
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
      v-else-if="entry.coverUrl"
      :id="thumbId"
      :src="proxyImageUrl(entry.coverUrl)"
      height="18.667vw"
      class="w-[18.667vw] rounded-[var(--md-shape-small)]"
      lazy-load
    />
    <view class="flex-1 flex flex-col ml-2.5 min-w-0">
      <text class="text-body-large text-surface-on [max-line:1]">{{ artworkTitle(entry.title) }}</text>
      <view class="flex flex-row items-center mt-0.5">
        <text class="text-body-small text-surface-on-variant [max-line:1]">{{ entry.userName }}</text>
        <!-- 类型徽章（票 #927）：插画行**没有**状态文案，靠这颗徽章与小说行区分 -->
        <text
          class="text-label-small text-on-surface-variant bg-surface-container-highest rounded-[var(--md-shape-full)] px-1.5 ml-1.5"
        >
          {{ typeBadge }}
        </text>
      </view>
      <!-- 作品失效（票 #926 AC #9 / #927 AC #10）：显式标注不可用，**不隐藏该条目**、不移除入口 -->
      <text v-if="entry.unavailable" class="text-label-medium text-error mt-1 [max-line:1]">
        {{ t('continue.unavailable') }}
      </text>
      <!-- 「上次读到 第N话」：仅小说有坐标可算时出现（插画浏览历史无此概念） -->
      <text v-if="chapterLabel && !entry.unavailable" class="text-label-medium text-primary mt-1 [max-line:1]">
        {{ chapterLabel }}
      </text>
    </view>
    <!-- 单条移除（@tap.stop 防卡片导航误触） -->
    <view
      v-if="detailed"
      class="self-center ml-2 h-[10.667vw] px-3 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)]"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="t('continue.remove')"
      @tap.stop="emit('remove', entry)"
    >
      <text class="text-label-large text-primary">{{ t('continue.remove') }}</text>
    </view>
  </view>
</template>

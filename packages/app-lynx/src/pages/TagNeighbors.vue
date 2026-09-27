<script setup lang="ts">
// ─── 标签近邻结果页（ADR-0197 D9/D14 / spec docs/specs/tag-neighbors.md）───
// 数据层：useTagNeighborStore（编排内核在 primitives/collectTagNeighbors，本页只喂依赖、只渲染）。
// 页面骨架对齐 Notifications.vue：PageTopBar（变体 b）+ 首载三态单链（ADR-0150）+ 列表 + 列表尾。
// 三点差异，均有理由：
//   ① 不用 RefreshableList：本功能一次性返回（无分页游标暴露给 UI），下拉刷新语义不存在；
//   ② 不登记 KeepAlive include（defineOptions 仅留 name 供调试，非 tab 页刻意不进白名单，
//      与 Notifications.vue 同款：卸载即释放 → 每次进入 onMounted 重跑 load）；
//   ③ 阶段 2 的「正在放宽标签范围…」可关闭提示已在本页实现（T4/#769），由内核的
//      onPhase2Start 回调驱动在途态、落定后切「已放宽到 N 个标签」；关闭为会话级
//      （stores/tagNeighbor 的 dismissedBroadeningNotices 内存 Set，不写持久化设置）。
//      另消费 phase1SkippedReason 的原因说明（spec user story 30：跳过必须说明，不静默）
//      与 gatedCount 的门控丢弃说明（D16：过滤必须可见）。
// 行模型：buildTagNeighborRows（store 纯函数）——store 只存纯数据载荷，文案一律本页 t() 渲染。
// [lynx:fix] 零 absolute 定位：list-item 内 absolute 子元素会被真机高度测量算进内容高度
//      （CONTEXT.md「遮罩」词条）；徽标/来源/双值/标签全部走文档流。
defineOptions({ name: 'tag-neighbors' })
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { currentParams, navigate, goBack } from '../router'
import { buildTagNeighborRows, useTagNeighborStore, type TagNeighborRow } from '../stores/tagNeighbor'
import {
  dismissBroadeningNotice,
  isBroadeningNoticeDismissed,
} from '../stores/tagNeighbor'
import { useSearchSheetStore } from '../stores/searchSheetStore'
import type { TagNeighborSource } from '../primitives/collectTagNeighbors'
import { deriveFirstLoadView } from '../utils/firstLoadView'
import { TAG_NEIGHBORS_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import PageTopBar from '../components/PageTopBar.vue'
import FeedListFooter from '../components/FeedListFooter.vue'
import SkeletonImage from '../components/SkeletonImage.vue'
import TagPressChip from '../components/TagPressChip.vue'
import { t } from '../i18n'

const store = useTagNeighborStore()

/** 源作品 id（路由参数名 `id`，与 IllustDetail.vue 同款取值） */
const illustId = computed(() => Number(currentParams.value.id ?? 0))

const rows = computed<TagNeighborRow[]>(() => buildTagNeighborRows(store.entries()))
const errorMessage = computed(() => store.errorMessage())

/** 来源码 → 文案（store 零文案；映射在 computed 内 → 语言切换即时生效） */
const tnSource = computed<Record<TagNeighborSource, string>>(() => ({
  author: t('tagNeighbors.source.author'),
  sitewide: t('tagNeighbors.source.sitewide'),
}))

function sourceLabel(source: TagNeighborSource): string {
  return tnSource.value[source]
}

/** 阶段 1 被跳过的原因说明（ADR-0197 D8 / spec user story 30：不静默） */
/**
 * 被门控拦下的条目数说明（ADR-0197 D16「不做静默过滤」/ spec user story 27「而非被悄悄消失」）。
 * 门控谓词由 store 侧三条链式合成（R18/R18G + AI 三态 + 静音标签），命中即从结果中排除——
 * 与客户端其它列表的内容门控语义一致；但**排除必须可见**，否则用户以为「本来就没有」。
 */
const gatedNotice = computed(() =>
  store.gatedCount() > 0 ? t('tagNeighbors.gated', { count: store.gatedCount() }) : '',
)

const skipNotice = computed(() =>
  store.phase1SkippedReason() === 'tooFewTags' ? t('tagNeighbors.skip.tooFewTags') : '',
)

/** 页级首载三态的唯一判定源（ADR-0150）：骨架 / 错误 / 空态 / 内容 */
const view = computed(() =>
  deriveFirstLoadView({
    hasItems: rows.value.length > 0,
    loading: store.status() === 'loading',
    settled: store.status() === 'ready',
    hasError: errorMessage.value !== '',
  }),
)

onMounted(() => {
  void store.load(illustId.value)
})

// 页面非 KeepAlive：卸载即终止在途请求 + 清结果态（重进必重挂重跑；源作品缓存留在 store 共享）
onUnmounted(() => {
  store.reset()
})

/** 点整条 → 作品详情（spec user story 24） */
function openIllust(row: TagNeighborRow): void {
  void navigate(`/illust/${row.illustId}`)
}

/*
 * ─── 缩略图的调用形态（openTagNeighborCallShape）───
 * 真机走查实证（pictelio_ui 模拟器）：首版写成
 *   SkeletonImage(:src, height="12vw", lazy-load, class="w-[12vw] h-[12vw] ...")
 * → 缩略图**全部停在骨架灰块不加载**（shimmer 不消失 = @load 从未触发，且无 @error、无请求日志）。
 * 改回「外层容器给尺寸 + 组件只收 height」后恢复。
 *
 * ⚠️ 关于「为什么这样写」的**准确依据**（code-review B3 更正了初稿的过强论断）：
 *   仓库内 SkeletonImage 共 18 处调用（含本页），其中 6 处**确实**传 class 且工作正常
 *   ——components/{CommentItem,SearchSheet,UserRow}.vue、pages/{IllustDetail,UserHome,WatchLater}.vue。
 *   故「传 class 必然导致骨架卡死」**不是全局规则**，初稿那句「既有调用无一传 class」是错的。
 *   本页采用该形态的**真实依据**只有两条：
 *     ① 本场景的真机实测（上文），改动前后对照；
 *     ② 与工作正常的 list 型调用同款：IllustList.vue / RelatedInlineSection.vue / Ranking.vue
 *        一律「外层 view 给尺寸、组件只收 height」。尺寸交由外层承担，是因为 Lynx 的 view
 *        默认 align-items: stretch，子元素自然满宽；而 CoverImage 以 inline style 设容器高度
 *        （CoverImage.vue 的 resolveSkeletonStyle，issue 138/140 记录了原生 LynxView 下
 *        aspect-ratio 容器内图片百分比高度解析为 0），故 height prop 已足够。
 *   至于 lazy-load：本列表是一次性有界结果（≤~50 条、无分页游标），懒加载是为无限滚动流设计的，
 *   对 bounded 列表无收益；且首版正是它与 class 同时存在时出现问题，去掉二者之一无法单独归因，
 *   故一并去掉并以「与 list 型先例同款」为准。**这是本场景的选择，不是组件用法通则。**
 * 该形态由 TagNeighbors.template.test.ts 的「照既有调用形态」一条钉住，防回潮。
 * 注：以上说明放在脚本块而非模板注释里——模板注释内的类标签字面量会被「剥标签」正则
 * 提前截断，导致注释尾部被误判为模板文本（见该测试「模板区零中文」一条的 textOnly 构造）。
 */

// ─── 阶段 2 兜底提示行（spec user story 14/15；ADR-0197 D15 未决项「UI 形态」的落地）───
// 为什么必须有：阶段 2 会让结果集突然变大，用户有权知道为什么（spec Solution 段）。
// 两态文案：在途说「正在放宽标签范围…」，落定后说「已放宽到 N 个标签」——
// 文案随真实状态切换，不谎报进度。
const broadeningDismissed = ref(isBroadeningNoticeDismissed())
const broadeningNotice = computed(() => {
  if (broadeningDismissed.value) return ''
  // 在途：内核已进入阶段 2（onPhase2Start 同步点亮）——「正在放宽标签范围…」
  if (store.phase2Running()) return t('tagNeighbors.broadening')
  if (!store.phase2Ran()) return ''
  // 落定：只报**成功层**。phase2LastLayer 仅在内核成功取回某层时推进，故全层失败时为 null
  // ——此时**不得**回落成「已放宽到 0 个标签」（code-review 新阻塞 1：那是可达成假文案，
  // 会与整页错误态同时出现并互相矛盾）。全层失败由错误态 + 重试呈现，提示行不掺和。
  const layer = store.phase2LastLayer()
  if (layer === null) return ''
  return t('tagNeighbors.broadeningDone', { count: layer.length })
})

function onDismissBroadening(): void {
  dismissBroadeningNotice()
  broadeningDismissed.value = true
}
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：次级页，返回箭头 + 标题（PageTopBar 变体 b，ADR-0194）；
         a11y 注册表 value 经 props 注入（组件不自持业务 a11y 文案） -->
    <PageTopBar
      back
      :title="t('tagNeighbors.title')"
      :back-a11y-label="TAG_NEIGHBORS_A11Y_LABELS.back"
      :title-a11y-label="TAG_NEIGHBORS_A11Y_LABELS.pageTitle"
      @back="goBack"
    />

    <!-- 阶段 1 跳过原因（不静默降级，AGENTS.md 硬约束 #3 / spec user story 30） -->
    <text v-if="skipNotice" class="text-body-small text-surface-on-variant px-4 pt-2">{{ skipNotice }}</text>

    <!-- 阶段 2 兜底提示行（spec user story 14/15）：**胶囊形态，禁全宽盒**——
         ADR-0123：全宽盒会吞掉内部子元素的点击；且原生不识别 pointer-events，
         关不掉就等于没做。关闭为**会话级**（stores/tagNeighbor 的 dismissedBroadeningNotices
         内存 Set，对齐 watchlistStore.dismissedSeriesIds），**不写持久化设置**
         （spec user story 33：不得新增设置项）。 -->
    <view v-if="broadeningNotice" class="flex flex-row items-center justify-between gap-2 px-4 pt-2">
      <text class="flex-1 text-body-small text-surface-on-variant">{{ broadeningNotice }}</text>
      <view
        class="h-[8.533vw] px-3 rounded-[var(--md-shape-full)] bg-surface-container-highest flex items-center active:opacity-70"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="TAG_NEIGHBORS_A11Y_LABELS.dismissBroadening"
        @tap.stop="onDismissBroadening"
      >
        <text class="text-label-large text-surface-on-variant">{{ t('tagNeighbors.broadeningDismiss') }}</text>
      </view>
    </view>

    <!-- 门控丢弃说明（ADR-0197 D16 / spec user story 27）：内容门控命中即排除，但排除可见 -->
    <text v-if="gatedNotice" class="text-body-small text-surface-on-variant px-4 pt-2">{{ gatedNotice }}</text>

    <!-- 首载三态（ADR-0150）：骨架 → 错误 → 空态 → 内容，互斥单链；不依赖 loading 标志 -->
    <view v-if="view === 'skeleton'" class="w-full flex-1 min-h-0">
      <view
        v-for="n in 6"
        :key="n"
        class="m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]"
      >
        <view class="flex flex-row items-start">
          <view class="shimmer w-[12vw] h-[12vw] rounded-[var(--md-shape-small)]" />
          <view class="flex-1 ml-3">
            <view class="shimmer h-[30rpx] rounded-[var(--md-shape-extra-small)] w-[55%]" />
            <view class="shimmer h-[24rpx] rounded-[var(--md-shape-extra-small)] mt-1.5 w-[40%]" />
          </view>
        </view>
      </view>
    </view>

    <!-- 全阶段失败：整页错误 + 重试（store 在零条目且有 failures 时落到此态） -->
    <view v-else-if="view === 'error'" class="w-full flex-1 min-h-0 flex flex-col items-center justify-center px-8">
      <text class="text-body-small text-error text-center">{{ errorMessage }}</text>
      <view
        class="mt-4 px-6 h-[10.667vw] bg-primary active:bg-state-pressed-primary rounded-[var(--md-shape-full)] flex items-center justify-center"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="TAG_NEIGHBORS_A11Y_LABELS.retry"
        @tap="store.retry()"
      >
        <text class="text-label-large font-medium text-primary-on">{{ t('tagNeighbors.retry') }}</text>
      </view>
    </view>

    <!-- 空态：两阶段均无达标结果（内核已落定，非加载中） -->
    <view v-else-if="view === 'empty'" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <text class="text-body-large text-surface-on-variant">{{ t('tagNeighbors.empty') }}</text>
    </view>

    <list v-else class="w-full flex-1 min-h-0" list-type="single" scroll-orientation="vertical">
      <list-item v-for="row in rows" :key="row.key" :item-key="row.key" class="w-full">
        <!-- [lynx:fix] 单一稳定根 view（list-item 根不得在 v-if/v-else 间交替，Notifications 同款约束） -->
        <view class="w-full">
          <view
            class="flex flex-row items-start m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)] active:bg-layer-pressed-on-surface"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="TAG_NEIGHBORS_A11Y_LABELS.openItem"
            @tap="openIllust(row)"
          >
            <!-- 缩略图：照 IllustList.vue:310 的既有调用形态（外层给尺寸、组件只收 height），
                 不传 class 覆盖、不传 lazy-load。形态依据见脚本块 openTagNeighborCallShape 注释。 -->
            <view class="w-[12vw]">
              <SkeletonImage :src="row.thumb" height="12vw" />
            </view>
            <view class="flex-1 flex flex-col ml-3">
              <!-- 相似度徽标 + 来源标注：M3 assist-chip 形态（类串沿用 IllustTypeBadgeRow.vue 的
                   徽章行）。相似度不是「作品类型徽章」，故页内单独渲染而不扩 IllustTypeBadgeRow 的 props
                   （该组件是跨 3 页共享组件，扩 props 面属他人所有文件，本票不碰） -->
              <view class="flex flex-row items-center">
                <text
                  class="text-label-medium font-medium text-secondary-on-container bg-secondary-container rounded-[var(--md-shape-small)] px-2 py-0.5"
                  >{{ t('tagNeighbors.similarity', { score: row.scorePercent }) }}</text
                >
                <text class="text-label-medium text-surface-on-variant ml-2">{{ sourceLabel(row.source) }}</text>
              </view>
              <text class="text-body-medium text-surface-on mt-1.5 [max-line:1]">{{ row.title }}</text>
              <!-- 可解释性三元组的第三项（spec user story 7：共同标签双值） -->
              <text class="text-label-medium text-surface-on-variant mt-1">{{
                t('tagNeighbors.commonTags', { common: row.common, total: row.total })
              }}</text>
            </view>
          </view>
          <!-- 标签可点（spec user story 25）：沿用既有点标签跳搜索交互（TagPressChip 自带
               @tap.stop 防冒泡，宿主只给 chip-class / text-class 视觉） -->
          <view class="flex flex-row flex-wrap mx-3 mt-1">
            <TagPressChip
              v-for="tag in row.tags"
              :key="tag.name"
              :text="'#' + (tag.translated_name || tag.name)"
              chip-class="h-[8.533vw] px-2 m-1 border border-outline rounded-[var(--md-shape-small)] flex items-center justify-center bg-surface"
              text-class="text-label-large text-surface-on-variant"
              @tap="useSearchSheetStore().openSearch(tag.name)"
            />
          </view>
        </view>
      </list-item>
      <!-- 列表尾三态（FeedListFooter，ADR-0194）：有结果但阶段部分失败 → 错误 + 可点重试
           （ADR-0104 槽位语义：有数据时错误必须可见，不得被内容态吞掉） -->
      <list-item
        v-if="errorMessage"
        :key="'footer'"
        item-key="footer"
        class="w-full h-10 flex items-center justify-center"
        full-span
      >
        <FeedListFooter :error="errorMessage" :retry-text="t('tagNeighbors.retry')" @retry="store.retry()" />
      </list-item>
    </list>
  </view>
</template>

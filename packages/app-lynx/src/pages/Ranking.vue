<script setup lang="ts">
// 榜单页（/ranking）：维度切换 + 日期回看 + R-18 指引（spec docs/specs/ranking.md §5.3/§5.6/§5.7/§6.3；#517/#518）。
// 数据层复用 createMixFeed 单源（createRankingFeed），名次 = 渲染流下标 + 1，跨页保序；
// 受限条目（R18/R18G/AI）保留并盖遮罩、名次不变（本端口径）；本端无日历（Lynx input 不支持日期）。
// 标签静音（ADR-0187 D4 / #732）：先赋名次（预过滤下标+1）后过滤，移除条目留名次空洞（不前移）。
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'ranking' })
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { navigate, goBack } from '../router'
import {
  DEFAULT_RANK_MODE,
  RANK_MODES,
  formatRankingDate,
  jstToday,
  shiftDate,
  type RankModeId,
  type RankingQuery,
} from '@pictelio/ranking-core'
import type { PixivIllust } from '../api/types'
import { thumbUrl } from '../utils/imageUrl'
import { openExternalUrl } from '../utils/nativeUrl'
import { createRankingFeed } from '../primitives/createRankingFeed'
import { assignRanksThenDropMuted, type RankedRow } from '../primitives/rankingRows'
import { isTodayDate } from '../primitives/rankingDate'
import { shouldShowR18Notice } from '../primitives/rankingNotice'
import { deriveFirstLoadView } from '../utils/firstLoadView'
import { useSettingsStore } from '../stores/settingsStore'
import SkeletonImage from '../components/SkeletonImage.vue'
import PageTopBar from '../components/PageTopBar.vue'
import EmptyState from '../components/EmptyState.vue'
import FeedListFooter from '../components/FeedListFooter.vue'
import RestrictOverlay from '../components/RestrictOverlay.vue'
import AiOverlay from '../components/AiOverlay.vue'
import RefreshableList from '../components/RefreshableList.vue'
import AppIcon from '../components/AppIcon.vue'
import { useMotion } from '../composables/motion'
import { t } from '../i18n'

/** 按压反馈载体（ADR-0211 决策 2）：颜色状态层走工具类；透明度/尺寸类走 inline `:style`——`.transition-colors` 的 transition-property 不含 opacity，挂工具类是静默失效。
 *  时长与曲线一律取自 composables/motion.ts（唯一入口），本组件不写时长/曲线字面量；
 *  R1 降级（prefers-reduced-motion）由 useMotion 统一处理，组件内不自行判断偏好。 */
const { pressColor, pressOpacity, reduced: motionReduced } = useMotion()

/** 模式 chip 的 inline 过渡：**唯一一处同一元素同时有两种按压载体**的档位（选中态走
 *  实心底上的 alpha 颜色状态层、未选中态走透明度档，两条分支落在同一元素上）。
 *  inline 的 `transition` 简写会**整体覆盖**工具类的 transition-property，所以这里不能只写
 *  `pressOpacity.transition`——那会把颜色层的过渡一起顶掉（回到 0ms 闪变）。
 *  两个值都出自 motion.ts 同一档（fast + standard），此处只做拼接，不引入任何时长/曲线字面量。 */
const modeChipTransition = computed(() =>
  motionReduced.value ? 'none' : `${pressColor.value.transition}, ${pressOpacity.value.transition}`,
)

/** pixiv 网页端「浏览设置」（开启「显示 R-18 作品」） */
const R18_SETTINGS_URL = 'https://www.pixiv.net/settings/viewing'

const settings = useSettingsStore()
const isRestricted = settings.isRestricted
const isAiRestricted = settings.isAiRestricted

const mode = ref<RankModeId>(DEFAULT_RANK_MODE)
const date = ref<string | null>(null)

// 单源分页 feed：autoStart=false，构造不首载，onMounted 由 refreshFeed 触发
const feed = createRankingFeed({ mode: DEFAULT_RANK_MODE, date: null }, () => sync())

const illusts = ref<PixivIllust[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')
/** 有数据时的分页失败错误文案（底部内联可点重试，ADR-0104 槽位分离；防静默吞错） */
const pageErrorMsg = ref('')
const endOfFeed = ref(false)
/** 首载是否已成功落定（成功含 0 条）——三态判定输入（ADR-0150） */
const settled = ref(false)

/** 页级首载三态（ADR-0150）：骨架 / 错误 / 空态 / 内容 的唯一判定源。
 *  hasItems 用静音过滤后的行数（ADR-0187 / #732：全部被静音移除时同「空」态） */
const view = computed(() =>
  deriveFirstLoadView({
    hasItems: visibleRows.value.length > 0,
    loading: loading.value,
    settled: settled.value,
    hasError: !!errorMsg.value,
  }),
)

/** 渲染行（ADR-0187 D4 / #732）：先按服务端流下标赋名次，后应用静音过滤（移除留名次空洞，
 *  后续名次不前移，ADR-0158 保序精神）；R18/AI 不在此列——保留条目盖遮罩、名次不变 */
const visibleRows = computed<RankedRow<PixivIllust>[]>(() =>
  assignRanksThenDropMuted(illusts.value, settings.isTagMuted),
)

const isToday = computed(() => isTodayDate(date.value))
const dateText = computed(() =>
  t('ranking.dateLong', { ...formatRankingDate(date.value ?? jstToday()) }),
)
/** R-18/R-18G 档且空/报错 → 指引（§5.7），替代普通空态/错误态 */
const showR18Notice = computed(() =>
  shouldShowR18Notice({
    mode: mode.value,
    hasError: !!errorMsg.value,
    serverCount: illusts.value.length,
    loading: loading.value,
  }),
)

function sync() {
  illusts.value = feed.items()
  loading.value = feed.loading()
  loadingMore.value = feed.loadingMore()
  settled.value = feed.settled()
  errorMsg.value = feed.error() ?? ''
  pageErrorMsg.value = feed.pageError() ?? ''
  endOfFeed.value =
    feed.nextUrl() === null && illusts.value.length > 0 && !loading.value && !loadingMore.value
}

/** list 强制重建代（refresh 后 ++，驱动 :key 替换，规避 vue-lynx patch 索引错位 ADR-0107 D4） */
const refreshEpoch = ref(0)

async function refreshFeed() {
  loading.value = true
  errorMsg.value = ''
  pageErrorMsg.value = ''
  await feed.refresh()
  sync()
  refreshEpoch.value++
}

async function loadMore() {
  await feed.fetchMore()
  sync()
}

/** 显式等于今日的日期归一为 null（同请求同缓存键，§5.9） */
function normalizeDate(iso: string): string | null {
  return iso === jstToday() ? null : iso
}

/** 切换维度/日期：重建 feed 实例（作废旧在途响应）+ 重取当前键 */
function applyQuery(next: RankingQuery) {
  feed.setQuery(next)
  illusts.value = []
  settled.value = false
  void refreshFeed()
}

function selectMode(m: RankModeId) {
  if (m === mode.value) return
  mode.value = m
  applyQuery({ mode: m, date: date.value })
}

/** ‹ / ›：以当前日期（或今日）为基准，前进到今日即归一为 null；不越过今日 */
function shiftDay(delta: number) {
  const today = jstToday()
  const next = shiftDate(date.value ?? today, delta)
  if (next > today) return
  const normalized = normalizeDate(next)
  date.value = normalized
  applyQuery({ mode: mode.value, date: normalized })
}

/** 受限条目（R18/R18G/AI）不跳详情，与遮罩口径一致（spec §5.6） */
function openRow(item: PixivIllust) {
  if (isRestricted(item) || isAiRestricted(item)) return
  void navigate(`/illust/${item.id}`)
}

/** 打开 pixiv 网页端「浏览设置」：经原生桥 openUrl（单点 utils/nativeUrl） */
function openPixivSettings() {
  openExternalUrl(R18_SETTINGS_URL, 'Ranking')
}

onMounted(refreshFeed)
onUnmounted(() => feed.dispose())
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：次级页，返回 + 标题（PageTopBar 变体 b，ADR-0194） -->
    <PageTopBar back :title="t('ranking.page.title')" @back="goBack" />

    <!-- 维度 chip 行：窄屏换行展示，不横向滚动 -->
    <view
      class="flex flex-row flex-wrap gap-2 px-4 pt-3"
      accessibility-element
      :accessibility-label="t('ranking.modeListAria')"
    >
      <view
        v-for="m in RANK_MODES"
        :key="m.id"
        accessibility-element
        :accessibility-label="t(m.labelKey)"
        class="h-[10.667vw] px-3 rounded-[var(--md-shape-full)] flex items-center"
        :class="mode === m.id ? 'bg-primary active:bg-layer-pressed-on-primary' : 'bg-surface-container-lowest active:opacity-80'"
        :style="{ transition: modeChipTransition }"
        @tap="selectMode(m.id)"
      >
        <text
          class="text-body-small"
          :class="mode === m.id ? 'font-medium text-primary-on' : 'text-surface-on-variant'"
        >{{ t(m.labelKey) }}</text>
      </view>
    </view>

    <!-- 日期回看行（无日历：仅箭头步进）。T12 收口：`‹ ›` 均已登记为 iconMap 的
         arrow_back / arrow_forward（ADR-0208 决策 3：凡在映射表内的一律算图标位），改走 <AppIcon>。
         无障碍名称仍在各自 tap 目标上：prevDayAria / nextDayAria（ADR-0208 决策 4）。 -->
    <view class="flex flex-row items-center justify-center gap-2 px-4 py-2">
      <view
        class="w-[10.667vw] h-[10.667vw] flex items-center justify-center active:opacity-60"
        :style="{ transition: pressOpacity.transition }"
        accessibility-element
        :accessibility-label="t('ranking.prevDayAria')"
        @tap="shiftDay(-1)"
      >
        <AppIcon name="arrow_back" class="text-surface-on" />
      </view>
      <view class="flex flex-row items-center gap-2">
        <text class="text-body-small text-surface-on-variant">{{ dateText }}</text>
        <text
          v-if="isToday"
          class="text-label-small px-2 py-0.5 rounded-[var(--md-shape-full)] bg-primary text-primary-on"
        >{{ t('ranking.today') }}</text>
      </view>
      <view
        class="w-[10.667vw] h-[10.667vw] flex items-center justify-center active:opacity-60"
        :style="{ transition: pressOpacity.transition }"
        :class="isToday ? 'opacity-40' : ''"
        accessibility-element
        :accessibility-label="t('ranking.nextDayAria')"
        @tap="!isToday && shiftDay(1)"
      >
        <AppIcon name="arrow_forward" class="text-surface-on" />
      </view>
    </view>

    <!-- R-18/R-18G 档空/报错 → 可操作指引（§5.7），替代普通空态/错误态 -->
    <view
      v-if="showR18Notice"
      class="w-full flex-1 min-h-0 flex flex-col items-center justify-center px-8"
    >
      <text class="text-body-large font-medium text-surface-on text-center">{{ t('ranking.r18Notice.title') }}</text>
      <text class="text-body-small text-surface-on-variant text-center mt-2">{{ t('ranking.r18Notice.body') }}</text>
      <view class="flex flex-row gap-2 mt-4">
        <view
          class="px-6 h-[10.667vw] bg-primary active:bg-layer-pressed-on-primary rounded-[var(--md-shape-full)] flex items-center justify-center"
          :class="pressColor.className"
          @tap="openPixivSettings"
        >
          <text class="text-label-large font-medium text-primary-on">{{ t('ranking.r18Notice.action') }}</text>
        </view>
        <view
          class="px-6 h-[10.667vw] bg-surface-container-lowest active:opacity-80 rounded-[var(--md-shape-full)] flex items-center justify-center"
          :style="{ transition: pressOpacity.transition }"
          @tap="refreshFeed"
        >
          <text class="text-label-large font-medium text-surface-on">{{ t('ranking.r18Notice.retry') }}</text>
        </view>
      </view>
    </view>
    <!-- 首载三态（ADR-0150）：骨架 → 错误 → 空态 → 内容，互斥单链；不依赖 loading 标志 -->
    <view v-else-if="view === 'skeleton'" class="w-full flex-1 min-h-0">
      <!-- 骨架屏阴影归零：ADR-0212 决策 7（贴面上限 0，删声明而非改写成 0；底色与真实卡同档不动） -->
      <view
        v-for="n in 8"
        :key="n"
        class="flex flex-row items-center mx-3 my-1.5 p-2.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)]"
      >
        <view class="shimmer w-[8vw] h-[5.333vw] rounded-[var(--md-shape-extra-small)]" />
        <view class="shimmer w-[14vw] h-[14vw] rounded-[var(--md-shape-medium)] ml-2" />
        <view class="flex flex-col ml-3 flex-1">
          <view class="shimmer h-[28rpx] rounded-[var(--md-shape-extra-small)] w-[55%]" />
          <view class="shimmer h-[22rpx] rounded-[var(--md-shape-extra-small)] mt-2 w-[30%]" />
        </view>
      </view>
    </view>
    <view v-else-if="view === 'error'" class="w-full flex-1 min-h-0 flex flex-col items-center justify-center px-8">
      <text class="text-body-small text-error text-center">{{ errorMsg }}</text>
      <view
        class="mt-4 px-6 h-[10.667vw] bg-primary active:bg-layer-pressed-on-primary rounded-[var(--md-shape-full)] flex items-center justify-center"
        :class="pressColor.className"
        @tap="refreshFeed"
      >
        <text class="text-label-large font-medium text-primary-on">{{ t('ranking.page.retry') }}</text>
      </view>
    </view>
    <view v-else-if="view === 'empty'" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <EmptyState icon="leaderboard" :title="t('ranking.page.empty')" :hint="t('ranking.page.emptyHint')" />
    </view>

    <RefreshableList v-else :refresh="refreshFeed" @back-to-top="refreshEpoch++">
    <template #default="{ onScroll }">
    <!-- 间距走 list 官方轴间距属性（:style 对象绑定，attribute 形式 web-core 不响应，ADR-0048） -->
    <list
      :key="refreshEpoch"
      class="w-full h-full"
      list-type="single"
      scroll-orientation="vertical"
      :style="{ listMainAxisGap: '12px', listCrossAxisGap: '12px' }"
      :lower-threshold-item-count="5"
      :scroll-event-throttle="0"
      @scrolltolower="loadMore"
      @scroll="onScroll"
    >
      <list-item v-for="row in visibleRows" :key="row.item.id" :item-key="String(row.item.id)" class="w-full">
        <view
          class="flex flex-row items-center mx-3 p-2.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)]"
          @tap="openRow(row.item)"
        >
          <!-- 名次（ADR-0187 D4 / #732）：预过滤名次渲染，静音移除条目留洞不前移；前三名 primary 高亮 -->
          <text
            class="w-8 text-center text-title-small font-medium"
            :class="row.rank <= 3 ? 'text-primary' : 'text-outline'"
          >{{ row.rank }}</text>
          <!-- 缩略图：list-item 图片必须显式高度（原生 LynxView aspect-ratio 解析为 0，issue #140）；
               受限条目保留并盖遮罩（RestrictOverlay/AiOverlay 流内模式，spec §5.6） -->
          <view
            class="w-[14vw] h-[14vw] shrink-0 rounded-[var(--md-shape-medium)] overflow-hidden ml-2 flex items-center justify-center"
            :class="isRestricted(row.item) || isAiRestricted(row.item) ? 'bg-[var(--md-scrim)]' : ''"
          >
            <RestrictOverlay
              v-if="isRestricted(row.item)"
              :overlay="false"
              :level="row.item.x_restrict === 2 ? 2 : 1"
            />
            <AiOverlay
              v-else-if="isAiRestricted(row.item)"
              :overlay="false"
              :ai-type="row.item.illust_ai_type ?? 0"
            />
            <SkeletonImage v-else :src="thumbUrl(row.item.image_urls)" height="14vw" lazy-load />
          </view>
          <view class="flex flex-col ml-3 flex-1">
            <text class="text-title-small font-medium text-surface-on [max-line:1]">{{ row.item.title }}</text>
            <text class="text-body-small text-surface-on-variant mt-0.5 [max-line:1]">{{ row.item.user.name }}</text>
          </view>
          <!-- 收藏数：★ → star_outline（ADR-0208 决策 3）。⚠️ star 与 star_outline 在官方
               codepoints 文件里同映射 f09a（本子集字体钉在 FILL=0，只登记 outline 形态），
               故此处不可换码点表示「已收藏」——数值本身即语义，无需区分字形。 -->
          <view class="flex flex-row items-center ml-2">
            <AppIcon name="star_outline" :size="3.2" class="text-outline" />
            <text class="text-label-medium text-outline ml-0.5">{{ row.item.total_bookmarks }}</text>
          </view>
        </view>
      </list-item>
      <list-item
        v-if="loadingMore || pageErrorMsg || endOfFeed"
        :key="'footer'"
        item-key="footer"
        class="w-full h-10 flex items-center justify-center"
        full-span
      >
        <!-- 三态文案组件化（FeedListFooter，ADR-0194）；外层 list-item 保留；
             分页失败 = 底部内联可点重试（spec §5.3），重试形态经 retry-text + @retry 保留 -->
        <FeedListFooter
          :loading="loadingMore"
          :error="pageErrorMsg"
          :end="endOfFeed"
          :loading-text="t('ranking.footer.loading')"
          :end-text="t('ranking.footer.end')"
          :retry-text="t('ranking.page.retry')"
          @retry="loadMore"
        />
      </list-item>
    </list>
    </template>
    </RefreshableList>
  </view>
</template>

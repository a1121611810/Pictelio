<script setup lang="ts">
// 插画页推荐 tab 顶部排行榜入口大卡（spec docs/specs/ranking.md §5.1/§5.2；#519）。
// 固定「日榜·今日」：createRankingFeed(DEFAULT_RANK_MODE, null)。lynx 无共享查询缓存
// （spec §6.3 只要求复用 createMixFeed），故本卡与榜单页各自首载，不承诺「进榜单页不二次首屏」。
// 受 rankingEntry 开关控制（宿主 v-if，关闭时不构造数据源）；收起当次隐藏（下拉刷新 / 重进恢复）。
// 样式：Tailwind utility + M3 语义色，无 scoped CSS、无 rem。
defineOptions({ name: 'ranking-entry-card' })
import { computed, onActivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { DEFAULT_RANK_MODE } from '@pictelio/ranking-core'
import type { PixivIllust } from '../api/types'
import { navigate } from '../router'
import { artworkTitle } from '../utils/artworkTitle'
import { proxyImageUrl, thumbUrl } from '../utils/imageUrl'
import { createRankingFeed } from '../primitives/createRankingFeed'
import { isEntryVisible, shouldResetDismissed } from '../primitives/rankingEntryState'
import SkeletonImage from './SkeletonImage.vue'
import AppIcon from './AppIcon.vue'
import { t } from '../i18n'
import { useMotion } from '../composables/motion'
import { useHeroSource } from '../composables/heroTransition'

/** 按压反馈载体（ADR-0211 决策 2）：颜色状态层走工具类；透明度/尺寸类走 inline `:style`——`.transition-colors` 的 transition-property 不含 opacity，挂工具类是静默失效。
 *  时长与曲线一律取自 composables/motion.ts（唯一入口），本组件不写时长/曲线字面量；
 *  R1 降级（prefers-reduced-motion）由 useMotion 统一处理，组件内不自行判断偏好。 */
const { pressColor, pressOpacity } = useMotion()


const props = defineProps<{ refreshEpoch?: number }>()

const feed = createRankingFeed({ mode: DEFAULT_RANK_MODE, date: null }, () => sync())

const illusts = ref<PixivIllust[]>([])
const settled = ref(false)
const error = ref('')
const dismissed = ref(false)

const hero = computed(() => illusts.value[0])
const runners = computed(() =>
  illusts.value.slice(1, 3).map((illust, i) => ({ rank: i + 2, illust })),
)
const heroSrc = computed(() => {
  const urls = hero.value?.image_urls
  return urls ? proxyImageUrl(urls.large || urls.medium || '') : ''
})

function sync() {
  illusts.value = feed.items()
  settled.value = feed.settled()
  error.value = feed.error() ?? ''
}

const visible = computed(() =>
  isEntryVisible({
    dismissed: dismissed.value,
    hasError: !!error.value,
    settled: settled.value,
    itemCount: illusts.value.length,
  }),
)

// 宿主下拉刷新（refreshEpoch 变化）→ 恢复被收起的入口
watch(
  () => props.refreshEpoch,
  (next, prev) => {
    if (!shouldResetDismissed(prev, next)) return
    dismissed.value = false
    // 宿主下拉刷新 → 重取数据并清 error（spec §5.1「刷新容器内」，F5）
    void refresh()
  },
)

// KeepAlive 返回重进（IllustList 在 include 白名单）→ 收起态不跨挂载保留（spec §5.1「重进恢复」）
onActivated(() => {
  dismissed.value = false
  // 首载失败被隐藏后重进应重试（spec §5.1「重进恢复」）；成功态不重复拉取
  if (error.value) void refresh()
})

// 失败可见化（禁静默降级；入口失败即隐藏，不留永久骨架）
watch(error, (msg) => {
  if (msg) console.warn('[RankingEntryCard] 排行榜入口加载失败，隐藏入口:', msg)
})

async function refresh() {
  await feed.refresh()
  sync()
}

// 缩略图 → 大图连续性转场（ADR-0211 决策 12）：本组件只发起**前进**方向的测量。
// ⚠️ 本组件是嵌套在页面里的子组件，**不在**宿主页的层级 ⇒ 覆盖层不能挂在这里
//   （`absolute` 的包含块是最近的定位祖先，不是页面根，坐标会错）。
//   返回方向由宿主页（IllustList，本组件的唯一宿主）的 useHeroSource 消费同一个模块态完成。
// 榜首大卡的 tap 是 openAll（进 /ranking 榜单页），不是详情，故不接。
const heroTransition = useHeroSource()

function openDetail(id: number) {
  heroTransition.begin(id) // 发起矩形测量（不等待，决策 12 机制 1：不给导航加可见延迟）
  void navigate(`/illust/${id}`)
}

function openAll() {
  void navigate('/ranking')
}

onMounted(refresh)
onUnmounted(() => feed.dispose())
</script>

<template>
  <!-- mx-3/mt-3 = 榜单卡自身留白；pb-3 = 榜单卡与下方列表之间的**分区间距**（票 #920 问题 3）。
       缺它时榜单卡下缘直接贴住列表首行，视觉上像两张卡粘连。
       为什么用 pb-3 而非在列表侧补上边距：列表是 `<list>`（ADR-0162 平台事实——
       瀑布流 list-item 的插入/移除/替换分别导致静默丢弃/留空位/错位），
       往 list 内部加间距要动列表结构，风险远高于在本容器上加一条 padding。
       pb-3 复用与 mx-3/mt-3 同一档位，口径统一（12dp）。 -->
  <view v-if="visible" class="mx-3 mt-3 pb-3">
    <!-- 有数据：榜首编辑大卡（第 1 名全幅背景 + 信息叠加 + 右侧 2/3 名竖排 + 收起） -->
    <view
      v-if="illusts.length > 0"
      class="relative w-full h-[62vw] rounded-[var(--md-shape-large)] overflow-hidden"
      accessibility-element
      :accessibility-label="t('ranking.entry.stripAria')"
      @tap="openAll"
    >
      <SkeletonImage v-if="heroSrc" :src="heroSrc" height="62vw" lazy-load />
      <view
        class="absolute inset-x-0 bottom-0 h-[36vw]"
        :style="{ background: 'var(--md-scrim-overlay)' }"
      />
      <!-- 左下信息叠加：第 1 名徽章 / 榜名·今日 / 标题 / 作者
           [#891] 渐变罩 h-[36vw](@375 = 135dp)，信息块 bottom-3 起步，按各档行高算
           叠**纯白图**（最坏情况）时白字对比度（`--md-scrim-overlay` 解析值）：
             「日榜 · 今日」pos 0.244 ⇒ **3.75（不达 AA 4.5）** ← 本卡真正的破口
             标题        pos 0.170 ⇒ 5.43（过线，但余量仅 0.93）
             作者        pos 0.074 ⇒ 9.16
           可见**「过没过线」取决于文字恰好落在盒高的哪一段**——这正是要拿掉的东西：
           徽章行、标题、作者三行的余量相差 5 倍，只要块内多一行（更长榜名、换行、换字号档）
           就会整片滑下去。百分比渐变随盒高归一、与内容位置无关 ⇒ 改色标治不了「换图就失效」。
           故整块加**稳定不透明底色**（inverse-surface / inverse-on-surface 对，14 套色板最差 10.12（暗色 sky 板），亮色 11.46–11.65 / 暗色 10.12–10.22，全部 ≥ 4.5。按 WCAG 相对亮度公式对 tokens.css 14 套色板实算。），
           渐变退回「与作品图融合」的职责。 -->
      <view class="absolute left-3 bottom-3 right-[30vw] bg-inverse-surface rounded-lg px-3 py-2">
        <view class="flex flex-row items-center gap-1.5">
          <view class="px-2 py-0.5 rounded-[var(--md-shape-full)] bg-primary">
            <text class="text-body-small font-medium text-primary-on">{{ t('ranking.entry.firstBadge') }}</text>
          </view>
          <text class="text-body-small text-inverse-on-surface">{{ t('ranking.mode.daily') }} · {{ t('ranking.today') }}</text>
        </view>
        <text class="text-title-medium font-medium text-inverse-on-surface mt-1.5 [max-line:1]">{{ artworkTitle(hero?.title) }}</text>
        <text class="text-body-small text-inverse-on-surface [max-line:1]">{{ hero?.user.name }}</text>
      </view>
      <!-- 右侧竖排 2/3 名 +「全部 + › 图标」 -->
      <view class="absolute right-2.5 bottom-3 flex flex-col gap-2">
        <view
          v-for="e in runners"
          :key="e.illust.id"
          class="relative w-[16vw] h-[16vw] rounded-[var(--md-shape-medium)] overflow-hidden"
          :id="heroTransition.sourceId(e.illust.id)"
          accessibility-element
          :accessibility-label="t('ranking.entry.itemAria', { rank: e.rank, title: artworkTitle(e.illust.title) })"
          @tap.stop="openDetail(e.illust.id)"
        >
          <SkeletonImage :src="thumbUrl(e.illust.image_urls)" height="16vw" lazy-load />
          <view class="absolute left-0 bottom-0 px-1 rounded-tr-[var(--md-shape-medium)] bg-primary">
            <text class="text-body-small font-medium text-primary-on">{{ e.rank }}</text>
          </view>
        </view>
        <view
          class="w-[16vw] flex flex-row items-center justify-center"
          accessibility-element
          :accessibility-label="t('ranking.entry.viewAllAria')"
          @tap.stop="openAll"
        >
          <text class="text-body-small text-white opacity-90">{{ t('ranking.entry.viewAll') }}</text>
          <AppIcon name="arrow_forward" :size="3.2" class="text-white opacity-90" />
        </view>
      </view>
      <!-- 收起（当次隐藏） -->
      <view
        class="absolute right-2 top-2 w-[10.667vw] h-[10.667vw] flex items-center justify-center rounded-[var(--md-shape-full)] bg-[var(--md-scrim)] active:opacity-80"
        :style="{ transition: pressOpacity.transition }"
        accessibility-element
        :accessibility-label="t('ranking.entry.collapseAria')"
        @tap.stop="dismissed = true"
      >
        <!-- 收起（当次隐藏）。图标位经 AppIcon（ADR-0208 决策 3）：close，
             字号 title-medium=32rpx=16sp=4.2667vw → :size="4.2667" -->
        <AppIcon name="close" :size="4.2667" class="text-white" />
      </view>
    </view>
    <!-- 无数据：首载骨架（用户故事 24：入口无数据时显示骨架而非空白） -->
    <view v-else class="w-full h-[62vw] rounded-[var(--md-shape-large)] bg-surface-container-lowest shimmer" />
  </view>
</template>

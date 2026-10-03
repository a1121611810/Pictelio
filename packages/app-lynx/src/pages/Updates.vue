<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'updates' })
import { ref, computed, onMounted, onActivated, onUnmounted } from 'vue'
import { navigate } from '../router'
import { t } from '../i18n'
import { proxyImageUrl } from '../utils/imageUrl'
import { artworkTitle } from '../utils/artworkTitle'
import { openNovel } from '../utils/novelNavigation'
import { useHeroSource } from '../composables/heroTransition'
import { loadFollow } from '../api/illust'
import { loadWatchlistNovels } from '../api/novel'
import { isWatchlistSeriesMasked, type PixivIllust, type WatchlistSeries, type PixivNotificationItem } from '../api/types'
import {
  useNotificationsList,
  countUnreadNotifications,
  flattenNotifications,
  loadLastReadMs,
} from '../stores/notificationStore'
import { notificationPlainText } from '../utils/notificationText'
import { useGlobalFabStore } from '../stores/globalFab'
import { useTopInsetSpacer } from '../composables/useTopInsetSpacer'
import { createGenerationGate } from '../primitives/generationGate'
import { useUsageMetricsStore } from '../stores/usageMetrics'
import { type UpdateSectionKey } from '../primitives/usageMetrics'
import { useMotion } from '../composables/motion'
import SkeletonImage from '../components/SkeletonImage.vue'
import AppIcon from '../components/AppIcon.vue'
import FabAllowanceSpacer from '../components/FabAllowanceSpacer.vue'
import { A11Y_ELEMENT_ENABLED, UPDATES_A11Y_LABELS } from '../utils/accessibility'

// ─── 「更新」页（/updates）[维度重构 2026-10-03] ───
// 三段聚合面：**一页答完「有没有更新」**。
// 改造前的结构问题（三件回答同一问题的事分散三处）：
//   · 关注流 /following —— 实现完整但**零用户入口**（仅 benchNav 深链）
//   · 追更 /watchlist  —— 唯一入口 Me.vue
//   · 通知 /notifications —— Me.vue + 推荐页顶栏「补位」（同一功能第二条路）
// 做成三个二级 tab 会逼用户逐个点开检查；本页纵向三段，一滚答完。
// 外部依据：LINE WEBTOON 官方「我的漫畫」把「最近看過 + 我的最愛 + 下載」收在一个面里。
//
// ⚠️ **三段各自独立失败、互不牵连**：一段接口失败只让该段显示错误，其余两段照常渲染
//   （禁静默降级：测试硬约束 #3 —— 失败必须可见，不能假装是空）。
const topInsetSpacer = useTopInsetSpacer()
// 统一入场出口（listItemStaggerContract L2）：scroll-view 消费页的分段卡片必须走这一个出口，
// 逐页自写动画会在多页之间漂移（该门禁的原始动机）。
const { listItemStyle } = useMotion()
// 即时导航硬约束 #3：代际闸，保证「后发者胜」——见 primitives/generationGate.ts
const gate = createGenerationGate()

/** 本地度量读点（spec §4 P0.5「空段出现率」）：记录「该段本次被观察到 + 是否为空」。
 *  失败不得影响页面渲染（度量是旁路，不是主链路）。
 *  ⚠️ `name` 收窄为 UpdateSectionKey：段名是**度量键空间**的一部分，与高级页面板读出的
 *     键同源于 primitives/usageMetrics.ts 的 UPDATE_SECTION_METRIC_ROWS。
 *     收窄成联合类型后，写错段名在 `pnpm check` 转红，而不是静默多出一个
 *     「分母永不增长的桶」（那样面板上该段会永久显示「暂无数据」）。 */
function noteSection(name: UpdateSectionKey, count: number): void {
  try {
    useUsageMetricsStore().recordSectionObserved(name, count === 0)
  } catch (e) {
    console.warn('[updates] 空段度量记录失败（不影响渲染）', e)
  }
}

/** 每段预览条数：聚合面只给"一眼看到有更新"，完整列表在各自的次级页 */
const PREVIEW_N = 3

/**
 * 关注段「确实为空」时的两个出口（spec §7「关注更新空时引导去作者页/榜单」）。
 *
 * 为什么是这两条路：`/following` 是**关注流的来源**（关注的作者列表，也是用户唯一
 * 能新增关注的地方），`/ranking` 是**没关注任何人时的替代内容**（先看榜单再决定关注谁）。
 * 两者合起来覆盖了「去补关注」与「先逛逛」两种意图；只给前者会把还没决定关注谁的用户堵死。
 *
 * ⚠️ **刻意不放 `/illusts` / `/novels`**：空态里推荐「去看插画」答非所问——用户问的是
 *   「我的更新在哪」，不是「有没有插画」。
 */
const FOLLOWING_EMPTY_ACTIONS = [
  { to: '/following', label: t('updates.emptyFollowingToFollowing'), a11yLabel: UPDATES_A11Y_LABELS.emptyFollowingToFollowing },
  { to: '/ranking', label: t('updates.emptyFollowingToRanking'), a11yLabel: UPDATES_A11Y_LABELS.emptyFollowingToRanking },
] as const

// ─── 段 1：关注更新（关注作者的新作品）───
const following = ref<PixivIllust[]>([])
const followingError = ref('')

async function loadFollowing(token: number): Promise<void> {
  followingError.value = ''
  try {
    const r = await loadFollow('public')
    // 硬约束 #3：在飞旧响应落地即作废（跨页面快速切换时，旧的慢请求不得覆盖新数据）
    if (!gate.isCurrent(token)) return
    following.value = r.illusts.slice(0, PREVIEW_N)
    noteSection('following', following.value.length)
  } catch (e) {
    console.warn('[updates] 关注流加载失败', e)
    if (!gate.isCurrent(token)) return
    followingError.value = t('error.fallback.loadFailed')
  }
}

// ─── 段 2：追更新（小说系列有新话次）───
const watchlist = ref<WatchlistSeries[]>([])
const watchlistError = ref('')

async function loadWatchlist(token: number): Promise<void> {
  watchlistError.value = ''
  try {
    const r = await loadWatchlistNovels()
    if (!gate.isCurrent(token)) return
    watchlist.value = r.series.slice(0, PREVIEW_N)
    noteSection('watchlist', watchlist.value.length)
  } catch (e) {
    console.warn('[updates] 追更列表加载失败', e)
    if (!gate.isCurrent(token)) return
    watchlistError.value = t('error.fallback.loadFailed')
  }
}

// ─── 段 3：通知（Pixiv 通知中心，含未读计数）───
// ⚠️ 刻意**不走** useNotificationsList()（TanStack 无限分页）：本页只要首屏 N 条预览，
//   走 composable 会顺带拉起分页缓存与 queryClient 依赖，而另两段都是直调 API ——
//   三段保持同构（都直调），失败/空态的处理也就能用同一套写法。
const notificationItems = ref<PixivNotificationItem[]>([])
const unreadCount = ref(0)
const notificationError = ref('')

const notificationRows = computed(() =>
  notificationItems.value
    .slice(0, PREVIEW_N)
    .map((n) => ({
      id: n.id,
      // ⚠️ 必须经 notificationPlainText 纯文本化（ADR-0188 D4）。content.text 是
      // **含 HTML 标签的片段**（如 `<b>jie geng</b>关注了你。`），lynx 无 HTML 渲染能力，
      // 直插会把标签字面量泄漏给用户 —— 模拟器实测（emulator-5554 / 2026-10-03）确认过。
      // 与 pages/Notifications.vue:146 保持同一口径（tests/updatesNotificationText.test.ts 钉住）。
      //
      // 字段名刻意用 `text` 而非 `title`：本行渲染的是**通知文案**，不是作品标题。
      // 叫 `title` 会命中 tests/artworkTitleGate 的未归一化门禁（Pixiv 的 "no title" 哨兵）。
      text: notificationPlainText(n.content?.text),
      // 同 ②：created_datetime 运行期可能为 null，不能直接 .slice
      at: n.created_datetime ? n.created_datetime.slice(0, 10) : '',
    })),
)

/**
 * 通知段：**走 store 的缓存层**（`useNotificationsList` 与 Notifications.vue、`refreshUnreadBadge`
 * 共用同一个 query 键），不再直调 `api/notification`。
 * ⚠️ 修的是 AGENTS.md「即时导航硬约束」第 4 条（跨组件共享数据用全局缓存/去重层）：
 *   第二轮 review 指出本段绕过了 store，而 App.vue 冷启动的 `refreshUnreadBadge()` 已在填同一份
 *   缓存 ⇒ 直调会**二次打同一接口**，且「角标数」与「本页预览」可能来自两次不同响应。
 * 读缓存而非再次请求，是同一条约束的正向做法。
 */
const notificationsQuery = useNotificationsList()

async function loadNotifications(token: number): Promise<void> {
  notificationError.value = ''
  try {
    // await 让出执行权（refetch 若在飞），故 await 后必须复校代际（硬约束 #3）
    const res = await notificationsQuery.refetch()
    if (!gate.isCurrent(token)) return
    // 用 store 自带的 flattenNotifications：它带 `p.notifications ?? []` 空值防护
    notificationItems.value = flattenNotifications(res.data?.pages ?? [])
    noteSection('notifications', notificationItems.value.length)
    // ⚠️ 此处**含第二个 await**（loadLastReadMs 读 prefs，走原生 callback），会让出执行权。
    //   代际可能在此期间被新一轮 refresh() 推进 ⇒ 必须在 await **之后**再复校一次，
    //   否则旧代会用旧数据盖掉新代的未读数（硬约束 #3：异步旧响应覆盖新状态）。
    const lastReadMs = await loadLastReadMs()
    if (!gate.isCurrent(token)) return
    // 未读口径与通知页一致：created_datetime 晚于本地已读时间戳（等值不计）
    unreadCount.value = countUnreadNotifications(notificationItems.value, lastReadMs)
  } catch (e) {
    console.warn('[updates] 通知加载失败', e)
    if (!gate.isCurrent(token)) return
    notificationError.value = t('error.fallback.loadFailed')
  }
}

const loading = ref(false)
/** 一次刷新 = 取一代号 + 并发三段。落地前各自校验（硬约束 #3）。 */
async function refresh(): Promise<void> {
  const token = gate.next()
  loading.value = true
  try {
    await Promise.all([loadFollowing(token), loadWatchlist(token), loadNotifications(token)])
  } finally {
    // 只由本代收尾：旧代的 finally 不得把新代的 loading 提前拉下
    if (gate.isCurrent(token)) loading.value = false
  }
}

// ─── 段内跳转 ───
// 缩略图 → 大图连续性转场（ADR-0211 决策 12）：本页在 KeepAlive 白名单内 ⇒ 前进/返回两向都成立。
// 门禁 tests/heroTransitionWiring：「扫到一处 `/illust/` 导航，就必须能在同一文件里找到
// begin() 发起 + sourceId() 缩略图 id 绑定 + 真的 import 本模块」——三缺一即红。
const heroTransition = useHeroSource({
  resolveSrc: (id: number) => {
    const it = following.value.find((i) => i.id === id)
    if (!it) return ''
    return proxyImageUrl(it.image_urls.large || it.image_urls.medium || it.image_urls.square_medium || '')
  },
})

function openIllust(id: number): void {
  heroTransition.begin(id) // 发起矩形测量（不等待，决策 12 机制 1：不给导航加可见延迟）
  void navigate(`/illust/${id}`)
}
function openNovelById(id: number): void {
  openNovel(id)
}

// ─── 全局放射 FAB 桥（ADR-0120）───
let unreg: (() => void) | undefined
onMounted(() => {
  unreg = useGlobalFabStore().usePage('updates', { refresh })
  // ⚠️ 此处**不**再调 refresh()：本页在 App.vue KeepAlive include 内，首挂载时
  //   onActivated 与 onMounted **都会**触发（Me.vue:374-377 已白纸黑字记过）。
  //   两处都调 ⇒ 首次进入并发两轮 Promise.all（6 次裸请求）。只留 onActivated 一处。
})
onUnmounted(() => {
  unreg?.()
  gate.invalidate() // 卸载即作废所有在飞响应
})
// KeepAlive 页面：首挂载 + 每次从次级页返回都刷新（更新类页面的核心价值就是"新"）
onActivated(() => {
  void refresh()
})
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <view :style="{ height: topInsetSpacer + 'px' }" />

    <!-- 页内标题（**不是顶栏**）。
         ⚠️ ADR-0216 §2.1：四个根页一律不画实体顶栏（<PageTopBar> 是带底色的顶栏行，
            插画/小说页在 #920 后已整体移除）。本页因此**不用 PageTopBar**。
            但 ADR 同时把"页面定位信息"交给「全局放射 FAB + 页内子 tab」——
            本页没有子 tab，只剩 FAB 一个小图标，定位信息过薄。
            ⇒ 取折中：流内一个标题 <text>（无底色条、不占顶栏语义），
              既不违反"去实体顶栏"，又保留必要的定位信息。 -->
    <text
      class="text-title-large font-medium text-surface-on px-4 mt-2 [max-line:1]"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="UPDATES_A11Y_LABELS.pageTitle"
      >{{ t('updates.title') }}</text
    >

    <scroll-view class="w-full flex-1" scroll-orientation="vertical">
      <!-- ══ 段 1：关注更新 ══ -->
      <view class="w-full">
        <view class="flex flex-row items-center justify-between px-3 mt-3 mb-1.5" :style="listItemStyle(0)">
          <text class="text-title-small font-medium text-surface-on">{{ t('updates.section.following') }}</text>
          <view
            class="h-[8vw] px-2.5 flex items-center justify-center"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="UPDATES_A11Y_LABELS.viewAllFollowing"
            @tap="navigate('/following')"
          >
            <text class="text-label-large text-primary">{{ t('updates.viewAll') }}</text>
            <AppIcon name="arrow_forward" :size="3.2" class="text-primary" />
          </view>
        </view>
      </view>
      <view v-for="it in following" :key="`f-${it.id}`" class="w-full">
        <view
          class="flex flex-row items-center mx-3 mb-1.5 p-2 bg-surface-container-lowest rounded-[var(--md-shape-medium)]"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="UPDATES_A11Y_LABELS.openIllust"
          @tap="openIllust(it.id)"
        >
          <SkeletonImage
            v-if="it.image_urls && (it.image_urls.medium || it.image_urls.square_medium)"
            :id="heroTransition.sourceId(it.id)"
            :src="proxyImageUrl(it.image_urls.medium || it.image_urls.square_medium)"
            height="18.667vw"
            class="w-[18.667vw] rounded-[var(--md-shape-small)]"
            lazy-load
          />
          <view class="flex-1 flex flex-col ml-2.5 min-w-0">
            <text class="text-body-large text-surface-on [max-line:1]">{{ artworkTitle(it.title) }}</text>
            <text class="text-body-small text-surface-on-variant mt-0.5 [max-line:1]">{{ it.user.name }}</text>
          </view>
        </view>
      </view>
      <!-- 空段不隐藏：M3/ HIG「If a section is empty, explain why」——
           同时也告诉用户"这个功能存在、只是现在没有内容" -->
      <!-- 首载骨架（硬约束 #1「先渲染页面框架（含骨架屏占位）」）。
           ⚠️ 此前 `loading` 是死状态：请求在飞时 `xxx.length === 0` 同样成立，
           于是首屏直接把"还在请求"渲染成 `暂无`（= "服务端没有内容"），是**事实性误导**。
           判据用 `loading && 空`，两者都满足才出骨架；加载失败走下面的 error 分支（#3 禁静默降级）。 -->
      <view v-if="loading && following.length === 0" class="w-full">
        <view class="mx-3 mb-1.5 px-2.5 py-3 rounded-[var(--md-shape-medium)] bg-surface-container-low">
          <view class="shimmer h-[28rpx] w-[45%] rounded-[var(--md-shape-extra-small)]" />
          <view class="shimmer h-[28rpx] w-[70%] rounded-[var(--md-shape-extra-small)] mt-2" />
        </view>
      </view>
      <view v-else-if="following.length === 0" class="w-full">
        <!-- ⚠️ 分两种空：①**加载失败**（followingError 非空）⇒ 只报错误，不给「去关注作者」——
             失败时推荐「去关注」是误导（真正的问题是取不到数据，不是没关注）。
             ②**确实为空** ⇒ spec §7 承诺的「关注更新空时引导去作者页/榜单」：
             此前只显示通用「暂无」，用户既不知道为什么空、也没有下一步可点。 -->
        <view class="mx-3 mb-1.5 px-2.5 py-2.5 rounded-[var(--md-shape-medium)] bg-surface-container-low">
          <text class="text-body-small text-surface-on-variant">
            {{ followingError || t('updates.emptyFollowingTitle') }}
          </text>
          <text v-if="!followingError" class="text-body-small text-surface-on-variant mt-1">
            {{ t('updates.emptyFollowingHint') }}
          </text>
          <view v-if="!followingError" class="flex flex-row flex-wrap gap-2 mt-2.5">
            <view
              v-for="a in FOLLOWING_EMPTY_ACTIONS"
              :key="a.to"
              class="h-[8vw] px-3 flex items-center justify-center rounded-[var(--md-shape-full)] bg-primary"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="a.a11yLabel"
              @tap="navigate(a.to)"
            >
              <text class="text-label-large text-primary-on">{{ a.label }}</text>
            </view>
          </view>
        </view>
      </view>

      <!-- ══ 段 2：追更新 ══ -->
      <view class="w-full">
        <view class="flex flex-row items-center justify-between px-3 mt-3 mb-1.5" :style="listItemStyle(1)">
          <text class="text-title-small font-medium text-surface-on">{{ t('updates.section.watchlist') }}</text>
          <view
            class="h-[8vw] px-2.5 flex items-center justify-center"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="UPDATES_A11Y_LABELS.viewAllWatchlist"
            @tap="navigate('/watchlist')"
          >
            <text class="text-label-large text-primary">{{ t('updates.viewAll') }}</text>
            <AppIcon name="arrow_forward" :size="3.2" class="text-primary" />
          </view>
        </view>
      </view>
      <view v-for="s in watchlist" :key="`w-${s.id}`" class="w-full">
        <!-- ⚠️ 被屏蔽/下架的系列（isWatchlistSeriesMasked：title 为空 + url/mask_text 非空 + user.id=0）
             只读展示 mask_text，**不可点** —— 沿用 Watchlist.vue 的同款处理。
             漏这个判定的后果不是"显示难看"，而是**整页白屏**（见下方日期空值防护的注释）。 -->
        <view
          v-if="isWatchlistSeriesMasked(s)"
          class="flex flex-row items-center mx-3 mb-1.5 p-2 bg-surface-container-lowest rounded-[var(--md-shape-medium)]"
        >
          <view class="flex-1 flex flex-col min-w-0">
            <text class="text-body-medium text-outline">{{ s.mask_text }}</text>
          </view>
        </view>
        <view
          v-else
          class="flex flex-row items-center mx-3 mb-1.5 p-2 bg-surface-container-lowest rounded-[var(--md-shape-medium)]"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="UPDATES_A11Y_LABELS.openNovel"
          @tap="openNovelById(s.latest_content_id)"
        >
          <SkeletonImage
            v-if="s.url"
            :src="proxyImageUrl(s.url)"
            height="18.667vw"
            class="w-[18.667vw] rounded-[var(--md-shape-small)]"
            lazy-load
          />
          <view class="flex-1 flex flex-col ml-2.5 min-w-0">
            <text class="text-body-large text-surface-on [max-line:1]">{{ artworkTitle(s.title) }}</text>
            <!-- ⚠️⚠️ `latest_content_date` 的**运行期值可能为 null**（类型声明它是 string，
                 两者不一致）。模板里直接 `.slice(0,10)` 会在数据到达时抛 TypeError，
                 而 **vue-lynx 的渲染异常会让整页变空白**（不是局部降级）——
                 本页最初的真机表现就是：首屏空、连标题都没有。Watchlist.vue 早有
                 `v-if="item.latest_content_date"` 防护，这里必须同款，不能凭类型声明省掉。 -->
            <text v-if="s.latest_content_date" class="text-body-small text-surface-on-variant mt-0.5 [max-line:1]">
              {{ s.latest_content_date.slice(0, 10) }} · {{ t('updates.newCount', { count: s.published_content_count }) }}
            </text>
          </view>
        </view>
      </view>
      <view v-if="loading && watchlist.length === 0" class="w-full">
        <view class="mx-3 mb-1.5 px-2.5 py-3 rounded-[var(--md-shape-medium)] bg-surface-container-low">
          <view class="shimmer h-[28rpx] w-[45%] rounded-[var(--md-shape-extra-small)]" />
          <view class="shimmer h-[28rpx] w-[70%] rounded-[var(--md-shape-extra-small)] mt-2" />
        </view>
      </view>
      <view v-else-if="watchlist.length === 0" class="w-full">
        <view class="mx-3 mb-1.5 px-2.5 py-2.5 rounded-[var(--md-shape-medium)] bg-surface-container-low">
          <text class="text-body-small text-surface-on-variant">
            {{ watchlistError || t('updates.empty') }}
          </text>
        </view>
      </view>

      <!-- ══ 段 3：通知 ══ -->
      <view class="w-full">
        <view class="flex flex-row items-center justify-between px-3 mt-3 mb-1.5" :style="listItemStyle(2)">
          <view class="flex flex-row items-center">
            <text class="text-title-small font-medium text-surface-on">{{ t('updates.section.notifications') }}</text>
            <view
              v-if="unreadCount > 0"
              class="ml-2 min-w-[5vw] h-[5vw] px-1.5 rounded-full bg-primary flex items-center justify-center"
            >
              <text class="text-label-small text-primary-on">{{ unreadCount }}</text>
            </view>
          </view>
          <view
            class="h-[8vw] px-2.5 flex items-center justify-center"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="UPDATES_A11Y_LABELS.viewAllNotifications"
            @tap="navigate('/notifications')"
          >
            <text class="text-label-large text-primary">{{ t('updates.viewAll') }}</text>
            <AppIcon name="arrow_forward" :size="3.2" class="text-primary" />
          </view>
        </view>
      </view>
      <view v-for="n in notificationRows" :key="`n-${n.id}`" class="w-full">
        <view
          class="flex flex-row items-center mx-3 mb-1.5 px-2.5 py-2.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)]"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="UPDATES_A11Y_LABELS.openNotification"
          @tap="navigate('/notifications')"
        >
          <text class="flex-1 text-body-medium text-surface-on [max-line:1]">{{ n.text }}</text>
          <text v-if="n.at" class="text-body-small text-surface-on-variant ml-2">{{ n.at }}</text>
        </view>
      </view>
      <view v-if="loading && notificationRows.length === 0" class="w-full">
        <view class="mx-3 mb-1.5 px-2.5 py-3 rounded-[var(--md-shape-medium)] bg-surface-container-low">
          <view class="shimmer h-[28rpx] w-[45%] rounded-[var(--md-shape-extra-small)]" />
          <view class="shimmer h-[28rpx] w-[70%] rounded-[var(--md-shape-extra-small)] mt-2" />
        </view>
      </view>
      <view v-else-if="notificationRows.length === 0" class="w-full">
        <view class="mx-3 mb-1.5 px-2.5 py-2.5 rounded-[var(--md-shape-medium)] bg-surface-container-low">
          <text class="text-body-small text-surface-on-variant">
            {{ notificationError || t('updates.empty') }}
          </text>
        </view>
      </view>

      <FabAllowanceSpacer />
    </scroll-view>
  </view>
</template>

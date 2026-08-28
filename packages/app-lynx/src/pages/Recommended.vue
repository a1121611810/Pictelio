<script setup lang="ts">
// 综合推荐页（/recommended）：插画 + 小说混合，改**单卡 swipe 轮播**（ADR-0115）。
// 数据层由 createMixFeed（merge:'time-merge'）承载：两路（插画/小说）按 create_date 时间交叉
// 合并成增长流 + fetchMore（双防抖/竞态代/去重/分批渲染/15s 超时）；页面只做 ref 快照桥接 + 渲染。
// 渲染层 = CarouselSwiper（自研 swipe，**后台线程**触摸 + Vue 响应式 :style 绑定 translateX + px 吸附，
// 因官方「主线程脚本」在本项目原生 LynxView 整块空白、判定不可用，ADR-0115 T5 修订）——一滑页一个
// 作品，沉浸式全 bleed 大图卡，信息叠底部渐变 scrim。受限条目经 visibleItems 过滤（数据层仍加载，
// 开关切换时 computed 重算即可，无需重请求）。刷新 = 单个 FAB（icon ⟳，animate-spin 旋转）。
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'recommended' })
import { ref, computed, onMounted, onActivated, onUnmounted, watch } from 'vue'
import { navigate } from '../router'
import { loadRecommended, loadNext } from '../api/illust'
import { loadRecommendedNovels, loadNovelNext } from '../api/novel'
import type { PixivIllust, PixivNovel } from '../api/types'
import { createMixFeed, type MixFeedItem, type MixFeedSource } from '../primitives/createMixFeed'
import { proxyImageUrl } from '../utils/imageUrl'
import { isRestricted } from '../stores/settingsStore'
import { isLoggedIn } from '../stores/authStore'
import CarouselSwiper from '../components/CarouselSwiper.vue'
import RecommendedCover from '../components/RecommendedCover.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import IllustTypeBadgeRow from '../components/IllustTypeBadgeRow.vue'
import NavigationBar from '../components/NavigationBar.vue'
import { NAV_TABS, type NavTab } from '../components/navTabs'
import { RECOMMENDED_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'

// 底部导航 tabs：数据源 = 共享 NAV_TABS（推荐/插画/小说/我的）。
// me tab 的 a11yLabel 用 RECOMMENDED_A11Y_LABELS.openMe（=「我的」，与共享值一致）。
const navTabs: NavTab[] = NAV_TABS.map((t) =>
  t.name === 'me' ? { ...t, a11yLabel: RECOMMENDED_A11Y_LABELS.openMe } : t,
)

function onNavSelect(tab: NavTab) {
  if (tab.name === 'recommended') return
  void navigate(tab.path, { replace: true })
}

// ─── 时间合并 feed（插画 + 小说，ADR-0115） ───
// sources 顺序即 mergeByTime 同分 tie-break 优先级：illust 在前。
// key 前缀区分类型且全局唯一（i-<id> / n-<id>）；合并 + 去重在 createMixFeed 内部完成。
function mapIllusts(r: {
  illusts: PixivIllust[]
  next_url: string | null
}): { items: MixFeedItem[]; nextUrl: string | null } {
  return {
    items: r.illusts.map((i) => ({ kind: 'illust' as const, key: `i-${i.id}`, id: i.id, data: i })),
    nextUrl: r.next_url,
  }
}

function mapNovels(r: {
  novels: PixivNovel[]
  next_url: string | null
}): { items: MixFeedItem[]; nextUrl: string | null } {
  return {
    items: r.novels.map((n) => ({ kind: 'novel' as const, key: `n-${n.id}`, id: n.id, data: n })),
    nextUrl: r.next_url,
  }
}

const feedSources: MixFeedSource[] = [
  {
    name: 'illust',
    fetchPage: (signal, nextUrl) =>
      nextUrl ? loadNext(nextUrl, signal).then(mapIllusts) : loadRecommended(signal).then(mapIllusts),
  },
  {
    name: 'novel',
    fetchPage: (signal, nextUrl) =>
      nextUrl ? loadNovelNext(nextUrl, signal).then(mapNovels) : loadRecommendedNovels(signal).then(mapNovels),
  },
]

const feed = createMixFeed({
  sources: feedSources,
  merge: 'time-merge',
  autoStart: false, // 页面统一经 refreshFeed 触发首载（含 token 恢复补拉）
  onUpdate: () => sync(), // 模块内部自动补触发（P1）完成后通知页面重新快照
})

// ─── 响应式桥接：feed 是纯函数式状态，页面用本地 ref 快照渲染 ───
const items = ref<MixFeedItem[]>(feed.items())
const loading = ref(feed.loading())
const errorMsg = ref(feed.error() ?? '')
const pageError = ref(feed.pageError() ?? '')

function sync() {
  items.value = feed.items()
  loading.value = feed.loading()
  errorMsg.value = feed.error() ?? ''
  pageError.value = feed.pageError() ?? ''
}

/** 刷新代：每次刷新递增，作为 CarouselSwiper 的 :key 触发其重挂载（重置 offset/索引回到第一张）。
 *  spec §2.4/§5「刷新 = 清流重载、回第一张」——轮播内部 offset/index 是常驻 refs，
 *  不随 feed 刷新自动复位，故用 epoch 重挂载实现回到第一张（对照 IllustList 的 `:key="refreshEpoch"`）。 */
const refreshEpoch = ref(0)

/** 刷新中：FAB 旋转动画 + 防重入 */
const refreshing = ref(false)
async function refreshFeed() {
  if (refreshing.value) return
  refreshing.value = true
  refreshEpoch.value++ // 触发 CarouselSwiper 重挂载（回第一张）
  sync() // 捕获 loading=true（首载骨架屏）
  try {
    await feed.refresh()
  } catch (err) {
    console.warn('[recommended] 刷新失败', err)
  } finally {
    sync()
    refreshing.value = false
  }
}

// ─── 受限过滤（渲染层）：数据层照常加载，受限条目从可视滑页流中滤掉 ───
// isRestricted 依赖 settingsStore 的 showR18/showR18G（响应式），computed 自动随开关重算。
const visibleItems = computed(() => items.value.filter((it) => !isRestricted(it.data)))

// ─── 轮播回调 ───
function onReachEnd() {
  void feed.fetchMore()
}
// 当前滑页索引（供未来指示器使用；spec §6 本轮排除指示器，故暂只跟踪不渲染——非死状态，勿删）
const currentIndex = ref(0)
function onIndexChange(index: number) {
  currentIndex.value = index
}

// 详情跳转：按 kind 前缀；受限条目（理论上已被过滤）再加一道守卫
function openItem(item: MixFeedItem) {
  const prefix = item.kind === 'illust' ? '/illust/' : '/novel/'
  void navigate(`${prefix}${item.id}`)
}
function onSlideTap(item: MixFeedItem) {
  if (!isRestricted(item.data)) openItem(item)
}

// 沉浸式封面图（全 bleed 用大图，退化 medium/square_medium）
function coverSrc(data: PixivIllust | PixivNovel): string {
  const u = data.image_urls
  return proxyImageUrl(u.large || u.medium || u.square_medium || '')
}

onMounted(() => {
  void refreshFeed()
})

onUnmounted(() => {
  feed.dispose()
})

// [首帧内容化]（#63）：初始路由为推荐页，组件可能在登录态就绪前被挂载。
// 首帧 fetch 在 token 恢复前会 401 失败，需补拉（幂等：数据非空/加载中则跳过）。
watch(isLoggedIn, (loggedIn) => {
  if (loggedIn && feed.items().length === 0) {
    void refreshFeed()
  }
})

onActivated(() => {
  if (feed.items().length === 0 && !feed.loading() && isLoggedIn.value) {
    void refreshFeed()
  }
})
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：surface 背景 + 居中标题（title-large），无导航图标（顶层页） -->
    <view class="flex flex-row items-center justify-center h-[17.067vw] px-4 bg-surface">
      <text class="text-title-large font-medium text-surface-on">推荐</text>
    </view>

    <!-- 首载骨架 / 整页错误 -->
    <view v-if="loading && items.length === 0" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <text class="text-body-medium text-outline">加载中…</text>
    </view>
    <view v-else-if="errorMsg && items.length === 0" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <text class="text-body-medium text-error">{{ errorMsg }}</text>
    </view>

    <!-- 单卡轮播：一滑页 = 一个作品（沉浸式全 bleed 大图卡） -->
    <!-- [lynx:fix] 内容容器须为 flex-col（flex 容器），否则 CarouselSwiper 根 .swiper-wrapper 的
         flex:1 不拉伸 → 高度塌缩为 0 → slides 0 高 → 推荐页空白（对照 IllustList 用 <list h-full> 填满） -->
    <view v-else class="w-full flex-1 flex flex-col min-h-0 relative">
      <CarouselSwiper
        :key="refreshEpoch"
        :slides="visibleItems"
        :on-index-change="onIndexChange"
        :on-reach-end="onReachEnd"
      >
        <template #slide="{ item }">
          <view class="w-full h-full relative bg-surface-container-lowest" @tap="onSlideTap(item)">
            <!-- 封面图（全 bleed 三态：骨架/图片/失败+重试；Lynx mode=aspectFill 等比不变形） -->
            <RecommendedCover :src="coverSrc(item.data)" />
            <!-- 底部渐变 scrim：承载标题/作者/类型徽章/收藏（用 M3 scrim-overlay 令牌，勿内联 rgba） -->
            <view
              class="absolute bottom-0 left-0 right-0 px-6 pt-[24vw] pb-[10vw]"
              style="background: var(--md-scrim-overlay)"
            >
              <IllustTypeBadgeRow v-if="item.kind === 'illust'" :illust="item.data" />
              <text class="text-title-large font-semibold text-white leading-[1.3] [max-line:2]">{{ item.data.title }}</text>
              <text class="text-body-medium text-white/85 mt-2">{{ item.data.user.name }}</text>
              <view v-if="item.kind === 'illust'" class="mt-5">
                <BookmarkButton
                  :illust-id="item.data.id"
                  :initial-bookmarked="item.data.is_bookmarked"
                  :bookmark-count="item.data.total_bookmarks"
                />
              </view>
              <text v-else class="text-label-medium text-white/70 mt-3">{{ item.data.text_length }} 字</text>
            </view>
          </view>
        </template>
      </CarouselSwiper>

      <!-- 分页加载失败（fetchMore）内联提示：保留当前滑页，可重试 -->
      <view v-if="pageError" class="absolute bottom-[16vw] left-0 right-0 flex justify-center px-4">
        <text class="text-body-small text-error bg-surface-container-high px-3 py-1 rounded-[var(--md-shape-small)] shadow-[var(--md-elevation-1)]">{{ pageError }}</text>
      </view>

      <!-- 单刷新 FAB（M3：primary-container、56dp、icon ⟳、旋转动画） -->
      <view
        v-if="visibleItems.length > 0"
        class="absolute bottom-4 right-4 w-[14.933vw] h-[14.933vw] rounded-[var(--md-shape-large)] bg-primary-container active:bg-layer-pressed-primary flex items-center justify-center shadow-[var(--md-elevation-3)] active:shadow-[var(--md-elevation-1)]"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="RECOMMENDED_A11Y_LABELS.refresh"
        @tap="refreshFeed"
      >
        <!-- 刷新图标（unicode ↻）+ 圆环：refreshing 时图标淡出、M3 圆环转起（C 动画）。
             [P5 发现] SVG data-URI 在原生 LynxView 不渲染、透明 PNG 难生成，故回退 unicode ↻
             （Lynx 无图标字体，unicode 字形为可靠面；ADR-0115 已记录该取舍）。 -->
        <view class="relative w-[6.4vw] h-[6.4vw] flex items-center justify-center">
          <text
            class="text-[6.4vw] leading-none text-primary-on-container transition-opacity duration-[var(--durationFast)] ease-[var(--motion-standard)]"
            :class="refreshing ? 'opacity-0' : 'opacity-100'"
          >↻</text>
          <view
            class="absolute inset-0 w-[6.4vw] h-[6.4vw] rounded-full border-[3px] border-[var(--md-outline-variant)] border-t-[var(--md-on-primary-container)] transition-opacity duration-[var(--durationFast)] ease-[var(--motion-standard)]"
            :class="refreshing ? 'animate-spin opacity-100' : 'opacity-0'"
          />
        </view>
      </view>
    </view>

    <!-- M3 NavigationBar：底部四 tab（推荐/插画/小说/我的） -->
    <NavigationBar :tabs="navTabs" :active-name="'recommended'" @select="onNavSelect" />
  </view>
</template>

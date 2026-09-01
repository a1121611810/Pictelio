<script setup lang="ts">
// 综合推荐页（/recommended）：插画 + 小说混合，改**单卡 swipe 轮播**（ADR-0115）。
// 数据层由 createMixFeed（merge:'time-merge'）承载：两路（插画/小说）按 create_date 时间交叉
// 合并成增长流 + fetchMore（双防抖/竞态代/去重/分批渲染/15s 超时）；页面只做 ref 快照桥接 + 渲染。
// 渲染层 = CarouselSwiper（自研 swipe，**后台线程**触摸 + Vue 响应式 :style 绑定 translateX + px 吸附，
// 因官方「主线程脚本」在本项目原生 LynxView 整块空白、判定不可用，ADR-0115 T5 修订）——一滑页一个
// 作品，沉浸式全 bleed 大图卡，信息叠底部渐变 scrim。受限条目经 visibleItems 过滤（数据层仍加载，
// 开关切换时 computed 重算即可，无需重请求）。刷新/回顶经全局放射 FAB（globalFab 桥接，
// view.isBusy 驱动旋转）；本页不再渲染自持 FAB。
// [ADR-0118 打磨 R2] 封面「宽满高按比例」（deriveCoverDisplay + SystemInfo 视口派生，超高图回退
//   aspectFill）；首载渲染流为空即显沉浸骨架（CarouselSkeleton，不依赖 loading）；滑页 scrim 区
//   展示标签胶囊行（TagChipRow，3+N）。吸附阈值 + fling 在 CarouselSwiper 内部（swiperMath）。
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'recommended' })
import { ref, computed, onMounted, onActivated, onUnmounted, watch } from 'vue'
import { navigate } from '../router'
import { loadRecommended, loadNext } from '../api/illust'
import { loadRecommendedNovels, loadNovelNext } from '../api/novel'
import type { PixivIllust, PixivNovel } from '../api/types'
import { createMixFeed, type MixFeedItem, type MixFeedSource } from '../primitives/createMixFeed'
import { proxyImageUrl } from '../utils/imageUrl'
import { deriveCoverDisplay } from '../utils/coverDisplay'
import { isRestricted } from '../stores/settingsStore'
import { isLoggedIn } from '../stores/authStore'
import { getGlobalFab } from '../stores/globalFab'
import CarouselSwiper from '../components/CarouselSwiper.vue'
import RecommendedCover from '../components/RecommendedCover.vue'
import CarouselSkeleton from '../components/CarouselSkeleton.vue'
import TagChipRow from '../components/TagChipRow.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import IllustTypeBadgeRow from '../components/IllustTypeBadgeRow.vue'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { openSearch } from '../stores/searchSheetStore'

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
// [ADR-0118] 首载骨架「渲染流为空即显」（不依赖 loading）：loading 标志不再参与显隐，移除本地镜像。
const items = ref<MixFeedItem[]>(feed.items())
const errorMsg = ref(feed.error() ?? '')
const pageError = ref(feed.pageError() ?? '')

function sync() {
  items.value = feed.items()
  errorMsg.value = feed.error() ?? ''
  pageError.value = feed.pageError() ?? ''
}

// ─── 封面比例显示（ADR-0118 / spec §2.1、§3.2）：可视区尺寸由 SystemInfo 派生 ───
// 可视区 = 屏幕逻辑尺寸 - TopAppBar(17.067vw)（vw 折算为 px；底部导航已由全局放射 FAB 取代，不再预留）。
// pixelHeight 缺失时按 16:9 宽高比估算（防御；低估可用高度 → 略偏向 aspectFill 回退，安全侧）。
declare const SystemInfo: { pixelWidth: number; pixelHeight?: number; pixelRatio: number }
function slideViewport(): { width: number; height: number } {
  if (typeof SystemInfo === 'undefined') return { width: 375, height: 667 } // web-core 兜底（iPhone 逻辑尺寸近似）
  const w = SystemInfo.pixelWidth / SystemInfo.pixelRatio
  const screenH = SystemInfo.pixelHeight ? SystemInfo.pixelHeight / SystemInfo.pixelRatio : w * 1.78
  const bars = 0.17067 * w
  return { width: w, height: Math.max(1, screenH - bars) }
}
const SLIDE_VIEWPORT = slideViewport()

/** 每张滑页的封面显示参数（fit/ratio，喂 RecommendedCover）：插画用 API width/height，
 *  小说无尺寸字段 → 1:1 方形契约（deriveCoverDisplay 内部处理，非静默降级见下）。 */
function coverDisplayOf(item: MixFeedItem): { fit: 'cover' | 'width-fill'; ratio: string } {
  const isIllust = item.kind === 'illust'
  if (isIllust && (!item.data.width || !item.data.height)) {
    console.warn('[recommended] 插画缺少尺寸元数据，按 1:1 方形封面显示', item.id)
  }
  const { fit, ratio } = deriveCoverDisplay({
    imgWidth: isIllust ? item.data.width : undefined,
    imgHeight: isIllust ? item.data.height : undefined,
    viewportWidth: SLIDE_VIEWPORT.width,
    viewportHeight: SLIDE_VIEWPORT.height,
  })
  return { fit, ratio }
}

/** 刷新代：每次刷新递增，作为 CarouselSwiper 的 :key 触发其重挂载（重置 offset/索引回到第一张）。
 *  spec §2.4/§5「刷新 = 清流重载、回第一张」——轮播内部 offset/index 是常驻 refs，
 *  不随 feed 刷新自动复位，故用 epoch 重挂载实现回到第一张（对照 IllustList 的 `:key="refreshEpoch"`）。 */
const refreshEpoch = ref(0)

/** 刷新：bump refreshEpoch（回第一张）+ 清流重载；busy 维度由 globalFab view.isBusy 驱动 */
async function refreshFeed() {
  refreshEpoch.value++ // 触发 CarouselSwiper 重挂载（回第一张）
  sync() // 捕获渲染流清空（items=[] → 若仍在首载则显示沉浸骨架）
  try {
    await feed.refresh()
  } catch (err) {
    console.warn('[recommended] 刷新失败', err)
  } finally {
    sync()
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

// [真机修复] scrim 抽到页面级遮罩：按当前页索引取当前条目作为遮罩内容（文字不进被平移的 flex-row）
const currentItem = computed(() => visibleItems.value[currentIndex.value] as MixFeedItem | undefined)

// 详情跳转：按 kind 前缀；受限条目（理论上已被过滤）再加一道守卫
function openItem(item: MixFeedItem) {
  const prefix = item.kind === 'illust' ? '/illust/' : '/novel/'
  void navigate(`${prefix}${item.id}`)
}
function onSlideTap(item: MixFeedItem) {
  if (!isRestricted(item.data)) openItem(item)
}

// 点击标签 → 全局搜索弹层（ADR-0133）：TagChipRow 只发原始 tag.name（纯展示组件不依赖 store），
// 页面层接线 openSearch——与 webview SearchableTag「点击即搜」语义一致（预填 + 自动搜索）。
function onTagTap(name: string) {
  openSearch(name)
}

// 沉浸式封面图（全 bleed 用大图，退化 medium/square_medium）
function coverSrc(data: PixivIllust | PixivNovel): string {
  const u = data.image_urls
  return proxyImageUrl(u.large || u.medium || u.square_medium || '')
}

// ─── 全局放射 FAB 桥（ADR-0120）：注册本页动作到 globalFab，卸载时注销 ───
let unreg: (() => void) | undefined
onMounted(() => {
  unreg = getGlobalFab().usePage('recommended', {
    refresh: refreshFeed,
    backToTop: () => {
      refreshEpoch.value++
    },
  })
  void refreshFeed()
})

onUnmounted(() => {
  unreg?.()
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

    <!-- 首载沉浸骨架 / 整页错误（ADR-0118：渲染流为空即显骨架，不依赖 loading——冷启动请求前立即出现） -->
    <view v-if="items.length === 0 && !errorMsg" class="w-full flex-1 min-h-0">
      <CarouselSkeleton />
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
          <view class="w-full h-full relative flex flex-col bg-surface-container-lowest" @tap="onSlideTap(item)">
            <!-- 封面图（ADR-0118 宽满高按比例：fit/ratio 经 deriveCoverDisplay 推导，超高图回退 aspectFill；
                 三态骨架/图片/失败+重试仍由 CoverImage 承载）
                 [真机修复] scrim 不再内嵌于 slide：<text> 在真机 LynxView 的「非首 flex-row 子元素」内不渲染，
                 抽到页面级遮罩（下方），slide 只承载图片。 -->
            <RecommendedCover
              :src="coverSrc(item.data)"
              :fit="coverDisplayOf(item).fit"
              :ratio="coverDisplayOf(item).ratio"
            />
          </view>
        </template>
      </CarouselSwiper>

      <!-- 页面级 scrim 遮罩（真机修复：文字不进 translate 的 flex-row）
           真机 LynxView 对 flex-row「非首个子元素」内的 <text> 不渲染（仅图片/<view> 正常，且重挂载/换 linear 均无效，
           绿像素检测证实第 2+ 页 title 全屏无渲染）。scrim 本就在屏幕底部（ADR-0118），故抽为页面级固定遮罩、
           按当前页 index 更新内容，从根本上规避 <text> 落入被平移的 flex-row 子元素。
           [权衡] 遮罩为固定覆盖层，底部 scrim 区不响应滑动（真机 LynxView 的 pointer-events 对触摸事件不生效）；
           滑动需从图片区（上部）发起；点卡进详情由本遮罩 @tap 承担（收藏按钮 @tap.stop 不冒泡）。 -->
      <view
        class="absolute bottom-0 left-0 right-0 px-6 pt-[24vw] pb-[10vw]"
        style="background: var(--md-scrim-overlay)"
        @tap="currentItem && onSlideTap(currentItem)"
      >
        <IllustTypeBadgeRow v-if="currentItem && currentItem.kind === 'illust'" :illust="currentItem.data" />
        <!-- 标签胶囊行（ADR-0118：3+N、translated_name||name、# 前缀、纯展示；位置 = 类型徽章下方、标题上方） -->
        <TagChipRow v-if="currentItem" :tags="currentItem.data.tags" class="mt-2" @tag-tap="onTagTap" />
        <text
          v-if="currentItem"
          class="text-title-large font-semibold text-white leading-[1.3] [max-line:2]"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="currentItem.data.title"
          >{{ currentItem.data.title }}</text
        >
        <text v-if="currentItem" class="text-body-medium text-white/85 mt-2">{{ currentItem.data.user.name }}</text>
        <view v-if="currentItem && currentItem.kind === 'illust'" class="mt-5">
          <BookmarkButton
            :illust-id="currentItem.data.id"
            :initial-bookmarked="currentItem.data.is_bookmarked"
            :bookmark-count="currentItem.data.total_bookmarks"
          />
        </view>
        <text v-else-if="currentItem" class="text-label-medium text-white/70 mt-3">{{ currentItem.data.text_length }} 字</text>
      </view>

      <!-- 分页加载失败（fetchMore）内联提示：保留当前滑页，可重试 -->
      <view v-if="pageError" class="absolute bottom-[16vw] left-0 right-0 flex justify-center px-4">
        <text class="text-body-small text-error bg-surface-container-high px-3 py-1 rounded-[var(--md-shape-small)] shadow-[var(--md-elevation-1)]">{{ pageError }}</text>
      </view>

    </view>
  </view>
</template>

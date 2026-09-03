<script setup lang="ts">
// 插画分类页（/illusts）：推荐/关注两个子 tab，waterfall 双列插画卡。
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'illusts' })
import { ref, onMounted, onUnmounted } from 'vue'
import { navigate } from '../router'
import { loadRecommended, loadFollow, loadNext } from '../api/illust'
import type { PixivIllust, PixivIllustListResponse } from '../api/types'
import { thumbUrl } from '../utils/imageUrl'
import { createMixFeed, type MixFeedItem } from '../primitives/createMixFeed'
import { useSettingsStore } from '../stores/settingsStore'
import SkeletonCard from '../components/SkeletonCard.vue'
import SkeletonImage from '../components/SkeletonImage.vue'
import IllustTypeBadgeRow from '../components/IllustTypeBadgeRow.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import RestrictOverlay from '../components/RestrictOverlay.vue'
import RefreshableList from '../components/RefreshableList.vue'
import { useGlobalFabStore } from '../stores/globalFab'

const isRestricted = useSettingsStore().isRestricted

// ─── 分页收敛（ADR-0104）：迁移到 createMixFeed 深模块 ───
// 双防抖 / 竞态代 / 分批渲染（pageSize=20，替代原 pendingIllusts 队列）/ 空页防护 /
// 15s 超时 / 错误槽分流（error=首屏顶部、pageError=分页底部内联）全部由 createMixFeed 承载。
// 推荐/关注切换：推荐 = /v1/illust/recommended，关注 = /v2/illust/follow
const mode = ref<'recommend' | 'follow'>('recommend')

function mapIllusts(r: PixivIllustListResponse): { items: MixFeedItem[]; nextUrl: string | null } {
  return {
    items: r.illusts.map((i) => ({ kind: 'illust' as const, key: `i-${i.id}`, id: i.id, data: i })),
    nextUrl: r.next_url,
  }
}

function makeFeed(m: 'recommend' | 'follow') {
  const first = m === 'recommend' ? loadRecommended : loadFollow
  return createMixFeed({
    // autoStart=false：构造不首载，由 refreshFeed 显式触发（mode 重建实例避免双请求浪费）
    autoStart: false,
    onUpdate: sync, // [T1] 防抖重试补发完成后页面重新快照（P1）
    sources: [
      {
        name: 'illust',
        fetchPage: (signal, nextUrl) =>
          nextUrl ? loadNext(nextUrl, signal).then(mapIllusts) : first(signal).then(mapIllusts),
      },
    ],
  })
}

const feed = ref(makeFeed(mode.value))
const illusts = ref<PixivIllust[]>([])

const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')
const pageErrorMsg = ref('')
const endOfFeed = ref(false)

function sync() {
  illusts.value = feed.value.items().map((i) => i.data as PixivIllust)
  loading.value = feed.value.loading()
  loadingMore.value = feed.value.loadingMore()
  errorMsg.value = feed.value.error() ?? ''
  pageErrorMsg.value = feed.value.pageError() ?? ''
  // 到底态：所有源耗尽且列表非空（ADR-0104：footer「没有更多了」）
  endOfFeed.value =
    feed.value.nextUrl() === null &&
    feed.value.items().length > 0 &&
    !loading.value &&
    !loadingMore.value
}

async function refreshFeed() {
  await feed.value.refresh()
  sync()
  // [lynx:fix] 数据整体替换触发 vue-lynx patch RemoveNode 索引错位（框架 bug，ADR-0107 D4）；
  // epoch 与 sync() 同 tick flush（key 变化走整树替换，不发生子节点 patch）
  refreshEpoch.value++
}

/** list 强制重建代（refresh 后 ++，驱动 :key 替换） */
const refreshEpoch = ref(0)

async function loadMore() {
  await feed.value.fetchMore()
  sync()
}

function switchMode(m: 'recommend' | 'follow') {
  if (mode.value === m) return
  mode.value = m
  // 重建 feed 实例：先释放旧实例（清挂起补触发 + 作废在途响应），新实例 generation 从 0 起
  feed.value?.dispose()
  feed.value = makeFeed(m)
  illusts.value = []
  errorMsg.value = ''
  pageErrorMsg.value = ''
  loading.value = true
  void refreshFeed()
}

function openDetail(id: number) {
  void navigate(`/illust/${id}`)
}

// 图片区点击（spec：列表交互）：受限条目（R18/R18G 且开关关闭）不跳详情，其余进详情。
// 外层 .stop 继续保证遮罩点击不穿透；RestrictOverlay 自身 @tap="swallow" 双保险。
function onImageTap(item: PixivIllust) {
  if (!isRestricted(item)) openDetail(item.id)
}

// ─── 全局放射 FAB 桥（ADR-0120）：注册本页动作到 globalFab，卸载时注销 ───
let unreg: (() => void) | undefined
// bench 导航钩子（wayfinder #306，ADR-0136）：真机 input tap 对 <view @tap> 失效，经
// GlobalEventEmitter 事件切「关注」子 tab；__BENCH_NAV__ 门禁（BENCH_NAV=1 构建激活，同原生 DEBUG 双保险）
const benchOnFollow = () => void switchMode('follow')
let benchOffFn: (() => void) | undefined
onMounted(() => {
  unreg = useGlobalFabStore().usePage('illusts', {
    refresh: refreshFeed,
    backToTop: () => {
      refreshEpoch.value++
    },
  })
  if (__BENCH_NAV__) {
    const lynxGlobal = typeof lynx !== 'undefined' ? lynx : (globalThis as { lynx?: { getJSModule?: (n: string) => { addListener?: (e: string, fn: () => void) => void; removeListener?: (e: string, fn: () => void) => void } } }).lynx
    const emitter = lynxGlobal?.getJSModule?.('GlobalEventEmitter')
    if (emitter && typeof emitter.addListener === 'function') {
      emitter.addListener('pictelioBenchNavIllustFollow', benchOnFollow)
      benchOffFn = () => emitter.removeListener?.('pictelioBenchNavIllustFollow', benchOnFollow)
    }
  }
  void refreshFeed()
})

// 释放 feed（spec §4 T1 dispose）：卸载与 mode 重建时均作废旧实例
onUnmounted(() => {
  unreg?.()
  benchOffFn?.()
  feed.value?.dispose()
})
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：顶层页，居中标题，无返回箭头 -->
    <view class="flex flex-row items-center justify-center h-[17.067vw] px-4 bg-surface">
      <text class="text-title-large font-medium text-surface-on">插画</text>
    </view>

    <!-- 推荐/关注切换（M3 secondary tabs）：容器 border-b 分割线 + surface-container-lowest 底，
         选中态 = text-primary + 底部 0.8vw primary 指示条（Bookmarks 页已验证的可靠写法） -->
    <view class="flex flex-row border-b-[1px] border-b-outline-variant bg-surface-container-lowest">
      <view
        class="flex-1 h-[12.8vw] flex items-center justify-center"
        :class="mode === 'recommend' ? 'text-primary border-b-[0.8vw] border-b-primary' : 'text-outline'"
        @tap="switchMode('recommend')"
      >
        <text class="text-title-small font-medium">推荐</text>
      </view>
      <view
        class="flex-1 h-[12.8vw] flex items-center justify-center"
        :class="mode === 'follow' ? 'text-primary border-b-[0.8vw] border-b-primary' : 'text-outline'"
        @tap="switchMode('follow')"
      >
        <text class="text-title-small font-medium">关注</text>
      </view>
    </view>

    <text v-if="errorMsg && !loading" class="text-body-small text-error p-4">{{ errorMsg }}</text>

    <!-- [lynx:fix] 骨架屏：首屏加载（无数据）时显示 shimmer 卡片占位，数据就绪后切换 list。
         8 个 ≈ 4 行两列，与真实卡片同比例（48.4vw 宽 + 方形图片）避免切换 reflow -->
    <!-- [lynx:fix] 骨架屏不占满全屏高度（h-full 会溢出覆盖底部导航栏，拦截 tap，issue #129）：
     改 flex-1 min-h-0 约束在导航栏下方的内容区内 -->
    <view v-if="loading && illusts.length === 0" class="w-full flex-1 min-h-0 flex flex-row flex-wrap content-start p-1.5">
      <SkeletonCard v-for="n in 8" :key="n" />
    </view>

    <!-- 关注视图空态 -->
    <view v-if="mode === 'follow' && !loading && !errorMsg && illusts.length === 0" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">♡</text>
        <text class="text-body-large text-surface-on mt-3">暂无关注插画</text>
        <text class="text-body-medium text-surface-on-variant mt-1.5">关注的作者发布新插画后会展示在这里</text>
      </view>
    </view>
    <!-- 推荐视图空态（spec 加固 3）：杜绝「无数据 → 纯空白」 -->
    <view v-if="mode === 'recommend' && !loading && !errorMsg && illusts.length === 0" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">✦</text>
        <text class="text-body-large text-surface-on mt-3">暂无推荐插画</text>
        <text class="text-body-medium text-surface-on-variant mt-1.5">稍后再来看看，会有新的推荐</text>
      </view>
    </view>

    <RefreshableList
      v-else-if="!loading || illusts.length > 0"
      :refresh="refreshFeed"
      :fab="false"
      @back-to-top="refreshEpoch++"
    >
    <template #default="{ onScroll }">
    <list
      :key="refreshEpoch"
      class="w-full h-full"
      list-type="waterfall"
      scroll-orientation="vertical"
      :span-count="2"
      :style="{ listMainAxisGap: '12px', listCrossAxisGap: '12px' }"
      :lower-threshold-item-count="2"
      :scroll-event-throttle="0"
      @scrolltolower="loadMore"
      @scroll="onScroll"
    >
      <list-item
        v-for="item in illusts"
        :key="item.id"
        :item-key="String(item.id)"
        class="bg-surface-container-lowest rounded-[var(--md-shape-medium)] flex flex-col overflow-hidden shadow-[var(--md-elevation-1)]"
      >
        <!-- [lynx:fix] 原生 list-item 根级 @tap 失效（fiber 不触发，真机实测 2026-08-02）；
             把 openDetail 绑到内容 view（子元素 tap 已验证工作），♥ 的 @tap.stop 仍阻止冒泡 -->
        <view class="w-full flex flex-col" @tap="openDetail(item.id)">
        <!-- [lynx:fix] 间距：web-core 瀑布流引擎忽略 list-item 的 margin/padding 且内部任何 view 包裹
             都会导致 item 定位计算崩（全部重叠在起点）。间距用 list 官方属性
             list-main-axis-gap（行距）/ list-cross-axis-gap（列距），经 vue-lynx style 对象绑定
             （attribute 形式 web-core 不响应）。原生 LynxView 同样支持这两个属性（ADR-0048） -->
        <!-- [lynx:fix] 图片级骨架（SkeletonImage）：显式 height="48.4vw"（= 卡片宽 w-[48.4vw]，保持方形），
             原生 LynxView 下 aspect-ratio + min-h 组合解析为 0 导致图片不显示（issue #140）；
             图片 @load 后才隐藏 shimmer 显示图片（骨架关闭时机 = 图片加载完成，而非 API 数据返回） -->
        <view
          v-if="isRestricted(item)" @tap.stop
          class="w-full h-[48.4vw] flex items-center justify-center bg-[var(--md-scrim)] rounded-[var(--md-shape-medium)]"
        >
          <RestrictOverlay :overlay="false" :level="item.x_restrict === 2 ? 2 : 1" />
        </view>
        <view v-else class="relative" @tap.stop="onImageTap(item)">
          <SkeletonImage :src="thumbUrl(item.image_urls)" height="48.4vw" lazy-load />
        </view>
        <!-- 类型徽章行（动图/多图，ADR-0113）：流内元素，受限条目照常显示，普通单图零占位 -->
        <IllustTypeBadgeRow :illust="item" />
        <text class="text-title-small font-medium text-surface-on mt-2 mx-2.5 [max-line:1]">{{ item.title }}</text>
        <text class="text-body-small text-surface-on-variant mt-1 mx-2.5 [max-line:1]">{{ item.user.name }}</text>
        <view class="mt-1 mx-2.5 mb-2.5">
          <BookmarkButton
            :illust-id="item.id"
            :initial-bookmarked="item.is_bookmarked"
            :bookmark-count="item.total_bookmarks"
          />
        </view>
        </view>
      </list-item>
      <list-item v-if="loadingMore || pageErrorMsg || endOfFeed" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text v-if="loadingMore" class="text-body-medium text-outline">加载中…</text>
        <text v-else-if="pageErrorMsg" class="text-body-medium text-error">{{ pageErrorMsg }}</text>
        <text v-else class="text-body-medium text-outline">没有更多了</text>
      </list-item>
    </list>
    </template>
    </RefreshableList>
  </view>
</template>

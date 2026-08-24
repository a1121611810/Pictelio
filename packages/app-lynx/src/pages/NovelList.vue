<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'novels' })
import { ref, onMounted } from 'vue'
import { navigate } from '../router'
import { loadRecommendedNovels, loadFollow, loadNovelNext } from '../api/novel'
import type { PixivNovel, PixivNovelListResponse } from '../api/types'
import { createMixFeed, type MixFeedItem } from '../primitives/createMixFeed'
import { isRestricted } from '../stores/settingsStore'
import RestrictedNovelCard from '../components/RestrictedNovelCard.vue'
import NavigationBar from '../components/NavigationBar.vue'
import RefreshableList from '../components/RefreshableList.vue'
import { NAV_TABS, type NavTab } from '../components/navTabs'

function onNavSelect(tab: NavTab) {
  if (tab.name === 'novels') return
  void navigate(tab.path, { replace: true })
}

// ─── 分页收敛（ADR-0104）：迁移到 createMixFeed 深模块 ───
// 双防抖（800ms 节流 + 3s 冷却）/ 竞态代 / 分批渲染 / 空页防护 / 15s 超时 /
// 错误槽分流（error=首屏顶部、pageError=分页底部内联）全部由 createMixFeed 承载，
// 页面只做 ref 快照桥接（sync）。
// 推荐/关注切换（P0-T5）：关注视图用 /v1/novel/follow
const mode = ref<'recommend' | 'follow'>('recommend')

function mapNovels(r: PixivNovelListResponse): { items: MixFeedItem[]; nextUrl: string | null } {
  return {
    items: r.novels.map((n) => ({ kind: 'novel' as const, key: `n-${n.id}`, id: n.id, data: n })),
    nextUrl: r.next_url,
  }
}

function makeFeed(m: 'recommend' | 'follow') {
  const first = m === 'recommend' ? loadRecommendedNovels : loadFollow
  return createMixFeed({
    // autoStart=false：构造不首载，由 refreshFeed 显式触发（mode 重建实例避免双请求浪费）
    autoStart: false,
    sources: [
      {
        name: 'novel',
        fetchPage: (signal, nextUrl) =>
          nextUrl ? loadNovelNext(nextUrl, signal).then(mapNovels) : first(signal).then(mapNovels),
      },
    ],
  })
}

const feed = ref(makeFeed(mode.value))
const novels = ref<PixivNovel[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')
const pageErrorMsg = ref('')
const endOfFeed = ref(false)

function sync() {
  novels.value = feed.value.items().map((i) => i.data as PixivNovel)
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
}

async function loadMore() {
  await feed.value.fetchMore()
  sync()
}

function switchMode(m: 'recommend' | 'follow') {
  if (mode.value === m) return
  mode.value = m
  // 重建 feed 实例：新实例 generation 从 0 起，旧实例在途响应按竞态代被丢弃
  feed.value = makeFeed(m)
  novels.value = []
  errorMsg.value = ''
  pageErrorMsg.value = ''
  loading.value = true
  void refreshFeed()
}

function openDetail(id: number) {
  void navigate(`/novel/${id}`)
}

onMounted(() => {
  void refreshFeed()
})
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：顶层页，居中标题，无返回箭头 -->
    <view class="flex flex-row items-center justify-center h-[17.067vw] px-4 bg-surface">
      <text class="text-title-large font-medium text-surface-on">小说</text>
    </view>

    <!-- 推荐/关注切换（M3 secondary tabs：选中 primary 文字 + 底部 0.8vw primary 指示条，
         容器 border-b 分割线；Bookmarks.vue 已验证的可靠写法，修复 web-core 下 flex-col
         内容 + 独立指示器横条导致的向上偏移） -->
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

    <!-- 首屏骨架（issue #91）：4~6 条列表卡占位，切 tab 重载同样显示 -->
    <!-- [lynx:fix] 骨架屏高度约束在导航栏下方内容区内（不占满全屏，issue #129） -->
    <view v-if="loading && novels.length === 0" class="w-full flex-1 min-h-0">
      <view v-for="n in 5" :key="n" class="m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <view class="shimmer h-[32rpx] rounded-[var(--md-shape-extra-small)] w-[75%]" />
        <view class="shimmer h-[24rpx] rounded-[var(--md-shape-extra-small)] mt-1.5 w-[40%]" />
        <view class="shimmer h-[20rpx] rounded-[var(--md-shape-extra-small)] mt-1.5 w-[30%]" />
        <view class="shimmer h-[24rpx] rounded-[var(--md-shape-extra-small)] mt-2 w-[60%]" />
      </view>
    </view>

    <!-- 关注视图空态（P0-T5） -->
    <view v-if="mode === 'follow' && !loading && !errorMsg && novels.length === 0" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">✎</text>
        <text class="text-body-large text-surface-on mt-3">暂无关注小说</text>
        <text class="text-body-medium text-surface-on-variant mt-1.5">关注的小说作者发布新作品后会展示在这里</text>
      </view>
    </view>
    <!-- 推荐视图空态（spec 加固 3）：杜绝「无数据 → 纯空白」 -->
    <view v-if="mode === 'recommend' && !loading && !errorMsg && novels.length === 0" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">✎</text>
        <text class="text-body-large text-surface-on mt-3">暂无推荐小说</text>
        <text class="text-body-medium text-surface-on-variant mt-1.5">稍后再来看看，会有新的推荐</text>
      </view>
    </view>

    <RefreshableList v-if="novels.length > 0" :refresh="refreshFeed">
    <list
      class="w-full h-full"
      list-type="single"
      scroll-orientation="vertical"
      :lower-threshold-item-count="5"
      @scrolltolower="loadMore"
    >
      <list-item
        v-for="item in novels"
        :key="item.id"
        :item-key="String(item.id)"
        class="w-full"
        @tap="openDetail(item.id)"
      >
        <!-- 受限条目：等高占位卡（RestrictedNovelCard，ADR-0105；显式固定高度，
             流内无 absolute——真机 Lynx 的 absolute 子元素会被 single list item
             高度测量算进内容高度，导致整卡撑满内容区，实测 2026-08-11） -->
        <RestrictedNovelCard v-if="isRestricted(item)" :item="item" />
        <view v-else class="relative flex flex-row items-start m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
          <view class="flex-1 flex flex-col">
            <text class="text-title-medium font-medium text-surface-on [max-line:2]">{{ item.title }}</text>
            <text class="text-body-medium text-surface-on-variant mt-1.5">by {{ item.user.name }}</text>
            <view class="flex flex-row mt-1.5">
              <text class="text-label-medium text-surface-on-variant mr-4">{{ item.text_length }} 字</text>
              <text v-if="item.total_bookmarks > 0" class="text-label-medium text-surface-on-variant mr-4">
                ♥ {{ item.total_bookmarks }}
              </text>
            </view>
            <view class="flex flex-row flex-wrap mt-2">
              <text
                v-for="tag in item.tags.slice(0, 3)"
                :key="tag.name"
                class="h-[8.533vw] px-2 border border-outline rounded-[var(--md-shape-small)] flex items-center justify-center m-0.5 text-label-large text-surface-on-variant bg-surface"
              >
                #{{ tag.translated_name || tag.name }}
              </text>
            </view>
          </view>
        </view>
      </list-item>
      <list-item v-if="loadingMore || pageErrorMsg || endOfFeed" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text v-if="loadingMore" class="text-body-medium text-outline">加载中…</text>
        <text v-else-if="pageErrorMsg" class="text-body-medium text-error">{{ pageErrorMsg }}</text>
        <text v-else class="text-body-medium text-outline">没有更多了</text>
      </list-item>
    </list>
    </RefreshableList>

    <!-- M3 NavigationBar：底部四 tab -->
    <NavigationBar :tabs="NAV_TABS" :active-name="'novels'" @select="onNavSelect" />
  </view>
</template>

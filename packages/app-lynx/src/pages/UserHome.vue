<script setup lang="ts">
// 用户主页（P0-T1）：头像/名字/简介 + 插画/小说作品 tab。
// 不在 App.vue KeepAlive include 白名单（按 :id 加载，每次进入重新 mount——ADR-0049 语义）。
// 分页收敛（ADR-0104）：两区各自迁移到 createMixFeed 深模块；tab 切换保留各自 feed
// 实例（切回已加载 tab 不重新请求，对齐原「按需加载一次」行为）。
import { ref, computed, onMounted } from 'vue'
import { currentParams, navigate, goBack } from '../router'
import { getUserDetail } from '../api/user'
import { loadUserIllusts, loadNext } from '../api/illust'
import { loadUserNovels, loadNovelNext } from '../api/novel'
import type {
  PixivUserDetailResponse,
  PixivIllust,
  PixivNovel,
  PixivIllustListResponse,
  PixivNovelListResponse,
} from '../api/types'
import { thumbUrl, proxyImageUrl } from '../utils/imageUrl'
import { presentError } from '../utils/errorPresentation'
import { createMixFeed, type MixFeedItem } from '../primitives/createMixFeed'
import { isRestricted } from '../stores/settingsStore'
import SkeletonImage from '../components/SkeletonImage.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import RestrictOverlay from '../components/RestrictOverlay.vue'
import RestrictedNovelCard from '../components/RestrictedNovelCard.vue'
import RefreshableList from '../components/RefreshableList.vue'

const userId = Number(currentParams.value.id)

const detail = ref<PixivUserDetailResponse | null>(null)
const activeTab = ref<'illust' | 'novel'>('illust')
const detailError = ref('')

// ─── 插画作品 feed（waterfall） ───
function mapIllusts(r: PixivIllustListResponse): { items: MixFeedItem[]; nextUrl: string | null } {
  return {
    items: r.illusts.map((i) => ({ kind: 'illust' as const, key: `i-${i.id}`, id: i.id, data: i })),
    nextUrl: r.next_url,
  }
}
const illustFeed = ref(
  createMixFeed({
    autoStart: false,
    sources: [
      {
        name: 'illust',
        fetchPage: (signal, nextUrl) =>
          nextUrl
            ? loadNext(nextUrl, signal).then(mapIllusts)
            : loadUserIllusts(userId, 'illust', signal).then(mapIllusts),
      },
    ],
  }),
)
const illusts = ref<PixivIllust[]>([])
const illustLoading = ref(false)
const illustLoadingMore = ref(false)
const illustErrorMsg = ref('')
const illustPageErrorMsg = ref('')
const illustEndOfFeed = ref(false)

function syncIllust() {
  illusts.value = illustFeed.value.items().map((i) => i.data as PixivIllust)
  illustLoading.value = illustFeed.value.loading()
  illustLoadingMore.value = illustFeed.value.loadingMore()
  illustErrorMsg.value = illustFeed.value.error() ?? ''
  illustPageErrorMsg.value = illustFeed.value.pageError() ?? ''
  // 到底态：所有源耗尽且列表非空（ADR-0104：footer「没有更多了」）
  illustEndOfFeed.value =
    illustFeed.value.nextUrl() === null &&
    illustFeed.value.items().length > 0 &&
    !illustLoading.value &&
    !illustLoadingMore.value
}

async function refreshIllust() {
  await illustFeed.value.refresh()
  syncIllust()
}

// 下拉刷新入口（ADR-0106）：RefreshableList @refresh；try/finally 保证失败也收起 header
const illustRefreshing = ref(false)
async function onRefreshIllust() {
  illustRefreshing.value = true
  try {
    await refreshIllust()
  } finally {
    illustRefreshing.value = false
  }
}
async function loadIllustMore() {
  await illustFeed.value.fetchMore()
  syncIllust()
}

// ─── 小说作品 feed（single 列表，对齐 NovelList 模式） ───
function mapNovels(r: PixivNovelListResponse): { items: MixFeedItem[]; nextUrl: string | null } {
  return {
    items: r.novels.map((n) => ({ kind: 'novel' as const, key: `n-${n.id}`, id: n.id, data: n })),
    nextUrl: r.next_url,
  }
}
const novelFeed = ref(
  createMixFeed({
    autoStart: false,
    sources: [
      {
        name: 'novel',
        fetchPage: (signal, nextUrl) =>
          nextUrl
            ? loadNovelNext(nextUrl, signal).then(mapNovels)
            : loadUserNovels(userId, signal).then(mapNovels),
      },
    ],
  }),
)
const novels = ref<PixivNovel[]>([])
const novelLoading = ref(false)
const novelLoadingMore = ref(false)
const novelErrorMsg = ref('')
const novelPageErrorMsg = ref('')
const novelEndOfFeed = ref(false)

function syncNovel() {
  novels.value = novelFeed.value.items().map((i) => i.data as PixivNovel)
  novelLoading.value = novelFeed.value.loading()
  novelLoadingMore.value = novelFeed.value.loadingMore()
  novelErrorMsg.value = novelFeed.value.error() ?? ''
  novelPageErrorMsg.value = novelFeed.value.pageError() ?? ''
  novelEndOfFeed.value =
    novelFeed.value.nextUrl() === null &&
    novelFeed.value.items().length > 0 &&
    !novelLoading.value &&
    !novelLoadingMore.value
}

async function refreshNovel() {
  await novelFeed.value.refresh()
  syncNovel()
}

const novelRefreshing = ref(false)
async function onRefreshNovel() {
  novelRefreshing.value = true
  try {
    await refreshNovel()
  } finally {
    novelRefreshing.value = false
  }
}
async function loadNovelMore() {
  await novelFeed.value.fetchMore()
  syncNovel()
}

// 首屏错误（顶部整页提示）：随 activeTab 取当前区首屏错误（ADR-0104 槽位分离）
const errorMsg = computed(() =>
  activeTab.value === 'illust' ? illustErrorMsg.value : novelErrorMsg.value,
)

// tab 切换：保留各自 feed 实例（切回已加载 tab 不重新请求）；首次进入 tab 才首载
let illustLoaded = false
let novelLoaded = false
function switchTab(tab: 'illust' | 'novel') {
  activeTab.value = tab
  if (tab === 'illust') {
    if (!illustLoaded) {
      illustLoaded = true
      void refreshIllust()
    }
  } else if (!novelLoaded) {
    novelLoaded = true
    void refreshNovel()
  }
}

function openIllust(id: number) {
  void navigate(`/illust/${id}`)
}
function openNovel(id: number) {
  void navigate(`/novel/${id}`)
}

// 图片区点击（spec：列表交互）：受限条目（R18/R18G 且开关关闭）不跳详情，其余进详情。
// 外层 .stop 继续保证遮罩点击不穿透；RestrictOverlay 自身 @tap="swallow" 双保险。
function onImageTap(item: PixivIllust) {
  if (!isRestricted(item)) openIllust(item.id)
}
function openFollowing() {
  void navigate(`/user/${userId}/following`)
}
function openFollowers() {
  void navigate(`/user/${userId}/followers`)
}

onMounted(async () => {
  try {
    detail.value = await getUserDetail(userId)
  } catch (err) {
    detailError.value = presentError(err, '用户信息加载失败')
  }
  illustLoaded = true
  void refreshIllust()
})
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <view class="flex flex-row items-center h-[17.067vw] px-4 bg-surface">
      <view class="py-1 pr-2" @tap="goBack"><text class="text-[6.4vw] leading-none text-surface-on">‹</text></view>
      <text class="flex-1 text-title-large font-medium text-surface-on [max-line:1]">
        {{ detail?.user.name || '用户主页' }}
      </text>
    </view>

    <text v-if="errorMsg" class="text-body-small text-error p-4">{{ errorMsg }}</text>

    <text v-if="detailError" class="text-body-small text-error p-4">{{ detailError }}</text>

    <!-- 用户信息卡 -->
    <view v-if="detail" class="flex flex-row items-center m-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
      <SkeletonImage
        :src="proxyImageUrl(detail.user.profile_image_urls.medium || detail.user.profile_image_urls.px_170x170 || '')"
        aspect-ratio="1 / 1"
        min-h="16vw"
        class="w-[17.067vw] h-[17.067vw] rounded-full"
      />
      <view class="flex-1 flex flex-col ml-3.5">
        <text class="text-title-large font-bold text-surface-on">{{ detail.user.name }}</text>
        <text class="text-body-small text-outline mt-1">@{{ detail.user.account }}</text>
        <view class="flex flex-row mt-1.5">
          <view class="h-[8.533vw] px-2 border border-outline rounded-[var(--md-shape-small)] flex items-center justify-center bg-surface" @tap="openFollowing">
            <text class="text-label-medium text-surface-on-variant">
              关注 {{ detail.profile.total_follow_users ?? '-' }}
            </text>
          </view>
          <view class="h-[8.533vw] px-2 ml-2 border border-outline rounded-[var(--md-shape-small)] flex items-center justify-center bg-surface" @tap="openFollowers">
            <text class="text-label-medium text-surface-on-variant">粉丝</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 作品 tab -->
    <view class="flex flex-row border-b-[1px] border-b-outline-variant bg-surface-container-lowest">
      <view
        class="flex-1 h-[12.8vw] flex items-center justify-center"
        :class="activeTab === 'illust' ? 'text-primary border-b-[0.8vw] border-b-primary' : 'text-outline'"
        @tap="switchTab('illust')"
      >
        <text class="text-title-small font-medium">插画</text>
      </view>
      <view
        class="flex-1 h-[12.8vw] flex items-center justify-center"
        :class="activeTab === 'novel' ? 'text-primary border-b-[0.8vw] border-b-primary' : 'text-outline'"
        @tap="switchTab('novel')"
      >
        <text class="text-title-small font-medium">小说</text>
      </view>
    </view>

    <!-- 插画空态（错误态下不显示，避免与错误文本同显） -->
    <view v-if="activeTab === 'illust' && !illustLoading && !errorMsg && illusts.length === 0" class="flex-1 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">▦</text>
        <text class="text-body-large text-surface-on mt-3">暂无作品</text>
        <text class="text-body-medium text-surface-on-variant mt-1.5">该用户还没有发布作品</text>
      </view>
    </view>

    <!-- 插画 waterfall -->
    <RefreshableList
      v-if="activeTab === 'illust' && (illustLoading || illusts.length > 0)"
      :refreshing="illustRefreshing"
      @refresh="onRefreshIllust"
    >
    <list
      class="w-full flex-1"
      list-type="waterfall"
      scroll-orientation="vertical"
      :span-count="2"
      :style="{ listMainAxisGap: '12px', listCrossAxisGap: '12px' }"
      :lower-threshold-item-count="2"
      @scrolltolower="loadIllustMore"
    >
      <list-item
        v-for="item in illusts"
        :key="item.id"
        :item-key="String(item.id)"
        class="bg-surface-container-lowest rounded-[var(--md-shape-medium)] flex flex-col overflow-hidden shadow-[var(--md-elevation-1)]"
      >
        <view class="w-full flex flex-col" @tap="openIllust(item.id)">
          <view
            v-if="isRestricted(item)" @tap.stop
            class="w-full h-[48.4vw] flex items-center justify-center bg-[var(--md-scrim)] rounded-[var(--md-shape-medium)]"
          >
            <RestrictOverlay :overlay="false" :level="item.x_restrict === 2 ? 2 : 1" />
          </view>
          <view v-else class="relative" @tap.stop="onImageTap(item)">
            <SkeletonImage :src="thumbUrl(item.image_urls)" height="48.4vw" lazy-load />
          </view>
          <text class="text-title-small font-medium text-surface-on mt-2 mx-2.5 [max-line:1]">{{ item.title }}</text>
          <view class="mt-1 mx-2.5 mb-2.5">
            <BookmarkButton :illust-id="item.id" :initial-bookmarked="item.is_bookmarked" :bookmark-count="item.total_bookmarks" />
          </view>
        </view>
      </list-item>
      <list-item v-if="illustLoadingMore || illustPageErrorMsg || illustEndOfFeed" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text v-if="illustLoadingMore" class="text-body-medium text-outline">加载中…</text>
        <text v-else-if="illustPageErrorMsg" class="text-body-medium text-error">{{ illustPageErrorMsg }}</text>
        <text v-else class="text-body-medium text-outline">没有更多了</text>
      </list-item>
    </list>
    </RefreshableList>

    <!-- 小说空态 -->
    <view v-if="activeTab === 'novel' && !novelLoading && novels.length === 0" class="flex-1 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">▦</text>
        <text class="text-body-large text-surface-on mt-3">暂无作品</text>
        <text class="text-body-medium text-surface-on-variant mt-1.5">该用户还没有发布作品</text>
      </view>
    </view>

    <!-- 小说列表 -->
    <RefreshableList
      v-else-if="activeTab === 'novel' && (novelLoading || novels.length > 0)"
      :refreshing="novelRefreshing"
      @refresh="onRefreshNovel"
    >
    <list
      class="w-full flex-1"
      list-type="single"
      scroll-orientation="vertical"
      :lower-threshold-item-count="5"
      @scrolltolower="loadNovelMore"
    >
      <list-item
        v-for="item in novels"
        :key="item.id"
        :item-key="String(item.id)"
        class="w-full"
      >
        <RestrictedNovelCard v-if="isRestricted(item)" :item="item" />
        <view v-else class="relative flex flex-row items-start m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]" @tap="openNovel(item.id)"><view class="flex-1 flex flex-col">
                    <text class="text-title-medium font-medium text-surface-on [max-line:2]">{{ item.title }}</text>
                    <view class="flex flex-row mt-1.5">
                      <text class="text-label-medium text-outline mr-4">{{ item.text_length }} 字</text>
                      <text v-if="item.total_bookmarks > 0" class="text-label-medium text-outline mr-4">
                        ♥ {{ item.total_bookmarks }}
                      </text>
                    </view>
                  </view>
        
        </view>
      </list-item>
      <list-item v-if="novelLoadingMore || novelPageErrorMsg || novelEndOfFeed" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text v-if="novelLoadingMore" class="text-body-medium text-outline">加载中…</text>
        <text v-else-if="novelPageErrorMsg" class="text-body-medium text-error">{{ novelPageErrorMsg }}</text>
        <text v-else class="text-body-medium text-outline">没有更多了</text>
      </list-item>
    </list>
    </RefreshableList>
  </view>
</template>

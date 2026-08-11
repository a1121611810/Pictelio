<script setup lang="ts">
// 用户主页（P0-T1）：头像/名字/简介 + 插画/小说作品 tab。
// 不在 App.vue KeepAlive include 白名单（按 :id 加载，每次进入重新 mount——ADR-0049 语义）。
import { ref, onMounted } from 'vue'
import { currentParams, navigate, goBack } from '../router'
import { getUserDetail } from '../api/user'
import { loadUserIllusts, loadNext } from '../api/illust'
import { loadUserNovels, loadNovelNext } from '../api/novel'
import type { PixivUserDetailResponse, PixivIllust, PixivNovel } from '../api/types'
import { thumbUrl, proxyImageUrl } from '../utils/imageUrl'
import { presentError } from '../utils/errorPresentation'
import { isRestricted } from '../stores/settingsStore'
import SkeletonImage from '../components/SkeletonImage.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import RestrictOverlay from '../components/RestrictOverlay.vue'

const userId = Number(currentParams.value.id)

const detail = ref<PixivUserDetailResponse | null>(null)
const activeTab = ref<'illust' | 'novel'>('illust')
const errorMsg = ref('')
const detailError = ref('')

// ─── 插画作品（waterfall，对齐推荐页模式） ───
const illusts = ref<PixivIllust[]>([])
const illustNext = ref<string | null>(null)
const illustLoading = ref(false)
const illustLoadingMore = ref(false)

// ─── 小说作品（single 列表，对齐 NovelList 模式） ───
const novels = ref<PixivNovel[]>([])
const novelNext = ref<string | null>(null)
const novelLoading = ref(false)
const novelLoadingMore = ref(false)

// 插画/小说分页节流各自独立（切 tab 互不阻塞）
let lastIllustMoreAt = 0
let lastIllustEndedAt = 0
let lastNovelMoreAt = 0
let lastNovelEndedAt = 0

async function loadIllusts() {
  if (illusts.value.length > 0 || illustLoading.value) return // tab 数据按需加载一次
  illustLoading.value = true
  errorMsg.value = ''
  try {
    const res = await loadUserIllusts(userId)
    // issue #91：全量渲染，受限条目盖遮罩（不再过滤）
    illusts.value = res.illusts
    illustNext.value = res.next_url
  } catch (err) {
    errorMsg.value = presentError(err, '作品加载失败')
  } finally {
    illustLoading.value = false
  }
}

async function loadNovels() {
  if (novels.value.length > 0 || novelLoading.value) return
  novelLoading.value = true
  errorMsg.value = ''
  try {
    const res = await loadUserNovels(userId)
    novels.value = res.novels
    novelNext.value = res.next_url
  } catch (err) {
    errorMsg.value = presentError(err, '作品加载失败')
  } finally {
    novelLoading.value = false
  }
}

async function loadIllustMore() {
  const now = Date.now()
  if (now - lastIllustEndedAt < 3000) return
  if (now - lastIllustMoreAt < 800) return
  if (!illustNext.value || illustLoadingMore.value) return
  lastIllustMoreAt = now
  illustLoadingMore.value = true
  try {
    const res = await loadNext(illustNext.value)
    const seen = new Set(illusts.value.map((i) => i.id))
    const fresh = res.illusts.filter((i) => !seen.has(i.id))
    illusts.value.push(...fresh)
    // 空页防护：基于服务端原始返回判空（issue #91）
    illustNext.value = res.illusts.length === 0 ? null : res.next_url
  } catch (err) {
    errorMsg.value = presentError(err, '加载更多失败')
  } finally {
    illustLoadingMore.value = false
    lastIllustEndedAt = Date.now()
  }
}

async function loadNovelMore() {
  const now = Date.now()
  if (now - lastNovelEndedAt < 3000) return
  if (now - lastNovelMoreAt < 800) return
  if (!novelNext.value || novelLoadingMore.value) return
  lastNovelMoreAt = now
  novelLoadingMore.value = true
  try {
    const res = await loadNovelNext(novelNext.value)
    const seen = new Set(novels.value.map((n) => n.id))
    const fresh = res.novels.filter((n) => !seen.has(n.id))
    novels.value.push(...fresh)
    // 空页防护：基于服务端原始返回判空（issue #91）
    novelNext.value = res.novels.length === 0 ? null : res.next_url
  } catch (err) {
    errorMsg.value = presentError(err, '加载更多失败')
  } finally {
    novelLoadingMore.value = false
    lastNovelEndedAt = Date.now()
  }
}

function switchTab(tab: 'illust' | 'novel') {
  activeTab.value = tab
  if (tab === 'illust') void loadIllusts()
  else void loadNovels()
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
  void loadIllusts()
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
    <list
      v-if="activeTab === 'illust' && (illustLoading || illusts.length > 0)"
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
          <view class="relative" @tap.stop="onImageTap(item)">
            <SkeletonImage :src="thumbUrl(item.image_urls)" height="48.4vw" lazy-load />
            <!-- 受限条目图片区遮罩（issue #91） -->
            <RestrictOverlay v-if="isRestricted(item)" :level="item.x_restrict === 2 ? 2 : 1" />
          </view>
          <text class="text-title-small font-medium text-surface-on mt-2 mx-2.5 [max-line:1]">{{ item.title }}</text>
          <view class="mt-1 mx-2.5 mb-2.5">
            <BookmarkButton :illust-id="item.id" :initial-bookmarked="item.is_bookmarked" :bookmark-count="item.total_bookmarks" />
          </view>
        </view>
      </list-item>
      <list-item v-if="illustLoadingMore" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text class="text-body-medium text-outline">加载中…</text>
      </list-item>
    </list>

    <!-- 小说空态 -->
    <view v-if="activeTab === 'novel' && !novelLoading && novels.length === 0" class="flex-1 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">▦</text>
        <text class="text-body-large text-surface-on mt-3">暂无作品</text>
        <text class="text-body-medium text-surface-on-variant mt-1.5">该用户还没有发布作品</text>
      </view>
    </view>

    <!-- 小说列表 -->
    <list
      v-else-if="activeTab === 'novel' && (novelLoading || novels.length > 0)"
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
        <view class="relative flex flex-row items-start m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]" @tap="openNovel(item.id)">
          <view class="flex-1 flex flex-col">
            <text class="text-title-medium font-medium text-surface-on [max-line:2]">{{ item.title }}</text>
            <view class="flex flex-row mt-1.5">
              <text class="text-label-medium text-outline mr-4">{{ item.text_length }} 字</text>
              <text v-if="item.total_bookmarks > 0" class="text-label-medium text-outline mr-4">
                ♥ {{ item.total_bookmarks }}
              </text>
            </view>
          </view>
          <!-- 受限条目遮罩（issue #91） -->
          <RestrictOverlay v-if="isRestricted(item)" :level="item.x_restrict === 2 ? 2 : 1" />
        </view>
      </list-item>
      <list-item v-if="novelLoadingMore" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text class="text-body-medium text-outline">加载中…</text>
      </list-item>
    </list>
  </view>
</template>

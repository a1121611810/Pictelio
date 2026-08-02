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
import { filterByRestrict } from '../stores/settingsStore'
import SkeletonImage from '../components/SkeletonImage.vue'
import BookmarkButton from '../components/BookmarkButton.vue'

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
    illusts.value = filterByRestrict(res.illusts)
    illustNext.value = res.next_url
  } catch (err) {
    errorMsg.value = (err as { message?: string }).message ?? '作品加载失败'
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
    novels.value = filterByRestrict(res.novels)
    novelNext.value = res.next_url
  } catch (err) {
    errorMsg.value = (err as { message?: string }).message ?? '作品加载失败'
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
    const fresh = filterByRestrict(res.illusts).filter((i) => !seen.has(i.id))
    illusts.value.push(...fresh)
    illustNext.value = fresh.length === 0 ? null : res.next_url
  } catch (err) {
    errorMsg.value = (err as { message?: string }).message ?? '加载更多失败'
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
    const fresh = filterByRestrict(res.novels).filter((n) => !seen.has(n.id))
    novels.value.push(...fresh)
    novelNext.value = fresh.length === 0 ? null : res.next_url
  } catch (err) {
    errorMsg.value = (err as { message?: string }).message ?? '加载更多失败'
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
    detailError.value = (err as { message?: string }).message ?? '用户信息加载失败'
  }
  void loadIllusts()
})
</script>

<template>
  <view class="w-full h-full flex flex-col bg-background-2">
    <view class="flex flex-row items-center h-[11.733vw] px-4 bg-background border-b-[1px] border-b-stroke-2">
      <view class="py-1 pr-2" @tap="goBack"><text class="text-lg text-brand-foreground pr-4">‹ 返回</text></view>
      <text class="flex-1 text-2xl font-semibold text-foreground [max-line:1]">
        {{ detail?.user.name || '用户主页' }}
      </text>
    </view>

    <text v-if="errorMsg" class="text-sm text-danger p-4">{{ errorMsg }}</text>

    <text v-if="detailError" class="text-sm text-danger p-4">{{ detailError }}</text>

    <!-- 用户信息卡 -->
    <view v-if="detail" class="flex flex-row items-center m-3 p-3.5 bg-background rounded-[var(--borderRadiusXLarge)]">
      <SkeletonImage
        :src="proxyImageUrl(detail.user.profile_image_urls.medium || detail.user.profile_image_urls.px_170x170 || '')"
        aspect-ratio="1 / 1"
        min-h="16vw"
        class="w-[16vw] h-[16vw] rounded-[var(--borderRadiusLarge)]"
      />
      <view class="flex-1 flex flex-col ml-3.5">
        <text class="text-2xl font-bold text-foreground">{{ detail.user.name }}</text>
        <text class="text-sm text-foreground-3 mt-1">@{{ detail.user.account }}</text>
        <view class="flex flex-row mt-1.5">
          <view class="py-1 px-3 bg-background-3 rounded-[var(--borderRadiusMedium)]" @tap="openFollowing">
            <text class="text-xs text-foreground">
              关注 {{ detail.profile.total_follow_users ?? '-' }}
            </text>
          </view>
          <view class="py-1 px-3 ml-2 bg-background-3 rounded-[var(--borderRadiusMedium)]" @tap="openFollowers">
            <text class="text-xs text-foreground">粉丝</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 作品 tab -->
    <view class="flex flex-row border-b-[1px] border-b-stroke-2 bg-background">
      <view
        class="flex-1 py-2 flex items-center justify-center"
        :class="activeTab === 'illust' ? 'text-brand-foreground border-b-2 border-b-[var(--colorBrandForeground1)]' : 'text-foreground-3'"
        @tap="switchTab('illust')"
      >
        <text class="text-lg font-medium">插画</text>
      </view>
      <view
        class="flex-1 py-2 flex items-center justify-center"
        :class="activeTab === 'novel' ? 'text-brand-foreground border-b-2 border-b-[var(--colorBrandForeground1)]' : 'text-foreground-3'"
        @tap="switchTab('novel')"
      >
        <text class="text-lg font-medium">小说</text>
      </view>
    </view>

    <!-- 插画空态 -->
    <view v-if="activeTab === 'illust' && !illustLoading && illusts.length === 0" class="flex-1 flex items-center justify-center">
      <text class="text-base text-foreground-3">暂无作品</text>
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
        class="bg-background rounded-[var(--borderRadiusXLarge)] flex flex-col overflow-hidden"
      >
        <view class="w-full flex flex-col" @tap="openIllust(item.id)">
          <SkeletonImage :src="thumbUrl(item.image_urls)" aspect-ratio="1 / 1" min-h="40vw" />
          <text class="text-lg font-semibold text-foreground mt-2 mx-2.5 [max-line:1]">{{ item.title }}</text>
          <view class="mt-1 mx-2.5 mb-2.5">
            <BookmarkButton :illust-id="item.id" :initial-bookmarked="item.is_bookmarked" :bookmark-count="item.total_bookmarks" />
          </view>
        </view>
      </list-item>
      <list-item v-if="illustLoadingMore" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text class="text-base text-foreground-3">加载中…</text>
      </list-item>
    </list>

    <!-- 小说空态 -->
    <view v-if="activeTab === 'novel' && !novelLoading && novels.length === 0" class="flex-1 flex items-center justify-center">
      <text class="text-base text-foreground-3">暂无作品</text>
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
        <view class="flex flex-row items-start m-1.5 mx-3 p-3.5 bg-background rounded-[var(--borderRadiusXLarge)]" @tap="openNovel(item.id)">
          <view class="flex-1 flex flex-col">
            <text class="text-xl font-semibold text-foreground [max-line:2]">{{ item.title }}</text>
            <view class="flex flex-row mt-1.5">
              <text class="text-xs text-foreground-3 mr-4">{{ item.text_length }} 字</text>
              <text v-if="item.total_bookmarks > 0" class="text-xs text-foreground-3 mr-4">
                ♥ {{ item.total_bookmarks }}
              </text>
            </view>
          </view>
        </view>
      </list-item>
      <list-item v-if="novelLoadingMore" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text class="text-base text-foreground-3">加载中…</text>
      </list-item>
    </list>
  </view>
</template>

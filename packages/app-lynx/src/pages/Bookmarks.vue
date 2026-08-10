<script setup lang="ts">
// 收藏列表（P0-T6）：当前登录用户的收藏，插画/小说 tab 切换，可取消收藏。
// 不进 KeepAlive 白名单（每次进入重新挂载）。
import { ref, onMounted } from 'vue'
import { navigate, goBack } from '../router'
import { loadBookmarks as loadIllustBookmarks, loadNext } from '../api/illust'
import { loadBookmarks as loadNovelBookmarks, loadNovelNext } from '../api/novel'
import type { PixivIllust, PixivNovel } from '../api/types'
import { currentUser } from '../stores/authStore'
import { presentError } from '../utils/errorPresentation'
import { thumbUrl } from '../utils/imageUrl'
import { isRestricted } from '../stores/settingsStore'
import SkeletonImage from '../components/SkeletonImage.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import RestrictOverlay from '../components/RestrictOverlay.vue'

const uid = currentUser.value?.id
if (!uid) {
  void navigate('/login', { replace: true })
}

const activeTab = ref<'illust' | 'novel'>('illust')
const errorMsg = ref('')

// ─── 插画收藏（waterfall） ───
const illusts = ref<PixivIllust[]>([])
const illustNext = ref<string | null>(null)
const illustLoading = ref(false)
const illustLoadingMore = ref(false)

// ─── 小说收藏（single） ───
const novels = ref<PixivNovel[]>([])
const novelNext = ref<string | null>(null)
const novelLoading = ref(false)
const novelLoadingMore = ref(false)

// 插画/小说分页节流各自独立
let lastIllustMoreAt = 0
let lastIllustEndedAt = 0
let lastNovelMoreAt = 0
let lastNovelEndedAt = 0

async function loadIllusts() {
  if (!uid) return // 防御：未登录（正常链路从 Me 进入必有 uid）
  if (illusts.value.length > 0 || illustLoading.value) return
  illustLoading.value = true
  errorMsg.value = ''
  try {
    const res = await loadIllustBookmarks(uid!)
    // issue #91：全量渲染，受限条目盖遮罩（不再过滤）
    illusts.value = res.illusts
    illustNext.value = res.next_url
  } catch (err) {
    errorMsg.value = presentError(err, '收藏加载失败')
  } finally {
    illustLoading.value = false
  }
}

async function loadNovels() {
  if (!uid) return
  if (novels.value.length > 0 || novelLoading.value) return
  novelLoading.value = true
  errorMsg.value = ''
  try {
    const res = await loadNovelBookmarks(uid!)
    novels.value = res.novels
    novelNext.value = res.next_url
  } catch (err) {
    errorMsg.value = presentError(err, '收藏加载失败')
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

// 取消收藏后从列表移除（BookmarkButton change 事件）
function onBookmarkChange(item: PixivIllust, bookmarked: boolean) {
  if (!bookmarked) {
    illusts.value = illusts.value.filter((i) => i.id !== item.id)
  }
}

onMounted(() => {
  void loadIllusts()
})
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <view class="flex flex-row items-center h-[17.067vw] px-4 bg-surface">
      <view class="py-1 pr-2" @tap="goBack"><text class="text-[6.4vw] leading-none text-on-surface">‹</text></view>
      <text class="flex-1 text-title-large font-medium text-on-surface">收藏</text>
    </view>

    <text v-if="errorMsg" class="text-body-small text-error p-4">{{ errorMsg }}</text>

    <!-- 插画/小说 tab -->
    <view class="flex flex-row border-b-[1px] border-b-outline-variant bg-surface-container-lowest">
      <view
        class="flex-1 py-2 flex items-center justify-center"
        :class="activeTab === 'illust' ? 'text-primary border-b-2 border-b-primary' : 'text-outline'"
        @tap="switchTab('illust')"
      >
        <text class="text-title-small font-medium">插画</text>
      </view>
      <view
        class="flex-1 py-2 flex items-center justify-center"
        :class="activeTab === 'novel' ? 'text-primary border-b-2 border-b-primary' : 'text-outline'"
        @tap="switchTab('novel')"
      >
        <text class="text-title-small font-medium">小说</text>
      </view>
    </view>

    <!-- 插画空态 -->
    <view v-if="activeTab === 'illust' && !illustLoading && !errorMsg && illusts.length === 0" class="flex-1 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">♡</text>
        <text class="text-body-large text-on-surface mt-3">暂无收藏</text>
        <text class="text-body-medium text-on-surface-variant mt-1.5">收藏喜欢的作品后会展示在这里</text>
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
        class="bg-surface-container-lowest rounded-[var(--md-shape-medium)] flex flex-col overflow-hidden"
      >
        <view class="w-full flex flex-col" @tap="openIllust(item.id)">
          <view class="relative" @tap.stop="onImageTap(item)">
            <SkeletonImage :src="thumbUrl(item.image_urls)" height="48.4vw" lazy-load />
            <!-- 受限条目图片区遮罩（issue #91） -->
            <RestrictOverlay v-if="isRestricted(item)" :level="item.x_restrict === 2 ? 2 : 1" />
          </view>
          <text class="text-title-small font-medium text-on-surface mt-2 mx-2.5 [max-line:1]">{{ item.title }}</text>
          <text class="text-body-small text-on-surface-variant mt-1 mx-2.5 [max-line:1]">{{ item.user.name }}</text>
          <view class="mt-1 mx-2.5 mb-2.5">
            <BookmarkButton
              :illust-id="item.id"
              :initial-bookmarked="item.is_bookmarked"
              :bookmark-count="item.total_bookmarks"
              @change="(bm) => onBookmarkChange(item, bm)"
            />
          </view>
        </view>
      </list-item>
      <list-item v-if="illustLoadingMore" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text class="text-body-medium text-outline">加载中…</text>
      </list-item>
    </list>

    <!-- 小说空态 -->
    <view v-if="activeTab === 'novel' && !novelLoading && !errorMsg && novels.length === 0" class="flex-1 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">♡</text>
        <text class="text-body-large text-on-surface mt-3">暂无收藏</text>
        <text class="text-body-medium text-on-surface-variant mt-1.5">收藏喜欢的作品后会展示在这里</text>
      </view>
    </view>

    <!-- 小说列表 -->
    <list
      v-if="activeTab === 'novel' && (novelLoading || novels.length > 0)"
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
        <view class="relative flex flex-row items-start m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)]" @tap="openNovel(item.id)">
          <view class="flex-1 flex flex-col">
            <text class="text-title-medium font-medium text-on-surface [max-line:2]">{{ item.title }}</text>
            <text class="text-body-medium text-on-surface-variant mt-1.5">by {{ item.user.name }}</text>
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

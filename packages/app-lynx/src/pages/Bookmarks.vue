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
  <view class="w-full h-full flex flex-col bg-background-2">
    <view class="flex flex-row items-center h-[11.733vw] px-4 bg-background border-b-[1px] border-b-stroke-2">
      <view class="py-1 pr-2" @tap="goBack"><text class="text-lg text-brand-foreground pr-4">‹ 返回</text></view>
      <text class="flex-1 text-2xl font-semibold text-foreground">收藏</text>
    </view>

    <text v-if="errorMsg" class="text-sm text-danger p-4">{{ errorMsg }}</text>

    <!-- 插画/小说 tab -->
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
    <view v-if="activeTab === 'illust' && !illustLoading && !errorMsg && illusts.length === 0" class="flex-1 flex items-center justify-center">
      <text class="text-base text-foreground-3">暂无收藏</text>
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
          <view class="relative" @tap.stop="onImageTap(item)">
            <SkeletonImage :src="thumbUrl(item.image_urls)" height="48.4vw" lazy-load />
            <!-- 受限条目图片区遮罩（issue #91） -->
            <RestrictOverlay v-if="isRestricted(item)" :level="item.x_restrict === 2 ? 2 : 1" />
          </view>
          <text class="text-lg font-semibold text-foreground mt-2 mx-2.5 [max-line:1]">{{ item.title }}</text>
          <text class="text-sm text-foreground-2 mt-1 mx-2.5 [max-line:1]">{{ item.user.name }}</text>
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
        <text class="text-base text-foreground-3">加载中…</text>
      </list-item>
    </list>

    <!-- 小说空态 -->
    <view v-if="activeTab === 'novel' && !novelLoading && !errorMsg && novels.length === 0" class="flex-1 flex items-center justify-center">
      <text class="text-base text-foreground-3">暂无收藏</text>
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
        <view class="relative flex flex-row items-start m-1.5 mx-3 p-3.5 bg-background rounded-[var(--borderRadiusXLarge)]" @tap="openNovel(item.id)">
          <view class="flex-1 flex flex-col">
            <text class="text-xl font-semibold text-foreground [max-line:2]">{{ item.title }}</text>
            <text class="text-sm text-brand-foreground mt-1.5">by {{ item.user.name }}</text>
            <view class="flex flex-row mt-1.5">
              <text class="text-xs text-foreground-3 mr-4">{{ item.text_length }} 字</text>
              <text v-if="item.total_bookmarks > 0" class="text-xs text-foreground-3 mr-4">
                ♥ {{ item.total_bookmarks }}
              </text>
            </view>
          </view>
          <!-- 受限条目遮罩（issue #91） -->
          <RestrictOverlay v-if="isRestricted(item)" :level="item.x_restrict === 2 ? 2 : 1" />
        </view>
      </list-item>
      <list-item v-if="novelLoadingMore" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text class="text-base text-foreground-3">加载中…</text>
      </list-item>
    </list>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { currentParams, navigate, goBack } from '../router'
import { loadDetail } from '../api/illust'
import { followUser, unfollowUser } from '../api/user'
import { currentUser } from '../stores/authStore'
import type { PixivIllust } from '../api/types'
import { proxyImageUrl } from '../utils/imageUrl'
import { resolveQualityUrl } from '../utils/imageQuality'
import { detailImageHeightVw } from '../utils/imageLayout'
import { presentError } from '../utils/errorPresentation'
import { detailQuality } from '../stores/settingsStore'
import BookmarkButton from '../components/BookmarkButton.vue'
import CommentOverlay from '../components/CommentOverlay.vue'
import SkeletonImage from '../components/SkeletonImage.vue'
import UgoiraViewer from '../components/UgoiraViewer.vue'

const illust = ref<PixivIllust | null>(null)
const loading = ref(true)
const errorMsg = ref('')
const currentPage = ref(0)

// ─── 评论弹层（issue #164）：入口在收藏操作行；弹层挂根 view 内、scroll-view 之后 ───
const showComments = ref(false)

// ─── 关注作者（P0-T3） ───
const following = ref(false)
const followBusy = ref(false)
const followError = ref('') // 独立于 errorMsg——避免关注失败击穿已加载的详情页

const isSelfAuthor = computed(() => currentUser.value?.id === illust.value?.user.id)

async function toggleFollowAuthor() {
  if (followBusy.value || !illust.value) return
  followBusy.value = true
  followError.value = ''
  try {
    if (following.value) {
      await unfollowUser(illust.value.user.id)
      following.value = false
    } else {
      await followUser(illust.value.user.id)
      following.value = true
    }
  } catch {
    followError.value = '操作失败'
  } finally {
    followBusy.value = false
  }
}

const illustId = computed(() => Number(currentParams.value.id ?? 0))

// 多页作品：meta_pages 或单页
// [fix] 单页作品直接返回完整 image_urls（medium/large 正常档位）——
// 此前把 original_image_url 塞进 large 导致 medium 档 fallback 到原图
// （下载体积大 + 易超时，模拟器实测 img-original timeout）。original 档
// 由 currentImage 的 originalImageUrl 参数单独兜底。
const pages = computed(() => {
  if (!illust.value) return []
  if (illust.value.meta_pages?.length) {
    return illust.value.meta_pages.map((p) => p.image_urls)
  }
  return [illust.value.image_urls]
})

// [spec] 详情比例显示：容器高度按原图宽高比换算的显式 vw（不封顶）；
// 容器 / ugoira 占位 / 图片骨架三处共用同一高度，避免重复计算
const detailImageHeight = computed(() =>
  detailImageHeightVw(illust.value?.width, illust.value?.height),
)

const currentImage = computed(() => {
  const list = pages.value
  if (!list.length) return ''
  const page = list[Math.min(currentPage.value, list.length - 1)]
  // issue #148 T2：按档位解析（medium/large/original）。单页 original 场景下 page 可能只有
  // large 字段，resolveQualityUrl 的 original 档由 meta_single_page.original_image_url 兜底。
  const resolved = resolveQualityUrl(
    page,
    detailQuality.value,
    illust.value?.meta_single_page?.original_image_url,
  )
  return proxyImageUrl(resolved)
})

function openAuthor() {
  void navigate(`/user/${illust.value.user.id}`)
}

function nextPage() {
  if (currentPage.value < pages.value.length - 1) currentPage.value += 1
}
function prevPage() {
  if (currentPage.value > 0) currentPage.value -= 1
}

onMounted(async () => {
  try {
    const res = await loadDetail(illustId.value)
    illust.value = res.illust
    // P0-T3：同步作者关注状态（详情 API 可能不返回 is_followed，缺省 false）
    following.value = !!res.illust.user.is_followed
  } catch (err) {
    errorMsg.value = presentError(err, '加载失败')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <!-- [lynx:fix] 顶栏 tap 修复（issue #139）：外层显式 flex flex-col，scroll-view flex-1 min-h-0 约束在顶栏下方，
       避免 w-full h-full 溢出覆盖顶栏触摸层（与 issue #129 同型） -->
  <!-- relative：为根 view 内 absolute 的评论弹层提供定位上下文（不改 flex 布局） -->
  <view class="w-full h-full flex flex-col relative bg-background-2">
    <view class="flex flex-row items-center h-[11.733vw] px-4 bg-background border-b-[1px] border-b-stroke-2">
      <view class="py-1 pr-2" @tap="goBack"><text class="text-lg text-brand-foreground pr-4">‹ 返回</text></view>
      <text class="flex-1 text-2xl font-semibold text-foreground">作品详情</text>
    </view>

    <!-- [lynx:fix] 骨架屏：加载中显示 shimmer 占位（图片区 1:1 + 文字条），数据就绪后切换 scroll-view -->
    <view v-if="loading" class="w-full flex-1 min-h-0 bg-background-2">
      <view class="shimmer aspect-[1/1] w-full" />
      <view class="p-4">
        <view class="shimmer h-[32rpx] rounded-[var(--borderRadiusSmall)] w-[75%]" />
        <view class="shimmer h-[24rpx] rounded-[var(--borderRadiusSmall)] mt-2 w-[40%]" />
        <view class="shimmer h-[24rpx] rounded-[var(--borderRadiusSmall)] mt-1.5 w-[60%]" />
      </view>
    </view>
    <view v-else-if="errorMsg" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <text class="text-base text-danger p-4">{{ errorMsg }}</text>
    </view>
    <scroll-view v-else-if="illust" class="w-full flex-1 min-h-0" scroll-orientation="vertical">
      <!-- [spec] 详情大图：按原图宽高比撑开高度（显式 vw，不封顶，与 webview client 一致），
           原生 LynxView 不支持动态 aspect-ratio style（ADR-0055 §2），显式高度已验证（issue #138）。
           图片级骨架屏（SkeletonImage）：@load 前 shimmer、@error 显示「图片加载失败」，不启用 lazy-load -->
      <view class="relative w-full bg-background-3 overflow-hidden" :style="{ height: detailImageHeight }">
        <!-- T5：ugoira 动图用播放器；普通作品用静态大图 -->
        <UgoiraViewer
          v-if="illust.type === 'ugoira'"
          :illust-id="illust.id"
          :height-vw="detailImageHeight"
        />
        <SkeletonImage
          v-else-if="currentImage"
          :src="currentImage"
          :height="detailImageHeight"
        />
      </view>
      <view v-if="pages.length > 1" class="flex flex-row items-center justify-center p-3">
        <view class="py-1 pr-2" @tap="prevPage"><text class="text-4xl text-brand-foreground py-2 px-6">‹</text></view>
        <text class="text-base text-foreground-2 mx-4">{{ currentPage + 1 }} / {{ pages.length }}</text>
        <view class="py-2 px-3" @tap="nextPage"><text class="text-4xl text-brand-foreground py-2 px-6">›</text></view>
      </view>
      <view class="p-4 bg-background">
        <text class="text-3xl font-bold text-foreground">{{ illust.title }}</text>
        <view class="flex flex-row items-center mt-2" @tap="openAuthor">
          <SkeletonImage
            v-if="illust.user.profile_image_urls"
            :src="proxyImageUrl(illust.user.profile_image_urls.medium || illust.user.profile_image_urls.px_170x170 || '')"
            aspect-ratio="1 / 1"
            min-h="9vw"
            class="w-[9vw] h-[9vw] rounded-[var(--borderRadiusLarge)]"
          />
          <text class="text-lg text-brand-foreground ml-2 flex-1">by {{ illust.user.name }}</text>
          <!-- P0-T3：关注作者（非本人时显示） -->
          <view
            v-if="!isSelfAuthor"
            class="px-4 h-[8vw] flex items-center justify-center rounded-[var(--borderRadiusLarge)]"
            :class="following ? 'bg-background-3' : 'bg-brand'"
            @tap.stop="toggleFollowAuthor"
          >
            <text class="text-base" :class="following ? 'text-foreground' : 'text-onBrand'">
              {{ following ? '已关注' : '关注' }}
            </text>
          </view>
        </view>
        <text v-if="followError" class="text-xs text-danger mt-1">{{ followError }}</text>
        <text class="text-sm text-foreground-3 mt-1.5">{{ illust.width }} × {{ illust.height }}</text>
        <view class="mt-2 flex flex-row items-center">
          <BookmarkButton
            :illust-id="illust.id"
            :initial-bookmarked="illust.is_bookmarked"
            :bookmark-count="illust.total_bookmarks"
          />
          <!-- 评论入口（issue #164）：样式对齐 webview 版（💬 + total_comments，字段缺失时不显示） -->
          <view
            v-if="illust.total_comments !== undefined"
            class="ml-4 flex flex-row items-center"
            @tap="showComments = true"
          >
            <text class="text-xl">💬</text>
            <text class="text-xs text-foreground-3 ml-1">{{ illust.total_comments }}</text>
          </view>
        </view>
        <view class="flex flex-row flex-wrap mt-3">
          <text
            v-for="tag in illust.tags.slice(0, 8)"
            :key="tag.name"
            class="text-xs text-brand-foreground bg-background-3 rounded-[var(--borderRadiusMedium)] px-2.5 py-1 m-1"
          >
            #{{ tag.translated_name || tag.name }}
          </text>
        </view>
      </view>
    </scroll-view>

    <!-- 评论弹层（issue #164）：absolute 脱离 flex 流全屏覆盖；DOM 顺序在 scroll-view 之后
         且不动其结构（issue #139/#129 修复保持）。覆盖层形态 → 弹层打开时页面滚动位置不丢失 -->
    <view v-if="showComments" class="absolute inset-0">
      <CommentOverlay type="illust" :target-id="illustId" @close="showComments = false" />
    </view>
  </view>
</template>

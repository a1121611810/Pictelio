<script setup lang="ts">
// 关注/粉丝列表（P0-T2）：/user/:id/following 与 /user/:id/followers 共用组件，
// 按路由 name 区分；列表内可关注/取关。不进 KeepAlive 白名单（每次进入重新挂载）。
import { ref, computed, onMounted } from 'vue'
import { currentParams, routeState, navigate, goBack } from '../router'
import {
  getUserFollowing,
  getUserFollowers,
  loadUserListNext,
  followUser,
  unfollowUser,
} from '../api/user'
import type { PixivUserPreview } from '../api/types'
import { proxyImageUrl } from '../utils/imageUrl'
import SkeletonImage from '../components/SkeletonImage.vue'

const userId = Number(currentParams.value.id)
const isFollowing = computed(() => routeState.value.name === 'user-following')

const users = ref<PixivUserPreview[]>([])
const nextUrl = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')
const busyId = ref<number | null>(null)

// [lynx:fix] loadMore 双重防抖（与 Recommended 同款，ADR-0045）
let lastLoadMoreAt = 0
let lastLoadEndedAt = 0

async function fetchFirstPage() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = isFollowing.value ? await getUserFollowing(userId) : await getUserFollowers(userId)
    // 关注列表里的用户本就已关注，但 API 的 is_followed 可能不返回（undefined→falsy 会误显示"关注"按钮）
    users.value = res.user_previews.map((u) => {
      if (isFollowing.value && u.user.is_followed === undefined) u.user.is_followed = true
      return u
    })
    nextUrl.value = res.next_url
  } catch (err) {
    errorMsg.value = (err as { message?: string }).message ?? '加载失败'
  } finally {
    loading.value = false
    lastLoadEndedAt = Date.now()
  }
}

async function loadMore() {
  const now = Date.now()
  if (now - lastLoadEndedAt < 3000) return
  if (now - lastLoadMoreAt < 800) return
  if (!nextUrl.value || loadingMore.value) return
  lastLoadMoreAt = now
  loadingMore.value = true
  try {
    const res = await loadUserListNext(nextUrl.value)
    const seen = new Set(users.value.map((u) => u.user.id))
    const fresh = res.user_previews.filter((u) => !seen.has(u.user.id)).map((u) => {
      if (isFollowing.value && u.user.is_followed === undefined) u.user.is_followed = true
      return u
    })
    users.value.push(...fresh)
    nextUrl.value = fresh.length === 0 ? null : res.next_url
  } catch (err) {
    errorMsg.value = (err as { message?: string }).message ?? '加载更多失败'
  } finally {
    loadingMore.value = false
    lastLoadEndedAt = Date.now()
  }
}

async function toggleFollow(user: PixivUserPreview) {
  if (busyId.value !== null) return
  busyId.value = user.user.id
  try {
    if (user.user.is_followed) {
      await unfollowUser(user.user.id)
      user.user.is_followed = false
    } else {
      await followUser(user.user.id)
      user.user.is_followed = true
    }
  } catch {
    errorMsg.value = '操作失败'
  } finally {
    busyId.value = null
  }
}

function openUser(id: number) {
  void navigate(`/user/${id}`)
}

onMounted(fetchFirstPage)
</script>

<template>
  <view class="w-full h-full flex flex-col bg-background-2">
    <view class="flex flex-row items-center h-[11.733vw] px-4 bg-background border-b-[1px] border-b-stroke-2">
      <view class="py-1 pr-2" @tap="goBack"><text class="text-lg text-brand-foreground pr-4">‹ 返回</text></view>
      <text class="flex-1 text-2xl font-semibold text-foreground">{{ isFollowing ? '关注' : '粉丝' }}</text>
    </view>

    <text v-if="errorMsg && !loading" class="text-sm text-danger p-4">{{ errorMsg }}</text>

    <view v-if="!loading && !errorMsg && users.length === 0" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <text class="text-base text-foreground-3">{{ isFollowing ? '暂无关注' : '暂无粉丝' }}</text>
    </view>

    <list
      v-if="!loading || users.length > 0"
      class="w-full flex-1 min-h-0"
      list-type="single"
      scroll-orientation="vertical"
      :lower-threshold-item-count="5"
      @scrolltolower="loadMore"
    >
      <list-item
        v-for="item in users"
        :key="item.user.id"
        :item-key="String(item.user.id)"
        class="w-full"
      >
        <view class="flex flex-row items-center m-1.5 mx-3 p-3.5 bg-background rounded-[var(--borderRadiusXLarge)]">
          <view class="flex-1 flex flex-row items-center" @tap="openUser(item.user.id)">
            <SkeletonImage
              :src="proxyImageUrl(item.user.profile_image_urls?.medium || item.user.profile_image_urls?.px_170x170 || '')"
              aspect-ratio="1 / 1"
              min-h="11vw"
              class="w-[11vw] h-[11vw] rounded-[var(--borderRadiusLarge)]"
              lazy-load
            />
            <view class="flex flex-col ml-3.5 flex-1">
              <text class="text-lg font-semibold text-foreground [max-line:1]">{{ item.user.name }}</text>
              <text class="text-xs text-foreground-3 mt-0.5">@{{ item.user.account }}</text>
            </view>
          </view>
          <view
            class="ml-2 px-4 h-[9vw] flex items-center justify-center rounded-[var(--borderRadiusLarge)]"
            :class="item.user.is_followed ? 'bg-background-3' : 'bg-brand'"
            @tap="toggleFollow(item)"
          >
            <text class="text-base" :class="item.user.is_followed ? 'text-foreground' : 'text-onBrand'">
              {{ item.user.is_followed ? '已关注' : '关注' }}
            </text>
          </view>
        </view>
      </list-item>
      <list-item v-if="loadingMore" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text class="text-base text-foreground-3">加载中…</text>
      </list-item>
    </list>
  </view>
</template>

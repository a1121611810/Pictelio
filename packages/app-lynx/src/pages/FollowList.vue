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
import { presentError } from '../utils/errorPresentation'
import { deriveFirstLoadView } from '../utils/firstLoadView'
import SkeletonImage from '../components/SkeletonImage.vue'
import RefreshableList from '../components/RefreshableList.vue'
import { t } from '../i18n'

const userId = Number(currentParams.value.id)
const isFollowing = computed(() => routeState.value.name === 'user-following')

const users = ref<PixivUserPreview[]>([])
const nextUrl = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')
/** 有数据时的刷新 / 分页失败错误文案（内联错误条，ADR-0104 槽位分离；防静默吞错） */
const pageErrorMsg = ref('')
const busyId = ref<number | null>(null)
/** 首载是否已成功落定（成功含 0 条）——三态判定输入（ADR-0150） */
const settled = ref(false)

/** 页级首载三态（ADR-0150）：骨架 / 错误 / 空态 / 内容 的唯一判定源 */
const view = computed(() =>
  deriveFirstLoadView({
    hasItems: users.value.length > 0,
    loading: loading.value,
    settled: settled.value,
    hasError: !!errorMsg.value,
  }),
)

// [lynx:fix] loadMore 双重防抖（与 Recommended 同款，ADR-0045）
let lastLoadMoreAt = 0
let lastLoadEndedAt = 0

async function fetchFirstPage() {
  loading.value = true
  settled.value = false // 新会话 / 重试：回到未落定（骨架）
  errorMsg.value = ''
  pageErrorMsg.value = ''
  try {
    const res = isFollowing.value ? await getUserFollowing(userId) : await getUserFollowers(userId)
    // 关注列表里的用户本就已关注，但 API 的 is_followed 可能不返回（undefined→falsy 会误显示"关注"按钮）
    users.value = res.user_previews.map((u) => {
      if (isFollowing.value && u.user.is_followed === undefined) u.user.is_followed = true
      return u
    })
    nextUrl.value = res.next_url
    settled.value = true // 成功返回（含 0 条）= 已落定
    // [lynx:fix] 数据整体替换触发 vue-lynx patch RemoveNode 索引错位（框架 bug，ADR-0107 D4）；
    // epoch 与 users 替换同 tick flush（key 变化走整树替换，不发生子节点 patch）
    refreshEpoch.value++
  } catch (err) {
    const msg = presentError(err, t('error.fallback.loadFailed'))
    // 有数据（刷新失败）→ 内联错误条；无数据（首载失败）→ 首屏错误分支（ADR-0104 槽位分离）
    if (users.value.length > 0) pageErrorMsg.value = msg
    else errorMsg.value = msg
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
  pageErrorMsg.value = ''
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
    pageErrorMsg.value = presentError(err, t('followList.loadMoreFailed'))
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
    // 操作失败必须可见：errorMsg 在三态链中仅「无数据」时渲染，动作失败时列表非空 → 走内联错误条
    pageErrorMsg.value = t('followList.actionFailed') // i18n: 赋值时快照（瞬态）
  } finally {
    busyId.value = null
  }
}

function openUser(id: number) {
  void navigate(`/user/${id}`)
}

onMounted(fetchFirstPage)
// 刷新入口（ADR-0107）：fetchFirstPage 幂等（重置 users/nextUrl/errorMsg），
// 直接绑定 RefreshableList :refresh；刷新状态机内收组件，页面零自持刷新态

/** list 强制重建代（fetchFirstPage 成功后 ++，驱动 :key 替换） */
const refreshEpoch = ref(0)
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <view class="flex flex-row items-center h-[17.067vw] px-4 bg-surface">
      <view class="py-1 pr-2" @tap="goBack"><text class="text-[6.4vw] leading-none text-surface-on">‹</text></view>
      <text class="flex-1 text-title-large font-medium text-surface-on">{{ isFollowing ? t('followList.title.following') : t('followList.title.followers') }}</text>
    </view>

    <!-- 有数据时的内联错误（刷新 / 分页失败）：不吞错、不打乱三态判定（ADR-0104 槽位分离） -->
    <text v-if="pageErrorMsg" class="text-body-small text-error p-4">{{ pageErrorMsg }}</text>

    <!-- 首载三态（ADR-0150）：骨架 → 错误 → 空态 → 内容，互斥单链；不依赖 loading 标志 -->
    <view v-if="view === 'skeleton'" class="w-full flex-1 min-h-0">
      <view v-for="n in 8" :key="n" class="flex flex-row items-center m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <view class="shimmer w-[10.667vw] h-[10.667vw] rounded-full" />
        <view class="flex flex-col ml-3.5 flex-1">
          <view class="shimmer h-[28rpx] rounded-[var(--md-shape-extra-small)] w-[45%]" />
          <view class="shimmer h-[22rpx] rounded-[var(--md-shape-extra-small)] mt-2 w-[30%]" />
        </view>
        <view class="shimmer w-[16vw] h-[10.667vw] rounded-[var(--md-shape-full)]" />
      </view>
    </view>
    <view v-else-if="view === 'error'" class="w-full flex-1 min-h-0 flex flex-col items-center justify-center px-8">
      <text class="text-body-small text-error text-center">{{ errorMsg }}</text>
      <view
        class="mt-4 px-6 h-[10.667vw] bg-primary active:bg-state-pressed-primary rounded-[var(--md-shape-full)] flex items-center justify-center"
        @tap="fetchFirstPage"
      >
        <text class="text-label-large font-medium text-primary-on">{{ t('followList.retry') }}</text>
      </view>
    </view>
    <view v-else-if="view === 'empty'" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">◎</text>
        <text class="text-body-large text-surface-on mt-3">{{ isFollowing ? t('followList.empty.following') : t('followList.empty.followers') }}</text>
        <text class="text-body-medium text-surface-on-variant mt-1.5">{{ isFollowing ? t('followList.empty.followingHint') : t('followList.empty.followersHint') }}</text>
      </view>
    </view>

    <RefreshableList v-else :refresh="fetchFirstPage" @back-to-top="refreshEpoch++">
    <template #default="{ onScroll }">
    <list
      :key="refreshEpoch"
      class="w-full h-full"
      list-type="single"
      scroll-orientation="vertical"
      :lower-threshold-item-count="5"
      :scroll-event-throttle="0"
      @scrolltolower="loadMore"
      @scroll="onScroll"
    >
      <list-item
        v-for="item in users"
        :key="item.user.id"
        :item-key="String(item.user.id)"
        class="w-full"
      >
        <view class="flex flex-row items-center m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
          <view class="flex-1 flex flex-row items-center" @tap="openUser(item.user.id)">
            <SkeletonImage
              :src="proxyImageUrl(item.user.profile_image_urls?.medium || item.user.profile_image_urls?.px_170x170 || '')"
              aspect-ratio="1 / 1"
              min-h="11vw"
              class="w-[10.667vw] h-[10.667vw] rounded-full"
              lazy-load
            />
            <view class="flex flex-col ml-3.5 flex-1">
              <text class="text-title-small font-medium text-surface-on [max-line:1]">{{ item.user.name }}</text>
              <text class="text-label-medium text-outline mt-0.5">@{{ item.user.account }}</text>
            </view>
          </view>
          <view
            class="ml-2 px-4 h-[10.667vw] flex items-center justify-center rounded-[var(--md-shape-full)]"
            :class="item.user.is_followed ? 'border border-outline bg-transparent active:bg-layer-pressed-primary' : 'bg-primary active:bg-state-pressed-primary'"
            @tap="toggleFollow(item)"
          >
            <text class="text-body-medium" :class="item.user.is_followed ? 'text-primary' : 'text-primary-on'">
              {{ item.user.is_followed ? t('followList.following') : t('followList.follow') }}
            </text>
          </view>
        </view>
      </list-item>
      <list-item v-if="loadingMore" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text class="text-body-medium text-outline">{{ t('followList.footer.loading') }}</text>
      </list-item>
    </list>
    </template>
    </RefreshableList>
  </view>
</template>

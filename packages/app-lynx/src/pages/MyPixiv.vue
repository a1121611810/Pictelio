<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）；好P友列表进白名单：
// 进用户主页返回不重挂载、不重置三态、不重发首载（spec docs/specs/lynx-mypixiv.md D3）
defineOptions({ name: 'mypixiv' })
import { ref, computed, onMounted } from 'vue'
import { goBack, navigate } from '../router'
import { getMyPixivUsers, loadUserListNext, followUser, unfollowUser } from '../api/user'
import { useAuthStore } from '../stores/authStore'
import { toUserId } from '../api/id'
import type { PixivUserPreview } from '../api/types'
import { presentError } from '../utils/errorPresentation'
import { deriveFirstLoadView } from '../utils/firstLoadView'
import RefreshableList from '../components/RefreshableList.vue'
import PageTopBar from '../components/PageTopBar.vue'
import UserRow from '../components/UserRow.vue'
import EmptyState from '../components/EmptyState.vue'
import FeedListFooter from '../components/FeedListFooter.vue'
import { t } from '../i18n'

// 好P友列表页（ADR-0193 D2 / spec docs/specs/lynx-mypixiv.md D2/D3 / #754 T7）：
// 双向好P友关系（双方互关注才成立）的用户列表，数据源 GET /v1/user/mypixiv。
// 复用表现层（UserRow + 刷新/分页容器 + toggleFollow 单飞锁），不复用 FollowList 页面
// 容器语义——好P友无 restrict 维度、无 following 列表的 is_followed 播种特判（spec D2）：
// is_followed 按服务端真值渲染（缺失 → falsy → 渲染「关注」可点），不播种；
// is_muted 保留透传不过滤（ADR-0193 已否决本地过滤）。
const auth = useAuthStore()

const users = ref<PixivUserPreview[]>([])
const nextUrl = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')
/** 有数据时的刷新失败 / 关注操作失败错误文案（顶部内联错误条，ADR-0104 槽位分离；防静默吞错） */
const pageErrorMsg = ref('')
/** 分页失败错误文案（列表尾 FeedListFooter 错误槽，Ranking 惯例；与顶部内联条分流防双显） */
const footerError = ref('')
const busyId = ref<number | null>(null)
/** 首载是否已成功落定（成功含 0 条）——三态判定输入（ADR-0150） */
const settled = ref(false)
/** 到底态（FeedListFooter 三态之一）：next_url 耗尽 */
const endOfFeed = ref(false)
/** list 强制重建代（fetchFirstPage 成功后 ++，驱动 :key 替换；声明先于 fetchFirstPage 首次使用） */
const refreshEpoch = ref(0)

/** 首载会话代（spec D3 竞态防护）：刷新/重试开启新会话，在飞旧响应落地即作废 */
let fetchSeq = 0

/** 页级首载三态（ADR-0150）：骨架 / 错误 / 空态 / 内容 的唯一判定源 */
const view = computed(() =>
  deriveFirstLoadView({
    hasItems: users.value.length > 0,
    loading: loading.value,
    settled: settled.value,
    hasError: !!errorMsg.value,
  }),
)

// [lynx:fix] loadMore 双重防抖（FollowList/Ranking 同款，ADR-0045）
let lastLoadMoreAt = 0
let lastLoadEndedAt = 0

async function fetchFirstPage(): Promise<void> {
  // requiresAuth 守卫兜底（理论不可达）：自账 id 缺失时显式暴露，不发坏请求
  const selfId = auth.currentUser?.id
  if (selfId == null) {
    console.warn('[MyPixiv] 未获取到自账 id（requiresAuth 守卫兜底失效），跳过首载')
    errorMsg.value = t('error.fallback.loadFailed')
    return
  }
  const seq = ++fetchSeq
  loading.value = true
  settled.value = false // 新会话 / 重试：回到未落定（骨架）
  errorMsg.value = ''
  pageErrorMsg.value = ''
  footerError.value = ''
  try {
    const res = await getMyPixivUsers(toUserId(selfId))
    if (seq !== fetchSeq) return // 在飞旧响应落地即作废（generation 防护，spec D3）
    // 不播种：好P友双向关系按 is_followed 真值渲染（spec D2，与 FollowList following 列表特判无关）
    users.value = res.user_previews
    nextUrl.value = res.next_url
    endOfFeed.value = res.next_url === null
    settled.value = true // 成功返回（含 0 条）= 已落定
    // [lynx:fix] 数据整体替换触发 vue-lynx patch RemoveNode 索引错位（框架 bug，ADR-0107 D4）；
    // epoch 与 users 替换同 tick flush（key 变化走整树替换，不发生子节点 patch）
    refreshEpoch.value++
  } catch (err) {
    if (seq !== fetchSeq) return
    const msg = presentError(err, t('error.fallback.loadFailed'))
    // 有数据（刷新失败）→ 顶部内联错误条；无数据（首载失败）→ 首屏错误分支（ADR-0104 槽位分离）
    if (users.value.length > 0) pageErrorMsg.value = msg
    else errorMsg.value = msg
  } finally {
    if (seq === fetchSeq) loading.value = false
    lastLoadEndedAt = Date.now()
  }
}

async function loadMore(): Promise<void> {
  const now = Date.now()
  if (now - lastLoadEndedAt < 3000) return
  if (now - lastLoadMoreAt < 800) return
  if (!nextUrl.value || loadingMore.value) return
  lastLoadMoreAt = now
  loadingMore.value = true
  footerError.value = ''
  try {
    const res = await loadUserListNext(nextUrl.value)
    // 分页去重合并（FollowList 同款）；不播种（spec D2）
    const seen = new Set(users.value.map((u) => u.user.id))
    const fresh = res.user_previews.filter((u) => !seen.has(u.user.id))
    users.value.push(...fresh)
    nextUrl.value = fresh.length === 0 ? null : res.next_url
    endOfFeed.value = nextUrl.value === null
  } catch (err) {
    // 分页失败：已加载数据保留，列表尾错误槽可见 + 可重试（spec US6）
    footerError.value = presentError(err, t('mypixiv.loadMoreFailed'))
  } finally {
    loadingMore.value = false
    lastLoadEndedAt = Date.now()
  }
}

async function toggleFollow(user: PixivUserPreview): Promise<void> {
  if (busyId.value !== null) return // 单飞锁：busy 互斥防重入（FollowList 同款）
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
    // 操作失败必须可见：errorMsg 在三态链中仅「无数据」时渲染，动作失败时列表非空 → 顶部内联错误条
    pageErrorMsg.value = t('mypixiv.actionFailed') // i18n: 赋值时快照（瞬态）
  } finally {
    busyId.value = null
  }
}

function openUser(id: number): void {
  void navigate(`/user/${id}`)
}

onMounted(fetchFirstPage)
// 刷新入口（ADR-0107）：fetchFirstPage 幂等（重置 users/nextUrl/error 槽 + 会话代递增），
// 直接绑定 RefreshableList :refresh；刷新状态机内收组件，页面零自持刷新态
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：次级页返回变体（PageTopBar 公共层组件，ADR-0194） -->
    <PageTopBar back :title="t('mypixiv.title')" @back="goBack" />

    <!-- 有数据时的内联错误（刷新 / 关注操作失败）：不吞错、不打乱三态判定（ADR-0104 槽位分离） -->
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
        <text class="text-label-large font-medium text-primary-on">{{ t('mypixiv.retry') }}</text>
      </view>
    </view>
    <view v-else-if="view === 'empty'" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <EmptyState icon="◎" :title="t('mypixiv.empty.title')" :hint="t('mypixiv.empty.hint')" />
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
        <!-- 用户行（UserRow 复用，ADR-0194 / ADR-0193 D2）：头像/名/按钮类串在组件单点。
             业务语义留本页：is_followed 真值渲染不播种、busyId 单飞锁、openUser 路由决策 -->
        <UserRow
          :user="item.user"
          :is-followed="!!item.user.is_followed"
          :busy="busyId !== null"
          :follow-label="t('followList.follow')"
          :followed-label="t('followList.following')"
          @row-tap="openUser(item.user.id)"
          @toggle="toggleFollow(item)"
        />
      </list-item>
      <list-item
        v-if="loadingMore || footerError || endOfFeed"
        :key="'footer'"
        item-key="footer"
        class="w-full h-10 flex items-center justify-center"
        full-span
      >
        <!-- 三态列表尾（FeedListFooter，ADR-0194）：加载中 / 分页错误可点重试（spec US6）/ 到底 -->
        <FeedListFooter
          :loading="loadingMore"
          :error="footerError"
          :end="endOfFeed"
          :loading-text="t('mypixiv.footer.loading')"
          :end-text="t('mypixiv.footer.end')"
          :retry-text="t('mypixiv.retry')"
          @retry="loadMore"
        />
      </list-item>
    </list>
    </template>
    </RefreshableList>
  </view>
</template>

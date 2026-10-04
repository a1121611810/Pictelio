<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'shelf' })
import { ref, computed, onMounted, onActivated, onUnmounted } from 'vue'
import { navigate } from '../router'
import { t } from '../i18n'
import { proxyImageUrl } from '../utils/imageUrl'
import { artworkTitle } from '../utils/artworkTitle'
import { openNovel } from '../utils/novelNavigation'
import { useContinueReadingStore } from '../stores/continueReadingStore'
import { useBrowsingHistoryStore } from '../stores/browsingHistoryStore'
import { mergeContinueEntries, type ContinueEntry } from '../primitives/continueEntries'
import ContinueRow from '../components/ContinueRow.vue'
import { useUsageMetricsStore } from '../stores/usageMetrics'
import { useHeroSource } from '../composables/heroTransition'
import { loadBookmarks } from '../api/illust'
import type { PixivIllust } from '../api/types'
import { useAuthStore } from '../stores/authStore'
import { useWatchLaterStore } from '../stores/watchLaterStore'
import { useGlobalFabStore } from '../stores/globalFab'
import { useTopInsetSpacer } from '../composables/useTopInsetSpacer'
import { createGenerationGate } from '../primitives/generationGate'
import { useMotion } from '../composables/motion'
import SkeletonImage from '../components/SkeletonImage.vue'
import AppIcon from '../components/AppIcon.vue'
import FabAllowanceSpacer from '../components/FabAllowanceSpacer.vue'
import { A11Y_ELEMENT_ENABLED, SHELF_A11Y_LABELS } from '../utils/accessibility'

// ─── 「书架」页（/shelf）[维度重构 2026-10-03] ───
// 三段聚合面：我的收藏 / 稍后看 / 继续读。
// 改造前这三个功能各占一个次级页、入口**全部**只从「我的」一行进入，且彼此不跳转
//   ——「我存的」和「我追的」在产品里从不同时出现在一个视野中。
// 外部依据：LINE WEBTOON 官方「我的漫畫」把「最近看過 + 我的最愛 + 下載」收在一个面里。
//
// ⚠️ **下载队列刻意不在本页**：`/downloads` 是任务队列控制面（start/pause/stop/toggle），
//   不是内容列表 —— 留在「我的」。把控制面混进内容面会让两者的操作预期冲突。
const topInsetSpacer = useTopInsetSpacer()
// 统一入场出口（listItemStaggerContract L2）：scroll-view 消费页的分段卡片必须走这一个出口，
// 逐页自写动画会在多页之间漂移（该门禁的原始动机）。
const { listItemStyle } = useMotion()
// 即时导航硬约束 #3：代际闸（与 Updates.vue 同一原语），保证后发者胜
const gate = createGenerationGate()
/** 首载加载态：段 1 走网络（loadBookmarks），在飞期间**不得**渲染成「还没有内容」
 *  （那是把「还不知道」说成「你没有」——与 Updates.vue 同款缺陷，第二轮 review 指出本页漏修） */
const loading = ref(false)
/** 段 2（稍后看）首载加载态：hydrate 未完成时**不得**渲染成「还没有内容」。
 *  独立于 `loading`（段 1 的网络态）：两段各自失败、各自表达，互不牵连。 */
const laterLoading = ref(false)
const auth = useAuthStore()
const laterStore = useWatchLaterStore()

/** 每段预览条数（聚合面只给"一眼看到我存了什么"，完整列表在各自次级页） */
const PREVIEW_N = 3

// ─── 段 1：我的收藏（Pixiv 服务端收藏，插画）───
const bookmarks = ref<PixivIllust[]>([])
const bookmarksError = ref('')

async function loadBookmarksPreview(token: number): Promise<void> {
  bookmarksError.value = ''
  const uid = auth.currentUser?.id
  if (typeof uid !== 'number') {
    if (gate.isCurrent(token)) bookmarksError.value = t('error.fallback.loadFailed')
    return
  }
  try {
    const r = await loadBookmarks(uid, 'public')
    if (!gate.isCurrent(token)) return
    bookmarks.value = r.illusts.slice(0, PREVIEW_N)
  } catch (e) {
    console.warn('[shelf] 收藏加载失败', e)
    if (gate.isCurrent(token)) bookmarksError.value = t('error.fallback.loadFailed')
  }
}

// ─── 段 2：稍后看（本地同步快照，插画 + 小说双类型）───
// ⚠️ 「本地 store 无网络依赖 ⇒ 渲染流一上来就有值」是**错的**（第三轮 Standards 审查 I-1 实证）：
//   `laterStore.hydrate()` 是 async（await prefs），且 router.ts 启动预热 `void …hydrate()`
//   **不 await** ⇒ 冷启动 + 慢 prefs + 用户快速点「书架」时，items 此刻确实为 0。
//   若此时直接渲染 `shelf.empty`（"你还没有内容"），就是把**"还不知道"说成"你没有"** ——
//   与 Updates 页 `loading` 死状态是同一族缺陷（S-5），只是这里靠 laterLoading 独立表达。
const laterPreview = computed(() => laterStore.items.slice(0, PREVIEW_N))

// 缩略图 → 大图连续性转场（ADR-0211 决策 12）。resolveSrc 要同时认三个来源：
// 收藏（服务端 PixivIllust）、稍后看（本地快照）、段 3 浏览历史（本地快照），
// 因为三段各有自己的缩略图盒。漏掉段 3 ⇒ 点插画记录返回时拿不到 src，
// heroTransition 内部降级为普通转场（不崩，但连续性白丢）。
const heroTransition = useHeroSource({
  resolveSrc: (id: number) => {
    const b = bookmarks.value.find((i) => i.id === id)
    if (b) return proxyImageUrl(b.image_urls.large || b.image_urls.medium || '')
    const l = laterStore.items.find((i) => i.id === id)
    if (l) return proxyImageUrl(l.coverUrl)
    const h = historyStore.items.find((i) => i.illustId === id)
    return h ? proxyImageUrl(h.coverUrl) : ''
  },
})

function openBookmark(id: number): void {
  heroTransition.begin(id)
  void navigate(`/illust/${id}`)
}

function openLaterItem(item: { kind: 'illust' | 'novel'; id: number }): void {
  // ⚠️ 只有插画走图像转场；小说是 openNovel 分流，id 可能是 novelId —— 对它调 begin() 会测错盒子。
  if (item.kind === 'illust') {
    heroTransition.begin(item.id)
    void navigate(`/illust/${item.id}`)
  } else {
    openNovel(item.id)
  }
}

// ─── 段 3：继续读（ADR-0219 §2.1 / 票 #926 + 票 #927）───
// 本段与插画浏览历史**同段同页**（术语文档易混辨析 #2）：小说「阅读位置」+ 插画「浏览历史」
//   混在**同一段落、同一 `/continue` 页**里，按最近活动统一倒序；刻意不新开第 4 段、不建 `/history`。
// 两条轴的**数据层仍物理隔离**（两个 store、两个账号级键），本段只做展示聚合（primitives/continueEntries）。
const continueStore = useContinueReadingStore()
const historyStore = useBrowsingHistoryStore()
/** 段 3 首载骨架态：hydrate 未完成时**不得**渲染成「还没有内容」
 *  （那是把「还不知道」说成「你没有」——与本文件段 1/2 同款纪律，各段独立表达） */
const continueLoading = ref(false)
/** 段 3 全量条目（两轴混排，最近活动倒序）——空态判定的真值必须取自它，
 *  只看小说侧会把「我刷过的插画」渲染成「你什么都没有」 */
const continueEntries = computed(() => mergeContinueEntries(continueStore.items, historyStore.items))
const continuePreview = computed(() => continueEntries.value.slice(0, PREVIEW_N))
/** 段 3 观测读点（ADR-0219 §2.6）：本文件此前对 usageMetrics 零引用，本段是第一个读点 */
const metrics = useUsageMetricsStore()

/**
 * 段 3 行点击分流：小说走 openNovel 的 resume 意图（无视介绍页开关直达正文，ADR-0219 §2.4）；
 * 插画走既有插画详情路由。⚠️ 分流**必须**写在本页而不是塞进聚合层——小说落点只能经
 *   openNovel 单点缝隙（介绍页路由串是 novelNavigation.ts 的专属，见 novelIntroEntryGuards 源级守卫）。
 */
function openContinue(entry: ContinueEntry): void {
  if (entry.kind === 'novel') {
    openNovel(entry.id, { resume: true })
  } else {
    heroTransition.begin(entry.id)
    void navigate(`/illust/${entry.id}`)
  }
}

// ─── 刷新 ───
async function refresh(): Promise<void> {
  const token = gate.next()
  loading.value = true
  laterLoading.value = true
  // ⚠️ 段 3 的 loading 必须**在此置 true**，否则下面段 3 的装载一挂上，
  //    骨架的 v-if 恒假、`v-else-if` 空态在装载在飞时就命中 —— 「还不知道」被渲染成
  //    「还没有阅读记录」。此前漏置，源级守卫只匹配标识符存在 ⇒ 守卫是同义反复（已修）。
  continueLoading.value = true
  // ⚠️ hydrate 是 async 且可能 reject：必须 await + 收尾，否则 laterLoading 永远为 true
  //   （骨架卡死）或不 await（骨架一闪而过、把"还不知道"渲染成"你没有"）。
  const laterDone = laterStore.hydrate().finally(() => {
    laterLoading.value = false
  })
  // 段 3 两轴各装各的（小说阅读位置 / 插画浏览历史，同段同页，ADR-0219 §2.1）
  const continueDone = continueStore
    .hydrate()
    .catch((e: unknown) => {
      console.warn('[shelf] 续读数据装载失败（不影响渲染）', e)
    })
  const historyDone = historyStore
    .hydrate()
    .catch((e: unknown) => {
      console.warn('[shelf] 浏览历史装载失败（不影响渲染）', e)
    })
  // 📌 骨架旗标要等**两条轴都**落定才撤：只等小说侧就撤，会在「插画还在飞」时把段 3
  //   渲染成「就这些」，那比晚撤更误导（它说的是一个不完整的答案）。
  const continueSettled = Promise.all([continueDone, historyDone]).finally(() => {
    continueLoading.value = false
    // 观测读点（旁路）：记录「本段被看到」与「本段为空」两个计数（本地，不外传）。
    // 📌 两轴同段 ⇒ 只记一个「该段本次是否为空」，不按类型分记（ADR-0219 §2.6 拍板）。
    // ⚠️ 显式 try/catch：度量失败**不得**影响页面渲染，否则 `void continueSettled` 变
    //    unhandled rejection（照 Updates.vue noteSection 范式，测试硬约束 #3）
    try {
      metrics.recordSectionObserved('continueReading', continueEntries.value.length === 0)
    } catch (e) {
      console.warn('[shelf] 段 3 空段度量记录失败（不影响渲染）', e)
    }
  })
  try {
    await loadBookmarksPreview(token)
  } finally {
    if (gate.isCurrent(token)) loading.value = false
  }
  void laterDone
  void continueDone
  void historyDone
  void continueSettled
}

// ─── 全局放射 FAB 桥（ADR-0120）───
let unreg: (() => void) | undefined
onMounted(() => {
  unreg = useGlobalFabStore().usePage('shelf', { refresh })
  // ⚠️ 此处**不**再调 refresh()：本页在 KeepAlive include 内，首挂载时
  //   onActivated 与 onMounted 都会触发（Me.vue:374-377 记过）⇒ 两处都调会并发两轮。
})
onUnmounted(() => {
  unreg?.()
  gate.invalidate()
})
onActivated(() => {
  void refresh()
})
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <view :style="{ height: topInsetSpacer + 'px' }" />

    <!-- 页内标题（**不是顶栏**）。同 Updates.vue：ADR-0216 §2.1 规定根页不画实体顶栏，
         <PageTopBar> 是带底色的顶栏行，故本页不用它；改用流内标题保留定位信息。 -->
    <text
      class="text-title-large font-medium text-surface-on px-4 mt-2 [max-line:1]"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="SHELF_A11Y_LABELS.pageTitle"
      >{{ t('shelf.title') }}</text
    >

    <scroll-view class="w-full flex-1" scroll-orientation="vertical">
      <!-- ══ 段 1：我的收藏 ══ -->
      <view class="w-full">
        <view class="flex flex-row items-center justify-between px-3 mt-3 mb-1.5" :style="listItemStyle(0)">
          <text class="text-title-small font-medium text-surface-on">{{ t('shelf.section.bookmarks') }}</text>
          <view
            class="h-[8vw] px-2.5 flex items-center justify-center"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="SHELF_A11Y_LABELS.viewAllBookmarks"
            @tap="navigate('/bookmarks')"
          >
            <text class="text-label-large text-primary">{{ t('shelf.viewAll') }}</text>
            <AppIcon name="arrow_forward" :size="3.2" class="text-primary" />
          </view>
        </view>
      </view>
      <view v-for="it in bookmarks" :key="`b-${it.id}`" class="w-full">
        <view
          class="flex flex-row items-center mx-3 mb-1.5 p-2 bg-surface-container-lowest rounded-[var(--md-shape-medium)]"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="SHELF_A11Y_LABELS.openBookmark"
          @tap="openBookmark(it.id)"
        >
          <!-- ⚠️ 同 Updates.vue：API 字段的运行期值可能缺，模板里直接取会抛 TypeError，
               而 vue-lynx 的渲染异常会让**整页变空白**（不是局部降级）。故先判后取。 -->
          <SkeletonImage
            v-if="it.image_urls && (it.image_urls.medium || it.image_urls.square_medium)"
            :id="heroTransition.sourceId(it.id)"
            :src="proxyImageUrl(it.image_urls.medium || it.image_urls.square_medium)"
            height="18.667vw"
            class="w-[18.667vw] rounded-[var(--md-shape-small)]"
            lazy-load
          />
          <view class="flex-1 flex flex-col ml-2.5 min-w-0">
            <text class="text-body-large text-surface-on [max-line:1]">{{ artworkTitle(it.title) }}</text>
            <text class="text-body-small text-surface-on-variant mt-0.5 [max-line:1]">{{ it.user?.name ?? '' }}</text>
          </view>
        </view>
      </view>
      <!-- 首载骨架（硬约束 #1「先渲染页面框架（含骨架屏占位）」）。
           段 1 走网络 ⇒ 在飞时长度确实为 0；不加骨架就会把「还在请求」渲染成
           「还没有内容」。⚠️ 段 2（稍后看）**也要骨架**：它的 hydrate 是 async
           （第三轮 review I-1 纠正了此前「本地 store 一上来就有值」的错误注释）。 -->
      <view v-if="loading && bookmarks.length === 0" class="w-full">
        <view class="mx-3 mb-1.5 px-2.5 py-3 rounded-[var(--md-shape-medium)] bg-surface-container-low">
          <view class="shimmer h-[28rpx] w-[45%] rounded-[var(--md-shape-extra-small)]" />
          <view class="shimmer h-[28rpx] w-[70%] rounded-[var(--md-shape-extra-small)] mt-2" />
        </view>
      </view>
      <view v-else-if="bookmarks.length === 0" class="w-full">
        <view class="mx-3 mb-1.5 px-2.5 py-2.5 rounded-[var(--md-shape-medium)] bg-surface-container-low">
          <text class="text-body-small text-surface-on-variant">
            {{ bookmarksError || t('shelf.empty') }}
          </text>
        </view>
      </view>

      <!-- ══ 段 2：稍后看 ══ -->
      <view class="w-full">
        <view class="flex flex-row items-center justify-between px-3 mt-3 mb-1.5" :style="listItemStyle(1)">
          <text class="text-title-small font-medium text-surface-on">{{ t('shelf.section.later') }}</text>
          <view
            class="h-[8vw] px-2.5 flex items-center justify-center"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="SHELF_A11Y_LABELS.viewAllLater"
            @tap="navigate('/later')"
          >
            <text class="text-label-large text-primary">{{ t('shelf.viewAll') }}</text>
            <AppIcon name="arrow_forward" :size="3.2" class="text-primary" />
          </view>
        </view>
      </view>
      <view v-for="item in laterPreview" :key="`l-${item.kind}-${item.id}`" class="w-full">
        <view
          class="flex flex-row items-center mx-3 mb-1.5 p-2 bg-surface-container-lowest rounded-[var(--md-shape-medium)]"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="SHELF_A11Y_LABELS.openLater"
          @tap="openLaterItem(item)"
        >
          <SkeletonImage
            v-if="item.coverUrl"
            :id="item.kind === 'illust' ? heroTransition.sourceId(item.id) : undefined"
            :src="proxyImageUrl(item.coverUrl)"
            height="18.667vw"
            class="w-[18.667vw] rounded-[var(--md-shape-small)]"
            lazy-load
          />
          <view class="flex-1 flex flex-col ml-2.5 min-w-0">
            <text class="text-body-large text-surface-on [max-line:1]">{{ artworkTitle(item.title) }}</text>
            <text class="text-body-small text-surface-on-variant mt-0.5 [max-line:1]">{{ item.userName }}</text>
          </view>
        </view>
      </view>
      <view v-if="laterLoading && laterStore.items.length === 0" class="w-full">
        <view class="mx-3 mb-1.5 px-2.5 py-3 rounded-[var(--md-shape-medium)] bg-surface-container-low">
          <view class="shimmer h-[28rpx] w-[45%] rounded-[var(--md-shape-extra-small)]" />
          <view class="shimmer h-[28rpx] w-[70%] rounded-[var(--md-shape-extra-small)] mt-2" />
        </view>
      </view>
      <view v-else-if="laterStore.items.length === 0" class="w-full">
        <view class="mx-3 mb-1.5 px-2.5 py-2.5 rounded-[var(--md-shape-medium)] bg-surface-container-low">
          <text class="text-body-small text-surface-on-variant">{{ t('shelf.empty') }}</text>
        </view>
      </view>

      <!-- ══ 段 3：继续读（小说阅读位置 + 插画浏览历史同段同页，ADR-0219 §2.1）══ -->
      <view class="w-full">
        <view class="flex flex-row items-center justify-between px-3 mt-3 mb-1.5" :style="listItemStyle(2)">
          <text class="text-title-small font-medium text-surface-on">
            {{ t('shelf.section.continueReading') }}
          </text>
          <view
            v-if="!continueLoading && continuePreview.length > 0"
            class="h-[8vw] px-2.5 flex items-center justify-center"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="SHELF_A11Y_LABELS.viewAllContinueReading"
            @tap="navigate('/continue')"
          >
            <text class="text-label-large text-primary">{{ t('shelf.viewAll') }}</text>
            <AppIcon name="arrow_forward" :size="3.2" class="text-primary" />
          </view>
        </view>
      </view>
      <!-- 📌 key 用聚合层给的 `entry.key`（带类型前缀）：小说 id 与插画 id 是两套 id 空间，
           同号撞 key 会让行复用错内容。 -->
      <view v-for="item in continuePreview" :key="item.key" class="w-full">
        <ContinueRow :entry="item" :thumb-id="heroTransition.sourceId(item.id)" @open="openContinue" />
      </view>
      <!-- 首载骨架：两轴 hydrate 在飞时合并列表长度确实为 0；不加骨架会把「还在请求」渲染成「还没有内容」 -->
      <view v-if="continueLoading && continueEntries.length === 0" class="w-full">
        <view class="mx-3 mb-1.5 px-2.5 py-3 rounded-[var(--md-shape-medium)] bg-surface-container-low">
          <view class="shimmer h-[28rpx] w-[45%] rounded-[var(--md-shape-extra-small)]" />
          <view class="shimmer h-[28rpx] w-[70%] rounded-[var(--md-shape-extra-small)] mt-2" />
        </view>
      </view>
      <view v-else-if="continueEntries.length === 0" class="w-full">
        <view class="mx-3 mb-1.5 px-2.5 py-4 rounded-[var(--md-shape-medium)] bg-surface-container-low">
          <view class="flex flex-row items-center">
            <AppIcon name="schedule" :size="5.33" class="text-surface-on-variant" />
            <text class="text-body-medium text-surface-on ml-2">
              {{ t('shelf.continueReading.empty') }}
            </text>
          </view>
          <text class="text-body-small text-surface-on-variant mt-1.5">
            {{ t('shelf.continueReading.hint') }}
          </text>
        </view>
      </view>

      <FabAllowanceSpacer />
    </scroll-view>
  </view>
</template>

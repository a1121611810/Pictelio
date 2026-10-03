<script setup lang="ts">
// 插画分类页（/illusts）：推荐/关注两个子 tab，waterfall 双列插画卡。
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'illusts' })
import { computed, ref, onMounted, onUnmounted, onActivated } from 'vue'
import { navigate } from '../router'
import { loadRecommended, loadFollow, loadNext } from '../api/illust'
import type { PixivIllust, PixivIllustListResponse } from '../api/types'
import { artworkTitle } from '../utils/artworkTitle'
import { thumbUrl } from '../utils/imageUrl'
import type { IconName } from '../utils/iconMap'
import { createMixFeed, type MixFeedItem } from '../primitives/createMixFeed'
import { useSettingsStore } from '../stores/settingsStore'
import { useRelatedInjectionStore } from '../stores/relatedInjection'
import { deriveFirstLoadView } from '../utils/firstLoadView'
import SkeletonCard from '../components/SkeletonCard.vue'
import SkeletonImage from '../components/SkeletonImage.vue'
import { useTopInsetSpacer } from '../composables/useTopInsetSpacer'
import FabAllowanceSpacer from '../components/FabAllowanceSpacer.vue'
import SubTabBar from '../components/SubTabBar.vue'
import EmptyState from '../components/EmptyState.vue'
import FeedListFooter from '../components/FeedListFooter.vue'
import IllustTypeBadgeRow from '../components/IllustTypeBadgeRow.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import RestrictOverlay from '../components/RestrictOverlay.vue'
import AiRestrictedIllustCard from '../components/AiRestrictedIllustCard.vue'
import RelatedInlineSection from '../components/RelatedInlineSection.vue'
import { useAiOnlyVisible } from '../composables/useAiOnlyVisible'
import { useTagMuteVisible } from '../composables/useTagMuteVisible'
import { useHeroSource } from '../composables/heroTransition'
import RefreshableList from '../components/RefreshableList.vue'
import RankingEntryCard from '../components/RankingEntryCard.vue'
import { useGlobalFabStore } from '../stores/globalFab'
import { t } from '../i18n'

const settings = useSettingsStore()
const isRestricted = settings.isRestricted
const isAiRestricted = settings.isAiRestricted
// 顶部安全区让位高度（票 #920 去掉顶栏后**仍必须**让位，否则内容顶进状态栏）。
// 口径唯一来源 = utils/topInset.ts，本页不做任何模式判断或兜底。
const topInsetSpacer = useTopInsetSpacer()
// ─── 相关作品注入行（spec docs/specs/related-injection.md）───
const related = useRelatedInjectionStore()

// ─── 分页收敛（ADR-0104）：迁移到 createMixFeed 深模块 ───
// 双防抖 / 竞态代 / 分批渲染（pageSize=20，替代原 pendingIllusts 队列）/ 空页防护 /
// 15s 超时 / 错误槽分流（error=首屏顶部、pageError=分页底部内联）全部由 createMixFeed 承载。
// 推荐/关注切换：推荐 = /v1/illust/recommended，关注 = /v2/illust/follow
const mode = ref<'recommend' | 'follow'>('recommend')

function mapIllusts(r: PixivIllustListResponse): { items: MixFeedItem[]; nextUrl: string | null } {
  return {
    items: r.illusts.map((i) => ({ kind: 'illust' as const, key: `i-${i.id}`, id: i.id, data: i })),
    nextUrl: r.next_url,
  }
}

function makeFeed(m: 'recommend' | 'follow') {
  return createMixFeed({
    // autoStart=false：构造不首载，由 refreshFeed 显式触发（mode 重建实例避免双请求浪费）
    autoStart: false,
    onUpdate: sync, // [T1] 防抖重试补发完成后页面重新快照（P1）
    sources: [
      {
        name: 'illust',
        // [fix] 同 NovelList.vue：loadFollow(restrict, signal) 首参是 restrict，不能与
        // loadRecommended(signal) 统一成 `first(signal)`——否则 AbortSignal 被当作 restrict
        // 序列化成 restrict=[object AbortSignal] → Pixiv 400。
        fetchPage: (signal, nextUrl) =>
          nextUrl
            ? loadNext(nextUrl, signal).then(mapIllusts)
            : (m === 'recommend'
                ? loadRecommended(signal)
                : loadFollow('public', signal)
              ).then(mapIllusts),
      },
    ],
  })
}

const feed = ref(makeFeed(mode.value))
const illusts = ref<PixivIllust[]>([])
/** 仅看态：非 AI 条目从渲染流移除（服务端分页判空仍基于 feed.items，不受影响）；
 *  标签静音（ADR-0187 / #732）：命中词表条目数据层移除（「静音=不可见」，非遮罩） */
const visibleIllusts = useTagMuteVisible(useAiOnlyVisible(illusts))

const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')
const pageErrorMsg = ref('')
const endOfFeed = ref(false)
/** 首载是否已成功落定（成功含 0 条）——三态判定输入（ADR-0150） */
const settled = ref(false)

/** 空态文案：按当前子 tab 取图标 / 标题 / 副文案（避免模板内重复三元）；t 在 computed 内调用，随 locale 响应
 *  `satisfies` 而非 `: IconName` 标注：保留 title/hint 的具体 string 推断（下游仍按字符串用），
 *  同时让 icon 字段被收窄到 IconName——将来新增分支时写错图标名在编译期即报错（ADR-0208 决策 3） */
const emptyMeta = computed(() =>
  (mode.value === 'follow'
    ? {
        icon: 'favorite_border',
        title: t('illustList.empty.follow.title'),
        hint: t('illustList.empty.follow.hint'),
      }
    : {
        icon: 'explore',
        title: t('illustList.empty.recommend.title'),
        hint: t('illustList.empty.recommend.hint'),
      }) satisfies { icon: IconName; title: string; hint: string },
)

/** 页级首载三态（ADR-0150）：骨架 / 错误 / 空态 / 内容 的唯一判定源 */
const view = computed(() =>
  deriveFirstLoadView({
    hasItems: visibleIllusts.value.length > 0,
    loading: loading.value,
    settled: settled.value,
    hasError: !!errorMsg.value,
  }),
)

function sync() {
  illusts.value = feed.value.items().map((i) => i.data as PixivIllust)
  loading.value = feed.value.loading()
  loadingMore.value = feed.value.loadingMore()
  settled.value = feed.value.settled()
  errorMsg.value = feed.value.error() ?? ''
  pageErrorMsg.value = feed.value.pageError() ?? ''
  // 到底态：所有源耗尽且列表非空（ADR-0104：footer「没有更多了」）
  endOfFeed.value =
    feed.value.nextUrl() === null &&
    feed.value.items().length > 0 &&
    !loading.value &&
    !loadingMore.value
}

async function refreshFeed() {
  // 发起前同步进入加载态并清错误：骨架立即占位（ADR-0150，覆盖失败重试与真·空态刷新）
  // 新会话：清空本 tab 注入行（spec §4.4）
  related.clearRows(mode.value)
  loading.value = true
  errorMsg.value = ''
  await feed.value.refresh()
  sync()
  // [lynx:fix] 数据整体替换触发 vue-lynx patch RemoveNode 索引错位（框架 bug，ADR-0107 D4）；
  // epoch 与 sync() 同 tick flush（key 变化走整树替换，不发生子节点 patch）
  refreshEpoch.value++
}

/** list 强制重建代（refresh 后 ++，驱动 :key 替换） */
const refreshEpoch = ref(0)

async function loadMore() {
  await feed.value.fetchMore()
  sync()
}

function switchMode(m: 'recommend' | 'follow') {
  if (mode.value === m) return
  mode.value = m
  // 重建 feed 实例：先释放旧实例（清挂起补触发 + 作废在途响应），新实例 generation 从 0 起
  related.clearRows(m)
  feed.value?.dispose()
  feed.value = makeFeed(m)
  illusts.value = []
  errorMsg.value = ''
  pageErrorMsg.value = ''
  settled.value = false // 新实例尚未落定；随后 refreshFeed 同步进入加载态
  void refreshFeed()
}

// 缩略图 → 大图连续性转场（ADR-0211 决策 12）：本页在 KeepAlive 白名单内 ⇒ 返回方向也成立。
// resolveSrc 给覆盖层提供同一张缩略图（地址档位/代理策略仍由本页的 thumbUrl 决定）。
const heroTransition = useHeroSource({
  resolveSrc: (id: number) => {
    const item = illusts.value.find((i) => i.id === id)
    return item ? thumbUrl(item.image_urls) : ''
  },
})

function openDetail(id: number) {
  // 记录锚点：从本页卡片进详情，返回后在该卡下方注入相关作品行（注入行内点击走 openRelated 不记录）
  related.recordAnchor(mode.value, id)
  heroTransition.begin(id) // 发起矩形测量（不等待，决策 12 机制 1：不给导航加可见延迟）
  void navigate(`/illust/${id}`)
}

/** 注入行内缩略图点击：进详情但不记录新锚点（防循环注入） */
function openRelated(id: number) {
  heroTransition.begin(id)
  void navigate(`/illust/${id}`)
}

/**
 * 卡内展开段查询（ADR-0162）：列表只渲染纯插画流，「这个卡要不要挂相关段」
 * 经 store.rowFor 逐卡查询，不再做 list 级条目交织（lynx 瀑布流中途插入
 * list-item 被 patch 静默丢弃，取证 2026-09-15）。开关关闭即整体隐藏。
 */
function relatedRowFor(illustId: number) {
  if (!settings.relatedInjection) return undefined
  return related.rowFor(mode.value, illustId)
}

// 返回消费锚点：本页在 KeepAlive 白名单内（ADR-0049），返回时 onActivated 触发；
// tab 不匹配时 consume 内部保留 pending，交给正确的 tab。
onActivated(() => {
  void related.consumeAnchor(
    mode.value,
    illusts.value.map((i) => i.id),
  )
})

// 图片区点击（spec：列表交互）：受限条目（R18/R18G 且开关关闭）不跳详情，其余进详情。
// 外层 .stop 继续保证遮罩点击不穿透；RestrictOverlay 自身 @tap="swallow" 双保险。
function onImageTap(item: PixivIllust) {
  if (!isRestricted(item)) openDetail(item.id)
}

// ─── 全局放射 FAB 桥（ADR-0120）：注册本页动作到 globalFab，卸载时注销 ───
let unreg: (() => void) | undefined
// bench 导航钩子（wayfinder #306，ADR-0136）：真机 input tap 对 <view @tap> 失效，经
// GlobalEventEmitter 事件切「关注」子 tab；__BENCH_NAV__ 门禁（BENCH_NAV=1 构建激活，同原生 DEBUG 双保险）
const benchOnFollow = () => void switchMode('follow')
let benchOffFn: (() => void) | undefined
onMounted(() => {
  unreg = useGlobalFabStore().usePage('illusts', {
    refresh: refreshFeed,
    backToTop: () => {
      refreshEpoch.value++
    },
  })
  if (__BENCH_NAV__) {
    const lynxGlobal = typeof lynx !== 'undefined' ? lynx : (globalThis as { lynx?: { getJSModule?: (n: string) => { addListener?: (e: string, fn: () => void) => void; removeListener?: (e: string, fn: () => void) => void } } }).lynx
    const emitter = lynxGlobal?.getJSModule?.('GlobalEventEmitter')
    if (emitter && typeof emitter.addListener === 'function') {
      emitter.addListener('pictelioBenchNavIllustFollow', benchOnFollow)
      benchOffFn = () => emitter.removeListener?.('pictelioBenchNavIllustFollow', benchOnFollow)
    }
  }
  void refreshFeed()
})

// 释放 feed（spec §4 T1 dispose）：卸载与 mode 重建时均作废旧实例
onUnmounted(() => {
  unreg?.()
  benchOffFn?.()
  feed.value?.dispose()
})
</script>

<template>
  <!-- :id="heroTransition.rootId"：hero 覆盖层的 absolute 锚点 + 视口↔页面坐标换算基准（ADR-0211 决策 12） -->
  <view class="w-full h-full flex flex-col relative bg-surface" :id="heroTransition.rootId">
    <!-- [票 #920 / ADR-0216] 四个根页去掉 header：原 `<PageTopBar :title="t('illustList.title')" />` 整条移除，
         改为**只保留顶部安全区让位**的零内容 spacer。spacer 不是 header —— 它是内容盒的起点，
         删掉它首屏内容会顶进状态栏下沿（真机才可见，编译/单测/门禁全绿）。
         高度唯一来源仍是 utils/topInset.ts（useTopInsetSpacer），本页不改让位口径。
         页面定位信息改由全局放射 FAB 承担（四个 tab 常驻可见）+ 页内「推荐/关注」子 tab。 -->
    <view :style="{ height: topInsetSpacer + 'px' }" />

    <!-- 推荐/关注切换（M3 secondary tabs：选中态 = text-primary + 底部 0.8vw primary 指示条）（SubTabBar 收口，ADR-0194；选中态指示条类串在组件单点逐字保留） -->
    <SubTabBar
      :items="[
        { key: 'recommend', label: t('illustList.tab.recommend') },
        { key: 'follow', label: t('illustList.tab.follow') }
      ]"
      :model-value="mode"
      @change="switchMode"
    />

    <!-- 排行榜入口大卡（spec docs/specs/ranking.md §5.1）：推荐 tab 内容链之前；
         开关关闭时不渲染（不建数据源） -->
    <RankingEntryCard v-if="mode === 'recommend' && settings.rankingEntry" :refresh-epoch="refreshEpoch" />

    <!-- 首载三态（ADR-0150）：骨架 → 错误 → 空态 → 内容，互斥单链；
         触发不依赖 loading 标志（IFR 首帧用初始状态绘制，未落定即骨架） -->
    <!-- [lynx:fix] 骨架屏：首屏加载（无数据）时显示 shimmer 卡片占位，数据就绪后切换 list。
         8 个 ≈ 4 行两列，与真实卡片同比例（48.4vw 宽 + 方形图片）避免切换 reflow -->
    <!-- [lynx:fix] 骨架屏不占满全屏高度（h-full 会溢出覆盖底部导航栏，拦截 tap，issue #129）：
     改 flex-1 min-h-0 约束在导航栏下方的内容区内 -->
    <view v-if="view === 'skeleton'" class="w-full flex-1 min-h-0 flex flex-row flex-wrap content-start p-1.5">
      <SkeletonCard v-for="n in 8" :key="n" />
    </view>
    <text v-else-if="view === 'error'" class="text-body-small text-error p-4">{{ errorMsg }}</text>
    <!-- 空态：仅「已成功落定为空」才显示（spec 加固 3：杜绝「无数据 → 纯空白」） -->
    <view v-else-if="view === 'empty'" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <EmptyState :icon="emptyMeta.icon" :title="emptyMeta.title" :hint="emptyMeta.hint" />
    </view>

    <RefreshableList
      v-else
      :refresh="refreshFeed"
      :fab="false"
      @back-to-top="refreshEpoch++"
    >
    <template #default="{ onScroll }">
    <list
      :key="refreshEpoch"
      class="w-full h-full"
      list-type="waterfall"
      scroll-orientation="vertical"
      :span-count="2"
      :style="{ listMainAxisGap: '12px', listCrossAxisGap: '12px' }"
      :lower-threshold-item-count="2"
      :scroll-event-throttle="0"
      @scrolltolower="loadMore"
      @scroll="onScroll"
    >
      <!-- 纯插画流（ADR-0162）：相关作品不再作为 list 条目交织（瀑布流中途插入 list-item
           被 vue-lynx patch 静默丢弃，取证 2026-09-15），改为锚点卡 list-item 内部展开段——
           紧贴锚点成立、滚动位置保留 -->
      <template v-for="item in visibleIllusts" :key="item.id">
      <list-item
        :item-key="String(item.id)"
        class="bg-surface-container-lowest rounded-[var(--md-shape-medium)] flex flex-col overflow-hidden"
      >
        <!-- [lynx:fix] 原生 list-item 根级 @tap 失效（fiber 不触发，真机实测 2026-08-02）；
             把 openDetail 绑到内容 view（子元素 tap 已验证工作），♥ 的 @tap.stop 仍阻止冒泡 -->
        <view class="w-full flex flex-col" @tap="openDetail(item.id)">
        <!-- [lynx:fix] 间距：web-core 瀑布流引擎忽略 list-item 的 margin/padding 且内部任何 view 包裹
             都会导致 item 定位计算崩（全部重叠在起点）。间距用 list 官方属性
             list-main-axis-gap（行距）/ list-cross-axis-gap（列距），经 vue-lynx style 对象绑定
             （attribute 形式 web-core 不响应）。原生 LynxView 同样支持这两个属性（ADR-0048） -->
        <!-- [lynx:fix] 图片级骨架（SkeletonImage）：显式 height="48.4vw"（= 卡片宽 w-[48.4vw]，保持方形），
             原生 LynxView 下 aspect-ratio + min-h 组合解析为 0 导致图片不显示（issue #140）；
             图片 @load 后才隐藏 shimmer 显示图片（骨架关闭时机 = 图片加载完成，而非 API 数据返回） -->
        <view
          v-if="isRestricted(item)" @tap.stop
          class="w-full h-[48.4vw] flex items-center justify-center bg-[var(--md-scrim)] rounded-[var(--md-shape-medium)]"
        >
          <RestrictOverlay :overlay="false" :level="item.x_restrict === 2 ? 2 : 1" />
        </view>
        <AiRestrictedIllustCard v-else-if="isAiRestricted(item)" :item="item" />
        <!-- ⚠️ 必须给本 view 显式宽度：瀑布流 <list> 里 `w-full` 的祖先解析基准是
             **list 的内容盒（约 1010px）**，不是本 list-item 所在列的宽（48.4vw ≈ 522px）。
             不写宽度时 hero 测到的起点矩形是整行宽 ⇒ 覆盖层从两倍宽的区域「胀」出来，
             起点根本不是用户点的那张卡（实测 x[0,1011] vs 卡片 ≈522px，#898）。
             宽度与内部 SkeletonImage 的 height="48.4vw" 保持同源，写一次即两处一致。 -->
        <view
          v-else
          class="relative w-[48.4vw]"
          :id="heroTransition.sourceId(item.id)"
          @tap.stop="onImageTap(item)"
        >
          <SkeletonImage :src="thumbUrl(item.image_urls)" height="48.4vw" lazy-load />
        </view>
        <!-- 类型徽章行（动图/多图，ADR-0113）：流内元素，受限条目照常显示，普通单图零占位 -->
        <IllustTypeBadgeRow :illust="item" />
        <text class="text-title-small font-medium text-surface-on mt-2 mx-2.5 [max-line:1]">{{ artworkTitle(item.title) }}</text>
        <text class="text-body-small text-surface-on-variant mt-1 mx-2.5 [max-line:1]">{{ item.user.name }}</text>
        <view class="mt-1 mx-2.5 mb-2.5">
          <BookmarkButton
            :illust-id="item.id"
            :initial-bookmarked="item.is_bookmarked"
            :bookmark-count="item.total_bookmarks"
          />
        </view>
        </view>
        <!-- 相关作品卡内展开段（ADR-0162）：openDetail 冒泡域外的兄弟位，
             段背景/缩略图 tap 不会误触进详情；收起 = removeRow -->
        <RelatedInlineSection
          v-if="relatedRowFor(item.id)"
          :row="relatedRowFor(item.id)!"
          @collapse="related.removeRow(mode, item.id)"
          @open="openRelated"
        />
      </list-item>
      </template>
      <list-item v-if="loadingMore || pageErrorMsg || endOfFeed" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <!-- 三态文案组件化（FeedListFooter，ADR-0194）；外层 list-item 保留（原生 list 只认 list-item 子节点） -->
        <FeedListFooter
          :loading="loadingMore"
          :error="pageErrorMsg"
          :end="endOfFeed"
          :loading-text="t('illustList.footer.loading')"
          :end-text="t('illustList.footer.end')"
        />
      </list-item>

      <!-- 底部遮挡让位（ADR-0217 / 术语表 glossary-bottom-occlusion-allowance.md）：
           GlobalFab 是**自绘**悬浮层，平台 inset 管线看不见它 ⇒ 末项必须能滚到它之上。
           形态 = 滚动内容**末尾**的零内容 full-span list-item（共识 A 的内容级 inset）。
           ⚠️ 刻意独立于上方 footer：footer 是 v-if 三态条件渲染，三态皆假时该节点不存在，
              塞进去会让占位在最常见的态下**整个消失**（spec C1）。
           ⚠️ 必须由 list-item 包裹：原生 <list> 只认 list-item 子节点（同 FeedListFooter 先例）。 -->
      <list-item :key="'fab-allowance'" item-key="fab-allowance" class="w-full" full-span>
        <FabAllowanceSpacer />
      </list-item>
    </list>
    </template>
    </RefreshableList>

    <!-- hero 覆盖层（ADR-0211 决策 12 · 返回方向）：本页在 KeepAlive 白名单内，
         返回时实例未销毁 ⇒ 原缩略图还在，能从详情页 hero 盒插值回原位。
         比例差由覆盖层内 `mode="aspectFill"` 每帧重新等比裁切吸收（不做非等比 scale）。
         挂在 list 之外：list/scroll-view 会裁切子节点，越界飞行会被切掉。 -->
    <image
      v-if="heroTransition.overlay.visible.value"
      class="absolute z-50 overflow-hidden"
      :style="heroTransition.overlay.style.value"
      :src="heroTransition.overlay.src.value"
      :mode="'aspectFill'"
    />
  </view>
</template>

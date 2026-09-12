<script setup lang="ts">
// 插画分类页（/illusts）：推荐/关注两个子 tab，waterfall 双列插画卡。
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'illusts' })
import { computed, ref, onMounted, onUnmounted, onActivated } from 'vue'
import { navigate } from '../router'
import { loadRecommended, loadFollow, loadNext } from '../api/illust'
import type { PixivIllust, PixivIllustListResponse } from '../api/types'
import { thumbUrl } from '../utils/imageUrl'
import { createMixFeed, type MixFeedItem } from '../primitives/createMixFeed'
import { useSettingsStore } from '../stores/settingsStore'
import { useRelatedInjectionStore, RELATED_GRID_SIZE, type RelatedRow } from '../stores/relatedInjection'
import { deriveFirstLoadView } from '../utils/firstLoadView'
import SkeletonCard from '../components/SkeletonCard.vue'
import SkeletonImage from '../components/SkeletonImage.vue'
import IllustTypeBadgeRow from '../components/IllustTypeBadgeRow.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import RestrictOverlay from '../components/RestrictOverlay.vue'
import AiRestrictedIllustCard from '../components/AiRestrictedIllustCard.vue'
import { useAiOnlyVisible } from '../composables/useAiOnlyVisible'
import RefreshableList from '../components/RefreshableList.vue'
import { useGlobalFabStore } from '../stores/globalFab'
import { t } from '../i18n'

const settings = useSettingsStore()
const isRestricted = settings.isRestricted
const isAiRestricted = settings.isAiRestricted
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
/** 仅看态：非 AI 条目从渲染流移除（服务端分页判空仍基于 feed.items，不受影响） */
const visibleIllusts = useAiOnlyVisible(illusts)

const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')
const pageErrorMsg = ref('')
const endOfFeed = ref(false)
/** 首载是否已成功落定（成功含 0 条）——三态判定输入（ADR-0150） */
const settled = ref(false)

/** 空态文案：按当前子 tab 取图标 / 标题 / 副文案（避免模板内重复三元）；t 在 computed 内调用，随 locale 响应 */
const emptyMeta = computed(() =>
  mode.value === 'follow'
    ? {
        icon: '♡',
        title: t('illustList.empty.follow.title'),
        hint: t('illustList.empty.follow.hint'),
      }
    : {
        icon: '✦',
        title: t('illustList.empty.recommend.title'),
        hint: t('illustList.empty.recommend.hint'),
      },
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

function openDetail(id: number) {
  // 记录锚点：从本页卡片进详情，返回后在该卡下方注入相关作品行（注入行内点击走 openRelated 不记录）
  related.recordAnchor(mode.value, id)
  void navigate(`/illust/${id}`)
}

/** 注入行内缩略图点击：进详情但不记录新锚点（防循环注入） */
function openRelated(id: number) {
  void navigate(`/illust/${id}`)
}

/** 仅看态过滤后的交织渲染流：插画条目 + 锚点下方的相关作品行（开关关闭即隐藏行） */
type DisplayEntry = { kind: 'illust'; item: PixivIllust } | { kind: 'row'; row: RelatedRow }
const displayItems = computed<DisplayEntry[]>(() => {
  const rows = settings.relatedInjection ? related.rows(mode.value) : []
  if (rows.length === 0) return visibleIllusts.value.map((item) => ({ kind: 'illust' as const, item }))
  const out: DisplayEntry[] = []
  for (const item of visibleIllusts.value) {
    out.push({ kind: 'illust', item })
    const row = rows.find((r) => r.anchorId === item.id)
    if (row) out.push({ kind: 'row', row })
  }
  return out
})

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
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：顶层页，居中标题，无返回箭头 -->
    <view class="flex flex-row items-center justify-center h-[17.067vw] px-4 bg-surface">
      <text class="text-title-large font-medium text-surface-on">{{ t('illustList.title') }}</text>
    </view>

    <!-- 推荐/关注切换（M3 secondary tabs）：容器 border-b 分割线 + surface-container-lowest 底，
         选中态 = text-primary + 底部 0.8vw primary 指示条（Bookmarks 页已验证的可靠写法） -->
    <view class="flex flex-row border-b-[1px] border-b-outline-variant bg-surface-container-lowest">
      <view
        class="flex-1 h-[12.8vw] flex items-center justify-center"
        :class="mode === 'recommend' ? 'text-primary border-b-[0.8vw] border-b-primary' : 'text-outline'"
        @tap="switchMode('recommend')"
      >
        <text class="text-title-small font-medium">{{ t('illustList.tab.recommend') }}</text>
      </view>
      <view
        class="flex-1 h-[12.8vw] flex items-center justify-center"
        :class="mode === 'follow' ? 'text-primary border-b-[0.8vw] border-b-primary' : 'text-outline'"
        @tap="switchMode('follow')"
      >
        <text class="text-title-small font-medium">{{ t('illustList.tab.follow') }}</text>
      </view>
    </view>

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
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">{{ emptyMeta.icon }}</text>
        <text class="text-body-large text-surface-on mt-3">{{ emptyMeta.title }}</text>
        <text class="text-body-medium text-surface-on-variant mt-1.5">{{ emptyMeta.hint }}</text>
      </view>
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
      <!-- 交织渲染流（spec docs/specs/related-injection.md）：插画条目 + 锚点下方的相关作品行 -->
      <template v-for="entry in displayItems" :key="entry.kind === 'row' ? `rel-${entry.row.anchorId}` : entry.item.id">
      <!-- 相关作品行：full-span，固定两行网格缩略（横滑容器在原生 waterfall list-item 内不可靠，spec §5.2 允许降级） -->
      <list-item
        v-if="entry.kind === 'row'"
        :item-key="`rel-${entry.row.anchorId}`"
        full-span
        class="w-full bg-surface-container-lowest rounded-[var(--md-shape-medium)] p-2.5"
      >
        <view class="w-full flex flex-col">
          <view class="flex flex-row items-center justify-between">
            <text class="text-title-small font-medium text-surface-on">{{ t('illustList.related.title') }}</text>
            <view accessibility-element :accessibility-label="t('illustList.related.collapseA11y')" @tap.stop="related.removeRow(mode, entry.row.anchorId)">
              <text class="text-body-small text-outline">{{ t('illustList.related.collapse') }}</text>
            </view>
          </view>
          <view v-if="entry.row.loading" class="flex flex-row flex-wrap gap-2 mt-2">
            <view v-for="n in 8" :key="n" class="w-[22vw] h-[22vw] rounded-[var(--md-shape-medium)] bg-surface-variant" />
          </view>
          <view v-else class="flex flex-row flex-wrap gap-2 mt-2">
            <!-- 固定两行网格降级（spec §5.2）：8 = 2 行 × 4 列，超出截断（RELATED_GRID_SIZE） -->
            <view
              v-for="rel in entry.row.items.slice(0, RELATED_GRID_SIZE)"
              :key="rel.id"
              accessibility-element
              :accessibility-label="t('illustList.related.viewA11y', { title: rel.title })"
              class="w-[22vw] h-[22vw] rounded-[var(--md-shape-medium)] overflow-hidden"
              @tap.stop="openRelated(rel.id)"
            >
              <SkeletonImage :src="thumbUrl(rel.image_urls)" height="22vw" lazy-load />
            </view>
          </view>
        </view>
      </list-item>
      <list-item
        v-else
        :item-key="String(entry.item.id)"
        class="bg-surface-container-lowest rounded-[var(--md-shape-medium)] flex flex-col overflow-hidden shadow-[var(--md-elevation-1)]"
      >
        <!-- [lynx:fix] 原生 list-item 根级 @tap 失效（fiber 不触发，真机实测 2026-08-02）；
             把 openDetail 绑到内容 view（子元素 tap 已验证工作），♥ 的 @tap.stop 仍阻止冒泡 -->
        <view class="w-full flex flex-col" @tap="openDetail(entry.item.id)">
        <!-- [lynx:fix] 间距：web-core 瀑布流引擎忽略 list-item 的 margin/padding 且内部任何 view 包裹
             都会导致 item 定位计算崩（全部重叠在起点）。间距用 list 官方属性
             list-main-axis-gap（行距）/ list-cross-axis-gap（列距），经 vue-lynx style 对象绑定
             （attribute 形式 web-core 不响应）。原生 LynxView 同样支持这两个属性（ADR-0048） -->
        <!-- [lynx:fix] 图片级骨架（SkeletonImage）：显式 height="48.4vw"（= 卡片宽 w-[48.4vw]，保持方形），
             原生 LynxView 下 aspect-ratio + min-h 组合解析为 0 导致图片不显示（issue #140）；
             图片 @load 后才隐藏 shimmer 显示图片（骨架关闭时机 = 图片加载完成，而非 API 数据返回） -->
        <view
          v-if="isRestricted(entry.item)" @tap.stop
          class="w-full h-[48.4vw] flex items-center justify-center bg-[var(--md-scrim)] rounded-[var(--md-shape-medium)]"
        >
          <RestrictOverlay :overlay="false" :level="entry.item.x_restrict === 2 ? 2 : 1" />
        </view>
        <AiRestrictedIllustCard v-else-if="isAiRestricted(entry.item)" :item="entry.item" />
        <view v-else class="relative" @tap.stop="onImageTap(entry.item)">
          <SkeletonImage :src="thumbUrl(entry.item.image_urls)" height="48.4vw" lazy-load />
        </view>
        <!-- 类型徽章行（动图/多图，ADR-0113）：流内元素，受限条目照常显示，普通单图零占位 -->
        <IllustTypeBadgeRow :illust="entry.item" />
        <text class="text-title-small font-medium text-surface-on mt-2 mx-2.5 [max-line:1]">{{ entry.item.title }}</text>
        <text class="text-body-small text-surface-on-variant mt-1 mx-2.5 [max-line:1]">{{ entry.item.user.name }}</text>
        <view class="mt-1 mx-2.5 mb-2.5">
          <BookmarkButton
            :illust-id="entry.item.id"
            :initial-bookmarked="entry.item.is_bookmarked"
            :bookmark-count="entry.item.total_bookmarks"
          />
        </view>
        </view>
      </list-item>
      </template>
      <list-item v-if="loadingMore || pageErrorMsg || endOfFeed" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text v-if="loadingMore" class="text-body-medium text-outline">{{ t('illustList.footer.loading') }}</text>
        <text v-else-if="pageErrorMsg" class="text-body-medium text-error">{{ pageErrorMsg }}</text>
        <text v-else class="text-body-medium text-outline">{{ t('illustList.footer.end') }}</text>
      </list-item>
    </list>
    </template>
    </RefreshableList>
  </view>
</template>

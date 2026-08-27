<script setup lang="ts">
// 综合推荐页（/recommended）：插画 + 小说混合 waterfall，按钮分页（替换式翻书，ADR-0114）。
// 数据层由 createPagedFeed（../primitives/createPagedFeed）承载：页缓存（每页缓存两路游标 +
// 合并结果，prev 零请求）+ 时间交叉合并（mergeByTime，按 create_date 降序，替代 4:1 固定比例）+
// 竞态代 + 15s 超时全部收敛在该深模块；页面只做状态桥接（feed 是纯函数式状态，无 Vue
// 响应式，页面用本地 ref 快照 + sync() 同步）与渲染。切页/刷新后 sync + 同 tick epoch 重建
// （ADR-0107 D4：整树替换避开 vue-lynx patch 错位；重建 = 从页顶看新页，翻书语义）。
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'recommended' })
import { ref, onMounted, onActivated, onUnmounted, watch } from 'vue'
import { navigate } from '../router'
import { loadRecommended, loadNext } from '../api/illust'
import { loadRecommendedNovels, loadNovelNext } from '../api/novel'
import type { PixivIllust, PixivNovel } from '../api/types'
import { createPagedFeed, type PagedFeedSource } from '../primitives/createPagedFeed'
import type { MixFeedItem } from '../primitives/createMixFeed'
import type { FabMenuExtraItem } from '../primitives/createFabMenu'
import { thumbUrl } from '../utils/imageUrl'
import { isRestricted } from '../stores/settingsStore'
import { isLoggedIn } from '../stores/authStore'
import SkeletonCard from '../components/SkeletonCard.vue'
import SkeletonImage from '../components/SkeletonImage.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import RestrictOverlay from '../components/RestrictOverlay.vue'
import IllustTypeBadgeRow from '../components/IllustTypeBadgeRow.vue'
import NavigationBar from '../components/NavigationBar.vue'
import RefreshableList from '../components/RefreshableList.vue'
import { t0log } from '../debug/t0Diag' // [T0-DIAG]
import { NAV_TABS, type NavTab } from '../components/navTabs'
import { RECOMMENDED_A11Y_LABELS, FAB_MENU_A11Y_LABELS } from '../utils/accessibility'

// 底部导航 tabs：数据源 = 共享 NAV_TABS（推荐/插画/小说/我的）。
// 本页局部变量名保持 navTabs（既有模板绑定 + unit.test 源码断言），
// me tab 的 a11yLabel 用 RECOMMENDED_A11Y_LABELS.openMe（=「我的」，与共享值一致，
// 保持 accessibility 注册表被消费）。
const navTabs: NavTab[] = NAV_TABS.map((t) =>
  t.name === 'me' ? { ...t, a11yLabel: RECOMMENDED_A11Y_LABELS.openMe } : t,
)

function onNavSelect(tab: NavTab) {
  if (tab.name === 'recommended') return
  void navigate(tab.path, { replace: true })
}

// ─── 按钮分页 feed（插画推荐 + 小说推荐，ADR-0114） ───
// sources 顺序即 mergeByTime 同分 tie-break 优先级：illust 在前。
// key 前缀区分类型且全局唯一（i-<id> / n-<id>），页内按 key 去重（跨页不去重，缓存一致性）。
// 推荐端点：nextUrl 非空时请求该游标（loadNext/loadNovelNext），首载拉第一页（loadRecommended*）。
function mapIllusts(r: {
  illusts: PixivIllust[]
  next_url: string | null
}): { items: MixFeedItem[]; nextUrl: string | null } {
  return {
    items: r.illusts.map((i) => ({ kind: 'illust' as const, key: `i-${i.id}`, id: i.id, data: i })),
    nextUrl: r.next_url,
  }
}

function mapNovels(r: {
  novels: PixivNovel[]
  next_url: string | null
}): { items: MixFeedItem[]; nextUrl: string | null } {
  return {
    items: r.novels.map((n) => ({ kind: 'novel' as const, key: `n-${n.id}`, id: n.id, data: n })),
    nextUrl: r.next_url,
  }
}

const pagedSources: PagedFeedSource[] = [
  {
    name: 'illust',
    fetchPage: (signal, nextUrl) =>
      nextUrl ? loadNext(nextUrl, signal).then(mapIllusts) : loadRecommended(signal).then(mapIllusts),
  },
  {
    name: 'novel',
    fetchPage: (signal, nextUrl) =>
      nextUrl ? loadNovelNext(nextUrl, signal).then(mapNovels) : loadRecommendedNovels(signal).then(mapNovels),
  },
]

const feed = createPagedFeed({
  sources: pagedSources,
  // 预留 onUpdate 契约（按钮模式无自动加载路径，当前不触发；未来预取/自动刷新复用）
  onUpdate: () => {
    sync()
    t0log('[recommended]', 'onUpdate fired') // [T0-DIAG]
  },
})

// ─── 响应式桥接：feed 是纯函数式状态，页面用本地 ref 快照渲染 ───
// 每次 feed 状态可能变化后调用 sync() 重新快照（首载/翻页/刷新完成、以及初始 onMounted）。
const items = ref<MixFeedItem[]>(feed.items())
const loading = ref(feed.loading())
const errorMsg = ref(feed.error() ?? '')
/** 当前页号（1 起，用户视角） */
const pageIndex = ref(1)
const hasPrev = ref(false)
const hasNext = ref(false)

function sync() {
  items.value = feed.items()
  loading.value = feed.loading()
  errorMsg.value = feed.error() ?? ''
  pageIndex.value = feed.pageIndex() + 1
  hasPrev.value = feed.hasPrev()
  hasNext.value = feed.hasNext()
  t0log('[recommended]', `sync page=${pageIndex.value} items=${items.value.length} hasPrev=${hasPrev.value} hasNext=${hasNext.value}`) // [T0-DIAG]
}

/**
 * 统一翻页/刷新入口（spec §3.2 flip）：先**同步启动** feed 动作（inflight++ 在动作同步段生效），
 * 再快照——这样 loading=true 被捕获（首载骨架屏 / 切页「加载中…」footer 可见）；
 * 完成后再次快照 + 同 tick epoch 重建（ADR-0107 D4：整树替换，重建 = 从页顶看新页）。
 * 三路（refresh/next/prev）共用，消除同构重复（review minor-4）。
 */
async function flip(action: () => Promise<void>) {
  const p = action() // 同步启动：inflight++ 已生效
  sync()
  await p
  sync()
  refreshEpoch.value++
}

/** 刷新（FAB / 补拉）：回第 1 页重拉（清缓存）。绑定 RefreshableList :refresh（返回 Promise） */
function refreshFeed() {
  t0log('[recommended]', 'refresh tapped') // [T0-DIAG]
  return flip(() => feed.refresh())
}

/** 下一页（FAB）：拉两路下一页 → 时间合并 → 替换当前页（翻书：从页顶看新页） */
function goNext() {
  t0log('[recommended]', 'next tapped') // [T0-DIAG]
  return flip(() => feed.next())
}

/** 上一页（FAB）：切回缓存页（零请求） */
function goPrev() {
  t0log('[recommended]', 'prev tapped') // [T0-DIAG]
  return flip(() => feed.prev())
}

/** list 强制重建代（refresh/切页后 ++，驱动 :key 替换 = 从页顶看新页） */
const refreshEpoch = ref(0)

/** FAB menu 扩展项（T4）：上一页/下一页，visible 按 hasPrev/hasNext 显隐（每次渲染求值）。
    onTap 返回 Promise → RefreshableList 接管 busy（操作中禁展开/禁其他项）。
    accessibilityLabel 走 FAB_MENU_A11Y_LABELS 注册表（review minor-3）。 */
const fabMenuItems: FabMenuExtraItem[] = [
  {
    key: 'prev',
    icon: '‹',
    label: '上一页',
    accessibilityLabel: FAB_MENU_A11Y_LABELS.prevPage,
    visible: () => hasPrev.value,
    onTap: () => goPrev(),
  },
  {
    key: 'next',
    icon: '›',
    label: '下一页',
    accessibilityLabel: FAB_MENU_A11Y_LABELS.nextPage,
    visible: () => hasNext.value,
    onTap: () => goNext(),
  },
]

// 详情跳转：按 item.kind 决定插画 / 小说详情路由
function openItem(item: MixFeedItem) {
  const prefix = item.kind === 'illust' ? '/illust/' : '/novel/'
  void navigate(`${prefix}${item.id}`)
}

// 图片区点击（spec：列表交互）：受限条目（R18/R18G 且开关关闭）不跳详情，其余进详情。
// 外层 .stop 继续保证遮罩点击不穿透；RestrictOverlay 自身 @tap="swallow" 双保险。
function onImageTap(item: MixFeedItem) {
  if (!isRestricted(item.data)) openItem(item)
}

onMounted(() => {
  void refreshFeed()
})

// 释放 feed：清挂起补触发 + 作废在途响应（spec §4 T1 dispose）
onUnmounted(() => {
  feed.dispose()
})

// [首帧内容化]（#63）：初始路由为推荐页，组件可能在登录态就绪前被挂载
// （含 KeepAlive 缓存实例）。首帧 fetch 在 token 恢复前会 401 失败，需补拉，
// 两条路径均幂等（数据非空/加载中则跳过）：
// 1) watch(isLoggedIn)：token 恢复完成 / 登录成功（false→true）后补拉
// 2) onActivated：从 login replace 回 recommended 时复用 KeepAlive 缓存实例
//    （onMounted 不重跑，仅有 onActivated 触发）
watch(isLoggedIn, (loggedIn) => {
  // 注意：不检查 loading——restoreToken 完成可能早于首帧 401 返回（loading=true 期间），
  // 若此时跳过则无后续触发器（navigate replace 同路径不重挂、onActivated 不触发）。
  // refreshFeed 幂等，并发最坏多一次请求，不损坏数据。
  if (loggedIn && feed.items().length === 0) {
    void refreshFeed()
  }
})

onActivated(() => {
  if (feed.items().length === 0 && !feed.loading() && isLoggedIn.value) {
    void refreshFeed()
  }
})
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：surface 背景 + 居中标题（title-large），无导航图标（顶层页） -->
    <view class="flex flex-row items-center justify-center h-[17.067vw] px-4 bg-surface">
      <text class="text-title-large font-medium text-surface-on">推荐</text>
    </view>

    <text v-if="errorMsg && items.length === 0" class="text-body-small text-error p-4">{{ errorMsg }}</text>

    <!-- [lynx:fix] 骨架屏：首屏加载（无数据）时显示 shimmer 卡片占位，数据就绪后切换 list。
         8 个 ≈ 4 行两列，与真实卡片同比例（48.4vw 宽 + 方形图片）避免切换 reflow -->
    <!-- [lynx:fix] 骨架屏不占满全屏高度（h-full 会溢出覆盖底部导航栏，拦截 tap，issue #129）：
     改 flex-1 min-h-0 约束在导航栏下方的内容区内 -->
    <view v-if="loading && items.length === 0" class="w-full flex-1 min-h-0 flex flex-row flex-wrap content-start p-1.5">
      <SkeletonCard v-for="n in 8" :key="n" />
    </view>

    <RefreshableList
      v-else-if="!loading || items.length > 0"
      :refresh="refreshFeed"
      :items="fabMenuItems"
      @back-to-top="refreshEpoch++"
    >
    <list
      :key="refreshEpoch"
      class="w-full h-full"
      list-type="waterfall"
      scroll-orientation="vertical"
      :span-count="2"
      :style="{ listMainAxisGap: '12px', listCrossAxisGap: '12px' }"
    >
      <list-item
        v-for="item in items"
        :key="item.key"
        :item-key="item.key"
        class="bg-surface-container-lowest rounded-[var(--md-shape-medium)] flex flex-col overflow-hidden shadow-[var(--md-elevation-1)]"
      >
        <!-- [lynx:fix] 原生 list-item 根级 @tap 失效（fiber 不触发，真机实测 2026-08-02）；
             把 openItem 绑到内容 view（子元素 tap 已验证工作），BookmarkButton 的 @tap.stop 仍阻止冒泡 -->
        <view class="w-full flex flex-col" @tap="openItem(item)">
        <!-- [lynx:fix] 间距：web-core 瀑布流引擎忽略 list-item 的 margin/padding 且内部任何 view 包裹
             都会导致 item 定位计算崩（全部重叠在起点）。间距用 list 官方属性
             list-main-axis-gap（行距）/ list-cross-axis-gap（列距），经 vue-lynx style 对象绑定
             （attribute 形式 web-core 不响应）。原生 LynxView 同样支持这两个属性（ADR-0048） -->
        <!-- [lynx:fix] 图片级骨架（SkeletonImage）：显式 height="48.4vw"（= 卡片宽 w-[48.4vw]，保持方形），
             原生 LynxView 下 aspect-ratio + min-h 组合解析为 0 导致图片不显示（issue #140）；
             图片 @load 后才隐藏 shimmer 显示图片（骨架关闭时机 = 图片加载完成，而非 API 数据返回） -->
        <!-- 受限条目图片区：独立遮罩卡（流内无 absolute——真机 Lynx 下 absolute 子元素会被
             list item 高度测量算进内容高度，导致整卡撑满内容区，实测 2026-08-11） -->
        <view
          v-if="isRestricted(item.data)" @tap.stop
          class="w-full h-[48.4vw] flex items-center justify-center bg-[var(--md-scrim)] rounded-[var(--md-shape-medium)]"
        >
          <RestrictOverlay :overlay="false" :level="item.data.x_restrict === 2 ? 2 : 1" />
        </view>
        <view v-else class="relative" @tap.stop="onImageTap(item)">
          <SkeletonImage :src="thumbUrl(item.data.image_urls)" height="48.4vw" lazy-load />
        </view>

        <!-- 插画卡：封面 + 类型徽章行（动图/多图，ADR-0113）+ 标题 + 作者 + 收藏按钮 -->
        <template v-if="item.kind === 'illust'">
          <!-- 类型徽章行：流内元素（禁 absolute），受限条目照常显示；普通单图零占位 -->
          <IllustTypeBadgeRow :illust="item.data" />
          <text class="text-title-small font-medium text-surface-on mt-2 mx-2.5 [max-line:1]">{{ item.data.title }}</text>
          <text class="text-body-small text-surface-on-variant mt-1 mx-2.5 [max-line:1]">{{ item.data.user.name }}</text>
          <view class="mt-1 mx-2.5 mb-2.5">
            <BookmarkButton
              :illust-id="item.data.id"
              :initial-bookmarked="item.data.is_bookmarked"
              :bookmark-count="item.data.total_bookmarks"
            />
          </view>
        </template>

        <!-- 小说封面卡：封面 + 标题（2 行）+ 作者 + 字数 -->
        <template v-else>
          <text class="text-title-small font-medium text-surface-on mt-2 mx-2.5 [max-line:2]">{{ item.data.title }}</text>
          <text class="text-body-small text-surface-on-variant mt-1 mx-2.5 [max-line:1]">{{ item.data.user.name }}</text>
          <text class="text-label-medium text-surface-on-variant mt-1 mx-2.5 mb-2.5">{{ item.data.text_length }} 字</text>
        </template>
        </view>
      </list-item>
      <!-- footer：切页 loading / 当前页错误 / 页号 + 到底提示（按钮分页 ADR-0114） -->
      <list-item v-if="loading" :key="'footer-loading'" item-key="footer-loading" class="w-full h-10 flex items-center justify-center" full-span>
        <text class="text-body-medium text-outline">加载中…</text>
      </list-item>
      <list-item v-else-if="errorMsg" :key="'footer-error'" item-key="footer-error" class="w-full h-10 flex items-center justify-center" full-span>
        <text class="text-body-medium text-error">{{ errorMsg }}</text>
      </list-item>
      <list-item v-else :key="'footer-page'" item-key="footer-page" class="w-full h-10 flex items-center justify-center" full-span>
        <text class="text-body-medium text-outline">第 {{ pageIndex }} 页<template v-if="!hasNext"> · 没有更多了</template></text>
      </list-item>
    </list>
    </RefreshableList>

    <!-- M3 NavigationBar：底部四 tab（推荐/插画/小说/我的） -->
    <NavigationBar :tabs="navTabs" :active-name="'recommended'" @select="onNavSelect" />
  </view>
</template>

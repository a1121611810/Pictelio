<script setup lang="ts">
// 发现页（/discover）：[维度重构 2026-10-03] 顶层目的地由「推荐」改名为「发现」，
// 插画/小说降为页内二级 Tabs；本页承接原综合推荐页的插画 + 小说混合内容，
// 改**单卡 swipe 轮播**（ADR-0115）。
// 数据层由 createMixFeed（merge:'time-merge'）承载：两路（插画/小说）按 create_date 时间交叉
// 合并成增长流 + fetchMore（双防抖/竞态代/去重/分批渲染/15s 超时）；页面只做 ref 快照桥接 + 渲染。
// 渲染层 = CarouselSwiper（自研 swipe，**后台线程**触摸 + Vue 响应式 :style 绑定 translateX + px 吸附，
// 因官方「主线程脚本」在本项目原生 LynxView 整块空白、判定不可用，ADR-0115 T5 修订）——一滑页一个
// 作品，沉浸式全 bleed 大图卡，信息叠底部渐变 scrim。受限条目经 visibleItems 过滤（数据层仍加载，
// 开关切换时 computed 重算即可，无需重请求）。刷新/回顶经全局放射 FAB（globalFab 桥接，
// view.isBusy 驱动旋转）；本页不再渲染自持 FAB。
// [ADR-0118 打磨 R2] 封面「宽满高按比例」（deriveCoverDisplay + SystemInfo 视口派生，超高图回退
//   aspectFill）；首载渲染流为空即显沉浸骨架（CarouselSkeleton，不依赖 loading）；滑页 scrim 区
//   展示标签胶囊行（TagChipRow，3+N）。吸附阈值 + fling 在 CarouselSwiper 内部（swiperMath）。
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'discover' })
import { ref, computed, onMounted, onActivated, onUnmounted, watch } from 'vue'

import { navigate } from '../router'
import { useHeroSource } from '../composables/heroTransition'
import { artworkTitle } from '../utils/artworkTitle'
import { openNovel } from '../utils/novelNavigation'
import { loadRecommended, loadNext } from '../api/illust'
import { loadRecommendedNovels, loadNovelNext } from '../api/novel'
import type { PixivIllust, PixivNovel } from '../api/types'
import { createMixFeed, type MixFeedItem, type MixFeedSource } from '../primitives/createMixFeed'
import { proxyImageUrl } from '../utils/imageUrl'
import { deriveCoverDisplay } from '../utils/coverDisplay'
import { useSettingsStore } from '../stores/settingsStore'
import { useAuthStore } from '../stores/authStore'
import { useGlobalFabStore } from '../stores/globalFab'
import CarouselSwiper from '../components/CarouselSwiper.vue'
import RecommendedCover from '../components/RecommendedCover.vue'
import CarouselSkeleton from '../components/CarouselSkeleton.vue'
import SubTabBar from '../components/SubTabBar.vue'
import TagChipRow from '../components/TagChipRow.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import IllustTypeBadgeRow from '../components/IllustTypeBadgeRow.vue'
import { A11Y_ELEMENT_ENABLED, ME_A11Y_LABELS } from '../utils/accessibility'
import AppIcon from '../components/AppIcon.vue'
import { safeTop } from '../utils/safeArea'
import { useTopInsetSpacer } from '../composables/useTopInsetSpacer'
import { useSearchSheetStore } from '../stores/searchSheetStore'
import { useUsageMetricsStore } from '../stores/usageMetrics'
import { type DiscoverTabKey } from '../primitives/usageMetrics'
import { useReducedMotion } from '../composables/useReducedMotion'
import { t } from '../i18n'

const isRestricted = useSettingsStore().isRestricted

/**
 * B 变体开关的**本地别名**（票 #906）。
 *
 * 为什么不能直接在模板里写 `__HOME_BLEED_HEADER__`：它是 rspeedy 注入的编译期全局 const，
 * `<script setup>` 能读到，但 **vue-lynx 模板编译器不解析全局标识符** —— 模板里直接写会得到
 * "Property '__HOME_BLEED_HEADER__' does not exist"，且**不报错、渲染为空**。
 * 经 setup 绑定暴露后模板才拿得到。
 */
const HOME_BLEED = __HOME_BLEED_HEADER__

// 自让位 spacer 高度（票 #907）。B 变体开启时 meta 为 'bleed' ⇒ 本值恒 0（不重复让位），
// 关闭时 meta 为 'self' ⇒ 由本页承担顶部让位（根容器已不再兜底）。
const topInsetSpacer = useTopInsetSpacer()

// ─── 时间合并 feed（插画 + 小说，ADR-0115） ───
// sources 顺序即 mergeByTime 同分 tie-break 优先级：illust 在前。
// key 前缀区分类型且全局唯一（i-<id> / n-<id>）；合并 + 去重在 createMixFeed 内部完成。
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
    items: r.novels.map((n) => {
      // 缺字段显式告警（测试硬约束 #3 / spec 数据契约：禁止静默降级）——
      // total_bookmarks 缺失 → BookmarkButton 隐含隐藏计数（props undefined）；text_length 缺失 → 字数行不渲染。
      // 两者都不应影响其它字段渲染（推荐页不能因单条脏数据整页失败）。
      if (typeof n.total_bookmarks !== 'number') {
        console.warn('[recommended] 推荐小说缺少 total_bookmarks（契约破坏），该条隐藏收藏数', n.id)
      }
      if (typeof n.text_length !== 'number') {
        console.warn('[recommended] 推荐小说缺少 text_length（契约破坏），该条隐藏字数', n.id)
      }
      return { kind: 'novel' as const, key: `n-${n.id}`, id: n.id, data: n }
    }),
    nextUrl: r.next_url,
  }
}

/** 发现页内二级 tab：媒介维度（'all' = 插画+小说混流时间交叉）。
 *  [维度重构 2026-10-03] 插画/小说此前是两个**顶层**目的地，但它们是同一目录下的两个视角，
 *  按 M3 应属页内 Tabs（"Tabs share a common subject, whereas bottom navigation destinations
 *  are top-level and disconnected from each other"）⇒ 降为二级，顶层让位给"更新/书架"。
 *  复用 SubTabBar（IllustList/NovelList 已在用，ADR-0194），不新造组件。 */
type DiscoverTab = DiscoverTabKey
const tab = ref<DiscoverTab>('all')

const illustSource: MixFeedSource = {
  name: 'illust',
  fetchPage: (signal, nextUrl) =>
    nextUrl ? loadNext(nextUrl, signal).then(mapIllusts) : loadRecommended(signal).then(mapIllusts),
}
const novelSource: MixFeedSource = {
  name: 'novel',
  fetchPage: (signal, nextUrl) =>
    nextUrl ? loadNovelNext(nextUrl, signal).then(mapNovels) : loadRecommendedNovels(signal).then(mapNovels),
}

/** 按二级 tab 组装 source 列表。sources 顺序即 mergeByTime 同分 tie-break 优先级：illust 在前。 */
function sourcesFor(m: DiscoverTab): MixFeedSource[] {
  if (m === 'illust') return [illustSource]
  if (m === 'novel') return [novelSource]
  return [illustSource, novelSource]
}

function makeFeed(m: DiscoverTab) {
  return createMixFeed({
    sources: sourcesFor(m),
    merge: 'time-merge',
    autoStart: false, // 页面统一经 refreshFeed 触发首载（含 token 恢复补拉）
    onUpdate: () => sync(), // 模块内部自动补触发（P1）完成后通知页面重新快照
  })
}

// ⚠️ 用 `let` 而非 ref：createMixFeed 返回的是带方法的命令式对象，全文 5 处调用点
// （items/error/pageError/refresh/fetchMore/dispose）都写死成 `feed.xxx()`。
// 改成 ref 会把每处都变成 `feed.value.xxx()`，diff 变大且无收益——切换时**重建实例**即可，
// 这与 IllustList/NovelList 的 makeFeed(mode) + mode 重建实例是同一套路。
let feed = makeFeed(tab.value)

// ─── 响应式桥接：feed 是纯函数式状态，页面用本地 ref 快照渲染 ───
// [ADR-0118] 首载骨架「渲染流为空即显」（不依赖 loading）：loading 标志不再参与显隐，移除本地镜像。
const items = ref<MixFeedItem[]>(feed.items())
const errorMsg = ref(feed.error() ?? '')
const pageError = ref(feed.pageError() ?? '')

function sync() {
  items.value = feed.items()
  errorMsg.value = feed.error() ?? ''
  pageError.value = feed.pageError() ?? ''
}

// ─── 发现页内二级 tab（媒介维度）───
const tabItems = computed(() => [
  { key: 'all' as const, label: t('discover.tab.all') },
  { key: 'illust' as const, label: t('discover.tab.illust') },
  { key: 'novel' as const, label: t('discover.tab.novel') },
])

/** 切二级：作废旧 feed 实例并按新 source 重建（不跨媒介复用已加载的流）。
 *  ⚠️ 必须先 dispose 再重建——旧实例内部还有 in-flight 请求与定时器，
 *  不释放会在切 tab 后继续往共享 ref 里写脏数据。 */
function switchTab(next: DiscoverTab): void {
  if (next === tab.value) return
  // 本地度量读点（spec §4 P0.5「二级使用占比」）。失败不得影响切换。
  try {
    useUsageMetricsStore().recordSubTabUse(next)
  } catch (e) {
    console.warn('[discover] 二级使用度量记录失败（不影响切换）', e)
  }
  tab.value = next
  feed.dispose()
  feed = makeFeed(next)
  items.value = []
  errorMsg.value = ''
  pageError.value = ''
  void refreshFeed()
}

// ─── 封面比例显示（ADR-0118 / spec §2.1、§3.2）：可视区尺寸由 SystemInfo 派生 ───
// 可视区 = 屏幕逻辑尺寸 - 顶栏高（vw 折算为 px；底部导航已由全局放射 FAB 取代，不再预留）。
// ⚠️ 票 #906（B 变体，HOME_BLEED=true）：首页取消实体顶栏、封面直接铺到状态栏下
//    ⇒ 顶栏扣除项归零。**漏改这里的后果**：仍按 64dp 扣 → 可视区算小 64dp → 封面比例整体
//    偏移，且**每张图都错却不自证**（只是"看起来略满"）。与 meta 的 'bleed' 必须同步。
// pixelHeight 缺失时按 16:9 宽高比估算（防御；低估可用高度 → 略偏向 aspectFill 回退，安全侧）。
declare const SystemInfo: { pixelWidth: number; pixelHeight?: number; pixelRatio: number }
function slideViewport(): { width: number; height: number } {
  if (typeof SystemInfo === 'undefined') return { width: 375, height: 667 } // web-core 兜底（iPhone 逻辑尺寸近似）
  const w = SystemInfo.pixelWidth / SystemInfo.pixelRatio
  const screenH = SystemInfo.pixelHeight ? SystemInfo.pixelHeight / SystemInfo.pixelRatio : w * 1.78
  // B 变体无实体顶栏 ⇒ 扣除项为 0；否则扣 64dp 顶栏（17.067vw）
  const bars = HOME_BLEED ? 0 : 0.17067 * w
  // ⚠️ [维度重构 2026-10-03] 二级 tab（SubTabBar，h-[12.8vw]）是**流内**元素，
  //   在**两种模式下**都占高度（bleed 下额外加 safeTop 让位）。
  //   漏扣的后果：封面按"比实际更高"的视口算比例 ⇒ 铺出容器外被裁，且每张图都错却不自证。
  const safe = typeof safeTop === 'number' ? safeTop : 0
  const tabBar = 0.128 * w + (HOME_BLEED ? safe : 0)
  return { width: w, height: Math.max(1, screenH - bars - tabBar) }
}
const SLIDE_VIEWPORT = slideViewport()

/** 每张滑页的封面显示参数（fit/ratio，喂 RecommendedCover）：插画用 API width/height，
 *  小说无尺寸字段 → 1:1 方形契约（deriveCoverDisplay 内部处理，非静默降级见下）。 */
function coverDisplayOf(item: MixFeedItem): { fit: 'cover' | 'width-fill'; ratio: string } {
  const isIllust = item.kind === 'illust'
  if (isIllust && (!item.data.width || !item.data.height)) {
    console.warn('[recommended] 插画缺少尺寸元数据，按 1:1 方形封面显示', item.id)
  }
  const { fit, ratio } = deriveCoverDisplay({
    imgWidth: isIllust ? item.data.width : undefined,
    imgHeight: isIllust ? item.data.height : undefined,
    viewportWidth: SLIDE_VIEWPORT.width,
    viewportHeight: SLIDE_VIEWPORT.height,
  })
  return { fit, ratio }
}

/** 刷新代：每次刷新递增，作为 CarouselSwiper 的 :key 触发其重挂载（重置 offset/索引回到第一张）。
 *  spec §2.4/§5「刷新 = 清流重载、回第一张」——轮播内部 offset/index 是常驻 refs，
 *  不随 feed 刷新自动复位，故用 epoch 重挂载实现回到第一张（对照 IllustList 的 `:key="refreshEpoch"`）。 */
const refreshEpoch = ref(0)

/** 刷新：bump refreshEpoch（回第一张）+ 清流重载；busy 维度由 globalFab view.isBusy 驱动 */
async function refreshFeed() {
  refreshEpoch.value++ // 触发 CarouselSwiper 重挂载（回第一张）
  sync() // 捕获渲染流清空（items=[] → 若仍在首载则显示沉浸骨架）
  try {
    await feed.refresh()
  } catch (err) {
    console.warn('[recommended] 刷新失败', err)
  } finally {
    sync()
  }
}

// ─── 受限过滤（渲染层）：数据层照常加载，受限条目从可视滑页流中滤掉 ───
// isRestricted 依赖 settingsStore 的 showR18/showR18G（响应式），computed 自动随开关重算。
// AI 三态（ADR-0155）：本页 R18 走「过滤隐藏」，AI 同口径——mask 隐藏 AI / only 隐藏非 AI。
// 标签静音（ADR-0187 / #732）：命中词表条目同在本组装点移除（「静音=不可见」）。
const shouldHideByAi = useSettingsStore().shouldHideByAi
const isTagMuted = useSettingsStore().isTagMuted
const visibleItems = computed(() =>
  items.value.filter((it) => !isRestricted(it.data) && !shouldHideByAi(it.data) && !isTagMuted(it.data)),
)

// ─── 轮播回调 ───
function onReachEnd() {
  void feed.fetchMore()
}
// 当前滑页索引（供未来指示器使用；spec §6 本轮排除指示器，故暂只跟踪不渲染——非死状态，勿删）
const currentIndex = ref(0)
function onIndexChange(index: number) {
  currentIndex.value = index
}

// [真机修复] scrim 抽到页面级遮罩：按当前页索引取当前条目作为遮罩内容（文字不进被平移的 flex-row）
const currentItem = computed(() => visibleItems.value[currentIndex.value] as MixFeedItem | undefined)

// 缩略图 → 大图连续性转场（ADR-0211 决策 12）：本页在 KeepAlive 白名单内 ⇒ 返回方向也成立。
// resolveSrc 给覆盖层提供同一张封面（地址仍由本页 coverSrc 决定，不在模块里猜档位）。
const heroTransition = useHeroSource({
  resolveSrc: (id: number) => {
    const item = visibleItems.value.find((i) => i.kind === 'illust' && i.id === id)
    return item ? coverSrc(item.data) : ''
  },
})

// 详情跳转：按 kind 分流；受限条目（理论上已被过滤）再加一道守卫。
// 小说经 openNovel 缝隙导航（ADR-0183：介绍页先行可经设置关闭）；插画保持直达详情不变。
function openItem(item: MixFeedItem) {
  if (item.kind === 'illust') {
    heroTransition.begin(item.id) // 发起矩形测量（不等待，决策 12 机制 1：不给导航加可见延迟）
    void navigate(`/illust/${item.id}`)
    return
  }
  openNovel(item.id)
}
function onSlideTap(item: MixFeedItem) {
  if (!isRestricted(item.data) && !shouldHideByAi(item.data)) openItem(item)
}

// 点击标签 → 全局搜索弹层（ADR-0133）：TagChipRow 只发原始 tag.name（纯展示组件不依赖 store），
// 页面层接线 openSearch——与 webview SearchableTag「点击即搜」语义一致（预填 + 自动搜索）。
function onTagTap(name: string) {
  useSearchSheetStore().openSearch(name)
}

/** 标签长按静音（ADR-0187 D5 / #732）：加入词表 + 轻提示（App.vue 宿主消费 muteTagHint） */
function onTagLongPress(name: string) {
  useSettingsStore().muteTag(name)
}

// 沉浸式封面图（全 bleed 用大图，退化 medium/square_medium）
function coverSrc(data: PixivIllust | PixivNovel): string {
  const u = data.image_urls
  return proxyImageUrl(u.large || u.medium || u.square_medium || '')
}

// ─── 全局放射 FAB 桥（ADR-0120）：注册本页动作到 globalFab，卸载时注销 ───
let unreg: (() => void) | undefined
onMounted(() => {
  unreg = useGlobalFabStore().usePage('discover', {
    refresh: refreshFeed,
    backToTop: () => {
      refreshEpoch.value++
    },
  })
  if (HOME_BLEED) showTitleChip()
  void refreshFeed()
})

onUnmounted(() => {
  unreg?.()
  feed.dispose()
})

// [首帧内容化]（#63）：初始路由为推荐页，组件可能在登录态就绪前被挂载。
// 首帧 fetch 在 token 恢复前会 401 失败，需补拉（幂等：数据非空/加载中则跳过）。
watch(() => useAuthStore().isLoggedIn, (loggedIn) => {
  if (loggedIn && feed.items().length === 0) {
    void refreshFeed()
  }
})

onActivated(() => {
  if (feed.items().length === 0 && !feed.loading() && useAuthStore().isLoggedIn) {
    void refreshFeed()
  }
  // 从二级页返回时重放标题胶囊：否则「返回后顶部一片空」会被误读成渲染失败
  if (HOME_BLEED) showTitleChip()
})

// ─── B 变体：标题胶囊（票 #906 / spec #900 T2）───
// 静止态顶部零占用；进场显示一次，2s 后淡出。
// ⚠️ 为什么不是「滚动后出现」：**真机实测推荐页没有纵向滚动**（内容高度 = 视口高度，
//    封面按可视区铺满），唯一的「滚动」是横向轮播翻页。原先设想的 scroll 触发源不存在，
//    照抄会得到一个永不触发的机制。现改为「进场 → 淡出」，既给到定位提示又不长期占位。
// 减弱动效偏好下走 R1：不挂过渡声明（transitionStyle 置 none），但仍按同一时长收起
// —— 收起本身是**信息消失**，不是装饰动画，直接不消失会让顶部永久被遮挡。
const TITLE_CHIP_HOLD_MS = 2000
const titleChipVisible = ref(false)
let titleChipTimer: ReturnType<typeof setTimeout> | undefined
const { transitionStyle: chipTransition } = useReducedMotion()

function showTitleChip(): void {
  if (titleChipTimer) clearTimeout(titleChipTimer)
  titleChipVisible.value = true
  titleChipTimer = setTimeout(() => {
    titleChipVisible.value = false
  }, TITLE_CHIP_HOLD_MS)
}

onUnmounted(() => {
  if (titleChipTimer) clearTimeout(titleChipTimer)
})

/** 标题胶囊文案 = 当前二级 tab 名（切到「小说」时说「发现」会误导定位）。 */
const chipText = computed(() => tabItems.value.find((i) => i.key === tab.value)?.label ?? t('discover.title'))
</script>

<template>
  <!-- :id="heroTransition.rootId"：hero 覆盖层的 absolute 锚点 + 视口↔页面坐标换算基准（ADR-0211 决策 12） -->
  <view class="w-full h-full flex flex-col relative bg-surface" :id="heroTransition.rootId">
    <!-- [票 #920 / ADR-0216] 四个根页去掉 header —— 本页**两种模式都不再画实体顶栏**。
         结构说明（⚠️ 按实际模板写，勿照字面想象出并不存在的分支）：
         下方是**两个**互为 v-if / v-else 的兄弟节点，它们承载「让位」与「悬浮层」，
         **不是**顶栏行：
           · `v-if="!HOME_BLEED"`（回退阀）→ 零内容让位 spacer，高度取 topInsetSpacer
             （meta='self' ⇒ safeTop）。B 变体下该节点**不渲染**（meta='bleed' ⇒ 让位 0）。
           · `v-else`（B 变体，缺省）→ 顶部悬浮覆盖层（通知按钮 + 标题胶囊），absolute 不占流内高度。
         保留这对分支的**唯一目的**是让让位归属与 router meta 保持同源
         （safeAreaJavaContract 门禁的核心不变量），不是为了「有没有顶栏」——两条都没有顶栏。

         ⚠️ 回退阀下的观感 =「顶部一条让位空白 + 无标题 + 无悬浮层」。
           **这与 ADR-0214:48/179 承诺的「回到旧的 64dp 实体顶栏、逐像素一致」相反**，
           是票 #920 / ADR-0216「四个根页一律去 header」裁定的直接后果，不是回退阀失灵。
           回退阀现在只回退**让位口径**（bleed↔self），不再回退顶栏本身。
         ⚠️ 把 v-if 删掉会让 meta 与模板不同源（一边 bleed 一边 self），
            破版在真机才可见、编译/单测/门禁全绿 —— 门禁正是为此设的。 -->
    <view v-if="!HOME_BLEED" :style="{ height: topInsetSpacer + 'px' }" />

    <!-- B 变体悬浮层（票 #906）：absolute 覆盖层，不占流内高度 ⇒ 静止态顶部零占用。
         ⚠️ [维度重构 2026-10-03] **通知按钮已移除**。原注释自陈「通知页目前只能从「我的」进入，
            顶栏补一个直达位」——那是分组错误下的**局部补丁**，等于给同一功能开第二条进入路径。
            NN/g：progressive disclosure 的目标是让用户尽快用上首屏，"it's rarely a good idea to
            offer **multiple ways to progress to secondary options**"。
            通知的主入口现为「更新」页第三段，外环「更新」项另带未读角标（读点见
            stores/globalFab.ts 的 navBadge），本页不再重复。
            ⚠️ 「我的」页按决策 4=B 仍保留通知/追更次级入口，故严格说通知有 3 条路径而非唯一；
            该偏离已在 spec §2.4 / §3.2 显式登记，不再在此复述。
         ① 状态栏可读性遮罩保留（与通知按钮无关，见下）。
         ② 标题胶囊进场显示、2s 淡出（真机实测本页无纵向滚动，scroll 触发源不存在）。 -->
    <view v-else class="absolute left-0 right-0 top-0 z-30">
      <!-- ① 状态栏可读性兜底（票 #906 风险①/⑤，实测驱动）：
           封面出血到 y=0 后，**系统状态栏图标的底色变成不可预测的封面像素**。
           而原生侧 `isAppearanceLightStatusBarsFor(isDarkMode)` 把图标深浅**绑死在 app 主题**上
           （它无法跟随内容），所以图标颜色是对的、底色却不可控。
           实测（emulator-5554 / 亮色）：出血后状态栏区背景在 rgb(255,253,254) ~ rgb(41,7,8) 之间
           浮动 ⇒ 深色图标对最暗处对比度 **1.09:1**（近乎不可见）；出血前恒为 rgb(248,250,255) ⇒ 16.37:1。
           ⇒ 在顶部铺一层**跟随主题**的 surface 渐隐遮罩，把底色拉回图标被设计时面对的那种。
           渐变而非实色：y=0 处足够实（保证对比度），到 ~2.2×inset 处完全消失（不毁沉浸感）。
           ⚠️ 色值必须走令牌 var(--md-surface)（14 套色板 + 深色模式），不得写字面量。 -->
      <view
        class="absolute left-0 right-0 top-0"
        :style="{
          height: Math.round(safeTop * 2.2) + 'px',
          background: 'var(--md-statusbar-scrim)',
        }"
      />
      <!-- 标题胶囊：顶部原先有一行通知按钮占位，移除后本容器需自带 safeTop 让位，
           否则胶囊会压进状态栏（状态栏遮罩只解决**底色对比度**，不解决**布局避让**）。 -->
      <view class="px-3" :style="{ paddingTop: safeTop + 8 + 'px' }">
        <view
          v-if="titleChipVisible"
          class="self-start inline-flex flex-row items-center rounded-full px-4 h-8.5 max-w-[72vw]"
          :style="{ background: 'var(--md-scrim)', transition: chipTransition }"
        >
          <!-- max-w + [max-line:1]：胶囊是**内容宽**，无上限时长标题（德语等）会横向撑出屏幕。
               风险④（真机：长语言标题）就落在这两条上。
               文案取**当前二级 tab 名**而非固定「发现」：切到「小说」时仍说发现会误导定位。 -->
          <text
            class="text-title-medium font-medium text-white [max-line:1]"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="chipText"
            >{{ chipText }}</text
          >
        </view>
      </view>
    </view>

    <!-- 二级 tab（媒介维度）。
         ⚠️ 必须在**正常流内**且在两种模式下都渲染：
           ① 放进上面的 absolute 悬浮层 → 只在 HOME_BLEED 分支出现，回退阀下二级 tab 直接消失；
           ② 放进 absolute → 不占流内高度，轮播内容会与它重叠（SubTabBar 自身 h-[12.8vw]）。
           放在 v-if/v-else 让位分支**之后**、轮播**之前**，两种模式的顶部让位口径都能保持不变。

         ⚠️⚠️ 必须 `relative + zIndex 40` 压住上方悬浮层（z-30）。真机实测（emulator-5554）：
           悬浮层是 `absolute left-0 right-0 top-0`，内含状态栏遮罩（高 = safeTop×2.2）
           与标题胶囊容器（paddingTop = safeTop+8）——它的高度会**盖住二级 tab 的上半部分**，
           而 SubTabBar 在正常流里 z-index 无效 ⇒ 文字可见但**点击被遮罩吞掉，tab 切不动**。
           ⚠️ 不用 `pointer-events-none`：本项目 Tailwind preset 裁掉了 pointerEvents
           （写上去是死类名、无规则），与 CommentOverlay 里登记的同一个坑。
           ⇒ 用 z 序解决，不依赖 pointer-events。 -->
    <view
      class="relative"
      :style="{
        zIndex: 40,
        ...(HOME_BLEED ? { paddingTop: safeTop + 'px' } : {}),
      }"
    >
      <SubTabBar :items="tabItems" :model-value="tab" @change="switchTab" />
    </view>

    <!-- 首载沉浸骨架 / 整页错误（ADR-0118：渲染流为空即显骨架，不依赖 loading——冷启动请求前立即出现） -->
    <view v-if="items.length === 0 && !errorMsg" class="w-full flex-1 min-h-0">
      <CarouselSkeleton />
    </view>
    <view v-else-if="errorMsg && items.length === 0" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <text class="text-body-medium text-error">{{ errorMsg }}</text>
    </view>

    <!-- 单卡轮播：一滑页 = 一个作品（沉浸式全 bleed 大图卡） -->
    <!-- [lynx:fix] 内容容器须为 flex-col（flex 容器），否则 CarouselSwiper 根 .swiper-wrapper 的
         flex:1 不拉伸 → 高度塌缩为 0 → slides 0 高 → 推荐页空白（对照 IllustList 用 <list h-full> 填满） -->
    <view v-else class="w-full flex-1 flex flex-col min-h-0 relative">
      <CarouselSwiper
        :key="refreshEpoch"
        :slides="visibleItems"
        :on-index-change="onIndexChange"
        :on-reach-end="onReachEnd"
      >
        <template #slide="{ item }">
          <view
            class="w-full h-full relative flex flex-col bg-surface-container-lowest"
            :class="HOME_BLEED ? 'pt-0 px-3 pb-3' : 'p-3'"
            @tap="onSlideTap(item)"
          >
            <!-- 封面图（ADR-0118 宽满高按比例：fit/ratio 经 deriveCoverDisplay 推导，超高图回退 aspectFill；
                 三态骨架/图片/失败+重试仍由 CoverImage 承载）
                 [真机修复] scrim 不再内嵌于 slide：<text> 在真机 LynxView 的「非首 flex-row 子元素」内不渲染，
                 抽到页面级遮罩（下方），slide 只承载图片。
                 [MD3 差距 #19 / T16 #864 视觉回归] 封面由「满幅出血直角」改为卡片形态：外层 p-3(12dp) 留白 + 内层
                 rounded(--md-shape-medium) 裁切。原先 absolute inset-0 满幅无圆角，与 M3 card
                 语义相悖；本仓已把 --md-shape-medium 注册为 borderRadius 的 DEFAULT 档，
                 此处用档位名而非字面量。裁切靠内层 view 的 overflow-hidden + 圆角（Lynx 原生
                 按 border-radius 裁剪子元素），CoverImage 根元素自身的 overflow-hidden 不足以
                 产生圆角。底部门票级 scrim 遮罩仍覆盖卡片下缘，视觉上与留白区连成一片。 -->
            <!-- :id 只给插画条目（小说无 hero 盒）；非当前页在屏外，heroTransition 会判为「屏外」降级 -->
            <view
              class="relative flex-1 overflow-hidden rounded-[var(--md-shape-medium)]"
              :id="item.kind === 'illust' ? heroTransition.sourceId(item.id) : undefined"
            >
              <RecommendedCover
                :src="coverSrc(item.data)"
                :fit="coverDisplayOf(item).fit"
                :ratio="coverDisplayOf(item).ratio"
              />
            </view>
          </view>
        </template>
      </CarouselSwiper>

      <!-- 页面级 scrim 遮罩（真机修复：文字不进 translate 的 flex-row）
           真机 LynxView 对 flex-row「非首个子元素」内的 <text> 不渲染（仅图片/<view> 正常，且重挂载/换 linear 均无效，
           绿像素检测证实第 2+ 页 title 全屏无渲染）。scrim 本就在屏幕底部（ADR-0118），故抽为页面级固定遮罩、
           按当前页 index 更新内容，从根本上规避 <text> 落入被平移的 flex-row 子元素。
           [权衡] 遮罩为固定覆盖层，底部 scrim 区不响应滑动（真机 LynxView 的 pointer-events 对触摸事件不生效）；
           滑动需从图片区（上部）发起；点卡进详情由本遮罩 @tap 承担（收藏按钮 @tap.stop 不冒泡）。

           [#891] **渐变不再单独承担可读性**。真机实测（emulator-5554 / 1080×2160 / 亮色）：
           遮罩盒高 ≈750px，标题落在盒高 0.48 处、作者在 0.37 处，而
           `linear-gradient(to top, .82, .2 45%, 0)` 在这两处只有 **alpha 0.19 / 0.31**；
           该盒又高过卡片下缘，文字其实压在**页面纯白底**上 ⇒ 白字对比度实测
           **1.56:1（标题）/ 2.17:1（作者）**，远低于 AA 4.5。
           根因是渐变色标按**盒子百分比**归一化，而盒子里标题之上是 90dp 空 padding、
           之下是 37.5dp padding + 收藏 chip —— 最浓的一段花在了没有文字的地方。
           百分比渐变**在原理上无法**随内容高度自适应（把 pt 调小只会让整片渐变盖住作品）。
           故文字块另加一层**稳定不透明底色**（inverse-surface / inverse-on-surface 对），
           渐变退回它该干的活：把底色与作品图「融」在一起。
           ⚠️ 为什么用 inverse-* 这一对而不是新令牌：本仓已有同款先例（BookmarkButton 自带
           inverse-surface chip，其头注写明「反差与底图解耦，深主题下派生为浅色」），
           且 14 套色板（7 亮 + 7 暗）全部自带该对、对比度最差 10.12（暗色 sky 板；亮色 11.46–11.65 / 暗色 10.12–10.22，按 WCAG 相对亮度对 tokens.css 实算）≥ 4.5 ⇒ **无需改 tokens.css**。 -->
      <view
        class="absolute bottom-0 left-0 right-0 px-6 pt-[24vw] pb-[10vw]"
        style="background: var(--md-scrim-overlay)"
        @tap="currentItem && onSlideTap(currentItem)"
      >
        <view class="bg-inverse-surface rounded-lg px-4 py-3">
          <IllustTypeBadgeRow v-if="currentItem && currentItem.kind === 'illust'" :illust="currentItem.data" />
          <!-- 标签胶囊行（ADR-0118：3+N、translated_name||name、# 前缀、纯展示；位置 = 类型徽章下方、标题上方）；
               长按静音（ADR-0187 D5 / #732）：tag-long-press → muteTag -->
          <TagChipRow v-if="currentItem" :tags="currentItem.data.tags" class="mt-2" @tag-tap="onTagTap" @tag-long-press="onTagLongPress" />
          <text
            v-if="currentItem"
            class="text-title-large font-semibold text-inverse-on-surface [max-line:2]"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="currentItem.data.title"
            >{{ artworkTitle(currentItem.data.title) }}</text
          >
          <!-- [#891] 原 text-white/85：white 是字面量，`/85` **确实**能产出规则，但
               「在不可预测底图上把字调淡」本身就是对比度隐患（作者行实测 2.17 → 1.96）。
               层级改由字号/字重承担（MD3 对 on-surface 的本意）。
               ⚠️ 顺带一条实测结论：inverse 令牌是裸 var()、**无 <alpha-value>**，
               所以 `text-inverse-on-surface/85` 不产出任何规则（死类名、静默无样式）——
               换成 inverse 配对后**只能**用全不透明，别顺手加回 `/85`。
               见 tests/immersiveScrimContrast.test.ts 的防回潮断言。 -->
          <text v-if="currentItem" class="text-body-medium text-inverse-on-surface mt-2">{{ currentItem.data.user.name }}</text>
        </view>
        <view v-if="currentItem && currentItem.kind === 'illust'" class="mt-5">
          <!-- [lynx:fix] :key 每卡重挂载：BookmarkButton 的状态机（useBookmarkMutation）只在 setup
               读一次 props——轮播宿主实例跨 slide 持久时收藏数/收藏态/illustId 全部冻结在首卡
               （收藏数恒 135 + 点 ♥ 收藏到错误作品），key 变化强制重建实例 -->
          <BookmarkButton
            :key="currentItem.key"
            :illust-id="currentItem.data.id"
            :initial-bookmarked="currentItem.data.is_bookmarked"
            :bookmark-count="currentItem.data.total_bookmarks"
          />
        </view>
        <!-- 小说滑页：与插画**同槽位同形**的 ♥（票 #707 / spec docs/specs/app-lynx-recommended-novel-bookmark.md)
             - target-kind="novel"：走小说收藏端点（add=/v2/novel/bookmark/add + restrict=public，delete=/v1/novel/bookmark/delete，
               不对称是既有事实）；同为「快速收藏」通道，**不开**长按面板（ADR-0160 D7：小说标签不在本期）；
               @tap.stop 由组件内部抑制，点 ♥ 不会冒泡到 scrim 的「进介绍页」@tap；
             - :key 取 feed 的**跨 kind 唯一键**（i-/n- 前缀，createMixFeed 的 MixFeedItem.key）而非裸 id：
               插画与小说 id 数值相同时，裸 id 会让 Vue 在两个分支间复用同一个 BookmarkButton 实例
               → init-only props 冻结（ADR-0163 / 44ee6401 同类风险）；
             - 「N 字」保留并退为 ♥ 下方次行（Q4-A / Q8-A 版面决策：收藏数与字数并存）。 -->
        <view v-else-if="currentItem" class="mt-5">
          <BookmarkButton
            :key="currentItem.key"
            target-kind="novel"
            :illust-id="currentItem.data.id"
            :initial-bookmarked="currentItem.data.is_bookmarked"
            :bookmark-count="currentItem.data.total_bookmarks"
          />
          <!-- 字数：缺 text_length 时不渲染（禁止显示「0 字」；缺字段已在 mapNovels 显式 warn，不静默）。
               [#891] 它落在收藏 chip 之下、**不在**上方那块稳定底色里，故自带一层同款底色
               （与本仓 chip 惯用法一致），不自曝于渐变最浅的那一段。 -->
          <view
            v-if="currentItem.data.text_length > 0"
            class="self-start mt-2 px-2 py-0.5 rounded-[var(--md-shape-full)] bg-inverse-surface"
          >
            <text class="text-label-medium text-inverse-on-surface">{{
              t('recommended.charCount', { count: currentItem.data.text_length })
            }}</text>
          </view>
        </view>
      </view>

      <!-- 分页加载失败（fetchMore）内联提示：保留当前滑页，可重试 -->
      <view v-if="pageError" class="absolute bottom-[16vw] left-0 right-0 flex justify-center px-4">
        <text class="text-body-small text-error bg-surface-container-high px-3 py-1 rounded-[var(--md-shape-small)] shadow-[var(--md-elevation-1)]">{{ pageError }}</text>
      </view>

      <!-- hero 覆盖层（ADR-0211 决策 12 · 返回方向）：挂在轮播容器**之外**——
           CarouselSwiper 的 wrapper 按 translateX 平移并裁切子节点，覆盖层放进去会被切掉。
           比例差由覆盖层内 `mode="aspectFill"` 每帧重新等比裁切吸收。 -->
      <image
        v-if="heroTransition.overlay.visible.value"
        class="absolute z-50 overflow-hidden"
        :style="heroTransition.overlay.style.value"
        :src="heroTransition.overlay.src.value"
        :mode="'aspectFill'"
      />
    </view>
  </view>
</template>

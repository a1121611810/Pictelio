<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted, nextTick } from 'vue'
import { currentParams, navigate, goBack, registerBackGuard } from '../router'
import { loadDetail, loadUgoiraMetadata } from '../api/illust'
import { toIllustId } from '../api/id'
import { followUser, unfollowUser } from '../api/user'
import { useAuthStore } from '../stores/authStore'
import type { PixivIllust } from '../api/types'
import { artworkTitle } from '../utils/artworkTitle'
import { proxyImageUrl } from '../utils/imageUrl'
import { resolvePageSrcs } from '../utils/imageQuality'
import { detailImageHeightVw } from '../utils/imageLayout'
import { presentError } from '../utils/errorPresentation'
import { useSettingsStore } from '../stores/settingsStore'
import { useBookmarkMutation } from '../composables/useBookmarkMutation'
import { useImmersiveChrome } from '../composables/useImmersiveChrome'
import { useImmersiveSystemBars } from '../composables/useImmersiveSystemBars'
import { immersiveBackdropClass } from '../utils/immersiveBackdrop'
import BookmarkButton from '../components/BookmarkButton.vue'
import BookmarkPanel from '../components/BookmarkPanel.vue'
import CommentOverlay from '../components/CommentOverlay.vue'
import PagePickerSheet from '../components/PagePickerSheet.vue'
import SkeletonImage from '../components/SkeletonImage.vue'
import PageTopBar from '../components/PageTopBar.vue'
import UgoiraViewer from '../components/UgoiraViewer.vue'
import TagPressChip from '../components/TagPressChip.vue'
import AppIcon from '../components/AppIcon.vue'
import { useSearchSheetStore } from '../stores/searchSheetStore'
import { useWatchLaterStore, toIllustSnapshot } from '../stores/watchLaterStore'
import { buildImageTasks, buildUgoiraTask } from '../utils/galleryDownload'
import { LATER_ICON } from '../utils/watchLaterGlyph'
import { useDownloadStore } from '../stores/downloadStore'
import { useTagNeighborStore } from '../stores/tagNeighbor'
import { ILLUST_DETAIL_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { t } from '../i18n'
import { useMotion } from '../composables/motion'
import {
  HERO_ROOT_ID,
  armHeroBack,
  cacheHeroRect,
  measureHeroDetail,
  takeHeroSource,
  useHeroOverlay,
} from '../composables/heroTransition'

/** 按压反馈载体（ADR-0211 决策 2）：颜色状态层走 transition-colors 工具类——`background-color` 在其 transition-property 覆盖内（已验证）。
 *  时长与曲线一律取自 composables/motion.ts（唯一入口），本组件不写时长/曲线字面量；
 *  R1 降级（prefers-reduced-motion）由 useMotion 统一处理，组件内不自行判断偏好。 */
const { pressColor } = useMotion()

/** 列表项逐项铺开（ADR-0211 决策 5 / issue 879）：多图列表逐页错峰入场，延迟来自预设。
 *  ⚠️ **沉浸态不消费**：沉浸（决策 3）不留任何可见 chrome，图片层是唯一内容——
 *  若在沉浸切换后再叠加入场，会让「点一下看全屏」变成「全屏里图片还在动」，
 *  破坏沉浸契约。故只接多图分支的静态挂载态，延迟亦远小于用户可感知的手动操作间隔。 */
const { listItemStyle } = useMotion()


const settings = useSettingsStore()
const tagNeighbors = useTagNeighborStore()

const illust = ref<PixivIllust | null>(null)
const loading = ref(true)
const errorMsg = ref('')

// 路由参数 id（收藏状态机与详情请求共用；提至最前——bm 在 setup 期即读它取值）
const illustId = computed(() => Number(currentParams.value.id ?? 0))

// ─── 双轨收藏（T5 #534 / spec docs/specs/bookmark-tags.md D3/D8 + ADR-0160）───
// 页面持有**唯一**收藏状态机实例：单击心形 toggle（快速收藏，恒公开、动效不变）与收藏面板
// saveWith（覆盖式保存：完整标签集 + 可见性）共用同一份 bookmarked/count/busy——面板保存后
// 心形即时一致，不引入第二份状态。初始值先占位为未收藏，详情返回后由页面写入服务端真值
// （状态写入归宿主，spec D9 语义）。IllustDetail 不在 KeepAlive 白名单 → 每次进入实例独立。
const bm = useBookmarkMutation({
  illustId: illustId.value,
  initialBookmarked: false,
  initialCount: 0,
})

/** 心形组件 ref：面板保存成功后播收藏动效（与单击收藏同一动效资产） */
const heartRef = ref<{ playBurst?: () => void } | null>(null)
/** 收藏面板开合（T5：长按心形 500ms 打开；关闭 = 宿主 v-if 卸载 → 面板内部 dispose） */
const showBookmarkPanel = ref(false)
/** 打开面板时的收藏态快照：面板打开期间心形不可达（遮罩覆盖）→ 快照即保存前真值。
 * 仅「保存前未收藏」的保存播爆发动效（覆盖式编辑不播），对齐 webview handleBookmarkSaved */
const panelOpenedBookmarked = ref(false)

/** 作品标签建议来源（原形 name，与 webview 面板 workTags 同源；spec D5） */
const workTags = computed(() => illust.value?.tags?.map((tag) => tag.name) ?? [])

/** 标签长按静音（ADR-0187 D5 / #732）：加入词表 + 轻提示（App.vue 宿主消费 muteTagHint） */
function onTagLongPress(name: string): void {
  settings.muteTag(name)
}

function openBookmarkPanel(): void {
  panelOpenedBookmarked.value = bm.bookmarked.value
  // 清掉上一次快速收藏的残留 errorMsg（同一实例的状态）：否则面板 footer 会把旧错误
  // 误报成「保存失败」（面板打开时的错误行只应呈现本次保存的结果）
  bm.errorMsg.value = ''
  // 决策 3：收藏面板是需 chrome 的模态 ⇒ 打开前先退出沉浸（与评论/选页同一复合动作）
  openImmersiveOverlay(() => {
    showBookmarkPanel.value = true
  })
}

/** 面板保存成功（saveWith 已乐观置位 bookmarked=true，失败则不上抛 saved）：关面板 + 补动效 */
function onBookmarkPanelSaved(): void {
  showBookmarkPanel.value = false
  if (panelOpenedBookmarked.value) return
  // 仅「保存前未收藏」的保存播爆发动效（覆盖式编辑不播），对齐 webview handleBookmarkSaved
  if (heartRef.value?.playBurst) {
    heartRef.value.playBurst()
    return
  }
  // 动效通道断（模板 ref 未就绪）→ 显式告警，不静默（测试硬约束 #3 精神）
  console.warn('[IllustDetail] 心形 ref 未就绪，面板保存的收藏动效被跳过')
}

// ─── 评论弹层（issue #164）：入口在收藏操作行；弹层挂根 view 内、scroll-view 之后 ───
const showComments = ref(false)

// ─── 沉浸看图（#887 应用内 chrome / #889 宿主系统栏；ADR-0213 决策 1、2、3、4、5、9）───
// 两层语义各自成模块（useImmersiveChrome 管应用内 chrome、useImmersiveSystemBars 管宿主
// 系统栏，二者生命周期不同故不合流），本页只做「同一次点击同时驱动两层」与
// 「卸载/返回时同时复位两层」的接线。状态形态与所有权 token 见 useImmersiveChrome 头注。
const { chromeHidden, toggleChrome, openOverlay, immersiveA11yLabel, exit } = useImmersiveChrome()
// ── 系统栏联动（#889 / ADR-0213 决策 4、5）──
// 包一层：页面状态机的 enter/exit 是「应用内 chrome」语义，这里补上「宿主系统栏」语义。
// 恢复值回落到用户当前的全屏模式设定（决策 4），不硬编码 false。
const { onImmersiveEnter, onImmersiveExit } = useImmersiveSystemBars()

// ─── 决策 5 的 L2 / L3：卸载与返回两条路径上必须复位**两层**───
// ⚠️ 缺陷来源（#889 验收未达成，code-review F1）：`useImmersiveChrome` 的 `onUnmounted`
// 只复位应用内 chrome 与所有权，**不碰系统栏**；返回守卫也从未接线
// ⇒ 沉浸态按返回离开本页时 `applySystemBars(false)` 从未被调用，离开后系统栏仍隐藏。
// 复位顺序固定：先 exit()（清 chrome + 释放所有权）再 onImmersiveExit()（系统栏回落到
// 用户全屏模式设定；决策 4 禁止硬编码 false）。
/** 幂等复位：仅在持有沉浸时动作。L2 与 L3 共用的唯一出口。 */
function releaseImmersive(): void {
  if (!chromeHidden.value) return
  exit()
  onImmersiveExit()
}

// L2 生命周期兜底：路由 pop、页面被卸载的一切路径。
// 用 onBeforeUnmount 而非 onUnmounted：作用域尚未销毁，且早于 useImmersiveChrome 自己的
// onUnmounted 触发（其 exit() 幂等，两处不冲突、也不重复下发原生调用）。
onBeforeUnmount(releaseImmersive)

// L3 返回路径必经：系统返回（handleSystemBack）与页内返回（requestBack）共用守卫链，
// 守卫在历史栈 pop **之前**裁决 ⇒ 上一页不会渲染出「没有系统栏」的一帧。
// return false = **不拦截**（决策 5 L3 明文要求），只借返回链路的时机复位。
const unregisterBackGuard = registerBackGuard(() => {
  releaseImmersive()
  // 返回方向的连续性转场（ADR-0211 决策 12）：借同一条守卫链的时机**同步置位**返回意图
  // （守卫在历史栈 pop 之前裁决，此刻起点矩形已在手 ⇒ 返回零延迟、零跨线程等待）。
  // ⚠️ 页面被滚动过时**不置位**：存下的矩形是「未滚动时 hero 的位置」，滚动后屏幕上
  //   那张图已经不在那里了 ⇒ 从一个假位置起飞比不做连续性更糟（决策 12 机制 4）。
  if (!scrolled.value) armHeroBack(illustId.value)
  return false
})
onBeforeUnmount(unregisterBackGuard)

/** 切换沉浸：应用内 chrome 走状态机，系统栏走宿主桥，两者必须同时到位 */
function toggleImmersive(): void {
  const entering = !chromeHidden.value
  toggleChrome()
  if (entering) onImmersiveEnter()
  else onImmersiveExit()
}

/** 浮层入口：退出沉浸 ⇒ 系统栏同步恢复（决策 3 + 决策 4） */
function openImmersiveOverlay(open: () => void): void {
  openOverlay(() => {
    onImmersiveExit()
    open()
  })
}

/** 浮层入口统一形态（决策 3）：评论 / 选页 / 收藏面板都是需要 chrome 的模态，
 *  沉浸态下打开会得到「一个没有关闭按钮的模态」⇒ 统一先退出沉浸再打开。
 *  刻意不在浮层组件里反向感知沉浸（避免反向依赖）。 */
function openComments(): void {
  openImmersiveOverlay(() => {
    showComments.value = true
  })
}

// ─── 关注作者（P0-T3） ───
const following = ref(false)
const followBusy = ref(false)
const followError = ref('') // 独立于 errorMsg——避免关注失败击穿已加载的详情页

const isSelfAuthor = computed(() => useAuthStore().currentUser?.id === illust.value?.user.id)

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
    followError.value = t('illustDetail.actionFailed') // i18n: 赋值时快照（瞬态）
  } finally {
    followBusy.value = false
  }
}

// ─── 保存到相册（spec docs/specs/image-save-download.md）：入口在收藏操作行；───
// ─── 单页直存；多页开选页面板；ugoira 不提供。状态内联在操作行下方（lynx 无全局 toast）───
const showPicker = ref(false)
const saveStatus = ref('')
const queuedNotice = ref(false)
let saveStatusTimer: ReturnType<typeof setTimeout> | undefined
const dl = useDownloadStore()

/**
 * 保存入口改为入队（spec docs/specs/download-manager.md §8）：构造任务交给 downloadStore
 * （下载页统一开始/暂停/停止/删除）。返回入队条数（0 = 无可用原图）。
 */
function enqueuePages(selectedPages: number[]): number {
  const i = illust.value
  if (!i || i.type === 'ugoira' || !selectedPages.length) return 0
  // 作者目录开关 + 命名模板入队时刻读值（ADR-0192 D7：dir/模板入队即快照，事后改设置不影响已入队任务）
  const drafts = buildImageTasks(i, selectedPages, {
    authorDir: settings.downloadByAuthorDir,
    template: settings.downloadFileTemplate,
  })
  if (drafts.length === 0) {
    saveStatus.value = t('illustDetail.save.noOriginal') // i18n: 赋值时快照（瞬态）
    queuedNotice.value = false
    return 0
  }
  dl.enqueue(drafts)
  saveStatus.value = t('illustDetail.save.queued', { count: drafts.length }) // i18n: 赋值时快照（瞬态）
  queuedNotice.value = true
  clearTimeout(saveStatusTimer)
  saveStatusTimer = setTimeout(() => {
    saveStatus.value = ''
    queuedNotice.value = false
  }, 4000)
  return drafts.length
}

/** ugoira 入队：先取元数据（官方 ZIP URL），再按全局格式（T13）入队（spec §5/§8）。 */
async function enqueueUgoira() {
  const i = illust.value
  if (!i || i.type !== 'ugoira') return
  try {
    const meta = await loadUgoiraMetadata(i.id)
    // 作者目录开关 + 命名模板入队时刻读值（同 enqueuePages：dir/模板入队即快照）
    const draft = buildUgoiraTask(i, meta.zip_urls.medium, settings.ugoiraDownloadFormat, meta.frames, {
      authorDir: settings.downloadByAuthorDir,
      template: settings.downloadFileTemplate,
    })
    dl.enqueue([draft])
    saveStatus.value = t('illustDetail.save.queued', { count: 1 }) // i18n: 赋值时快照（瞬态）
    queuedNotice.value = true
    clearTimeout(saveStatusTimer)
    saveStatusTimer = setTimeout(() => {
      saveStatus.value = ''
      queuedNotice.value = false
    }, 4000)
  } catch (e) {
    console.warn('[IllustDetail] ugoira 元数据获取失败', e)
    saveStatus.value = t('illustDetail.save.ugoiraInfoFailed') // i18n: 赋值时快照（瞬态）
    queuedNotice.value = false
  }
}

function onSaveEntry() {
  const i = illust.value
  if (!i) return
  if (i.type === 'ugoira') {
    void enqueueUgoira()
    return
  }
  if (i.page_count > 1) {
    // 决策 3：选页面板是需 chrome 的模态 ⇒ 打开前先退出沉浸（ugoira/单图直存不开浮层，不退出）
    openImmersiveOverlay(() => {
      showPicker.value = true
    })
    return
  }
  enqueuePages([0])
}

// ─── 稍后看（WatchLater，ADR-0191 D5 / #751 T3）：动作区 toggle ───
// 时钟字形 = utils/watchLaterGlyph 单一事实源（VS15 依据见该模块头注释）
const watchLater = useWatchLaterStore()
/** 已加入态：高亮跟随 store.has()（按 (kind, id) 去重；读路由 id，路由复用换 id 即时重算） */
const laterAdded = computed(() => watchLater.has('illust', illustId.value))

/** toggle 稍后看：快照从页面已有 illust 构造（零新增请求，spec D2） */
function toggleWatchLater(): void {
  const i = illust.value
  if (!i) return
  watchLater.toggle(toIllustSnapshot(i))
}

function onConfirmPicker(selectedPages: number[]) {
  showPicker.value = false
  enqueuePages(selectedPages)
}

// 多页作品：meta_pages 或单页
// [fix] 单页作品直接返回完整 image_urls（medium/large 正常档位）——
// 此前把 original_image_url 塞进 large 导致 medium 档 fallback 到原图
// （下载体积大 + 易超时，模拟器实测 img-original timeout）。original 档
// 由 resolvePageSrcs 的 singleOriginalUrl 参数单独兜底（单页场景）。
const pages = computed(() => {
  if (!illust.value) return []
  if (illust.value.meta_pages?.length) {
    return illust.value.meta_pages.map((p) => p.image_urls)
  }
  return [illust.value.image_urls]
})

// [spec] 详情比例显示：容器高度按原图宽高比换算的显式 vw（不封顶）；
// 容器 / ugoira 占位 / 图片骨架三处共用同一高度，避免重复计算。
// 多图列表（ADR-0129）：该高度仅作**占位**（首图比例），各图 @load 后按自身比例修正（CoverImage correctHeightOnLoad）。
const detailImageHeight = computed(() =>
  detailImageHeightVw(illust.value?.width, illust.value?.height),
)

// ─── 多图列表（ADR-0129 / spec §3 数据流）：逐页按档位解析 + 代理 ───
// 替换旧「详情翻页」的 currentImage（单页）语义：整体解析为数组，页面 v-for 渲染；
// 单图作品（meta_pages 空）走 [illust.image_urls] 单元素（现状语义不变）。
// 解析组合下移为纯函数 resolvePageSrcs（深模块可测，oracle = resolveQualityUrl + proxyImageUrl 各自语义）。
const slideSrcs = computed(() =>
  resolvePageSrcs(pages.value, settings.detailQuality, illust.value?.meta_single_page?.original_image_url),
)

// ─── 缩略图 → 大图连续性转场 · 前进方向（ADR-0211 决策 12）───
// 机制与时序全在 composables/heroTransition.ts（唯一实现处），本页只做三件事：
// 给 hero 盒一个稳定 id、把列表侧点图时发起的测量消费掉、渲染覆盖层。
// ⚠️ 本页**不持**在途矩形：`takeHeroSource` 一次性消费，别的页也拿不到（跨页共享走模块层）。
const heroTransition = useHeroOverlay()

/** hero 盒（首屏那张大图的外层容器）的稳定 id：前进终点 + 返回起点都测它。 */
const HERO_BOX_ID = 'pictelio-hero-box'

/** 本页是否已被用户滚动：返回方向的连续性只在「那张图还在原处」时成立。 */
const scrolled = ref(false)
/** scroll-view 的滚动信号（原生 Lynx 与 web-core 都走 detail.scrollTop，缺失按 0 处理） */
function onScroll(e: { detail?: { scrollTop?: number } }): void {
  scrolled.value = Number(e?.detail?.scrollTop ?? 0) > 1
}

/**
 * 前进方向起手。
 *
 * 两个测量**并发**发起：列表侧那个在 `@tap` 时就已在途（跨线程异步，导航不等它），
 * 本页的「页面根 + hero 盒」在数据落定后测。两者都拿不到即降级为普通转场
 * （heroTransition 内部逐条落日志，禁静默降级）。
 */
async function playHeroForward(): Promise<void> {
  const id = illustId.value
  // 路由 id 与实际落地的作品不一致（守卫重定向 / 参数竞态）⇒ 不播，避免把 A 的图接到 B 上
  if (!illust.value || illust.value.id !== id) return
  // ugoira 是动图：覆盖层是静态 <image>，与详情里的播放器不是同一个元素 ⇒ 不假装连续
  if (illust.value.type === 'ugoira') {
    console.debug('[heroTransition] 降级为普通路由转场：ugoira（详情侧是动图播放器，非静态图）')
    return
  }
  const src = slideSrcs.value[0]
  if (!src) return
  // 容器要在本轮渲染后才量得到真实盒（detailImageHeight 由数据算出）
  await nextTick()
  const sourcePromise = takeHeroSource(id)
  const detail = await measureHeroDetail(HERO_BOX_ID)
  if (detail === null) return
  // 存下 hero 盒（返回方向的插值起点）：本页活着时测一次就够，返回时**不再测量**
  // （真机实测：返回那一刻发起的测量不会在导航后及时落定——本页正在被销毁）。
  // 前进即使降级也要存：返回方向的连续性与前进是否播无关。
  cacheHeroRect(id, detail.hero)
  const from = await sourcePromise
  if (from === null) return
  heroTransition.play({ from, to: detail.hero, root: detail.root, src })
}

function openAuthor() {
  if (!illust.value) return
  void navigate(`/user/${illust.value.user.id}`)
}

// 标签近邻入口（ADR-0197 D14 / #767 T2）：动作行第 5 项。
// 先把**全量 tags** 写入共享 store 再跳转——注意不能用模板里 `illust.tags.slice(0, 8)`
// 渲染用的截断数组：近邻相似度需要全部标签（实测作者列表每条自带 tags，无需逐图再查）。
// 塞 store 而非路由参数传递：作品对象体积大，跨组件共享数据走全局缓存（AGENTS.md 数据层分流）。
function openTagNeighbors() {
  if (!illust.value) return
  tagNeighbors.setSourceIllust(illust.value)
  void navigate(`/illust/${illust.value.id}/tag-neighbors`)
}

onMounted(async () => {
  try {
    const res = await loadDetail(toIllustId(illustId.value))
    illust.value = res.illust
    // P0-T3：同步作者关注状态（详情 API 可能不返回 is_followed，缺省 false）
    following.value = !!res.illust.user.is_followed
    // T5：把服务端收藏真值写入页面持有的状态机（面板打开前的状态快照依据）
    if (res.illust.total_bookmarks === undefined) {
      // 字段契约恒在（PixivIllust.total_bookmarks: number）——缺失即契约破坏，显式告警不静默
      console.warn('[IllustDetail] total_bookmarks 缺失（契约破坏），收藏数按 0 展示')
    }
    bm.bookmarked.value = !!res.illust.is_bookmarked
    bm.count.value = Math.max(0, res.illust.total_bookmarks ?? 0)
    // 前进方向的连续性转场（决策 12）：数据落定 = hero 盒已有确定尺寸，可以起手了。
    // 不 await：本页渲染不因它阻塞（先渲染后加载），失败一律降级为普通转场。
    void playHeroForward()
  } catch (err) {
    errorMsg.value = presentError(err, t('error.fallback.loadFailed'))
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <!-- [lynx:fix] 顶栏 tap 修复（issue #139）：外层显式 flex flex-col，scroll-view flex-1 min-h-0 约束在顶栏下方，
       避免 w-full h-full 溢出覆盖顶栏触摸层（与 issue #129 同型） -->
  <!-- relative：为根 view 内 absolute 的评论弹层提供定位上下文（不改 flex 布局） -->
  <!-- 沉浸态底色切影院黑（#896）：方形作品按原比例只有 100vw 高，必然短于竖屏视口。
       非沉浸态保持 bg-surface 原样（不改既有阅读排版）。 -->
  <view
    class="w-full h-full flex flex-col relative"
    :id="HERO_ROOT_ID"
    :class="immersiveBackdropClass(chromeHidden)"
  >
    <!-- M3 TopAppBar：次级页，返回 + 标题（PageTopBar 变体 b，ADR-0194）
         沉浸态隐藏（决策 3：沉浸**不留任何可见 chrome**；页内返回入口消失，退出路径为
         系统返回键 + 图片再次单击，屏幕阅读器退出路径见图片容器的动态 a11y 标签） -->
    <PageTopBar v-if="!chromeHidden" back :title="t('illustDetail.title')" @back="goBack" />

    <!-- [lynx:fix] 骨架屏：加载中显示 shimmer 占位（图片区 1:1 + 文字条），数据就绪后切换 scroll-view -->
    <view v-if="loading" class="w-full flex-1 min-h-0 bg-surface">
      <view class="shimmer aspect-[1/1] w-full" />
      <view class="p-4">
        <view class="shimmer h-[32rpx] rounded-[var(--md-shape-extra-small)] w-[75%]" />
        <view class="shimmer h-[24rpx] rounded-[var(--md-shape-extra-small)] mt-2 w-[40%]" />
        <view class="shimmer h-[24rpx] rounded-[var(--md-shape-extra-small)] mt-1.5 w-[60%]" />
      </view>
    </view>
    <view v-else-if="errorMsg" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <text class="text-body-medium text-error p-4">{{ errorMsg }}</text>
    </view>
    <scroll-view
      v-else-if="illust"
      class="w-full flex-1 min-h-0"
      scroll-orientation="vertical"
      @scroll="onScroll"
    >
      <!-- [spec] 详情大图：按原图宽高比撑开高度（显式 vw，不封顶，与 webview client 一致），
           原生 LynxView 不支持动态 aspect-ratio style（ADR-0055 §2），显式高度已验证（issue #138）。
           图片级骨架屏（SkeletonImage）：@load 前 shimmer、@error 显示「图片加载失败」。
           ADR-0129 多图列表：多页作品改**通栏连续大图列表**（全量渲染 + 首图 eager/其余 lazy-load），
           每图宽度盛满、高度按自身比例（占位=首图比例 detailImageHeight，@load 后 CoverImage correctHeightOnLoad 修正），
           右上角「n / N」页角标（对齐 webview LazyDetailImage）；单页/ugoira 分支保持现状。 -->
      <!-- ugoira 动图：播放器分支（多图列表不适用，page_count=1 语义保持）
           @tap = 沉浸切换（决策 2：绑**容器**而非图片元素——容器可覆盖「图未加载完成时点
           空位」，且 UgoiraViewer 自身零手势，不会与本绑定抢事件） -->
      <view
        v-if="illust.type === 'ugoira'"
        class="relative w-full bg-surface-container-highest overflow-hidden"
        :id="HERO_BOX_ID"
        :style="{ height: detailImageHeight }"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="immersiveA11yLabel()"
        @tap="toggleImmersive"
      >
        <UgoiraViewer :illust-id="illust.id" :height-vw="detailImageHeight" />
      </view>
      <!-- 多图列表：每页一张，通栏连续大图（页间留间距）。
           外层**不定高**（占位高度由 SkeletonImage 的 height prop 承担；correctHeightOnLoad 修正的是内层
           CoverImage 容器高度——外层定高会裁掉修正后更高的图）；外层仅作 relative 定位上下文（角标）。 -->
      <template v-else-if="slideSrcs.length > 1">
        <!-- 列表项逐项铺开（ADR-0211 决策 5 / issue 879）：多图列表逐页错峰入场，延迟来自预设。
             ⚠️ 本页图片数上限由上游 page_count 决定（可达数十上百）⇒ STAGGER_MAX_ITEMS
             上限在此页最关键：超过上限的页直接落终态，不出现「作品图越多、最后一页出现越晚」。
             ⚠️ 只接多图分支：单图/ugoira 分支只有一项，错峰无从谈起（index 恒 0）。 -->
        <view
          v-for="(src, i) in slideSrcs"
          :key="i"
          class="relative w-full bg-surface-container-highest overflow-hidden mb-2"
          :id="i === 0 ? HERO_BOX_ID : undefined"
          :style="listItemStyle(i)"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="immersiveA11yLabel({ n: i + 1, total: slideSrcs.length })"
          @tap="toggleImmersive"
        >
          <SkeletonImage :src="src" :height="detailImageHeight" :lazy-load="i > 0" correct-height-on-load />
          <!-- 「n / N」页角标：absolute 悬浮右上角。
               [定位锚点约定（ADR-0123）] 原生 LynxView 把最近 view 祖先当 absolute 锚点，非全屏父盒内
               禁止 right/bottom（按父盒边缘解析→跑出屏幕）。故角标用「left:0 + w-full + flex 右对齐」：
               只依赖 left/top 正向解析，右侧位置由 flex 布局得出，规避 right/bottom 的锚点语义。
               决策 2/3：角标是图片层的**子节点**、图片层本身不隐藏 ⇒ 隐藏角标**不能**靠父级
               class 级联，必须**独立条件渲染**（v-if）；另补 @tap.stop 阻断冒泡，否则点角标会
               冒泡到图片层误触发沉浸切换（沿用本页 toggleWatchLater / openTagNeighbors 同款范式）。 -->
          <view
            v-if="!chromeHidden"
            class="absolute top-2 left-0 w-full flex flex-row justify-end pr-2"
            @tap.stop
          >
            <view
              class="px-2 h-[6.4vw] min-w-[9.6vw] rounded-[var(--md-shape-small)] bg-scrim flex items-center justify-center"
            >
              <text class="text-label-medium text-white">{{ i + 1 }} / {{ slideSrcs.length }}</text>
            </view>
          </view>
        </view>
      </template>
      <!-- 单图作品：现状语义（无角标、无 correctHeightOnLoad、不带 lazy-load） -->
      <view
        v-else
        class="relative w-full bg-surface-container-highest overflow-hidden"
        :id="HERO_BOX_ID"
        :style="{ height: detailImageHeight }"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="immersiveA11yLabel()"
        @tap="toggleImmersive"
      >
        <SkeletonImage v-if="slideSrcs[0]" :src="slideSrcs[0]" :height="detailImageHeight" />
      </view>
      <!-- 操作 / 信息行（决策 3 chrome 边界之一）：沉浸态整体隐藏。
           ⚠️ 与图片层是**兄弟**关系 ⇒ 图片层的 @tap 不会吞掉这里 8 个既有处理器
           （头像/关注/保存/评论/稍后看/标签近邻/查看下载/标签搜索），不冒泡不冲突。 -->
      <view v-if="!chromeHidden" class="p-4 bg-surface-container-lowest">
        <!-- T07 档位清理：原为 700 字重。作品标题是内容文本，headline-small 官方
             regular(400)、emphasized 500；此前它比顶部 PageTopBar 屏标题（title-large + 500）
             更重，层级倒置 → 500。 -->
        <text class="text-headline-small font-regular text-surface-on">{{ artworkTitle(illust.title) }}</text>
        <view class="flex flex-row items-center mt-2">
          <!-- 作者行命中区只含头像 + 名字（#542）：整行可点会让心形附近的坐标偏移
               静默跳转作者页（自动化假绿路径）；收窄后偏移落空处 = 响亮失败 -->
          <view
            class="flex flex-row items-center flex-1 min-w-0"
            data-testid="illust-detail-author"
            @tap="openAuthor"
          >
            <SkeletonImage
              v-if="illust.user.profile_image_urls"
              :src="proxyImageUrl(illust.user.profile_image_urls.medium || illust.user.profile_image_urls.px_170x170 || '')"
              aspect-ratio="1 / 1"
              min-h="9vw"
              class="w-[10.667vw] h-[10.667vw] rounded-full"
            />
            <text class="text-body-medium text-surface-on-variant ml-2 flex-1">by {{ illust.user.name }}</text>
          </view>
          <!-- P0-T3：关注作者（非本人时显示） -->
          <view
            v-if="!isSelfAuthor"
            class="px-4 h-[10.667vw] flex items-center justify-center rounded-[var(--md-shape-full)]"
            :class="[pressColor.className, following ? 'border border-outline bg-transparent active:bg-layer-pressed-primary' : 'bg-primary active:bg-layer-pressed-on-primary']"
            @tap="toggleFollowAuthor"
          >
            <text class="text-body-medium" :class="following ? 'text-primary' : 'text-primary-on'">
              {{ following ? t('illustDetail.follow.following') : t('illustDetail.follow.follow') }}
            </text>
          </view>
        </view>
        <text v-if="followError" class="text-label-medium text-error mt-1">{{ followError }}</text>
        <text class="text-body-small text-outline mt-1.5">{{ illust.width }} × {{ illust.height }}</text>
        <!-- 动作行：flex-wrap 是必需项，不是装饰。行内 5 项（心形+收藏数 / 保存 / 评论 / 稍后看 /
             标签近邻）在 360dp 宽机型上单行放不下；不加 wrap 时 flex 子项被压缩，**中文标签与
             收藏数一起折行**（「标签近邻」→「标签近/邻」、「349」→「34/9」），真机走查实证。
             wrap 后各项整体落到下一行，不压缩、不截断。 -->
        <view class="mt-2 flex flex-row items-center flex-wrap">
          <!-- 双轨收藏（T5 #534）：单击 = 快速收藏（toggle，恒公开、动效不变）；
               长按 500ms = 打开收藏面板（enable-long-press + @long-press）。
               mutation 注入 = 面板 saveWith 与本心形共用同一状态机实例 -->
          <!-- 宿主行是 row flex + items-center（兄弟 ↓保存 更矮）；BookmarkButton 自带 self-start
               （为 column 宿主 hug content，见 docs/specs/bookmark-color.md），行内需显式覆盖回居中。
               self-center 在产物中位于 self-start 之后（同级声明后者胜），不靠 !important。 -->
          <BookmarkButton
            ref="heartRef"
            class="self-center"
            :illust-id="illust.id"
            :initial-bookmarked="illust.is_bookmarked"
            :bookmark-count="illust.total_bookmarks"
            :mutation="bm"
            enable-long-press
            @long-press="openBookmarkPanel"
          />
          <!-- 保存（spec download-manager §8）：↓ → Material Symbols file_download（ADR-0208 决策 3）。
               连带收益：原 U+2193 纯文本符号是为规避 Lynx 原生 emoji 化而选的替代（ADR-0112 教训），
               子集字体 glyph 不走 emoji 呈现路径，该 workaround 的必要性随之消失。
               静态图直接入队，ugoira 取元数据后按全局格式入队。
               语义由同行 label 文案 + 「保存」动作本身承担，图标不重复标注。 -->
          <view class="ml-4 flex flex-row items-center" @tap="onSaveEntry">
            <AppIcon name="file_download" :size="5.6" class="text-outline" />
            <text class="text-label-medium text-outline ml-1">{{ t('illustDetail.save.action') }}</text>
          </view>
          <!-- 评论入口（issue #164）：💬 → Material Symbols chat_bubble（ADR-0208 决策 3），
               同样消除 emoji 呈现路径依赖；字段缺失时不显示 -->
          <view
            v-if="illust.total_comments !== undefined"
            class="ml-4 flex flex-row items-center"
            @tap="openComments"
          >
            <AppIcon name="chat_bubble" :size="6.4" />
            <text class="text-label-medium text-outline ml-1">{{ illust.total_comments }}</text>
          </view>
          <!-- 稍后看（WatchLater，ADR-0191 D5）：toggle + 已加入态高亮（text-tertiary，
               沿用动作行激活态范式）；@tap.stop 防冒泡误触（TagPressChip 同款）；
               快照从已有 illust 构造（零新增请求）。
               T12/ADR-0208 决策 3：`LATER_ICON` 是**图标名**（IconName），不是字形——
               必须经 <AppIcon> 查 iconMap 取码点。裸 `<text>{{ LATER_ICON }}</text>` 会
               把字符串 "schedule" 当正文渲染出来（vue-tsc 抓不到：IconName ⊂ string），
               属禁静默降级形态。尺寸仍为缺省 6.4vw（= 原 text-[6.4vw]，视觉不变）。 -->
          <view class="ml-4 flex flex-row items-center" @tap.stop="toggleWatchLater">
            <AppIcon :name="LATER_ICON" :class="laterAdded ? 'text-tertiary' : 'text-outline'" />
            <text class="text-label-medium ml-1" :class="laterAdded ? 'text-tertiary' : 'text-outline'">{{ laterAdded ? t('later.action.added') : t('later.action.add') }}</text>
          </view>
          <!-- 标签近邻（ADR-0197 D14 / #767 T2）：作品级入口，作用于当前作品而非某一页
               （标签是作品级的，多图作品不引入「当前页」概念）。动作行第 5 项。
               先把源作品塞进共享 store 再跳转，结果页据此免去重复拉取详情；
               ◇ → Material Symbols notifications（ADR-0208 决策 3；原注释「沿用 ↓ 的 ADR-0112
               教训」针对的是 emoji 呈现路径，子集字体 glyph 不经该路径）。
               无障碍名称仍在 tap 目标上：:accessibility-label="ILLUST_DETAIL_A11Y_LABELS.tagNeighborsEntry"，
               图标不重复标注（ADR-0208 决策 4）。 -->
          <view
            class="ml-4 flex flex-row items-center"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="ILLUST_DETAIL_A11Y_LABELS.tagNeighborsEntry"
            @tap.stop="openTagNeighbors"
          >
            <AppIcon name="notifications" :size="5.6" class="text-outline" />
            <text class="text-label-medium text-outline ml-1">{{ t('tagNeighbors.entry') }}</text>
          </view>
        </view>
        <!-- 保存状态（内联，无全局 toast 通道）：入队后附「查看下载」跳转 -->
        <view v-if="saveStatus" class="flex flex-row items-center mt-1">
          <text class="text-label-medium text-primary">{{ saveStatus }}</text>
          <view
            v-if="queuedNotice"
            class="ml-3 h-[8vw] px-3 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)]"
            @tap="navigate('/downloads')"
          >
            <text class="text-label-medium text-primary">{{ t('illustDetail.save.viewDownloads') }}</text>
          </view>
        </view>
        <view class="flex flex-row flex-wrap mt-3">
          <!-- 标签行（ADR-0133 可点化）：点击 → 全局搜索弹层预填该标签（原始 tag.name，
               显示仍 translated_name 优先）——与 webview SearchableTag 语义一致。
               长按静音（ADR-0187 D5 / #732）：TagPressChip 手势绑 view 层（原生 text 节点
               不收手势），长按 500ms → muteTag + 轻提示（App.vue 宿主渲染 muteTagHint），
               吞 tap 守卫保证长按后不触发搜索。
               [居中修复] 布局（固定高/flex 居中/边框/圆角）由 chip 容器 view 承载——lynx 的
               text 是纯文本节点，flex 对 text 无效（此前 items-center 不生效导致文案偏上，
               实测放大切片确认）；text 内层不得加 leading-none——lynx text 的
               line-height:1 会把字形顶到行框顶（flex 居中行框而非字形，反而更偏上，
               实测对比确认），默认行高 + view items-center 即对称居中。 -->
          <TagPressChip
            v-for="tag in illust.tags.slice(0, 8)"
            :key="tag.name"
            :text="'#' + (tag.translated_name || tag.name)"
            chip-class="h-[8.533vw] px-2 m-1 border border-outline rounded-[var(--md-shape-small)] flex items-center justify-center bg-surface"
            text-class="text-label-large text-surface-on-variant"
            @tap="useSearchSheetStore().openSearch(tag.name)"
            @long-press="onTagLongPress(tag.name)"
          />
        </view>
      </view>
    </scroll-view>

    <!-- 评论弹层（issue #164）：absolute 脱离 flex 流全屏覆盖；DOM 顺序在 scroll-view 之后
         且不动其结构（issue #139/#129 修复保持）。覆盖层形态 → 弹层打开时页面滚动位置不丢失 -->
    <view v-if="showComments" class="absolute inset-0">
      <CommentOverlay type="illust" :target-id="illustId" @close="showComments = false" />
    </view>

    <!-- 选页面板（spec image-save-download）：挂载契约对齐评论弹层——absolute inset-0 宿主包裹
         （issue #139：本页根是 flex-col + flex-1 scroll-view，文档流内 w-full h-full 子元素有溢出
         覆盖顶栏触摸层前科，必须脱离文档流） -->
    <view v-if="showPicker" class="absolute inset-0">
      <PagePickerSheet
        :page-urls="slideSrcs"
        :busy="false"
        @close="showPicker = false"
        @confirm="onConfirmPicker"
      />
    </view>

    <!-- 收藏面板（T5 #534 / spec docs/specs/bookmark-tags.md D8）：挂**页面层**（非 list-item），
         DOM 顺序靠后覆盖内容区；v-if 条件渲染 = 关闭态不渲染（ADR-0123 全屏层规则）。
         saveWith 直取页面状态机（覆盖式保存 + 乐观置位 + 失败回滚），保存成功上抛 saved。
         系统返回键关面板由面板内部 modalStack 注册承担（与 CommentOverlay 同机制）。 -->
    <view v-if="showBookmarkPanel" class="absolute inset-0">
      <BookmarkPanel
        :illust-id="illustId"
        :work-tags="workTags"
        :save-with="bm.saveWith"
        :save-error="bm.errorMsg.value"
        :saving="bm.busy.value"
        @close="showBookmarkPanel = false"
        @saved="onBookmarkPanelSaved"
      />
    </view>

    <!-- hero 覆盖层（ADR-0211 决策 12 · 前进方向）：从被点的那张缩略图盒插值到本页 hero 盒。
         · 几何/时序全在 composables/heroTransition.ts，本处只绑三个出口；
         · `mode="aspectFill"` 是**比例差的吸收器**：缩略图盒与 hero 盒宽高比不同，
           盒内图每帧按新盒比例重新等比裁切（Lynx 以 mode 替代 CSS object-fit，CoverImage 同款），
           不做非等比 transform scale ⇒ 不变形；
         · z-50 压在弹层之上：转场期间它就是「当前那张图」，不能被评论/选页盖住；
         · v-if 撤下：动画播完（计时器与过渡同源）后覆盖层卸载，露出下方原生大图，
           两者同 URL ⇒ 撤下瞬间无可见跳变。 -->
    <image
      v-if="heroTransition.visible.value"
      class="absolute z-50 overflow-hidden"
      :style="heroTransition.style.value"
      :src="heroTransition.src.value"
      :mode="'aspectFill'"
    />
  </view>
</template>

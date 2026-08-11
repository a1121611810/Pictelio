<script setup lang="ts">
// 插画分类页（/illusts）：推荐/关注两个子 tab，waterfall 双列插画卡。
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'illusts' })
import { ref, onMounted } from 'vue'
import { navigate } from '../router'
import { loadRecommended, loadFollow, loadNext } from '../api/illust'
import type { PixivIllust } from '../api/types'
import { thumbUrl } from '../utils/imageUrl'
import { presentError } from '../utils/errorPresentation'
import { withTimeout } from '../utils/withTimeout'
import { isRestricted } from '../stores/settingsStore'
import SkeletonCard from '../components/SkeletonCard.vue'
import SkeletonImage from '../components/SkeletonImage.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import RestrictOverlay from '../components/RestrictOverlay.vue'
import NavigationBar from '../components/NavigationBar.vue'
import { NAV_TABS, type NavTab } from '../components/navTabs'

function onNavSelect(tab: NavTab) {
  if (tab.name === 'illusts') return
  void navigate(tab.path, { replace: true })
}

const illusts = ref<PixivIllust[]>([])
const nextUrl = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')
// 推荐/关注切换：推荐 = /v1/illust/recommended，关注 = /v2/illust/follow
const mode = ref<'recommend' | 'follow'>('recommend')
// 竞态防护：mode 切换后旧请求响应丢弃（generation gate）
let modeGen = 0
// [lynx:fix] loadMore 双重防抖（与 Recommended 同款，ADR-0045）：
// 1) 时间节流 800ms：防 scrolltolower 高频触发
// 2) 加载完成冷却 3s：防 web-core 的 list 在内容追加/首屏初始化后延迟误触发 scrolltolower（进入时自动多加载）
let lastLoadMoreAt = 0
let lastLoadEndedAt = 0

// [lynx:fix] 数据分批渲染（ADR-0060）：
// web-core 预览下 list 不做 item 回收，一次性渲染 90 条 = 90 张图全量加载（图片加载风暴）。
// 解决：fetch 一次拿回全部数据，但只把前 PAGE_SIZE 条塞进 list（其余入 pendingIllusts 队列），
// 滚动到底时先消费 pending（同步追加，无网络请求），pending 耗尽才真正请求 next_url。
// 真机 LynxView 有引擎级 item 回收 + lazy-load，此机制无副作用（只影响 DOM 挂载数量）。
const PAGE_SIZE = 20
const pendingIllusts = ref<PixivIllust[]>([])

async function fetchFirstPage() {
  const gen = ++modeGen
  loading.value = true
  errorMsg.value = ''
  try {
    const req = mode.value === 'recommend' ? loadRecommended() : loadFollow()
    // 请求挂起 15s 兜底（issue #128）：超时 reject 走下方 catch 展示 errorMsg，避免骨架屏无限显示
    const res = await withTimeout(req, 15000)
    if (gen !== modeGen) return // 已切 tab，丢弃旧响应
    // issue #91：全量渲染，受限条目盖遮罩（不再过滤）
    const all = res.illusts
    illusts.value = all.slice(0, PAGE_SIZE)
    pendingIllusts.value = all.slice(PAGE_SIZE)
    nextUrl.value = res.next_url
  } catch (err) {
    if (gen !== modeGen) return
    errorMsg.value = presentError(err, '加载失败')
  } finally {
    if (gen === modeGen) {
      loading.value = false
      // [lynx:fix] 第一页加载完成同样进入冷却，防 web-core 延迟误触发 scrolltolower
      lastLoadEndedAt = Date.now()
    }
  }
}

function switchMode(m: 'recommend' | 'follow') {
  if (mode.value === m) return
  mode.value = m
  illusts.value = []
  pendingIllusts.value = []
  nextUrl.value = null
  // 重置分页节流（新 tab 立即支持 loadMore）
  lastLoadMoreAt = 0
  lastLoadEndedAt = 0
  void fetchFirstPage()
}

async function loadMore() {
  const now = Date.now()
  if (now - lastLoadEndedAt < 3000) return
  if (now - lastLoadMoreAt < 800) return
  if (loadingMore.value) return
  // pending 队列为空且无 next_url 时终止
  if (pendingIllusts.value.length === 0 && !nextUrl.value) return
  lastLoadMoreAt = now
  loadingMore.value = true
  try {
    // 优先消费本地 pending 数据（同步，无网络请求），pending 耗尽才翻页
    if (pendingIllusts.value.length > 0) {
      illusts.value.push(...pendingIllusts.value.splice(0, PAGE_SIZE))
      return
    }
    // 翻页请求同样加 15s 超时兜底（issue #128）
    const res = await withTimeout(loadNext(nextUrl.value!), 15000)
    const seen = new Set(illusts.value.map((i) => i.id))
    const fresh = res.illusts.filter((i) => !seen.has(i.id))
    illusts.value.push(...fresh.slice(0, PAGE_SIZE))
    pendingIllusts.value = fresh.slice(PAGE_SIZE)
    // 空页防护：基于服务端原始返回判空（issue #91：不再用过滤后长度）
    nextUrl.value = res.illusts.length === 0 ? null : res.next_url
  } catch (err) {
    errorMsg.value = presentError(err, '加载更多失败')
  } finally {
    loadingMore.value = false
    lastLoadEndedAt = Date.now()
  }
}

function openDetail(id: number) {
  void navigate(`/illust/${id}`)
}

// 图片区点击（spec：列表交互）：受限条目（R18/R18G 且开关关闭）不跳详情，其余进详情。
// 外层 .stop 继续保证遮罩点击不穿透；RestrictOverlay 自身 @tap="swallow" 双保险。
function onImageTap(item: PixivIllust) {
  if (!isRestricted(item)) openDetail(item.id)
}

onMounted(fetchFirstPage)
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：顶层页，居中标题，无返回箭头 -->
    <view class="flex flex-row items-center justify-center h-[17.067vw] px-4 bg-surface">
      <text class="text-title-large font-medium text-surface-on">插画</text>
    </view>

    <!-- 推荐/关注切换（M3 secondary tabs）：容器 border-b 分割线 + surface-container-lowest 底，
         选中态 = text-primary + 底部 0.8vw primary 指示条（Bookmarks 页已验证的可靠写法） -->
    <view class="flex flex-row border-b-[1px] border-b-outline-variant bg-surface-container-lowest">
      <view
        class="flex-1 h-[12.8vw] flex items-center justify-center"
        :class="mode === 'recommend' ? 'text-primary border-b-[0.8vw] border-b-primary' : 'text-outline'"
        @tap="switchMode('recommend')"
      >
        <text class="text-title-small font-medium">推荐</text>
      </view>
      <view
        class="flex-1 h-[12.8vw] flex items-center justify-center"
        :class="mode === 'follow' ? 'text-primary border-b-[0.8vw] border-b-primary' : 'text-outline'"
        @tap="switchMode('follow')"
      >
        <text class="text-title-small font-medium">关注</text>
      </view>
    </view>

    <text v-if="errorMsg && !loading" class="text-body-small text-error p-4">{{ errorMsg }}</text>

    <!-- [lynx:fix] 骨架屏：首屏加载（无数据）时显示 shimmer 卡片占位，数据就绪后切换 list。
         8 个 ≈ 4 行两列，与真实卡片同比例（48.4vw 宽 + 方形图片）避免切换 reflow -->
    <!-- [lynx:fix] 骨架屏不占满全屏高度（h-full 会溢出覆盖底部导航栏，拦截 tap，issue #129）：
     改 flex-1 min-h-0 约束在导航栏下方的内容区内 -->
    <view v-if="loading && illusts.length === 0" class="w-full flex-1 min-h-0 flex flex-row flex-wrap content-start p-1.5">
      <SkeletonCard v-for="n in 8" :key="n" />
    </view>

    <!-- 关注视图空态 -->
    <view v-if="mode === 'follow' && !loading && !errorMsg && illusts.length === 0" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">♡</text>
        <text class="text-body-large text-surface-on mt-3">暂无关注插画</text>
        <text class="text-body-medium text-surface-on-variant mt-1.5">关注的作者发布新插画后会展示在这里</text>
      </view>
    </view>
    <!-- 推荐视图空态（spec 加固 3）：杜绝「无数据 → 纯空白」 -->
    <view v-if="mode === 'recommend' && !loading && !errorMsg && illusts.length === 0" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">✦</text>
        <text class="text-body-large text-surface-on mt-3">暂无推荐插画</text>
        <text class="text-body-medium text-surface-on-variant mt-1.5">稍后再来看看，会有新的推荐</text>
      </view>
    </view>

    <list
      v-else-if="!loading || illusts.length > 0"
      class="w-full flex-1 min-h-0"
      list-type="waterfall"
      scroll-orientation="vertical"
      :span-count="2"
      :style="{ listMainAxisGap: '12px', listCrossAxisGap: '12px' }"
      :lower-threshold-item-count="2"
      @scrolltolower="loadMore"
    >
      <list-item
        v-for="item in illusts"
        :key="item.id"
        :item-key="String(item.id)"
        class="bg-surface-container-lowest rounded-[var(--md-shape-medium)] flex flex-col overflow-hidden shadow-[var(--md-elevation-1)]"
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
        <view v-else class="relative" @tap.stop="onImageTap(item)">
          <SkeletonImage :src="thumbUrl(item.image_urls)" height="48.4vw" lazy-load />
        </view>
        <text class="text-title-small font-medium text-surface-on mt-2 mx-2.5 [max-line:1]">{{ item.title }}</text>
        <text class="text-body-small text-surface-on-variant mt-1 mx-2.5 [max-line:1]">{{ item.user.name }}</text>
        <view class="mt-1 mx-2.5 mb-2.5">
          <BookmarkButton
            :illust-id="item.id"
            :initial-bookmarked="item.is_bookmarked"
            :bookmark-count="item.total_bookmarks"
          />
        </view>
        </view>
      </list-item>
      <list-item v-if="loadingMore" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text class="text-body-medium text-outline">加载中…</text>
      </list-item>
    </list>

    <!-- M3 NavigationBar：底部四 tab（推荐/插画/小说/我的） -->
    <NavigationBar :tabs="NAV_TABS" :active-name="'illusts'" @select="onNavSelect" />
  </view>
</template>

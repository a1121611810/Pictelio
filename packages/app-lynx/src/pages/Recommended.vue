<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'recommended' })
import { ref, onMounted, onActivated, watch } from 'vue'
import { navigate } from '../router'
import { loadRecommended, loadNext } from '../api/illust'
import type { PixivIllust } from '../api/types'
import { thumbUrl } from '../utils/imageUrl'
import { withTimeout } from '../utils/withTimeout'
import SkeletonCard from '../components/SkeletonCard.vue'
import SkeletonImage from '../components/SkeletonImage.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import { isRestricted } from '../stores/settingsStore'
import { isLoggedIn } from '../stores/authStore'
import RestrictOverlay from '../components/RestrictOverlay.vue'
import { RECOMMENDED_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'

const illusts = ref<PixivIllust[]>([])
const nextUrl = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')
// [lynx:fix] loadMore 双重防抖：
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
  loading.value = true
  errorMsg.value = ''
  try {
    // 请求挂起 15s 兜底（issue #128）：超时 reject 走下方 catch 展示 errorMsg，避免骨架屏无限显示
    const res = await withTimeout(loadRecommended(), 15000)
    // issue #91：全量渲染，受限条目盖遮罩（不再过滤）
    const all = res.illusts
    illusts.value = all.slice(0, PAGE_SIZE)
    pendingIllusts.value = all.slice(PAGE_SIZE)
    nextUrl.value = res.next_url
  } catch (err) {
    errorMsg.value = (err as { message?: string }).message ?? '加载失败'
  } finally {
    loading.value = false
    // [lynx:fix] 第一页加载完成同样进入冷却，防 web-core 延迟误触发 scrolltolower
    lastLoadEndedAt = Date.now()
  }
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
    errorMsg.value = (err as { message?: string }).message ?? '加载更多失败'
  } finally {
    loadingMore.value = false
    lastLoadEndedAt = Date.now()
  }
}

function openDetail(id: number) {
  void navigate(`/illust/${id}`)
}

// 受限条目图片区：吞没 tap（遮罩点击无任何反应，issue #91）
function swallowRestricted() {}
function openNovels() {
  void navigate('/novels')
}
function openFollowing() {
  void navigate('/following')
}
function openMe() {
  void navigate('/me')
}

onMounted(() => {
  void fetchFirstPage()
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
  // fetchFirstPage 覆盖赋值，并发最坏多一次幂等请求，不损坏数据。
  if (loggedIn && illusts.value.length === 0) {
    void fetchFirstPage()
  }
})

onActivated(() => {
  if (illusts.value.length === 0 && !loading.value && isLoggedIn.value) {
    void fetchFirstPage()
  }
})
</script>

<template>
  <view class="w-full h-full flex flex-col bg-background-2">
    <view class="flex flex-row items-center h-[11.733vw] px-4 bg-background border-b-[1px] border-b-stroke-2">
      <text class="flex-1 text-3xl font-bold text-foreground">推荐插画</text>
      <!-- [lynx:fix] 原生 text 元素 @tap 失效（真机实测）→ 外层 view 包 tap（view tap 已验证工作） -->
      <view class="ml-6 px-1 py-1" @tap="openFollowing">
        <text class="text-lg text-brand-foreground">关注</text>
      </view>
      <view class="ml-6 px-1 py-1" @tap="openNovels">
        <text class="text-lg text-brand-foreground">小说</text>
      </view>
      <view
        class="ml-6 px-1 py-1"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="RECOMMENDED_A11Y_LABELS.openMe"
        @tap="openMe"
      >
        <text class="text-lg text-brand-foreground">我的</text>
      </view>
    </view>

    <text v-if="errorMsg && !loading" class="text-sm text-danger p-4">{{ errorMsg }}</text>

    <!-- [lynx:fix] 骨架屏：首屏加载（无数据）时显示 shimmer 卡片占位，数据就绪后切换 list。
         8 个 ≈ 4 行两列，与真实卡片同比例（48.4vw 宽 + 方形图片）避免切换 reflow -->
    <!-- [lynx:fix] 骨架屏不占满全屏高度（h-full 会溢出覆盖底部导航栏，拦截 tap，issue #129）：
     改 flex-1 min-h-0 约束在导航栏下方的内容区内 -->
    <view v-if="loading && illusts.length === 0" class="w-full flex-1 min-h-0 flex flex-row flex-wrap content-start p-1.5">
      <SkeletonCard v-for="n in 8" :key="n" />
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
        class="bg-background rounded-[var(--borderRadiusXLarge)] flex flex-col overflow-hidden"
      >
        <!-- [lynx:fix] 原生 list-item 根级 @tap 失效（fiber 不触发，真机实测 2026-08-02）；
             把 openDetail 绑到内容 view（子元素 tap 已验证工作），♥ 的 @tap.stop 仍阻止冒泡 -->
        <view class="w-full flex flex-col" @tap="openDetail(item.id)">
        <!-- [lynx:fix] 间距：web-core 瀑布流引擎忽略 list-item 的 margin/padding 且内部任何 view 包裹
             都会导致 item 定位计算崩（全部重叠在起点）。间距用 list 官方属性
             list-main-axis-gap（行距）/ list-cross-axis-gap（列距），经 vue-lynx style 对象绑定
             （attribute 形式 web-core 不响应）。原生 LynxView 同样支持这两个属性（ADR-0048） -->
        <!-- [lynx:fix] 图片级骨架（SkeletonImage）：容器 aspect-[1/1] 方形 + min-h 保底（ADR-0045），
             图片 @load 后才隐藏 shimmer 显示图片（骨架关闭时机 = 图片加载完成，而非 API 数据返回） -->
        <view class="relative" @tap.stop="swallowRestricted">
          <SkeletonImage :src="thumbUrl(item.image_urls)" aspect-ratio="1 / 1" min-h="40vw" lazy-load />
          <!-- 受限条目图片区遮罩（issue #91）：吞没 tap，不触发详情跳转 -->
          <RestrictOverlay v-if="isRestricted(item)" :level="item.x_restrict === 2 ? 2 : 1" />
        </view>
        <text class="text-lg font-semibold text-foreground mt-2 mx-2.5 [max-line:1]">{{ item.title }}</text>
        <text class="text-sm text-foreground-2 mt-1 mx-2.5 [max-line:1]">{{ item.user.name }}</text>
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
        <text class="text-base text-foreground-3">加载中…</text>
      </list-item>
    </list>
  </view>
</template>

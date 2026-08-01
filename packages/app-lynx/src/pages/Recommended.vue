<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'recommended' })
import { ref, onMounted } from 'vue'
import { navigate } from '../router'
import { loadRecommended, loadNext } from '../api/illust'
import type { PixivIllust } from '../api/types'
import { thumbUrl } from '../utils/imageUrl'
import SkeletonCard from '../components/SkeletonCard.vue'
import SkeletonImage from '../components/SkeletonImage.vue'
import BookmarkButton from '../components/BookmarkButton.vue'
import { filterByRestrict } from '../stores/settingsStore'

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

async function fetchFirstPage() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await loadRecommended()
    // ADR-0051：应用 R18/R18G 开关过滤（默认隐藏）
    illusts.value = filterByRestrict(res.illusts)
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
  if (!nextUrl.value || loadingMore.value) return
  lastLoadMoreAt = now
  loadingMore.value = true
  try {
    const res = await loadNext(nextUrl.value)
    const seen = new Set(illusts.value.map((i) => i.id))
    // ADR-0051：分页同样应用 R18/R18G 过滤
    const fresh = filterByRestrict(res.illusts).filter((i) => !seen.has(i.id))
    illusts.value.push(...fresh)
    // 空页防护：服务端返回空列表但 next_url 仍存在时终止分页，防 web-core 下轮询空页
    nextUrl.value = fresh.length === 0 ? null : res.next_url
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
function openNovels() {
  void navigate('/novels')
}
function openMe() {
  void navigate('/me')
}

onMounted(() => {
  void fetchFirstPage()
})
</script>

<template>
  <view class="w-full h-full bg-background-2">
    <view class="flex flex-row items-center h-[11.733vw] px-4 bg-background border-b-[1px] border-b-stroke-2">
      <text class="flex-1 text-3xl font-bold text-foreground">推荐插画</text>
      <!-- [lynx:fix] 原生 text 元素 @tap 失效（真机实测）→ 外层 view 包 tap（view tap 已验证工作） -->
      <view class="ml-6 px-1 py-1" @tap="openNovels">
        <text class="text-lg text-brand-foreground">小说</text>
      </view>
      <view class="ml-6 px-1 py-1" @tap="openMe">
        <text class="text-lg text-brand-foreground">我的</text>
      </view>
    </view>

    <text v-if="errorMsg && !loading" class="text-sm text-danger p-4">{{ errorMsg }}</text>

    <!-- [lynx:fix] 骨架屏：首屏加载（无数据）时显示 shimmer 卡片占位，数据就绪后切换 list。
         8 个 ≈ 4 行两列，与真实卡片同比例（48.4vw 宽 + 方形图片）避免切换 reflow -->
    <view v-if="loading && illusts.length === 0" class="w-full h-full flex flex-row flex-wrap content-start p-1.5">
      <SkeletonCard v-for="n in 8" :key="n" />
    </view>

    <list
      v-else-if="!loading || illusts.length > 0"
      class="w-full h-full"
      list-type="waterfall"
      scroll-orientation="vertical"
      span-count="2"
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
        <SkeletonImage :src="thumbUrl(item.image_urls)" aspect-ratio="1 / 1" min-h="40vw" />
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

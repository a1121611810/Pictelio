<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { navigate } from '../router'
import { loadRecommended, loadNext } from '../api/illust'
import type { PixivIllust } from '../api/types'
import { thumbUrl } from '../utils/imageUrl'

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
    illusts.value = res.illusts
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
    const fresh = res.illusts.filter((i) => !seen.has(i.id))
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
      <text class="text-lg text-brand-foreground ml-6" @tap="openNovels">小说</text>
      <text class="text-lg text-brand-foreground ml-6" @tap="openMe">我的</text>
    </view>

    <text v-if="errorMsg && !loading" class="text-sm text-danger p-4">{{ errorMsg }}</text>

    <list
      v-if="!loading || illusts.length > 0"
      class="w-full h-full"
      list-type="waterfall"
      scroll-orientation="vertical"
      span-count="2"
      :lower-threshold-item-count="2"
      @scrolltolower="loadMore"
    >
      <list-item
        v-for="item in illusts"
        :key="item.id"
        :item-key="item.id"
        class="w-full bg-background rounded-[var(--borderRadiusXLarge)] m-1.5 flex flex-col overflow-hidden"
        @tap="openDetail(item.id)"
      >
        <!-- [lynx:fix] min-height 用 vw 保底：web-core 预览下 rpx 布局属性塌陷（--rpx-unit 失效）
             且 auto-size 不生效，卡片高度为 0 会导致 scrolltolower 无限触发；
             原生 LynxView 下 auto-size 正常计算真实高度覆盖此保底。40vw = 150px @375 -->
        <image
          class="w-full bg-background-3 min-h-[40vw]"
          :src="thumbUrl(item.image_urls)"
          :mode="'aspectFill'"
          auto-size
        />
        <text class="text-lg font-semibold text-foreground mt-2 mx-2.5 [max-line:1]">{{ item.title }}</text>
        <text class="text-sm text-foreground-2 mt-1 mx-2.5 [max-line:1]">{{ item.user.name }}</text>
        <text v-if="item.total_bookmarks > 0" class="text-xs text-foreground-3 mt-1 mx-2.5 mb-2.5">
          ♥ {{ item.total_bookmarks }}
        </text>
      </list-item>
      <list-item v-if="loadingMore" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text class="text-base text-foreground-3">加载中…</text>
      </list-item>
    </list>
  </view>
</template>

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
      :style="{ listMainAxisGap: '12px', listCrossAxisGap: '12px' }"
      :lower-threshold-item-count="2"
      @scrolltolower="loadMore"
    >
      <list-item
        v-for="item in illusts"
        :key="item.id"
        :item-key="item.id"
        class="bg-background rounded-[var(--borderRadiusXLarge)] flex flex-col overflow-hidden"
        @tap="openDetail(item.id)"
      >
        <!-- [lynx:fix] 间距：web-core 瀑布流引擎忽略 list-item 的 margin/padding 且内部任何 view 包裹
             都会导致 item 定位计算崩（全部重叠在起点）。间距用 list 官方属性
             list-main-axis-gap（行距）/ list-cross-axis-gap（列距），经 vue-lynx style 对象绑定
             （attribute 形式 web-core 不响应）。原生 LynxView 同样支持这两个属性（ADR-0048） -->
        <!-- [lynx:fix] min-height 用 vw 保底：web-core 预览下 rpx 布局属性塌陷（--rpx-unit 失效）
             且 aspect-ratio 在图片加载前不保证算出高度，卡片塌陷会导致 scrolltolower 无限触发；
             原生 LynxView 下 aspect-ratio 按列宽计算真实高度覆盖此保底。40vw = 150px @375 -->
        <!-- [lynx:fix] 禁止 w-full：web-core 下 percentage 宽度相对视口而非父容器（嵌套百分比暴露），
             list-item / x-image 都会被拉成视口宽、超出列被 overflow-hidden 裁剪 → 图片显示不全；
             宽度交给 waterfall 引擎约束为列宽，aspect-[1/1] 使容器成正方形，方形缩略图完整显示。
             mode=aspectFill：web-core 映射 object-fit:cover 且原生支持（widthFix 仅原生支持、web-core 不认） -->
        <image
          class="bg-background-3 min-h-[40vw] aspect-[1/1]"
          :src="thumbUrl(item.image_urls)"
          :mode="'aspectFill'"
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

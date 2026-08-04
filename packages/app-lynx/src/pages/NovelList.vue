<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'novels' })
import { ref, onMounted } from 'vue'
import { navigate, goBack } from '../router'
import { loadRecommendedNovels, loadFollow, loadNovelNext } from '../api/novel'
import type { PixivNovel } from '../api/types'
import { isRestricted } from '../stores/settingsStore'
import RestrictOverlay from '../components/RestrictOverlay.vue'

const novels = ref<PixivNovel[]>([])
const nextUrl = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')
// 推荐/关注切换（P0-T5）：关注视图用 /v1/novel/follow
const mode = ref<'recommend' | 'follow'>('recommend')
// 竞态防护：mode 切换后旧请求响应丢弃（generation gate）
let modeGen = 0
// [lynx:fix] loadMore 双重防抖（与 Recommended 同款，ADR-0045）：
// 1) 时间节流 800ms：防 scrolltolower 高频触发
// 2) 加载完成冷却 3s：防 web-core 的 list 在内容追加/首屏初始化后延迟误触发 scrolltolower（进入时自动多加载）
let lastLoadMoreAt = 0
let lastLoadEndedAt = 0

async function fetchFirstPage() {
  const gen = ++modeGen
  loading.value = true
  errorMsg.value = ''
  try {
    const res = mode.value === 'recommend' ? await loadRecommendedNovels() : await loadFollow()
    if (gen !== modeGen) return // 已切 tab，丢弃旧响应
    // issue #91：全量渲染，受限条目盖遮罩（不再过滤）
    novels.value = res.novels
    nextUrl.value = res.next_url
  } catch (err) {
    if (gen !== modeGen) return
    errorMsg.value = (err as { message?: string }).message ?? '加载失败'
  } finally {
    if (gen === modeGen) {
      loading.value = false
      // [lynx:fix] 第一页加载完成同样进入冷却
      lastLoadEndedAt = Date.now()
    }
  }
}

function switchMode(m: 'recommend' | 'follow') {
  if (mode.value === m) return
  mode.value = m
  novels.value = []
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
  if (!nextUrl.value || loadingMore.value) return
  lastLoadMoreAt = now
  loadingMore.value = true
  try {
    const res = await loadNovelNext(nextUrl.value)
    const seen = new Set(novels.value.map((n) => n.id))
    const fresh = res.novels.filter((n) => !seen.has(n.id))
    novels.value.push(...fresh)
    // 空页防护：基于服务端原始返回判空（issue #91：不再用过滤后长度，否则全受限页误杀分页）
    nextUrl.value = res.novels.length === 0 ? null : res.next_url
  } catch (err) {
    errorMsg.value = (err as { message?: string }).message ?? '加载更多失败'
  } finally {
    loadingMore.value = false
    lastLoadEndedAt = Date.now()
  }
}

function openDetail(id: number) {
  void navigate(`/novel/${id}`)
}

onMounted(fetchFirstPage)
</script>

<template>
  <view class="w-full h-full bg-background-2">
    <view class="flex flex-row items-center h-[11.733vw] px-4 bg-background border-b-[1px] border-b-stroke-2">
      <view class="py-1 pr-2" @tap="goBack"><text class="text-lg text-brand-foreground pr-4">‹ 返回</text></view>
      <text class="flex-1 text-2xl font-semibold text-foreground">小说</text>
    </view>

    <!-- 推荐/关注切换（P0-T5） -->
    <view class="flex flex-row border-b-[1px] border-b-stroke-2 bg-background">
      <view
        class="flex-1 py-2 flex items-center justify-center"
        :class="mode === 'recommend' ? 'text-brand-foreground border-b-2 border-b-[var(--colorBrandForeground1)]' : 'text-foreground-3'"
        @tap="switchMode('recommend')"
      >
        <text class="text-lg font-medium">推荐</text>
      </view>
      <view
        class="flex-1 py-2 flex items-center justify-center"
        :class="mode === 'follow' ? 'text-brand-foreground border-b-2 border-b-[var(--colorBrandForeground1)]' : 'text-foreground-3'"
        @tap="switchMode('follow')"
      >
        <text class="text-lg font-medium">关注</text>
      </view>
    </view>

    <text v-if="errorMsg && !loading" class="text-sm text-danger p-4">{{ errorMsg }}</text>

    <!-- 首屏骨架（issue #91）：4~6 条列表卡占位，切 tab 重载同样显示 -->
    <view v-if="loading && novels.length === 0" class="w-full">
      <view v-for="n in 5" :key="n" class="m-1.5 mx-3 p-3.5 bg-background rounded-[var(--borderRadiusXLarge)]">
        <view class="shimmer h-[32rpx] rounded-[var(--borderRadiusSmall)] w-[75%]" />
        <view class="shimmer h-[24rpx] rounded-[var(--borderRadiusSmall)] mt-1.5 w-[40%]" />
        <view class="shimmer h-[20rpx] rounded-[var(--borderRadiusSmall)] mt-1.5 w-[30%]" />
        <view class="shimmer h-[24rpx] rounded-[var(--borderRadiusSmall)] mt-2 w-[60%]" />
      </view>
    </view>

    <!-- 关注视图空态（P0-T5） -->
    <view v-if="mode === 'follow' && !loading && !errorMsg && novels.length === 0" class="w-full h-full flex items-center justify-center">
      <text class="text-base text-foreground-3">暂无关注小说</text>
    </view>

    <list
      v-if="novels.length > 0"
      class="w-full h-full"
      list-type="single"
      scroll-orientation="vertical"
      :lower-threshold-item-count="5"
      @scrolltolower="loadMore"
    >
      <list-item
        v-for="item in novels"
        :key="item.id"
        :item-key="item.id"
        class="w-full"
        @tap="openDetail(item.id)"
      >
        <view class="relative flex flex-row items-start m-1.5 mx-3 p-3.5 bg-background rounded-[var(--borderRadiusXLarge)]">
          <view class="flex-1 flex flex-col">
            <text class="text-xl font-semibold text-foreground [max-line:2]">{{ item.title }}</text>
            <text class="text-sm text-brand-foreground mt-1.5">by {{ item.user.name }}</text>
            <view class="flex flex-row mt-1.5">
              <text class="text-xs text-foreground-3 mr-4">{{ item.text_length }} 字</text>
              <text v-if="item.total_bookmarks > 0" class="text-xs text-foreground-3 mr-4">
                ♥ {{ item.total_bookmarks }}
              </text>
            </view>
            <view class="flex flex-row flex-wrap mt-2">
              <text
                v-for="tag in item.tags.slice(0, 3)"
                :key="tag.name"
                class="text-[18rpx] text-brand-foreground bg-background-3 rounded-[var(--borderRadiusMedium)] py-0.5 px-2 m-0.5"
              >
                #{{ tag.translated_name || tag.name }}
              </text>
            </view>
          </view>
          <!-- 受限条目遮罩（issue #91）：点击不响应 -->
          <RestrictOverlay v-if="isRestricted(item)" :level="item.x_restrict === 2 ? 2 : 1" />
        </view>
      </list-item>
      <list-item v-if="loadingMore" :key="'footer'" item-key="footer" class="w-full h-10 flex items-center justify-center" full-span>
        <text class="text-base text-foreground-3">加载中…</text>
      </list-item>
    </list>
  </view>
</template>

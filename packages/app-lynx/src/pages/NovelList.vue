<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'novels' })
import { ref, onMounted } from 'vue'
import { navigate } from '../router'
import { loadRecommendedNovels, loadFollow, loadNovelNext } from '../api/novel'
import type { PixivNovel } from '../api/types'
import { presentError } from '../utils/errorPresentation'
import { withTimeout } from '../utils/withTimeout'
import { isRestricted } from '../stores/settingsStore'
import RestrictOverlay from '../components/RestrictOverlay.vue'
import NavigationBar, { type NavTab } from '../components/NavigationBar.vue'

// 底部导航 tabs：推荐/关注/小说（本页）/我的
const navTabs: NavTab[] = [
  { name: 'recommended', path: '/recommended', icon: '⌂', label: '推荐', a11yLabel: '推荐' },
  { name: 'following', path: '/following', icon: '♥', label: '关注', a11yLabel: '关注' },
  { name: 'novels', path: '/novels', icon: '✎', label: '小说', a11yLabel: '小说' },
  { name: 'me', path: '/me', icon: '◎', label: '我的', a11yLabel: '我的' },
]

function onNavSelect(tab: NavTab) {
  if (tab.name === 'novels') return
  void navigate(tab.path, { replace: true })
}

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
    const req = mode.value === 'recommend' ? loadRecommendedNovels() : loadFollow()
    // 请求挂起 15s 兜底（与 Recommended 的 issue #128 对齐）：超时 reject 走 catch 展示 errorMsg，
    // 避免骨架屏无限显示
    const res = await withTimeout(req, 15000)
    if (gen !== modeGen) return // 已切 tab，丢弃旧响应
    // 响应形状防御：novels 缺失/非数组时置错误，避免后续 res.novels.length 崩溃或静默空白
    if (!Array.isArray(res.novels)) {
      errorMsg.value = '数据格式异常'
      return
    }
    // issue #91：全量渲染，受限条目盖遮罩（不再过滤）
    novels.value = res.novels
    nextUrl.value = res.next_url
  } catch (err) {
    if (gen !== modeGen) return
    errorMsg.value = presentError(err, '加载失败')
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
    errorMsg.value = presentError(err, '加载更多失败')
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
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：顶层页，居中标题，无返回箭头 -->
    <view class="flex flex-row items-center justify-center h-[17.067vw] px-4 bg-surface">
      <text class="text-title-large font-medium text-on-surface">小说</text>
    </view>

    <!-- 推荐/关注切换（M3 secondary tabs：选中 primary 文字 + 3px primary 指示器） -->
    <!-- M3 secondary tabs：容器 surface + 选中 primary 文字 + 3px primary 指示器 -->
    <view class="flex flex-row bg-surface">
      <view
        class="flex-1 py-2.5 flex flex-col items-center justify-center"
        @tap="switchMode('recommend')"
      >
        <text class="text-title-small font-medium" :class="mode === 'recommend' ? 'text-primary' : 'text-on-surface-variant'">推荐</text>
        <view class="mt-1 h-[0.8vw] w-[40%] rounded-full" :class="mode === 'recommend' ? 'bg-primary' : 'bg-transparent'" />
      </view>
      <view
        class="flex-1 py-2.5 flex flex-col items-center justify-center"
        @tap="switchMode('follow')"
      >
        <text class="text-title-small font-medium" :class="mode === 'follow' ? 'text-primary' : 'text-on-surface-variant'">关注</text>
        <view class="mt-1 h-[0.8vw] w-[40%] rounded-full" :class="mode === 'follow' ? 'bg-primary' : 'bg-transparent'" />
      </view>
    </view>

    <text v-if="errorMsg && !loading" class="text-body-small text-error p-4">{{ errorMsg }}</text>

    <!-- 首屏骨架（issue #91）：4~6 条列表卡占位，切 tab 重载同样显示 -->
    <!-- [lynx:fix] 骨架屏高度约束在导航栏下方内容区内（不占满全屏，issue #129） -->
    <view v-if="loading && novels.length === 0" class="w-full flex-1 min-h-0">
      <view v-for="n in 5" :key="n" class="m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <view class="shimmer h-[32rpx] rounded-[var(--md-shape-extra-small)] w-[75%]" />
        <view class="shimmer h-[24rpx] rounded-[var(--md-shape-extra-small)] mt-1.5 w-[40%]" />
        <view class="shimmer h-[20rpx] rounded-[var(--md-shape-extra-small)] mt-1.5 w-[30%]" />
        <view class="shimmer h-[24rpx] rounded-[var(--md-shape-extra-small)] mt-2 w-[60%]" />
      </view>
    </view>

    <!-- 关注视图空态（P0-T5） -->
    <view v-if="mode === 'follow' && !loading && !errorMsg && novels.length === 0" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">✎</text>
        <text class="text-body-large text-on-surface mt-3">暂无关注小说</text>
        <text class="text-body-medium text-on-surface-variant mt-1.5">关注的小说作者发布新作品后会展示在这里</text>
      </view>
    </view>
    <!-- 推荐视图空态（spec 加固 3）：杜绝「无数据 → 纯空白」 -->
    <view v-if="mode === 'recommend' && !loading && !errorMsg && novels.length === 0" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">✎</text>
        <text class="text-body-large text-on-surface mt-3">暂无推荐小说</text>
        <text class="text-body-medium text-on-surface-variant mt-1.5">稍后再来看看，会有新的推荐</text>
      </view>
    </view>

    <list
      v-if="novels.length > 0"
      class="w-full flex-1 min-h-0"
      list-type="single"
      scroll-orientation="vertical"
      :lower-threshold-item-count="5"
      @scrolltolower="loadMore"
    >
      <list-item
        v-for="item in novels"
        :key="item.id"
        :item-key="String(item.id)"
        class="w-full"
        @tap="openDetail(item.id)"
      >
        <view class="relative flex flex-row items-start m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
          <view class="flex-1 flex flex-col">
            <text class="text-title-medium font-medium text-on-surface [max-line:2]">{{ item.title }}</text>
            <text class="text-body-medium text-on-surface-variant mt-1.5">by {{ item.user.name }}</text>
            <view class="flex flex-row mt-1.5">
              <text class="text-label-medium text-on-surface-variant mr-4">{{ item.text_length }} 字</text>
              <text v-if="item.total_bookmarks > 0" class="text-label-medium text-on-surface-variant mr-4">
                ♥ {{ item.total_bookmarks }}
              </text>
            </view>
            <view class="flex flex-row flex-wrap mt-2">
              <text
                v-for="tag in item.tags.slice(0, 3)"
                :key="tag.name"
                class="h-[8.533vw] px-2 border border-outline-variant rounded-[var(--md-shape-small)] flex items-center justify-center m-0.5 text-label-large text-on-surface-variant"
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
        <text class="text-body-medium text-outline">加载中…</text>
      </list-item>
    </list>

    <!-- M3 NavigationBar：底部四 tab -->
    <NavigationBar :tabs="navTabs" :active-name="'novels'" @select="onNavSelect" />
  </view>
</template>

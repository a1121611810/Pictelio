<script setup lang="ts">
// ─── 小说介绍页（地图 #575 / spec #585 / 票 #586）：三段式导航 list → intro → reader 的中间页 ───
// D 轮播同族视觉（票 #583）：全屏封面 aspectFill 铺满 + 底部渐变 scrim 承载元信息；页内不滚动。
// 数据复用正文页详情端点（零新增 API）；代闸防竞态范式同 NovelDetail。
// [lynx:fix] KeepAlive name：本页按 :id 加载，不入缓存白名单（同正文页——缓存旧 id 实例会显示错误内容）
defineOptions({ name: 'novel-intro' })
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { currentParams, goBack } from '../router'
import { loadNovelDetail } from '../api/novel'
import type { PixivNovel } from '../api/types'
import { presentError } from '../utils/errorPresentation'
import { proxyImageUrl } from '../utils/imageUrl'
import CoverImage from '../components/CoverImage.vue'
import { t } from '../i18n'

const novel = ref<PixivNovel | null>(null)
const loading = ref(true)
const errorMsg = ref('')

const novelId = computed(() => Number(currentParams.value.id ?? 0))

/** 封面 URL（已过代理）；缺省空串 → CoverImage 判 failed（isUnloadableSrc，非静默降级） */
const coverSrc = computed(() => {
  const urls = novel.value?.image_urls
  return proxyImageUrl(urls?.large || urls?.medium || '')
})

// 代闸：路由复用/卸载后在飞响应一律作废（同 NovelDetail loadGeneration 范式）
let loadGeneration = 0

async function loadNovel(): Promise<void> {
  const gen = ++loadGeneration
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await loadNovelDetail(novelId.value)
    if (gen !== loadGeneration) return
    novel.value = res.novel
  } catch (err) {
    if (gen !== loadGeneration) return
    errorMsg.value = presentError(err, t('error.fallback.loadFailed')) // i18n: 构造时快照（瞬态）
  } finally {
    if (gen === loadGeneration) loading.value = false
  }
}

onMounted(() => {
  void loadNovel()
})

onUnmounted(() => {
  loadGeneration++ // 卸载后任何在飞响应落地即作废
})
</script>

<template>
  <view class="w-full h-full relative bg-surface">
    <!-- 加载态：全屏封面位骨架（shimmer 铺满；D 案页内不滚动，无内容区骨架） -->
    <view v-if="loading" class="absolute inset-0 shimmer" />

    <!-- 错误态：统一错误文案 + 重试 -->
    <view v-else-if="errorMsg" class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6">
      <text class="text-body-medium text-error text-center">{{ errorMsg }}</text>
      <view
        class="min-h-12 flex items-center justify-center px-5 rounded-[var(--md-shape-full)] border border-outline bg-surface-container-lowest active:bg-state-pressed-on-surface"
        @tap="loadNovel"
      >
        <text class="text-label-large text-primary">{{ t('novelIntro.retry') }}</text>
      </view>
    </view>

    <!-- 成功态：全屏封面 + 底部渐变 scrim（完整信息架构归票 #587） -->
    <view v-else-if="novel" class="absolute inset-0">
      <CoverImage :src="coverSrc" layout="full" retry />
      <view class="absolute bottom-0 left-0 right-0 px-6 pt-[24vw] pb-[10vw]" style="background: var(--md-scrim-overlay)">
        <text class="text-title-large font-semibold text-white leading-[1.3] [max-line:2]">{{ novel.title }}</text>
      </view>
    </view>

    <!-- 返回键：模板末位（DOM 顺序即层序，原生 LynxView 不吃 z-index）浮于三态之上 -->
    <view class="absolute top-2 left-1 py-1 pr-2" @tap="goBack">
      <text class="text-[6.4vw] leading-none text-white">‹</text>
    </view>
  </view>
</template>

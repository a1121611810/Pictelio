<script setup lang="ts">
// ─── RankingPrototype — 排行榜融合形态 UI 原型（PROTOTYPE，throwaway：裁决后即弃，不入 main）───
//
// 问题：插画页（推荐 tab）的排行榜入口用哪种「与推荐流融合」的形态？（webview 旧三变体已被否，
// 本轮三变体对标主流模式：App Store Today 编辑大卡 / Spotify 首页 chart 横滑卡 / 热榜混排注入）
// 变体（页内浮动切换器 tap 循环；候选卡与榜单页互通）：
//   hero    — 榜首编辑大卡：全宽一张，第 1 名作品全幅背景 + 渐变 scrim 叠加榜名/标题/作者，
//             右侧竖排第 2/3 名缩略，顶部 mini mode 切换；点卡开完整榜单页
//   charts  — 榜单卡横滑：每张竖高卡 = 一个榜单种类，卡面 = 该榜第 1 名封面 + 榜名 + 前三小徽章；
//             点卡开对应 mode 的榜单页（原生落地注意：list-item 内横滑需 spike，同相关作品行）
//   inline  — 榜单混排注入：日榜前 6 名以「常规瀑布流卡 + 榜单横幅」形态注入流内（原型在顶部
//             区域模拟注入观感，正式落地走 relatedInjection 同机制 list-item 注入），尾接入卡
// 数据：mock——宿主页已加载插画倒序重排（真图判定密度），不足补纯色占位块；零新增网络请求；
//       榜单行点击不跳转（只读）。文案为瞬态中文常量（throwaway 不入 i18n 字典）。
// 门禁：宿主 IllustList.vue 经 utils/devFlag.ts 的 DEV 导入挂载（__DEV__ 直写会被 loader 链改写坏）。
// 样式：Tailwind utility + M3 语义色，无 scoped CSS、无 rem。
import { computed, ref } from 'vue'
import type { PixivIllust } from '../api/types'
import { proxyImageUrl, thumbUrl } from '../utils/imageUrl'
import SkeletonImage from './SkeletonImage.vue'

const props = defineProps<{ illusts: PixivIllust[] }>()

// ── 变体注册 ──
type ProtoVariant = 'hero' | 'charts' | 'inline'
const VARIANTS: { key: ProtoVariant; label: string }[] = [
  { key: 'hero', label: '① 榜首大卡' },
  { key: 'charts', label: '② 榜单卡横滑' },
  { key: 'inline', label: '③ 榜单混排' },
]
const variant = ref<ProtoVariant>('hero')
const currentLabel = computed(
  () => VARIANTS.find((v) => v.key === variant.value)?.label ?? '',
)
function cycle(dir: 1 | -1) {
  const idx = VARIANTS.findIndex((v) => v.key === variant.value)
  variant.value = VARIANTS[(idx + dir + VARIANTS.length) % VARIANTS.length].key
}

// ── mock 榜单数据：宿主插画倒序重排（与主列表视觉区分），不足补纯色占位 ──
interface RankEntry {
  rank: number
  title: string
  author: string
  bookmarks: number
  thumb: string
  large: string
}
const PLACEHOLDER_BGS = ['#e8def8', '#d7e3fb', '#ffd8e4', '#d2e8d5', '#f4e0c4', '#dfd5ec', '#cfe5f2', '#f2d9d0']
const placeholderBg = (rank: number) => PLACEHOLDER_BGS[rank % PLACEHOLDER_BGS.length]
const entries = computed<RankEntry[]>(() => {
  const pool = props.illusts
  const out: RankEntry[] = []
  for (let i = 0; i < 20; i++) {
    const rank = i + 1
    const src: PixivIllust | undefined = pool[pool.length - 1 - i]
    if (src) {
      out.push({
        rank,
        title: src.title,
        author: src.user.name,
        bookmarks: src.total_bookmarks,
        thumb: thumbUrl(src.image_urls),
        large: proxyImageUrl(src.image_urls.large || src.image_urls.medium || ''),
      })
    } else {
      out.push({ rank, title: `排行榜作品 #${rank}`, author: `画师样本 ${rank}`, bookmarks: 20000 - rank * 437, thumb: '', large: '' })
    }
  }
  return out
})
const bgStyle = (e: RankEntry) => (e.large ? {} : { backgroundColor: placeholderBg(e.rank) })

// ── 完整榜单页（三变体共用的出口；覆盖层 fixed = web-core 预览视口）──
const RANK_MODES = ['日榜', '周榜', '月榜', '新人', '原创', 'R-18']
const rankMode = ref(0)
const pageOpen = ref(false)
const dateOffset = ref(0)
function openPage(mode: number) {
  rankMode.value = mode
  pageOpen.value = true
}
function fmtDate(offset: number): string {
  const d = new Date(Date.now() - offset * 86400000)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}
// hero 卡的 mini mode 切换（切卡背景 = 对应榜的"第 1 名"示意，mock 共用数据）
const heroMode = ref(0)
</script>

<template>
  <view>
    <!-- ═══ 变体 ①：榜首编辑大卡（App Store Today 风）═══ -->
    <view v-if="variant === 'hero'" class="mx-3 mt-3">
      <!-- mini mode 切换行 -->
      <view class="flex flex-row gap-2 mb-2">
        <view
          v-for="(m, i) in RANK_MODES.slice(0, 4)"
          :key="m"
          class="h-[8vw] px-3 rounded-full flex items-center"
          :class="heroMode === i ? 'bg-primary' : 'bg-surface-container-lowest'"
          @tap="heroMode = i"
        >
          <text class="text-body-small" :class="heroMode === i ? 'font-medium text-primary-on' : 'text-surface-on-variant'">{{ m }}</text>
        </view>
      </view>
      <!-- 大卡：第 1 名全幅背景 + scrim + 信息叠加 + 右侧 2/3 名竖排 -->
      <view
        accessibility-element accessibility-label="打开完整排行榜"
        class="relative w-full h-[62vw] rounded-[var(--md-shape-large)] overflow-hidden"
        @tap="openPage(heroMode)"
      >
        <SkeletonImage v-if="entries[0]?.large" :src="entries[0].large" height="62vw" lazy-load />
        <view v-else class="absolute inset-0" :style="bgStyle(entries[0])" />
        <!-- 底部渐变 scrim（信息可读层） -->
        <view class="absolute inset-x-0 bottom-0 h-[36vw]" :style="{ background: 'linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0))' }" />
        <!-- 左下信息叠加 -->
        <view class="absolute left-3 bottom-3 right-[30vw] flex flex-col">
          <view class="flex flex-row items-center gap-1.5">
            <view class="px-2 py-0.5 rounded-full bg-primary">
              <text class="text-body-small font-medium text-primary-on">第 1 名</text>
            </view>
            <text class="text-body-small text-white">{{ RANK_MODES[heroMode] }} · ★{{ entries[0]?.bookmarks.toLocaleString() }}</text>
          </view>
          <text class="text-title-medium font-medium text-white mt-1.5 [max-line:1]">{{ entries[0]?.title }}</text>
          <text class="text-body-small text-white opacity-80 [max-line:1]">{{ entries[0]?.author }}</text>
        </view>
        <!-- 右侧竖排 2/3 名缩略 -->
        <view class="absolute right-2.5 bottom-3 flex flex-col gap-2">
          <view
            v-for="e in entries.slice(1, 3)"
            :key="e.rank"
            class="relative w-[16vw] h-[16vw] rounded-[var(--md-shape-medium)] overflow-hidden"
          >
            <SkeletonImage v-if="e.thumb" :src="e.thumb" height="16vw" lazy-load />
            <view v-else class="w-full h-full" :style="bgStyle(e)" />
            <view class="absolute left-0 bottom-0 px-1 rounded-tr-[var(--md-shape-medium)] bg-primary">
              <text class="text-body-small font-medium text-primary-on">{{ e.rank }}</text>
            </view>
          </view>
          <view class="w-[16vw] flex items-center justify-center">
            <text class="text-body-small text-white opacity-90">全部 ›</text>
          </view>
        </view>
      </view>
    </view>

    <!-- ═══ 变体 ②：榜单卡横滑（Spotify chart 卡模式）═══ -->
    <view v-if="variant === 'charts'" class="mt-3">
      <view class="flex flex-row items-center justify-between mx-3 mb-2">
        <text class="text-title-small font-medium text-surface-on">排行榜</text>
        <view accessibility-element accessibility-label="打开完整排行榜" @tap="openPage(0)">
          <text class="text-body-small font-medium text-primary">全部 ›</text>
        </view>
      </view>
      <scroll-view scroll-orientation="horizontal" class="w-full h-[46vw]">
        <view class="flex flex-row gap-2.5 px-3">
          <view
            v-for="(m, i) in RANK_MODES.slice(0, 5)"
            :key="m"
            accessibility-element :accessibility-label="`打开${m}`"
            class="relative w-[30vw] h-[46vw] flex-none rounded-[var(--md-shape-large)] overflow-hidden"
            @tap="openPage(i)"
          >
            <image
              v-if="entries[i]?.large || entries[0]?.large"
              :src="entries[i]?.large || entries[0].large"
              class="w-full h-full"
              mode="aspectFill"
            />
            <view v-else class="absolute inset-0" :style="bgStyle(entries[i])" />
            <view class="absolute inset-x-0 bottom-0 h-[26vw]" :style="{ background: 'linear-gradient(to top, rgba(0,0,0,0.75), rgba(0,0,0,0))' }" />
            <view class="absolute left-2.5 top-2.5 px-2 py-0.5 rounded-full bg-primary">
              <text class="text-body-small font-medium text-primary-on">{{ m }}</text>
            </view>
            <!-- 前 3 名行（缩略 + 标题 + 名次） -->
            <view class="absolute left-2.5 bottom-2.5 right-2.5 flex flex-col gap-1">
              <view v-for="e in entries.slice(i, i + 3)" :key="e.rank" class="flex flex-row items-center gap-1.5">
                <view class="relative w-[7.5vw] h-[7.5vw] rounded-[var(--md-shape-small)] overflow-hidden flex-none">
                  <image v-if="e.thumb" :src="e.thumb" class="w-full h-full" mode="aspectFill" />
                  <view v-else class="w-full h-full" :style="bgStyle(e)" />
                </view>
                <text class="text-body-small text-white [max-line:1] flex-1">{{ e.title }}</text>
                <text class="text-body-small font-medium text-white flex-none">{{ e.rank }}</text>
              </view>
            </view>
          </view>
        </view>
      </scroll-view>
    </view>

    <!-- ═══ 变体 ③：榜单混排注入（热榜混排模式；横幅卡 = 常规瀑布流卡 + 榜单横幅）═══ -->
    <view v-if="variant === 'inline'" class="px-3 mt-3">
      <view class="flex flex-row items-center justify-between mb-2">
        <text class="text-title-small font-medium text-surface-on">今日榜单已混入推荐流</text>
        <view accessibility-element accessibility-label="打开完整排行榜" @tap="openPage(0)">
          <text class="text-body-small font-medium text-primary">完整榜单 ›</text>
        </view>
      </view>
      <!-- 双列注入示意：横幅卡与下方真实瀑布流卡同形（正式落地为 relatedInjection 同机制的流内注入）。
           宽度用百分比（非 48.4vw——容器有 padding 时 vw 会溢出被挤成单列，实测） -->
      <view class="flex flex-row flex-wrap justify-between">
        <view
          v-for="e in entries.slice(0, 6)"
          :key="e.rank"
          class="w-[48.5%] mb-2 bg-surface-container-lowest rounded-[var(--md-shape-medium)] overflow-hidden shadow-[var(--md-elevation-1)]"
        >
          <view class="relative">
            <SkeletonImage v-if="e.thumb" :src="e.thumb" height="48.4vw" lazy-load />
            <view v-else class="w-full h-[48.4vw]" :style="bgStyle(e)" />
            <!-- 榜单横幅（注入卡唯一差异元素） -->
            <view class="absolute top-0 left-0 px-2 py-1 rounded-br-[var(--md-shape-medium)] bg-primary">
              <text class="text-body-small font-medium text-primary-on">{{ RANK_MODES[0] }} 第 {{ e.rank }} 名</text>
            </view>
          </view>
          <view class="px-2.5 pt-2 pb-2.5">
            <text class="text-title-small font-medium text-surface-on [max-line:1]">{{ e.title }}</text>
            <text class="text-body-small text-surface-on-variant mt-0.5 [max-line:1]">{{ e.author }}</text>
            <text class="text-body-small text-outline mt-1">♥ {{ e.bookmarks.toLocaleString() }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- ═══ 完整榜单页（覆盖层；三变体共用出口）═══ -->
    <view v-if="pageOpen" class="fixed inset-0 z-50 flex flex-col bg-surface">
      <view class="flex flex-row items-center px-2 pt-2">
        <view accessibility-element accessibility-label="返回" @tap="pageOpen = false" class="w-[12vw] h-[12vw] flex items-center justify-center">
          <text class="text-title-large text-surface-on">‹</text>
        </view>
        <text class="text-title-medium font-medium text-surface-on">排行榜</text>
      </view>
      <scroll-view scroll-orientation="vertical" class="flex-1 w-full">
        <view class="flex flex-row flex-wrap gap-2 px-3 pt-1 pb-2">
          <view
            v-for="(m, i) in RANK_MODES"
            :key="m"
            accessibility-element :accessibility-label="m"
            class="h-[9.6vw] px-4 rounded-full border-[1px] flex items-center"
            :class="rankMode === i ? 'bg-secondary-container border-transparent' : 'bg-surface-container-lowest border-outline-variant'"
            @tap="rankMode = i"
          >
            <text
              class="text-body-small"
              :class="rankMode === i ? 'font-medium text-secondary-on-container' : 'text-surface-on-variant'"
            >{{ m }}</text>
          </view>
        </view>
        <view class="flex flex-row items-center justify-center gap-2 py-2">
          <view accessibility-element accessibility-label="前一天" @tap="dateOffset++" class="w-[10vw] h-[10vw] flex items-center justify-center">
            <text class="text-title-medium text-surface-on-variant">‹</text>
          </view>
          <text class="text-body-medium text-surface-on-variant">{{ fmtDate(dateOffset) }}</text>
          <view
            accessibility-element accessibility-label="后一天"
            class="w-[10vw] h-[10vw] flex items-center justify-center"
            :style="{ opacity: dateOffset === 0 ? 0.4 : 1 }"
            @tap="dateOffset = Math.max(0, dateOffset - 1)"
          >
            <text class="text-title-medium text-surface-on-variant">›</text>
          </view>
        </view>
        <view class="flex flex-col pb-16">
          <view
            v-for="e in entries"
            :key="e.rank"
            class="flex flex-row items-center px-4 py-2 border-b-[1px] border-b-outline-variant"
          >
            <text
              class="w-[8vw] text-center text-title-medium font-medium"
              :class="e.rank <= 3 ? 'text-primary' : 'text-outline'"
            >{{ e.rank }}</text>
            <view class="w-[16vw] h-[16vw] rounded-[var(--md-shape-medium)] overflow-hidden mx-3 bg-surface-variant">
              <SkeletonImage v-if="e.thumb" :src="e.thumb" height="16vw" lazy-load />
              <view v-else class="w-full h-full" :style="bgStyle(e)" />
            </view>
            <view class="flex-1 min-w-0 mr-2">
              <text class="text-body-medium text-surface-on [max-line:1]">{{ e.title }}</text>
              <text class="text-body-small text-surface-on-variant [max-line:1]">{{ e.author }}</text>
            </view>
            <text class="text-body-small text-outline">★{{ e.bookmarks.toLocaleString() }}</text>
          </view>
        </view>
      </scroll-view>
    </view>

    <!-- ═══ 浮动切换器（原型工具，非被评测设计的一部分）═══ -->
    <view
      class="fixed bottom-[6vw] left-1/2 z-50 flex flex-row items-center rounded-full bg-inverse-surface px-2 py-1"
      style="transform: translateX(-50%)"
    >
      <view accessibility-element accessibility-label="上一个变体" @tap="cycle(-1)" class="w-[9vw] h-[9vw] flex items-center justify-center">
        <text class="text-title-medium text-inverse-on-surface">‹</text>
      </view>
      <text class="text-body-small text-inverse-on-surface mx-1 [max-line:1]">{{ currentLabel }}</text>
      <view accessibility-element accessibility-label="下一个变体" @tap="cycle(1)" class="w-[9vw] h-[9vw] flex items-center justify-center">
        <text class="text-title-medium text-inverse-on-surface">›</text>
      </view>
    </view>
  </view>
</template>

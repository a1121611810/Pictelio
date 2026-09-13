<script setup lang="ts">
// ─── RankingPrototype — 排行榜「范围层级」UI 原型（PROTOTYPE，throwaway：裁决后即弃，不入 main）───
//
// 问题：入口形态已定（变体 ① 榜首编辑大卡）。本轮的三个变体是**范围层级**——
//       排行榜这件事做到哪一步，各自的实际观感与代价是什么？
// 变体（页内浮动切换器 tap 循环；切换器第二行常显本变体的范围说明）：
//   s1 — 只做入口：大卡看今日第 1 名 + 右侧 2/3 名，点图进作品详情；**无榜单页**
//        （卡上不出现「全部 ›」、无维度切换、无日期回看）
//   s2 — 入口 + 简化榜单页：可切维度（日/周/月/新人/原创/R-18），仍只能看今日
//   s3 — 入口 + 完整榜单页：维度切换 + 按日期回看（今日标记、未来日期禁用）
// 入口（三变体完全一致）：榜首编辑大卡（App Store Today 风）。
// 数据：mock——宿主页已加载插画倒序重排（真图判定密度），不足补纯色占位块；零新增网络请求；
//       榜单行点击不跳转（只读）。文案为瞬态中文常量（throwaway，已入 hardcode 白名单）。
// 门禁：宿主 IllustList.vue 经 utils/devFlag.ts 的 DEV 导入挂载（__DEV__ 直写会被 loader 链改写坏）。
// 样式：Tailwind utility + M3 语义色，无 scoped CSS、无 rem。
import { computed, ref } from 'vue'
import type { PixivIllust } from '../api/types'
import { proxyImageUrl, thumbUrl } from '../utils/imageUrl'
import SkeletonImage from './SkeletonImage.vue'

const props = defineProps<{ illusts: PixivIllust[] }>()

// ── 变体注册（范围层级）──
type ProtoVariant = 's1' | 's2' | 's3'
const VARIANTS: { key: ProtoVariant; label: string; hint: string }[] = [
  {
    key: 's1',
    label: 'S1 只做入口',
    hint: '只有入口：大卡看今日第 1 名，点图进作品详情。无榜单页、无维度切换、无日期回看',
  },
  {
    key: 's2',
    label: 'S2 简化榜单页',
    hint: '入口 + 简化榜单页：可切维度（日/周/月/新人/原创/R-18），但只能看今日',
  },
  {
    key: 's3',
    label: 'S3 完整榜单页',
    hint: '入口 + 完整榜单页：维度切换 + 按日期回看（今日标记、未来日期禁用）',
  },
]
const variant = ref<ProtoVariant>('s1')
const meta = computed(() => VARIANTS.find((v) => v.key === variant.value)!)
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
const bgStyle = (e: RankEntry | undefined) =>
  e && e.large ? {} : { backgroundColor: placeholderBg(e?.rank ?? 0) }

// ── 榜单页状态（S2/S3 共用；showDate 决定是否渲染日期回看行）──
const RANK_MODES = ['日榜', '周榜', '月榜', '新人', '原创', 'R-18']
const rankMode = ref(0)
const pageOpen = ref(false)
const dateOffset = ref(0)
const heroMode = ref(0)
function openPage(mode: number) {
  rankMode.value = mode
  pageOpen.value = true
}
function fmtDate(offset: number): string {
  const d = new Date(Date.now() - offset * 86400000)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}
</script>

<template>
  <view>
    <!-- ═══ 入口（三变体一致）：榜首编辑大卡 ═══ -->
    <view v-if="!pageOpen" class="mx-3 mt-3">
      <!-- mini 维度切换行 -->
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
        accessibility-element accessibility-label="排行榜"
        class="relative w-full h-[62vw] rounded-[var(--md-shape-large)] overflow-hidden"
        @tap="variant !== 's1' && openPage(heroMode)"
      >
        <SkeletonImage v-if="entries[0]?.large" :src="entries[0].large" height="62vw" lazy-load />
        <view v-else class="absolute inset-0" :style="bgStyle(entries[0])" />
        <view class="absolute inset-x-0 bottom-0 h-[36vw]" :style="{ background: 'linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0))' }" />
        <!-- 左下信息叠加 -->
        <view class="absolute left-3 bottom-3" :class="variant === 's1' ? 'right-3' : 'right-[30vw]'">
          <view class="flex flex-row items-center gap-1.5">
            <view class="px-2 py-0.5 rounded-full bg-primary">
              <text class="text-body-small font-medium text-primary-on">第 1 名</text>
            </view>
            <text class="text-body-small text-white">{{ RANK_MODES[heroMode] }} · ★{{ entries[0]?.bookmarks.toLocaleString() }}</text>
          </view>
          <text class="text-title-medium font-medium text-white mt-1.5 [max-line:1]">{{ entries[0]?.title }}</text>
          <text class="text-body-small text-white opacity-80 [max-line:1]">{{ entries[0]?.author }}</text>
        </view>
        <!-- 右侧竖排 2/3 名（三变体一致）+「全部 ›」（仅 S2/S3：S1 无榜单页可去） -->
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
          <view v-if="variant !== 's1'" class="w-[16vw] flex items-center justify-center">
            <text class="text-body-small text-white opacity-90">全部 ›</text>
          </view>
        </view>
      </view>
    </view>

    <!-- ═══ 榜单页（覆盖层，仅 S2/S3；S2 无日期回看行）═══ -->
    <view v-if="pageOpen" class="fixed inset-0 z-50 flex flex-col bg-surface">
      <view class="flex flex-row items-center px-2 pt-2">
        <view accessibility-element accessibility-label="返回" @tap="pageOpen = false" class="w-[12vw] h-[12vw] flex items-center justify-center">
          <text class="text-title-large text-surface-on">‹</text>
        </view>
        <text class="text-title-medium font-medium text-surface-on">排行榜</text>
      </view>
      <scroll-view scroll-orientation="vertical" class="flex-1 w-full">
        <!-- 维度切换 chips（换行展示） -->
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
        <!-- 日期回看行：仅 S3（完整榜单页）；S2 不渲染此块 = 只能看今日 -->
        <view v-if="variant === 's3'" class="flex flex-row items-center justify-center gap-2 py-2">
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
        <!-- 榜单行（只读原型：不跳转详情） -->
        <view class="flex flex-col pb-20">
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

    <!-- ═══ 浮动切换器 + 范围说明（原型工具，非被评测设计的一部分）═══ -->
    <view
      class="fixed bottom-[5vw] left-1/2 z-50 flex flex-col items-center rounded-[var(--md-shape-medium)] bg-inverse-surface px-2 py-1.5 w-[86vw]"
      style="transform: translateX(-50%)"
    >
      <view class="flex flex-row items-center">
        <view accessibility-element accessibility-label="上一个变体" @tap="cycle(-1)" class="w-[9vw] h-[9vw] flex items-center justify-center">
          <text class="text-title-medium text-inverse-on-surface">‹</text>
        </view>
        <text class="text-body-small text-inverse-on-surface mx-1 [max-line:1]">{{ meta.label }}</text>
        <view accessibility-element accessibility-label="下一个变体" @tap="cycle(1)" class="w-[9vw] h-[9vw] flex items-center justify-center">
          <text class="text-title-medium text-inverse-on-surface">›</text>
        </view>
      </view>
      <!-- 范围说明：本变体给了什么 / 少了什么（原型注解，非界面设计的一部分） -->
      <text class="text-body-small text-inverse-on-surface opacity-80 text-center">{{ meta.hint }}</text>
    </view>
  </view>
</template>

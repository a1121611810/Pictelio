<script setup lang="ts">
// ═══════════════════════════════════════════════════════════════════
// PROTOTYPE — 全局搜索形态探索（throwaway，不入 main）
// 路由 /prototype/search（见 router.ts PROTOTYPE 标记），web-core 预览验证用。
// 问题：「搜索功能」在 lynx 客户端里应该是什么形态？不一定限定为搜索页——
// 要「更灵活、全局方便调用」。本页 3 个结构截然不同的变体 + 切换条：
//   A. 底部弹层（全局命令面板）—— 任意页可从放射 FAB 唤起，遮罩 + 80vh 面板
//   B. 全屏搜索页（顶级路由 /search，对齐 webview SearchPage 蓝本）
//   C. 半屏速览（spotlight 式）—— 从顶部搜索栏唤起，一个框即输即搜、结果即点即走
// 数据全为 mock 常量（stub，不打真实 API）；交互遵循 lynx 既有范式
// （@tap、[lynx:fix] 全屏元素 v-if、list item-key String、DOM 顺序覆盖）。
// ═══════════════════════════════════════════════════════════════════
import { ref, computed } from 'vue'

defineOptions({ name: 'prototype-search' })

// ─── 变体状态 ───
const variant = ref<'A' | 'B' | 'C'>('A')
const openA = ref(true) // A 弹层是否打开（切换变体时自动打开，直达最终形态）
const openC = ref(true) // C 半屏速览是否打开

// ─── 共享关键词 / scope / sort（变体间一致，便于对比） ───
const keyword = ref('星')
const scope = ref<'all' | 'illust' | 'novel'>('all')
const sort = ref<'date_desc' | 'date_asc' | 'popular_desc'>('date_desc')

const VARIANTS = ['A', 'B', 'C'] as const
const SCOPE_SEGMENTS = [
  ['all', '全部'],
  ['illust', '插画'],
  ['novel', '小说'],
] as const
const SORT_SEGMENTS = [
  ['date_desc', '最新'],
  ['date_asc', '最早'],
  ['popular_desc', '热门'],
] as const

// ─── mock 数据（stub） ───
interface SearchRow { id: number; title: string; author: string; sub: string }

const MOCK_ILLUSTS: Array<{ id: number; title: string; author: string; kind: string }> = [
  { id: 142451838, title: '琥珀色の朝', author: 'ちみく', kind: '插画' },
  { id: 142355221, title: 'Fate/EXTRA ネロ', author: 'morning', kind: '插画' },
  { id: 141982111, title: '星の少女', author: 'pixiv', kind: 'Ugoira' },
  { id: 141237823, title: '海辺のリゾート', author: 'aixz', kind: '漫画' },
  { id: 140985231, title: '桜色の約束', author: 'haru', kind: '插画' },
  { id: 140712893, title: 'エンジン少女', author: 'kohi', kind: '漫画' },
  { id: 140001234, title: '星降る夜の散歩', author: 'yuki', kind: '插画' },
]
const MOCK_NOVELS: Array<{ id: number; title: string; author: string; chars: number }> = [
  { id: 139982111, title: '深夜の告白', author: 'himi', chars: 3200 },
  { id: 132887721, title: '星降る夜の物語', author: 'momo', chars: 15000 },
  { id: 131550918, title: '夏休みの退屈', author: 'shion', chars: 8900 },
  { id: 133991111, title: '花と涙', author: 'akira', chars: 24000 },
]
const HOT_WORDS = ['初音ミク', '原神', '东方Project', '艦これ']
const HISTORY = ['琥珀色の朝', '星の少女', 'ネロ']

/** 色块占位封面（M3 token 循环，不作真实图片依赖） */
const THUMB_CLASSES = [
  'bg-primary-container',
  'bg-secondary-container',
  'bg-tertiary-container',
  'bg-surface-container-highest',
]
function thumbClass(i: number): string {
  return THUMB_CLASSES[i % THUMB_CLASSES.length]
}

// ─── 结果过滤 + 统一行结构（按标题/作者 contains，营造真实感） ───
const kw = computed(() => keyword.value.trim().toLowerCase())

const resultsA = computed<SearchRow[]>(() => {
  if (scope.value === 'novel') {
    return MOCK_NOVELS.filter(
      (n) => !kw.value || n.title.toLowerCase().includes(kw.value) || n.author.toLowerCase().includes(kw.value),
    ).map((n) => ({ id: n.id, title: n.title, author: n.author, sub: `${n.chars} 字` }))
  }
  return MOCK_ILLUSTS.filter(
    (i) => !kw.value || i.title.toLowerCase().includes(kw.value) || i.author.toLowerCase().includes(kw.value),
  ).map((i) => ({ id: i.id, title: i.title, author: i.author, sub: i.kind }))
})

/** 排序（模拟）：最新=id desc / 最早=id asc / 热门=默认顺序 */
const gridItems = computed<Array<{ id: number; title: string; author: string }>>(() => {
  if (scope.value === 'novel') return []
  const list = MOCK_ILLUSTS.filter(
    (i) => !kw.value || i.title.toLowerCase().includes(kw.value) || i.author.toLowerCase().includes(kw.value),
  )
  if (sort.value === 'date_desc') list.sort((a, b) => b.id - a.id)
  if (sort.value === 'date_asc') list.sort((a, b) => a.id - b.id)
  return list.map((i) => ({ id: i.id, title: i.title, author: i.author }))
})

/** 变体 C 混合结果（插画在前 + 小说在后，一步到位） */
const mixedResults = computed<Array<SearchRow & { kind: 'illust' | 'novel' }>>(() => {
  const rows: Array<SearchRow & { kind: 'illust' | 'novel' }> = []
  for (const i of MOCK_ILLUSTS) {
    if (kw.value && !i.title.toLowerCase().includes(kw.value) && !i.author.toLowerCase().includes(kw.value)) continue
    rows.push({ kind: 'illust', id: i.id, title: i.title, author: i.author, sub: i.kind })
  }
  for (const n of MOCK_NOVELS) {
    if (kw.value && !n.title.toLowerCase().includes(kw.value) && !n.author.toLowerCase().includes(kw.value)) continue
    rows.push({ kind: 'novel', id: n.id, title: n.title, author: n.author, sub: `${n.chars} 字` })
  }
  return rows
})

// ─── 切换条 ───
const VARIANT_LABELS = { A: '弹层', B: '全屏页', C: '速览' } as const
function setVariant(v: 'A' | 'B' | 'C'): void {
  variant.value = v
  openA.value = v === 'A'
  openC.value = v === 'C'
}

// ─── toast（点击结果 → 模拟跳转反馈；仿 App.vue exitHint 胶囊） ───
const toast = ref('')
let toastTimer: ReturnType<typeof setTimeout> | undefined
function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 1600)
}
function pickResult(id: number, kind: string): void {
  openC.value = false
  showToast(`跳转 → ${kind} #${id}`)
}
</script>

<template>
  <view class="w-full h-full relative">
    <!-- ══ 背景 mock 主页（入口上下文：顶栏 + 单卡 + 底部导航 + 放射 FAB） ══ -->
    <view class="w-full h-full flex flex-col bg-surface">
      <!-- 顶栏：搜索栏（点开→变体 C） -->
      <view class="flex flex-row items-center px-4 h-[13vw] flex-shrink-0">
        <text class="text-title-medium text-surface-on font-medium mr-3">推荐</text>
        <view
          class="flex-1 h-[10.667vw] bg-surface-container-high rounded-[var(--md-shape-full)] flex items-center px-4"
          @tap="setVariant('C')"
        >
          <text class="text-body-medium text-surface-on-variant">🔍 搜索插画 / 小说…</text>
        </view>
      </view>

      <!-- mock 沉浸大卡（占满剩余空间） -->
      <view class="flex-1 min-h-0 mx-4 mb-3 rounded-[var(--md-shape-large)] overflow-hidden shadow-[var(--md-elevation-1)]">
        <view class="w-full h-full bg-secondary-container relative">
          <view class="absolute left-0 right-0 bottom-0 bg-scrim px-4 py-3">
            <text class="text-title-medium text-surface-on">虚构作品 · 推荐位</text>
            <text class="text-body-small text-surface-on block mt-1">点击右上搜索栏体验半屏速览（变体 C）</text>
          </view>
        </view>
      </view>

      <!-- 模拟底部导航（第 4 tab 位置暗示「搜索」入口 → 变体 B 路由版） -->
      <view class="w-full h-[13vw] bg-surface-container-lowest flex flex-row border-t border-t-outline-variant flex-shrink-0">
        <view class="flex-1 flex flex-col items-center justify-center" @tap="setVariant('B')">
          <text class="text-[4.5vw] text-surface-on-variant">⌂</text>
          <text class="text-[2.8vw] text-surface-on-variant">推荐</text>
        </view>
        <view class="flex-1 flex flex-col items-center justify-center" @tap="setVariant('B')">
          <text class="text-[4.5vw] text-surface-on-variant">✦</text>
          <text class="text-[2.8vw] text-surface-on-variant">插画</text>
        </view>
        <view class="flex-1 flex flex-col items-center justify-center" @tap="setVariant('B')">
          <text class="text-[4.5vw] text-surface-on-variant">✎</text>
          <text class="text-[2.8vw] text-surface-on-variant">小说</text>
        </view>
        <view class="flex-1 flex flex-col items-center justify-center" @tap="setVariant('B')">
          <text class="text-[4.5vw] text-secondary-on-container">⚲</text>
          <text class="text-[2.8vw] text-secondary-on-container">搜索</text>
        </view>
      </view>
    </view>

    <!-- 模拟放射 FAB（点开→变体 A；GlobalFab 同款 (0,0) 锚点 + vw 定位） -->
    <view
      class="absolute flex items-center justify-center w-[14.933vw] h-[14.933vw] rounded-[var(--md-shape-large)] bg-primary-container shadow-[var(--md-elevation-3)]"
      style="left: 81vw; top: 180vw"
      @tap="setVariant('A')"
    >
      <text class="text-surface-on text-[6.4vw]">🔍</text>
    </view>

    <!-- ══ 变体 A：底部弹层（全局命令面板） —— DOM 后置覆盖，遮罩 + 80vh 面板 ══ -->
    <view v-if="variant === 'A' && openA" class="absolute inset-0">
      <view class="absolute inset-0 bg-scrim" @tap="openA = false" />
      <view
        class="absolute bottom-0 left-0 right-0 h-[80vh] bg-surface-container-lowest rounded-t-[var(--md-shape-extra-large)] flex flex-col"
        @tap.stop
      >
        <!-- 面板头：标题 + 关闭 -->
        <view class="flex flex-row items-center h-[11.733vw] px-4 flex-shrink-0">
          <view class="w-[8vw]" />
          <text class="flex-1 text-center text-title-large text-surface-on">搜索</text>
          <view class="w-[8vw] h-[8vw] flex items-center justify-center" @tap="openA = false">
            <text class="text-[6.4vw] leading-none text-surface-on-variant">×</text>
          </view>
        </view>

        <!-- 输入框 + 清除 -->
        <view class="flex flex-row items-center gap-2 px-4 flex-shrink-0">
          <input
            v-model="keyword"
            class="flex-1 h-[11.2vw] box-border bg-surface-container-highest rounded-[var(--md-shape-full)] text-body-medium text-surface-on px-5"
            placeholder="输入标签 / 关键词"
            placeholder-color="#49454f"
          />
          <view v-if="keyword" class="w-[8vw] h-[8vw] flex items-center justify-center flex-shrink-0" @tap="keyword = ''">
            <text class="text-[5.5vw] leading-none text-surface-on-variant">×</text>
          </view>
        </view>

        <!-- 空关键词：搜索历史 + 热门词 -->
        <template v-if="!keyword.trim()">
          <text class="text-label-large text-surface-on px-5 mt-4 mb-2">搜索历史</text>
          <view class="flex flex-row gap-2 px-5 flex-shrink-0">
            <view
              v-for="w in HISTORY"
              :key="w"
              class="h-[10.667vw] px-4 bg-surface-container-high rounded-[var(--md-shape-full)] flex items-center"
              @tap="keyword = w"
            >
              <text class="text-body-small text-surface-on">{{ w }}</text>
            </view>
          </view>
          <text class="text-label-large text-surface-on px-5 mt-4 mb-2">热门搜索</text>
          <view class="flex flex-row gap-2 px-5 flex-shrink-0">
            <view
              v-for="w in HOT_WORDS"
              :key="w"
              class="h-[10.667vw] px-4 bg-secondary-container rounded-[var(--md-shape-full)] flex items-center"
              @tap="keyword = w"
            >
              <text class="text-body-small text-secondary-on-container">{{ w }}</text>
            </view>
          </view>
        </template>

        <!-- 有关键词：scope 段 + 结果列表 -->
        <template v-else>
          <view class="flex flex-row gap-2 px-5 mt-4 flex-shrink-0">
            <view
              v-for="s in SCOPE_SEGMENTS"
              :key="s[0]"
              class="h-[10.667vw] px-4 rounded-[var(--md-shape-full)] flex items-center"
              :class="scope === s[0] ? 'bg-secondary-container' : 'bg-surface-container-high'"
              @tap="scope = s[0]"
            >
              <text
                class="text-body-small"
                :class="scope === s[0] ? 'text-secondary-on-container' : 'text-surface-on-variant'"
              >{{ s[1] }}</text>
            </view>
          </view>

          <view class="flex-1 min-h-0 mt-3">
            <text v-if="resultsA.length === 0" class="text-body-medium text-outline px-5">
              没有找到相关内容，试试换一个关键词
            </text>
            <list
              v-else
              class="w-full h-full"
              list-type="single"
              scroll-orientation="vertical"
            >
              <list-item
                v-for="(r, idx) in resultsA"
                :key="String(r.id)"
                :item-key="String(r.id)"
                class="w-full"
              >
                <view class="flex flex-row items-center px-5 py-3" @tap="showToast(`跳转 → 作品 #${r.id}`)">
                  <view class="w-[14vw] h-[14vw] rounded-[var(--md-shape-small)] flex-shrink-0" :class="thumbClass(idx)" />
                  <view class="flex-1 ml-3 min-w-0">
                    <text class="text-body-medium text-surface-on" style="word-break: break-all">{{ r.title }}</text>
                    <text class="text-body-small text-surface-on-variant block mt-1">{{ r.author }} · {{ r.sub }}</text>
                  </view>
                  <text class="text-[3.2vw] text-surface-on-variant flex-shrink-0">查看 ›</text>
                </view>
              </list-item>
            </list>
          </view>
        </template>
      </view>
    </view>

    <!-- ══ 变体 B：全屏搜索页（顶级路由 /search） ══ -->
    <view v-if="variant === 'B'" class="absolute inset-0 bg-surface flex flex-col">
      <!-- 顶栏：返回 + 输入 + 清除 -->
      <view class="flex flex-row items-center gap-2 px-4 h-[13vw] flex-shrink-0">
        <view class="w-[8vw] h-[8vw] flex items-center justify-center flex-shrink-0" @tap="showToast('返回 → 上一页')">
          <text class="text-[5.5vw] text-surface-on">‹</text>
        </view>
        <input
          v-model="keyword"
          class="flex-1 h-[11.2vw] box-border bg-surface-container-highest rounded-[var(--md-shape-full)] text-body-medium text-surface-on px-5"
          placeholder="输入标签，空格/回车添加"
          placeholder-color="#49454f"
        />
        <view v-if="keyword" class="w-[8vw] h-[8vw] flex items-center justify-center flex-shrink-0" @tap="keyword = ''">
          <text class="text-[5.5vw] text-surface-on-variant">×</text>
        </view>
      </view>

      <text class="text-body-small text-surface-on-variant px-5">searchIllust / searchNovel + next_url 分页（webview 蓝本同款 API）</text>

      <!-- scope 段 + sort 段 -->
      <view class="flex flex-row gap-2 px-5 mt-3 flex-shrink-0">
        <view
          v-for="s in SCOPE_SEGMENTS"
          :key="s[0]"
          class="h-[10.667vw] px-4 rounded-[var(--md-shape-full)] flex items-center"
          :class="scope === s[0] ? 'bg-secondary-container' : 'bg-surface-container-high'"
          @tap="scope = s[0]"
        >
          <text class="text-body-small" :class="scope === s[0] ? 'text-secondary-on-container' : 'text-surface-on-variant'">{{ s[1] }}</text>
        </view>
      </view>
      <view class="flex flex-row gap-2 px-5 mt-2 flex-shrink-0">
        <view
          v-for="s in SORT_SEGMENTS"
          :key="s[0]"
          class="h-[10.667vw] px-4 rounded-[var(--md-shape-full)] border border-outline-variant flex items-center"
          :class="sort === s[0] ? 'bg-primary-container' : 'bg-transparent'"
          @tap="sort = s[0]"
        >
          <text class="text-label-medium" :class="sort === s[0] ? 'text-primary-on-container' : 'text-surface-on-variant'">{{ s[1] }}</text>
        </view>
      </view>

      <!-- 结果网格（2 列 flex-wrap） -->
      <scroll-view class="flex-1 mt-3">
        <view class="flex flex-row flex-wrap px-2">
          <view
            v-for="(r, idx) in gridItems"
            :key="String(r.id)"
            class="w-[48%] m-[1%] rounded-[var(--md-shape-medium)] overflow-hidden shadow-[var(--md-elevation-1)]"
            @tap="showToast(`跳转 → 作品 #${r.id}`)"
          >
            <view class="w-full h-[44vw] rounded-t-[var(--md-shape-medium)]" :class="thumbClass(idx)" />
            <view class="bg-surface-container-high px-3 py-2">
              <text class="text-body-small text-surface-on block" style="word-break: break-all">{{ r.title }}</text>
              <text class="text-body-small text-surface-on-variant block mt-1">{{ r.author }}</text>
            </view>
          </view>
        </view>
        <text v-if="scope === 'novel'" class="text-body-medium text-outline px-5 py-4 block">
          小说结果改为列表/横滑卡（本变体仅演示插画网格；小说可横向分页）
        </text>
        <text class="text-body-small text-outline text-center block py-6">已加载全部 · 模拟 {{ gridItems.length }} 条</text>
      </scroll-view>
    </view>

    <!-- ══ 变体 C：半屏速览（spotlight）—— 顶部 60vh 浮层 ══ -->
    <view
      v-if="variant === 'C' && openC"
      class="absolute top-0 left-0 right-0 h-[60vh] bg-surface-container-lowest shadow-[var(--md-elevation-3)] flex flex-col"
    >
      <!-- 大搜索框（聚焦态）+ 关闭 -->
      <view class="flex flex-row items-center gap-2 px-4 h-[13vw] flex-shrink-0">
        <text class="text-[6vw] text-surface-on-variant">🔍</text>
        <input
          v-model="keyword"
          class="flex-1 h-[11.2vw] box-border bg-surface-container-highest rounded-[var(--md-shape-full)] text-body-large text-surface-on px-5"
          placeholder="即输即搜…"
          placeholder-color="#49454f"
        />
        <view class="w-[8vw] h-[8vw] flex items-center justify-center flex-shrink-0" @tap="openC = false">
          <text class="text-[5.5vw] text-surface-on-variant">×</text>
        </view>
      </view>

      <!-- 空关键词：历史 + 热门 -->
      <template v-if="!keyword.trim()">
        <text class="text-label-large text-surface-on px-5 mt-2 mb-2">搜索历史</text>
        <view class="flex flex-row gap-2 px-5 flex-shrink-0">
          <view
            v-for="w in HISTORY"
            :key="w"
            class="h-[10.667vw] px-4 bg-surface-container-high rounded-[var(--md-shape-full)] flex items-center"
            @tap="keyword = w"
          >
            <text class="text-body-small text-surface-on">{{ w }}</text>
          </view>
        </view>
        <text class="text-label-large text-surface-on px-5 mt-4 mb-2">热门搜索</text>
        <view class="flex flex-row gap-2 px-5 flex-shrink-0">
          <view
            v-for="w in HOT_WORDS"
            :key="w"
            class="h-[10.667vw] px-4 bg-secondary-container rounded-[var(--md-shape-full)] flex items-center"
            @tap="keyword = w"
          >
            <text class="text-body-small text-secondary-on-container">{{ w }}</text>
          </view>
        </view>
      </template>

      <!-- 有关键词：联想行 + 即时混合结果（即点即走） -->
      <template v-else>
        <view
          v-if="mixedResults.length > 0"
          class="h-[10.667vw] mx-5 mb-2 rounded-[var(--md-shape-full)] bg-surface-container-high flex items-center px-4 flex-shrink-0"
          @tap="showToast(`查看「${keyword}」全部结果`)"
        >
          <text class="text-body-small text-primary-on-container">搜索「{{ keyword }}」… 共 {{ mixedResults.length }} 条 ›</text>
        </view>
        <list v-if="mixedResults.length > 0" class="flex-1 min-h-0" list-type="single" scroll-orientation="vertical">
          <list-item v-for="(r, idx) in mixedResults" :key="String(r.id)" :item-key="String(r.id)" class="w-full">
            <view class="flex flex-row items-center px-5 py-2" @tap="pickResult(r.id, r.kind)">
              <view class="w-[11vw] h-[11vw] rounded-[var(--md-shape-small)] flex-shrink-0" :class="thumbClass(idx)" />
              <view class="flex-1 ml-3 min-w-0">
                <text class="text-body-medium text-surface-on block" style="word-break: break-all">{{ r.title }}</text>
                <text class="text-body-small text-surface-on-variant block mt-1">{{ r.author }} · {{ r.sub }}</text>
              </view>
              <text class="text-[3.2vw] text-surface-on-variant flex-shrink-0">{{ r.kind === 'novel' ? '📖' : '🖼' }}</text>
            </view>
          </list-item>
        </list>
        <text v-else class="text-body-medium text-outline text-center mt-8 flex-1">换个关键词试试</text>
      </template>
    </view>

    <!-- ══ 切换条（高对比浮动条，仅原型页可见；DOM 末尾保证盖过弹层） ══ -->
    <view class="absolute" style="left: 5vw; bottom: 4vw; width: 90vw">
      <view class="h-[12vw] bg-inverse-surface rounded-[var(--md-shape-full)] px-3 flex items-center justify-center shadow-[var(--md-elevation-3)] flex-shrink-0">
        <text class="text-label-medium text-inverse-on-surface mr-3 flex-shrink-0">🔬 原型</text>
        <view
          v-for="v in VARIANTS"
          :key="v"
          class="h-[9.6vw] px-3 rounded-[var(--md-shape-full)] flex items-center mr-1 flex-shrink-0"
          :class="variant === v ? 'bg-inverse-on-surface' : ''"
          @tap="setVariant(v)"
        >
          <text class="text-label-medium flex-shrink-0" :class="variant === v ? 'text-inverse-surface' : 'text-inverse-on-surface'">
            {{ v }} · {{ VARIANT_LABELS[v] }}
          </text>
        </view>
      </view>
    </view>

    <!-- toast（模拟跳转反馈；仿 App.vue exitHint 胶囊定位） -->
    <view v-if="toast" class="absolute" style="left: 50vw; bottom: 12vw; transform: translate(-50%, 0)">
      <view class="h-[12.8vw] bg-inverse-surface rounded-[var(--md-shape-extra-small)] px-5 flex items-center shadow-[var(--md-elevation-3)]">
        <text class="text-base text-inverse-on-surface">{{ toast }}</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
// ─── 配色原型（throwaway）───
// 问题：「app-lynx 的 M3 配色（种子 #6750A4 紫）与项目 logo（蓝色画笔）不搭」。
// 三个/五个候选色板？→ 5 个：0=当前紫（对照），A/B/C/D 四套蓝色系。
// 切换：?variant=0|A|B|C|D（底部浮动条点击 / 键盘 ←→）。
// 说明：颜色全部走真实 Tailwind/M3 语义类（bg-primary / text-surface-on / …），
// 尺寸用 px 固定在 390px 手机框内——app-lynx 的 spacing/fontSize 是 vw/rpx（视口相对），
// 桌面浏览器下会失真，故本原型只借真实「颜色类」，尺寸另行固定。
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { BASE_VARS, PALETTES } from './palettes'

const KEYS = PALETTES.map((p) => p.key)

/** web-core 预览在 worker 里执行，`window` 可能不可用——浏览器 API 一律守卫。
 *  可用时支持 ?variant= 深链；不可用时用底部浮动条切换（默认 A）。 */
function hasWindow(): boolean {
  return typeof window !== 'undefined' && !!window
}
function readVariant(): string {
  if (!hasWindow()) return 'A'
  const v = new URLSearchParams(window.location.search).get('variant')
  return v && KEYS.includes(v) ? v : 'A'
}

const variant = ref(readVariant())
const current = computed(() => PALETTES.find((p) => p.key === variant.value) ?? PALETTES[1])
const cssVars = computed<Record<string, string>>(() => ({ ...BASE_VARS, ...current.value.vars }))

function select(next: string) {
  if (!KEYS.includes(next)) return
  variant.value = next
  if (!hasWindow()) return
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('variant', next)
    window.history.replaceState(null, '', url.toString())
  } catch {
    /* ignore */
  }
}
function step(delta: number) {
  const i = KEYS.indexOf(variant.value)
  select(KEYS[(i + delta + KEYS.length) % KEYS.length])
}
function prev() {
  step(-1)
}
function next() {
  step(1)
}
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.key === 'ArrowLeft') prev()
  else if (e.key === 'ArrowRight') next()
}
onMounted(() => {
  if (hasWindow()) window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  if (hasWindow()) window.removeEventListener('keydown', onKey)
})

const LOGO_SVG =
  '<svg viewBox="0 0 192 192" xmlns="http://www.w3.org/2000/svg">' +
  '<rect x="12" y="12" width="168" height="168" rx="44" fill="#ffffff"/>' +
  '<svg x="36" y="36" width="120" height="120" viewBox="0 0 64 64">' +
  '<path d="M18 12 C18 12 16 28 19 52 C19 52 22 54 24 50 C26 47 24 39 26 33 C26 33 37 35 45 27 C51 21 47 13 38 11 C31 9 24 12 18 12 Z" fill="#2b579a"/>' +
  '<path d="M22 16 C22 16 21 28 23 46" fill="none" stroke="#5a9fd4" stroke-width="3" stroke-linecap="round"/>' +
  '<circle cx="42" cy="19" r="2" fill="#7ab8e8"/><circle cx="46" cy="25" r="1.5" fill="#7ab8e8"/>' +
  '</svg></svg>'
const logoUri = `data:image/svg+xml,${encodeURIComponent(LOGO_SVG)}`
</script>

<template>
  <page class="Root" :style="cssVars">
    <view class="pt-page">
      <!-- 头部：logo + 说明 -->
      <view class="pt-head">
        <image class="pt-logo" :src="logoUri" />
        <view class="pt-head-text">
          <text class="pt-title">Pictelio · Lynx 配色原型</text>
          <text class="pt-sub">种子 {{ current.seed }} · {{ current.key }} {{ current.name }}</text>
        </view>
      </view>
      <text class="pt-note">{{ current.note }}</text>

      <!-- 色板速览 -->
      <view class="pt-swatches">
        <view v-for="(c, i) in current.swatches" :key="i" class="pt-swatch">
          <view class="pt-swatch-dot" :style="{ backgroundColor: c }" />
          <text class="pt-swatch-label">{{ c }}</text>
        </view>
      </view>

      <!-- 手机框：代表性界面 -->
      <view class="pt-phone bg-surface">
        <!-- 顶栏 -->
        <view class="pt-appbar bg-surface">
          <text class="pt-appbar-title text-surface-on">插画</text>
        </view>

        <!-- tabs -->
        <view class="pt-tabs bg-surface-container-lowest border-b-outline-variant">
          <view class="pt-tab">
            <text class="pt-tab-text text-primary">推荐</text>
            <view class="pt-tab-bar bg-primary" />
          </view>
          <view class="pt-tab">
            <text class="pt-tab-text text-outline">关注</text>
          </view>
        </view>

        <!-- 插画瀑布（2 列卡） -->
        <view class="pt-grid bg-surface">
          <view v-for="n in 2" :key="n" class="pt-card bg-surface-container-lowest">
            <view class="pt-img shimmer" />
            <text class="pt-card-title text-surface-on">某张插画作品标题</text>
            <text class="pt-card-user text-surface-on-variant">user_name</text>
            <view class="pt-card-foot">
              <text class="pt-heart text-primary">♥</text>
              <text class="pt-card-user text-surface-on-variant">1403</text>
            </view>
          </view>
        </view>

        <!-- 小说卡（含标签胶囊） -->
        <view class="pt-novel bg-surface-container-lowest">
          <text class="pt-novel-title text-surface-on">转生后我在异世界开书店</text>
          <text class="pt-card-user text-surface-on-variant">by 作者名</text>
          <view class="pt-tagrow">
            <view v-for="(t, i) in ['异世界', '日常', '治愈', '书']" :key="i" class="pt-tag bg-secondary-container">
              <text class="pt-tagtext text-secondary-on-container">{{ t }}</text>
            </view>
          </view>
          <view class="pt-card-foot">
            <text class="pt-card-user text-tertiary">共 12 话</text>
            <text class="pt-card-user text-surface-on-variant">♥ 299</text>
          </view>
        </view>

        <!-- 按钮 / chips -->
        <view class="pt-buttons">
          <view class="pt-btn bg-primary"><text class="pt-btn-text text-primary-on">主要按钮</text></view>
          <view class="pt-btn bg-secondary-container"><text class="pt-btn-text text-secondary-on-container">次要</text></view>
          <view class="pt-btn pt-btn-outline border-outline"><text class="pt-btn-text text-primary">描边</text></view>
          <view class="pt-btn pt-btn-text"><text class="pt-btn-text text-primary">文字</text></view>
        </view>

        <!-- FAB / 状态色 -->
        <view class="pt-row">
          <view class="pt-fab bg-primary-container"><text class="pt-fab-icon text-primary-on-container">✦</text></view>
          <view class="pt-fab pt-fab-sm bg-secondary-container"><text class="pt-fab-icon text-secondary-on-container">🔍</text></view>
          <view class="pt-fab pt-fab-sm bg-error-container"><text class="pt-fab-icon text-error-on-container">R-18</text></view>
          <view class="pt-switch pt-switch-on bg-primary"><view class="pt-knob" /></view>
          <text class="pt-card-user text-surface-on-variant">R-18 开关</text>
        </view>

        <!-- 搜索弹层 mock -->
        <view class="pt-sheet bg-surface-container-lowest">
          <text class="pt-sheet-title text-surface-on">搜索</text>
          <view class="pt-input bg-surface-container-highest">
            <text class="pt-input-text text-surface-on-variant">输入标签 / 关键词</text>
          </view>
          <view class="pt-tagrow">
            <view class="pt-scope bg-secondary-container"><text class="pt-tagtext text-secondary-on-container">全部</text></view>
            <view class="pt-scope bg-surface-container-high"><text class="pt-tagtext text-surface-on-variant">插画</text></view>
            <view class="pt-scope bg-surface-container-high"><text class="pt-tagtext text-surface-on-variant">小说</text></view>
          </view>
          <view class="pt-result">
            <view class="pt-thumb bg-surface-container-highest" />
            <view class="pt-result-text">
              <text class="pt-card-title text-surface-on">搜索结果标题</text>
              <text class="pt-card-user text-surface-on-variant">作者 · 插画</text>
            </view>
          </view>
        </view>

        <!-- 评论行 -->
        <view class="pt-comment">
          <view class="pt-avatar bg-surface-container-high" />
          <view class="pt-result-text">
            <text class="pt-card-user text-surface-on-variant">评论者</text>
            <text class="pt-comment-text text-surface-on">这个配色跟 logo 搭多了</text>
          </view>
        </view>

        <!-- 骨架 + 空态 -->
        <view class="pt-skeleton">
          <view class="pt-skel-img shimmer" />
          <view class="pt-skel-lines">
            <view class="pt-skel-line shimmer" style="width: 75%" />
            <view class="pt-skel-line shimmer" style="width: 45%" />
          </view>
        </view>
      </view>

      <text class="pt-tip">提示：键盘 ← → 或底部箭头切换；?variant=0|A|B|C|D</text>
    </view>

    <!-- 浮动切换条（明显不属于被评估的界面） -->
    <view class="pt-bar bg-inverse-surface">
      <view class="pt-arrow" @tap="prev"><text class="pt-arrow-text text-inverse-on-surface">‹</text></view>
      <text class="pt-bar-label text-inverse-on-surface">{{ current.key }} · {{ current.name }}</text>
      <view class="pt-arrow" @tap="next"><text class="pt-arrow-text text-inverse-on-surface">›</text></view>
    </view>
  </page>
</template>

<style>
.pt-page { min-height: 100vh; padding: 24px 16px 96px; background: #f3f3f3; display: flex; flex-direction: column; align-items: center; }
.pt-head { display: flex; flex-direction: row; align-items: center; gap: 12px; width: 390px; max-width: 100%; }
.pt-logo { width: 44px; height: 44px; }
.pt-head-text { display: flex; flex-direction: column; }
.pt-title { font-size: 16px; font-weight: 600; color: #1a1a1a; }
.pt-sub { font-size: 12px; color: #555; margin-top: 2px; }
.pt-note { width: 390px; max-width: 100%; font-size: 12px; color: #555; margin-top: 10px; }
.pt-swatches { display: flex; flex-direction: row; gap: 10px; width: 390px; max-width: 100%; margin: 10px 0 6px; }
.pt-swatch { display: flex; flex-direction: row; align-items: center; gap: 6px; }
.pt-swatch-dot { width: 16px; height: 16px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.12); }
.pt-swatch-label { font-size: 11px; color: #333; }

/* 手机框（390px；尺寸用 px，颜色用真实 M3 语义类） */
.pt-phone { width: 390px; max-width: 100%; border-radius: 18px; overflow: hidden; box-shadow: 0 4px 18px rgba(0,0,0,0.14); margin-top: 12px; padding-bottom: 12px; }
.pt-appbar { height: 64px; display: flex; align-items: center; justify-content: center; }
.pt-appbar-title { font-size: 22px; font-weight: 500; }
.pt-tabs { display: flex; flex-direction: row; border-bottom-width: 1px; border-bottom-style: solid; }
.pt-tab { flex: 1; height: 48px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.pt-tab-text { font-size: 14px; font-weight: 500; }
.pt-tab-bar { height: 3px; width: 100%; margin-top: 6px; border-radius: 2px; }
.pt-grid { display: flex; flex-direction: row; flex-wrap: wrap; gap: 6px; padding: 6px; }
.pt-card { width: 186px; border-radius: 12px; overflow: hidden; padding-bottom: 8px; box-shadow: var(--md-elevation-1); }
.pt-img { width: 186px; height: 186px; background: var(--md-surface-container-high); }
.pt-card-title { font-size: 14px; font-weight: 500; margin: 8px 10px 0; }
.pt-card-user { font-size: 12px; margin: 4px 10px 0; }
.pt-card-foot { display: flex; flex-direction: row; align-items: center; gap: 4px; margin: 6px 10px 0; }
.pt-heart { font-size: 13px; }
.pt-novel { margin: 10px; border-radius: 12px; padding: 14px; box-shadow: var(--md-elevation-1); }
.pt-novel-title { font-size: 16px; font-weight: 500; }
.pt-tagrow { display: flex; flex-direction: row; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.pt-tag { padding: 4px 10px; border-radius: 999px; }
.pt-tagtext { font-size: 12px; }
.pt-buttons { display: flex; flex-direction: row; flex-wrap: wrap; gap: 8px; padding: 10px; }
.pt-btn { height: 40px; padding: 0 16px; border-radius: 999px; display: flex; align-items: center; justify-content: center; }
.pt-btn-outline { border-width: 1px; border-style: solid; }
.pt-btn-text { padding: 0 6px; }
.pt-btn-text { font-size: 14px; font-weight: 500; }
.pt-row { display: flex; flex-direction: row; align-items: center; gap: 10px; padding: 4px 14px 10px; }
.pt-fab { width: 56px; height: 56px; border-radius: 16px; display: flex; align-items: center; justify-content: center; }
.pt-fab-sm { width: 40px; height: 40px; border-radius: 12px; }
.pt-fab-icon { font-size: 16px; }
.pt-switch { width: 44px; height: 24px; border-radius: 999px; padding: 3px; display: flex; flex-direction: row; justify-content: flex-end; }
.pt-knob { width: 18px; height: 18px; border-radius: 50%; background: #fff; }
.pt-sheet { margin: 0 10px 10px; border-radius: 16px; padding: 12px; box-shadow: var(--md-elevation-2); }
.pt-sheet-title { font-size: 18px; font-weight: 500; text-align: center; }
.pt-input { height: 40px; border-radius: 999px; display: flex; align-items: center; padding: 0 14px; margin-top: 10px; }
.pt-input-text { font-size: 13px; }
.pt-scope { padding: 5px 12px; border-radius: 999px; }
.pt-result { display: flex; flex-direction: row; align-items: center; gap: 10px; margin-top: 12px; }
.pt-thumb { width: 48px; height: 48px; border-radius: 8px; }
.pt-result-text { display: flex; flex-direction: column; }
.pt-comment { display: flex; flex-direction: row; align-items: flex-start; gap: 10px; padding: 12px 14px; }
.pt-avatar { width: 32px; height: 32px; border-radius: 50%; }
.pt-comment-text { font-size: 14px; margin-top: 4px; }
.pt-skeleton { display: flex; flex-direction: row; gap: 10px; padding: 10px 14px; }
.pt-skel-img { width: 56px; height: 56px; border-radius: 10px; background: var(--md-surface-container-high); }
.pt-skel-lines { flex: 1; display: flex; flex-direction: column; gap: 8px; justify-content: center; }
.pt-skel-line { height: 12px; border-radius: 6px; background: var(--md-surface-container-high); }
.pt-tip { font-size: 11px; color: #777; margin-top: 12px; }

.pt-bar { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; flex-direction: row; align-items: center; gap: 12px; padding: 6px 10px; border-radius: 999px; box-shadow: 0 4px 14px rgba(0,0,0,0.3); z-index: 9999; }
.pt-arrow { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.pt-arrow-text { font-size: 22px; line-height: 1; }
.pt-bar-label { font-size: 13px; font-weight: 500; min-width: 130px; text-align: center; }
</style>

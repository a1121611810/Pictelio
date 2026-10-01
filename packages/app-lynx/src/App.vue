<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterView } from 'vue-router'
import { initRouter, exitHint } from './router'
import GlobalFab from './components/GlobalFab.vue'
import SearchSheet from './components/SearchSheet.vue'
import { useUpdateStore } from './stores/updateStore'
import { useSearchSheetStore } from './stores/searchSheetStore'
import { useSettingsStore } from './stores/settingsStore'
import { useEngineFallbackStore } from './stores/engineFallbackStore'
import { t } from './i18n'
import { appearanceClasses } from './utils/appearanceClasses'
import { apiClient } from './api/client'
import { queryKeys } from './api/queryKeys'
import { useApiQuery } from './primitives/useApiQuery'
import { initSafeArea, safeBottom, safeTop } from './utils/safeArea'
import { useReducedMotion } from './composables/useReducedMotion'

const searchSheet = useSearchSheetStore()
// 主题色（外观）：根 <page> 追加 .theme-* 色板类，整树 CSS 变量换色（默认 sky = 无色板类）
const settings = useSettingsStore()
// 标签静音轻提示文案（ADR-0187 D5 + spec tag-mute 边界 #7）：载荷 kind 分流——
// muted = 「已静音 {name}」（落盘成功/集合已生效）；failed = 「静音未生效」（落盘失败）。
// store 不快照文案（载荷纯数据），文案经 t() 渲染。
function muteTagHintText(): string {
  const hint = settings.muteTagHint
  if (!hint) return ''
  return hint.kind === 'failed'
    ? t('muteTag.muteFailedHint')
    : t('muteTag.mutedHint', { name: hint.name })
}
// 引擎降级说明（ADR-0153）：WebView 不可用时原生写入一次性键，首帧消费后展示可关闭提示
const engineFallback = useEngineFallbackStore()

// T3 启动健康检查（ADR-0141 / T3 ticket）：
// - 替代 T1 spike 的裸 useQuery（用 T2 实施的 useApiQuery helper 包装）
// - 仅 dev 模式触发（__DEV__ 编译期门禁）
// - 验证 useApiQuery helper 在真实业务代码路径工作（generation-gate + signal 透传）
// - 失败不阻塞启动（query isLoading → isError 自动收尾，UI 无影响）
const health = useApiQuery<{ illusts: unknown[] }>({
  queryKey: queryKeys.illusts.recommended(),
  queryFn: ({ signal }) => apiClient.get<{ illusts: unknown[] }>(
    '/v2/illust/recommended',
    { limit: '1' },
    signal,
  ),
  enabled: __DEV__ && searchSheet.isOpen === false,
  staleTime: 60 * 1000,
  retry: false,
})
onMounted(() => {
  console.log(
    `[T3 useApiQuery] health: status=${health.status.value} isLoading=${health.isLoading.value} data=${health.data.value ? 'ok' : 'null'}`,
  )
})

onMounted(() => {
  void engineFallback.check()
  void initRouter()
  // 检查更新（仅自动检查，无手动入口）：启动延迟执行，发现新版本
  // 直接打开强制更新页（无中间提示层）
  useUpdateStore().runStartupUpdateCheck()
  // 系统栏安全区（spec docs/specs/lynx-systembars.md §4.2）：订阅 pictelioInsets +
  // 订阅后拉初值；Root padding-top/bottom 让系统栏区域染 surface 色（边到边基底）
  initSafeArea()
})

// ─── 减弱动效偏好（T03 / issue #851 验收 2「当前未处理的 3 个含动画组件全部接入」的第三家）───
// 本文件持有**全仓唯一的骨架屏 shimmer 动画**（下方 <style> 的 .shimmer），
// 而 .shimmer 是全局类、被 SkeletonCard / CoverImage / SkeletonNovel / CarouselSkeleton /
// 各列表页与弹层等 15+ 处消费（它们只写 class="shimmer …"，元素上没有可判定的共同钩子），
// 因此降级总闸只能落在**根 <page>**（全树唯一的公共祖先）。
//
// 为何走 CSS 变量而不是「根 page 挂降级类 + `.降级类 .shimmer { animation: none }`」：
// 根 <page> 的 :class 绑定被 T2 接线契约**逐字**锁定（tests/unit.test.ts:659 与
// tests/unit/utils/appearanceClasses.test.ts:312 断言 `:class="appearanceClasses(settings.themeColor, settings.resolvedDark)"`），
// 改成数组/拼接会同时打红他人 lane 的门禁；:style 是根元素上唯一没被断言锁定的通道
// （safeAreaJavaContract.test.ts 只断言 paddingTop: safeTop / paddingBottom: safeBottom 两个子串，仍满足）。
//
// 失败方向刻意选「fail-open」：变量未定义时 `.shimmer` 的 var() 回退到原声明
// （见 <style>），即门闸若在真机不生效也只是维持现状（骨架屏仍有 shimmer），
// 而不会让全站骨架屏集体失去动效。
// 「变量未定义」如今的真实含义 = tokens.css 没定义/没命中本变量（令牌表未加载）；
// 偏好关闭的常态路径**不再**靠回退：默认周期由 tokens.css 的 `--shimmer-motion` 给出
// （= --durationExtraLong4 1000ms，与同为无限转圈的 .fab-spin 同款），
// 回退实参退化为「令牌表没来时的最后一道兜底」。
const { animationStyle } = useReducedMotion()

/** 骨架屏动画闸门变量名：与下方 <style> 的 `animation: var(--shimmer-motion, …)` 逐字配对（单测锁） */
const SHIMMER_MOTION_VAR = '--shimmer-motion'

/** 根 <page> 内联样式：系统栏安全区内边距 + 骨架屏动画闸门（偏好开启 = animation: none）。 */
const rootStyle = computed<Record<string, string>>(() => ({
  paddingTop: safeTop.value + 'px',
  paddingBottom: safeBottom.value + 'px',
  // R2 关键帧降级：整条 animation 声明置 none（覆盖 infinite 循环），不是「放慢」
  ...(animationStyle.value ? { [SHIMMER_MOTION_VAR]: animationStyle.value } : {}),
}))
</script>

<template>
  <!-- 边到边基底（spec lynx-systembars D1/D2）：Root padding-top/bottom = 系统栏安全区，
       系统栏区域染 .Root 的 surface 色（=「状态栏着色」诉求的平台正确实现）；
       web-core 预览无 native → 恒 0，布局与历史形态等价 -->
  <page
    class="Root"
    :class="appearanceClasses(settings.themeColor, settings.resolvedDark)"
    :style="rootStyle"
  >
    <!-- [lynx:fix] 模板必须 PascalCase <RouterView>（kebab-case <router-view> 被
         vue-lynx 编译器当原生标签 → 空渲染/编译报错；ADR-0138 决策 8）。
         KeepAlive 缓存列表/静态页实例（ADR-0049）：详情返回列表不重载。
         详情页不在 include 白名单——按 :id 加载，缓存旧 id 实例会显示错误内容 -->
    <RouterView v-slot="{ Component }">
      <!-- 好P友列表（ADR-0193 D3 / #754 T7）进白名单：进用户主页返回不重挂载、不重发首载 -->
      <KeepAlive :include="['recommended', 'illusts', 'novels', 'me', 'ranking', 'mypixiv']">
        <component :is="Component" />
      </KeepAlive>
    </RouterView>
    <!-- 放射导航悬浮 FAB（ADR-0120）：全局单 FAB，外层=4 tab、内层=页动作；替换各页 NavigationBar 与自身 FAB -->
    <GlobalFab />
    <!-- 全局搜索弹层（ADR-0132 / glossary「弹层全局单例」）：全 App 只挂一份——
         开合经 searchSheetStore 全局单例（openSearch/closeSearch），各入口（FAB / 内环搜索项）
         打开的都是同一弹层，各页不各自 v-if；DOM 顺序在 GlobalFab 之后（同层 z-40 后序胜出）
         + 弹层根 view z-40 盖过页面内 z-30 分页 FAB（RefreshableList，review P1-1）；
         v-if 卸载 = 关闭即重置（keyword/结果清空，历史保留）。
         返回键：openSearch 时 store 已 registerModal(closeSearch)（ADR-0066 后进先出）。 -->
    <SearchSheet v-if="searchSheet.isOpen" />
    <!-- 引擎降级提示（ADR-0153）：整条可点关闭（原生 LynxView hit-testing 不识别
         pointer-events，胶囊定位而非全宽盒——ADR-0123；点条即 dismiss） -->
    <view
      v-if="engineFallback.notice"
      class="absolute z-50"
      style="left: 50vw; top: 20vw; transform: translate(-50%, 0)"
      @click="engineFallback.dismiss()"
    >
      <view class="bg-surface-container-high rounded-[var(--md-shape-medium)] px-5 py-4 shadow-[var(--md-elevation-3)]">
        <text class="text-body-medium text-surface-on">{{ t('engineFallback.legacyBanner') }}</text>
      </view>
    </view>
    <!-- 系统返回根路由提示（ADR-0066）：与 webview client 的 exitHint toast 语义一致。
         M3 snackbar 形态：inverse-surface 底 + inverse-on-surface 文字 + 4dp 圆角。
         [lynx:fix] 无全宽盒（ADR-0123）：原生 LynxView hit-testing 不识别 pointer-events，
         全宽 `left-0 right-0` 容器会吞底部整条点击（含 FAB 区域）；改为胶囊居中定位，
         命中面只剩提示条自身，双端行为一致、不依赖 pointer-events。 -->
    <view v-if="exitHint" class="absolute z-50" style="left: 50vw; bottom: 12vw; transform: translate(-50%, 0)">
      <view class="h-[12.8vw] bg-inverse-surface rounded-[var(--md-shape-extra-small)] px-5 flex items-center shadow-[var(--md-elevation-3)]">
        <text class="text-base text-inverse-on-surface">再按一次退出应用</text>
      </view>
    </view>
    <!-- 标签静音轻提示（ADR-0187 D5 / #732 + spec tag-mute 边界 #7）：与 exitHint 同形态
         （M3 snackbar：inverse-surface 底 + 胶囊居中定位，ADR-0123 无全宽盒）；载荷 =
         settings.muteTagHint（{kind,name} 纯数据，落盘成功/失败分流文案，2s 自动清除在
         store 内），文案经 t() 渲染（store 不快照文案，webview MuteTagHint 同语义） -->
    <view v-if="settings.muteTagHint" class="absolute z-50" style="left: 50vw; bottom: 12vw; transform: translate(-50%, 0)">
      <view class="h-[12.8vw] bg-inverse-surface rounded-[var(--md-shape-extra-small)] px-5 flex items-center shadow-[var(--md-elevation-3)]">
        <text class="text-base text-inverse-on-surface">{{ muteTagHintText() }}</text>
      </view>
    </view>
  </page>
</template>

<style>
@import './styles/tokens.css';
/* 图标字体：base64 内联的 @font-face（scripts/generate-icon-subset.py 生成，勿手改）。
   必须内联而非 url('./xxx.ttf')——Lynx 的 @font-face url() 只吃远程地址与 base64，
   打包器改写出的 webpack:/// 路径原生端不解析 ⇒ 全站图标豆腐块 ⊠（真机实证）。 */
@import './styles/icon-font.css';

.Root {
  width: 100%;
  height: 100%;
  background-color: var(--md-surface);
}

/* ─── shimmer 骨架屏（数据加载前的占位动画） ───
 * web-core 实测支持 linear-gradient + @keyframes（浏览器渲染）；
 * 原生 LynxView：keyframes 动画已实证支持（ADR-0108：LynxKeyframeAnimator + TransformProps，
 * FAB 旋转动画模拟器验证通过 2026-08-24）；linear-gradient 背景静态渲染已见（骨架屏原生显示），
 * background-position 动画行为未单独实证。
 * 用法：元素加 class="shimmer"（配合尺寸类如 aspect-[1/1]、h-[28rpx]）。 */
@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
/* 骨架屏动画闸门（--shimmer-motion）：根 <page> 在「减弱动效」偏好开启时经内联 :style 注入
   none（useReducedMotion 的 R2 = 整条 animation 置 none，含 infinite 循环），本树内所有
   .shimmer 随之停摆。变量名与 App.vue 脚本内 SHIMMER_MOTION_VAR 配对（单测锁一致性）。

   默认值现由 tokens.css 的 `--shimmer-motion` 给出，且必须是**整条 animation 简写**而非
   纯时长（简写只给时长会丢掉 animation-name ⇒ 取 none ⇒ 不播），周期 = --durationExtraLong4
   1000ms。下方回退实参里的 `1.5s` 因此**只在令牌表缺席时**生效，是门闸的 fail-open 兜底。
   1000ms 与 1.5s 周期不一致是**有登记的已知偏差**（motionDurationTokens.template.test.ts 的
   LITERAL_EXCEPTIONS）：回退实参被 src/shimmerGate.test.ts:61 与 useReducedMotion.test.ts:450
   逐字锁死（裸 var() 或换周期都要先改那两处门禁），而「骨架屏该多快」是产品决策，
   不该由一次令牌化顺手改掉。

   ⚠️ 「变量未定义时回退到原声明」这句以前是**推断**，本轮 code-review 指出它可能是假的：
   若 Lynx 支持 `var()` 却不支持回退实参，变量未定义时整条 animation 会落入
   invalid-at-computed-value-time ⇒ 取初始值 `none` ⇒ **全站 79 处骨架屏同时消失**；
   而该变量只在偏好**开启**时注入 ⇒ 受害者是**所有**用户，不是只有减弱动效用户。

   **真机实测已排除该风险**（2026-09-30，pictelio_ui / API 34 / 1080×2160）：
   冷启动连拍 8 帧、间隔 260ms，限内容区裁掉状态栏时钟后逐像素比对
   （阈值 |Δ|>6）：
     骨架期  frame1↔2 47.84%   frame1↔4 43.27%   frame1↔5  5.15%   ← 在动
     阴性对照 frame6↔7  0.00%（内容已加载完，静止）                    ← 探针能分辨「动/不动」
   拍摄时偏好为关闭（`--shimmer-motion` **未定义**，当时令牌表尚未给出默认值），shimmer 照常播放
   ⇒ Lynx 的 `animation` 简写**确实解析 `var()` 的回退实参**，上面那条推断不成立。
   （该结论今天仍然承重：令牌表缺席时走的正是这条回退路径。）

   注：frame1↔3 为 0.00%，是回退生效时的 1.5s 周期下采样点偶然同相位，不是「动画停了」——
   同批的 47.84% / 43.27% 已证明它在动。 */
.shimmer {
  background: linear-gradient(
    90deg,
    var(--md-surface-container-high) 25%,
    var(--md-surface-container-lowest) 50%,
    var(--md-surface-container-high) 75%
  );
  background-size: 200% 100%;
  animation: var(--shimmer-motion, shimmer 1.5s linear infinite);
}
</style>

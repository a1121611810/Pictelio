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
import { useRouteTransition } from './composables/routeTransition'

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

// ─── 路由转场（ADR-0211 决策 6 / issue #880）───
// Lynx 侧无路由 transition 能力 ⇒ 转场自建于**导航层**：方向由 router.ts 的 afterEach 写入
// composables/routeTransition.ts 的模块状态，本页容器按状态挂一次性入场动画
// （时长/曲线来自 composables/motion.ts，本文件不写任何时长/曲线字面量）。
//
// 为什么落点是这里（零逐页改动）：`.Root` 是全树唯一的页面公共祖先，
// 而 24 条路由的页面组件各自根节点类名/结构不同，改逐页挂类要么漏页要么改抽象边界。
// 包裹层是**在流内**的 `w-full h-full` 块：`.Root` 非 flex，故包裹层与页面根节点同盒，
// 静息态布局与改动前逐像素一致（真机截图对拍核验，2026-10-01）。
//
// ⚠️ **transform 会让本包裹层成为 `position:absolute` 后代的包含块**：入场动画播放的那
//   ROUTE_TRANSITION_HOLD_MS 窗口内，页内全屏层（评论弹层 / 删除确认 / loading 遮罩）的
//   包含块由视口收窄到内容盒（上下各差一个安全区）。该窗口内不可能有全屏层打开
//   （全屏层只由页内 tap 打开，导航期间用户无从触发），且计时器到点即摘除 transform，
//   故不是持久布局变更。这是**已登记的取舍**，不是零成本。
const routeTransition = useRouteTransition()
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
      <!-- 路由转场容器（ADR-0211 决策 6 / #880）：包裹层持有「方向 + 阶段」，
           :style 走 inline 通道（Lynx 侧唯一无歧义的 transform 载体——transform 族
           Tailwind 工具类是死类名，ADR-0210 路径 E）。方向为 none / 减弱动效开启时
           style 是空对象 = 元素上不挂任何过渡声明（R1「不挂过渡类」的最强形态）。
           刻意不绑 :class —— 动效只有 inline animation 一条载体，没有类可挂。 -->
      <view class="w-full h-full" :style="routeTransition.style.value">
        <!-- 好P友列表（ADR-0193 D3 / #754 T7）进白名单：进用户主页返回不重挂载、不重发首载 -->
        <KeepAlive :include="['recommended', 'illusts', 'novels', 'me', 'ranking', 'mypixiv']">
          <component :is="Component" />
        </KeepAlive>
      </view>
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

/* ─── 路由转场帧体（ADR-0211 决策 6 / issue #880）───
 * 全仓**唯一定义方** = 本文件（方向名登记表在 composables/routeTransition.ts）。
 * 沿用本文件 shimmer 的既有形态：非 scoped <style> 里的 @keyframes 在 Lynx 原生全局生效
 * （2026-10-01 真机实证），消费方只写 animation 名，不需要 import 本组件。
 *
 * 方向语义（ADR-0211 决策 6 的方向表）：
 *   forward（进入更深层级）= 新页面**从右侧**滑入 + fade（平台约定：前进 = 内容右移）
 *   back（返回上层）        = 重新进入的旧页**从左侧**滑入
 *
 * ⚠️ **两者刻意不对称**（forward 带 opacity、back 纯位移）：若做成严格镜像就成了
 *   「同一段动画正放倒放」，#880 验收 1 明确不接受那种糊弄。
 *
 * ⚠️ **已登记的能力削减**（ADR-0211 决策 6 约束 2）：back 不是真实反向。Lynx 无
 *   transitionend（ADR-0111）可挂，且 vue-router 的 push/back 是硬替换——旧页在动画
 *   开始前已离开渲染树，所以旧页**没有滑出过程**，只给重新进入的旧页一个自左侧的滑入。
 *
 * ⚠️ `-alt` 变体帧体与本体逐字相同，不是冗余：同向连续两次导航时 animation-name 必须
 *   变化才会重播（同名 animation 在同一元素上不重放）；变体名切换是本仓已在用的重播形态
 *   （useSheetDismiss 的 sheet-enter ⇄ sheet-exit 即此机制）。
 *
 * ⚠️ 帧体里**只写 transform / opacity**；时长与曲线一律由 composables/motion.ts 的
 *   enter() 拼装后经 inline :style 下发（本文件不出现时长/曲线字面量）。
 * ⚠️ 位移走帧体内的手写 transform 声明（已实证）；**不写** Tailwind transform 工具类
 *   ——那些是死类名（产出规则但引用的 --tw-* 从未定义 ⇒ 渲染 transform: none，ADR-0210 路径 E）。
 *
 * ⚠️ 位移量 8% = M3 shared axis X 的 30dp：按 glossary-lynx-units 的 375 设计稿基准
 *   （30dp / 375 = 8%）。用 % 而非 vw：SheetShell 的 keyframes 帧体只实证过 % 与 px，
 *   vw 未取证 —— ADR-0210「未验证的路径要么取证后再用、要么不用」，不押注。 */
@keyframes route-forward-in {
  from {
    opacity: 0;
    transform: translateX(8%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
@keyframes route-forward-in-alt {
  from {
    opacity: 0;
    transform: translateX(8%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
/* back 只位移不淡入：与 forward 构成可辨识的方向差（见上方「刻意不对称」） */
@keyframes route-back-in {
  from {
    transform: translateX(-8%);
  }
  to {
    transform: translateX(0);
  }
}
@keyframes route-back-in-alt {
  from {
    transform: translateX(-8%);
  }
  to {
    transform: translateX(0);
  }
}
</style>

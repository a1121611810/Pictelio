<script setup lang="ts">
// RefreshableList —— 列表滚动操作容器（ADR-0107 刷新 FAB + ADR-0108 旋转动画 +
// ADR-0110 重建回顶 + ADR-0111 M3 FAB menu）。
//
// 接口（调用方需要知道的全部）：
//   :refresh      页面传入的幂等刷新函数（feed.refresh()+sync 或 fetchFirstPage）
//   :items        可选扩展菜单项（如「上一页/下一页」）：label/图标/visible 条件/回调，
//                 组件只渲染与维护菜单状态机（busy 互斥），不感知业务（T4）
//   @back-to-top  回顶项点击 → 页面应 bump 列表 :key 强制重建（重建即回顶，ADR-0110）
//   默认 slot     恰好一个可滚动子元素（<list>）；slot 暴露 scoped prop onScroll（已节流
//                 滚动信号回调，ADR-0135）：<template #default="{ onScroll }">
//                 <list :scroll-event-throttle="0" @scroll="onScroll" …>（throttle 必写 0，
//                 默认/100 零派发——ADR-0110 勘误）
//
// 页面用法（列表操作全部内收组件）：
//   <RefreshableList
//     :refresh="refreshFeed"
//     :items="[{ key: 'prev', icon: '‹', label: '上一页', accessibilityLabel: '上一页',
//                visible: () => feed.hasPrev(), onTap: () => feed.prev() }]"
//     @back-to-top="listKey++"
//   >
//     <template #default="{ onScroll }">
//       <list :key="listKey" :scroll-event-throttle="0" @scroll="onScroll" …>…</list>
//     </template>
//   </RefreshableList>
//
// 内部隐藏（页面零感知，禁止在页面重写）：
//   - 刷新：refreshing 内部态 + 防重入 guard + try/finally 复位 + FAB 旋转动画（ADR-0108）
//   - 回顶（ADR-0110）：点击「回顶」菜单项 → emit('back-to-top') → 页面 list :key 重建
//   - FAB menu（ADR-0111）：常态一个刷新 FAB；点击展开 scrim + 两项（刷新/回顶）；
//     主 FAB 变身为 close button；busy 时禁止展开。
//   - 滚动指示条（ADR-0135，公共层）：本组件唯一持有 useScrollIndicator + 渲染
//     ScrollIndicator（右缘竖条，锚点=本容器 relative——组件注释「位置锚点=父容器」）；
//     页面只消费 scoped prop onScroll，**禁止**在页面再实例化/渲染（spec：公共层上移）。
//     提示：普通父组件（未用 scoped prop）不受影响（slot props 可忽略，向后兼容）。
//
// 平台事实（模拟器实测 2026-08-24，禁止回退；② 已于 2026-09-02 勘误，见 ADR-0110/ADR-0135）：
//   ① SelectorQuery 对 XElement 节点静默不命中（ADR-0107）；
//   ② <list> 在 scroll-event-throttle="100" 时零派发（ADR-0110）；throttle="0"
//      时 @scroll 每帧 ~60Hz 派发（2026-09-02 真机实证，ADR-0135 滚动信号面）；
//   ③ <list> 无 JS 可触发的滚动属性 → 回顶 = 重建回顶。
//   ④ Lynx 无 transitionend → FAB menu 退出动画 v1 瞬撤（ADR-0111）。
import { computed, ref, onUnmounted } from 'vue'
import { createFabMenuState, type FabMenuExtraItem } from '../primitives/createFabMenu'
import { useScrollIndicator } from '../primitives/useScrollIndicator'
import { t } from '../i18n'
import { FAB_MENU_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { useReducedMotion } from '../composables/useReducedMotion'
import AppIcon from './AppIcon.vue'
import ScrollIndicator from './ScrollIndicator.vue'
import { useMotion } from '../composables/motion'

/** 按压反馈载体（ADR-0211 决策 2）：颜色状态层走工具类；透明度/尺寸类走 inline `:style`——`.transition-colors` 的 transition-property 不含 opacity，挂工具类是静默失效。
 *  时长与曲线一律取自 composables/motion.ts（唯一入口），本组件不写时长/曲线字面量；
 *  R1 降级（prefers-reduced-motion）由 useMotion 统一处理，组件内不自行判断偏好。 */
const { pressColor, pressOpacity } = useMotion()

/** FAB 菜单三项的入场（ADR-0211 决策 5 / issue 879）：**错峰延迟来自预设**，不再由本组件
 *  自定 0/60/120ms 三档字面量。`listItemStyle(i)` 已内建 R2 归零 + R3 延迟归零 +
 *  STAGGER_MAX_ITEMS 上限，与 10 个手写列表页共用同一出口 ⇒ 全仓列表错峰只有一处事实源。
 *  （该计数随新增 scroll-view 消费页变化，实测口径见 spec「入场动画的 fail-safe 契约」D1 与
 *  tests/listItemStaggerContract.test.ts 的目标页清单，不在本文件内自维护。）
 *  ⚠️ 帧体 `@keyframes item-rise` 仍定义在本文件下方的非 scoped `<style>`（几何量归调用方），
 *  本栈非 scoped keyframes 跨文件全局生效。 */
const { listItemStyle } = useMotion()


const props = defineProps<{
  /** 幂等刷新函数（createMixFeed 的 refresh() 内置 generation 竞态防护 + 15s TIMEOUT 保证 settle） */
  refresh: () => Promise<void> | void
  /** 可选扩展菜单项（T4）：组件只渲染 + busy 互斥，业务回调/显隐由页面提供 */
  items?: FabMenuExtraItem[]
  /** 是否渲染本组件自带 FAB menu（ADR-0120）。tab 页关掉（false）由全局放射 FAB 承接；非 tab 页默认 true */
  fab?: boolean
}>()

const emit = defineEmits<{ (e: 'back-to-top'): void }>()

// ─── FAB menu 状态机（ADR-0111）：open + busy 互斥，纯逻辑 seam
const menu = createFabMenuState()

// ─── 滚动指示条（ADR-0135 / spec #325 公共层）：本组件唯一持有者 ───
// 状态（top/height/visible）与 33ms 节流 / 500ms 淡出 timer 全部内收；
// scoped prop onScroll 透出给 slot 内 <list> 绑定（事件不冒泡、slot 父作用域编译——
// 公共层只能是「透出回调」而非「直接监听」，规范见组件头注释）。
const indicator = useScrollIndicator()

/** 刷新中：主 FAB 禁用态/旋转 + 防重入；与 menu.busy 同步 */
const refreshing = ref(false)

// ─── 减弱动效偏好（T03 / issue #851 验收 2）────────────────────────────────
// 资产清单：fab-spin（infinite 循环）+ scrim-in（遮罩淡入）+ 菜单项浮出（item-rise 帧体）。
// 降级口径 = composable 的 R2：animation 整条置 `none`（**不是**放慢）——fab-spin 是无限循环，
// 循环动画对前庭障碍影响最大，必须停；菜单项浮出虽是一次性，但其位移/缩放本身即「运动」，
// 降时长无效（R3 同理），故连同 stagger 延迟一起被 `none` 整条关掉。
//
// ⚠️ **本组件的降级分两条通道**（issue 879 / ADR-0211 决策 5 后）：
//   · scrim / fab-spin 仍绑 `motionStyle`（类名驱动，只能 inline 覆盖）；
//   · 菜单项三项改绑 `listItemStyle(i)`——它内部走 useMotion()，R2 置 none、
//     R3 延迟归零，**比原先更完整**（旧的 motionStyle 只能整条关，无法让延迟单独归零）。
// 两者最终都落到 `animation: none`，语义一致；`useReducedMotion` 仍是唯一偏好事实源。
//
// 为何用 inline 覆盖而不是「不挂类」：fab-spin / scrim-in 由本组件的全局 <style> 定义，
// 其中 .scrim-in 还被 GlobalFab 复用（那边已在 scrimStyle 里用同一手法 inline 覆盖），
// 保持单一手法；inline 优先级高于类，故偏好关闭时**完全不产生覆盖**，类里的原声明逐字保留。
const { animationStyle } = useReducedMotion()
const motionStyle = computed<Record<string, string>>(() => ({
  ...(animationStyle.value ? { animation: animationStyle.value } : {}),
}))

async function onRefreshItemTap() {
  if (refreshing.value || menu.isBusy) return
  menu.startRefresh()
  refreshing.value = true
  try {
    await props.refresh()
  } catch (err) {
    // 页面函数约定内部消化失败（createMixFeed 错误槽语义）；此处兜底防未处理 rejection
    console.warn('[RefreshableList] refresh 执行异常', err)
  } finally {
    refreshing.value = false
    menu.endRefresh()
  }
}

/** 主 FAB tap：展开/收起菜单（状态机内部处理 busy 互斥） */
function onFabTap() {
  menu.toggle()
}

/** 点 scrim 或点 close button 时收起 */
function onCloseMenu() {
  menu.close()
}

// ─── 回顶（ADR-0110）：防重入窗口内连点只重建一次
const BACK_TO_TOP_RESET_MS = 1000
const backToTopPending = ref(false)
let backToTopResetTimer: ReturnType<typeof setTimeout> | null = null
function clearBackToTopReset() {
  if (backToTopResetTimer !== null) {
    clearTimeout(backToTopResetTimer)
    backToTopResetTimer = null
  }
}
function onBackToTopItemTap() {
  if (backToTopPending.value) return
  menu.close()
  backToTopPending.value = true
  clearBackToTopReset()
  backToTopResetTimer = setTimeout(() => {
    backToTopResetTimer = null
    backToTopPending.value = false
  }, BACK_TO_TOP_RESET_MS)
  emit('back-to-top')
}

// ─── 扩展菜单项（T4）：点击后收起；返回 Promise 时复用 busy 维度（操作中禁展开/禁其他项，
//      与「刷新中」同一互斥规则——menu.busy=true 时 toggle()/open() no-op）
async function onExtraItemTap(item: FabMenuExtraItem) {
  if (refreshing.value || menu.isBusy) return
  menu.close()
  const result = item.onTap()
  if (result && typeof result.then === 'function') {
    menu.startRefresh() // 复用 busy 维度：异步操作期间 FAB 禁用、其他项不可点
    try {
      await result
    } catch (err) {
      // 页面函数约定内部消化失败（feed 错误槽语义）；此处兜底防未处理 rejection
      console.warn('[RefreshableList] 扩展菜单项执行异常', err)
    } finally {
      menu.endRefresh()
    }
  }
}
onUnmounted(() => {
  clearBackToTopReset()
  menu.reset()
})
</script>

<template>
  <!-- 容器 = 列表布局参与者（flex-1 min-h-0）+ FAB 定位上下文（relative）
       布局契约：slot 内 list 用 w-full h-full（相对本容器解析，V4 模拟器已验证） -->
  <view class="w-full flex-1 min-h-0 relative">
    <slot :on-scroll="indicator.onScroll" />

    <!-- 滚动指示条（ADR-0135，公共层）：右缘竖条，锚点=本容器 relative；opacity 显隐（禁 v-if） -->
    <ScrollIndicator
      :top-px="indicator.topPx.value"
      :height-px="indicator.heightPx.value"
      :visible="indicator.visible.value"
    />

    <!-- scrim：展开时覆盖列表，点空白收起。R2 下 .scrim-in 的 200ms 淡入整条关掉 -->
    <view
      v-if="menu.isOpen && props.fab !== false"
      class="absolute inset-0 z-10 bg-[var(--md-scrim)] scrim-in"
      :style="motionStyle"
      @tap="onCloseMenu"
    />

    <!-- FAB menu 面板：两项 pill 形 medium button（M3 官方规格） -->
    <view
      v-if="menu.isOpen && props.fab !== false"
      class="absolute z-20 right-4 bottom-[20.267vw] flex flex-col items-end gap-[1.067vw]"
    >
      <!-- 刷新项：图标（AppIcon refresh）+ label。
           ⚠️ 入场走 listItemStyle(0) 而非 .item-rise-1 类：错峰延迟必须来自 motion.ts 预设
           （ADR-0211 决策 5 / issue 879），而延迟随 index 变化，类名表达不了（运行时拼接则 JIT
           扫不到 ⇒ 产物零规则、渲染零动画、构建全绿）。R2 下返回 animation: none、
           R3 下延迟归零，覆盖等价于原 motionStyle。 -->
      <view
        class="menu-item flex items-center gap-[2.133vw] h-[10.667vw] pl-[4.267vw] pr-[6.4vw] rounded-full bg-surface-container-high shadow-[var(--md-elevation-2)] active:bg-layer-pressed-on-surface"
        :class="pressColor.className"
        :style="listItemStyle(0)"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="FAB_MENU_A11Y_LABELS.refreshList"
        @tap="onRefreshItemTap"
      >
        <AppIcon name="refresh" :size="4.8" class="text-on-surface-variant" />
        <text class="text-[3.733vw] leading-none text-on-surface">{{ t('refreshableList.refresh') }}</text>
      </view>

      <!-- 回顶项：图标（AppIcon arrow_upward）+ label -->
      <view
        class="menu-item flex items-center gap-[2.133vw] h-[10.667vw] pl-[4.267vw] pr-[6.4vw] rounded-full bg-surface-container-high shadow-[var(--md-elevation-2)] active:bg-layer-pressed-on-surface"
        :class="pressColor.className"
        :style="listItemStyle(1)"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="FAB_MENU_A11Y_LABELS.backToTop"
        @tap="onBackToTopItemTap"
      >
        <AppIcon name="arrow_upward" :size="4.8" class="text-on-surface-variant" />
        <text class="text-[3.733vw] leading-none text-on-surface">{{ t('refreshableList.backToTop') }}</text>
      </view>

      <!-- 扩展项（T4）：页面按需配置（上一页/下一页等），visible 控制显隐；
           listItemStyle(2) 共用同一条浮出帧体，错峰落在刷新/回顶之后，延迟由预设算。
           用 template v-for 包裹（v-if 与 v-for 同元素是 Vue 3 反模式） -->
      <template v-for="item in props.items" :key="item.key">
        <view
          v-if="item.visible()"
          class="menu-item flex items-center gap-[2.133vw] h-[10.667vw] pl-[4.267vw] pr-[6.4vw] rounded-full bg-surface-container-high shadow-[var(--md-elevation-2)] active:bg-layer-pressed-on-surface"
          :class="pressColor.className"
          :style="listItemStyle(2)"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="item.accessibilityLabel"
          @tap="onExtraItemTap(item)"
        >
          <!-- ⚠️ 这里**必须**是 <AppIcon>：FabMenuExtraItem.icon 的类型已从 string
               收成 IconName，若仍用普通 <text> 插值，页面上传的图标名（如 'search'）
               会被当**正文**渲染成字面量 "search" —— vue-tsc 抓不到（IconName 是
               string 子类型），无报错、无崩溃，纯静默视觉损坏。同 LATER_ICON 家族。 -->
          <AppIcon :name="item.icon" :size="4.8" class="text-on-surface-variant" />
          <text class="text-[3.733vw] leading-none text-on-surface">{{ item.label }}</text>
        </view>
      </template>
    </view>

    <!-- 主 FAB / close button（ADR-0111）：常态刷新 FAB，展开时变身为 close button
         56dp、primary-container、原位不动；busy 时禁用态 opacity 0.6
         ── 记账（0.6 为什么是字面量、为什么不接令牌）：
         ① **对不上状态层档位**：tokens.css 的四态 alpha 是 hover .08 / focus .12 /
            pressed .12 / dragged .16，禁用态是容器 .12 / 内容 .38，**没有 .6**。
         ② **语义也两样**：状态层是「容器色之上叠一层交互反馈 alpha」；本行是
            「连容器带图标一起压暗」的**非运动态** busy 指示 —— 承担
            `useReducedMotion.ts:18`（R2）承诺的「关掉动画后 busy 态仍可见」，
            属可感知性兜底，不是交互反馈。
         ③ **不接令牌是刻意的**：MD3 禁用态按**角色**分档（容器 12% / 内容 38%），
            单一 opacity 无从表达；改接 `--md-state-disabled-container` 或
            `-on-surface` 任一条都是**观感变更 + 取舍臆断**，不是治理。
         属 ADR-0111 存量写法，非本轮改动；改这里须连同 useReducedMotion 的 R2
         承诺一起复核。 -->
    <view
      v-if="props.fab !== false"
      class="absolute z-30 bottom-4 right-4 w-[14.933vw] h-[14.933vw] rounded-[var(--md-shape-large)] bg-primary-container active:opacity-80 flex items-center justify-center shadow-[var(--md-elevation-3)]"
      :class="pressColor.className"
      :style="{ ...pressOpacity, ...(refreshing || menu.isBusy) ? { opacity: 0.6 } : {} }"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="FAB_MENU_A11Y_LABELS.toggleMenu"
      @tap="onFabTap"
    >
      <!-- 旋转承载元素 = 包裹 view（text 元素 transform 支持性弱，ADR-0108 决策 2）
           仅在非展开态且刷新中时旋转；展开态图标为 AppIcon close，不旋转。
           R2：fab-spin 是 infinite 循环，偏好开启时 motionStyle 整条置 animation:none -->
      <view :class="refreshing && !menu.isOpen ? 'fab-spin' : ''" :style="motionStyle">
        <AppIcon :name="menu.isOpen ? 'close' : 'refresh'" class="text-primary-on-container" />
      </view>
    </view>
  </view>
</template>

<!-- 全局样式（与 App.vue shimmer 同机制，规避 scoped keyframes 在 Lynx 的未验证面）；
     类名 fab-spin / scrim-in / item-rise-* 全仓唯一。原生/web-core keyframes 已实证（ADR-0108） -->
<style>
@keyframes fab-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.fab-spin {
  /* 1000ms = M3 duration extra-long4。此前是字面量 `1s`，理由「令牌不存在」；
   * 该令牌已在 tokens.css 补齐（官方值来源见该处注释）。 */
  animation: fab-spin var(--durationExtraLong4) linear infinite;
}

/* scrim 淡入（ADR-0111）：展开动画 200ms = M3 short4 → 时长令牌（#854 验收 3） */
@keyframes scrim-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.scrim-in {
  animation: scrim-in var(--durationNormal) var(--motion-emphasized-decelerate) both;
}

/* menu item 从 FAB top-trailing edge 浮出（ADR-0111）。
   ⚠️ 帧体是**几何量**（travel 12px / scale 0.92）⇒ 归调用方组件（motion.ts 抬头约束
   「唯一入口只管时长与曲线」），故定义在此而非 motion.ts。
   ⚠️ 非 scoped ⇒ 本栈跨文件全局生效，10 个手写列表页无需 import 即可引用（与 SheetShell
   的 sheet-enter 同机制，真机已取证）。tests/listItemStaggerContract.test.ts 的 L3
   钉住「本文件是帧体唯一定义方」，防止第二个组件另起一条同义帧体。 */
/* ⚠️ `from` 态**不得**含 `opacity: 0`（#913 / spec D1，ADR-0211 失效方向已翻转）。
   原帧体 `from { opacity: 0; … }` + `fill-mode: both` ⇒ 元素「占位但不可见」：
   只要动画**没播**（冷挂载静态兄弟节点上引擎不启动入场动画，机理未定案），
   `both` 就会把 `from` 态**长期驻留** ⇒ 整段 UI 永久不可见，且无日志、无报错、单测全绿。
   ⚠️ 单独把 `both` 改成 `none` **不能**救回（已实测），故不能只治填充模式。
   ⇒ D1 契约「动效可改变内容**如何**出现，不可改变内容**是否**出现」：
     帧体只动**几何**（位移/缩放），`from` 态始终是**可见**的 ——
     于是动画播不播、填充驻不驻留，元素都占位可见，差别只在有没有滑入过程。 */
@keyframes item-rise {
  from {
    /* 可见性中性：起始即不透明。0.001 等「几乎不可见」的折中值同样禁止
       （它只在正常播放时看起来像淡入，动画不播时仍是空卡片）。 */
    opacity: 1;
    transform: translateY(12px) scale(0.92);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
.menu-item {
  transform-origin: right bottom;
}
/* 延迟槽**不再**在 CSS 里：原 `.item-rise-1/2/extra` 三档把 0/60/120ms 写死，
   那正是「错峰延迟由组件自定」的形态（ADR-0211 决策 5 要收口的那一处）。
   现统一走 motion.ts 的 listItemStyle(i) —— 与 10 个列表页同一出口、同一 STAGGER 步长，
   且 R3 下延迟随整条 animation 一起归零（原先 R3 只能靠 motionStyle 置 none 覆盖）。 */
</style>

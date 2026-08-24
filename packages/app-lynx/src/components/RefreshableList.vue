<script setup lang="ts">
// RefreshableList —— 列表刷新容器（ADR-0107，深模块）。
//
// 接口（调用方需要知道的全部）：
//   :refresh   页面传入的幂等刷新函数（feed.refresh()+sync 或 fetchFirstPage）
//   默认 slot  恰好一个可滚动子元素（<list>）
//
// 页面用法（无 refreshing ref、无包装器——刷新状态机全部内收本组件）：
//   <RefreshableList :refresh="refreshFeed"><list …>…</list></RefreshableList>
//
// 内部隐藏（页面零感知，禁止在页面重写）：
//   refreshing 内部态 + 防重入 guard + try/finally 复位（组件自持有 finally，
//   不存在"忘调 done"卡死类目）+ M3 FAB 定位/样式/a11y + 异常 warn 可见。
//
// 平台事实（ADR-0107，禁止回退原生手势路线）：
//   ① SelectorQuery 对 XElement 节点静默不命中（含 boundingClientRect 探针，
//      无 success/fail 回调）——完成信号链路在平台层断裂；
//   ② 原生 refresh XElement 包裹下数据整体替换触发 vue-lynx patch
//      RemoveNode 索引错位（列表空白）。两条均为模拟器实测 2026-08-24。
import { ref } from 'vue'
import { REFRESH_A11Y_LABELS } from '../utils/accessibility'

const props = defineProps<{
  /** 幂等刷新函数（createMixFeed 的 refresh() 内置 generation 竞态防护 + 15s TIMEOUT 保证 settle） */
  refresh: () => Promise<void> | void
}>()

/** 刷新中：FAB 禁用态（opacity 0.6）+ 防重入；仅反映 FAB 发起的刷新（onMounted/watch 补拉不点亮） */
const refreshing = ref(false)

async function onTap() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await props.refresh()
  } catch (err) {
    // 页面函数约定内部消化失败（createMixFeed 错误槽语义）；此处兜底防未处理 rejection
    // 静默消失（测试硬约束 #3：降级/异常必须 warn 可见）
    console.warn('[RefreshableList] refresh 执行异常', err)
  } finally {
    refreshing.value = false
  }
}
</script>

<template>
  <!-- 容器 = 列表布局参与者（flex-1 min-h-0）+ FAB 定位上下文（relative）；
       容器底边 = 内容区底边（底部导航顶边），FAB 不遮导航。
       布局契约：slot 内 list 用 w-full h-full（相对本容器解析，V4 模拟器验证） -->
  <view class="w-full flex-1 min-h-0 relative">
    <slot />
    <!-- M3 FAB：56dp=14.933vw、shape-large、primary-container、elevation-3（按压降 1）。
         样式承接自已删除的 Fab.vue（原生端已验证模式，ADR-0107 决策 1） -->
    <view
      class="absolute bottom-6 right-4 w-[14.933vw] h-[14.933vw] rounded-[var(--md-shape-large)] bg-primary-container active:bg-layer-pressed-primary flex items-center justify-center shadow-[var(--md-elevation-3)] active:shadow-[var(--md-elevation-1)]"
      :style="refreshing ? { opacity: 0.6 } : {}"
      :accessibility-element="true"
      :accessibility-label="REFRESH_A11Y_LABELS.refreshList"
      @tap="onTap"
    >
      <text class="text-[6.4vw] leading-none text-primary-on-container">↻</text>
    </view>
  </view>
</template>

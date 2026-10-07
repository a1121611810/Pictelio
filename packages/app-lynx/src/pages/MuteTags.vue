<script setup lang="ts">
// ─── 静音标签管理页（ADR-0187 D5 / #732，路由 /mute-tags）───
// 信息架构对齐 Watchlist.vue：M3 TopAppBar（返回 + 标题）+ 列表行「标签名 + 移除」+ 空态。
// 数据 = settingsStore 账号级静音集合（mute_tags_${uid}，ADR-0103 跨引擎共享键）：
// 本地同步读取，无网络请求 → 无骨架/加载态（三态单链退化为 内容/空态 二态，与 Watchlist
// 的差异为有意：数据源不是 feed 而是内存集合）。
// 移除 = unmuteTag（集合删除 + 持久化，未静音 no-op）；下次列表组装恢复显示。
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）；本页不在 include 白名单
// （卸载即释放，重进重读集合）。
defineOptions({ name: 'mute-tags' })
import { computed } from 'vue'
import { goBack } from '../router'
import { useSettingsStore } from '../stores/settingsStore'
import PageTopBar from '../components/PageTopBar.vue'
import EmptyState from '../components/EmptyState.vue'
import AppIcon from '../components/AppIcon.vue'
import { MUTE_TAGS_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
// 底部遮挡让位（ADR-0217 / 票 #922 / 术语文档 glossary-bottom-occlusion-allowance.md）：
// `</scroll-view>` 之前的让位占位。本页是**非 tab 内容页** ⇒ 档位为 search（让位 58.668vw）。
//   **档位/高度/遮挡源/接线约定全部写在 `FabAllowanceSpacer.vue` 头注，本页只负责接线。**
//   本页是票 #922 全量盘点（25 条路由）出的 4 个漏网页之一，补在 #922。
// · 占位必须紧邻 `</scroll-view>`，其后不得再有别的元素。
import FabAllowanceSpacer from '../components/FabAllowanceSpacer.vue'
import { t } from '../i18n'
import { useMotion } from '../composables/motion'

/** 按压反馈载体（ADR-0211 决策 2）：颜色状态层走 transition-colors 工具类——`background-color` 在其 transition-property 覆盖内（已验证）。
 *  时长与曲线一律取自 composables/motion.ts（唯一入口），本组件不写时长/曲线字面量；
 *  R1 降级（prefers-reduced-motion）由 useMotion 统一处理，组件内不自行判断偏好。 */
const { pressColor } = useMotion()

/** 列表项逐项铺开（ADR-0211 决策 5 / issue 879）：错峰延迟来自预设，本页不自定步长。
 *  `listItemStyle(i)` 已内建 R2 归零、R3 延迟归零与 STAGGER_MAX_ITEMS 上限
 *  （静音标签是本地集合、条数有限，超过上限的项直接终态，不产生末项漂移）。 */
const { listItemStyle } = useMotion()


const settings = useSettingsStore()

/** 静音标签列表（插入序 = 静音先后，最新在后）；computed 内调 mutedTags() 建立响应依赖 */
const tags = computed<string[]>(() => Array.from(settings.mutedTags()))

/** 取消静音：从集合删除并持久化 */
function removeTag(name: string): void {
  settings.unmuteTag(name)
}
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：次级页，返回箭头 + 标题（PageTopBar 变体 b，ADR-0194）；
         a11y 注册表 value 经 props 注入（组件不自持业务 a11y 文案） -->
    <PageTopBar
      back
      :title="t('muteTags.title')"
      :back-a11y-label="MUTE_TAGS_A11Y_LABELS.back"
      :title-a11y-label="MUTE_TAGS_A11Y_LABELS.pageTitle"
      @back="goBack"
    />

    <!-- 空态 -->
    <view v-if="tags.length === 0" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <EmptyState icon="notifications" :title="t('muteTags.empty.title')" :hint="t('muteTags.empty.hint')" />
    </view>

    <!-- 列表态：本地集合（量级小）不做虚拟化，纵列平铺于 scroll-view -->
    <scroll-view v-else class="w-full flex-1 min-h-0" scroll-orientation="vertical">
      <view
        v-for="(name, i) in tags"
        :key="name"
        class="flex flex-row items-center m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)]"
        :style="listItemStyle(i)"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="name"
      >
        <!-- 行首动作（ADR-0221 / 术语文档 glossary-app-lynx-hit-testing.md · 票 #932）：
             「取消静音」由行尾药丸改为行首 40dp 圆形图标按钮，行尾恒落在 GlobalFab 遮挡带
             [80.80, 95.73]vw 内，点它原本 97% 概率开出搜索弹层而非取消静音。
             · **图标染 text-error**：本页移除文案刻意用错误色（ADR-0187 D5），失去四字后严重性线索只剩颜色
               （ADR-0221 §3 代价 2）——不得为「和别处长得一样」抹平成主色。
             · **按压状态层沿用本页既有载体**：静态 class 上的 active:bg-layer-pressed-on-surface +
               :class="pressColor.className"（本页原本就有，另三处是本次补齐）。
               utility 必须是顶层 `bg-layer-pressed-*`，嵌在 `state` 下会产出不同名的死类名 `bg-state-layer-*`。
             · **@tap 不加 .stop**：本页行根**不带** @tap（不可点导航），`.stop` 在此无对象可停。
               `.stop` 的必要性只取决于行根是否带 @tap，与按钮在行内的位置无关（spec 决策 6）。
             · 行根的 justify-between 随之移除：它的意图就是「把动作推到行尾」，正是本票废除的那件事；
               标签 text 自带 flex-1，剩余空间本就由它吃掉，移除后视觉结果不变。 -->
        <view
          class="self-center mr-1.5 w-[10.667vw] h-[10.667vw] flex items-center justify-center border border-outline rounded-full active:bg-layer-pressed-on-surface"
          :class="pressColor.className"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="MUTE_TAGS_A11Y_LABELS.remove"
          @tap="removeTag(name)"
        >
          <AppIcon name="close" class="text-error" />
        </view>
        <text class="flex-1 text-body-medium text-surface-on [max-line:2]">{{ name }}</text>
      </view>
      <FabAllowanceSpacer />
    </scroll-view>
  </view>
</template>

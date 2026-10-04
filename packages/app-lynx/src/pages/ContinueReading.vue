<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）；本页无缓存语义，不入 include
defineOptions({ name: 'continueReading' })
// ─── 继续读完整列表（/continue，ADR-0219 §2.1 / 票 #926 + 票 #927）───
// 📌 **与插画浏览历史同页混排**（术语文档易混辨析 #2）：小说「续读条目」+ 插画「浏览记录条目」
//   收在**这一个**列表里，按最近活动统一倒序——刻意不新开 `/history`、不扩为第 4 段。
// 列表数据是本地同步快照（两 store 的 items 合并，新在前）：**全量渲染、零网络依赖、无分页、无列表尾**
// ——秒开对齐「先渲染后加载」硬约束；快照可能陈旧可接受（列表不做逐条探活）。

// ⚠️ **设备取证未做，显式挂账**（code-review 审计三 (a) 第 ② 项）。
//   本页是原生 `<list>`，按 ADR-0162 瀑布流 list-item「插入=丢弃 / 移除=留空位 / 替换=错位」
//   需要设备 spike 记录。本页结构与已上线的 `WatchLater.vue` **逐行同构**（同 epoch 写法、
//   同 full-span 尾项、同单一稳定根约束），且 `WatchLater.vue` 亦无 spike 记录 ⇒ 属**仓库级缺口**
//   而非本批偏离，但仍不得当作已验证。
//   挂账去向：**票 #929（T4 收口）的「真机手测 + 截图存证」验收项**，本批不单开 issue。
//   需覆盖三场景：① 删除单条后整树重建 ② 删至空后 list → view 的节点替换 ③ full-span 尾项不塌陷。
//   📌 票 #927 在**同一结构内**多插一种条目（`:key` 改带类型前缀），**未改 `<list>` 结构**
//   ⇒ 沿用上面这份挂账，不构成新的取证缺口。
//   📌 票 #928 **扩写了这份挂账的覆盖面**（不是新开一份）：新增「已读完」分组 = 一条
//   条件 list-item（组头）+ 一组 v-for list-item。原生 list 对「中间插入/移除行」的处理
//   正是 ADR-0162 点名的风险面，故把该场景并入上面的三场景一并取证。
import { ref, computed, watch } from 'vue'
import { goBack, navigate } from '../router'
import { openNovel } from '../utils/novelNavigation'
import { useContinueReadingStore } from '../stores/continueReadingStore'
import { useBrowsingHistoryStore } from '../stores/browsingHistoryStore'
import { useModalStack } from '../stores/modalStack'
import { mergeContinueEntries, type ContinueEntry } from '../primitives/continueEntries'
import { useHeroSource } from '../composables/heroTransition'
import PageTopBar from '../components/PageTopBar.vue'
import EmptyState from '../components/EmptyState.vue'
import ContinueRow from '../components/ContinueRow.vue'
// 底部遮挡让位（ADR-0217 / 票 #922）：非 tab 内容页 ⇒ 档位 search（让位 58.668vw）。
// 档位/高度/遮挡源/接线约定全部写在 FabAllowanceSpacer.vue 头注，本页只负责接线。
import FabAllowanceSpacer from '../components/FabAllowanceSpacer.vue'
import { t } from '../i18n'
import { useMotion } from '../composables/motion'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import type { IconName } from '../utils/iconMap'

// 按压反馈载体（ADR-0211 决策 2）：颜色状态层走 `pressColor.className` 工具类
// （`.transition-colors` 的 transition-property **不含 opacity/background-color 之外的形态**，
// 裸挂 `active:bg-layer-*` 会让过渡静默失效 ⇒ `pressStateLayerTransition` 门禁钉这条）。
// 时长与曲线一律取自 composables/motion.ts（唯一入口），本页不写时长/曲线字面量。
const { pressColor } = useMotion()

const continueStore = useContinueReadingStore()
const historyStore = useBrowsingHistoryStore()

/** 两轴混排（最近活动倒序）——本页与书架段 3 消费**同一个**聚合函数，形态不分叉。
 *  📌 小说侧取 `active`（未完成，票 #928 AC #3）：读完的作品**软删**出主列表，
 *  但条目仍在存储里 ⇒ 落到下方「已读完」分组可见可清（硬删后重读无入口 = 吞掉用户数据）。 */
const entries = computed(() => mergeContinueEntries(continueStore.active, historyStore.items))

/**
 * 「已读完」分组（票 #928 AC #3 的另一半）：完成是**软删**，本页必须能看见并清除它们。
 * 📌 **只装小说**：插画浏览历史没有完成态（流水无「读完」可言，ADR-0219 §2.5 完成态行），
 *   故第二个入参恒空数组——不是漏传。
 * 排序沿用同一个聚合函数的「最近活动倒序」，两组之间不交叉混排（组本身就是分界）。
 */
const finishedEntries = computed(() => mergeContinueEntries(continueStore.completed, []))

/**
 * 空态图标字形。⚠️ **刻意不复用 watchLater 的字形常量**（术语文档易混辨析 #1
 * 「两个 store、两个键、两条导航」的代码红线）：同族语义可以共用字形字符串，
 * 但常量名带「稍后看」词根会让后续读者以为两条轴同源。
 */
const EMPTY_ICON: IconName = 'schedule'

/** list 强制重建代（删除成功后 ++，驱动 :key 整树替换）：原生 list 删除条目走子节点
 * patch 会触发 vue-lynx patch RemoveNode 索引错位（框架 bug，ADR-0107 D4）。
 * 本页是用户主动删除的危险面（ADR-0162），错位代价最高，必须整树重建防御。 */
const refreshEpoch = ref(0)

/**
 * 行点击分流：小说 → 正文（**无视介绍页开关**，ADR-0219 §2.4，续读召回的意图是「回到我读的
 *   位置」而不是「重新考虑要不要读」，落点经 openNovel 的 resume 意图参数走**单点缝隙**，
 *   不在此处内联拼 `/novel/:id`——源级守卫 novelIntroEntryGuards.test.ts 钉住）；
 *   插画 → 既有插画详情路由。
 */
// 缩略图 → 大图连续性转场（ADR-0211 决策 12）：本页**不在** KeepAlive 白名单内 ⇒
// push 详情即卸载，返回时原缩略图已不存在 ⇒ 只做前进方向，返回由 heroTransition 自动降级。
const heroTransition = useHeroSource()

function openItem(entry: ContinueEntry): void {
  heroTransition.begin(entry.id)
  if (entry.kind === 'novel') openNovel(entry.id, { resume: true })
  else void navigate(`/illust/${entry.id}`)
}

function removeItem(entry: ContinueEntry): void {
  if (entry.kind === 'novel') continueStore.remove(entry.id)
  else historyStore.remove(entry.id)
  refreshEpoch.value++
}

// ─── 跨轴批量清理（票 #929 / spec US28「清除全部浏览记录」）───────────────
// 两个入口都是**不可逆的硬删**（浏览历史无软删态可回落；「已读完」清除即真删），
// 故一律经二次确认弹窗，结构对齐 `Watchlist.vue` 取消追更确认（M3 Dialog + modalStack）。
//
// 📌 **两个动作分属两条轴，绝不合并成一个「清空」**：
//   `history` → `historyStore.clearAll()`（插画浏览流水）
//   `completed` → `continueStore.clearCompleted()`（小说已读完，**保留在读的**）
//   理由同 ADR-0219 §2.5：两轴生命周期不同（流水 30 天过期 / 未完成事项不过期），
//   用户对二者的心理预期也不同；合成一个按钮等于替用户决定「在读的书也算历史」。
const CLEAR_TARGETS = ['history', 'completed'] as const
type ClearTarget = (typeof CLEAR_TARGETS)[number]

/** 待确认的批量清理目标（null = 弹窗关闭） */
const clearTarget = ref<ClearTarget | null>(null)

/** 弹窗正文里的条数（打开那一刻取，避免清除过程中数字跳动） */
const clearCount = ref(0)

function askClear(target: ClearTarget): void {
  // 📌 计数口径不同轴不同：浏览历史 = 全部条目数；「已读完」= `completed` 分组数
  //   （`clearCompleted` 只删这一组，在读的不受影响 ⇒ 弹窗报的数必须与之相等，
  //   否则用户看到的数字和实际被删的数字对不上）。
  clearCount.value = target === 'history' ? historyStore.items.length : continueStore.completed.length
  clearTarget.value = target
}

function cancelClear(): void {
  clearTarget.value = null
  clearCount.value = 0
}

function confirmClear(): void {
  if (clearTarget.value === 'history') historyStore.clearAll()
  else if (clearTarget.value === 'completed') continueStore.clearCompleted()
  cancelClear()
  // ⚠️ 与单条 `removeItem` 同因：原生 list 走子节点 patch 删除会索引错位（ADR-0107 D4）
  //   ⇒ 批量删除后同样整树重建。批量清空的错位面比单条更大（一次移除整组行）。
  refreshEpoch.value++
}

// 返回键拦截（对齐 Watchlist.vue 的 unwatchTarget 同款接线）：
// 弹窗打开期间系统返回**优先关弹窗**，而不是直接 pop 页面。
watch(clearTarget, (target, _prev, onCleanup) => {
  if (!target) return
  const unregister = useModalStack().registerModal(() => cancelClear())
  onCleanup(unregister)
})

// 首载三态：两轴**都** ready 才算「落定」。⚠️ 与书架段 3 同纪律——
// 缺它会把 hydrate 在飞渲染成空态，把「还不知道」说成「你没有」（测试硬约束 #3）。
// ⚠️ 两轴分两个标志位而不是共用一个：它们各自失败、各自表达，互不牵连。
const settled = computed(() => continueStore.ready && historyStore.ready)
// ⚠️ 空态要**两组一起**看：只有「已读完」条目时主列表长度为 0，但那不是「你没有记录」
//   （测试硬约束 #3：把「有但不在主列表」说成「什么都没有」= 静默降级）。
const isEmpty = computed(
  () => settled.value && entries.value.length === 0 && finishedEntries.value.length === 0,
)
const showSkeleton = computed(
  () => !settled.value && entries.value.length === 0 && finishedEntries.value.length === 0,
)

/**
 * 批量清理入口的可见性（票 #929 / spec US28）。
 * 📌 **hydrate 未落定前一律不显示**（同 `settled` 纪律）：此刻长度是「还不知道」，
 *   拿它当「没有可清的」就是在把在飞状态说成结论（测试硬约束 #3）。
 * 📌 没有可清内容时**不显示**按钮：给一个点了只会 no-op 的入口是噪音（也是假承诺）。
 */
const canClearHistory = computed(() => settled.value && historyStore.items.length > 0)
const canClearCompleted = computed(() => settled.value && continueStore.completed.length > 0)
const showClearBar = computed(() => canClearHistory.value || canClearCompleted.value)

/** 弹窗文案（按目标分流；两套文案各自独立，不共用一条含混的「确定要清除吗」） */
const clearTitleKey = computed(() =>
  clearTarget.value === 'history' ? 'continue.clear.history.title' : 'continue.clear.completed.title',
)
const clearHintKey = computed(() =>
  clearTarget.value === 'history' ? 'continue.clear.history.hint' : 'continue.clear.completed.hint',
)
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <PageTopBar
      back
      :title="t('continue.title')"
      :back-a11y-label="t('continue.back')"
      :title-a11y-label="t('continue.title')"
      @back="goBack"
    />

    <!-- 首载骨架：hydrate 在飞（Hard constraint #1 先渲染页面框架含骨架屏占位） -->
    <view v-if="showSkeleton" class="w-full flex-1 px-3 pt-1">
      <view
        v-for="i in 4"
        :key="`sk-${i}`"
        class="mb-1.5 px-2.5 py-3 rounded-[var(--md-shape-medium)] bg-surface-container-low"
      >
        <view class="shimmer h-[28rpx] w-[45%] rounded-[var(--md-shape-extra-small)]" />
        <view class="shimmer h-[28rpx] w-[70%] rounded-[var(--md-shape-extra-small)] mt-2" />
      </view>
    </view>

    <view v-else-if="isEmpty" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <EmptyState :icon="EMPTY_ICON" :title="t('continue.empty.title')" :hint="t('continue.empty.hint')" />
    </view>

    <!-- ══ 跨轴批量清理入口（票 #929 / spec US28）══
         📌 刻意放在 `<list>` **之外**、页面级 flex 容器内：原生 list 对中间插入/移除行
           的处理需设备 spike（ADR-0162，本页文件头那份挂账），把工具条塞进 list
           等于给它再加一个「插入行」的场景。放在外面它只是普通 view，行为可预测。
         📌 入口**分别**对应两条轴（「清除全部浏览记录」/「清除已读完」），不合并。 -->
    <view
      v-if="!showSkeleton && !isEmpty && showClearBar"
      class="w-full flex flex-row items-center justify-end gap-4 px-3 py-1.5"
    >
      <view
        v-if="canClearHistory"
        class="py-1"
        :class="[pressColor.className, 'active:bg-layer-pressed-primary']"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="t('continue.clear.history')"
        @tap="askClear('history')"
      >
        <text class="text-label-large text-error">{{ t('continue.clear.history') }}</text>
      </view>
      <view
        v-if="canClearCompleted"
        class="py-1"
        :class="[pressColor.className, 'active:bg-layer-pressed-primary']"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="t('continue.clear.completed')"
        @tap="askClear('completed')"
      >
        <text class="text-label-large text-error">{{ t('continue.clear.completed') }}</text>
      </view>
    </view>

    <list v-else :key="refreshEpoch" class="w-full flex-1" list-type="single" scroll-orientation="vertical">
      <list-item
        v-for="item in entries"
        :key="item.key"
        :item-key="item.key"
        class="w-full"
      >
        <!-- [lynx:fix] 单一稳定根 view（list-item 根不得承载条件分支/事件） -->
        <view class="w-full">
          <ContinueRow
            :entry="item"
            detailed
            :thumb-id="heroTransition.sourceId(item.id)"
            @open="openItem"
            @remove="removeItem"
          />
        </view>
      </list-item>

      <!-- ══ 「已读完」分组（票 #928 AC #3：完成是软删 ⇒ 本页可见可清）══
           📌 整组 `v-if` 挂在 list-item 上（有/无整组二值），组内**不**再挂条件分支——
             list-item 根必须是单一稳定节点（[lynx:fix] 约束，Watchlist / Notifications 同款）。
           ⚠️ list-item 行的插入/移除按 ADR-0162 需设备 spike：本页沿用文件头那份挂账
             （未做真机取证 → 票 #929），本票的「已读完」分组**扩写了**那份挂账的覆盖面。 -->
      <list-item
        v-if="finishedEntries.length > 0"
        :key="'finished-header'"
        item-key="finished-header"
        class="w-full"
      >
        <view class="w-full px-3 mt-3 mb-1.5 flex flex-row items-center">
          <text class="text-title-small font-medium text-surface-on">
            {{ t('continue.completed.title') }}
          </text>
        </view>
      </list-item>
      <list-item
        v-for="item in finishedEntries"
        :key="item.key"
        :item-key="item.key"
        class="w-full"
      >
        <view class="w-full">
          <ContinueRow
            :entry="item"
            detailed
            :thumb-id="heroTransition.sourceId(item.id)"
            @open="openItem"
            @remove="removeItem"
          />
        </view>
      </list-item>

      <list-item :key="'fab-allowance'" item-key="fab-allowance" class="w-full" full-span>
        <FabAllowanceSpacer />
      </list-item>
    </list>

    <!-- M3 Dialog（批量清理二次确认，票 #929 / spec US28）：结构对齐 Watchlist.vue 取消追更确认。
         ⚠️ **不可逆操作必须有确认层**：两个动作都是硬删（浏览历史无软删态可回落、
           「已读完」清除即真删），误触一次就是吞掉用户数据（测试硬约束 #3 的反面）。
         📌 文案与条数按目标分流，不共用一条含混提示——用户须知道自己正在删哪一批。 -->
    <view v-if="clearTarget" class="fixed inset-0 bg-scrim z-50 flex items-center justify-center">
      <view
        class="w-[74.667vw] max-w-[74.667vw] bg-surface-container-high rounded-[var(--md-shape-extra-large)] px-6 pt-5 pb-3 shadow-[var(--md-elevation-3)]"
      >
        <text class="text-headline-small font-medium text-surface-on">{{ t(clearTitleKey) }}</text>
        <text class="text-body-medium text-surface-on-variant mt-4">
          {{ t(clearHintKey, { count: clearCount }) }}
        </text>
        <view class="flex flex-row justify-end mt-6 gap-2">
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center"
            :class="[pressColor.className, 'active:bg-layer-pressed-primary']"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="t('continue.clear.cancel')"
            @tap="cancelClear"
          >
            <text class="text-label-large font-medium text-primary">{{ t('continue.clear.cancel') }}</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center"
            :class="[pressColor.className, 'active:bg-layer-pressed-primary']"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="t('continue.clear.confirm')"
            @tap="confirmClear"
          >
            <text class="text-label-large font-medium text-error">{{ t('continue.clear.confirm') }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

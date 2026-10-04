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
import { ref, computed } from 'vue'
import { goBack, navigate } from '../router'
import { openNovel } from '../utils/novelNavigation'
import { useContinueReadingStore } from '../stores/continueReadingStore'
import { useBrowsingHistoryStore } from '../stores/browsingHistoryStore'
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
import type { IconName } from '../utils/iconMap'

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
  </view>
</template>

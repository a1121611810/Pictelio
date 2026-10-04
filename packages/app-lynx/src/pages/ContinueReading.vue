<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）；本页无缓存语义，不入 include
defineOptions({ name: 'continueReading' })
// ─── 继续读完整列表（/continue，ADR-0219 §2.1 / 票 #926）───
// 📌 **与插画浏览历史同页混排**（术语文档易混辨析 #2）：本批 T1 只接小说侧（阅读位置），
//   T2 在同一段落同一页接入插画浏览历史（票 #927）——刻意不新开 `/history`、不扩为第 4 段。
// 列表数据是本地同步快照（store.items，新在前）：**全量渲染、零网络依赖、无分页、无列表尾**
// ——秒开对齐「先渲染后加载」硬约束；快照可能陈旧可接受（列表不做逐条探活）。

// ⚠️ **设备取证未做，显式挂账**（code-review 审计三 (a) 第 ② 项）。
//   本页是原生 `<list>`，按 ADR-0162 瀑布流 list-item「插入=丢弃 / 移除=留空位 / 替换=错位」
//   需要设备 spike 记录。本页结构与已上线的 `WatchLater.vue` **逐行同构**（同 epoch 写法、
//   同 full-span 尾项、同单一稳定根约束），且 `WatchLater.vue` 亦无 spike 记录 ⇒ 属**仓库级缺口**
//   而非本批偏离，但仍不得当作已验证。
//   挂账去向：**票 #929（T4 收口）的「真机手测 + 截图存证」验收项**，本批不单开 issue。
//   需覆盖三场景：① 删除单条后整树重建 ② 删至空后 list → view 的节点替换 ③ full-span 尾项不塌陷。
import { ref, computed } from 'vue'
import { goBack } from '../router'
import { openNovel } from '../utils/novelNavigation'
import { useContinueReadingStore, type ContinueReadingItem } from '../stores/continueReadingStore'
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

const store = useContinueReadingStore()

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
 * 行点击 → 正文（**无视介绍页开关**，ADR-0219 §2.4）：续读召回的意图是「回到我读的位置」，
 * 不是「重新考虑要不要读」。落点经 openNovel 的 resume 意图参数走**单点缝隙**，
 * 不在此处内联拼 `/novel/:id`（源级守卫 novelIntroEntryGuards.test.ts 钉住）。
 */
// 缩略图 → 大图连续性转场（ADR-0211 决策 12）：本页**不在** KeepAlive 白名单内 ⇒
// push 详情即卸载，返回时原缩略图已不存在 ⇒ 只做前进方向，返回由 heroTransition 自动降级。
const heroTransition = useHeroSource()

function openItem(item: ContinueReadingItem): void {
  heroTransition.begin(item.novelId)
  openNovel(item.novelId, { resume: true })
}

function removeItem(item: ContinueReadingItem): void {
  store.remove(item.novelId)
  refreshEpoch.value++
}

// 首载三态：store.ready 区分「还不知道」与「确实没有」。⚠️ 与书架段 3 同纪律——
// 缺它会把 hydrate 在飞渲染成空态，把「还不知道」说成「你没有」（测试硬约束 #3）。
const isEmpty = computed(() => store.ready && store.items.length === 0)
const showSkeleton = computed(() => !store.ready && store.items.length === 0)
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
        v-for="item in store.items"
        :key="`n-${item.novelId}`"
        :item-key="`n-${item.novelId}`"
        class="w-full"
      >
        <!-- [lynx:fix] 单一稳定根 view（list-item 根不得承载条件分支/事件） -->
        <view class="w-full">
          <ContinueRow
            :item="item"
            detailed
            :thumb-id="heroTransition.sourceId(item.novelId)"
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

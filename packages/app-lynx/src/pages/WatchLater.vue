<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）；本页无缓存语义，不入 include
defineOptions({ name: 'watchLater' })
import { goBack, navigate } from '../router'
import { ref } from 'vue'
import { openNovel } from '../utils/novelNavigation'
import { useWatchLaterStore, type WatchLaterItem } from '../stores/watchLaterStore'
import { proxyImageUrl } from '../utils/imageUrl'
import { WATCH_LATER_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { LATER_ICON } from '../utils/watchLaterGlyph'
import PageTopBar from '../components/PageTopBar.vue'
import EmptyState from '../components/EmptyState.vue'
import SkeletonImage from '../components/SkeletonImage.vue'
import { t } from '../i18n'
import { useMotion } from '../composables/motion'

/** 按压反馈载体（ADR-0211 决策 2）：颜色状态层走 transition-colors 工具类——`background-color` 在其 transition-property 覆盖内（已验证）。
 *  时长与曲线一律取自 composables/motion.ts（唯一入口），本组件不写时长/曲线字面量；
 *  R1 降级（prefers-reduced-motion）由 useMotion 统一处理，组件内不自行判断偏好。 */
const { pressColor } = useMotion()


// ─── 稍后看列表页（ADR-0191 D5 / spec docs/specs/lynx-watch-later.md D7 / #753 T4）───
// 列表数据是本地同步快照（store.items，新在前）：**全量渲染、零网络依赖、无分页、无列表尾**
// ——秒开对齐「先渲染后加载」硬约束；快照可能陈旧可接受（spec D2 取舍，列表不做逐条探活）。
// 快照卡**不渲染 RestrictOverlay**（ADR-0191 D5 裁定）：快照无 tags/页数等完整作品数据、
// 无法可靠判定 R-18/AI 受限态，且用户主动加入即已知情；点开详情后的受限处置交由详情页既有链路。
const store = useWatchLaterStore()

/** list 强制重建代（删除成功后 ++，驱动 :key 整树替换）：原生 list 删除条目走子节点
 * patch 会触发 vue-lynx patch RemoveNode 索引错位（框架 bug，ADR-0107 D4）；
 * 本页是用户主动删除的危险面（ADR-0162），错位代价最高，必须整树重建防御 */
const refreshEpoch = ref(0)

/**
 * 单条删除（spec US10）：store.remove 本地同步快照，成功即 epoch 同 tick ++
 * （MyPixiv.vue 刷新同款写法）→ <list :key> 变化走整树替换，不发生子节点 patch。
 */
function removeItem(item: WatchLaterItem): void {
  store.remove(item.kind, item.id)
  refreshEpoch.value++
}

/**
 * 行点击 → 实时详情页（spec US6）：插画直达 `/illust/:id`（Bookmarks/IllustList 同款惯例）；
 * 小说走 openNovel seam（ADR-0183，novel_intro_first 设置生效：介绍页先行可关）。
 */
function openItem(item: WatchLaterItem): void {
  if (item.kind === 'illust') {
    void navigate(`/illust/${item.id}`)
  } else {
    openNovel(item.id)
  }
}
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：次级页返回变体（PageTopBar 公共层组件，ADR-0194） -->
    <PageTopBar
      back
      :title="t('later.title')"
      :back-a11y-label="WATCH_LATER_A11Y_LABELS.back"
      :title-a11y-label="WATCH_LATER_A11Y_LABELS.pageTitle"
      @back="goBack"
    />

    <!-- 空态（spec US11）：时钟字形 + 「还没有稍后看内容」语义；本地判定，无加载/错误三态 -->
    <view v-if="store.items.length === 0" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <EmptyState :icon="LATER_ICON" :title="t('later.empty.title')" :hint="t('later.empty.hint')" />
    </view>

    <!-- 本地全量渲染（原生 list 元素回收长列表，容量上限内内存可控）；无 scrolltolower 分页；
         :key = refreshEpoch：删除后整树重建（ADR-0107 D4，见 removeItem 注释） -->
    <list v-else :key="refreshEpoch" class="w-full flex-1" list-type="single" scroll-orientation="vertical">
      <list-item
        v-for="item in store.items"
        :key="`${item.kind}-${item.id}`"
        :item-key="`${item.kind}-${item.id}`"
        class="w-full"
      >
        <!-- [lynx:fix] 单一稳定根 view（list-item 根不得承载条件分支/事件，追更列表页同款约束） -->
        <view class="w-full">
          <!-- 快照卡：行点击进实时详情（事件绑内层 view——list-item 根级 @tap 原生无效，ADR-0055 家族） -->
          <view
            class="flex flex-row items-start m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] active:bg-layer-pressed-on-surface"
            :class="pressColor.className"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="WATCH_LATER_A11Y_LABELS.openItem"
            @tap="openItem(item)"
          >
            <!-- 封面：快照存 API 原值，渲染时过代理（SkeletonImage 列表卡惯例 + 懒加载） -->
            <SkeletonImage
              :src="proxyImageUrl(item.coverUrl)"
              height="21.333vw"
              class="w-[21.333vw] rounded-[var(--md-shape-small)]"
              lazy-load
            />
            <view class="flex-1 flex flex-col ml-3 min-w-0">
              <!-- WorkKind 徽标（spec US5）：插画/小说文本 chip，区分双类型条目 -->
              <view class="self-start px-2 py-0.5 rounded-[var(--md-shape-full)] bg-secondary-container">
                <text class="text-label-medium text-secondary-on-container">{{ item.kind === 'illust' ? t('later.badge.illust') : t('later.badge.novel') }}</text>
              </view>
              <text class="text-title-medium font-medium text-surface-on [max-line:2] mt-1.5">{{ item.title }}</text>
              <text class="text-body-medium text-surface-on-variant mt-1.5">by {{ item.userName }}</text>
            </view>
            <!-- 单条删除（spec US10）：触控高度 10.667vw = 40dp 等效；@tap.stop 防卡片导航误触 -->
            <view
              class="self-center ml-2 h-[10.667vw] px-3 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)]"
              :accessibility-element="A11Y_ELEMENT_ENABLED"
              :accessibility-label="WATCH_LATER_A11Y_LABELS.remove"
              @tap.stop="removeItem(item)"
            >
              <text class="text-label-large text-primary">{{ t('later.remove') }}</text>
            </view>
          </view>
        </view>
      </list-item>
    </list>
  </view>
</template>

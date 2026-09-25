<script setup lang="ts">
// ─── 通知中心页（ADR-0188 / spec docs/specs/notification-center.md / #728）───
// 数据层：useNotificationsList（Vue Query 无限分页，queryKeys.notifications.list()，
// next_url 透传）；拉取**成功后**推进设备级已读时间戳（notifyListLoaded，失败不推进）。
// 行模型：buildNotificationRows——组头行（view_more 非空）点击就地插入子列表区
// （NotificationChildren 子组件，展开单向不收起）；普通行点击经 resolveNotificationTarget
// 路由（pixiv:// 三 scheme / http(s) 外链 / 其它 scheme 静默忽略）。
// 页面骨架对齐 Watchlist.vue / Ranking.vue：三态单链（ADR-0150）+ RefreshableList + footer。
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）；本页不在 include 白名单
// （卸载即释放，重进重拉 → 挂载刷新即角标刷新时机，ADR-0188 D7 lynx 侧）。
defineOptions({ name: 'notifications' })
import { computed, ref, watch } from 'vue'
import { goBack } from '../router'
import {
  buildNotificationRows,
  flattenNotifications,
  useNotificationStore,
  useNotificationsList,
  type NotificationRow,
} from '../stores/notificationStore'
import { isApiQueryError } from '../primitives/useApiInfiniteQuery'
import { notificationPlainText } from '../utils/notificationText'
import { openNotificationTarget } from '../utils/notificationTarget'
import { proxyImageUrl } from '../utils/imageUrl'
import { formatRelativeTime } from '../utils/dateFormat'
import { deriveFirstLoadView } from '../utils/firstLoadView'
import { NOTIFICATIONS_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import NotificationChildren from '../components/NotificationChildren.vue'
import RefreshableList from '../components/RefreshableList.vue'
import { t } from '../i18n'

const notificationStore = useNotificationStore()

const list = useNotificationsList()

/** 组头展开注册表（单向不收起：只增不减，spec 边界 9） */
const expanded = ref<Record<number, boolean>>({})

/** 分页 accumulate + 组头就地插入（store 纯函数，store 测试钉住顺序语义） */
const rows = computed<NotificationRow[]>(() =>
  buildNotificationRows(flattenNotifications(list.data.value?.pages ?? []), expanded.value),
)

/** 双错误槽位（ADR-0141 D5）：首屏失败 → 全屏错误态；分页失败 → 底部内联重试 */
const firstError = computed(() =>
  list.error.value && isApiQueryError(list.error.value) && list.error.value.kind === 'first'
    ? list.error.value.cause
    : null,
)
const pageError = computed(() =>
  list.error.value && isApiQueryError(list.error.value) && list.error.value.kind === 'pagination'
    ? list.error.value.cause
    : null,
)
const errorMsg = computed(() => firstError.value?.message ?? '')

/** 页级首载三态（ADR-0150）：骨架 / 错误 / 空态 / 内容 的唯一判定源 */
const view = computed(() =>
  deriveFirstLoadView({
    hasItems: rows.value.length > 0,
    loading: list.isLoading.value,
    settled: list.isSuccess.value,
    hasError: !!errorMsg.value,
  }),
)

// 已读推进（ADR-0188 D5 / spec 边界 10）：列表拉取成功后写 notifications_last_read_time；
// 失败不推进（store.notifyListLoaded 内部判向），保证未读不丢。
watch(
  () => list.isSuccess.value,
  (ok) => {
    if (ok) notificationStore.notifyListLoaded(true)
  },
)

/** list 强制重建代（refresh 后 ++，驱动 :key 替换，规避 vue-lynx patch 索引错位 ADR-0107 D4） */
const refreshEpoch = ref(0)

async function refreshFeed() {
  await list.refetch()
  refreshEpoch.value++
}

function loadMore(): void {
  void list.fetchNextPage()
}

/** 组头点击：展开（插入子列表区）；单向不收起 */
function expandHeader(item: NotificationRow['item']): void {
  expanded.value = { ...expanded.value, [item.id]: true }
}

/** 行点击统一入口：组头展开；其余走 target_url 解析（ignore 静默，不抛错） */
function openRow(row: NotificationRow): void {
  if (row.kind === 'header') {
    expandHeader(row.item)
    return
  }
  openNotificationTarget(row.item.target_url)
}

/** 子区行 → 组头 id（模板表达式不用 `!` 断言——vue-lynx 模板编译器兼容面收敛在 script） */
function childrenHeaderId(row: NotificationRow): number {
  return row.kind === 'children' && row.headerId !== undefined ? row.headerId : 0
}

// ─── 缩略图：经图片服务重写通道（proxyImageUrl，禁直连 pximg CDN 域）───
// left_image（内容缩略图）优先，left_icon（公共图标）兜底；重写后为空串（非白名单域）或
// 加载失败 → 隐藏图区（不占位卡，spec 边界 5；按行 key 记失败，防重试风暴）。
const failedImages = ref<Record<string, boolean>>({})

function rowThumbUrl(item: NotificationRow['item']): string {
  return proxyImageUrl(item.content?.left_image || item.content?.left_icon || '')
}

function onThumbError(row: NotificationRow): void {
  failedImages.value = { ...failedImages.value, [row.key]: true }
}

function hasThumb(row: NotificationRow): boolean {
  return rowThumbUrl(row.item) !== '' && !failedImages.value[row.key]
}

// ─── 行文案与可达性 ───

function rowText(item: NotificationRow['item']): string {
  return notificationPlainText(item.content?.text)
}

function headerTitle(item: NotificationRow['item']): string {
  return item.view_more?.title ?? ''
}

/** 行可达性标签：未读/已读语义 + 主体文本（a11y 注册表 + i18n 组合） */
function rowA11y(row: NotificationRow): string {
  const state = row.item.is_read ? t('notifications.a11y.read') : t('notifications.a11y.unread')
  const body = row.kind === 'header' ? headerTitle(row.item) || rowText(row.item) : rowText(row.item) || t('notifications.noContent')
  return `${NOTIFICATIONS_A11Y_LABELS.openItem} ${state} ${body}`
}
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：次级页，返回箭头 + 标题（对齐 Watchlist 头部模式） -->
    <view class="flex flex-row items-center h-[17.067vw] px-4 bg-surface">
      <view
        class="py-1 pr-2"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="NOTIFICATIONS_A11Y_LABELS.back"
        @tap="goBack"
      >
        <text class="text-[6.4vw] leading-none text-surface-on">‹</text>
      </view>
      <text
        class="flex-1 text-title-large font-medium text-surface-on"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="NOTIFICATIONS_A11Y_LABELS.pageTitle"
        >{{ t('notifications.title') }}</text
      >
    </view>

    <!-- 有数据时刷新失败：Vue Query 保留已加载页（不同于首屏失败），顶部内联错误条兜底（ADR-0104 槽位语义） -->
    <text v-if="view === 'content' && pageError" class="text-body-small text-error p-4">{{ pageError.message }}</text>

    <!-- 首载三态（ADR-0150）：骨架 → 错误 → 空态 → 内容，互斥单链；不依赖 loading 标志 -->
    <view v-if="view === 'skeleton'" class="w-full flex-1 min-h-0">
      <view v-for="n in 6" :key="n" class="m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)]">
        <view class="flex flex-row items-start">
          <view class="shimmer w-[12vw] h-[12vw] rounded-[var(--md-shape-small)]" />
          <view class="flex-1 ml-3">
            <view class="shimmer h-[30rpx] rounded-[var(--md-shape-extra-small)] w-[80%]" />
            <view class="shimmer h-[24rpx] rounded-[var(--md-shape-extra-small)] mt-1.5 w-[55%]" />
          </view>
        </view>
      </view>
    </view>

    <view v-else-if="view === 'error'" class="w-full flex-1 min-h-0 flex flex-col items-center justify-center px-8">
      <text class="text-body-small text-error text-center">{{ errorMsg }}</text>
      <view
        class="mt-4 px-6 h-[10.667vw] bg-primary active:bg-state-pressed-primary rounded-[var(--md-shape-full)] flex items-center justify-center"
        @tap="refreshFeed"
      >
        <text class="text-label-large font-medium text-primary-on">{{ t('notifications.retry') }}</text>
      </view>
    </view>
    <!-- 空态 -->
    <view v-else-if="view === 'empty'" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">◇</text>
        <text class="text-body-large text-surface-on mt-3">{{ t('notifications.empty.title') }}</text>
        <text class="text-body-medium text-surface-on-variant mt-1.5">{{ t('notifications.empty.hint') }}</text>
      </view>
    </view>

    <RefreshableList v-else :refresh="refreshFeed" @back-to-top="refreshEpoch++">
    <template #default="{ onScroll }">
    <list
      :key="refreshEpoch"
      class="w-full h-full"
      list-type="single"
      scroll-orientation="vertical"
      :lower-threshold-item-count="5"
      :scroll-event-throttle="0"
      @scrolltolower="loadMore"
      @scroll="onScroll"
    >
      <list-item
        v-for="row in rows"
        :key="row.key"
        :item-key="row.key"
        class="w-full"
      >
        <!-- [lynx:fix] 单一稳定根 view（list-item 根不得在 v-if/v-else 间交替，Watchlist 同款约束）；
             行种类差异全部内收为平行分支 -->
        <view class="w-full">
          <!-- 组头行：view_more 非空 → 点击展开子列表（就地插入，单向不收起） -->
          <view
            v-if="row.kind === 'header'"
            class="flex flex-row items-start m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)] active:bg-layer-pressed-on-surface"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="rowA11y(row)"
            @tap="openRow(row)"
          >
            <image
              v-if="hasThumb(row)"
              class="w-[12vw] h-[12vw] rounded-[var(--md-shape-small)] bg-surface-container-high"
              :src="rowThumbUrl(row.item)"
              @error="onThumbError(row)"
            />
            <view class="flex-1 flex flex-col ml-3">
              <text class="text-title-small font-medium text-surface-on [max-line:1]">{{ headerTitle(row.item) || rowText(row.item) || t('notifications.noContent') }}</text>
              <text class="text-body-small text-surface-on-variant mt-1 [max-line:2]">{{ rowText(row.item) }}</text>
            </view>
            <!-- 展开 affordance（spec D4）：‹ 旋转语义用 › 表示可展开 -->
            <text class="self-center text-title-medium text-outline ml-2">›</text>
          </view>

          <!-- 子列表区：就地插入组头之后（NotificationChildren 持独立 children query） -->
          <view v-else-if="row.kind === 'children'" class="mx-3 mb-1.5">
            <NotificationChildren :header-id="childrenHeaderId(row)" />
          </view>

          <!-- 普通通知行：点击按 target_url 路由（未知 scheme 静默忽略） -->
          <view
            v-else
            class="flex flex-row items-start m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)] active:bg-layer-pressed-on-surface"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="rowA11y(row)"
            @tap="openRow(row)"
          >
            <image
              v-if="hasThumb(row)"
              class="w-[12vw] h-[12vw] rounded-[var(--md-shape-small)] bg-surface-container-high"
              :src="rowThumbUrl(row.item)"
              @error="onThumbError(row)"
            />
            <view class="flex-1 flex flex-col ml-3">
              <text class="text-body-medium text-surface-on leading-snug [max-line:2]">{{ rowText(row.item) || t('notifications.noContent') }}</text>
              <text class="text-label-medium text-surface-on-variant mt-1.5">{{ formatRelativeTime(row.item.created_datetime) }}</text>
            </view>
          </view>
        </view>
      </list-item>
      <list-item
        v-if="list.isFetchingNextPage.value || pageError || (list.hasNextPage.value === false && rows.length > 0)"
        :key="'footer'"
        item-key="footer"
        class="w-full h-10 flex items-center justify-center"
        full-span
      >
        <text v-if="list.isFetchingNextPage.value" class="text-body-medium text-outline">{{ t('notifications.footer.loading') }}</text>
        <text v-else-if="pageError" class="text-body-medium text-error">{{ pageError.message }}</text>
        <text v-else class="text-body-medium text-outline">{{ t('notifications.footer.end') }}</text>
      </list-item>
    </list>
    </template>
    </RefreshableList>
  </view>
</template>

<script setup lang="ts">
// ─── 组头摊平子列表（ADR-0188 D3/D4 / spec §US2）───
// 每个展开的组头渲染一个本组件：setup 内调用 useNotificationChildren（Vue 组合式函数
// 必须在组件上下文调用）——独立 query 键 ['pictelio','notifications','children',id]，
// 首屏 view-more?notification_id=，翻页透传 older_than 游标。子条目 view_more 恒 null。
// 展开单向不收起（spec 边界 9）→ 组件随组头插入后常驻，无需收起态。
import { computed } from 'vue'
import {
  flattenNotifications,
  useNotificationChildren,
} from '../stores/notificationStore'
import { isApiQueryError } from '../primitives/useApiInfiniteQuery'
import { notificationPlainText } from '../utils/notificationText'
import { openNotificationTarget } from '../utils/notificationTarget'
import { formatRelativeTime } from '../utils/dateFormat'
import { NOTIFICATIONS_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { t } from '../i18n'

const props = defineProps<{ headerId: number }>()

const query = useNotificationChildren(props.headerId)

/** 分页 accumulate：pages → 单列表（store 纯函数，store 测试钉住顺序语义） */
const children = computed(() => flattenNotifications(query.data.value?.pages ?? []))

/** 双错误槽位（ADR-0141 D5）：首屏失败 / 分页失败分流 banner */
const firstError = computed(() =>
  query.error.value && isApiQueryError(query.error.value) && query.error.value.kind === 'first'
    ? query.error.value.cause
    : null,
)
const pageError = computed(() =>
  query.error.value && isApiQueryError(query.error.value) && query.error.value.kind === 'pagination'
    ? query.error.value.cause
    : null,
)

const endOfFeed = computed(() => query.hasNextPage.value === false)

function rowText(item: { content?: { text?: string } | null }): string {
  return notificationPlainText(item.content?.text)
}

function openChild(item: { target_url?: string }): void {
  openNotificationTarget(item.target_url)
}

/** 分页：透传 older_than 游标（getNextPageParam → pageParam） */
function loadMore(): void {
  void query.fetchNextPage()
}

/** 分页失败 → 点击重试（fetchNextPage）；首屏失败 → refetch */
function retry(): void {
  if (pageError.value) loadMore()
  else void query.refetch()
}
</script>

<template>
  <!-- 子区容器：左缩进挂靠组头缩略图列，弱化底色区分主列表 -->
  <view class="mt-1 ml-[18vw] flex flex-col">
    <view
      v-if="firstError"
      class="py-2"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="NOTIFICATIONS_A11Y_LABELS.openItem"
      @tap="retry"
    >
      <text class="text-body-small text-error">{{ t('notifications.children.error') }}</text>
    </view>
    <view
      v-for="(child, idx) in children"
      :key="`${headerId}-${child.id}-${idx}`"
      class="py-2 pr-2 border-b-[1px] border-b-outline-variant"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="NOTIFICATIONS_A11Y_LABELS.openItem"
      @tap="openChild(child)"
    >
      <text class="text-body-small text-surface-on leading-snug [max-line:2]">{{ rowText(child) || t('notifications.noContent') }}</text>
      <text class="text-label-small text-outline mt-1">{{ formatRelativeTime(child.created_datetime) }}</text>
    </view>
    <!-- 子列表分页 footer：older_than 游标继续（next_url null → 尽头 affordance 隐藏加载更多） -->
    <view
      v-if="query.isFetchingNextPage.value || pageError || endOfFeed"
      class="h-8 flex items-center"
      @tap="retry"
    >
      <text v-if="query.isFetchingNextPage.value" class="text-label-medium text-outline">{{ t('notifications.children.loading') }}</text>
      <text v-else-if="pageError" class="text-label-medium text-error">{{ t('notifications.children.error') }}</text>
      <text v-else class="text-label-medium text-outline">{{ t('notifications.children.end') }}</text>
    </view>
  </view>
</template>

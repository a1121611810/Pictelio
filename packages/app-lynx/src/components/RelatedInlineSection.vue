<script setup lang="ts">
// 相关作品卡内展开段（spec docs/specs/related-injection.md §5.2 v2，ADR-0162）。
// 渲染缝从「列表条目交织」下沉为锚点卡 list-item 内部条件段：
// 不发生 list 级 list-item 插入（lynx 瀑布流中途插入被 patch 静默丢弃，
// 取证 2026-09-15）→ 紧贴锚点卡成立、滚动位置保留。
// 哑组件：props 进 emits 出，store 接线归宿主页面（可测性：依赖注入）。
// @tap 不在 openDetail 冒泡域内（宿主把段放包裹 view 兄弟位），缩略图直发 open。
import type { RelatedRow } from '../stores/relatedInjection'
import { RELATED_GRID_SIZE } from '../stores/relatedInjection'
import { thumbUrl } from '../utils/imageUrl'
import { t } from '../i18n'
import SkeletonImage from './SkeletonImage.vue'

defineProps<{
  /** 该锚点卡的注入行（loading 态渲染骨架占位） */
  row: RelatedRow
}>()

const emit = defineEmits<{
  collapse: []
  open: [id: number]
}>()
</script>

<template>
  <view class="mt-2 mx-2.5 mb-2.5 pt-2 border-t-[1px] border-t-outline-variant flex flex-col">
    <!-- 头行：段标题 + 收起 -->
    <view class="flex flex-row items-center justify-between">
      <text class="text-title-small font-medium text-surface-on">{{ t('illustList.related.title') }}</text>
      <view
        accessibility-element
        :accessibility-label="t('illustList.related.collapseA11y')"
        @tap="emit('collapse')"
      >
        <text class="text-body-small text-outline">{{ t('illustList.related.collapse') }}</text>
      </view>
    </view>
    <!-- loading：骨架占位（与填充态同高，防卡高跳动） -->
    <view v-if="row.loading" class="flex flex-row flex-wrap gap-2 mt-2">
      <view v-for="n in RELATED_GRID_SIZE" :key="n" class="w-[20vw] h-[20vw] rounded-[var(--md-shape-medium)] bg-surface-variant" />
    </view>
    <view v-else class="flex flex-row flex-wrap gap-2 mt-2">
      <!-- 卡内 2×2 网格（RELATED_GRID_SIZE=4，spec §5.2 v2） -->
      <view
        v-for="rel in row.items.slice(0, RELATED_GRID_SIZE)"
        :key="rel.id"
        accessibility-element
        :accessibility-label="t('illustList.related.viewA11y', { title: rel.title })"
        class="w-[20vw] h-[20vw] rounded-[var(--md-shape-medium)] overflow-hidden"
        @tap="emit('open', rel.id)"
      >
        <SkeletonImage :src="thumbUrl(rel.image_urls)" height="20vw" lazy-load />
      </view>
    </view>
  </view>
</template>

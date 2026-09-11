import { computed, type ComputedRef, type Ref } from "vue";
import { useSettingsStore } from "../stores/settingsStore";

/** AI 判定所需的最小字段形状（插画/小说通用） */
export interface AiFilterable {
  illust_ai_type?: number;
  novel_ai_type?: number;
}

/**
 * 「仅看」态可见集（ADR-0155）：过滤掉 only 模式下的非 AI 条目；show/mask 原样返回
 * （mask 由渲染层盖 AI 遮罩卡，不在数据层移除）。
 *
 * 收敛各列表页重复的 `computed(() => items.filter((i) => !isAiOnlyFiltered(i)))`，
 * 避免新增页面时该接缝再度复制（code-review S2）。
 * @param toItem 从集合元素取 AI 字段对象（默认元素自身；搜索结果行为 `(row) => row.entity`）
 */
export function useAiOnlyVisible<T>(
  items: Ref<T[]>,
  toItem: (item: T) => AiFilterable = (item) => item as unknown as AiFilterable,
): ComputedRef<T[]> {
  const isAiOnlyFiltered = useSettingsStore().isAiOnlyFiltered;
  return computed(() => items.value.filter((item) => !isAiOnlyFiltered(toItem(item))));
}

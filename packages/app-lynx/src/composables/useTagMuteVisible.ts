import { computed, type ComputedRef, type Ref } from "vue";
import { useSettingsStore } from "../stores/settingsStore";

/** 标签静音判定所需的最小字段形状（PixivIllust.tags / PixivNovel.tags 兼容） */
export interface TagMuteable {
  tags?: { name: string }[] | null;
}

/**
 * 标签静音可见集（ADR-0187 D4 / #732）：过滤掉任一标签命中静音词表的条目——
 * 「静音 = 看不见」，数据层移除（非遮罩），与 R18/AI 的遮罩语义有意不同（ADR-0187 D4）。
 *
 * 收敛各列表页对 `!settings.isTagMuted(item)` 的重复过滤（useAiOnlyVisible 同款接缝，
 * code-review S2 先例）；通常与 useAiOnlyVisible 链式组合：
 * `const visible = useTagMuteVisible(useAiOnlyVisible(items))`。
 * @param toItem 从集合元素取标签对象（默认元素自身；包装条目传 `(it) => it.data`）
 */
export function useTagMuteVisible<T>(
  items: Ref<T[]> | ComputedRef<T[]>,
  toItem: (item: T) => TagMuteable = (item) => item as unknown as TagMuteable,
): ComputedRef<T[]> {
  const isTagMuted = useSettingsStore().isTagMuted;
  return computed(() => items.value.filter((item) => !isTagMuted(toItem(item))));
}

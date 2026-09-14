// ─── 收藏标签选择 reducer 纯函数（T3 / issue #531，spec docs/specs/bookmark-tags.md D5）───
// 与 webview 同语义、独立实现（spec D5：无双端共享包）。纯函数：不改变传入数组，
// 返回新数组，便于 UI 层整体替换状态与 node 单测。
// 10 个上限为官方 App 行为（docs/research/bookmark-tags-similar-clients.md §4）。

/** 每作品收藏标签上限（官方双源） */
export const BOOKMARK_TAG_LIMIT = 10

/** toggleBookmarkTag 结果：rejected = "limit" 表示超限拒收且已选集未变（命名与 webview 同名对齐，便于双端差分） */
export interface ToggleBookmarkTagResult {
  selected: string[];
  rejected?: "limit";
}

/** commitBookmarkTagToken 结果：error 指明拒绝原因且已选集未变 */
export interface CommitBookmarkTagTokenResult {
  selected: string[];
  error?: "empty" | "duplicate" | "limit";
}

/**
 * 勾选/取消一个收藏标签（toggle 语义）：
 * - 已在已选集中 → 移除（取消勾选，永不受上限约束）；
 * - 不在且未满上限 → 有序追加到尾部；
 * - 不在且已满 limit → 拒收（rejected = "limit"），已选集不变。
 * 同一标签 toggle 两次回到初始状态（幂等）。
 */
export function toggleBookmarkTag(
  selected: readonly string[],
  tag: string,
  limit: number = BOOKMARK_TAG_LIMIT,
): ToggleBookmarkTagResult {
  if (selected.includes(tag)) {
    return { selected: selected.filter((t) => t !== tag) }
  }
  if (selected.length >= limit) {
    return { selected: [...selected], rejected: "limit" }
  }
  return { selected: [...selected, tag] }
}

/**
 * 提交新建标签 token（面板内联输入，空格即提交，spec D5/D11）：
 * - raw trim 后为空 → error = "empty"；
 * - trim 后与已选重复 → error = "duplicate"（判定优先于上限，语义是「该标签已存在」）；
 * - 未重复但已满 limit → error = "limit"；
 * - 通过校验 → trim 值有序追加到尾部。
 * 含内部空格的 token 原样入集——服务端会按空格切分，属生态位已知行为（spec D11）。
 */
export function commitBookmarkTagToken(
  selected: readonly string[],
  raw: string,
  limit: number = BOOKMARK_TAG_LIMIT,
): CommitBookmarkTagTokenResult {
  const token = raw.trim()
  if (token === "") {
    return { selected: [...selected], error: "empty" }
  }
  if (selected.includes(token)) {
    return { selected: [...selected], error: "duplicate" }
  }
  if (selected.length >= limit) {
    return { selected: [...selected], error: "limit" }
  }
  return { selected: [...selected, token] }
}

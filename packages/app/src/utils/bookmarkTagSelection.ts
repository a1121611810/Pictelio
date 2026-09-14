// ─── 收藏面板标签选择纯函数（ADR-0160 D5 / spec docs/specs/bookmark-tags.md D5） ───
// 无 UI 依赖、无 i18n 依赖：错误以判别字符串返回，由 UI 层（T2 收藏面板）翻译展示。
// 标签上限 10 见 docs/adr/glossary-bookmark-tags.md「标签上限」（官方双源）。

/** 每作品收藏标签上限（官方双源；面板展示与 reducer 默认值共用此单一常量） */
export const BOOKMARK_TAG_LIMIT = 10;

/** toggleBookmarkTag 结果：rejected="limit" 表示第 11 个被拒收（已选集不变），UI 层据此反馈 */
export interface ToggleBookmarkTagResult {
  selected: string[];
  rejected?: "limit";
}

/** commitBookmarkTagToken 错误判别：empty=trim 后空串、duplicate=与已选重复、limit=超上限 */
export type CommitBookmarkTagTokenError = "empty" | "duplicate" | "limit";

export interface CommitBookmarkTagTokenResult {
  selected: string[];
  error?: CommitBookmarkTagTokenError;
}

/**
 * 勾选/取消一个收藏标签（spec D5 面板状态模型）：
 * - 未选中 → 按勾选顺序追加（有序）；
 * - 已选中 → 移除（取消勾选）；连续 toggle 两次回到初始态（幂等）；
 * - 已满 limit（默认 BOOKMARK_TAG_LIMIT，第 11 个）→ 拒收，返回 rejected="limit" 且已选集不变。
 * 纯函数：不修改入参数组。
 */
export function toggleBookmarkTag(
  selected: string[],
  tag: string,
  limit = BOOKMARK_TAG_LIMIT,
): ToggleBookmarkTagResult {
  if (selected.includes(tag)) {
    return { selected: selected.filter((t) => t !== tag) };
  }
  if (selected.length >= limit) {
    return { selected, rejected: "limit" };
  }
  return { selected: [...selected, tag] };
}

/**
 * 新建收藏标签 token 提交（spec D5/D11：输入以「空格提交 token」承接，这里只管单 token 校验）：
 * trim 后依次校验——空串拒绝（empty）、与已选重复拒绝（duplicate）、超上限拒绝（limit）；
 * 通过则并入已选尾部。纯函数：不修改入参数组。
 */
export function commitBookmarkTagToken(
  selected: string[],
  raw: string,
  limit = BOOKMARK_TAG_LIMIT,
): CommitBookmarkTagTokenResult {
  const token = raw.trim();
  if (token.length === 0) {
    return { selected, error: "empty" };
  }
  if (selected.includes(token)) {
    return { selected, error: "duplicate" };
  }
  if (selected.length >= limit) {
    return { selected, error: "limit" };
  }
  return { selected: [...selected, token] };
}

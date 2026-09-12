/**
 * 收藏数客户端兜底过滤（spec §7）：bookmark 区间参数对免费账号被服务端静默忽略、
 * 对 popular-preview 端点被完全忽略（研究文档 §7）——本地按 total_bookmarks 过滤
 * 让筛选对所有人真实生效（Shaft 先例：客户端兜底让区间在非会员路径上也成立）。
 * 调用方决定何时应用（非热门路径 + 收藏数激活时）；热门路径置灰不应用（#478）。
 */
import type { BookmarkBand } from "./filters";

export function filterByBookmarkBand<T extends { total_bookmarks: number }>(
  items: readonly T[],
  band: BookmarkBand | null,
): T[] {
  if (band === null) return items as T[];
  return items.filter(
    (it) =>
      it.total_bookmarks >= band.min && (band.max === null || it.total_bookmarks <= band.max),
  );
}

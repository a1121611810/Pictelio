/**
 * 搜索结果 LRU 缓存键（spec §6.2）：word_scope_sort + 筛选规范段。
 * 筛选必须进键——否则换筛选命中脏缓存（#476 派生结论：正确性硬要求）。
 * aiOverride=follow 不落键（跟随账号设置的结果与无覆盖一致）。
 */
import { BOOKMARK_BANDS, isDefaultFilters, type SearchFilters } from "./filters";
import type { SearchScope, SearchSort } from "./buildParams";

export function buildCacheKey(
  word: string,
  scope: SearchScope,
  sort: SearchSort,
  filters: SearchFilters,
): string {
  const base = `${word}_${scope}_${sort}`;
  if (isDefaultFilters(filters)) return base;
  const seg: string[] = [];
  if (filters.period.kind === "preset") seg.push(`fp=${filters.period.preset}`);
  else if (filters.period.kind === "custom") seg.push(`fd=${filters.period.start}_${filters.period.end}`);
  if (filters.bookmark !== null) {
    const idx = BOOKMARK_BANDS.findIndex(
      (b) => b.min === filters.bookmark!.min && b.max === filters.bookmark!.max,
    );
    seg.push(idx >= 0 ? `fb=${idx}` : `fb=${filters.bookmark.min}-${filters.bookmark.max ?? "x"}`);
  }
  if (filters.ratio !== null) seg.push(`fr=${filters.ratio}`);
  if (filters.minPixels !== null) seg.push(`fw=${filters.minPixels}`);
  if (filters.aiOverride !== "follow") seg.push(`fa=${filters.aiOverride}`);
  return `${base}|${seg.join("|")}`;
}

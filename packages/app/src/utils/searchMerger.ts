import type { PixivIllust, PixivNovel, SearchResultItem } from "@/api/types";

/**
 * 将 search/illust 和 search/novel 的结果按 create_date 降序合流为单一时间线。
 * 同一 create_date 毫秒内的条目保持 illust → novel 排序。
 */
export function mergeSearchResults(
  illusts: PixivIllust[],
  novels: PixivNovel[],
): SearchResultItem[] {
  const items: SearchResultItem[] = [
    ...illusts.map((i) => ({ type: "illust" as const, entity: i, date: i.create_date })),
    ...novels.map((n) => ({ type: "novel" as const, entity: n, date: n.create_date })),
  ];

  items.sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    // 同一日期时 illust 优先（同类型返回 0，满足 sort 一致弱序反称性——修复前同类型对返回 1 违反弱序，依赖 V8 稳定排序）
    return a.type === b.type ? 0 : a.type === "illust" ? -1 : 1;
  });

  return items;
}

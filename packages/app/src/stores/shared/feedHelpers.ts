import type { PixivIllust } from "../../api/types";
import { apiClient } from "../../api/client";

/** 去重：按 illust.id */
export function dedupIllusts(items: PixivIllust[]): PixivIllust[] {
  const seen = new Set<number>();
  return items.filter((i) => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

/** 下一页 API 请求（pageParam 有值 → apiClient.get，否则调初始 loader） */
export function nextPageOrLoad(
  pageParam: string | undefined,
  initialLoader: (
    signal?: AbortSignal,
  ) => Promise<{ illusts: PixivIllust[]; next_url: string | null }>,
  signal?: AbortSignal,
): Promise<{ items: PixivIllust[]; next_url: string | null }> {
  if (pageParam) {
    return apiClient
      .get<{ illusts: PixivIllust[]; next_url: string | null }>(pageParam, undefined, signal)
      .then((r) => ({ items: r.illusts, next_url: r.next_url }));
  }
  return initialLoader(signal).then((r) => ({ items: r.illusts, next_url: r.next_url }));
}

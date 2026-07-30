import type { PixivNovel } from "../../api/types";
import { apiClient } from "../../api/client";

type NovelListResponse = { novels: PixivNovel[]; next_url: string | null };

/** Response adapter: { novels, next_url } → { items, next_url } */
export function adaptNovelResponse(
  pageParam: string | undefined,
  loader: (signal?: AbortSignal) => Promise<NovelListResponse>,
  signal?: AbortSignal,
): Promise<{ items: PixivNovel[]; next_url: string | null }> {
  if (pageParam) {
    return apiClient
      .get<NovelListResponse>(pageParam, undefined, signal)
      .then((r) => ({ items: r.novels, next_url: r.next_url }));
  }
  return loader(signal).then((r) => ({ items: r.novels, next_url: r.next_url }));
}

/** 去重：按 novel.id */
export function dedupNovels(items: PixivNovel[]): PixivNovel[] {
  const seen = new Set<number>();
  return items.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });
}

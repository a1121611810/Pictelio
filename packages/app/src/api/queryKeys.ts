import type { RestrictType, SearchSort, SearchTarget } from "./types";

/**
 * CreateInfiniteQuery 的 queryKey 工厂。
 *
 * 每个 key 以资源类型（"illust" / "novel" / "user"）开头，
 * 支持前缀级批量失效：
 *   queryClient.invalidateQueries({ queryKey: ["illust"] })
 *   → 清除所有作品相关缓存（logout 时安全清空数据）
 *
 * as const 保证 TypeScript 精确推导 key 的结构和长度。
 *
 * ── Phase 1 ──
 *   bookmarks()   → ["illust", "bookmarks", userId, restrict]
 *   userIllusts() → ["illust", "userWorks", userId, type]
 *   userNovels()  → ["novel", "userWorks", userId]
 *   followList()  → ["user", "followList", mode, userId]
 *
 * ── Phase 2 追加 ──
 *   feed()        → ["illust", "feed", tab, subTab]
 *   novelFeed()   → ["novel", "feed", tab, subTab]
 *
 * ── Phase 3 追加 ──
 *   userDetail()  → ["user", "detail", userId]
 *   illustDetail()→ ["illust", "detail", illustId]
 */
export const queryKeys = {
  bookmarks: (userId: number, restrict: RestrictType) =>
    ["illust", "bookmarks", userId, restrict] as const,

  /** Only "illust" | "manga" — novel type uses userNovels() */
  userIllusts: (userId: number, type: "illust" | "manga") =>
    ["illust", "userWorks", userId, type] as const,

  userNovels: (userId: number) => ["novel", "userWorks", userId] as const,

  followList: (mode: "following" | "followers", userId: number) =>
    ["user", "followList", mode, userId] as const,

  searchIllust: (
    word: string,
    sort: SearchSort = "date_desc",
    searchTarget: SearchTarget = "partial_match_for_tags",
  ) => ["search", "illust", word, sort, searchTarget] as const,

  searchNovel: (
    word: string,
    sort: SearchSort = "date_desc",
    searchTarget: SearchTarget = "partial_match_for_tags",
  ) => ["search", "novel", word, sort, searchTarget] as const,

  searchAutocomplete: (word: string) => ["search", "autocomplete", word] as const,

  /** 相关作品（spec docs/specs/related-injection.md）：["related", illustId] */
  related: (illustId: number) => ["related", illustId] as const,
} as const;

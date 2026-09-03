// ─── Query Key 工厂（ADR-0141 D3 / T2 foundation）───
// 所有 query / mutation key 通过工厂函数构造，便于：
// - 防止散落 string literal 拼写错（集中管理 + 类型约束）
// - invalidateQueries({ queryKey: queryKeys.illusts.all }) 前缀匹配批量失效
// - 跨组件 / 跨页共享同一 key 引用，命中同一缓存条目
//
// 设计原则：
// 1. `as const` + 数组顺序敏感（v5.102.8）：同 key 顺序 = 命中同一缓存条目
//    例如 queryKeys.illusts.detail(1) 与 queryKeys.illusts.detail(2) 是不同条目
//    queryKeys.illusts.all 是 queryKeys.illusts.detail(N) 的前缀
// 2. mutation key 不在工厂里（mutation key 是逻辑分组，与 query 分组无重叠）
//    业务代码用 setMutationDefaults(['illust', 'bookmark'], ...) 模式
// 3. ref 包装交给 useQuery 内部（MaybeRefDeep），工厂返回 plain tuple
// 4. 嵌套命名空间（illusts / novels / users / search / watchlist / settings）
//    顶层 'pictelio' 前缀保证 invalidate 全局缓存不影响其他应用（理论上）
//
// ⚠️ 命名空间顺序敏感：`['pictelio', 'illusts', id]` 与 `['pictelio', 'id', 'illusts']`
//    是不同 key——保持本文件的层序。

export const queryKeys = {
  all: ['pictelio'] as const,

  illusts: {
    all: ['pictelio', 'illusts'] as const,
    /** 推荐插画（首页 Carousel）：illusts.recommended() */
    recommended: () => ['pictelio', 'illusts', 'recommended'] as const,
    /** 关注用户插画：illusts.follow(restrict) */
    follow: (restrict: 'public' | 'private' | 'all' = 'public') =>
      ['pictelio', 'illusts', 'follow', restrict] as const,
    /** 我的插画收藏：illusts.bookmarks(restrict, tag?) */
    bookmarks: (restrict: 'public' | 'private' = 'public', tag?: string) =>
      ['pictelio', 'illusts', 'bookmarks', restrict, tag ?? null] as const,
    /** 详情：illusts.detail(id) */
    detail: (id: number) => ['pictelio', 'illusts', 'detail', id] as const,
    /** 用户作品列表：illusts.userIllusts(userId) */
    userIllusts: (userId: number) => ['pictelio', 'illusts', 'user', userId] as const,
    /** 评论根列表（illust）：illusts.comments(id) */
    comments: (id: number) => ['pictelio', 'illusts', 'detail', id, 'comments'] as const,
  },

  novels: {
    all: ['pictelio', 'novels'] as const,
    recommended: () => ['pictelio', 'novels', 'recommended'] as const,
    follow: (restrict: 'public' | 'private' | 'all' = 'public') =>
      ['pictelio', 'novels', 'follow', restrict] as const,
    bookmarks: (restrict: 'public' | 'private' = 'public', tag?: string) =>
      ['pictelio', 'novels', 'bookmarks', restrict, tag ?? null] as const,
    detail: (id: number) => ['pictelio', 'novels', 'detail', id] as const,
    series: (seriesId: number) => ['pictelio', 'novels', 'series', seriesId] as const,
    comments: (id: number) => ['pictelio', 'novels', 'detail', id, 'comments'] as const,
  },

  users: {
    all: ['pictelio', 'users'] as const,
    detail: (id: number) => ['pictelio', 'users', 'detail', id] as const,
    illusts: (id: number) => ['pictelio', 'users', 'detail', id, 'illusts'] as const,
    following: (id: number) => ['pictelio', 'users', 'detail', id, 'following'] as const,
    followers: (id: number) => ['pictelio', 'users', 'detail', id, 'followers'] as const,
  },

  search: {
    all: ['pictelio', 'search'] as const,
    illust: (q: string, params: { sort?: string; target?: string; page?: number } = {}) =>
      ['pictelio', 'search', 'illust', q, params.sort ?? null, params.target ?? null, params.page ?? 1] as const,
    novel: (q: string, params: { sort?: string; target?: string; page?: number } = {}) =>
      ['pictelio', 'search', 'novel', q, params.sort ?? null, params.target ?? null, params.page ?? 1] as const,
  },

  watchlist: {
    all: ['pictelio', 'watchlist'] as const,
    novel: (page: number = 1) => ['pictelio', 'watchlist', 'novel', page] as const,
  },

  settings: {
    all: ['pictelio', 'settings'] as const,
    updateCheck: () => ['pictelio', 'settings', 'update-check'] as const,
  },
} as const

/**
 * Mutation key 工厂（与 query key 命名空间平行但解耦）。
 * Vue Query v5 mutation 不需要 queryKey 也能跑——但项目用 setMutationDefaults
 * 模式集中配置 mutationFn / onMutate 时需要稳定的 key。命名规范：
 * ['mutation', '<resource>', '<action>']
 */
export const mutationKeys = {
  illustBookmark: () => ['mutation', 'illust', 'bookmark'] as const,
  novelWatchlist: () => ['mutation', 'novel', 'watchlist'] as const,
  userFollow: () => ['mutation', 'user', 'follow'] as const,
  illustComment: () => ['mutation', 'illust', 'comment'] as const,
  novelComment: () => ['mutation', 'novel', 'comment'] as const,
} as const

/**
 * 统一 invalidate helper（项目内 invalidate 集中收口）。
 * - invalidateAllIllusts() 包含 illusts.all 前缀，命中所有 illust 相关 query
 * - 用 queryClient.invalidateQueries({ queryKey }) 跨组件订阅失效
 */
export const invalidateKeys = {
  illust: ['pictelio', 'illusts'] as const,
  novel: ['pictelio', 'novels'] as const,
  user: (id: number) => ['pictelio', 'users', 'detail', id] as const,
  watchlist: ['pictelio', 'watchlist'] as const,
}
// ─── Query Key 工厂（ADR-0141 D3）───
// 所有 query / mutation key 通过工厂函数构造，便于：
// - 防止散落 string literal 拼写错
// - invalidateQueries({ queryKey: queryKeys.illusts.all }) 前缀匹配批量失效
// - 后续 T2 会扩展完整（novels / users / search / watchlist / settings）
//
// as const + 数组顺序敏感（v5.102.8）：同 key 顺序 = 命中同一缓存条目。
// ref 包装交给 useQuery 内部（MaybeRefDeep），工厂返回 plain tuple。

export const queryKeys = {
  all: ['pictelio'] as const,
  illusts: {
    all: ['pictelio', 'illusts'] as const,
    detail: (id: number) => ['pictelio', 'illusts', id] as const,
    recommended: () => ['pictelio', 'illusts', 'recommended'] as const,
  },
} as const

// 未来扩展点（T2 完整化）：
//   novels: { all, detail, recommended },
//   users: { all, detail, illusts },
//   search: { all, illust, novel },
//   watchlist: { all },
//   settings: { all, updateCheck },
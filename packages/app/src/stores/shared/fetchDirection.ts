/**
 * v6 适配层：fetchMeta.fetchMore.direction 在类型声明中缺失但运行时存在（core result 展开 state）。
 * 经 unknown 收窄读取；供 feed / ranking store 区分「分页追加（forward）」与「下拉刷新 refetch」。
 * 单点定义避免各 store 逐字复制 v6 workaround（TanStack 升级只改一处）。
 */
export function fetchDirection(q: unknown): string | undefined {
  return (q as { fetchMeta?: { fetchMore?: { direction?: string } } }).fetchMeta?.fetchMore
    ?.direction;
}

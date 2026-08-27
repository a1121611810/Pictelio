// 时间交叉合并（time-merge）纯函数（ADR-0114 / spec: app-lynx-feed-pagination-buttons §3.1）。
// oracle = app 端 createTQFeedStore.ts L151-169：
//   sortByDate = [...items].sort((a, b) => b.create_date.localeCompare(a.create_date))（降序、稳定）
//   mergeAndSort = 稳定合并，a.create_date >= b.create_date 取 a（同分 = sources 顺序靠前者优先）
// 扩展：多路（k≥1）稳定合并；create_date 缺失沉底 + console.warn（测试硬约束 3：非静默降级）。
// 零依赖（纯 TS，node 可测），getDate 提取器让调用方决定 create_date 的取值位置（MixFeedItem 在 data 上）。

/** 稳定降序排序（ISO 日期字符串字典序 = 时间序；缺失日期按空串沉底） */
export function sortByDateDesc<T>(
  items: T[],
  getDate: (item: T) => string | undefined,
): T[] {
  // ES Array.prototype.sort 稳定（现代引擎保证），同分保持原始（服务端）顺序
  return [...items].sort((a, b) => {
    const da = getDate(a) ?? ''
    const db = getDate(b) ?? ''
    return db.localeCompare(da)
  })
}

/**
 * 多路 items 按 create_date 降序交叉合并：
 * - 每路先稳定降序（缺失日期沉底）
 * - 稳定 k 路合并：每轮取各路头部 create_date 最大者；同分取 sources 顺序靠前者（index 小者），
 *   与 app 端 mergeAndSort「a.create_date >= b.create_date 取 a」语义一致
 * - create_date 缺失的条目 console.warn（非静默降级，测试硬约束 3）
 */
export function mergeByTime<T>(
  sources: T[][],
  getDate: (item: T) => string | undefined,
): T[] {
  const sorted = sources.map((items, idx) => {
    for (const it of items) {
      if (!getDate(it)) {
        console.warn(`[mergeByTime] 第 ${idx} 路存在缺失 create_date 的条目（沉底处理）`, it)
      }
    }
    return sortByDateDesc(items, getDate)
  })

  const out: T[] = []
  const cursors = sorted.map(() => 0)
  let remaining = sorted.reduce((n, s) => n + s.length, 0)
  while (remaining > 0) {
    let best = -1
    let bestDate = ''
    for (let i = 0; i < sorted.length; i++) {
      const c = cursors[i]
      if (c >= sorted[i].length) continue
      const d = getDate(sorted[i][c]) ?? ''
      // 严格大于才换：同分保留先选中的路（sources 顺序靠前者优先）
      if (best === -1 || d > bestDate) {
        best = i
        bestDate = d
      }
    }
    // 不变式：remaining > 0 时必有可推进的路（best 不会为 -1）
    out.push(sorted[best][cursors[best]++])
    remaining--
  }
  return out
}

// 排行榜静音行派生（ADR-0187 D4 / #732，ADR-0158 保序精神）：
// 名次必须在**预过滤**阶段按服务端流下标赋值（rank = 下标 + 1），静音过滤只做移除、
// 不重排——被移除条目留名次空洞，后续名次不前移，跨页名次不漂移（与 webview 排行榜
// R18 语义对齐：受限条目保名次，本页 R18 走遮罩保留，静音走移除留洞，两者并存有意差异）。
// 纯函数（node 可测）：名次保序测试见 rankingRows.test.ts。

/** 排行榜渲染行：条目 + 预过滤名次 */
export interface RankedRow<T> {
  item: T
  /** 名次 = 该条目在服务端流中的下标 + 1（预过滤赋值，静音移除后保持不变） */
  rank: number
}

/**
 * 先按流下标赋名次，再应用静音过滤（命中即移除、留名次空洞）。
 * @param items 服务端返回顺序的完整流（未过滤）
 * @param isMuted 静音判定谓词（settingsStore.isTagMuted）
 */
export function assignRanksThenDropMuted<T>(
  items: readonly T[],
  isMuted: (item: T) => boolean,
): RankedRow<T>[] {
  const rows: RankedRow<T>[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (isMuted(item)) continue // 名次空洞：跳过但不收缩后续名次
    rows.push({ item, rank: i + 1 })
  }
  return rows
}

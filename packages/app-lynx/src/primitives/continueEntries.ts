// ─── 继续读聚合条目（ADR-0219 §2.1 / 术语文档易混辨析 #2 / 票 #927）───
// 书架段 3 与 `/continue` 完整列表**同段同页**装两类条目：小说「续读条目」+ 插画「浏览记录条目」。
//
// 📌 **只做展示聚合，不做数据混合**：本文件不 import 任何 store，纯函数把两条轴的条目
//   映射成同一个行视图模型并按**最近活动**统一倒序。数据层两条轴仍物理隔离
//   （两个 store、两个键、零重叠）——ADR-0219 §2.5 是它们**唯一**的共享决策（呈现）。
//
// 📌 **纯函数、不 import store**（深模块可测，node 下直测无需 prefs/auth 桩）：
//   照 primitives/novelNavigationTarget 范式。
import type { ContinueReadingItem } from "../stores/continueReadingStore"
import type { BrowsingHistoryItem } from "../stores/browsingHistoryStore"
import { decideContinueLabel } from "../stores/continueReadingStore"

/** 条目类型（二值，与作品类型一一对应——插画 vs 小说，天然不相交） */
export type ContinueEntryKind = "novel" | "illust"

/** 行视图模型：段 3 行与 /continue 行共用同一形状（ContinueRow 的唯一入参） */
export interface ContinueEntry {
  kind: ContinueEntryKind
  /**
   * 列表 key：`n-${novelId}` / `h-${illustId}`。
   * 📌 **必须带类型前缀**：小说 id 与插画 id 是两套独立 id 空间，同号可撞；
   *   共用 `:key` / `item-key` 时撞号会让原生 `<list>` 复用错行（ADR-0162 索引错位族）。
   */
  key: string
  /** 导航 id：小说 = novelId，插画 = illustId（分流后才有意义） */
  id: number
  title: string
  coverUrl: string
  userName: string
  xRestrict: number
  unavailable: boolean
  /** 最近活动时刻（排序唯一依据：小说 lastOpenedAt / 插画 visitedAt） */
  at: number
  /**
   * 行内状态文案参数（「上次读到 第N话」）：**仅小说**且坐标可算时非 null。
   * 📌 插画恒为 null ⇒ 该行**不渲染**状态文案——浏览历史没有「读到哪」可言
   *   （术语文档易混辨析 #2）。坐标不可算的小说（单本/脏数据）同样为 null，不推算。
   */
  chapterNo: number | null
}

function toNovelEntry(item: ContinueReadingItem): ContinueEntry {
  const hit = decideContinueLabel(item)
  return {
    kind: "novel",
    key: `n-${item.novelId}`,
    id: item.novelId,
    title: item.title,
    coverUrl: item.coverUrl,
    userName: item.userName,
    xRestrict: item.xRestrict,
    unavailable: item.unavailable === true,
    at: item.lastOpenedAt,
    chapterNo: hit === null ? null : hit.chapterNo,
  }
}

function toIllustEntry(item: BrowsingHistoryItem): ContinueEntry {
  return {
    kind: "illust",
    // 📌 插画侧**恒无状态文案**（不写「上次浏览…」——那会把流水说成位置）
    key: `h-${item.illustId}`,
    id: item.illustId,
    title: item.title,
    coverUrl: item.coverUrl,
    userName: item.userName,
    xRestrict: item.xRestrict,
    unavailable: item.unavailable === true,
    at: item.visitedAt,
    chapterNo: null,
  }
}

/**
 * 两轴混排（ADR-0219 §2.1「按最近活动倒序，两轴在同页内统一排序」）。
 * 📌 同一时刻的平手**按类型固定次序**（小说在前）而不是依赖入参数组顺序——
 *   否则两轴各自 hydrate 完成的不同时刻会渲染出不同排列（同一份数据两个序）。
 */
export function mergeContinueEntries(
  novels: readonly ContinueReadingItem[],
  illusts: readonly BrowsingHistoryItem[],
): ContinueEntry[] {
  return [
    ...novels.map(toNovelEntry),
    ...illusts.map(toIllustEntry),
  ].sort((a, b) => b.at - a.at || (a.kind === b.kind ? 0 : a.kind === "novel" ? -1 : 1))
}

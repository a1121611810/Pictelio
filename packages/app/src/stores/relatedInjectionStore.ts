import { createSignal, createStore } from "solid-js";
import { queryClient } from "@/api/queryClient";
import { loadRelated } from "@/api/illust";
import { filterFeedIllusts } from "@/utils/r18Filter";
import type { PixivIllust } from "@/api/types";
import { relatedInjection } from "./settingsStore";
import { queryKeys } from "@/api/queryKeys";

/**
 * 相关作品注入行状态机（spec docs/specs/related-injection.md §3/§4）。
 *
 * 语义：
 * - pendingAnchor：点击首页插画卡片时记录 {tab, illustId}，面板重新挂载时消费（一次性）；
 *   tab 不匹配时保留 pending（用户切 tab 后返回原 tab 仍可注入）。
 * - rows：每个 feed tab 会话内最多 MAX_RELATED_ANCHORS 行；下拉刷新 / 切 tab 清空。
 * - 行带 loading 态：消费锚点立即占位，related 请求成功后填充，失败移除并 warn。
 * - 去重：同锚点不重复注入；行内条目排除锚点自身与主列表已展示 id。
 */
export type RelatedFeedTab = "recommended" | "follow" | "bookmarks";

export interface RelatedRow {
  /** 锚点作品 id（行渲染在主列表该 id 卡片之后） */
  anchorId: number;
  /** 相关作品（已过滤；loading 期间为空数组） */
  items: PixivIllust[];
  /** related 请求进行中（渲染骨架占位） */
  loading: boolean;
}

/** 每个 tab 会话内最多注入的锚点行数（防列表膨胀不可追溯） */
export const MAX_RELATED_ANCHORS = 3;
/** 单行相关作品上限 */
export const RELATED_ROW_SIZE = 20;
/** related 查询缓存时长（同一作品反复进出零重复请求） */
const RELATED_STALE_TIME_MS = 5 * 60_000;

const emptyRows = (): Record<RelatedFeedTab, RelatedRow[]> => ({
  recommended: [],
  follow: [],
  bookmarks: [],
});

const [rowsByTab, setRowsByTab] = createStore<Record<RelatedFeedTab, RelatedRow[]>>(emptyRows());

const [pendingAnchor, setPendingAnchor] = createSignal<{
  tab: RelatedFeedTab;
  illustId: number;
} | null>(null);

/** Solid 2.0：createStore setter 为 draft-first（1.x 路径式写法已移除） */
function updateRows(tab: RelatedFeedTab, mutate: (rows: RelatedRow[]) => void): void {
  setRowsByTab((s) => {
    mutate(s[tab]);
  });
}

export const relatedRows = (tab: RelatedFeedTab): RelatedRow[] => rowsByTab[tab];

/** 点击首页插画卡片进详情前调用（仅首页插画面板调用，详情页内跳转不记录，防循环注入） */
export function recordRelatedAnchor(tab: RelatedFeedTab, illustId: number): void {
  setPendingAnchor({ tab, illustId });
}

/** 相关请求：经 TanStack Query 缓存去重（queryKey ["related", id]） */
async function fetchRelatedIllusts(illustId: number): Promise<PixivIllust[]> {
  const res = await queryClient.fetchQuery({
    queryKey: queryKeys.related(illustId),
    queryFn: ({ signal }) => loadRelated(illustId, signal),
    staleTime: RELATED_STALE_TIME_MS,
  });
  return res.illusts;
}

/**
 * 面板重新激活时消费 pendingAnchor（一次性；tab 不匹配时保留给正确的 tab）。
 * mainListIds：主列表当前已展示的作品 id（行内容排除重复）。
 * 任何失败路径（网络/畸形响应）不注入行，仅 warn（增强能力失败不影响主列表）。
 */
export async function consumeRelatedAnchor(
  tab: RelatedFeedTab,
  mainListIds: readonly number[],
): Promise<void> {
  const anchor = pendingAnchor();
  if (anchor === null || anchor.tab !== tab) return;
  setPendingAnchor(null);
  if (!relatedInjection()) return;
  if (rowsByTab[tab].some((r) => r.anchorId === anchor.illustId)) return;
  if (rowsByTab[tab].length >= MAX_RELATED_ANCHORS) return;

  const anchorId = anchor.illustId;
  // 先占位（骨架行），成功填充 / 失败移除
  updateRows(tab, (rows) => {
    rows.push({ anchorId, items: [], loading: true });
  });
  try {
    const seen = new Set<number>(mainListIds);
    seen.add(anchorId);
    const items = filterFeedIllusts(await fetchRelatedIllusts(anchorId))
      .filter((i) => !seen.has(i.id))
      .slice(0, RELATED_ROW_SIZE);
    if (items.length === 0) {
      updateRows(tab, (rows) => {
        const idx = rows.findIndex((r) => r.anchorId === anchorId);
        if (idx >= 0) rows.splice(idx, 1);
      });
      return;
    }
    updateRows(tab, (rows) => {
      const row = rows.find((r) => r.anchorId === anchorId);
      if (row) {
        row.items = items;
        row.loading = false;
      }
    });
  } catch (err) {
    updateRows(tab, (rows) => {
      const idx = rows.findIndex((r) => r.anchorId === anchorId);
      if (idx >= 0) rows.splice(idx, 1);
    });
    console.warn(`[relatedInjection] 相关作品加载失败（anchor=${anchorId}）`, err);
  }
}

/** 收起按钮：移除单行 */
export function removeRelatedRow(tab: RelatedFeedTab, anchorId: number): void {
  updateRows(tab, (rows) => {
    const idx = rows.findIndex((r) => r.anchorId === anchorId);
    if (idx >= 0) rows.splice(idx, 1);
  });
}

/** 下拉刷新 / 切 tab 重建 / 切 contentType：清空该 tab 会话内的全部注入行 */
export function clearRelatedRows(tab: RelatedFeedTab): void {
  updateRows(tab, (rows) => {
    rows.length = 0;
  });
}

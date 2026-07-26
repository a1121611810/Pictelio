/**
 * 小说缓存模块。
 *
 * 分层：
 *   L1 — 热缓存（同步 Map，≤10 篇） — 用于系列切章同帧渲染
 *   L2 — IndexedDB（持久化，≤200 篇） — 冷启动后无需网络请求
 *
 * 系列目录（series）独立，同样策略，≤10 热 / ≤100 持久。
 *
 * 测试通过 _useStore(createMemoryStore()) 注入内存存储。
 */

import { createIDBStore, type IDBStore } from "./db";
import type { PixivNovel, SeriesNavigation } from "@/api/types";
import {
  loadDetail,
  fetchNovelData,
  type NovelImagesMap,
  type NovelSeriesDetailResponse,
} from "@/api/novel";


// ─── Constants ───

const HOT_NOVELS_MAX = 10;
const HOT_SERIES_MAX = 10;
const MAX_NOVELS = 200;
const MAX_SERIES = 100;

// ─── Types ───

export interface CacheEntry {
  detail: PixivNovel;
  text: string;
  nav: SeriesNavigation;
  images: NovelImagesMap;
}

export interface SeriesCacheEntry {
  detail: NovelSeriesDetailResponse["novel_series_detail"];
  novels: PixivNovel[];
  nextUrl: string | null;
}

/** 小说缓存条目的外部别名（用于 loader 等场景）。 */
export type NovelCacheEntry = CacheEntry;

// ─── Store (production: IndexedDB; test: injected) ───

let store: IDBStore | null = null;

function getStore(): IDBStore {
  if (!store) {
    store = createIDBStore();
  }
  return store;
}

/** 仅供测试注入。用 createMemoryStore() 即可不同测试间隔离。 */
/** @internal 仅供测试注入内存存储。 */
export function setTestStore(s: IDBStore): void {
  store = s;
}

// ─── Hot cache ───

const hotNovels = new Map<number, CacheEntry>();
const hotSeries = new Map<number, SeriesCacheEntry>();
const hotNovelInsertOrder: number[] = [];
const hotSeriesInsertOrder: number[] = [];

function setHotNovel(id: number, entry: CacheEntry): void {
  if (hotNovels.has(id)) {
    // 更新时提升到 MRU 位置
    const idx = hotNovelInsertOrder.indexOf(id);
    if (idx !== -1) {
      hotNovelInsertOrder.splice(idx, 1);
    }
    hotNovels.set(id, entry);
    hotNovelInsertOrder.push(id);
    return;
  }
  if (hotNovels.size >= HOT_NOVELS_MAX) {
    const evict = hotNovelInsertOrder.shift();
    if (evict !== undefined) {
      hotNovels.delete(evict);
    }
  }
  hotNovels.set(id, entry);
  hotNovelInsertOrder.push(id);
}

function setHotSeries(id: number, entry: SeriesCacheEntry): void {
  if (hotSeries.has(id)) {
    const idx = hotSeriesInsertOrder.indexOf(id);
    if (idx !== -1) {
      hotSeriesInsertOrder.splice(idx, 1);
    }
    hotSeries.set(id, entry);
    hotSeriesInsertOrder.push(id);
    return;
  }
  if (hotSeries.size >= HOT_SERIES_MAX) {
    const evict = hotSeriesInsertOrder.shift();
    if (evict !== undefined) {
      hotSeries.delete(evict);
    }
  }
  hotSeries.set(id, entry);
  hotSeriesInsertOrder.push(id);
}

// ─── Cleanup helpers ───

async function enforceLimits(storeName: "novels" | "series", max: number): Promise<void> {
  const count = await getStore().count(storeName);
  if (count <= max) {
    return;
  }
  const all = await getStore().getAll<{ id: number; cachedAt: number }>(storeName);
  all.sort((a, b) => a.cachedAt - b.cachedAt);
  const toDelete = all.slice(0, all.length - max);
  await Promise.all(toDelete.map((e) => getStore().delete(storeName, e.id)));
}

// ─── Public API ───

/** 同步读热缓存（不触及 IndexedDB） */
export function peekEntry(id: number): CacheEntry | undefined {
  return hotNovels.get(id);
}

/** 同步读热缓存（系列） */
export function peekSeries(id: number): SeriesCacheEntry | undefined {
  return hotSeries.get(id);
}

/**
 * 异步取小说缓存。
 *
 * 查找顺序：热缓存 → IndexedDB → undefined。
 * 若从 IndexedDB 命中，自动灌入热缓存。
 */
export async function getEntry(id: number): Promise<CacheEntry | undefined> {
  const hot = hotNovels.get(id);
  if (hot) {
    return hot;
  }

  const fromDB = await getStore().get<{
    id: number;
    detail: PixivNovel;
    text: string;
    nav: SeriesNavigation;
    images: NovelImagesMap;
    cachedAt: number;
  }>("novels", id);

  if (fromDB) {
    const entry: CacheEntry = {
      detail: fromDB.detail,
      text: fromDB.text,
      nav: fromDB.nav,
      images: fromDB.images,
    };
    setHotNovel(id, entry);
    return entry;
  }

  return undefined;
}

/** 异步取系列缓存。 */
export async function getSeries(id: number): Promise<SeriesCacheEntry | undefined> {
  const hot = hotSeries.get(id);
  if (hot) {
    return hot;
  }

  const fromDB = await getStore().get<{
    id: number;
    detail: SeriesCacheEntry["detail"];
    novels: PixivNovel[];
    nextUrl: string | null;
    cachedAt: number;
  }>("series", id);

  if (fromDB) {
    const entry: SeriesCacheEntry = {
      detail: fromDB.detail,
      novels: fromDB.novels,
      nextUrl: fromDB.nextUrl,
    };
    setHotSeries(id, entry);
    return entry;
  }

  return undefined;
}

/** 写入缓存（IndexedDB + 热缓存）。写入后自动清理超限条目。 */
export async function setEntry(id: number, data: CacheEntry): Promise<void> {
  const now = Date.now();
  const [err] = await tryAsync(
    (async () => {
      await getStore().put("novels", { id, ...data, cachedAt: now });
      await enforceLimits("novels", MAX_NOVELS);
    })(),
  );
  if (err) {
    console.warn("[novelCache] Failed to persist entry", id, err);
  }
  setHotNovel(id, data);
}

/**
 * 加载小说详情与正文。
 *
 * 这是 `/novel/$id` 路由 loader 与系列内章节切换的统一入口。
 *
 * 详情与正文并行请求；正文提取失败会被静默吞掉，返回空 text、空 navigation、
 * 空 images 的条目，调用方仍可正常渲染详情页。为避免把无效结果固化到缓存，
 * 只有在 text 非空时才写入 IndexedDB / 热缓存。
 */

export async function loadNovelEntry(id: number): Promise<NovelCacheEntry> {
  const [detailRes, novelDataRes] = await Promise.all([
    tryAsync(loadDetail(id)),
    tryAsync(fetchNovelData(id)),
  ]);
  const [detailErr, detail] = detailRes;
  const [novelDataErr, novelData] = novelDataRes;
  const safeNovelData = novelDataErr
    ? { text: "", navigation: {} as SeriesNavigation, images: {} as NovelImagesMap }
    : novelData;
  if (detailErr) throw detailErr;
  const entry: NovelCacheEntry = {
    detail: detail.novel,
    text: safeNovelData.text,
    nav: safeNovelData.navigation,
    images: safeNovelData.images ?? {},
  };
  if (entry.text) {
    await setEntry(id, entry);
  }
  return entry;
}

/** 写入系列缓存。 */
export async function setSeries(id: number, data: SeriesCacheEntry): Promise<void> {
  const now = Date.now();
  const [err] = await tryAsync(
    (async () => {
      await getStore().put("series", { id, ...data, cachedAt: now });
      await enforceLimits("series", MAX_SERIES);
    })(),
  );
  if (err) {
    console.warn("[novelCache] Failed to persist series", id, err);
  }
  setHotSeries(id, data);
}

/** 清空所有缓存（IndexedDB + 热缓存）。 */
export async function clearAll(): Promise<void> {
  hotNovels.clear();
  hotSeries.clear();
  hotNovelInsertOrder.length = 0;
  hotSeriesInsertOrder.length = 0;
  await getStore().clear("novels");
  await getStore().clear("series");
}

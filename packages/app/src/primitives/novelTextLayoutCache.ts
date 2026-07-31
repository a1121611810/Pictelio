import type { NovelTextLayoutResult } from "./createNovelTextLayout";
import type { ReaderSettings } from "@/stores/readerSettingsStore";

interface CacheEntry {
  novelId: number;
  containerWidth: number;
  settings: ReaderSettings;
  /** 译文维度标识：原文为 ""，显示译文时为 "translated"（防止原文↔译文切换命中旧布局不重排） */
  variant: string;
  result: NovelTextLayoutResult;
  lastAccessed: number;
}

const MAX_CACHE_ENTRIES = 3;
// 变化绝对值严格小于 1px 视为命中
const WIDTH_TOLERANCE = 1;

const cache: CacheEntry[] = [];

export interface NovelTextLayoutCache {
  /** 获取缓存的布局结果，若未命中或参数变化则返回 undefined；variant 区分原文/译文布局 */
  get(
    novelId: number,
    containerWidth: number,
    settings: ReaderSettings,
    variant?: string,
  ): NovelTextLayoutResult | undefined;
  /** 写入缓存 */
  set(
    novelId: number,
    containerWidth: number,
    settings: ReaderSettings,
    result: NovelTextLayoutResult,
    variant?: string,
  ): void;
}

function settingsEqual(a: ReaderSettings, b: ReaderSettings): boolean {
  return (
    a.fontSize === b.fontSize &&
    a.fontWeight === b.fontWeight &&
    a.fontFamily === b.fontFamily &&
    a.lineHeight === b.lineHeight
  );
}

function findEntryIndex(
  novelId: number,
  containerWidth: number,
  settings: ReaderSettings,
  variant: string,
): number {
  return cache.findIndex(
    (entry) =>
      entry.novelId === novelId &&
      Math.abs(entry.containerWidth - containerWidth) < WIDTH_TOLERANCE &&
      settingsEqual(entry.settings, settings) &&
      entry.variant === variant,
  );
}

/**
 * 构造缓存 key。只包含影响布局结果的参数：novelId、容器宽度、字号、字重、字体、行高、译文维度。
 */
export function buildCacheKey(
  novelId: number,
  containerWidth: number,
  settings: ReaderSettings,
  variant = "",
): string {
  return [
    novelId,
    containerWidth,
    settings.fontSize,
    settings.fontWeight,
    settings.fontFamily,
    settings.lineHeight,
    variant,
  ].join(":");
}

function createCache(): NovelTextLayoutCache {
  return {
    get(novelId, containerWidth, settings, variant = "") {
      const index = findEntryIndex(novelId, containerWidth, settings, variant);
      if (index === -1) {
        return undefined;
      }

      const entry = cache[index];
      // 更新宽度为最新值，并移动到末尾表示最近使用
      entry.containerWidth = containerWidth;
      entry.lastAccessed = Date.now();
      cache.splice(index, 1);
      cache.push(entry);
      return entry.result;
    },

    set(novelId, containerWidth, settings, result, variant = "") {
      const index = findEntryIndex(novelId, containerWidth, settings, variant);
      if (index !== -1) {
        cache.splice(index, 1);
      }

      cache.push({
        novelId,
        containerWidth,
        settings,
        variant,
        result,
        lastAccessed: Date.now(),
      });

      // 淘汰最久未使用的条目
      while (cache.length > MAX_CACHE_ENTRIES) {
        cache.shift();
      }
    },
  };
}

const cacheInstance: NovelTextLayoutCache = createCache();

/** 获取全局缓存实例 */
export function getNovelTextLayoutCache(): NovelTextLayoutCache {
  return cacheInstance;
}

/** 清空全部缓存条目 */
export function clearNovelTextLayoutCache(): void {
  cache.length = 0;
}

/** @deprecated 仅用于兼容旧命名，等价于 getNovelTextLayoutCache().set(...) */
export function setNovelTextLayoutCache(
  novelId: number,
  containerWidth: number,
  settings: ReaderSettings,
  result: NovelTextLayoutResult,
): void {
  cacheInstance.set(novelId, containerWidth, settings, result);
}

/**
 * 浏览历史存储模块。
 *
 * 本地 localStorage 集合实现（ADR-0144 D2：替换 @tanstack/solid-db，其无 solid-js 2.0 适配）。
 * L1 — 集合内存（模块级 Map）
 * L2 — localStorage 持久化（全量序列化单 key）
 *
 * 磁盘格式契约（与 @tanstack/db localStorageCollectionOptions 字节兼容，老数据无缝延续）：
 *   localStorage[STORAGE_KEY] = { "s:<key>": { versionKey: string, data: HistoryEntry } }
 * 过期策略：写入前懒清除 visitedAt < 30 天的条目。
 * 用户隔离：复合 key `${userId}_${type}_${id}`。
 */

import type { PixivIllust, PixivNovel } from "@/api/types";
import { user } from "@/stores/authStore";
import { getAiType } from "@/utils/aiFilter";

// ─── Types ───

export interface HistoryEntry {
  key: string;
  // Pixiv API 返回的 id 实际为字符串
  userId: string;
  authorId?: number;
  type: "illust" | "novel";
  id: number;
  title: string;
  userName: string;
  thumbnailUrl: string;
  xRestrict: 0 | 1 | 2;
  /** Pixiv AI 类型：0/undefined=非 AI，1=AI 辅助，2=纯 AI（ADR-0155） */
  aiType: number;
  visitedAt: number;
  visitCount: number;
}

/** @tanstack/db localStorageCollectionOptions 的存储包装条目（磁盘契约，见文件头）。 */
interface StoredItem {
  versionKey: string;
  data: HistoryEntry;
}

/** 集合公共接口（与原 solid-db 用法面等价：get/insert/update/delete/toArray）。 */
export interface HistoryCollection {
  get(key: string): HistoryEntry | undefined;
  insert(entry: HistoryEntry): void;
  update(key: string, updater: (draft: HistoryEntry) => void): void;
  delete(key: string): void;
  /** 快照数组（非响应式；响应式通知走 historyVersion）。 */
  readonly toArray: HistoryEntry[];
}

// ─── Constants ───

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = "pictelio-browsing-history";

// ─── Storage helpers ───

function generateVersionKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `v${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function encodeStorageKey(key: string): string {
  return `s:${key}`;
}

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

// ─── Collection ───

function createLocalHistoryCollection(): HistoryCollection {
  const items = new Map<string, HistoryEntry>();
  const storage = getStorage();

  // 启动加载一次：磁盘契约损坏 → warn + 空集合（静默降级零容忍）
  if (storage) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, StoredItem>;
        let skipped = 0;
        let missingAiType = 0;
        for (const [encoded, stored] of Object.entries(parsed)) {
          const key = encoded.startsWith("s:") ? encoded.slice(2) : encoded;
          if (stored && typeof stored === "object" && "data" in stored && stored.data) {
            // 老数据（ADR-0155 之前）无 aiType 字段：按 0（非 AI）迁移，显式 warn 不静默降级
            if (typeof stored.data.aiType !== "number") {
              missingAiType += 1;
              items.set(key, { ...stored.data, aiType: 0 });
            } else {
              items.set(key, stored.data);
            }
          } else {
            skipped += 1;
          }
        }
        if (skipped > 0) {
          console.warn(`[historyStore] 浏览历史存在 ${skipped} 条损坏条目，已跳过`);
        }
        if (missingAiType > 0) {
          console.warn(
            `[historyStore] 浏览历史 ${missingAiType} 条缺少 aiType，已按 0（非 AI）迁移`,
          );
        }
      }
    } catch (err) {
      console.warn("[historyStore] 浏览历史加载失败，已回退为空集合", err);
    }
  }

  function persist(): void {
    if (!storage) return;
    try {
      const objectData: Record<string, StoredItem> = {};
      items.forEach((entry, key) => {
        objectData[encodeStorageKey(key)] = { versionKey: generateVersionKey(), data: entry };
      });
      storage.setItem(STORAGE_KEY, JSON.stringify(objectData));
    } catch (err) {
      console.warn("[historyStore] 浏览历史写入失败", err);
    }
  }

  return {
    get(key) {
      return items.get(key);
    },
    insert(entry) {
      items.set(entry.key, entry);
      persist();
    },
    update(key, updater) {
      const existing = items.get(key);
      if (!existing) return;
      const draft: HistoryEntry = { ...existing };
      updater(draft);
      items.set(key, draft);
      persist();
    },
    delete(key) {
      items.delete(key);
      persist();
    },
    get toArray() {
      return Array.from(items.values());
    },
  };
}

export const historyCollection = createLocalHistoryCollection();

/** 每次写入操作后递增，用于通知 HistoryPage 重新读取数据（toArray 不是响应式信号）。 */
export const historyVersion = createSignal(0);

// ─── Public API ───

/** 添加或更新浏览记录（去重）。从详情页数据加载成功时调用。 */
export function recordVisit(item: PixivIllust | PixivNovel, type: "illust" | "novel"): void {
  const currentUser = user();
  if (!currentUser) {
    return;
  }

  const id = item.id;
  const key = `${currentUser.id}_${type}_${id}`;

  // 尝试从集合中获取现有条目
  const existing = historyCollection.get(key);
  if (existing) {
    historyCollection.update(key, (draft: HistoryEntry) => {
      draft.visitedAt = Date.now();
      draft.visitCount += 1;
    });
  } else {
    historyCollection.insert({
      key,
      userId: String(currentUser.id),
      authorId: item.user.id,
      type,
      id,
      title: item.title,
      userName: item.user.name ?? "",
      thumbnailUrl: item.image_urls.square_medium ?? "",
      xRestrict: item.x_restrict as 0 | 1 | 2,
      aiType: getAiType(item),
      visitedAt: Date.now(),
      visitCount: 1,
    });
  }

  // 触发响应式更新
  historyVersion[1]((v) => v + 1);

  // 懒清除过期条目
  cleanupExpired();
}

/** 删除单条浏览记录。 */
export function removeHistoryEntry(key: string): void {
  historyCollection.delete(key);
  historyVersion[1]((v) => v + 1);
}

/** 清空当前用户的所有浏览记录。 */
export function clearAllHistory(): void {
  const currentUser = user();
  if (!currentUser) {
    return;
  }

  // 集合不支持按条件批量删除，遍历过滤
  const entries = historyCollection.toArray;
  for (const entry of entries) {
    if (String(entry.userId) === String(currentUser.id)) {
      historyCollection.delete(entry.key);
    }
  }
  historyVersion[1]((v) => v + 1);
}

/** 删除 30 天前的过期记录。 */
function cleanupExpired(): void {
  const cutoff = Date.now() - THIRTY_DAYS;
  const entries = historyCollection.toArray;
  for (const entry of entries) {
    if (entry.visitedAt < cutoff) {
      historyCollection.delete(entry.key);
    }
  }
}

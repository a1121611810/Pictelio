/**
 * 浏览历史存储模块。
 *
 * 基于 TanStack DB 的 localStorageCollectionOptions 实现。
 * L1 — 集合内存（TanStack DB 自动维护）
 * L2 — localStorage 持久化（全量序列化单 key）
 *
 * 过期策略：写入前懒清除 visitedAt < 30 天的条目。
 * 用户隔离：复合 key `${userId}_${type}_${id}`。
 */

import { createCollection } from "@tanstack/solid-db";
import { localStorageCollectionOptions } from "@tanstack/solid-db";
import type { PixivIllust, PixivNovel } from "@/api/types";
import { user } from "@/stores/authStore";

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
  visitedAt: number;
  visitCount: number;
}

// ─── Constants ───

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

// ─── Collection ───

export const historyCollection = createCollection(
  localStorageCollectionOptions<HistoryEntry, string>({
    id: "browsing-history",
    storageKey: "pictelio-browsing-history",
    getKey: (entry: HistoryEntry) => entry.key,
    startSync: true,
  }),
);

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

  // TanStack DB 不支持按条件批量删除，遍历过滤
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

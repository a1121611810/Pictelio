/**
 * 译文持久化缓存（决策 #24）。
 *
 * - 存储：IndexedDB `translations` store（DB_VERSION 2，见 db.ts），测试注入 createMemoryStore()
 * - LRU：200 章上限，淘汰最久未使用（对齐 novelCache.enforceLimits 模式）
 * - 失效：原文 sourceHash（spark-md5）变化 → 自动失效重翻
 * - 维度隔离：novelId + targetLang + modelId 复合 key 分开缓存，互不污染
 * - 只存纯文本段落（不存 HTML，防注入 + 与原文段落一一对应）
 * - 半成品（部分块失败）不写缓存（S4 断点续翻补充）
 */
import { createIDBStore, type IDBStore } from "@/stores/db";
import { tryAsync } from "@/utils/tryAsync";

// ─── Constants ───

export const TRANSLATION_STORE = "translations";
/** LRU 上限：200 章（决策 #24；单章 ≈30-40KB，200 章 ≈8MB） */
export const MAX_TRANSLATIONS = 200;
/** 默认目标语言（决策 #22：MVP 日/英 → 简中） */
export const DEFAULT_TARGET_LANG = "zh-Hans";

// ─── Types ───

interface TranslationCacheEntry {
  /** 复合 key hash（novelId + targetLang + modelId），FNV-1a 32bit */
  id: number;
  novelId: number;
  targetLang: string;
  modelId: string;
  /** 原文 md5（spark-md5），作者改文后自动失效 */
  sourceHash: string;
  /** 译文纯文本段落（与原文段落一一对应） */
  paragraphs: string[];
  /** 最后写入时间（LRU 排序依据） */
  cachedAt: number;
}

// ─── Store (production: IndexedDB; test: injected) ───

let store: IDBStore | null = null;

function getStore(): IDBStore {
  if (!store) {
    store = createIDBStore();
  }
  return store;
}

/** 仅供测试注入内存存储（对齐 novelCache.setTestStore 模式）。 */
export function setTestStore(s: IDBStore): void {
  store = s;
}

// ─── 复合 key hash ───

/** FNV-1a 32bit：novelId + targetLang + modelId → 稳定 number key */
export function buildTranslationKey(novelId: number, targetLang: string, modelId: string): number {
  let hash = 0x811c9dc5;
  const input = `${novelId}|${targetLang}|${modelId}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// ─── LRU 淘汰 ───

async function enforceTranslationLimits(max: number): Promise<void> {
  const count = await getStore().count(TRANSLATION_STORE);
  if (count <= max) {
    return;
  }
  const all = await getStore().getAll<{ id: number; cachedAt: number }>(TRANSLATION_STORE);
  all.sort((a, b) => a.cachedAt - b.cachedAt);
  const toDelete = all.slice(0, all.length - max);
  await Promise.all(toDelete.map((e) => getStore().delete(TRANSLATION_STORE, e.id)));
}

// ─── Public API ───

/**
 * 读译文缓存。sourceHash 不匹配（作者改文）视为未命中（自动失效）。
 * 命中时更新 cachedAt 提升 MRU 位置。
 */
export async function getTranslation(
  novelId: number,
  targetLang: string,
  modelId: string,
  sourceHash: string,
): Promise<string[] | undefined> {
  const id = buildTranslationKey(novelId, targetLang, modelId);
  const [err, entry] = await tryAsync(getStore().get<TranslationCacheEntry>(TRANSLATION_STORE, id));
  if (err) {
    console.warn("[translationCache] 读取失败", err);
    return undefined;
  }
  if (!entry || entry.sourceHash !== sourceHash) {
    return undefined;
  }
  // 触摸 MRU：重写 cachedAt（失败仅 warn，不阻断命中）
  if (Date.now() - entry.cachedAt > 60_000) {
    const [touchErr] = await tryAsync(
      getStore().put(TRANSLATION_STORE, { ...entry, cachedAt: Date.now() }),
    );
    if (touchErr) {
      console.warn("[translationCache] 触摸失败", touchErr);
    }
  }
  return entry.paragraphs;
}

/** 写译文缓存（纯文本段落）。写入后自动 LRU 淘汰超限条目。 */
export async function setTranslation(
  novelId: number,
  targetLang: string,
  modelId: string,
  sourceHash: string,
  paragraphs: string[],
): Promise<void> {
  const [err] = await tryAsync(
    (async () => {
      const id = buildTranslationKey(novelId, targetLang, modelId);
      await getStore().put(TRANSLATION_STORE, {
        id,
        novelId,
        targetLang,
        modelId,
        sourceHash,
        paragraphs,
        cachedAt: Date.now(),
      });
      await enforceTranslationLimits(MAX_TRANSLATIONS);
    })(),
  );
  if (err) {
    console.warn("[translationCache] 写入失败", err);
  }
}

/** 清空全部译文缓存（设置页入口）。 */
export async function clearTranslationCache(): Promise<void> {
  const [err] = await tryAsync(getStore().clear(TRANSLATION_STORE));
  if (err) {
    console.warn("[translationCache] 清除失败", err);
  }
}

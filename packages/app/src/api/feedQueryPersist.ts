/**
 * Feed 缓存持久化（T4，设计依据：docs/specs/webview-perf-round2.md §1，参数已在 spec 定死）。
 *
 * 为什么不用 PersistQueryClientProvider：其 restore 错误处理在生产环境静默 re-throw（见
 * query-persist-client-core persist.ts），不符合本仓库「静默降级零容忍」约束，故手动接线
 * persistQueryClientRestore + persistQueryClientSubscribe，由本模块的 restoreFeedCache 补外层 catch+warn。
 *
 * 范围：仅首页六路 feed（illust feed / bookmarks / novel feed），userWorks/followList/search 等页面独有
 * 数据不持久化（数据层分流硬约束：跨组件共享的 feed 才值得跨启动恢复）。
 */

import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
  type Persister,
  type PersistedClient,
} from "@tanstack/query-persist-client-core";
import {
  defaultShouldDehydrateQuery,
  type DehydrateOptions,
  type Query,
} from "@tanstack/solid-query";
import { queryClient } from "./queryClient";

/** 缓存版本戳：feed 数据结构/范围谓词变更时递增，使旧缓存被核心按 buster 不匹配自动丢弃 */
export const FEED_PERSIST_BUSTER = "tq-feed-v1";

/** 缓存最大年龄：7 天（spec 定死；过期由核心在 restore 时自动 removeClient，语义=无缓存） */
export const FEED_PERSIST_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

/** localStorage 键名（内部实现细节，不导出） */
const FEED_PERSIST_KEY = "pictelio:feed-query-cache";

/** 写回节流：trailing debounce（spec 定死 5000ms；核心 subscribe 无节流，节流必须在 persistClient 内做） */
const PERSIST_DEBOUNCE_MS = 5000;

/**
 * localStorage 单键配额约 5MB（UTF-16 码元），提前在 4.5MB 主动截断留出余量，
 * 避免写入时才撞 QuotaExceededError（序列化串长即 UTF-16 码元数，与 DOM storage 计量一致）。
 */
const MAX_SERIALIZED_LENGTH = 4.5 * 1024 * 1024;

/** novel feed 的合法第二段 key（novelBookmarkStore 的 "bookmarks" 与 illust 侧同名 key 同集） */
const NOVEL_FEED_SUBS = new Set(["recommended", "follow_public", "follow_private", "bookmarks"]);

/**
 * 持久化范围谓词：仅 ["feed",…] / ["bookmarks",…] / ["novel", NOVEL_FEED_SUBS…]，
 * 且必须为 success 态（defaultShouldDehydrateQuery）——error/pending 态入缓存只会让恢复后是坏数据。
 */
export function persistableFeedQuery(query: Query): boolean {
  const key = query.queryKey;
  if (!Array.isArray(key) || key.length === 0) return false;
  const [head, second] = key;
  const inScope =
    head === "feed" ||
    head === "bookmarks" ||
    (head === "novel" && NOVEL_FEED_SUBS.has(second as string));
  return inScope && defaultShouldDehydrateQuery(query);
}

const FEED_DEHYDRATE_OPTIONS: DehydrateOptions = {
  shouldDehydrateQuery: persistableFeedQuery,
};

/** 截断梯子：全量 → 每个 query 截 3 页 → 截 1 页（spec 定死；仍超则放弃写入） */
const TRUNCATE_LADDER = [Number.POSITIVE_INFINITY, 3, 1] as const;

/**
 * InfiniteData 截断：pages 与 pageParams 同步 slice，保持两数组对齐
 * （getNextPageParam 取末页 next_url，截断后语义仍安全——末页指向的下一页由后台重验兜底）。
 */
function truncatePages(client: PersistedClient, maxPages: number): PersistedClient {
  const queries = client.clientState.queries.map((query) => {
    const data = query.state.data as { pages?: unknown[]; pageParams?: unknown[] } | null;
    if (
      data &&
      typeof data === "object" &&
      Array.isArray(data.pages) &&
      Array.isArray(data.pageParams)
    ) {
      return {
        ...query,
        state: {
          ...query.state,
          data: {
            ...data,
            pages: data.pages.slice(0, maxPages),
            pageParams: data.pageParams.slice(0, maxPages),
          },
        },
      };
    }
    return query;
  });
  return { ...client, clientState: { ...client.clientState, queries } };
}

/**
 * 走配额梯子写入。超限主动截断与 setItem 抛 Quota 共用同一梯子：
 * 全量 → 截 3 页 → 截 1 页 → 仍失败则 removeItem + warn（绝不静默丢数据）。
 */
function writeToStorage(client: PersistedClient, storage: Storage): void {
  for (let i = 0; i < TRUNCATE_LADDER.length; i++) {
    const maxPages = TRUNCATE_LADDER[i]!;
    const isLast = i === TRUNCATE_LADDER.length - 1;
    const nextMaxPages = isLast ? 1 : TRUNCATE_LADDER[i + 1]!;
    const candidate =
      maxPages === Number.POSITIVE_INFINITY ? client : truncatePages(client, maxPages);
    const json = JSON.stringify(candidate);
    if (json.length > MAX_SERIALIZED_LENGTH) {
      // 末级仍超限（截 1 页也救不回）→ 放弃写入并删残留 key，绝不静默丢数据
      if (isLast) {
        try {
          storage.removeItem(FEED_PERSIST_KEY);
        } catch {
          /* 删失败只能放弃，下方 warn 已暴露 */
        }
        console.warn("[feedQueryPersist] 配额梯子全部失败（截 1 页仍超限），已删除持久化缓存");
        return;
      }
      // 主动截断是降级路径，必须可见（json.length 为 UTF-16 码元数，与 DOM storage 配额计量一致）
      console.warn(
        `[feedQueryPersist] 序列化超 ${MAX_SERIALIZED_LENGTH} 字符，截断到每 query ${nextMaxPages} 页重试`,
      );
      continue;
    }
    try {
      storage.setItem(FEED_PERSIST_KEY, json);
      return;
    } catch (err) {
      if (isLast) {
        try {
          storage.removeItem(FEED_PERSIST_KEY);
        } catch {
          /* 删失败只能放弃，下方 warn 已暴露 */
        }
        console.warn("[feedQueryPersist] 配额梯子全部失败（setItem 抛错），已删除持久化缓存", err);
        return;
      }
      console.warn(
        `[feedQueryPersist] setItem 失败（疑似配额），截断到每 query ${nextMaxPages} 页重试`,
        err,
      );
      continue;
    }
  }
}

/**
 * 探测 localStorage 可用性（隐私模式/SecurityError 会直接抛）。
 * 为什么探测而不是直接用：Android WebView 一般可用，但用户可关 DOM Storage；
 * 不可用时 warn 一次后整条持久化链路降级为 no-op，比每次读写抛错便宜且可控。
 */
function detectStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const probeKey = `${FEED_PERSIST_KEY}:probe`;
    localStorage.setItem(probeKey, "1");
    localStorage.removeItem(probeKey);
    return localStorage;
  } catch {
    return null;
  }
}

/** Persister + flush：flush 供 visibilitychange→hidden / pagehide 立即写回（不导出，内部类型） */
type FeedQueryPersister = Persister & { flush: () => void };

/**
 * 构造 feed Persister：
 * - persistClient 做 trailing debounce（合并 5s 窗口内的所有缓存事件，只写最新 payload 一次）；
 * - removeClient 取消挂起的 debounce（logout 清缓存后不允许旧 payload 回写）；
 * - restoreClient 解析失败（损坏 JSON/结构非法）时删 key + warn，让核心按「无缓存」处理；
 * - storage 探测失败 → warn 一次，restore/save 双 no-op。
 * storage 缺省时懒探测 localStorage（懒探测而非模块加载期探测：单测可先 vi.stubGlobal 再触发）。
 */
export function createFeedQueryPersister(storage?: Storage): FeedQueryPersister {
  // undefined=未探测；null=已探测且不可用
  let backend: Storage | null | undefined = storage;
  let pending: PersistedClient | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unavailableWarned = false;

  function ensureBackend(): Storage | null {
    if (backend !== undefined) return backend;
    backend = detectStorage();
    if (backend === null && !unavailableWarned) {
      unavailableWarned = true;
      console.warn("[feedQueryPersist] localStorage 不可用，feed 缓存持久化已禁用");
    }
    return backend;
  }

  function flush(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const payload = pending;
    pending = null;
    const target = backend;
    if (payload === null || !target) return;
    writeToStorage(payload, target);
  }

  return {
    persistClient(client) {
      // S2：logout 清缓存期间订阅仍在线，clear() 的 removed 事件携空快照到达——直接丢弃，
      // 否则 5s 后空快照会把刚删掉的持久化 key 原样写回
      if (suppressWrites) return;
      if (!ensureBackend()) return;
      // trailing：无条件保留最新 payload，窗口内多次事件合并为一次写入
      pending = client;
      if (timer === null) {
        timer = setTimeout(flush, PERSIST_DEBOUNCE_MS);
      }
    },
    restoreClient() {
      const target = ensureBackend();
      if (!target) return undefined;
      try {
        const raw = target.getItem(FEED_PERSIST_KEY);
        if (raw === null) return undefined;
        const parsed = JSON.parse(raw) as PersistedClient;
        const state = parsed?.clientState;
        if (
          typeof parsed?.timestamp !== "number" ||
          typeof parsed?.buster !== "string" ||
          !state ||
          !Array.isArray(state.queries)
        ) {
          target.removeItem(FEED_PERSIST_KEY);
          console.warn("[feedQueryPersist] 持久化结构非法，已删除缓存");
          return undefined;
        }
        return parsed;
      } catch (err) {
        // 损坏 JSON：当场删 key + warn（核心 restore 的 catch 会再 removeClient，双保险无害）
        try {
          target.removeItem(FEED_PERSIST_KEY);
        } catch {
          /* 删失败时核心 restore 路径还会再试 */
        }
        console.warn("[feedQueryPersist] 持久化 JSON 损坏，已删除缓存", err);
        return undefined;
      }
    },
    removeClient() {
      // clear 取消：logout 时先于 queryClient.clear() 调用，必须同时取消挂起的写回，
      // 否则 5s 后旧 payload 会把刚删掉的缓存原样写回（跨账号泄漏）
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      const target = backend;
      if (!target) return;
      try {
        target.removeItem(FEED_PERSIST_KEY);
      } catch (err) {
        console.warn("[feedQueryPersist] 删除持久化缓存失败", err);
      }
    },
    flush,
  };
}

/** 单例：应用级唯一 Persister（懒探测 localStorage） */
export const feedQueryPersister = createFeedQueryPersister();

/**
 * 写回抑制开关（S2 机器防线）：logout 的 queryClient.clear() 会逐 query 触发 removed 事件，
 * 订阅会把「空快照」经 5s debounce 写回刚删掉的 key（空 payload 复活）。抑制窗口覆盖 clear
 * 全程，persistClient 入口直接 no-op。模块级而非实例字段：订阅持有的是单例 persister，
 * 抑制必须对单例生效。
 */
let suppressWrites = false;

/** flush 监听只接线一次（restoreFeedCache 理论上可被多次调用，重复注册会造成重复 flush） */
let flushWired = false;

function wireFlushListeners(): void {
  if (flushWired || typeof window === "undefined" || typeof document === "undefined") return;
  flushWired = true;
  // Android 上切后台/销毁前没有正常退订时机，靠 hidden/pagehide 抢在进程冻结前把 5s 窗口内的变更落盘
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") feedQueryPersister.flush();
  });
  window.addEventListener("pagehide", () => feedQueryPersister.flush());
}

/**
 * 恢复持久化 feed 缓存到全局 queryClient 并开启后续写回订阅。
 *
 * 必须先于 persistQueryClientSubscribe 完成恢复；与 initializeAuth 并行无竞态：
 * query-core hydrate 以 dataUpdatedAt 守卫（hydration.ts: 仅当持久化数据比内存新才落状态），
 * 即使 auth 链路先写入了新 feed 数据，也不会被旧缓存覆盖。
 */
export async function restoreFeedCache(): Promise<void> {
  try {
    await persistQueryClientRestore({
      queryClient,
      persister: feedQueryPersister,
      maxAge: FEED_PERSIST_MAX_AGE,
      buster: FEED_PERSIST_BUSTER,
      // restore 是 hydrate 方向，不接 dehydrateOptions；谓词只在写回路径生效
    });
  } catch (err) {
    // 核心 restore 在生产环境静默 re-throw，必须由本包装补 warn（spec 失败矩阵）
    console.warn("[feedQueryPersist] restore 失败，已丢弃持久化缓存", err);
    return;
  }
  persistQueryClientSubscribe({
    queryClient,
    persister: feedQueryPersister,
    buster: FEED_PERSIST_BUSTER,
    dehydrateOptions: FEED_DEHYDRATE_OPTIONS,
  });
  wireFlushListeners();
}

/**
 * logout 原子清空（S2）：在抑制订阅写回的窗口内删持久化 feed 缓存并清空内存缓存。
 *
 * 为什么必须是单一入口而非调用方手写「clearPersistedFeeds + queryClient.clear()」两步：
 * clear() 逐 query 触发 removed 事件，restoreFeedCache 接线的订阅会把空快照经 5s debounce
 * 写回刚删掉的 key（空 payload 复活）。顺序：
 * 置 suppress → removeClient（删 key + 取消挂起 debounce，防跨账号恢复）→ clear()（removed
 * 事件被 persistClient 入口拦截）→ 恢复 suppress → 再 removeClient 一次兜底
 * （clear 期间若有任何意外写回排队，key 仍以「已删除」收尾）。
 */
export function clearPersistedFeedsAndCache(): void {
  suppressWrites = true;
  try {
    feedQueryPersister.removeClient();
    queryClient.clear();
  } finally {
    suppressWrites = false;
  }
  feedQueryPersister.removeClient();
}

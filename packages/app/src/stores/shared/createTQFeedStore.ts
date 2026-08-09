/**
 * createTQFeedStore
 *
 * 工厂函数：从重复的 feedStore / novelStore 中提取共享的
 * "TanStack Query InfiniteQuery wrapper + 响应式派生数据" 模式。
 *
 * 职责：
 *  - 根据 tab/subTab 配置创建对应的 createInfiniteQuery
 *  - 自动推导每个查询的 enabled（仅当前 tab + subTab 的查询运行）
 *  - 提供派生数据：items / nextUrl / loading / refreshing / error
 *  - 提供动作：ensureLoaded（router loader 预取）/ refresh / fetchMore
 *  - 处理 allMode merge/sort + 可选去重
 */

import type { Accessor } from "solid-js";
import { createInfiniteQuery } from "@tanstack/solid-query";
import { queryClient } from "../../api/queryClient";
import { normalizeQueryError } from "../../api/normalizeQueryError";
import { ApiErrorType, type ApiError } from "../../api/types";

// ─── 内部类型 ───

type PageResponse<T> = {
  items: T[];
  next_url: string | null;
};

type QueryDef<TItem, TDeps> = {
  queryKey: (deps: TDeps, pageParam: string | undefined) => unknown[];
  queryFn: (
    deps: TDeps,
    pageParam: string | undefined,
    signal?: AbortSignal,
  ) => Promise<PageResponse<TItem>>;
};

type AllMode = {
  type: "single" | "merge";
  /** merge 模式下参与合并的子 tab 列表 */
  subTabs: string[];
};

type TabQueriesDef<TItem, TDeps> = {
  allMode: AllMode;
  /** 当前选中的 subTab（含 "all"）。缺省则视为始终 "all" */
  getSubTab?: () => string;
  setSubTab?: (v: string) => void;
  /** 每个具体 subTab 对应的查询定义（不含 "all"） */
  queries: Record<string, QueryDef<TItem, TDeps>>;
};

/** 错误策略：priority=始终选最高优先级；allMustFail=多源时仅全部失败才报错 */
export type ErrorStrategy = "priority" | "allMustFail";

// ─── 公开类型 ───

export type TQFeedStoreConfig<
  TItem extends { id: number; create_date: string },
  TTab extends string,
  TDeps,
> = {
  /** 唯一标识，用于滚动持久化的 key 前缀 */
  name: string;

  /** 当前 tab（来自 uiStore 等外部状态） */
  currentTab: Accessor<TTab>;

  /**
   * 全局 enabled 条件（如 !!user()?.id）。
   * 工厂会自动 AND 上当前 tab + subTab 匹配条件，
   * 非活跃 tab 的查询不会在后台运行。
   */
  enabled: Accessor<boolean>;

  /** 共享响应式依赖（如 userId、restrict），传递给所有查询 */
  getDeps: () => TDeps;

  /** 每个 tab 的定义 */
  tabs: Record<TTab, TabQueriesDef<TItem, TDeps>>;

  /** 查询 stale 时间（毫秒），默认 30 秒 */
  staleTime?: number;

  /** 查询 gc 时间（毫秒），默认 30 分钟 */
  gcTime?: number;

  /**
   * 错误策略：
   * - "priority"（默认）：从所有活跃查询中选优先级最高的错误
   * - "allMustFail"：多源模式仅当所有数据源都失败时才显示错误（partial failure 隐藏）
   */
  errorStrategy?: ErrorStrategy;

  /** R18/R18G 过滤函数 */
  filterFn: (items: TItem[]) => TItem[];

  /** 可选去重函数（feedStore merge 模式需要） */
  dedupFn?: (items: TItem[]) => TItem[];

  /**
   * 延迟激活：true 时查询延迟到 activate() 调用后才启用。
   * 用于非默认 Tab 的 store，避免模块加载时立即发起请求。
   * 默认 false（模块加载即激活）。
   */
  lazy?: boolean;
};

export type TQFeedStoreResult<TItem> = {
  /** 当前 tab/subTab 下的过滤后数据 */
  items: Accessor<TItem[]>;

  /** 当前 tab 的 next_url（用于分页检测） */
  nextUrl: Accessor<string | null>;

  /** 当前活跃查询是否正在 fetch（首载） */
  loading: Accessor<boolean>;
  /** 是否正在下拉刷新 refetch（仅 refetch 第一页，不含分页追加，ADR-0078） */
  refreshing: Accessor<boolean>;
  /** 是否正在分页追加（fetchNextPage，ADR-0078） */
  loadingMore: Accessor<boolean>;

  /** 当前最具体的错误（按优先级选择） */
  error: Accessor<ApiError | null>;

  /** 判断当前 tab 是否有缓存数据 */
  isCached: () => boolean;

  /**
   * 路由 loader 预取：通过 queryClient.ensureInfiniteQueryData 触发
   */
  ensureLoaded: (_signal?: AbortSignal) => Promise<void>;

  /** 刷新当前 tab 所有活跃查询 */
  refresh: (_signal?: AbortSignal) => Promise<unknown[]>;

  /** 加载下一页（仅第一个活跃查询） */
  fetchMore: (_signal?: AbortSignal) => Promise<unknown> | undefined;

  /** 手动激活查询（lazy:true 的 store 在被调用前查询处于 disabled 状态） */
  activate: () => void;

  /** 是否已激活 */
  isActivated: Accessor<boolean>;
};

// ─── 通用算法 ───

function mergeAndSort<T extends { create_date: string }>(a: T[], b: T[]): T[] {
  const result: T[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].create_date >= b[j].create_date) {
      result.push(a[i++]);
    } else {
      result.push(b[j++]);
    }
  }
  result.push(...a.slice(i), ...b.slice(j));
  return result;
}

function sortByDate<T extends { create_date: string }>(items: T[]): T[] {
  // eslint-disable-next-line unicorn/no-array-sort
  return [...items].sort((a, b) => b.create_date.localeCompare(a.create_date));
}

function flattenPages<T>(data: { pages?: any[] }): T[] {
  if (!data?.pages) return [];
  // 兼容 Pixiv 原始格式 { illusts: [...] } 和工厂格式 { items: [...] }
  return data.pages.flatMap((p) => p.items ?? p.illusts ?? p.novels ?? []);
}

function getLastNextUrl(data: { pages?: any[] }): string | null {
  if (!data?.pages?.length) return null;
  return data.pages[data.pages.length - 1].next_url ?? null;
}

/** 错误类型优先级（索引越小越重要） */
const ERROR_PRIORITY: ApiErrorType[] = [
  ApiErrorType.PROXY,
  ApiErrorType.NETWORK,
  ApiErrorType.UNAUTHORIZED,
  ApiErrorType.RATE_LIMIT,
  ApiErrorType.FORBIDDEN,
  ApiErrorType.SERVER,
  ApiErrorType.UNKNOWN,
];

function pickBestError(errors: (ApiError | null)[]): ApiError | null {
  const filtered = errors.filter(Boolean) as ApiError[];
  if (filtered.length === 0) return null;
  let best = filtered[0];
  for (let i = 1; i < filtered.length; i++) {
    const curr = filtered[i];
    if (ERROR_PRIORITY.indexOf(curr.type) < ERROR_PRIORITY.indexOf(best.type)) {
      best = curr;
    }
  }
  return best;
}

// ─── 工厂 ───

export function createTQFeedStore<
  TItem extends { id: number; create_date: string },
  TTab extends string,
  TDeps,
>(config: TQFeedStoreConfig<TItem, TTab, TDeps>): TQFeedStoreResult<TItem> {
  return createRoot(() => {
    const configStaleTime = config.staleTime ?? 30_000;
    const configGcTime = config.gcTime ?? 30 * 60 * 1000;
    const configErrorStrategy: ErrorStrategy = config.errorStrategy ?? "priority";
    const isLazy = config.lazy === true;

    // ── 延迟激活门控 ──
    const [activated, setActivated] = createSignal(!isLazy);

    // ── 1. 创建所有查询（在单个 createRoot 下） ──

    const queryMap = new Map<string, ReturnType<typeof createInfiniteQuery>>();
    const queryDefMap = new Map<string, QueryDef<TItem, TDeps>>();

    for (const [tabKey, tabDef] of Object.entries(config.tabs) as [
      TTab,
      TabQueriesDef<TItem, TDeps>,
    ][]) {
      for (const [subKey, qDef] of Object.entries(tabDef.queries) as [
        string,
        QueryDef<TItem, TDeps>,
      ][]) {
        const mapKey = `${tabKey}:${subKey}`;

        // 存储 qDef 供 ensureLoaded 动态计算 queryKey
        queryDefMap.set(mapKey, qDef);

        queryMap.set(
          mapKey,
          createInfiniteQuery(
            () => {
              const deps = config.getDeps();

              return {
                queryKey: qDef.queryKey(deps, undefined),
                queryFn: ({
                  pageParam,
                  signal,
                }: {
                  pageParam: string | undefined;
                  signal?: AbortSignal;
                }) => qDef.queryFn(deps, pageParam, signal),
                getNextPageParam: (last: PageResponse<TItem>) => last.next_url ?? undefined,
                initialPageParam: undefined as string | undefined,

                /**
                 * 按需查询（ADR-0042）：禁用自动 fetch，由 ensureLoaded 驱动。
                 * enabled 设为 false，确保模块加载时不发起任何请求。
                 * 组件挂载 → 骨架屏渲染 → ensureLoaded → fetch 开始。
                 */
                enabled: false,

                staleTime: configStaleTime,
                gcTime: configGcTime,
              };
            },
            () => queryClient,
          ),
        );
      }
    }

    // ── 2. 查询辅助函数 ──

    /** 获取当前 tab 的定义 */
    function getCurrentTabDef(): TabQueriesDef<TItem, TDeps> | undefined {
      return config.tabs[config.currentTab()];
    }

    /** 获取当前 tab 下所有活跃查询的 map key 列表 */
    function activeKeys(): string[] {
      const tabDef = getCurrentTabDef();
      if (!tabDef) return [];

      const sub = tabDef.getSubTab?.();
      if (!sub || sub === "all") {
        return tabDef.allMode.subTabs.map((s) => `${config.currentTab()}:${s}`);
      }
      return [`${config.currentTab()}:${sub}`];
    }

    /** 获取活跃查询对象列表 */
    function activeQueries() {
      return activeKeys()
        .map((k) => queryMap.get(k))
        .filter(Boolean) as NonNullable<ReturnType<typeof queryMap.get>>[];
    }

    // ── 3. 派生数据 ──

    const items: Accessor<TItem[]> = () => {
      const tabDef = getCurrentTabDef();
      if (!tabDef) return [];

      const sub = tabDef.getSubTab?.();

      // 具体 subTab（非 "all"）→ 直接 flatten + filter
      if (sub && sub !== "all") {
        const q = queryMap.get(`${config.currentTab()}:${sub}`);
        if (!q) return [];
        return config.filterFn(flattenPages(q.data ?? {}) as TItem[]);
      }

      // "all" 模式
      const allCfg = tabDef.allMode;
      const sources = allCfg.subTabs
        .map((s) => queryMap.get(`${config.currentTab()}:${s}`))
        .filter(Boolean) as NonNullable<ReturnType<typeof queryMap.get>>[];

      if (sources.length === 0) return [];

      // single → 单数据源
      if (allCfg.type === "single") {
        return config.filterFn(flattenPages(sources[0].data ?? {}) as TItem[]);
      }

      // merge → 多数据源排序合并 + 可选去重
      const results = sources
        .map((q) => sortByDate(flattenPages(q.data ?? {}) as TItem[]))
        .filter((r) => r.length > 0);

      if (results.length === 0) return [];
      if (results.length === 1) return config.filterFn(results[0]);

      let merged = results.reduce((acc, curr) => mergeAndSort(acc, curr));
      if (config.dedupFn) {
        merged = config.dedupFn(merged);
      }
      return config.filterFn(merged);
    };

    const nextUrl: Accessor<string | null> = () => {
      const keys = activeKeys();
      if (keys.length === 0) return null;
      if (keys.length === 1) {
        const q = queryMap.get(keys[0]);
        return q ? getLastNextUrl(q.data ?? {}) : null;
      }
      // merge 模式：取第一个有值的 next_url
      for (const k of keys) {
        const q = queryMap.get(k);
        const url = q ? getLastNextUrl(q.data ?? {}) : null;
        if (url) return url;
      }
      return null;
    };

    const loading: Accessor<boolean> = () => activeQueries().some((q) => q.isFetching);

    // 语义分离（ADR-0078）：refreshing 仅指 refetch 第一页（下拉刷新）；
    // 分页追加用 loadingMore（isFetchingNextPage）——避免分页加载被误判为下拉刷新
    // （首页 A1 骨架遮罩曾因此把分页也渲染成清空重载）。
    const refreshing: Accessor<boolean> = () => activeQueries().some((q) => q.isRefetching);

    const loadingMore: Accessor<boolean> = () => activeQueries().some((q) => q.isFetchingNextPage);

    const error: Accessor<ApiError | null> = () => {
      if (configErrorStrategy === "allMustFail") {
        const qs = activeQueries();
        const errors = qs.map((q) => normalizeQueryError(q.error)).filter(Boolean) as ApiError[];
        if (errors.length === 0) return null;
        // 多源模式：只有所有源都失败才暴露错误
        if (errors.length < qs.length) return null;
        return pickBestError(errors);
      }

      // "priority" 策略：始终选优先级最高的错误
      const errors = activeQueries().map((q) => normalizeQueryError(q.error));
      return pickBestError(errors);
    };

    // ── 4. 缓存判断 ──

    const isCached = (): boolean => {
      return activeQueries().some((q) => ((q.data as any)?.pages?.length ?? 0) > 0);
    };

    // ── 5. 动作 ──

    const ensureLoaded = async (_signal?: AbortSignal): Promise<void> => {
      const keys = activeKeys();
      if (keys.length === 0) return;

      await Promise.all(
        keys.map((k) => {
          const def = queryDefMap.get(k);
          if (!def) return Promise.resolve();
          return queryClient.ensureInfiniteQueryData({
            queryKey: def.queryKey(config.getDeps(), undefined),
            staleTime: 30_000,
          } as any);
        }),
      );
    };

    const refresh = async (_signal?: AbortSignal): Promise<unknown[]> => {
      return Promise.all(activeQueries().map((q) => q.refetch()));
    };

    const fetchMore = (_signal?: AbortSignal): Promise<unknown> | undefined => {
      const first = activeQueries()[0];
      if (!first || !first.hasNextPage || first.isFetchingNextPage) {
        return undefined;
      }
      return first.fetchNextPage();
    };

    // ── 7. 公开 API ──

    return {
      items,
      nextUrl,
      loading,
      refreshing,
      loadingMore,
      error,
      isCached,
      ensureLoaded,
      refresh,
      fetchMore,
      activate: () => setActivated(true),
      isActivated: activated,
    };
  });
}

/**
 * notificationStore — 通知中心数据层（ADR-0188 D3/D5 / spec docs/specs/notification-center.md）。
 *
 * 职责分层：
 *   - 纯函数（node 可单测，本文件导出）：
 *       parseCreatedTimeMs        created_datetime → 毫秒（畸形串 → null 由调用方处置）
 *       countUnreadNotifications  未读推导真值表（严格晚于才计；解析失败不计 + warn）
 *       flattenNotifications      无限分页 accumulate（pages → 单列表，兼容 p.notifications）
 *       isGroupHeader             组头判定（view_more 非空）
 *       buildNotificationRows     组头展开「就地插入」行模型（展开单向不收起，spec 边界 9）
 *   - TanStack Query 消费面（rankingStore 形态，禁 createTQFeedStore——字段约束不符 + 能力闲置）：
 *       createNotificationsListStore       通知列表（queryKeys.notificationList，next_url 透传；
 *                                          v6 适配层「已提交页快照」姿态，见 rankingStore 同款注释）
 *       createNotificationChildrenStore    组头子列表（独立 query 键，older_than 游标分页）
 *   - 角标 + 本地已读记忆（ADR-0188 D5）：
 *       unreadCount                        入口角标数据源（SideNavShell fluent-badge）
 *       refreshUnreadBadge                 首屏 1 页静默拉取（入口挂载 + 前台恢复共用）
 *       registerNotificationResumeListener appStateChange 前台恢复节流（otaService 先例，≥5min）
 *       markNotificationsRead              通知页列表拉取成功后推进已读（失败不推进，spec 边界 10）
 *
 * 键 `notifications_last_read_time`：设备级、双端逐字同键（ADR-0103 共享介质）、不进备份域
 * （backupWiring BACKUP_RUNTIME_KEYS 排除，形态对齐 settings_webdav_last_backup）。
 */
import type { Accessor } from "solid-js";
import { createSignal } from "solid-js";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { useInfiniteQuery } from "@tanstack/solid-query";
import { queryClient } from "@/api/queryClient";
import { normalizeQueryError } from "@/api/normalizeQueryError";
import { loadNotifications, loadNotificationChildren } from "@/api/notification";
import { queryKeys } from "@/api/queryKeys";
import type { ApiError, PixivNotificationItem, PixivNotificationListResponse } from "@/api/types";
import { settings } from "@/settings";
import { fetchDirection } from "@/stores/shared/fetchDirection";

/** 设备级已读时间戳键（ISO 字符串；与 lynx 侧逐字一致，ADR-0188 D5） */
export const NOTIFICATIONS_LAST_READ_KEY = "notifications_last_read_time";

/** 前台恢复角标刷新的最小间隔（ADR-0188 D7：≥5min 节流，otaService 先例形态） */
export const RESUME_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000;

// ─── 设备级已读记忆（settings.define；写门槛由 registry 管线负责） ───

const lastReadHandle = settings.define<string>({
  key: NOTIFICATIONS_LAST_READ_KEY,
  default: "",
});

// ─── 纯函数：未读推导（spec 边界 6） ───

/** created_datetime → 毫秒；NaN（畸形串）返回 null 由调用方显式处置 */
export function parseCreatedTimeMs(createdDatetime: string): number | null {
  const ms = Date.parse(createdDatetime);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * 未读数 = created_datetime 严格晚于 lastReadMs 的条目数（等值不计——「看完那一刻」
 * 产生的通知才算新，ADR-0188 D5「晚于该键」）。lastReadMs 为 null（首次使用无键）→
 * 全部可解析条目计未读。解析失败该条不计 + console.warn（禁静默降级，测试硬约束 #3）。
 */
export function countUnreadNotifications(
  items: PixivNotificationItem[],
  lastReadMs: number | null,
): number {
  let count = 0;
  for (const item of items) {
    const ms = parseCreatedTimeMs(item.created_datetime);
    if (ms === null) {
      console.warn(
        "[notificationStore] 通知时间解析失败，该条不计未读: id=",
        item.id,
        "created_datetime=",
        item.created_datetime,
      );
      continue;
    }
    if (lastReadMs === null || ms > lastReadMs) count++;
  }
  return count;
}

// ─── 纯函数：分页 accumulate 与组头插入行模型 ───

/** 无限分页 accumulate：InfiniteData.pages → 单列表（flatten 兼容 p.notifications 顶层字段） */
export function flattenNotifications(
  pages: PixivNotificationListResponse[],
): PixivNotificationItem[] {
  const out: PixivNotificationItem[] = [];
  for (const page of pages) {
    if (page.notifications) out.push(...page.notifications);
  }
  return out;
}

/** 组头判定：view_more 非空（spec 术语表「组头」） */
export function isGroupHeader(item: PixivNotificationItem): boolean {
  return item.view_more != null;
}

/** 渲染行：item = 普通通知行 / header = 组头行 / children = 展开后的子列表区（就地插入） */
export interface NotificationRow {
  kind: "item" | "header" | "children";
  item: PixivNotificationItem;
  /** children 行持有组头 id（渲染子列表组件用） */
  headerId?: number;
  /** 列表 key（子区 key 绑组头 id——单组头单子区） */
  key: string;
}

/**
 * 组头展开「就地插入」：子区行紧跟其组头行之后、其余条目顺序不变。
 * 展开单向不收起（spec 边界 9）→ expandedHeaders 只增不减。
 */
export function buildNotificationRows(
  items: PixivNotificationItem[],
  expandedHeaders: Record<number, boolean>,
): NotificationRow[] {
  const rows: NotificationRow[] = [];
  for (const item of items) {
    if (isGroupHeader(item)) {
      rows.push({ kind: "header", item, key: `h-${item.id}` });
      if (expandedHeaders[item.id]) {
        rows.push({ kind: "children", item, headerId: item.id, key: `c-${item.id}` });
      }
    } else {
      rows.push({ kind: "item", item, key: `n-${item.id}` });
    }
  }
  return rows;
}

// ─── 角标 + 已读推进（模块级信号域，otaService gate 信号同形态） ───

const [unreadCountSig, setUnreadCountSig] = createSignal(0);
/** 入口角标未读数（SideNavShell fluent-badge 数据源） */
export const unreadCount: Accessor<number> = unreadCountSig;

/** 上次角标成功刷新的时刻（前台恢复节流基准；0 = 本会话尚未成功过） */
let lastBadgeRefreshAt = 0;

/** 测试专用：重置模块内节流状态 */
export function resetNotificationThrottleForTest(): void {
  lastBadgeRefreshAt = 0;
}

/** 读已读时间戳（毫秒）；键缺失 → null（首次使用，全部计未读）；存储值畸形 → warn + null（不静默） */
export function loadLastReadMs(): number | null {
  const raw = lastReadHandle.value();
  if (raw === "") return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    console.warn("[notificationStore] 已读时间戳值畸形，按首次使用处理:", raw);
    return null;
  }
  return ms;
}

/** 通知列表 query 的共享 fetcher（列表页 / 角标 fetchInfiniteQuery 同一形态） */
function notificationListFetcher({
  pageParam,
  signal,
}: {
  pageParam: string | undefined;
  signal?: AbortSignal;
}): Promise<PixivNotificationListResponse> {
  return loadNotifications(pageParam, signal);
}

/**
 * 入口角标静默刷新（ADR-0188 D7）：复用列表 query 的键与 queryFn 取首屏 1 页
 * （fetchInfiniteQuery pages:1，命中/填充同一缓存条目），仅更新计数；
 * 失败 warn 不打扰页面（保留上次计数，非静默）。
 */
export async function refreshUnreadBadge(): Promise<void> {
  try {
    const data = await queryClient.fetchInfiniteQuery({
      queryKey: queryKeys.notificationList(),
      queryFn: notificationListFetcher,
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: PixivNotificationListResponse) => last.next_url ?? undefined,
      pages: 1,
      staleTime: 0,
    } as never);
    const pages = (data as { pages?: PixivNotificationListResponse[] }).pages ?? [];
    setUnreadCountSig(countUnreadNotifications(pages[0]?.notifications ?? [], loadLastReadMs()));
    lastBadgeRefreshAt = Date.now();
  } catch (e) {
    console.warn("[notificationStore] 未读角标静默刷新失败（保留上次计数）", e);
  }
}

// ── 回前台节流刷新（otaService.registerOtaResumeListener 先例形态） ──

let resumeListenerRegistered = false;

/**
 * appStateChange 监听（authStore/otaService 先例）：回前台且距上次成功刷新 ≥5min
 * 才静默拉取，全程不打扰当前页。非原生环境（web/dev）显式跳过（console.info，禁静默吞错）。
 */
export function registerNotificationResumeListener(): void {
  if (!Capacitor.isNativePlatform()) {
    console.info("[notificationStore] 非原生环境跳过前台恢复监听（web/dev 预期）");
    return;
  }
  if (resumeListenerRegistered) return;
  resumeListenerRegistered = true;
  void App.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) return;
    if (Date.now() - lastBadgeRefreshAt < RESUME_REFRESH_MIN_INTERVAL_MS) return;
    void refreshUnreadBadge();
  });
}

/**
 * 已读推进（ADR-0188 D5 / spec 边界 10）：仅在通知页列表拉取**成功后**调用；
 * 写当前时刻 + 角标清零。存储写失败由 registry 管线 warn 可见（本会话内存态仍视为已读，
 * 下次启动读到旧时间戳未读自愈重现——不静默）。
 */
export function markNotificationsRead(now: Date = new Date()): void {
  lastReadHandle.set(now.toISOString());
  setUnreadCountSig(0);
}

/** 通知页列表结果接线：失败不推进（spec 边界 10——保证未读不丢），成功才 markNotificationsRead */
export function notifyListLoaded(success: boolean): void {
  if (!success) return;
  markNotificationsRead();
}

// ─── 通知列表（通知页主体，rankingStore 形态） ───

export interface NotificationsListStoreResult {
  /** 展平条目（保序：页序 × 页内序，不过滤不重排） */
  items: Accessor<PixivNotificationItem[]>;
  nextUrl: Accessor<string | null>;
  loading: Accessor<boolean>;
  refreshing: Accessor<boolean>;
  loadingMore: Accessor<boolean>;
  error: Accessor<ApiError | null>;
  paginationError: Accessor<boolean>;

  refresh: () => Promise<unknown>;
  fetchMore: () => Promise<unknown> | undefined;
}

export function createNotificationsListStore(): NotificationsListStoreResult {
  const [paginationError, setPaginationError] = createSignal(false);

  const q = useInfiniteQuery(
    () => ({
      queryKey: queryKeys.notificationList(),
      queryFn: notificationListFetcher,
      getNextPageParam: (last: PixivNotificationListResponse) => last.next_url ?? undefined,
      initialPageParam: undefined as string | undefined,
      // staleTime 0：每次进入页面重拉（角标刷新时机 = 页面挂载，ADR-0188 D7；
      // 亦保证「进入页拉取成功 → 推进已读」发生在最新数据上）
      staleTime: 0,
      gcTime: 30 * 60 * 1000,
    }),
    () => queryClient,
  );

  /**
   * 响应式路径**永不直接读 `q.data`**，只读「已提交页」快照 committedPages。
   * 完整依据见 rankingStore 同款注释（v6 适配层 computeData：进行中返回 Promise /
   * 未激活返回 NEVER，响应式作用域读到会让投影挂起）；快照在访问器被读取时刷新，
   * 仅当「fetchStatus 已落定且有数据」才展开 data()。重取（SWR / 下拉刷新）期间
   * 保留上一份已提交数据，列表不闪空。
   */
  let committedPages: PixivNotificationListResponse[] = [];
  const readCommittedPages = (): PixivNotificationListResponse[] => {
    if (q.fetchStatus === "idle" && q.dataUpdatedAt > 0) {
      committedPages = q.data?.pages ?? [];
    }
    return committedPages;
  };

  const items: Accessor<PixivNotificationItem[]> = () => flattenNotifications(readCommittedPages());

  const nextUrl: Accessor<string | null> = () => {
    const pages = readCommittedPages();
    if (pages.length === 0) return null;
    return pages[pages.length - 1]!.next_url ?? null;
  };

  // 首载粘滞：status=pending 视为加载中，避免骨架在首取前闪空态
  const loading: Accessor<boolean> = () =>
    q.fetchStatus === "fetching" || (q.status === "pending" && !q.error);
  const refreshing: Accessor<boolean> = () =>
    q.fetchStatus === "fetching" && q.status !== "pending" && fetchDirection(q) == null;
  const loadingMore: Accessor<boolean> = () =>
    q.fetchStatus === "fetching" && fetchDirection(q) === "forward";
  const error: Accessor<ApiError | null> = () => normalizeQueryError(q.error);

  const refresh = async (): Promise<unknown> => {
    setPaginationError(false);
    return q.refetch();
  };

  const fetchMore = (): Promise<unknown> | undefined => {
    if (!q.hasNextPage || q.isFetchingNextPage) return undefined;
    const hadError = q.isError;
    setPaginationError(false);
    const p = q.fetchNextPage();
    void Promise.resolve(p).then(
      () => {
        if (q.isError && !hadError) setPaginationError(true);
      },
      () => {
        // 兜底：即便 fetchNextPage 以 reject 结束，也标记为分页失败（保留已加载列表）
        setPaginationError(true);
      },
    );
    return p;
  };

  return {
    items,
    nextUrl,
    loading,
    refreshing,
    loadingMore,
    error,
    paginationError,
    refresh,
    fetchMore,
  };
}

// ─── 组头摊平子列表（每展开组头一个子组件实例，各自独立 query） ───

export interface NotificationChildrenStoreResult {
  items: Accessor<PixivNotificationItem[]>;
  loading: Accessor<boolean>;
  loadingMore: Accessor<boolean>;
  error: Accessor<ApiError | null>;
  nextUrl: Accessor<string | null>;
  fetchMore: () => Promise<unknown> | undefined;
}

/**
 * 组头摊平子列表：独立 query 键；首屏走 view-more?notification_id=，
 * 翻页透传 next_url（内含 older_than 游标）。在子组件作用域内调用（useInfiniteQuery 约束）。
 */
export function createNotificationChildrenStore(headerId: number): NotificationChildrenStoreResult {
  const q = useInfiniteQuery(
    () => ({
      queryKey: queryKeys.notificationChildren(headerId),
      queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal?: AbortSignal }) =>
        loadNotificationChildren(headerId, pageParam, signal),
      getNextPageParam: (last: PixivNotificationListResponse) => last.next_url ?? undefined,
      initialPageParam: undefined as string | undefined,
      staleTime: 0,
      gcTime: 30 * 60 * 1000,
    }),
    () => queryClient,
  );

  let committedPages: PixivNotificationListResponse[] = [];
  const readCommittedPages = (): PixivNotificationListResponse[] => {
    if (q.fetchStatus === "idle" && q.dataUpdatedAt > 0) {
      committedPages = q.data?.pages ?? [];
    }
    return committedPages;
  };

  const items: Accessor<PixivNotificationItem[]> = () => flattenNotifications(readCommittedPages());

  const nextUrl: Accessor<string | null> = () => {
    const pages = readCommittedPages();
    if (pages.length === 0) return null;
    return pages[pages.length - 1]!.next_url ?? null;
  };

  const loading: Accessor<boolean> = () =>
    q.fetchStatus === "fetching" || (q.status === "pending" && !q.error);
  const loadingMore: Accessor<boolean> = () =>
    q.fetchStatus === "fetching" && fetchDirection(q) === "forward";
  const error: Accessor<ApiError | null> = () => normalizeQueryError(q.error);

  const fetchMore = (): Promise<unknown> | undefined => {
    if (!q.hasNextPage || q.isFetchingNextPage) return undefined;
    return q.fetchNextPage();
  };

  return { items, loading, loadingMore, error, nextUrl, fetchMore };
}

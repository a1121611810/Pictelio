import type { Accessor } from "solid-js";
import {
  Virtualizer,
  observeWindowRect,
  observeWindowOffset,
  windowScroll,
} from "@tanstack/virtual-core";
import type { VirtualItem } from "@tanstack/virtual-core";
import type { ApiError } from "../api/types";
import { createSentinel } from "@/primitives/visibility";
import { persistScrollRestoration } from "@/stores/uiStore";
import { VIRTUAL_SCROLL_MARGIN } from "./rootMargins";

// ─── Constants ───

const PULL_THRESHOLD = 60;
const MAX_PULL = 100;
const GAP = 12;

// ─── Types ───

export type PullPhase = "idle" | "pulling" | "refresh-ready" | "refreshing" | "settings-ready";

interface FeedVirtualizerConfig<T> {
  /** Reactive list of items to virtualize */
  items: Accessor<T[]>;
  /** Whether a load/refresh operation is in progress */
  loading: Accessor<boolean>;
  /** Current error, if any */
  error: Accessor<ApiError | null>;
  /** 当前错误是否来自分页（fetchNextPage）。为 true 时暂停 sentinel，避免失败后无退避自动重试 */
  paginationError?: Accessor<boolean>;
  /** Whether there are more items to load */
  hasMore: Accessor<boolean>;
  /** Called when the sentinel triggers (load more pages) */
  onLoadMore: () => void;
  /** Called when pull-to-refresh completes */
  onRefresh: () => Promise<void>;
  /** Number of virtual lanes (columns) */
  lanes: Accessor<number>;
  /** Estimate the height of the item at the given index */
  estimateSize: (index: number) => number;
  /** Get a unique key for the item at the given index */
  getItemKey: (index: number) => string | number;
  /** Optional custom empty state text */
  emptyText?: string;
  // ── 增强字段 ──
  /** Optional second pull threshold for settings navigation */
  settingsThreshold?: number;
  /** Called when pull exceeds settingsThreshold (two-stage pull) */
  onNavigateToSettings?: () => void;
  /** Lane assignment mode for multi-column layouts (coverWall uses "measured") */
  laneAssignmentMode?: "measured" | "estimate";
}

interface FeedVirtualizerResult {
  /** Ref callback for the outer container (handles ResizeObserver + touch events) */
  containerRef: (el: HTMLDivElement) => void;
  /** Ref callback for the sentinel element (triggers load-more) */
  sentinelAttach: (el: HTMLDivElement) => void;
  /** Current reactive virtual items */
  virtualItems: Accessor<VirtualItem[]>;
  /** Total height of the virtual list */
  totalSize: Accessor<number>;
  /** Container width (for column width calculations) */
  containerWidth: Accessor<number>;
  /** Current pull-to-refresh phase */
  pullPhase: Accessor<PullPhase>;
  /** Current pull distance in pixels */
  pullDistance: Accessor<number>;
  /** Expose the raw virtualizer instance for advanced use */
  getVirtualizer: () => Virtualizer<Window, HTMLElement>;
  /** Measure element for dynamic height (used by NovelVirtualFeed) */
  measureElement: (el: HTMLElement) => void;
}

// ─── Hook ───

export function createFeedVirtualizer<T>(config: FeedVirtualizerConfig<T>): FeedVirtualizerResult {
  // ── Pull-to-refresh state ──
  const [pullDistance, setPullDistance] = createSignal(0);
  const [pullPhase, setPullPhase] = createSignal<PullPhase>("idle");
  // 2.0 微任务批处理（ADR-0144）：set 后同步读 signal 返回旧值，
  // 状态机内部改用同步局部变量传递目标相位，signal 仅作为对外只读投影。
  let phase: PullPhase = "idle";
  let touchStartY = 0;
  const maxPull = config.settingsThreshold ? config.settingsThreshold * 1.5 : MAX_PULL;

  function applyPhase(next: PullPhase) {
    phase = next;
    setPullPhase(next);
  }

  // Reset pull state when refresh completes
  // defer: 1.x `on()` 的首跑在 setup 时同步执行（彼时 phase 恒为 "idle"，必为 no-op）；
  // 2.0 拆分效应的首跑推迟到 flush 后，可能撞上已是 "refreshing" 的状态造成误复位，
  // 跳过首跑与 1.x 实际语义等价。
  createEffect(
    () => config.loading(),
    (loading) => {
      if (phase === "refreshing" && !loading) {
        setPullDistance(0);
        applyPhase("idle");
      }
    },
    { defer: true },
  );

  function handleTouchStart(e: TouchEvent) {
    if (config.loading()) return;
    if (window.scrollY > 5) return;
    touchStartY = e.touches[0].clientY;
    applyPhase("pulling");
  }

  function handleTouchMove(e: TouchEvent) {
    if (phase === "idle" || phase === "refreshing") return;
    const deltaY = e.touches[0].clientY - touchStartY;
    if (deltaY < 0) {
      setPullDistance(0);
      applyPhase("idle");
      return;
    }
    const damped = Math.min(deltaY * 0.5, maxPull);
    setPullDistance(damped);
    const st = config.settingsThreshold;
    if (st && damped >= st) {
      applyPhase("settings-ready");
    } else if (damped >= PULL_THRESHOLD) {
      applyPhase("refresh-ready");
    } else {
      applyPhase("pulling");
    }
  }

  function handleTouchEnd() {
    if (phase === "settings-ready") {
      setPullDistance(0);
      applyPhase("idle");
      config.onNavigateToSettings?.();
    } else if (phase === "refresh-ready") {
      applyPhase("refreshing");
      setPullDistance(PULL_THRESHOLD * 0.6);
      config.onRefresh();
    } else {
      setPullDistance(0);
      applyPhase("idle");
    }
  }

  // ── Sentinel paginator ──
  const { attach: sentinelAttach } = createSentinel({
    rootMargin: VIRTUAL_SCROLL_MARGIN,
    enabled: () =>
      config.hasMore() &&
      !config.loading() &&
      !(config.error() != null && config.paginationError?.() === true),
    onTrigger: () => config.onLoadMore(),
  });

  // ── Container width tracking ──
  const [containerWidth, setContainerWidth] = createSignal(0);

  // 2.0：ref 回调 unowned（getOwner() 为 null），内部的 onCleanup 会静默失效；
  // ResizeObserver 的清理改由 owned 作用域内 onSettled 返回的 cleanup 负责。
  let containerResizeObserver: ResizeObserver | undefined;
  onSettled(() => () => containerResizeObserver?.disconnect());

  function onContainerRef(el: HTMLDivElement) {
    if (!el) return;
    setContainerWidth(el.clientWidth);
    containerResizeObserver?.disconnect();
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    containerResizeObserver = ro;
  }

  // ── Virtualizer ──
  const [virtualItems, setVirtualItems] = createSignal<VirtualItem[]>([]);
  const [totalSize, setTotalSize] = createSignal(0);

  const estimateSizeFn = (index: number) => config.estimateSize(index);

  const laneMode = config.laneAssignmentMode;
  const instance = new Virtualizer<Window, HTMLElement>({
    count: config.items().length,
    estimateSize: estimateSizeFn,
    lanes: config.lanes(),
    overscan: 2,
    gap: GAP,
    getItemKey: (i: number) => config.getItemKey(i),
    getScrollElement: () => (typeof window !== "undefined" ? window : null),
    observeElementRect: observeWindowRect,
    observeElementOffset: observeWindowOffset,
    scrollToFn: windowScroll,
    laneAssignmentMode: laneMode,
    // 滚动锚定：关闭"持久化滚动恢复"开关时禁用——图片异步加载触发 item
    // resize 时，TanStack Virtual 的 applyScrollAdjustment 会把列表从顶部
    // 一路往下推（真机实测 0→1275px，见 persistScrollRestoration 注释）。
    // 注：virtual-core 运行时支持 scrollAdjustment，但 TS 类型未声明，需断言。
    scrollAdjustment: persistScrollRestoration(),
  } as any);

  // Sync options when items/count/lanes change
  // 2.0 拆分效应：compute 段只读并提取普通值快照，写 signal 移入 apply 段（write-under-scope 禁令）
  createEffect(
    () => ({
      count: config.items().length,
      lanes: config.lanes(),
      scrollAdjustment: persistScrollRestoration(),
    }),
    ({ count, lanes, scrollAdjustment }) => {
      instance.setOptions({
        count,
        estimateSize: estimateSizeFn,
        lanes,
        overscan: 2,
        gap: GAP,
        getItemKey: (i: number) => config.getItemKey(i),
        getScrollElement: () => (typeof window !== "undefined" ? window : null),
        observeElementRect: observeWindowRect,
        observeElementOffset: observeWindowOffset,
        scrollToFn: windowScroll,
        laneAssignmentMode: laneMode,
        scrollAdjustment,
      } as any);
      instance.measure();
      setVirtualItems([...instance.getVirtualItems()] as VirtualItem[]);
      setTotalSize(instance.getTotalSize());
    },
  );

  // Mount lifecycle
  onSettled(() => {
    const cleanup = instance._didMount();
    instance._willUpdate();
    setVirtualItems([...instance.getVirtualItems()] as VirtualItem[]);
    setTotalSize(instance.getTotalSize());

    // 初始测量
    instance.measure();
    setVirtualItems([...instance.getVirtualItems()] as VirtualItem[]);
    setTotalSize(instance.getTotalSize());
    // 2.0：onSettled 以返回值注册清理（替代 onCleanup）
    return () => cleanup?.();
  });

  // Scroll + resize listeners for window mode
  createEffect(
    // 无响应式依赖：仅挂载时执行一次
    () => null,
    () => {
      // 全量重算（_willUpdate + 重建虚拟项数组）单次即可达主线程长任务量级，
      // 而 scroll 事件一帧内可触发 60~120 次；合并到 rAF 每帧至多重算一次，
      // flush 时由 virtualizer 实时读取当下 scroll 位置，末态与逐次重算一致。
      const syncVirtualState = () => {
        instance._willUpdate();
        setVirtualItems([...instance.getVirtualItems()] as VirtualItem[]);
        setTotalSize(instance.getTotalSize());
      };
      let scrollRafId = 0;
      const onScroll = () => {
        if (scrollRafId !== 0) return;
        scrollRafId = requestAnimationFrame(() => {
          scrollRafId = 0;
          syncVirtualState();
        });
      };
      const onResize = () => {
        syncVirtualState();
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onResize);
      return () => {
        if (scrollRafId !== 0) {
          cancelAnimationFrame(scrollRafId);
          scrollRafId = 0;
        }
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onResize);
      };
    },
  );

  // measureElement — delegates to the virtualizer instance
  function measureElement(el: HTMLElement) {
    instance.measureElement(el);
  }

  // ── Result ──

  return {
    containerRef: (el: HTMLDivElement) => {
      if (!el) return;
      el.addEventListener("touchstart", handleTouchStart, { passive: true });
      el.addEventListener("touchmove", handleTouchMove, { passive: true });
      el.addEventListener("touchend", handleTouchEnd);
      onContainerRef(el);
    },
    sentinelAttach,
    virtualItems,
    totalSize,
    containerWidth,
    pullPhase,
    pullDistance,
    getVirtualizer: () => instance,
    measureElement,
  };
}

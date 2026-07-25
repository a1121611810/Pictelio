import { createSignal, createEffect, onCleanup, onMount, on } from "solid-js";
import type { Accessor } from "solid-js";
import {
  Virtualizer,
  observeWindowRect,
  observeWindowOffset,
  windowScroll,
} from "@tanstack/solid-virtual";
import type { VirtualItem } from "@tanstack/solid-virtual";
import type { ApiError } from "../api/types";
import { createSentinel } from "@/primitives/visibility";
import { VIRTUAL_SCROLL_MARGIN } from "./rootMargins";

// ─── Constants ───

const PULL_THRESHOLD = 60;
const MAX_PULL = 100;
const GAP = 12;

// ─── Types ───

export type PullPhase = "idle" | "pulling" | "refresh-ready" | "refreshing" | "settings-ready";

export interface FeedVirtualizerConfig<T> {
  /** Reactive list of items to virtualize */
  items: Accessor<T[]>;
  /** Whether a load/refresh operation is in progress */
  loading: Accessor<boolean>;
  /** Current error, if any */
  error: Accessor<ApiError | null>;
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
  /** Optional scroll restoration state (initialOffset + measurements) */
  scrollRestore?: {
    initialOffset: number;
    initialMeasurementsCache: VirtualItem[];
  };
  /** Called after virtualizer is mounted and ready (for scroll restoration) */
  onReady?: () => void;
  /** Optional callback to suppress header visibility during scroll restoration */
  suppressHeaderVisibility?: (durationMs?: number) => void;
  /** Lane assignment mode for multi-column layouts (coverWall uses "measured") */
  laneAssignmentMode?: "measured" | "estimate";
}

export interface FeedVirtualizerResult {
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
  let touchStartY = 0;
  const maxPull = config.settingsThreshold ? config.settingsThreshold * 1.5 : MAX_PULL;

  // Reset pull state when refresh completes
  createEffect(
    on(
      () => config.loading(),
      (loading) => {
        if (pullPhase() === "refreshing" && !loading) {
          setPullDistance(0);
          setPullPhase("idle");
        }
      },
    ),
  );

  function handleTouchStart(e: TouchEvent) {
    if (config.loading()) return;
    if (window.scrollY > 5) return;
    touchStartY = e.touches[0].clientY;
    setPullPhase("pulling");
  }

  function handleTouchMove(e: TouchEvent) {
    if (pullPhase() === "idle" || pullPhase() === "refreshing") return;
    const deltaY = e.touches[0].clientY - touchStartY;
    if (deltaY < 0) {
      setPullDistance(0);
      setPullPhase("idle");
      return;
    }
    const damped = Math.min(deltaY * 0.5, maxPull);
    setPullDistance(damped);
    const st = config.settingsThreshold;
    if (st && damped >= st) {
      setPullPhase("settings-ready");
    } else if (damped >= PULL_THRESHOLD) {
      setPullPhase("refresh-ready");
    } else {
      setPullPhase("pulling");
    }
  }

  function handleTouchEnd() {
    if (pullPhase() === "settings-ready") {
      setPullDistance(0);
      setPullPhase("idle");
      config.onNavigateToSettings?.();
    } else if (pullPhase() === "refresh-ready") {
      setPullPhase("refreshing");
      setPullDistance(PULL_THRESHOLD * 0.6);
      config.onRefresh();
    } else {
      setPullDistance(0);
      setPullPhase("idle");
    }
  }

  // ── Sentinel paginator ──
  const { attach: sentinelAttach } = createSentinel({
    rootMargin: VIRTUAL_SCROLL_MARGIN,
    enabled: () => config.hasMore() && !config.loading(),
    onTrigger: () => config.onLoadMore(),
  });

  // ── Container width tracking ──
  const [containerWidth, setContainerWidth] = createSignal(0);

  function onContainerRef(el: HTMLDivElement) {
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  }

  // ── Virtualizer ──
  const [virtualItems, setVirtualItems] = createSignal<VirtualItem[]>([]);
  const [totalSize, setTotalSize] = createSignal(0);

  const estimateSizeFn = (index: number) => config.estimateSize(index);

  const sr = config.scrollRestore;
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
    initialOffset: sr?.initialOffset ?? 0,
    initialMeasurementsCache: sr?.initialMeasurementsCache ?? [],
    laneAssignmentMode: laneMode,
  });

  // Sync options when items/count/lanes change
  createEffect(() => {
    const count = config.items().length;
    const cc = config.lanes();
    instance.setOptions({
      count,
      estimateSize: estimateSizeFn,
      lanes: cc,
      overscan: 2,
      gap: GAP,
      getItemKey: (i: number) => config.getItemKey(i),
      getScrollElement: () => (typeof window !== "undefined" ? window : null),
      observeElementRect: observeWindowRect,
      observeElementOffset: observeWindowOffset,
      scrollToFn: windowScroll,
      laneAssignmentMode: laneMode,
    } as any);
    instance.measure();
    setVirtualItems([...instance.getVirtualItems()] as VirtualItem[]);
    setTotalSize(instance.getTotalSize());
  });

  // Mount lifecycle
  onMount(() => {
    const cleanup = instance._didMount();
    instance._willUpdate();
    setVirtualItems([...instance.getVirtualItems()] as VirtualItem[]);
    setTotalSize(instance.getTotalSize());
    onCleanup(() => cleanup?.());

    // Scroll restoration ready callback
    config.suppressHeaderVisibility?.();
    config.onReady?.();

    // ★ 强制重新测量：scroll/resize 事件监听器在后续的 createEffect 中才注册（因 SolidJS
    //   按注册顺序执行 effects/onMount），restoreScroll() 触发的 window.scrollTo 无法被
    //   Virtualizer 感知。此处显式调用 measure()，使 Virtualizer 基于已修正的 scrollY
    //   重新计算，消除详情页遗留 scrollY 值对虚拟滚动状态的污染。
    instance.measure();
    setVirtualItems([...instance.getVirtualItems()] as VirtualItem[]);
    setTotalSize(instance.getTotalSize());
  });

  // Scroll + resize listeners for window mode
  createEffect(() => {
    const onScroll = () => {
      instance._willUpdate();
      setVirtualItems([...instance.getVirtualItems()] as VirtualItem[]);
      setTotalSize(instance.getTotalSize());
    };
    const onResize = () => {
      instance._willUpdate();
      setVirtualItems([...instance.getVirtualItems()] as VirtualItem[]);
      setTotalSize(instance.getTotalSize());
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    onCleanup(() => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    });
  });

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

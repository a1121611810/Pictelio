import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, createSignal } from "solid-js";
import type { ApiError } from "@/api/types";
import type { VirtualItem } from "@tanstack/solid-virtual";

// --- Mocks ---
// These must be at the top level so vitest hoists them before module imports.

const mockVirtualizerInstance = {
  setOptions: vi.fn(),
  measure: vi.fn(),
  _didMount: vi.fn(() => vi.fn()),
  _willUpdate: vi.fn(),
  getVirtualItems: vi.fn(() => [] as VirtualItem[]),
  getTotalSize: vi.fn(() => 0),
  takeSnapshot: vi.fn(() => []),
  isScrolling: false,
  getDistanceFromEnd: vi.fn(() => Infinity),
  isAtEnd: vi.fn(() => false),
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
};

vi.mock("@tanstack/solid-virtual", () => ({
  Virtualizer: vi.fn(function VirtualizerMock() {
    return mockVirtualizerInstance;
  }),
  observeWindowRect: vi.fn(),
  observeWindowOffset: vi.fn(),
  windowScroll: vi.fn(),
}));

const mockSentinelAttach = vi.fn();
vi.mock("@/primitives/visibility", () => ({
  createSentinel: vi.fn(() => ({ attach: mockSentinelAttach })),
}));

// Import after mocks are set up
import { createFeedVirtualizer } from "@/primitives/createFeedVirtualizer";
import { createSentinel } from "@/primitives/visibility";
import { Virtualizer as MockedVirtualizer } from "@tanstack/solid-virtual";

// Stub global browser APIs — must be done before any test runs
const mockIntersectionObserver = vi.fn();
mockIntersectionObserver.mockReturnValue({
  observe: vi.fn(),
  disconnect: vi.fn(),
});
vi.stubGlobal("IntersectionObserver", mockIntersectionObserver);

const mockResizeObserverInstance = {
  observe: vi.fn(),
  disconnect: vi.fn(),
};
const mockResizeObserver = vi.fn(function ResizeObserverMock() {
  return mockResizeObserverInstance;
});
vi.stubGlobal("ResizeObserver", mockResizeObserver);

let scrollListeners: Array<(e: Event) => void> = [];
let resizeListeners: Array<(e: Event) => void> = [];

const mockWindow = {
  scrollY: 0,
  scrollTo: vi.fn(),
  addEventListener: vi.fn((event: string, handler: (e: Event) => void) => {
    if (event === "scroll") scrollListeners.push(handler);
    if (event === "resize") resizeListeners.push(handler);
  }),
  removeEventListener: vi.fn((event: string, handler: (e: Event) => void) => {
    if (event === "scroll") scrollListeners = scrollListeners.filter((h) => h !== handler);
    if (event === "resize") resizeListeners = resizeListeners.filter((h) => h !== handler);
  }),
  innerWidth: 1024,
  innerHeight: 768,
  location: { href: "" },
};
vi.stubGlobal("window", mockWindow);

// Create a proper element factory that stores event listeners
const elementListeners = new Map<string, Array<(...args: unknown[]) => void>>();

function createMockElement(tag: string): HTMLDivElement {
  const elListeners = new Map<string, Array<(e: Event) => void>>();

  const el = {
    clientWidth: 0,
    style: {} as Record<string, string>,
    tagName: tag.toUpperCase(),
    addEventListener: vi.fn((event: string, handler: (e: Event) => void) => {
      if (!elListeners.has(event)) elListeners.set(event, []);
      elListeners.get(event)!.push(handler);
    }),
    removeEventListener: vi.fn((event: string, handler: (e: Event) => void) => {
      const handlers = elListeners.get(event);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    }),
    dispatchEvent: vi.fn((event: Event) => {
      const handlers = elListeners.get(event.type);
      if (handlers) {
        handlers.forEach((h) => h(event));
      }
      return true;
    }),
    getBoundingClientRect: vi.fn(() => ({
      top: 0,
      left: 0,
      width: 0,
      height: 0,
    })),
  };
  return el as unknown as HTMLDivElement;
}

const mockDocument = {
  createElement: vi.fn((tag: string) => createMockElement(tag)),
};
vi.stubGlobal("document", mockDocument);

beforeEach(() => {
  vi.clearAllMocks();
  scrollListeners = [];
  resizeListeners = [];
  mockWindow.scrollY = 0;
  elementListeners.clear();
});

afterEach(() => {
  // cleanup handled by createRoot dispose
});

// --- Helper to create a mock div element ---
function createMockDiv(): HTMLDivElement {
  return document.createElement("div") as unknown as HTMLDivElement;
}

// --- Helper to create a touch event with clientY ---
function createTouchEvent(type: string, clientY: number): Event {
  const event = new Event(type);
  (event as Record<string, unknown>).touches = [{ clientY }];
  return event;
}

// --- Helper to create a config with defaults ---
function createMockConfig(overrides: Record<string, unknown> = {}) {
  const [items, _setItems] = createSignal<any[]>([]);
  const [loading, _setLoading] = createSignal(false);
  const [error, _setError] = createSignal<ApiError | null>(null);
  const [hasMore, _setHasMore] = createSignal(true);

  return {
    items: (overrides.items as typeof items) ?? items,
    loading: (overrides.loading as typeof loading) ?? loading,
    error: (overrides.error as typeof error) ?? error,
    hasMore: (overrides.hasMore as typeof hasMore) ?? hasMore,
    onLoadMore: (overrides.onLoadMore as () => void) ?? vi.fn(),
    onRefresh: (overrides.onRefresh as () => Promise<void>) ?? vi.fn(async () => {}),
    lanes: (overrides.lanes as () => number) ?? (() => 1),
    estimateSize: (overrides.estimateSize as (i: number) => number) ?? ((_i: number) => 100),
    getItemKey: (overrides.getItemKey as (i: number) => string | number) ?? ((i: number) => i),
    emptyText: (overrides.emptyText as string) ?? "暂无内容",
    onReady: (overrides.onReady as () => void) ?? vi.fn(),
    suppressHeaderVisibility:
      (overrides.suppressHeaderVisibility as (d?: number) => void) ?? vi.fn(),
  };
}

// Helper to compute inside createRoot and get result
function runWithRoot<T>(fn: () => T): T {
  let result!: T;
  createRoot(() => {
    result = fn();
  });
  return result;
}

describe("createFeedVirtualizer", () => {
  describe("pull-to-refresh", () => {
    it("starts in idle phase with zero distance", () => {
      const result = runWithRoot(() => createFeedVirtualizer(createMockConfig()));

      expect(result.pullPhase()).toBe("idle");
      expect(result.pullDistance()).toBe(0);
    });

    it("transitions to pulling on touch start when at top of page", () => {
      const config = createMockConfig();
      const result = runWithRoot(() => createFeedVirtualizer(config));

      const el = createMockDiv();
      result.containerRef(el);

      // Simulate touch start
      el.dispatchEvent(createTouchEvent("touchstart", 100));

      expect(result.pullPhase()).toBe("pulling");
    });

    it("transitions to refresh-ready when pull exceeds threshold", () => {
      const config = createMockConfig();
      const result = runWithRoot(() => createFeedVirtualizer(config));

      const el = createMockDiv();
      result.containerRef(el);

      // Touch start
      el.dispatchEvent(createTouchEvent("touchstart", 100));

      // Touch move (need 120+ raw px to exceed 60 threshold with 0.5 damping)
      el.dispatchEvent(createTouchEvent("touchmove", 300));

      expect(result.pullPhase()).toBe("refresh-ready");
      expect(result.pullDistance()).toBeGreaterThanOrEqual(60);
    });

    it("calls onRefresh and transitions to refreshing on touch end", () => {
      const onRefresh = vi.fn(async () => {});
      const config = createMockConfig({ onRefresh });
      const result = runWithRoot(() => createFeedVirtualizer(config));

      const el = createMockDiv();
      result.containerRef(el);

      // Touch start
      el.dispatchEvent(createTouchEvent("touchstart", 100));
      expect(result.pullPhase()).toBe("pulling");

      // Touch move past threshold
      el.dispatchEvent(createTouchEvent("touchmove", 300));
      expect(result.pullPhase()).toBe("refresh-ready");
      expect(result.pullDistance()).toBeGreaterThanOrEqual(60);

      // Touch end
      el.dispatchEvent(new Event("touchend"));

      expect(result.pullPhase()).toBe("refreshing");
      expect(onRefresh).toHaveBeenCalledOnce();
    });

    it("resets to idle when loading finishes during refresh", () => {
      const [loading, setLoading] = createSignal(false);
      const config = createMockConfig({ loading });

      const result = runWithRoot(() => createFeedVirtualizer(config));

      // Simulate a refresh cycle
      const el = createMockDiv();
      result.containerRef(el);

      el.dispatchEvent(createTouchEvent("touchstart", 100));
      el.dispatchEvent(createTouchEvent("touchmove", 300));
      el.dispatchEvent(new Event("touchend"));

      expect(result.pullPhase()).toBe("refreshing");

      // Simulate loading starting and then finishing
      setLoading(true);
      setLoading(false);

      expect(result.pullPhase()).toBe("idle");
      expect(result.pullDistance()).toBe(0);
    });

    it("ignores touch start when loading is true", () => {
      const [loading] = createSignal(true);
      const config = createMockConfig({ loading });

      const result = runWithRoot(() => createFeedVirtualizer(config));

      const el = createMockDiv();
      result.containerRef(el);

      const touchStartEvent = new Event("touchstart");
      Object.defineProperty(touchStartEvent, "touches", {
        value: [{ clientY: 100 }],
      });
      el.dispatchEvent(createTouchEvent("touchstart", 100));

      expect(result.pullPhase()).toBe("idle");
    });

    it("ignores touch start when scrolled past 5px", () => {
      const config = createMockConfig();
      const result = runWithRoot(() => createFeedVirtualizer(config));

      mockWindow.scrollY = 50;

      const el = createMockDiv();
      result.containerRef(el);

      el.dispatchEvent(createTouchEvent("touchstart", 100));

      expect(result.pullPhase()).toBe("idle");
    });
  });

  describe("sentinel paginator", () => {
    it("creates a sentinel with correct rootMargin", () => {
      runWithRoot(() => createFeedVirtualizer(createMockConfig()));

      expect(vi.mocked(createSentinel)).toHaveBeenCalledWith(
        expect.objectContaining({
          rootMargin: "0px 0px 30% 0px",
        }),
      );
    });

    it("passes hasMore && !loading enabled condition and onLoadMore as trigger", () => {
      const onLoadMore = vi.fn();
      const [hasMore] = createSignal(true);
      const [loading] = createSignal(false);
      const config = createMockConfig({
        onLoadMore,
        hasMore: () => hasMore(),
        loading: () => loading(),
      });

      runWithRoot(() => createFeedVirtualizer(config));

      const opts = vi.mocked(createSentinel).mock.calls[0][0];
      expect(typeof opts.enabled).toBe("function");
      expect(typeof opts.onTrigger).toBe("function");

      // Verify the enabled closure returns correct values
      expect(opts.enabled!()).toBe(true);

      // Verify the trigger calls onLoadMore
      opts.onTrigger();
      expect(onLoadMore).toHaveBeenCalledOnce();
    });
  });

  describe("virtualizer", () => {
    it("creates a Virtualizer instance with correct options", () => {
      const estimateSize = (_i: number) => 200;
      const getItemKey = (i: number) => `key-${i}`;

      const config = createMockConfig({
        estimateSize,
        getItemKey,
        lanes: () => 2,
      });

      runWithRoot(() => createFeedVirtualizer(config));

      const callArgs = vi.mocked(MockedVirtualizer).mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.count).toBe(0);
      // The primitive wraps estimateSize, so check it returns the right value
      expect(typeof callArgs.estimateSize).toBe("function");
      expect((callArgs.estimateSize as (i: number) => number)(0)).toBe(200);
      expect(callArgs.lanes).toBe(2);
      expect(callArgs.overscan).toBe(2);
      expect(callArgs.gap).toBe(12);
      expect(typeof callArgs.getItemKey).toBe("function");
      expect((callArgs.getItemKey as (i: number) => string | number)(0)).toBe("key-0");
    });

    it("exposes virtualItems and totalSize signals", () => {
      const result = runWithRoot(() => createFeedVirtualizer(createMockConfig()));

      expect(result.virtualItems()).toEqual([]);
      expect(result.totalSize()).toBe(0);
    });

    it("calls _didMount and _willUpdate on mount", () => {
      runWithRoot(() => createFeedVirtualizer(createMockConfig()));

      expect(mockVirtualizerInstance._didMount).toHaveBeenCalledOnce();
      expect(mockVirtualizerInstance._willUpdate).toHaveBeenCalled();
    });

    it("updates virtual items on scroll", () => {
      const result = runWithRoot(() => createFeedVirtualizer(createMockConfig()));

      const mockItems = [
        { key: 0, index: 0, start: 0, end: 100, size: 100, lane: 0 },
      ] as VirtualItem[];
      mockVirtualizerInstance.getVirtualItems.mockReturnValue(mockItems);
      mockVirtualizerInstance.getTotalSize.mockReturnValue(100);

      // Trigger scroll
      scrollListeners.forEach((fn) => fn(new Event("scroll")));

      expect(result.virtualItems()).toEqual(mockItems);
      expect(result.totalSize()).toBe(100);
    });

    it("exposes the inner virtualizer via getVirtualizer", () => {
      const result = runWithRoot(() => createFeedVirtualizer(createMockConfig()));

      expect(result.getVirtualizer()).toBe(mockVirtualizerInstance);
    });
  });

  describe("container width tracking", () => {
    it("tracks container width via ResizeObserver", () => {
      const result = runWithRoot(() => createFeedVirtualizer(createMockConfig()));

      const el = createMockDiv();
      Object.defineProperty(el, "clientWidth", {
        value: 400,
        configurable: true,
      });

      result.containerRef(el);

      expect(mockResizeObserver).toHaveBeenCalled();
      expect(mockResizeObserverInstance.observe).toHaveBeenCalledWith(el);
    });
  });
});

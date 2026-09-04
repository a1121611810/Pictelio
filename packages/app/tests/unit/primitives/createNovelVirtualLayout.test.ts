/**
 * createNovelVirtualLayout — scroll rAF 合帧行为的精简测试（仅覆盖 onScroll 路径，
 * 布局/缓存逻辑由 createNovelTextLayout / novelTextLayoutCache 各自测试覆盖）。
 *
 * 期望值来源（oracle）：源码 onScroll 合帧语义 —— 一帧内 N 次 scroll 仅 1 次重算；
 * flush 时读取当下 window.scrollY（非事件捕获旧值）；dispose 后 pending rAF 不再触发。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";
import type { NovelBlock } from "@/utils/novelBlocks";
import type { ReaderSettings } from "@/stores/readerSettingsStore";

// --- Mocks（需在模块顶层，vitest 会提升到 import 之前）---

const mockVirtualizerInstance = {
  setOptions: vi.fn(),
  measure: vi.fn(),
  _willUpdate: vi.fn(),
  getVirtualItems: vi.fn(() => [] as Array<{ index: number }>),
  getTotalSize: vi.fn(() => 0),
  takeSnapshot: vi.fn(() => []),
  /** onScroll 回调会把当下 window.scrollY 写到这里 */
  scrollOffset: undefined as number | undefined,
};

vi.mock("@tanstack/solid-virtual", () => ({
  Virtualizer: vi.fn(function VirtualizerMock() {
    return mockVirtualizerInstance;
  }),
  observeWindowRect: vi.fn(),
  observeWindowOffset: vi.fn(),
  windowScroll: vi.fn(),
}));

// --- window / rAF stub ---

let scrollListeners: Array<(e: Event) => void> = [];

const mockWindow = {
  scrollY: 0,
  innerWidth: 1024,
  innerHeight: 768,
  scrollTo: vi.fn(),
  addEventListener: vi.fn((event: string, handler: (e: Event) => void) => {
    if (event === "scroll") scrollListeners.push(handler);
  }),
  removeEventListener: vi.fn((event: string, handler: (e: Event) => void) => {
    if (event === "scroll") scrollListeners = scrollListeners.filter((h) => h !== handler);
  }),
};
vi.stubGlobal("window", mockWindow);

// rAF 手工队列（node 环境无原生 requestAnimationFrame）
let rafQueue: Array<{ id: number; cb: FrameRequestCallback }> = [];
let rafIdCounter = 0;
vi.stubGlobal(
  "requestAnimationFrame",
  vi.fn((cb: FrameRequestCallback): number => {
    const id = ++rafIdCounter;
    rafQueue.push({ id, cb });
    return id;
  }),
);
vi.stubGlobal(
  "cancelAnimationFrame",
  vi.fn((id: number) => {
    rafQueue = rafQueue.filter((entry) => entry.id !== id);
  }),
);
/** 模拟下一帧：执行所有已排队的 rAF 回调 */
function flushRaf() {
  const pending = rafQueue;
  rafQueue = [];
  for (const { cb } of pending) cb(performance.now());
}

// Import after mocks are set up
import { createNovelVirtualLayout } from "@/primitives/createNovelVirtualLayout";

beforeEach(() => {
  vi.clearAllMocks();
  scrollListeners = [];
  rafQueue = [];
  mockWindow.scrollY = 0;
});

// --- Setup helper ---

const SETTINGS: ReaderSettings = {
  fontSize: 18,
  autoFontSize: false,
  fontWeight: 400,
  fontFamily: "serif",
  fontColor: "#111111",
  lineHeight: 1.6,
  bgColor: "#ffffff",
};

function setup(): { result: ReturnType<typeof createNovelVirtualLayout>; dispose: () => void } {
  const blocks: NovelBlock[] = [{ type: "text", index: 0, text: "第一段测试文本" }];
  let dispose!: () => void;
  let result!: ReturnType<typeof createNovelVirtualLayout>;
  createRoot((d) => {
    result = createNovelVirtualLayout({
      blocks: () => blocks,
      containerWidth: () => 400,
      settings: () => SETTINGS,
      imageDimensions: () => ({}),
      containerRef: () => {},
      novelId: () => 42,
    });
    dispose = d;
  });
  return { result, dispose };
}

function fireScroll() {
  scrollListeners.forEach((fn) => fn(new Event("scroll")));
}

describe("createNovelVirtualLayout — scroll rAF 合帧", () => {
  it("同帧多次 scroll 只触发一次全量重算", () => {
    const { result } = setup();
    // 挂载阶段（同步 effect）的初始计算不计入
    mockVirtualizerInstance._willUpdate.mockClear();
    mockVirtualizerInstance.getVirtualItems.mockClear();

    fireScroll();
    fireScroll();
    fireScroll();
    // flush 前事件不直接触发重算
    expect(mockVirtualizerInstance._willUpdate).not.toHaveBeenCalled();
    flushRaf();

    expect(mockVirtualizerInstance._willUpdate).toHaveBeenCalledTimes(1);
    expect(mockVirtualizerInstance.getVirtualItems).toHaveBeenCalledTimes(1);
    // 重算结果写入响应式信号
    expect(result.virtualizer.getVirtualItems()).toEqual([]);
  });

  it("flush 时读取当下 window.scrollY（末态为最新位置）", () => {
    const { result } = setup();
    // 期望值来源：flush 时刻 mockWindow.scrollY 的独立推导（虚拟项 index === scrollY），
    // 事件发生时的旧值 10 不得出现
    mockVirtualizerInstance.getVirtualItems.mockImplementation(() => [
      { index: mockWindow.scrollY },
    ]);

    mockWindow.scrollY = 10;
    fireScroll();
    mockWindow.scrollY = 777; // 同帧内事件之后的最新滚动位置
    fireScroll();
    flushRaf();

    // onScroll 回调把当下 scrollY 写入 instance.scrollOffset（flush 时而非事件时）
    expect(mockVirtualizerInstance.scrollOffset).toBe(777);
    expect(result.visibleBlocks()).toEqual([777]);
  });

  it("dispose 后 pending 的 rAF 不再触发重算，监听器已移除", () => {
    const { dispose } = setup();
    mockVirtualizerInstance._willUpdate.mockClear();

    fireScroll();
    dispose();
    flushRaf();

    expect(mockVirtualizerInstance._willUpdate).not.toHaveBeenCalled();
    expect(scrollListeners).toHaveLength(0);
  });
});

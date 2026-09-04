import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFastScrollbar } from "@/primitives/createFastScrollbar";

// --- rAF 手工队列 stub（node 环境无原生 requestAnimationFrame）---
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

beforeEach(() => {
  rafQueue = [];
});

function make(
  overrides: Partial<{
    scrollTop: number;
    viewport: number;
    content: number;
    track: number;
  }> = {},
) {
  const state = {
    scrollTop: overrides.scrollTop ?? 0,
    viewport: overrides.viewport ?? 800,
    content: overrides.content ?? 4000,
    track: overrides.track ?? 800,
  };
  const onScrollTo = vi.fn();
  const fs = createFastScrollbar({
    getScrollTop: () => state.scrollTop,
    getViewportHeight: () => state.viewport,
    getContentHeight: () => state.content,
    getTrackHeight: () => state.track,
    onScrollTo,
  });
  return { fs, state, onScrollTo };
}

const ptr = (clientY: number) => ({ clientY, preventDefault: vi.fn() });

describe("createFastScrollbar — thumb 几何", () => {
  it("内容大于视口时可见，thumb 高 = 视口²/内容", () => {
    const { fs } = make({ viewport: 800, content: 4000, track: 800 });
    expect(fs.visible()).toBe(true);
    expect(fs.thumbHeight()).toBe((800 * 800) / 4000); // 160
  });

  it("thumb 高 clamp 最小 24px（内容超长）", () => {
    const { fs } = make({ viewport: 800, content: 80000 });
    expect(fs.thumbHeight()).toBe(24);
  });

  it("内容小于等于视口时不可见、thumb 高 0", () => {
    const { fs } = make({ viewport: 800, content: 600 });
    expect(fs.visible()).toBe(false);
    expect(fs.thumbHeight()).toBe(0);
    expect(fs.thumbOffset()).toBe(0);
  });

  it("thumb 偏移 = scrollTop 比例 × (轨道−thumb)", () => {
    const { fs, state } = make({ scrollTop: 0, viewport: 800, content: 4000, track: 800 });
    const travel = 800 - (800 * 800) / 4000; // 640
    expect(fs.thumbOffset()).toBe(0);
    state.scrollTop = 1600; // 一半
    expect(fs.thumbOffset()).toBeCloseTo(travel / 2);
    state.scrollTop = 3200; // 最大
    expect(fs.thumbOffset()).toBeCloseTo(travel);
  });
});

describe("createFastScrollbar — 拖拽位移比例映射", () => {
  it("拖拽 50% 轨道位移 → 滚动到内容 50%", () => {
    const { fs, onScrollTo } = make({
      scrollTop: 0,
      viewport: 800,
      content: 4000,
      track: 800,
    });
    // thumbTravel = 800 − 160 = 640；拖 320px = 50%
    fs.handlers.onPointerDown(ptr(100));
    fs.handlers.onPointerMove(ptr(100 + 320));
    flushRaf();
    expect(onScrollTo).toHaveBeenCalledWith((4000 - 800) * 0.5); // 1600
    expect(fs.active()).toBe(true);
    fs.handlers.onPointerUp();
    expect(fs.active()).toBe(false);
  });

  it("拖拽映射基于拖拽起点（不从 0 开始）", () => {
    const { fs, onScrollTo } = make({ scrollTop: 800, viewport: 800, content: 4000, track: 800 });
    // 起点 scrollTop=800；拖 160px（=25% 轨道）→ +25%×3200=800 → 1600
    fs.handlers.onPointerDown(ptr(50));
    fs.handlers.onPointerMove(ptr(50 + 160));
    flushRaf();
    expect(onScrollTo).toHaveBeenCalledWith(1600);
  });

  it("onScrollTo 收到 clamp 前原始值（边界由外部处理）", () => {
    const { fs, onScrollTo } = make({ scrollTop: 0, viewport: 800, content: 4000, track: 800 });
    fs.handlers.onPointerDown(ptr(0));
    fs.handlers.onPointerMove(ptr(0 + 1000)); // 超过轨道
    flushRaf();
    const received = onScrollTo.mock.calls.at(-1)?.[0] as number;
    expect(received).toBeGreaterThan(3200); // 未 clamp（外部处理）
  });

  it("内容 ≤ 视口时拖拽无效（不可见不响应）", () => {
    const { fs, onScrollTo } = make({ viewport: 800, content: 500 });
    fs.handlers.onPointerDown(ptr(100));
    fs.handlers.onPointerMove(ptr(300));
    flushRaf();
    expect(onScrollTo).not.toHaveBeenCalled();
  });
});

describe("createFastScrollbar — pointermove rAF 合帧", () => {
  it("同帧多次 pointermove 只触发一次 onScrollTo，且取最新位置", () => {
    const { fs, onScrollTo } = make({ scrollTop: 0, viewport: 800, content: 4000, track: 800 });
    // thumbTravel = 640；第一次 move 目标 800，第二次覆盖为 1600
    fs.handlers.onPointerDown(ptr(100));
    fs.handlers.onPointerMove(ptr(100 + 160));
    fs.handlers.onPointerMove(ptr(100 + 320));
    // flush 前事件不直接 onScrollTo
    expect(onScrollTo).not.toHaveBeenCalled();
    flushRaf();
    expect(onScrollTo).toHaveBeenCalledTimes(1);
    expect(onScrollTo).toHaveBeenCalledWith(1600);
  });

  it("pointermove 未 flush 时 pointerup 立即落位最新 top，且不二次触发", () => {
    const { fs, onScrollTo } = make({ scrollTop: 0, viewport: 800, content: 4000, track: 800 });
    fs.handlers.onPointerDown(ptr(100));
    fs.handlers.onPointerMove(ptr(100 + 320)); // 目标 1600，rAF 未到
    fs.handlers.onPointerUp();
    // 抬手立即 flush 最新目标，终态即时落位
    expect(onScrollTo).toHaveBeenCalledTimes(1);
    expect(onScrollTo).toHaveBeenCalledWith(1600);
    // flush 已取消 pending rAF，下一帧不再触发
    flushRaf();
    expect(onScrollTo).toHaveBeenCalledTimes(1);
    expect(fs.active()).toBe(false);
  });

  it("preventDefault 仍在 pointermove 事件回调内同步调用（合帧不延迟）", () => {
    const { fs } = make({ scrollTop: 0, viewport: 800, content: 4000, track: 800 });
    fs.handlers.onPointerDown(ptr(100));
    const move = ptr(180);
    fs.handlers.onPointerMove(move);
    expect(move.preventDefault).toHaveBeenCalledOnce();
  });

  it("非拖拽态 pointermove 不调度 rAF", () => {
    const { fs, onScrollTo } = make({ scrollTop: 0, viewport: 800, content: 4000, track: 800 });
    fs.handlers.onPointerMove(ptr(300));
    flushRaf();
    expect(onScrollTo).not.toHaveBeenCalled();
  });
});

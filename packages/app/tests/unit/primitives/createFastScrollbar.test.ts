import { describe, expect, it, vi } from "vitest";
import { createFastScrollbar } from "@/primitives/createFastScrollbar";

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
    expect(onScrollTo).toHaveBeenCalledWith(1600);
  });

  it("onScrollTo 收到 clamp 前原始值（边界由外部处理）", () => {
    const { fs, onScrollTo } = make({ scrollTop: 0, viewport: 800, content: 4000, track: 800 });
    fs.handlers.onPointerDown(ptr(0));
    fs.handlers.onPointerMove(ptr(0 + 1000)); // 超过轨道
    const received = onScrollTo.mock.calls.at(-1)?.[0] as number;
    expect(received).toBeGreaterThan(3200); // 未 clamp（外部处理）
  });

  it("内容 ≤ 视口时拖拽无效（不可见不响应）", () => {
    const { fs, onScrollTo } = make({ viewport: 800, content: 500 });
    fs.handlers.onPointerDown(ptr(100));
    fs.handlers.onPointerMove(ptr(300));
    expect(onScrollTo).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installStartupScrollGuard } from "@/utils/startupScrollGuard";

/**
 * 期望值出处（oracle）：
 * - 任务规格「启动滚动守卫加用户意图判别」——程序性恢复特征 = 启动窗口内
 *   scrollY>0 且无任何用户交互事件；回顶一次性 + 自卸载；窗口到点 / cleanup 后失效。
 * - 行为事实：Chromium 磁盘级滚动恢复不产生 touchstart/pointerdown/wheel 输入事件，
 *   用户滚动一定先有交互事件（判别依据，源：__root.tsx 顶部诊断注释 / 真机实测 t≈3.5s 0→1306）。
 */

type Listener = (event: Event) => void;

/** 事件名 → 已挂监听集合（模拟 window 的事件注册表） */
let listeners: Map<string, Set<Listener>>;
let scrollY: number;

const mockWindow = {
  get scrollY() {
    return scrollY;
  },
  addEventListener: vi.fn((event: string, handler: Listener) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(handler);
  }),
  removeEventListener: vi.fn((event: string, handler: Listener) => {
    listeners.get(event)?.delete(handler);
  }),
};

function dispatch(event: string): void {
  for (const handler of listeners.get(event) ?? []) {
    handler(new Event(event));
  }
}

beforeEach(() => {
  listeners = new Map();
  scrollY = 0;
  vi.stubGlobal("window", mockWindow);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("installStartupScrollGuard", () => {
  it("a. 无交互时恢复特征滚动（scrollY>0）→ 回顶一次并自卸载", () => {
    const scrollToTop = vi.fn();
    const cleanup = installStartupScrollGuard({ isTopRequired: () => true, scrollToTop });

    scrollY = 1306; // 真机实测的恢复位置量级
    dispatch("scroll");
    expect(scrollToTop).toHaveBeenCalledTimes(1);

    // 自卸载：守卫触发后再次滚动（窗口内）不再触发
    scrollY = 200;
    dispatch("scroll");
    expect(scrollToTop).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("b. 先 touchstart 再 scroll → 用户意图，不回顶", () => {
    const scrollToTop = vi.fn();
    const cleanup = installStartupScrollGuard({ isTopRequired: () => true, scrollToTop });

    dispatch("touchstart");
    scrollY = 800;
    dispatch("scroll");

    expect(scrollToTop).not.toHaveBeenCalled();
    cleanup();
  });

  it("b2. pointerdown / wheel 任一交互同样豁免", () => {
    for (const interaction of ["pointerdown", "wheel"] as const) {
      listeners = new Map(); // 每轮重置事件注册表
      const scrollToTop = vi.fn();
      const cleanup = installStartupScrollGuard({ isTopRequired: () => true, scrollToTop });

      dispatch(interaction);
      scrollY = 800;
      dispatch("scroll");
      expect(scrollToTop).not.toHaveBeenCalled();

      cleanup();
    }
  });

  it("c. windowMs 超时后 scroll → 不触发", () => {
    vi.useFakeTimers();
    const scrollToTop = vi.fn();
    installStartupScrollGuard({ isTopRequired: () => true, scrollToTop, windowMs: 5000 });

    vi.advanceTimersByTime(5000);
    scrollY = 1306;
    dispatch("scroll");

    expect(scrollToTop).not.toHaveBeenCalled();
  });

  it("d. cleanup() 后全部监听移除，scroll 不再触发，且幂等", () => {
    const scrollToTop = vi.fn();
    const cleanup = installStartupScrollGuard({ isTopRequired: () => true, scrollToTop });

    cleanup();

    // 四个事件的监听（touchstart/pointerdown/wheel/scroll）全部自注册表移除
    for (const event of ["touchstart", "pointerdown", "wheel", "scroll"]) {
      expect(listeners.get(event)?.size ?? 0).toBe(0);
    }

    scrollY = 1306;
    dispatch("scroll");
    expect(scrollToTop).not.toHaveBeenCalled();

    // 幂等：重复 cleanup 不抛错
    expect(() => cleanup()).not.toThrow();
  });

  it("e. 回顶后到超时前再发 scroll → 不重复调用", () => {
    vi.useFakeTimers();
    const scrollToTop = vi.fn();
    const cleanup = installStartupScrollGuard({
      isTopRequired: () => true,
      scrollToTop,
      windowMs: 5000,
    });

    scrollY = 1306;
    dispatch("scroll");
    expect(scrollToTop).toHaveBeenCalledTimes(1);

    // 回顶触发后、窗口未到：再发 scroll 不重复回顶
    vi.advanceTimersByTime(2000);
    scrollY = 500;
    dispatch("scroll");
    expect(scrollToTop).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("isTopRequired 为 false 时不回顶（门控语义）", () => {
    const scrollToTop = vi.fn();
    const cleanup = installStartupScrollGuard({ isTopRequired: () => false, scrollToTop });

    scrollY = 1306;
    dispatch("scroll");
    expect(scrollToTop).not.toHaveBeenCalled();

    cleanup();
  });
});

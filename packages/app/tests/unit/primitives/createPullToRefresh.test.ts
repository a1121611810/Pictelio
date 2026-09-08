import { describe, expect, it, vi } from "vitest";
// ADR-0144：2.0 微任务批处理下，事件处理器内的 signal 写需经 flush 同步生效后才能同步断言
import { flush } from "solid-js";
import { createPullToRefresh, type TouchEventLike } from "@/primitives/createPullToRefresh";

/** 构造假 touch 事件（可测结构） */
function touch(clientY: number, preventDefault = vi.fn()): TouchEventLike {
  return { touches: [{ clientY }], preventDefault };
}

describe("createPullToRefresh", () => {
  it("idle 初始：距离 0、相位 idle", () => {
    const p = createPullToRefresh({ onRefresh: vi.fn() });
    expect(p.pullDistance()).toBe(0);
    expect(p.pullPhase()).toBe("idle");
  });

  it("下拉未达阈值：pulling → 松手回弹 idle，不触发刷新", () => {
    const onRefresh = vi.fn();
    const p = createPullToRefresh({ onRefresh, threshold: 60, damping: 0.4 });
    p.touchHandlers.onTouchStart(touch(100));
    p.touchHandlers.onTouchMove(touch(200)); // dy=100 → 阻尼后 40 < 60
    flush(); // ADR-0144：批处理下 set 后同步读为旧值，先排空再断言
    expect(p.pullPhase()).toBe("pulling");
    expect(p.pullDistance()).toBeCloseTo(40);
    p.touchHandlers.onTouchEnd();
    flush(); // 同上
    expect(p.pullPhase()).toBe("idle");
    expect(p.pullDistance()).toBe(0);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("下拉超过阈值：refresh-ready → 松手触发一次刷新并回弹 idle", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const p = createPullToRefresh({ onRefresh, threshold: 60, damping: 0.4 });
    p.touchHandlers.onTouchStart(touch(100));
    p.touchHandlers.onTouchMove(touch(260)); // dy=160 → 阻尼 64 >= 60
    flush(); // ADR-0144：批处理下 set 后同步读为旧值，先排空再断言
    expect(p.pullPhase()).toBe("refresh-ready");
    expect(p.pullDistance()).toBeCloseTo(64);
    p.touchHandlers.onTouchEnd();
    flush(); // 同上
    expect(p.pullPhase()).toBe("refreshing");
    expect(p.pullDistance()).toBe(60); // 保持指示器展开
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await Promise.resolve(); // onRefresh 已 resolve → settle 回调先于测试续体执行
    flush(); // ADR-0144：settle 内的 signal 写同样经批处理，排空后再断言
    expect(p.pullPhase()).toBe("idle");
    expect(p.pullDistance()).toBe(0);
  });

  it("非列表顶部：touchstart 不启动追踪（无下拉反应）", () => {
    const onRefresh = vi.fn();
    const p = createPullToRefresh({ onRefresh, isAtTop: () => false });
    p.touchHandlers.onTouchStart(touch(100));
    p.touchHandlers.onTouchMove(touch(300));
    expect(p.pullDistance()).toBe(0);
    expect(p.pullPhase()).toBe("idle");
  });

  it("刷新中：忽略新的下拉（isRefreshing 期间 touchstart 不启动）", () => {
    const onRefresh = vi.fn();
    const isRefreshing = vi.fn().mockReturnValue(true);
    const p = createPullToRefresh({ onRefresh, isRefreshing });
    p.touchHandlers.onTouchStart(touch(100));
    p.touchHandlers.onTouchMove(touch(300));
    expect(p.pullPhase()).toBe("idle");
    expect(p.pullDistance()).toBe(0);
  });

  it("向上滑动取消下拉：回到 idle", () => {
    const onRefresh = vi.fn();
    const p = createPullToRefresh({ onRefresh });
    p.touchHandlers.onTouchStart(touch(100));
    p.touchHandlers.onTouchMove(touch(200));
    flush(); // ADR-0144：批处理下 set 后同步读为旧值，先排空再断言
    expect(p.pullPhase()).toBe("pulling");
    p.touchHandlers.onTouchMove(touch(80)); // dy=-20 → 取消
    flush(); // 同上
    expect(p.pullPhase()).toBe("idle");
    expect(p.pullDistance()).toBe(0);
    p.touchHandlers.onTouchEnd();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("下拉中调用 preventDefault 阻止原生 overscroll", () => {
    const preventDefault = vi.fn();
    const p = createPullToRefresh({ onRefresh: vi.fn() });
    p.touchHandlers.onTouchStart(touch(100));
    p.touchHandlers.onTouchMove(touch(250, preventDefault));
    expect(preventDefault).toHaveBeenCalled();
  });
});

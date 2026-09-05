// @vitest-environment node
/**
 * idleFeedPrefetch 空闲预取调度器（地图 #371 / #375 实施记录）。
 *
 * oracle 溯源：
 * - 串行错峰（一次一路 + 任务间 1s gap）= #373 事实核查结论：避免与用户操作 /
 *   可见 feed 的 SWR 刷新并发挤占（Pixiv 无公开配额，保守设计）。
 * - 一次性启动 = 预取是会话级动作，tab 切换不重跑（首页 mount 后只调度一次）。
 * - 失败不中断 + console.warn（带模块前缀）= AGENTS.md 测试硬约束 3（禁止静默降级）。
 * - node 环境无 requestIdleCallback → setTimeout(1500) 兜底分支；真机 WebView 113+
 *   走 rIC（timeout 10s 保证慢帧下仍会执行）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const warns = vi.hoisted(() => ({ fn: undefined as unknown as ReturnType<typeof vi.fn> }));

import { scheduleIdleFeedPrefetch, resetIdleFeedPrefetchForTests } from "@/utils/idleFeedPrefetch";

beforeEach(() => {
  vi.useFakeTimers();
  // beforeEach 内建 spy：afterEach 的 restoreAllMocks 会卸掉模块级 spy
  warns.fn = vi.spyOn(console, "warn").mockImplementation(() => undefined) as unknown as ReturnType<
    typeof vi.fn
  >;
  resetIdleFeedPrefetchForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("idleFeedPrefetch 调度器", () => {
  it("一次性启动：第二次 schedule 是 no-op（首页 mount 只调度一次）", async () => {
    const runs: string[] = [];
    scheduleIdleFeedPrefetch([{ id: "a", run: () => (runs.push("a"), Promise.resolve()) }]);
    scheduleIdleFeedPrefetch([{ id: "b", run: () => (runs.push("b"), Promise.resolve()) }]);
    await vi.advanceTimersByTimeAsync(1500 + 1000 + 5000);
    expect(runs).toEqual(["a"]);
  });

  it("顺序错峰：idle 1500ms 后启动，任务间 1s gap，按序执行", async () => {
    const runs: string[] = [];
    scheduleIdleFeedPrefetch([
      { id: "a", run: () => (runs.push("a"), Promise.resolve()) },
      { id: "b", run: () => (runs.push("b"), Promise.resolve()) },
      { id: "c", run: () => (runs.push("c"), Promise.resolve()) },
    ]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(runs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toEqual(["a", "b"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toEqual(["a", "b", "c"]);
  });

  it("失败路径：warn 带模块前缀且后续任务照跑（不静默降级）", async () => {
    const runs: string[] = [];
    scheduleIdleFeedPrefetch([
      { id: "boom", run: () => Promise.reject(new Error("network down")) },
      { id: "after", run: () => (runs.push("after"), Promise.resolve()) },
    ]);
    await vi.advanceTimersByTimeAsync(1500 + 1000 + 1000 + 1000);
    expect(runs).toEqual(["after"]);
    expect(warns.fn).toHaveBeenCalledTimes(1);
    expect(String(warns.fn.mock.calls[0][0])).toContain("[idleFeedPrefetch]");
    expect(String(warns.fn.mock.calls[0][0])).toContain("boom");
  });

  it("空任务数组：不占用一次性标记，后续可重新调度", async () => {
    const runs: string[] = [];
    scheduleIdleFeedPrefetch([]);
    scheduleIdleFeedPrefetch([{ id: "late", run: () => (runs.push("late"), Promise.resolve()) }]);
    await vi.advanceTimersByTimeAsync(1500 + 1000);
    expect(runs).toEqual(["late"]);
  });
});

/**
 * idleFeedPrefetch — 首页 Feed 空闲预取调度器（地图 #371 / #375，主杠杆=消除首访骨架等待）。
 *
 * 基线（#372）：缓存回访切换 85-350ms 直现；真首访骨架等网络 5-9s。预取只做
 * 「填空」（store.prefetchAllTabs 默认 staleTime=Infinity，已有数据含恢复的陈旧
 * 数据一律跳过），对正常重启是零网络开销，仅填补空缓存。
 *
 * 调度语义（#373 事实核查）：
 * - 一次性：首页 mount 后只调度一次，tab 切换不重跑；
 * - 错峰：requestIdleCallback（timeout 10s 兜底，无 rIC 的环境退避 setTimeout）后
 *   逐任务串行、任务间 1s gap，避免与用户操作/可见 feed 的 SWR 刷新并发挤占；
 * - 不静默降级：任务失败 console.warn（带模块前缀）后继续后续任务。
 */

export interface IdlePrefetchTask {
  /** 诊断用标识（warn 日志输出） */
  id: string;
  run: () => Promise<unknown>;
}

let started = false;

/** 测试专用：重置一次性启动标记 */
export function resetIdleFeedPrefetchForTests(): void {
  started = false;
}

const IDLE_FALLBACK_MS = 1_500;
const TASK_GAP_MS = 1_000;

const gap = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export function scheduleIdleFeedPrefetch(tasks: IdlePrefetchTask[]): void {
  if (started || tasks.length === 0) return;
  started = true;

  const onIdle = (cb: () => void): void => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => cb(), { timeout: 10_000 });
    } else {
      setTimeout(cb, IDLE_FALLBACK_MS);
    }
  };

  const runSequentially = async (): Promise<void> => {
    for (const task of tasks) {
      await gap(TASK_GAP_MS);
      try {
        await task.run();
      } catch (err) {
        console.warn(`[idleFeedPrefetch] 预取失败: ${task.id}`, err);
      }
    }
  };

  onIdle(() => {
    void runSequentially();
  });
}

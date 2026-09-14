// ─── 下载管理器（队列编排壳，spec docs/specs/download-manager.md §4）───
// 与 app-lynx 的 downloadManager.ts 同源同语义（双端差分对齐）。
// 职责：把纯函数核心（downloadQueueCore）接到「持久化 KV + 原生执行器」两个注入 seam 上，
// 并作为框架无关的深模块供各端响应式 store 薄包（app 用 Solid signal，lynx 用 Pinia ref）。
// 依赖注入：零框架 / 零原生依赖，node 可单测（测试硬约束 #1 的 IO 边界 + 纯函数）。

import {
  canStop,
  complete,
  emptyQueue,
  enqueue,
  fail,
  findTask,
  MAX_CONCURRENT,
  pause,
  removeTasks,
  reportProgress,
  restore,
  schedule,
  selectDeleteFileUris,
  serialize,
  start,
  stop,
  type DeleteMode,
  type DownloadTask,
  type DownloadTaskDraft,
  type QueueState,
} from "./downloadQueueCore";

/** 队列持久化键（app-lynx 共享 SharedPreferences，跨引擎同契约） */
export const DOWNLOAD_QUEUE_KEY = "download_queue_v1";

export interface DownloadProgress {
  done?: number;
  total?: number;
}

export interface DownloadExecutorCallbacks {
  /** 百分比 0–100；bytes 可选。 */
  onProgress(progress: number, bytes?: DownloadProgress): void;
  /** 成功落盘：outputUri 为 content:// 或 file://。 */
  onComplete(outputUri: string): void;
  /** 失败：可读原因。 */
  onFail(error: string): void;
}

/**
 * 原生执行器 seam（T3 实现；本模块只依赖接口）。
 * 契约：start 之后必须最终回调一次 onComplete 或 onFail；取消/挂起后不得再回调
 * （过期回调由核心的 runId 兜底丢弃，双保险）。
 */
export interface DownloadExecutor {
  start(task: DownloadTask, runId: number, cb: DownloadExecutorCallbacks): void;
  /** 挂起：保留已完成部分，可续。 */
  pause(id: string): void;
  /** 取消：丢弃部分产物（停止/删除时调用）。 */
  cancel(id: string): void;
  /** 删除已落盘文件。 */
  deleteFile(uri: string): Promise<void>;
}

/** 持久化 seam（app：@capacitor/preferences；lynx：原生 prefs / idbKV）。 */
export interface DownloadKV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface DownloadManagerDeps {
  kv: DownloadKV;
  executor: DownloadExecutor;
  /** 可注入时钟（测试确定性） */
  now?: () => number;
  warn?: (msg: string, err?: unknown) => void;
  /** 持久化防抖（默认 300ms） */
  debounceMs?: number;
}

export interface DownloadManager {
  getState(): QueueState;
  subscribe(fn: (state: QueueState) => void): () => void;
  /** 从 KV 恢复（downloading→paused）；不自动开始，等待用户显式 start。 */
  hydrate(): Promise<void>;
  /** 入队并立即在并发额度内启动。 */
  enqueue(drafts: readonly DownloadTaskDraft[]): void;
  start(ids: readonly string[]): void;
  pause(ids: readonly string[]): void;
  stop(ids: readonly string[]): void;
  /** 删除：mode=files 先删已完成文件，再移除记录。 */
  deleteTasks(ids: readonly string[], mode: DeleteMode): Promise<void>;
  /** 落盘所有挂起的持久化（测试 / 生命周期后台化用）。 */
  flush(): Promise<void>;
  dispose(): void;
}

interface StartSignal {
  id: string;
  runId: number;
}

function contains(ids: readonly string[], id: string): boolean {
  return ids.includes(id);
}

export function createDownloadManager(deps: DownloadManagerDeps): DownloadManager {
  const now = deps.now ?? Date.now;
  const warn = deps.warn ?? console.warn;
  const debounceMs = deps.debounceMs ?? 300;

  let state = emptyQueue();
  let disposed = false;
  let hydrated = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> = Promise.resolve();
  const subscribers = new Set<(s: QueueState) => void>();

  function emit(): void {
    for (const fn of subscribers) {
      try {
        fn(state);
      } catch (e) {
        warn("[downloadManager] 订阅者抛错", e);
      }
    }
  }

  function persistNow(): Promise<void> {
    const snapshot = serialize(state);
    pending = pending.then(async () => {
      try {
        await deps.kv.set(DOWNLOAD_QUEUE_KEY, snapshot);
      } catch (e) {
        warn("[downloadManager] 队列持久化失败", e);
      }
    });
    return pending;
  }

  function schedulePersist(): void {
    if (disposed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void persistNow();
    }, debounceMs);
  }

  function commit(next: QueueState): void {
    if (next === state) return;
    state = next;
    emit();
    schedulePersist();
  }

  /** 在额度内提升 queued→downloading，并把每个新启动任务交给执行器。 */
  function pump(): void {
    const res = schedule(state, MAX_CONCURRENT, now());
    if (res.started.length === 0) return;
    commit(res.state);
    runStarted(res.started);
  }

  function runStarted(started: readonly StartSignal[]): void {
    for (const signal of started) {
      const task = findTask(state, signal.id);
      if (!task) continue;
      deps.executor.start(task, signal.runId, {
        onProgress: (progress, bytes) => {
          commit(reportProgress(state, signal.id, signal.runId, progress, bytes, now()));
        },
        onComplete: (outputUri) => {
          commit(complete(state, signal.id, signal.runId, outputUri, now()));
          pump();
        },
        onFail: (error) => {
          commit(fail(state, signal.id, signal.runId, error, now()));
          pump();
        },
      });
    }
  }

  return {
    getState: () => state,

    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    async hydrate() {
      // 幂等：仅首次读取持久层。页面重挂载再次调用时不得用持久快照覆盖内存态
      // （否则在途 downloading 会被 restore 降级为 paused——真机实测发现）。
      if (hydrated) return;
      hydrated = true;
      let raw: string | null = null;
      try {
        raw = await deps.kv.get(DOWNLOAD_QUEUE_KEY);
      } catch (e) {
        warn("[downloadManager] 队列读取失败，按空队列恢复", e);
      }
      state = restore(raw, warn);
      emit();
      // 不自动开始：恢复后的 paused/queued/stopped 等待用户显式操作（避免启动即跑流量）。
    },

    enqueue(drafts) {
      commit(enqueue(state, drafts, now()));
      pump();
    },

    start(ids) {
      commit(start(state, ids, now()));
      pump();
    },

    pause(ids) {
      for (const t of state.tasks) {
        if (contains(ids, t.id) && t.status === "downloading") deps.executor.pause(t.id);
      }
      commit(pause(state, ids, now()));
      pump(); // 挂起释放额度，排队中的可顶上
    },

    stop(ids) {
      for (const t of state.tasks) {
        if (contains(ids, t.id) && canStop(t)) deps.executor.cancel(t.id);
      }
      commit(stop(state, ids, now()));
      pump();
    },

    async deleteTasks(ids, mode) {
      for (const t of state.tasks) {
        if (contains(ids, t.id) && t.status === "downloading") deps.executor.cancel(t.id);
      }
      const uris = selectDeleteFileUris(state, ids, mode);
      for (const uri of uris) {
        try {
          await deps.executor.deleteFile(uri);
        } catch (e) {
          warn("[downloadManager] 删除文件失败（记录仍移除）: " + uri, e);
        }
      }
      commit(removeTasks(state, ids));
      pump();
    },

    async flush() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      await persistNow();
      await pending;
    },

    dispose() {
      disposed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
        void persistNow();
      }
      subscribers.clear();
    },
  };
}

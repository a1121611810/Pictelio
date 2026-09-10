// ─── 下载执行器（webview 引擎：Capacitor 插件桥，spec docs/specs/download-manager.md §4.3）───
// 纯注入工厂（零 @capacitor/core / 零 store 依赖，node 可测）；生产接线在 native/downloadExecutor.ts。
import type { DownloadExecutor, DownloadExecutorCallbacks } from "./downloadManager";

/** 原生 PictelioDownloader 插件契约（Android PictelioDownloaderPlugin） */
export interface PictelioDownloaderNative {
  start(options: {
    id: string;
    sourceUrl: string;
    fileName: string;
    kind: "image" | "ugoira";
    targetFormat: string;
    /** ugoira 帧时序 JSON（无则空串） */
    framesJson: string;
  }): Promise<{ uri: string }>;
  cancel(options: { id: string }): Promise<void>;
  deleteFile(options: { uri: string }): Promise<void>;
  addListener(
    event: "progress",
    cb: (data: { id: string; done: number; total: number; pct: number }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

/**
 * 把 Capacitor 插件适配为 {@link DownloadExecutor}：
 * 进度事件全局订阅一次并按 taskId 路由；start 的 promise 完成即 onComplete/onFail。
 * 取消/删除后（active 无该 id）到达的迟到结果被丢弃（runId 之外的第二道竞态防线）。
 */
export function createCapacitorDownloadExecutor(
  native: PictelioDownloaderNative,
): DownloadExecutor {
  const active = new Map<string, DownloadExecutorCallbacks>();
  let listenerReady = false;

  function ensureListener(): void {
    if (listenerReady) return;
    listenerReady = true;
    void native
      .addListener("progress", (data) => {
        active.get(data.id)?.onProgress(data.pct, { done: data.done, total: data.total });
      })
      .catch((e: unknown) => console.warn("[capacitorDownloadExecutor] 进度监听注册失败", e));
  }

  return {
    start(task, _runId, cb) {
      active.set(task.id, cb);
      ensureListener();
      void native
        .start({
          id: task.id,
          sourceUrl: task.sourceUrl,
          fileName: task.fileName,
          kind: task.kind,
          targetFormat: task.targetFormat,
          framesJson: task.frames ? JSON.stringify(task.frames) : "",
        })
        .then((r) => {
          if (active.get(task.id) !== cb) return;
          active.delete(task.id);
          cb.onComplete(r.uri);
        })
        .catch((e: unknown) => {
          if (active.get(task.id) !== cb) return;
          active.delete(task.id);
          cb.onFail(e instanceof Error ? e.message : String(e));
        });
    },
    // 原生暂无「挂起保留部分进度」能力：pause 等同 cancel，续传重新下载（spec §2 申报范围）
    pause(id) {
      void native
        .cancel({ id })
        .catch((e: unknown) => console.warn("[capacitorDownloadExecutor] pause 失败", e));
    },
    cancel(id) {
      active.delete(id);
      void native
        .cancel({ id })
        .catch((e: unknown) => console.warn("[capacitorDownloadExecutor] cancel 失败", e));
    },
    async deleteFile(uri) {
      await native.deleteFile({ uri });
    },
  };
}

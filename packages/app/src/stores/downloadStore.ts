// ─── 下载队列响应式 store（Solid 薄壳，spec docs/specs/download-manager.md §4）───
// 深模块在 utils/downloadManager.ts（框架无关、node 可测）；本文件只做三件事：
// 提供 Preferences KV seam、注册原生执行器 seam（T3 接入）、把状态镜像进 Solid signal。
import { createSignal } from "solid-js";
import { Preferences } from "@capacitor/preferences";
import { t } from "../i18n";
import {
  createDownloadManager,
  type DownloadExecutor,
  type DownloadKV,
} from "../utils/downloadManager";
import type { DeleteMode, DownloadTaskDraft, QueueState } from "../utils/downloadQueueCore";

const KV: DownloadKV = {
  async get(key) {
    const { value } = await Preferences.get({ key });
    return value ?? null;
  },
  async set(key, value) {
    await Preferences.set({ key, value });
  },
};

let executor: DownloadExecutor | null = null;

/** 注册原生执行器（T3 在原生环境接入；未接入前任务显式失败）。 */
export function setDownloadExecutor(next: DownloadExecutor): void {
  executor = next;
}

/** 委托执行器：字节/编解码在原生（ADR-0146 D1），此层只转发。 */
const delegatingExecutor: DownloadExecutor = {
  start(task, runId, cb) {
    if (!executor) {
      console.warn("[downloadStore] 下载执行器未接入，任务失败");
      cb.onFail(t("core.store.downloadStore.executorNotReady")); // i18n: set 时快照（瞬态）
      return;
    }
    executor.start(task, runId, cb);
  },
  pause(id) {
    executor?.pause(id);
  },
  cancel(id) {
    executor?.cancel(id);
  },
  deleteFile(uri) {
    if (!executor) {
      console.warn("[downloadStore] 下载执行器未接入，删除文件失败");
      return Promise.reject(new Error(t("core.store.downloadStore.executorNotReady")));
    }
    return executor.deleteFile(uri);
  },
};

let sharer: ((uris: readonly string[]) => Promise<void>) | null = null;

/** 注册系统分享器（T6 在原生环境接入；未接入前显式失败）。 */
export function setDownloadSharer(next: (uris: readonly string[]) => Promise<void>): void {
  sharer = next;
}

const manager = createDownloadManager({ kv: KV, executor: delegatingExecutor });

const [downloadState, setDownloadState] = createSignal<QueueState>(manager.getState());
manager.subscribe((s) => setDownloadState(s));
// 启动即恢复一次持久队列（hydrate 幂等；页面重挂载不再覆盖内存态）
void manager.hydrate();

export { downloadState };

/** 从持久层恢复（downloading→paused），不自动开始。 */
export function hydrateDownloadQueue(): Promise<void> {
  return manager.hydrate();
}

export function enqueueDownloads(drafts: readonly DownloadTaskDraft[]): void {
  manager.enqueue(drafts);
}

export function startDownloads(ids: readonly string[]): void {
  manager.start(ids);
}

export function pauseDownloads(ids: readonly string[]): void {
  manager.pause(ids);
}

export function stopDownloads(ids: readonly string[]): void {
  manager.stop(ids);
}

export function deleteDownloads(ids: readonly string[], mode: DeleteMode): Promise<void> {
  return manager.deleteTasks(ids, mode);
}

export function flushDownloadQueue(): Promise<void> {
  return manager.flush();
}

/** 系统分享已下载文件（spec §7.1：仅 completed 且有 outputUri）。 */
export async function shareDownloads(ids: readonly string[]): Promise<void> {
  const uris = manager
    .getState()
    .tasks.filter((task) => ids.includes(task.id) && task.status === "completed" && task.outputUri)
    .map((task) => task.outputUri as string);
  if (uris.length === 0) {
    throw new Error(t("core.store.downloadStore.nothingToShare")); // i18n: set 时快照（瞬态）
  }
  if (!sharer) {
    console.warn("[downloadStore] 分享器未接入（T6）");
    throw new Error(t("core.store.downloadStore.sharerNotReady")); // i18n: set 时快照（瞬态）
  }
  await sharer(uris);
}

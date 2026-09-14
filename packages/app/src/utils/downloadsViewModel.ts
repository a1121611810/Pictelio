// ─── 下载页视图模型（纯函数，spec docs/specs/download-manager.md §7）───
// 与 app-lynx 的 downloadsViewModel.ts 同源同语义（双端差分对齐）；
// 纯函数、零框架依赖，node 可单测。UI 组件只负责渲染与事件接线。
// 文案经 t() 调用时快照（i18n B7）——渲染处仍在组件 JSX 内，zh 逐字不变。
import { t } from "../i18n";
import {
  canPause,
  canStart,
  canStop,
  type DownloadKind,
  type DownloadStatus,
  type DownloadTask,
} from "./downloadQueueCore";

/** 同一作品的任务聚为一组（一个输出文件 = 一条 task，spec §3.1 G4） */
export interface DownloadGroup {
  illustId: number;
  title: string;
  thumbnailUrl: string;
  kind: DownloadKind;
  tasks: DownloadTask[];
}

/** 按作品分组（保持任务首次出现顺序 = 入队顺序） */
export function groupByIllust(tasks: readonly DownloadTask[]): DownloadGroup[] {
  const groups: DownloadGroup[] = [];
  const index = new Map<number, number>();
  for (const task of tasks) {
    const i = index.get(task.illustId);
    if (i === undefined) {
      index.set(task.illustId, groups.length);
      groups.push({
        illustId: task.illustId,
        title: task.title,
        thumbnailUrl: task.thumbnailUrl,
        kind: task.kind,
        tasks: [task],
      });
    } else {
      groups[i]!.tasks.push(task);
    }
  }
  return groups;
}

/** 分组头部类型文案（spec §7）：ugoira=动图 / novel=小说 / 静态图=N 张 */
export function groupKindLabel(kind: DownloadKind, count: number): string {
  if (kind === "ugoira") return t("core.util.downloadsViewModel.kindUgoira"); // i18n: 调用时快照（瞬态）
  if (kind === "novel") return t("core.util.downloadsViewModel.kindNovel");
  return t("core.util.downloadsViewModel.kindPageCount", { count });
}

export interface ActionAvailability {
  start: boolean;
  pause: boolean;
  stop: boolean;
  delete: boolean;
  share: boolean;
}

/** 选中项的动作可用性（无选中 → 全部 false） */
export function availabilityFor(
  tasks: readonly DownloadTask[],
  ids: readonly string[],
): ActionAvailability {
  const chosen = tasks.filter((task) => ids.includes(task.id));
  return {
    start: chosen.some(canStart),
    pause: chosen.some(canPause),
    stop: chosen.some(canStop),
    delete: chosen.length > 0,
    share: chosen.some((task) => task.status === "completed" && !!task.outputUri),
  };
}

/** 全部条目的动作可用性（「全部」按钮） */
export function availabilityForAll(tasks: readonly DownloadTask[]): ActionAvailability {
  return availabilityFor(
    tasks,
    tasks.map((task) => task.id),
  );
}

/** 删除确认是否提供「删除文件」选项：任一所选 completed 且有 outputUri（spec §3.3） */
export function hasDeletableFiles(tasks: readonly DownloadTask[], ids: readonly string[]): boolean {
  return tasks.some(
    (task) => ids.includes(task.id) && task.status === "completed" && !!task.outputUri,
  );
}

export function statusLabel(status: DownloadStatus): string {
  switch (status) {
    case "queued":
      return t("core.util.downloadsViewModel.statusQueued"); // i18n: 调用时快照（瞬态）
    case "downloading":
      return t("core.util.downloadsViewModel.statusDownloading");
    case "paused":
      return t("core.util.downloadsViewModel.statusPaused");
    case "stopped":
      return t("core.util.downloadsViewModel.statusStopped");
    case "completed":
      return t("core.util.downloadsViewModel.statusCompleted");
    case "failed":
      return t("core.util.downloadsViewModel.statusFailed");
  }
}

/** 列表副标题文案（状态 / 进度 / 错误） */
export function progressText(task: DownloadTask): string {
  if (task.status === "completed") return t("core.util.downloadsViewModel.statusCompleted");
  if (task.status === "failed")
    return task.error
      ? t("core.util.downloadsViewModel.statusFailedWithReason", { reason: task.error })
      : t("core.util.downloadsViewModel.statusFailed");
  if (task.status === "downloading") return task.progress + "%";
  return statusLabel(task.status);
}

export interface SelectionSummary {
  count: number;
  completed: number;
  active: number;
}

export function summarize(
  tasks: readonly DownloadTask[],
  ids: readonly string[],
): SelectionSummary {
  const chosen = tasks.filter((task) => ids.includes(task.id));
  return {
    count: chosen.length,
    completed: chosen.filter((task) => task.status === "completed").length,
    active: chosen.filter((task) => task.status === "downloading").length,
  };
}

/** 分享目标 uri（仅 completed 且有 outputUri） */
export function shareableUris(tasks: readonly DownloadTask[], ids: readonly string[]): string[] {
  const uris: string[] = [];
  for (const task of tasks) {
    if (ids.includes(task.id) && task.status === "completed" && task.outputUri) {
      uris.push(task.outputUri);
    }
  }
  return uris;
}

/** 切换单选（immutable） */
export function toggleId(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function selectAll(tasks: readonly DownloadTask[]): Set<string> {
  return new Set(tasks.map((task) => task.id));
}

export function allSelected(
  tasks: readonly DownloadTask[],
  selected: ReadonlySet<string>,
): boolean {
  return tasks.length > 0 && tasks.every((task) => selected.has(task.id));
}

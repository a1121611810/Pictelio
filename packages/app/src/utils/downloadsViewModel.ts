// ─── 下载页视图模型（纯函数，spec docs/specs/download-manager.md §7）───
// 与 app-lynx 的 downloadsViewModel.ts 同源同语义（双端差分对齐）；
// 纯函数、零框架依赖，node 可单测。UI 组件只负责渲染与事件接线。
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
  for (const t of tasks) {
    const i = index.get(t.illustId);
    if (i === undefined) {
      index.set(t.illustId, groups.length);
      groups.push({
        illustId: t.illustId,
        title: t.title,
        thumbnailUrl: t.thumbnailUrl,
        kind: t.kind,
        tasks: [t],
      });
    } else {
      groups[i]!.tasks.push(t);
    }
  }
  return groups;
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
  const chosen = tasks.filter((t) => ids.includes(t.id));
  return {
    start: chosen.some(canStart),
    pause: chosen.some(canPause),
    stop: chosen.some(canStop),
    delete: chosen.length > 0,
    share: chosen.some((t) => t.status === "completed" && !!t.outputUri),
  };
}

/** 全部条目的动作可用性（「全部」按钮） */
export function availabilityForAll(tasks: readonly DownloadTask[]): ActionAvailability {
  return availabilityFor(
    tasks,
    tasks.map((t) => t.id),
  );
}

/** 删除确认是否提供「删除文件」选项：任一所选 completed 且有 outputUri（spec §3.3） */
export function hasDeletableFiles(tasks: readonly DownloadTask[], ids: readonly string[]): boolean {
  return tasks.some((t) => ids.includes(t.id) && t.status === "completed" && !!t.outputUri);
}

export function statusLabel(status: DownloadStatus): string {
  switch (status) {
    case "queued":
      return "排队中";
    case "downloading":
      return "下载中";
    case "paused":
      return "已暂停";
    case "stopped":
      return "已停止";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
  }
}

/** 列表副标题文案（状态 / 进度 / 错误） */
export function progressText(task: DownloadTask): string {
  if (task.status === "completed") return "已完成";
  if (task.status === "failed") return task.error ? "失败：" + task.error : "失败";
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
  const chosen = tasks.filter((t) => ids.includes(t.id));
  return {
    count: chosen.length,
    completed: chosen.filter((t) => t.status === "completed").length,
    active: chosen.filter((t) => t.status === "downloading").length,
  };
}

/** 分享目标 uri（仅 completed 且有 outputUri） */
export function shareableUris(tasks: readonly DownloadTask[], ids: readonly string[]): string[] {
  const uris: string[] = [];
  for (const t of tasks) {
    if (ids.includes(t.id) && t.status === "completed" && t.outputUri) uris.push(t.outputUri);
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
  return new Set(tasks.map((t) => t.id));
}

export function allSelected(
  tasks: readonly DownloadTask[],
  selected: ReadonlySet<string>,
): boolean {
  return tasks.length > 0 && tasks.every((t) => selected.has(t.id));
}

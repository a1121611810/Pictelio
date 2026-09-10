import type { Component } from "solid-js";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import FluentDialog from "../components/ui/FluentDialog";
import FluentIcon from "../components/ui/FluentIcon";
import PageTransition from "../components/PageTransition";
import {
  deleteDownloads,
  downloadState,
  hydrateDownloadQueue,
  pauseDownloads,
  shareDownloads,
  startDownloads,
  stopDownloads,
} from "../stores/downloadStore";
import { toWebProxyUrl } from "../utils/imageLoader";
import type { DeleteMode, DownloadTask } from "../utils/downloadQueueCore";
import {
  allSelected,
  availabilityFor,
  availabilityForAll,
  groupByIllust,
  hasDeletableFiles,
  progressText,
  selectAll,
  summarize,
  toggleId,
} from "../utils/downloadsViewModel";
import { goBack } from "../services/backTransitionService";

const BTN =
  "h-10 px-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusMedium)] border border-[var(--colorNeutralStroke1)] bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase300)] font-semibold cursor-pointer appearance-none transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--colorSubtleBackgroundHover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--colorStrokeFocus2)]";

interface TaskRowProps {
  task: DownloadTask;
  selected: boolean;
  onToggle: () => void;
}

const TaskRow: Component<TaskRowProps> = (props) => (
  <div class="flex items-center gap-3 px-3 py-2 border-b border-[var(--colorNeutralStroke2)] last:border-b-0">
    <button
      type="button"
      role="checkbox"
      aria-checked={props.selected ? "true" : "false"}
      aria-label={"选择 " + props.task.fileName}
      class={[
        "w-6 h-6 rounded-[var(--borderRadiusSmall)] border flex items-center justify-center shrink-0 cursor-pointer appearance-none transition-colors duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--colorStrokeFocus2)]",
        props.selected
          ? "bg-[var(--colorBrandBackground)] border-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)]"
          : "bg-[var(--colorNeutralBackground1)] border-[var(--colorNeutralStroke1)] text-transparent",
      ]}
      onClick={props.onToggle}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M13.5 4.5 6.5 11.5 2.5 7.5"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
    <div class="min-w-0 flex-1">
      <p class="truncate [font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)]">
        {props.task.fileName}
      </p>
      <div class="flex items-center gap-2 mt-1">
        <Show when={props.task.status === "downloading"}>
          <div class="h-1 flex-1 rounded-full bg-[var(--colorNeutralBackground3)] overflow-hidden">
            <div
              class="h-full bg-[var(--colorBrandBackground)] transition-[width] duration-[var(--durationFast)] ease-[var(--curveEasyEase)]"
              style={"width:" + props.task.progress + "%"}
            />
          </div>
        </Show>
        <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] shrink-0">
          {progressText(props.task)}
        </p>
      </div>
    </div>
  </div>
);

/**
 * 下载管理页（spec docs/specs/download-manager.md §7.1）。
 * 列表 + 单选/多选 + 对全部或选中项的开始/暂停/停止/删除；删除二次确认二分；已完成可系统分享。
 * 数据/动作全部来自 downloadStore（深模块），本页只做渲染与事件接线。
 */
const DownloadManager: Component = () => {
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = createSignal<readonly string[] | null>(null);
  const [status, setStatus] = createSignal<string | null>(null);

  onSettled(() => {
    void hydrateDownloadQueue();
  });

  const tasks = createMemo(() => downloadState().tasks);
  const groups = createMemo(() => groupByIllust(tasks()));
  const allIds = createMemo<readonly string[]>(() => tasks().map((t) => t.id));
  const effectiveIds = createMemo<readonly string[]>(() => {
    const sel = selected();
    return sel.size > 0 ? [...sel] : allIds();
  });
  const availability = createMemo(() =>
    selected().size > 0 ? availabilityFor(tasks(), [...selected()]) : availabilityForAll(tasks()),
  );
  const summary = createMemo(() => summarize(tasks(), effectiveIds()));
  const deletingFiles = createMemo(() => hasDeletableFiles(tasks(), deleteTarget() ?? []));
  const scopePrefix = createMemo(() => (selected().size > 0 ? "选中" : "全部"));

  function toggle(id: string): void {
    setSelected(toggleId(selected(), id));
  }

  function toggleAll(): void {
    setSelected(allSelected(tasks(), selected()) ? new Set<string>() : selectAll(tasks()));
  }

  function report(e: unknown): void {
    setStatus(e instanceof Error ? e.message : String(e));
  }

  async function actShare(): Promise<void> {
    try {
      await shareDownloads(effectiveIds());
      setStatus("已调起系统分享");
    } catch (e) {
      report(e);
    }
  }

  async function confirmDelete(mode: DeleteMode): Promise<void> {
    const target = deleteTarget();
    if (!target) return;
    try {
      await deleteDownloads(target, mode);
      setStatus(mode === "files" ? "已删除文件与记录" : "已清空记录");
      setSelected(new Set<string>());
    } catch (e) {
      report(e);
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <PageTransition>
      <div class="min-h-screen pb-28">
        <header class="sticky top-0 z-20 surface-appbar h-12 flex items-center px-4 gap-3">
          <button
            type="button"
            aria-label="返回"
            class="w-8 h-8 p-0 flex items-center justify-center rounded-[var(--borderRadiusMedium)] bg-transparent border-none outline-none cursor-pointer text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorSubtleBackgroundHover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)] ease-[var(--curveEasyEase)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--colorStrokeFocus2)]"
            onClick={() => goBack()}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M15.53 4.22a.75.75 0 0 1 0 1.06L8.81 12l6.72 6.72a.75.75 0 1 1-1.06 1.06l-7.25-7.25a.75.75 0 0 1 0-1.06l7.25-7.25a.75.75 0 0 1 1.06 0z"
                fill="currentColor"
              />
            </svg>
          </button>
          <h1 class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] flex-1">
            下载管理
          </h1>
        </header>

        <Show when={status()}>
          <div
            class="fixed left-1/2 -translate-x-1/2 top-14 z-40 px-4 py-2 rounded-[var(--borderRadiusMedium)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] shadow-[var(--elevation2)] [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground1)]"
            role="status"
          >
            {status()}
          </div>
        </Show>

        <Show
          when={tasks().length > 0}
          fallback={
            <div class="flex flex-col items-center justify-center py-24 gap-3 text-[var(--colorNeutralForeground3)]">
              <FluentIcon name="list" size={40} />
              <p class="[font-size:var(--fontSizeBase300)]">暂无下载任务</p>
              <p class="[font-size:var(--fontSizeBase200)]">在作品详情页点击保存即可加入下载队列</p>
            </div>
          }
        >
          <div class="px-4 pt-3 flex items-center justify-between gap-3">
            <button type="button" class={BTN} onClick={toggleAll}>
              {allSelected(tasks(), selected()) ? "取消全选" : "全选"}
            </button>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
              {selected().size > 0
                ? "已选 " + selected().size + " / 共 " + tasks().length
                : "全部 " + tasks().length}
            </p>
          </div>

          <div class="px-4 py-3 flex flex-col gap-[var(--spacingVerticalL)]">
            <For each={groups()}>
              {(group) => (
                <section class="rounded-[var(--borderRadiusLarge)] bg-[var(--colorNeutralBackground1)] border border-[var(--colorNeutralStroke1)] overflow-hidden">
                  <header class="flex items-center gap-3 px-3 py-2 border-b border-[var(--colorNeutralStroke2)]">
                    <img
                      src={toWebProxyUrl(group.thumbnailUrl)}
                      alt=""
                      loading="lazy"
                      class="w-10 h-10 rounded-[var(--borderRadiusMedium)] object-cover bg-[var(--colorNeutralBackground3)]"
                    />
                    <div class="min-w-0 flex-1">
                      <p class="truncate [font-size:var(--fontSizeBase300)] font-semibold text-[var(--colorNeutralForeground1)]">
                        {group.title}
                      </p>
                      <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                        {group.kind === "ugoira" ? "动图" : group.tasks.length + " 张"}
                      </p>
                    </div>
                  </header>
                  <For each={group.tasks}>
                    {(task) => (
                      <TaskRow
                        task={task}
                        selected={selected().has(task.id)}
                        onToggle={() => toggle(task.id)}
                      />
                    )}
                  </For>
                </section>
              )}
            </For>
          </div>
        </Show>

        <Show when={tasks().length > 0}>
          <div class="fixed left-0 right-0 bottom-0 z-30 px-4 py-3 surface-appbar border-t border-[var(--colorNeutralStroke2)] flex flex-wrap gap-2 justify-center">
            <button
              type="button"
              class={BTN}
              disabled={!availability().start}
              onClick={() => startDownloads(effectiveIds())}
            >
              {scopePrefix()}开始
            </button>
            <button
              type="button"
              class={BTN}
              disabled={!availability().pause}
              onClick={() => pauseDownloads(effectiveIds())}
            >
              {scopePrefix()}暂停
            </button>
            <button
              type="button"
              class={BTN}
              disabled={!availability().stop}
              onClick={() => stopDownloads(effectiveIds())}
            >
              {scopePrefix()}停止
            </button>
            <button
              type="button"
              class={BTN}
              disabled={!availability().share}
              onClick={() => void actShare()}
            >
              分享
            </button>
            <button
              type="button"
              class={BTN}
              disabled={!availability().delete}
              onClick={() => setDeleteTarget(effectiveIds())}
            >
              {scopePrefix()}删除
            </button>
            <p class="w-full text-center [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
              {summary().count} 项 · 已完成 {summary().completed} · 进行中 {summary().active}
            </p>
          </div>
        </Show>

        <FluentDialog
          open={deleteTarget() !== null}
          onClose={() => setDeleteTarget(null)}
          aria-label="删除下载确认"
        >
          <h2
            slot="title"
            class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)]"
          >
            删除下载
          </h2>
          <p class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground2)] leading-snug">
            将移除 {(deleteTarget() ?? []).length} 条下载记录。
          </p>
          <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] mt-2 leading-snug">
            「删除文件与记录」会同时删除已下载的文件；「仅清空记录」保留已下载文件。
          </p>
          <div slot="actions" class="flex flex-wrap gap-2 justify-end">
            <button type="button" class={BTN} onClick={() => setDeleteTarget(null)}>
              取消
            </button>
            <button type="button" class={BTN} onClick={() => void confirmDelete("records")}>
              仅清空记录
            </button>
            <Show when={deletingFiles()}>
              <button type="button" class={BTN} onClick={() => void confirmDelete("files")}>
                删除文件与记录
              </button>
            </Show>
          </div>
        </FluentDialog>
      </div>
    </PageTransition>
  );
};

export default DownloadManager;

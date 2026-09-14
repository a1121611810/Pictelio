// @vitest-environment happy-dom
// DownloadManager 组件测试（oracle = spec docs/specs/download-manager.md §7.1/§3.3）。
// Solid 2.0 微任务批处理：点击后 await flush() 再断言 DOM（对齐 PagePickerSheet.test.tsx）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@solidjs/testing-library";
import DownloadManager from "@/routes/DownloadManager";
import type { DownloadTask } from "@/utils/downloadQueueCore";

const h = vi.hoisted(() => ({
  state: { tasks: [] as unknown[] },
  hydrate: vi.fn(),
  start: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  del: vi.fn(() => Promise.resolve()),
  share: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/stores/downloadStore", () => ({
  downloadState: () => h.state,
  hydrateDownloadQueue: h.hydrate,
  startDownloads: h.start,
  pauseDownloads: h.pause,
  stopDownloads: h.stop,
  deleteDownloads: h.del,
  shareDownloads: h.share,
}));

vi.mock("@/services/backTransitionService", () => ({ goBack: vi.fn() }));
vi.mock("@/utils/imageLoader", () => ({ toWebProxyUrl: (u: string) => u }));
vi.mock("@/components/PageTransition", () => ({
  default: (props: { children?: unknown }) => props.children,
}));

const flush = () => Promise.resolve();

function task(over: Partial<DownloadTask> & { id: string }): DownloadTask {
  return {
    illustId: 1,
    title: "作品A",
    thumbnailUrl: "https://i.pximg.net/t.jpg",
    kind: "image",
    sourceUrl: "https://i.pximg.net/o.jpg",
    targetFormat: "jpg",
    fileName: "Pictelio_1.jpg",
    status: "queued",
    progress: 0,
    runId: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function setTasks(tasks: DownloadTask[]): void {
  h.state = { tasks };
}

describe("DownloadManager 页（spec §7.1）", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    setTasks([]);
  });

  it("空队列渲染空态", () => {
    render(() => <DownloadManager />);
    expect(screen.getByText("暂无下载任务")).toBeTruthy();
    expect(h.hydrate).toHaveBeenCalledTimes(1);
  });

  it("渲染分组与任务名，默认 scope=全部", () => {
    setTasks([task({ id: "a" }), task({ id: "b", fileName: "Pictelio_1_p1.jpg" })]);
    render(() => <DownloadManager />);
    expect(screen.getByText("作品A")).toBeTruthy();
    expect(screen.getByText("Pictelio_1.jpg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "全部开始" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "全部删除" })).toBeTruthy();
  });

  it("勾选任务后 scope 变为选中，动作作用于选中集合", async () => {
    setTasks([task({ id: "a" }), task({ id: "b", fileName: "Pictelio_1_p1.jpg" })]);
    render(() => <DownloadManager />);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Pictelio_1.jpg" }));
    await flush();
    expect(screen.getByText("已选 1 / 共 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "选中开始" }));
    expect(h.start).toHaveBeenCalledWith(["a"]);
  });

  it("无选中时动作作用于全部", () => {
    setTasks([task({ id: "a", status: "downloading", runId: 1 }), task({ id: "b" })]);
    render(() => <DownloadManager />);
    fireEvent.click(screen.getByRole("button", { name: "全部暂停" }));
    expect(h.pause).toHaveBeenCalledWith(["a", "b"]);
  });

  it("删除弹二次确认：已完成项提供删除文件选项并传 mode=files", async () => {
    setTasks([task({ id: "a", status: "completed", outputUri: "content://a" })]);
    render(() => <DownloadManager />);
    fireEvent.click(screen.getByRole("button", { name: "全部删除" }));
    await flush();
    expect(screen.getByText("将移除 1 条下载记录。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "删除文件与记录" }));
    await flush();
    await flush();
    expect(h.del).toHaveBeenCalledWith(["a"], "files");
  });

  it("仅清空记录路径：mode=records", async () => {
    setTasks([task({ id: "a", status: "completed", outputUri: "content://a" })]);
    render(() => <DownloadManager />);
    fireEvent.click(screen.getByRole("button", { name: "全部删除" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "仅清空记录" }));
    await flush();
    await flush();
    expect(h.del).toHaveBeenCalledWith(["a"], "records");
  });

  it("无可删文件时不显示删除文件选项", async () => {
    setTasks([task({ id: "a", status: "queued" })]);
    render(() => <DownloadManager />);
    fireEvent.click(screen.getByRole("button", { name: "全部删除" }));
    await flush();
    expect(screen.queryByRole("button", { name: "删除文件与记录" })).toBeNull();
    expect(screen.getByRole("button", { name: "仅清空记录" })).toBeTruthy();
  });

  it("分享已下载项调用 shareDownloads", () => {
    setTasks([task({ id: "a", status: "completed", outputUri: "content://a" })]);
    render(() => <DownloadManager />);
    fireEvent.click(screen.getByRole("button", { name: "分享" }));
    expect(h.share).toHaveBeenCalledWith(["a"]);
  });
});

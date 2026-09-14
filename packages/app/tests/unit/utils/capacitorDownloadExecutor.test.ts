// @vitest-environment happy-dom
// capacitorDownloadExecutor 单测（spec docs/specs/download-manager.md §4.3）：
// 进度路由 / 监听单次注册 / 完成失败映射 / 取消后迟到结果丢弃 / 删除委托。
import { describe, it, expect, vi } from "vitest";
import {
  createCapacitorDownloadExecutor,
  type PictelioDownloaderNative,
} from "@/utils/capacitorDownloadExecutor";
import type { DownloadExecutorCallbacks } from "@/utils/downloadManager";
import type { DownloadTask } from "@/utils/downloadQueueCore";

interface ProgressData {
  id: string;
  done: number;
  total: number;
  pct: number;
}

function task(id: string): DownloadTask {
  return {
    id,
    illustId: 1,
    title: "t",
    thumbnailUrl: "",
    kind: "image",
    sourceUrl: "https://i.pximg.net/o.jpg",
    targetFormat: "jpg",
    fileName: id + ".jpg",
    status: "downloading",
    progress: 0,
    runId: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function callbacks() {
  const onProgress = vi.fn();
  const onComplete = vi.fn();
  const onFail = vi.fn();
  const cb: DownloadExecutorCallbacks = { onProgress, onComplete, onFail };
  return { cb, onProgress, onComplete, onFail };
}

function fakeNative() {
  const resolvers = new Map<string, (uri: string) => void>();
  const rejecters = new Map<string, (e: unknown) => void>();
  let progressCb: ((d: ProgressData) => void) | null = null;
  let addListenerCalls = 0;
  const cancelled: string[] = [];
  const deleted: string[] = [];
  const native: PictelioDownloaderNative = {
    start: vi.fn(
      (o: { id: string }) =>
        new Promise<{ uri: string }>((resolve, reject) => {
          resolvers.set(o.id, (uri) => resolve({ uri }));
          rejecters.set(o.id, reject);
        }),
    ),
    cancel: vi.fn(async (o: { id: string }) => {
      cancelled.push(o.id);
    }),
    deleteFile: vi.fn(async (o: { uri: string }) => {
      deleted.push(o.uri);
    }),
    addListener: vi.fn(async (_event, cb) => {
      addListenerCalls++;
      progressCb = cb as (d: ProgressData) => void;
      return { remove: async () => {} };
    }),
  };
  return {
    native,
    cancelled,
    deleted,
    get addListenerCalls() {
      return addListenerCalls;
    },
    emit: (d: ProgressData) => progressCb?.(d),
    complete: (id: string, uri: string) => resolvers.get(id)?.(uri),
    fail: (id: string, e: unknown) => rejecters.get(id)?.(e),
  };
}

describe("createCapacitorDownloadExecutor（spec §4.3）", () => {
  it("进度监听只注册一次，并按 taskId 路由", () => {
    const f = fakeNative();
    const exec = createCapacitorDownloadExecutor(f.native);
    const a = callbacks();
    const b = callbacks();
    exec.start(task("a"), 1, a.cb);
    exec.start(task("b"), 1, b.cb);
    expect(f.addListenerCalls).toBe(1);
    f.emit({ id: "a", done: 50, total: 100, pct: 50 });
    expect(a.onProgress).toHaveBeenCalledWith(50, { done: 50, total: 100 });
    expect(b.onProgress).not.toHaveBeenCalled();
  });

  it("start 完成 → onComplete(uri)", async () => {
    const f = fakeNative();
    const exec = createCapacitorDownloadExecutor(f.native);
    const a = callbacks();
    exec.start(task("a"), 1, a.cb);
    f.complete("a", "content://a");
    await Promise.resolve();
    expect(a.onComplete).toHaveBeenCalledWith("content://a");
  });

  it("start 失败 → onFail(message)", async () => {
    const f = fakeNative();
    const exec = createCapacitorDownloadExecutor(f.native);
    const a = callbacks();
    exec.start(task("a"), 1, a.cb);
    f.fail("a", new Error("HTTP 404"));
    // .then(onFulfilled).catch(onRejected) 链：rejection 比 resolve 多一跳微任务
    await Promise.resolve();
    await Promise.resolve();
    expect(a.onFail).toHaveBeenCalledWith("HTTP 404");
  });

  it("cancel 后迟到的完成结果被丢弃", async () => {
    const f = fakeNative();
    const exec = createCapacitorDownloadExecutor(f.native);
    const a = callbacks();
    exec.start(task("a"), 1, a.cb);
    exec.cancel("a");
    f.complete("a", "content://late");
    await Promise.resolve();
    expect(a.onComplete).not.toHaveBeenCalled();
    expect(f.cancelled).toContain("a");
  });

  it("novel 任务透传 kind/targetFormat/payloadJson（spec novel-export §8）", () => {
    const f = fakeNative();
    const exec = createCapacitorDownloadExecutor(f.native);
    const a = callbacks();
    const t: DownloadTask = {
      ...task("novel_7_epub_111"),
      kind: "novel",
      targetFormat: "epub",
      fileName: "Pictelio_7.epub",
      sourceUrl: "https://www.pixiv.net/novel/show.php?id=7",
      payloadJson: '{"schema":1}',
    };
    exec.start(t, 1, a.cb);
    expect(f.native.start).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "novel_7_epub_111",
        kind: "novel",
        targetFormat: "epub",
        payloadJson: '{"schema":1}',
        framesJson: "",
      }),
    );
  });

  it("pause 委托 cancel；deleteFile 委托原生", async () => {
    const f = fakeNative();
    const exec = createCapacitorDownloadExecutor(f.native);
    exec.pause("a");
    await exec.deleteFile("content://a");
    expect(f.cancelled).toContain("a");
    expect(f.deleted).toEqual(["content://a"]);
  });
});

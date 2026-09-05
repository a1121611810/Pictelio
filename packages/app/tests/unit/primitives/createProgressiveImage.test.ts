// @vitest-environment happy-dom
/**
 * createProgressiveImage 状态机全矩阵测试（spec: docs/specs/webview-perf-round2.md §2.1）。
 *
 * oracle 溯源：期望值来自 spec §2 状态机条文（L1 直挂 / 单段直载 / URL 键守卫 / 失败矩阵），
 * 非从被测实现反推。loadImage 用手动 deferred promise 驱动，隔离真实网络；
 * resolveImageUrl mock 为「PROXY::」前缀变换，断言与其一一对应。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import {
  createProgressiveImage,
  type ProgressiveImageState,
} from "@/primitives/createProgressiveImage";
import { checkImageCache, loadImage } from "@/utils/imageLoader";

vi.mock("@/utils/imageLoader", () => ({
  checkImageCache: vi.fn<() => string | undefined>(() => undefined),
  resolveImageUrl: (url: string) => (url ? `PROXY::${url}` : ""),
  loadImage: vi.fn(() => Promise.reject(new Error("not stubbed"))),
}));

/** 真实 URL 形态 fixture（与 IllustSingleCard.test.tsx 同源，spec §2 档位事实） */
const FULL =
  "https://i.pximg.net/c/600x1200_90/img-master/img/2026/06/30/13/50/51/202_p0_master1200.jpg";
const THUMB =
  "https://i.pximg.net/c/540x540_70/img-master/img/2026/06/30/13/50/51/202_p0_master1200.jpg";
const FULL_2 =
  "https://i.pximg.net/c/600x1200_90/img-master/img/2026/06/30/13/50/51/203_p0_master1200.jpg";

/** loadImage 返回结构（imageLoader.LoadedImage 形态） */
interface LoadedImageLike {
  url: string;
  cleanup: () => void;
}
function loadedImage(url: string): LoadedImageLike {
  return { url, cleanup: () => {} };
}

/** 手动 deferred promise：驱动状态机的预载完成时机 */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 放行微任务/宏任务队列（loadImage.then 回调 → signal 写入） */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** 在 createRoot 内挂载原语（Solid 响应式原语必须在 owner 内运行）；dispose 由用例显式调用 */
function mount(
  fullUrl: () => string,
  thumbUrl: () => string,
): {
  state: ProgressiveImageState;
  dispose: () => void;
} {
  let state!: ProgressiveImageState;
  const dispose = createRoot((disposer) => {
    state = createProgressiveImage({ fullUrl, thumbUrl });
    return disposer;
  });
  return { state, dispose };
}

describe("createProgressiveImage", () => {
  beforeEach(() => {
    // restoreMocks 会在每个用例前重置 mock 实现，这里按用例默认态重建
    vi.mocked(checkImageCache).mockReturnValue(undefined);
    vi.mocked(loadImage).mockImplementation(() => Promise.reject(new Error("not stubbed")));
  });

  it("L1 命中：直挂 full 无渐进（不调 loadImage、不挂缩略层）", async () => {
    vi.mocked(checkImageCache).mockReturnValue(`PROXY::${FULL}`);
    const { state: p, dispose } = mount(
      () => FULL,
      () => THUMB,
    );
    await flush();
    expect(p.displaySrc()).toBe(`PROXY::${FULL}`);
    expect(p.thumbSrc()).toBeUndefined();
    expect(p.failed()).toBe(false);
    expect(loadImage).not.toHaveBeenCalled();
    dispose();
  });

  it("miss + thumb 有效：thumb 先行、主 img 不挂载（防白帧）、loadImage(full) 预载", async () => {
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { state: p, dispose } = mount(
      () => FULL,
      () => THUMB,
    );
    await flush();
    expect(p.thumbSrc()).toBe(`PROXY::${THUMB}`);
    expect(p.displaySrc()).toBe("");
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledWith(FULL);
    expect(p.failed()).toBe(false);
    dispose();
  });

  it("预载 resolve 后经 URL 键守卫切换主层", async () => {
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { state: p, dispose } = mount(
      () => FULL,
      () => THUMB,
    );
    await flush();
    d.resolve(loadedImage(`PROXY::${FULL}`));
    await flush();
    expect(p.displaySrc()).toBe(`PROXY::${FULL}`);
    expect(p.failed()).toBe(false);
    dispose();
  });

  it("full resolve 后、onDisplayLoad 前：thumbSrc 保持（thumb 层仍兜底）", async () => {
    // B1（issue #358）：thumb 卸载时机 = 主 img load（真实绘制就绪），不是预载 resolve
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { state: p, dispose } = mount(
      () => FULL,
      () => THUMB,
    );
    await flush();
    d.resolve(loadedImage(`PROXY::${FULL}`));
    await flush();
    expect(p.displaySrc()).toBe(`PROXY::${FULL}`);
    expect(p.thumbSrc()).toBe(`PROXY::${THUMB}`);
    dispose();
  });

  it("onDisplayLoad 触发（主 img load = full 绘制就绪）：thumbSrc 收窄为空串（thumb 层卸载）", async () => {
    // oracle：full 绘制就绪即卸载，回收双层常驻的合成/解码成本；失败路径（fullPainted=false）thumb 保留
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { state: p, dispose } = mount(
      () => FULL,
      () => THUMB,
    );
    await flush();
    d.resolve(loadedImage(`PROXY::${FULL}`));
    await flush();
    p.onDisplayLoad(new Event("load"));
    expect(p.thumbSrc()).toBe(""); // 空串 = 绘制完成后卸载（区别于 undefined = 从未挂载）
    expect(p.displaySrc()).toBe(`PROXY::${FULL}`);
    expect(p.failed()).toBe(false);
    dispose();
  });

  it("fullUrl 变化（generation 重置）：fullPainted 重置，新图 thumb 层重新挂载兜底", async () => {
    const [full, setFull] = createSignal(FULL);
    const dA = createDeferred<LoadedImageLike>();
    const dB = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockImplementation((url: string) =>
      url === FULL ? dA.promise : dB.promise,
    );
    const { state: p, dispose } = mount(full, () => THUMB);
    await flush();
    dA.resolve(loadedImage(`PROXY::${FULL}`));
    await flush();
    p.onDisplayLoad(new Event("load"));
    expect(p.thumbSrc()).toBe(""); // A 图已绘制，thumb 已卸载

    setFull(FULL_2);
    await flush();
    // 新一轮 URL：fullPainted 重置 → 新 thumb 层重新挂载兜底，主层暂不挂载（防白帧）
    expect(p.thumbSrc()).toBe(`PROXY::${THUMB}`);
    expect(p.displaySrc()).toBe("");
    dB.resolve(loadedImage(`PROXY::${FULL_2}`));
    await flush();
    expect(p.displaySrc()).toBe(`PROXY::${FULL_2}`);
    expect(p.thumbSrc()).toBe(`PROXY::${THUMB}`); // B 图 load 未触发，兜底仍在
    p.onDisplayLoad(new Event("load"));
    expect(p.thumbSrc()).toBe("");
    dispose();
  });

  it("无 thumb：单段直载（行为=现状，不调 loadImage）", async () => {
    const { state: p, dispose } = mount(
      () => FULL,
      () => "",
    );
    await flush();
    expect(p.displaySrc()).toBe(`PROXY::${FULL}`);
    expect(p.thumbSrc()).toBeUndefined();
    expect(loadImage).not.toHaveBeenCalled();
    dispose();
  });

  it("thumb===full：单段直载（渐进零收益）", async () => {
    const { state: p, dispose } = mount(
      () => FULL,
      () => FULL,
    );
    await flush();
    expect(p.displaySrc()).toBe(`PROXY::${FULL}`);
    expect(p.thumbSrc()).toBeUndefined();
    expect(loadImage).not.toHaveBeenCalled();
    dispose();
  });

  it("空 fullUrl：主层与缩略层均不挂载", async () => {
    const { state: p, dispose } = mount(
      () => "",
      () => THUMB,
    );
    await flush();
    expect(p.displaySrc()).toBe("");
    expect(p.thumbSrc()).toBeUndefined();
    expect(loadImage).not.toHaveBeenCalled();
    dispose();
  });

  it("thumb 失败：卸载缩略层 + warn（full 预载继续）", async () => {
    const warnSpy = vi.spyOn(console, "warn");
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { state: p, dispose } = mount(
      () => FULL,
      () => THUMB,
    );
    await flush();
    p.onThumbError();
    await flush();
    expect(p.thumbSrc()).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("thumb");
    // full 尚未失败 → 不置 failed
    expect(p.failed()).toBe(false);
    dispose();
  });

  it("full 预载失败：warn + thumb 层常驻兜底，单失败不置 failed", async () => {
    const warnSpy = vi.spyOn(console, "warn");
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { state: p, dispose } = mount(
      () => FULL,
      () => THUMB,
    );
    await flush();
    d.reject(new Error("network down"));
    await flush();
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("full");
    expect(p.thumbSrc()).toBe(`PROXY::${THUMB}`); // 兜底保留
    expect(p.displaySrc()).toBe("");
    expect(p.failed()).toBe(false);
    dispose();
  });

  it("双失败（thumb 失败后 full 失败）：failed=true", async () => {
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { state: p, dispose } = mount(
      () => FULL,
      () => THUMB,
    );
    await flush();
    p.onThumbError();
    d.reject(new Error("network down"));
    await flush();
    expect(p.failed()).toBe(true);
    dispose();
  });

  it("主图 <img> onError：渐进路径卸载主层露出 thumb 兜底", async () => {
    const warnSpy = vi.spyOn(console, "warn");
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { state: p, dispose } = mount(
      () => FULL,
      () => THUMB,
    );
    await flush();
    d.resolve(loadedImage(`PROXY::${FULL}`));
    await flush();
    expect(p.displaySrc()).toBe(`PROXY::${FULL}`);
    p.onDisplayError();
    await flush();
    expect(p.displaySrc()).toBe("");
    expect(p.thumbSrc()).toBe(`PROXY::${THUMB}`); // thumb 未失败 → 兜底可见 → 非 failed
    expect(p.failed()).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    dispose();
  });

  it("主图 <img> onError：单段路径保持现状（不卸载、failed 不适用）", async () => {
    const { state: p, dispose } = mount(
      () => FULL,
      () => "",
    );
    await flush();
    p.onDisplayError();
    await flush();
    expect(p.displaySrc()).toBe(`PROXY::${FULL}`);
    expect(p.failed()).toBe(false);
    dispose();
  });

  it("fullUrl 响应式变化：URL 键守卫丢弃陈旧回调，防串位", async () => {
    const [full, setFull] = createSignal(FULL);
    const dA = createDeferred<LoadedImageLike>();
    const dB = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockImplementation((url: string) =>
      url === FULL ? dA.promise : dB.promise,
    );
    const { state: p, dispose } = mount(full, () => THUMB);
    await flush();
    expect(p.displaySrc()).toBe("");

    // URL 切换 → generation 自增，A 的回调作废
    setFull(FULL_2);
    dA.resolve(loadedImage(`PROXY::${FULL}`));
    await flush();
    // A 的陈旧响应不得串位到新 URL 的展示
    expect(p.displaySrc()).toBe("");

    dB.resolve(loadedImage(`PROXY::${FULL_2}`));
    await flush();
    expect(p.displaySrc()).toBe(`PROXY::${FULL_2}`);
    dispose();
  });

  it("卸载后预载回调作废（onCleanup 守卫）", async () => {
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    let p!: ProgressiveImageState;
    createRoot((disposer) => {
      p = createProgressiveImage({ fullUrl: () => FULL, thumbUrl: () => THUMB });
      disposer();
    });
    d.resolve(loadedImage(`PROXY::${FULL}`));
    await flush();
    // 已卸载：陈旧回调不得写入
    expect(p.displaySrc()).toBe("");
  });
});

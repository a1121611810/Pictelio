// @vitest-environment happy-dom
/**
 * createProgressiveImage 状态机全矩阵测试（spec: docs/specs/webview-perf-round2.md §2.1；
 * round4 追加：docs/specs/webview-perf-round4.md §A「prefetch 命中卡跳过 thumb 直挂 full」）。
 *
 * oracle 溯源：期望值来自 spec §2 状态机条文（L1 直挂 / 单段直载 / URL 键守卫 / 失败矩阵）
 * 与 round4 §A 三态表（L1 已有 / inflight 在途 / 皆无），非从被测实现反推。
 * loadImage 用手动 deferred promise 驱动，隔离真实网络；
 * resolveImageUrl mock 为「PROXY::」前缀变换，断言与其一一对应。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import {
  createProgressiveImage,
  type ProgressiveImageState,
} from "@/primitives/createProgressiveImage";
import { checkImageCache, isImagePrefetching, loadImage } from "@/utils/imageLoader";

vi.mock("@/utils/imageLoader", () => ({
  checkImageCache: vi.fn<() => string | undefined>(() => undefined),
  isImagePrefetching: vi.fn<(url: string) => boolean>(() => false),
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
    vi.mocked(isImagePrefetching).mockReturnValue(false);
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

  // ── round4 A 线：prefetch 在途跳 thumb（spec: docs/specs/webview-perf-round4.md §A 三态表）──

  it("full 预取在途：跳过 thumb 直候 full（thumbSrc undefined、主层预载门控保持）", async () => {
    // oracle：round4 §A 三态表「inflight 在途 → 跳过 thumb，setDisplaySrc("") 保持预载门控直候 full」；
    // 预载门控红线：主层仍等 loadImage resolve 才挂载（防跨写方并发下载）
    vi.mocked(isImagePrefetching).mockReturnValue(true);
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { state: p, dispose } = mount(
      () => FULL,
      () => THUMB,
    );
    await flush();
    expect(isImagePrefetching).toHaveBeenCalledWith(FULL);
    expect(p.thumbSrc()).toBeUndefined(); // 跳过 thumb，缩略层从未挂载
    expect(p.displaySrc()).toBe(""); // 主层仍等预载 resolve（门控保留）
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledWith(FULL); // 预载与预取共享同一 inflight Promise
    expect(p.failed()).toBe(false);
    dispose();
  });

  it("在途跳过 thumb + 预载 resolve：主层直挂 full，全程无 thumb 层（无第二次加载）", async () => {
    // oracle：round4 §A 候选目标「消除渐进第二次加载」——resolve 前后 thumb 均无挂载值；
    // onDisplayLoad 后 thumbSrc 为空串（fullPainted 收窄 accessor 语义，空串与 undefined
    // 同为「DOM 无 thumb 层」：空串=绘制后卸载，undefined=从未挂载）
    vi.mocked(isImagePrefetching).mockReturnValue(true);
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { state: p, dispose } = mount(
      () => FULL,
      () => THUMB,
    );
    await flush();
    expect(p.thumbSrc()).toBeUndefined();
    d.resolve(loadedImage(`PROXY::${FULL}`));
    await flush();
    expect(p.displaySrc()).toBe(`PROXY::${FULL}`);
    expect(p.thumbSrc()).toBeUndefined(); // resolve 后仍无 thumb
    p.onDisplayLoad(new Event("load"));
    expect(p.thumbSrc()).toBe(""); // 绘制后收窄为空串（无 thumb 层不变）
    dispose();
  });

  it("在途跳过 thumb + 预载失败：warn + 延迟挂载 thumb 兜底（非静默降级）", async () => {
    // oracle：round4 §A「预取在途失败 → catch 延迟挂 thumb 兜底 + console.warn」
    // + 仓库硬约束 #3（禁止静默降级）；单失败不置 failed（失败矩阵 #4 语义保持）
    const warnSpy = vi.spyOn(console, "warn");
    vi.mocked(isImagePrefetching).mockReturnValue(true);
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { state: p, dispose } = mount(
      () => FULL,
      () => THUMB,
    );
    await flush();
    expect(p.thumbSrc()).toBeUndefined();
    d.reject(new Error("prefetch failed"));
    await flush();
    expect(p.thumbSrc()).toBe(`PROXY::${THUMB}`); // 延迟挂载兜底
    expect(p.displaySrc()).toBe(""); // 主层保持未挂载
    expect(p.failed()).toBe(false); // thumb 未失败 → 单失败
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("[createProgressiveImage]");
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("full");
    dispose();
  });

  it("在途跳过 thumb + 主层 onError：延迟挂载 thumb 兜底", async () => {
    // oracle：round4 §A「onDisplayError：full 加载失败且 thumb 被跳过 → 延迟挂 thumb + warn」；
    // 失败矩阵 #3/#4 语义保持（thumb 兜底可见 → 非 failed）
    const warnSpy = vi.spyOn(console, "warn");
    vi.mocked(isImagePrefetching).mockReturnValue(true);
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
    expect(p.displaySrc()).toBe(""); // 主层卸载
    expect(p.thumbSrc()).toBe(`PROXY::${THUMB}`); // 延迟挂载兜底
    expect(p.failed()).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    // 非静默降级：延迟挂载必须伴随专属 warn（硬约束 #3）
    expect(warnSpy.mock.calls.some((args) => String(args[0]).includes("thumb 曾被在途跳过"))).toBe(
      true,
    );
    dispose();
  });

  it("在途跳过 thumb 双失败：延迟挂载的 thumb 再失败 → failed=true", async () => {
    // oracle：失败矩阵 #5（双失败终态）语义保持——round4 §A 红线「双失败仍走既有
    // failed=true 语义」，延迟挂载的 thumb 也失败时调用方失败 UI，无永久空
    vi.mocked(isImagePrefetching).mockReturnValue(true);
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { state: p, dispose } = mount(
      () => FULL,
      () => THUMB,
    );
    await flush();
    d.reject(new Error("prefetch failed")); // 第一次失败 → 延迟挂 thumb
    await flush();
    expect(p.thumbSrc()).toBe(`PROXY::${THUMB}`);
    p.onThumbError(); // 延迟挂载的 thumb 也失败
    expect(p.failed()).toBe(true);
    dispose();
  });

  it("预取不在途（isImagePrefetching=false）：thumb 先行挂载（现状回归锁）", async () => {
    // oracle：round4 §A 三态表「皆无 → 现状渐进（thumb 先行），行为与今天逐字节一致」；
    // 现有用例「miss + thumb 有效」的在途门控配对版
    vi.mocked(isImagePrefetching).mockReturnValue(false);
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { state: p, dispose } = mount(
      () => FULL,
      () => THUMB,
    );
    await flush();
    expect(p.thumbSrc()).toBe(`PROXY::${THUMB}`); // thumb 即刻先行
    expect(p.displaySrc()).toBe(""); // 主 img 不挂载（防白帧）
    expect(loadImage).toHaveBeenCalledTimes(1);
    expect(loadImage).toHaveBeenCalledWith(FULL);
    dispose();
  });

  it("L1 命中优先于在途判定：直挂 full、不调 loadImage", async () => {
    // oracle：createProgressiveImage 分支序（L1 直挂分支先于渐进分支）
    // + round4 §A 三态互斥语义（L1 已有=预取已完成，优先走直挂）
    vi.mocked(checkImageCache).mockReturnValue(`PROXY::${FULL}`);
    vi.mocked(isImagePrefetching).mockReturnValue(true);
    const { state: p, dispose } = mount(
      () => FULL,
      () => THUMB,
    );
    await flush();
    expect(p.displaySrc()).toBe(`PROXY::${FULL}`);
    expect(p.thumbSrc()).toBeUndefined();
    expect(loadImage).not.toHaveBeenCalled();
    dispose();
  });

  it("fullUrl 变化（generation 重置）：在途态同样重置，新 URL 不在途 → 新 thumb 挂载", async () => {
    // oracle：URL 键守卫语义（generation 自增 → 旧回调丢弃，现有用例同款）
    // + round4 §A 测试表 #8（在途态随 generation 重置，新 URL 按三态表重新判定）
    vi.mocked(isImagePrefetching).mockReturnValue(true);
    const [full, setFull] = createSignal(FULL);
    const dA = createDeferred<LoadedImageLike>();
    const dB = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockImplementation((url: string) =>
      url === FULL ? dA.promise : dB.promise,
    );
    const { state: p, dispose } = mount(full, () => THUMB);
    await flush();
    expect(p.thumbSrc()).toBeUndefined(); // A 在途：跳过 thumb
    expect(p.displaySrc()).toBe("");

    // 新 URL 不在途（mock 切换 false）→ 恢复现状渐进路径；A 的陈旧 resolve 被键守卫丢弃
    vi.mocked(isImagePrefetching).mockReturnValue(false);
    setFull(FULL_2);
    dA.resolve(loadedImage(`PROXY::${FULL}`));
    await flush();
    expect(p.thumbSrc()).toBe(`PROXY::${THUMB}`); // 新 URL thumb 先行
    expect(p.displaySrc()).toBe(""); // A 的陈旧响应不得串位

    dB.resolve(loadedImage(`PROXY::${FULL_2}`));
    await flush();
    expect(p.displaySrc()).toBe(`PROXY::${FULL_2}`);
    dispose();
  });

  it("单段直载（thumb===full）主图失败：不重挂 thumb、failed 不翻转（review P2 回归锁）", async () => {
    // oracle：状态机 #6「无 thumb / thumb===full → 单段直载，行为等同现状」
    // + onDisplayError 尾注「单段路径 failed 语义不适用」——skippedForInflight 未置位，
    // 延迟兜底分支不可达，不会对刚失败的同一 URL 二次发起必然失败的请求
    const warnSpy = vi.spyOn(console, "warn");
    vi.mocked(isImagePrefetching).mockReturnValue(false);
    const { state: p, dispose } = mount(
      () => FULL,
      () => FULL, // thumb===full → 单段直载
    );
    await flush();
    expect(p.displaySrc()).toBe(`PROXY::${FULL}`);
    expect(p.thumbSrc()).toBeUndefined();
    p.onDisplayError();
    await flush();
    expect(p.thumbSrc()).toBeUndefined(); // 不重挂 thumb
    expect(p.displaySrc()).toBe(`PROXY::${FULL}`); // 单段路径保持现状（浏览器破图态）
    expect(p.failed()).toBe(false); // failed 语义不适用
    expect(warnSpy.mock.calls.some((args) => String(args[0]).includes("曾被在途跳过"))).toBe(false);
    dispose();
  });

  it("L1 命中卡主图迟发失败：不重挂 thumb（现状回归锁）", async () => {
    // oracle：三态表第 1 行「L1 已有=预取已完成 → 直挂 full」+ 现状行为（直挂后迟发
    // onError 无 thumb 兜底）；skippedForInflight 未置位 → 延迟兜底分支不可达
    const warnSpy = vi.spyOn(console, "warn");
    vi.mocked(checkImageCache).mockReturnValue(`PROXY::${FULL}`);
    const { state: p, dispose } = mount(
      () => FULL,
      () => THUMB,
    );
    await flush();
    expect(p.displaySrc()).toBe(`PROXY::${FULL}`);
    p.onDisplayError();
    await flush();
    expect(p.thumbSrc()).toBeUndefined(); // 不重挂 thumb
    expect(p.failed()).toBe(false); // 仅 full 失败，双失败终态不触发
    expect(warnSpy.mock.calls.some((args) => String(args[0]).includes("曾被在途跳过"))).toBe(false);
    dispose();
  });

  it("在途跳过 + full 绘制就绪后迟发 onError：不重挂 thumb（兜底窗口已关闭）", async () => {
    // oracle：review P2 语义收窄——skippedForInflight 在 onDisplayLoad 清除，绘制后的
    // 迟发失败与无本候选时行为一致（保持破图态，不重挂 thumb）
    vi.mocked(isImagePrefetching).mockReturnValue(true);
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { state: p, dispose } = mount(
      () => FULL,
      () => THUMB,
    );
    await flush();
    d.resolve(loadedImage(`PROXY::${FULL}`));
    await flush();
    p.onDisplayLoad(new Event("load")); // full 绘制就绪 → 兜底窗口关闭
    expect(p.thumbSrc()).toBe(""); // thumb 层已卸载（fullPainted 收窄）
    p.onDisplayError(); // 迟发失败
    await flush();
    expect(p.thumbSrc()).toBe(""); // 不重挂（窗口已关闭）
    expect(p.failed()).toBe(false);
    dispose();
  });
});

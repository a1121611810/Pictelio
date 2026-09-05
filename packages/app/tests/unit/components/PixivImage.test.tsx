// @vitest-environment happy-dom
/**
 * PixivImage 契约测试（spec: docs/specs/webview-perf-round2.md §2.4）。
 *
 * oracle 溯源：
 * - 「不传 thumbSrc → 单个裸 <img>」= 旧版 DOM 现状（回归保护，spec 明确要求逐字节一致）；
 * - 「传 thumbSrc → 渐进双 img wrapper」= spec §2.4 分支结构
 *   （thumb 底层 aria-hidden + pointer-events-none，full 到位前主层不挂载）；
 * - L1 命中直挂 = 旧版 checkImageCache 同步快路径语义。
 * loadImage/checkImageCache 用 vi.mock 隔离真实网络与 L1 全局状态。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import PixivImage from "@/components/PixivImage";
import { checkImageCache, loadImage } from "@/utils/imageLoader";

vi.mock("@/utils/imageLoader", () => ({
  checkImageCache: vi.fn<() => string | undefined>(() => undefined),
  resolveImageUrl: (url: string) => (url ? `PROXY::${url}` : ""),
  loadImage: vi.fn(() => Promise.reject(new Error("not stubbed"))),
}));

interface LoadedImageLike {
  url: string;
  cleanup: () => void;
}

/** 手动 deferred promise：驱动渐进预载完成时机 */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const SRC =
  "https://i.pximg.net/c/600x1200_90/img-master/img/2026/06/30/13/50/51/202_p0_master1200.jpg";
const THUMB =
  "https://i.pximg.net/c/540x540_70/img-master/img/2026/06/30/13/50/51/202_p0_master1200.jpg";

describe("PixivImage — 非渐进路径（不传 thumbSrc，回归保护）", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.mocked(checkImageCache).mockReturnValue(undefined);
    vi.mocked(loadImage).mockImplementation(() => Promise.reject(new Error("not stubbed")));
  });

  it("首元素为裸 <img>，src 经 resolveImageUrl（DOM 等价现状）", () => {
    const { container } = render(() => <PixivImage src={SRC} alt="封面图" />);
    // 整个组件只渲染一个元素且就是 img（旧版为 fragment 裸 img，无 wrapper div）
    expect(container.children.length).toBe(1);
    const img = container.children[0] as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe(`PROXY::${SRC}`);
    expect(img.getAttribute("alt")).toBe("封面图");
    expect(checkImageCache).toHaveBeenCalledWith(SRC);
    expect(loadImage).not.toHaveBeenCalled();
  });

  it("L1 命中：同步直挂缓存代理 URL", () => {
    vi.mocked(checkImageCache).mockReturnValue("PROXY::cached-blob");
    const { container } = render(() => <PixivImage src={SRC} />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("PROXY::cached-blob");
    expect(loadImage).not.toHaveBeenCalled();
  });

  it("img onError → 失败 UI（加载失败）", async () => {
    const { container } = render(() => <PixivImage src={SRC} />);
    const img = container.querySelector("img") as HTMLImageElement;
    fireEvent.error(img);
    await flush();
    expect(container.textContent).toContain("加载失败");
  });
});

describe("PixivImage — 渐进 wrapper 分支（传 thumbSrc）", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.mocked(checkImageCache).mockReturnValue(undefined);
    vi.mocked(loadImage).mockImplementation(() => Promise.reject(new Error("not stubbed")));
  });

  it("full 到位前：仅 thumb 底层挂载（aria-hidden + pointer-events-none），主层不挂载", async () => {
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { container } = render(() => (
      <PixivImage src={SRC} thumbSrc={THUMB} objectFit="cover" class="w-10 h-10" />
    ));
    await flush();

    const wrapper = container.children[0] as HTMLElement;
    expect(wrapper.tagName).toBe("DIV");
    expect(wrapper.className).toContain("relative");
    expect(wrapper.className).toContain("w-10");

    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(1); // 主层不挂载
    const thumb = imgs[0] as HTMLImageElement;
    expect(thumb.getAttribute("src")).toBe(`PROXY::${THUMB}`);
    expect(thumb.getAttribute("aria-hidden")).toBe("true");
    expect(thumb.className).toContain("pointer-events-none");
    expect(thumb.className).toContain("absolute");
    // thumb 层与主层一致异步解码（Standards 硬约定，回归防线）
    expect(thumb.getAttribute("decoding")).toBe("async");
    expect(loadImage).toHaveBeenCalledWith(SRC);
  });

  it("wrapper 含 overflow-hidden（S3：圆角裁剪收敛在 wrapper，NovelCoverCard compact 等调用方依赖）", async () => {
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { container } = render(() => <PixivImage src={SRC} thumbSrc={THUMB} />);
    await flush();

    const wrapper = container.children[0] as HTMLElement;
    expect(wrapper.className).toContain("overflow-hidden");
  });

  it("预载 resolve 后主层挂载，thumb 底层保留兜底", async () => {
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { container } = render(() => <PixivImage src={SRC} thumbSrc={THUMB} objectFit="cover" />);
    await flush();
    d.resolve({ url: `PROXY::${SRC}`, cleanup: () => {} });
    await flush();

    const imgs = () => Array.from(container.querySelectorAll("img"));
    expect(imgs().length).toBe(2);
    // 主层 = 非 aria-hidden 的 img
    const mainImg = imgs().find(
      (el) => el.getAttribute("aria-hidden") !== "true",
    ) as HTMLImageElement;
    expect(mainImg.getAttribute("src")).toBe(`PROXY::${SRC}`);
    expect(mainImg.className).toContain("relative");
    expect(mainImg.style.objectFit).toBe("cover");
  });

  it("full 绘制完成（主 img load）后 thumb 层从 DOM 卸载（B1：回收双层常驻成本）", async () => {
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { container } = render(() => <PixivImage src={SRC} thumbSrc={THUMB} />);
    await flush();
    d.resolve({ url: `PROXY::${SRC}`, cleanup: () => {} });
    await flush();
    expect(container.querySelectorAll("img").length).toBe(2); // painted 前：双层常驻
    const mainImg = Array.from(container.querySelectorAll("img")).find(
      (el) => el.getAttribute("aria-hidden") !== "true",
    ) as HTMLImageElement;
    fireEvent.load(mainImg);
    await flush();
    expect(container.querySelectorAll("img").length).toBe(1); // painted 后：仅主层
    const remaining = container.querySelector("img") as HTMLImageElement;
    expect(remaining.getAttribute("aria-hidden")).not.toBe("true");
    expect(remaining.getAttribute("src")).toBe(`PROXY::${SRC}`);
  });

  it("主 img load 后 props.onLoad 仍被转发调用（链式转发语义不变）", async () => {
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const propsOnLoad = vi.fn();
    const { container } = render(() => (
      <PixivImage src={SRC} thumbSrc={THUMB} onLoad={propsOnLoad} />
    ));
    await flush();
    d.resolve({ url: `PROXY::${SRC}`, cleanup: () => {} });
    await flush();
    const mainImg = Array.from(container.querySelectorAll("img")).find(
      (el) => el.getAttribute("aria-hidden") !== "true",
    ) as HTMLImageElement;
    fireEvent.load(mainImg);
    await flush();
    expect(propsOnLoad).toHaveBeenCalledTimes(1);
    expect(propsOnLoad.mock.calls[0]?.[0]).toBeInstanceOf(Event);
  });

  it("thumb onError：卸载缩略层；双失败后渲染失败 UI", async () => {
    const d = createDeferred<LoadedImageLike>();
    vi.mocked(loadImage).mockReturnValue(d.promise);
    const { container } = render(() => <PixivImage src={SRC} thumbSrc={THUMB} />);
    await flush();

    const thumb = container.querySelector("img") as HTMLImageElement;
    fireEvent.error(thumb);
    await flush();
    // thumb 失败 → 缩略层卸载；full 仍未就绪 → 无 img
    expect(container.querySelectorAll("img").length).toBe(0);
    expect(container.textContent).not.toContain("加载失败");

    // full 也失败 → 双失败 → 失败 UI
    d.reject(new Error("network down"));
    await flush();
    expect(container.textContent).toContain("加载失败");
  });
});

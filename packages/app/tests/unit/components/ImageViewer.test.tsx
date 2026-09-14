// @vitest-environment happy-dom
/**
 * ImageViewer 邻页预取候选纯函数（#366 FT-4）。
 * oracle 溯源：预取语义 = 预取「当前页前后各一页」，跳过已发起/已加载页；
 * 边界 = 首页无前邻、末页无后邻、单页无候选（ ImageViewer 翻页边界一致）。
 * 保存按钮契约（spec image-save-download §5）：onSavePage 缺省不渲染；点击后
 * 成功 ✓ / 失败 ✗ 状态内联（oracle = spec 字面行为）。
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import ImageViewer, { neighborPages } from "@/components/ImageViewer";

vi.mock("@/utils/imageLoader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/imageLoader")>();
  return {
    ...actual,
    checkImageCache: vi.fn<() => string | undefined>(() => undefined),
    loadImage: vi.fn(() => Promise.resolve({ url: "", cleanup: () => {} })),
    loadImageWithProgress: vi.fn(() =>
      Promise.resolve({ url: "blob:mock", cleanup: () => {}, durationMs: 0 }),
    ),
  };
});

beforeEach(() => {
  cleanup();
});

describe("neighborPages 邻页预取候选", () => {
  const nothing = () => false;

  it("中间页：前后各一页", () => {
    expect(neighborPages(2, 5, nothing)).toEqual([1, 3]);
  });

  it("首页：仅后邻", () => {
    expect(neighborPages(0, 3, nothing)).toEqual([1]);
  });

  it("末页：仅前邻", () => {
    expect(neighborPages(2, 3, nothing)).toEqual([1]);
  });

  it("单页：无候选", () => {
    expect(neighborPages(0, 1, nothing)).toEqual([]);
  });

  it("已发起/已加载的页被跳过", () => {
    expect(neighborPages(2, 5, (i) => i === 1)).toEqual([3]);
    expect(neighborPages(2, 5, (i) => i === 1 || i === 3)).toEqual([]);
  });
});

describe("ImageViewer 保存当前页按钮（spec image-save-download §5）", () => {
  const URLS = ["https://i.pximg.net/p0.jpg", "https://i.pximg.net/p1.jpg"];

  it("onSavePage 缺省不渲染保存按钮；提供时渲染", () => {
    render(() => <ImageViewer imageUrls={URLS} />);
    expect(screen.queryByLabelText("保存当前页到相册")).toBeNull();
    cleanup();
    render(() => <ImageViewer imageUrls={URLS} onSavePage={() => Promise.resolve(true)} />);
    expect(screen.getByLabelText("保存当前页到相册")).toBeTruthy();
  });

  it("保存成功显示 ✓，失败显示 ✗", async () => {
    render(() => <ImageViewer imageUrls={URLS} onSavePage={() => Promise.resolve(true)} />);
    fireEvent.click(screen.getByLabelText("保存当前页到相册"));
    expect(await screen.findByText("✓")).toBeTruthy();

    cleanup();
    render(() => <ImageViewer imageUrls={URLS} onSavePage={() => Promise.resolve(false)} />);
    fireEvent.click(screen.getByLabelText("保存当前页到相册"));
    expect(await screen.findByText("✗")).toBeTruthy();
  });

  it("保存进行中按钮禁用", async () => {
    render(() => (
      <ImageViewer imageUrls={URLS} onSavePage={() => new Promise<boolean>(() => {})} />
    ));
    fireEvent.click(screen.getByLabelText("保存当前页到相册"));
    await Promise.resolve();
    expect((screen.getByLabelText("保存当前页到相册") as HTMLButtonElement).disabled).toBe(true);
  });

  it("saveBusy（批次并发）时按钮禁用但保持渲染——禁用而非隐藏，✓/✗ 反馈可达", async () => {
    render(() => (
      <ImageViewer imageUrls={URLS} onSavePage={() => Promise.resolve(true)} saveBusy />
    ));
    const btn = screen.getByLabelText("保存当前页到相册") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(true);
    // 禁用态点击不触发保存、也不进入 ✗ 假失败
    fireEvent.click(btn);
    await Promise.resolve();
    expect(screen.queryByText("✗")).toBeNull();
  });
});

// @vitest-environment happy-dom
/**
 * PagePickerSheet 选页面板（spec docs/specs/image-save-download.md §5/§6）。
 * oracle 溯源：交互契约 = 「打开默认全选（批量语义）；点选切换；全选/清除互斥；
 * 确认上排序页号数组」。PixivImage/loadImage 用 vi.mock 隔离网络与 L1 全局态
 * （对齐 IllustSingleCard.test.tsx 模式）。Solid 2.0 微任务批处理：点击后
 * await Promise.resolve() 再断言 DOM。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import PagePickerSheet from "@/components/illust/PagePickerSheet";

vi.mock("@/utils/imageLoader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/imageLoader")>();
  return {
    ...actual,
    checkImageCache: vi.fn<() => string | undefined>(() => undefined),
    loadImage: vi.fn(() => Promise.resolve({ url: "", cleanup: () => {} })),
  };
});

const PAGE_URLS = [
  "https://i.pximg.net/p0_m.jpg",
  "https://i.pximg.net/p1_m.jpg",
  "https://i.pximg.net/p2_m.jpg",
];

function renderPicker(overrides: Partial<Parameters<typeof PagePickerSheet>[0]> = {}) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const result = render(() => (
    <PagePickerSheet
      open
      pageUrls={PAGE_URLS}
      onClose={onClose}
      onConfirm={onConfirm}
      {...overrides}
    />
  ));
  return { onConfirm, onClose, ...result };
}

const flush = () => Promise.resolve();

beforeEach(() => {
  cleanup();
});

describe("PagePickerSheet 选页面板", () => {
  it("打开默认全选（批量语义默认值），确认回调升序页号", async () => {
    const { onConfirm } = renderPicker();
    expect(screen.getByText("已选 3 / 3 页")).toBeTruthy();
    fireEvent.click(screen.getByText(/^保存（3）$/));
    await flush();
    expect(onConfirm).toHaveBeenCalledWith([0, 1, 2]);
  });

  it("点选切换：取消第 2 页后确认 [0, 2]", async () => {
    const { onConfirm } = renderPicker();
    fireEvent.click(screen.getByLabelText(/第 2 页（已选）/));
    await flush();
    expect(screen.getByText("已选 2 / 3 页")).toBeTruthy();
    fireEvent.click(screen.getByText(/^保存（2）$/));
    await flush();
    expect(onConfirm).toHaveBeenCalledWith([0, 2]);
  });

  it("清除全选后计数为 0；再点全选恢复", async () => {
    renderPicker();
    fireEvent.click(screen.getByText("清除全选"));
    await flush();
    expect(screen.getByText("已选 0 / 3 页")).toBeTruthy();
    // 确认按钮禁用（自定义元素宿主以 attribute 承载 disabled）
    const confirmBtn = screen.getByText(/^保存（0）$/);
    expect(confirmBtn.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByText("全选"));
    await flush();
    expect(screen.getByText("已选 3 / 3 页")).toBeTruthy();
    expect(screen.getByText(/^保存（3）$/).hasAttribute("disabled")).toBe(false);
  });

  it("busy 时确认按钮禁用并显示保存中", () => {
    renderPicker({ busy: true });
    const confirmBtn = screen.getByText("保存中…");
    expect(confirmBtn.hasAttribute("disabled")).toBe(true);
  });
});

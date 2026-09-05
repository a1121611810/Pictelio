// @vitest-environment happy-dom
/**
 * IllustSingleCard — 插画单列大图卡契约测试（ticket #179，spec: docs/spec-home-c-shell-l5.md；
 * T1 渐进封面增补 spec: docs/specs/webview-perf-round2.md §2.2）。
 *
 * props 驱动纯渲染，不依赖 store。mock 真实字段结构的 PixivIllust（见 src/api/types.ts）；
 * 封面 URL 经真实纯函数 resolveImageUrl（@/utils/imageLoader）转换。
 * T1：封面为双层渐进 img（thumb=medium 底层先行，loadImage 预载 resolve 后主层切 large），
 * loadImage/checkImageCache 用 vi.mock 隔离网络与 L1 全局态，resolveImageUrl 保留真实实现。
 * 交互契约：click 与 Enter keydown 均触发 onClick。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { PixivIllust } from "@/api/types";
import { loadImage, resolveImageUrl } from "@/utils/imageLoader";
import IllustSingleCard from "@/components/home/IllustSingleCard";

vi.mock("@/utils/imageLoader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/imageLoader")>();
  return {
    ...actual,
    checkImageCache: vi.fn<() => string | undefined>(() => undefined),
    loadImage: vi.fn(() => Promise.resolve({ url: "", cleanup: () => {} })),
  };
});

function makeIllust(overrides: Partial<PixivIllust> = {}): PixivIllust {
  return {
    id: 202,
    title: "测试插画标题",
    type: "illust",
    user: { id: 100, name: "插画作者", account: "author", profile_image_urls: {} },
    image_urls: {
      square_medium:
        "https://i.pximg.net/c/250x250_80/img-master/img/2026/06/30/13/50/51/202_p0_square1200.jpg",
      medium:
        "https://i.pximg.net/c/540x540_70/img-master/img/2026/06/30/13/50/51/202_p0_master1200.jpg",
      large:
        "https://i.pximg.net/c/600x1200_90/img-master/img/2026/06/30/13/50/51/202_p0_master1200.jpg",
    },
    width: 1200,
    height: 800,
    page_count: 1,
    is_bookmarked: false,
    total_bookmarks: 5678,
    tags: [],
    x_restrict: 0,
    create_date: "2026-06-30T13:50:51+09:00",
    meta_pages: [],
    meta_single_page: {},
    ...overrides,
  };
}

describe("IllustSingleCard", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    // restoreMocks 重置 mock 实现后，恢复「预载立即成功」的默认态（checkImageCache 保持 miss）
    vi.mocked(loadImage).mockResolvedValue({ url: "", cleanup: () => {} });
  });

  it("渲染标题、作者名与 ★收藏数", () => {
    render(() => <IllustSingleCard illust={makeIllust()} onClick={vi.fn()} />);
    expect(screen.getByText("测试插画标题")).toBeTruthy();
    expect(screen.getByText("插画作者")).toBeTruthy();
    expect(screen.getByText("★5,678")).toBeTruthy();
  });

  it("封面双层：thumb(medium) 底层先行 aria-hidden，loadImage resolve 后主层切 large", async () => {
    const illust = makeIllust();
    const { container } = render(() => <IllustSingleCard illust={illust} onClick={vi.fn()} />);
    // 底层缩略图先行：thumb=medium，aria-hidden + pointer-events-none（不参与语义与交互）
    const thumb = container.querySelector('img[aria-hidden="true"]') as HTMLImageElement;
    expect(thumb).toBeTruthy();
    expect(thumb.getAttribute("src")).toBe(resolveImageUrl(illust.image_urls.medium));
    expect(thumb.getAttribute("aria-hidden")).toBe("true");
    expect(thumb.className).toContain("pointer-events-none");
    expect(thumb.className).toContain("absolute");
    // thumb 层与主层一致异步解码（Standards 硬约定：异步解码防阻塞主线程帧）
    expect(thumb.getAttribute("decoding")).toBe("async");
    // 主层：mock loadImage resolve 后挂载，src=large（主层 relative 叠于底层之上）
    const main = (await screen.findByAltText(illust.title)) as HTMLImageElement;
    expect(main.getAttribute("src")).toBe(resolveImageUrl(illust.image_urls.large));
    expect(main.className).toContain("relative");
  });

  it("fireEvent.click 触发 onClick", () => {
    const onClick = vi.fn();
    render(() => <IllustSingleCard illust={makeIllust()} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("Enter keydown 触发 onClick", () => {
    const onClick = vi.fn();
    render(() => <IllustSingleCard illust={makeIllust()} onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("封面按原图比例（aspect-ratio = width/height，非固定 16:10）", async () => {
    const illust = makeIllust({ width: 1200, height: 800 });
    render(() => <IllustSingleCard illust={illust} onClick={vi.fn()} />);
    const img = (await screen.findByAltText(illust.title)) as HTMLImageElement;
    const box = img.parentElement as HTMLElement;
    expect(box.style.aspectRatio).toBe("1200 / 800");
  });

  it("宽高异常时回退 16:10", async () => {
    const illust = makeIllust({ width: 0, height: 0 });
    render(() => <IllustSingleCard illust={illust} onClick={vi.fn()} />);
    const img = (await screen.findByAltText(illust.title)) as HTMLImageElement;
    const box = img.parentElement as HTMLElement;
    expect(box.style.aspectRatio).toBe("16 / 10");
  });
});

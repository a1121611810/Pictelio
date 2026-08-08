// @vitest-environment happy-dom
/**
 * IllustSingleCard — 插画单列大图卡契约测试（ticket #179，spec: docs/spec-home-c-shell-l5.md）。
 *
 * props 驱动纯渲染，不依赖 store。mock 真实字段结构的 PixivIllust（见 src/api/types.ts）；
 * 封面 URL 经真实纯函数 resolveImageUrl（@/utils/imageLoader）转换。
 * 交互契约：click 与 Enter keydown 均触发 onClick。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { PixivIllust } from "@/api/types";
import { resolveImageUrl } from "@/utils/imageLoader";
import IllustSingleCard from "@/components/home/IllustSingleCard";

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

  it("渲染标题、作者名与 ★收藏数", () => {
    render(() => <IllustSingleCard illust={makeIllust()} onClick={vi.fn()} />);
    expect(screen.getByText("测试插画标题")).toBeTruthy();
    expect(screen.getByText("插画作者")).toBeTruthy();
    expect(screen.getByText("★5,678")).toBeTruthy();
  });

  it("封面 img src 为 resolveImageUrl(大图) 的结果", () => {
    const illust = makeIllust();
    render(() => <IllustSingleCard illust={illust} onClick={vi.fn()} />);
    const img = screen.getByAltText(illust.title) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(resolveImageUrl(illust.image_urls.large));
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
});

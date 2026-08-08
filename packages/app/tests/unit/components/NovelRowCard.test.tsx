// @vitest-environment happy-dom
/**
 * NovelRowCard — 小说单列行卡契约测试（ticket #179，spec: docs/spec-home-c-shell-l5.md）。
 *
 * props 驱动纯渲染，不依赖 store。mock 真实字段结构的 PixivNovel（见 src/api/types.ts）；
 * 封面 URL 经真实纯函数 resolveImageUrl（@/utils/imageLoader）转换。
 * 交互契约：click 与 Enter keydown 均触发 onClick。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { PixivNovel } from "@/api/types";
import { resolveImageUrl } from "@/utils/imageLoader";
import NovelRowCard from "@/components/home/NovelRowCard";

function makeNovel(overrides: Partial<PixivNovel> = {}): PixivNovel {
  return {
    id: 101,
    title: "测试小说标题",
    user: { id: 100, name: "作者名", account: "author", profile_image_urls: {} },
    image_urls: {
      square_medium:
        "https://i.pximg.net/c/250x250_80/img-master/img/2026/06/30/13/50/51/101_p0_square1200.jpg",
      medium:
        "https://i.pximg.net/c/540x540_70/img-master/img/2026/06/30/13/50/51/101_p0_master1200.jpg",
      large:
        "https://i.pximg.net/c/600x1200_90/img-master/img/2026/06/30/13/50/51/101_p0_master1200.jpg",
    },
    tags: [],
    page_count: 1,
    text_length: 3200,
    is_bookmarked: false,
    total_bookmarks: 1234,
    x_restrict: 0,
    create_date: "2026-06-30T13:50:51+09:00",
    ...overrides,
  };
}

describe("NovelRowCard", () => {
  afterEach(() => cleanup());

  it("渲染标题、作者名与 ★收藏·字数统计", () => {
    render(() => <NovelRowCard novel={makeNovel()} onClick={vi.fn()} />);
    expect(screen.getByText("测试小说标题")).toBeTruthy();
    expect(screen.getByText("作者名")).toBeTruthy();
    // toLocaleString(1234)="1,234"，text_length 3200 → 3.2k 字
    expect(screen.getByText("★1,234 · 3.2k 字")).toBeTruthy();
  });

  it("封面 img src 为 resolveImageUrl(大图) 的结果", () => {
    const novel = makeNovel();
    render(() => <NovelRowCard novel={novel} onClick={vi.fn()} />);
    const img = screen.getByAltText(novel.title) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(resolveImageUrl(novel.image_urls.large));
    // 大图优先于 medium / square_medium 回退
    expect(img.getAttribute("src")).not.toBe(resolveImageUrl(novel.image_urls.medium));
  });

  it("有 series 时显示「系列」徽标，无 series 时不显示", () => {
    render(() => (
      <NovelRowCard novel={makeNovel({ series: { id: 7, title: "测试系列" } })} onClick={vi.fn()} />
    ));
    expect(screen.getByText("系列")).toBeTruthy();
  });

  it("无 series 时不渲染「系列」徽标", () => {
    render(() => <NovelRowCard novel={makeNovel()} onClick={vi.fn()} />);
    expect(screen.queryByText("系列")).toBeNull();
  });

  it("fireEvent.click 触发 onClick", () => {
    const onClick = vi.fn();
    render(() => <NovelRowCard novel={makeNovel()} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("Enter keydown 触发 onClick", () => {
    const onClick = vi.fn();
    render(() => <NovelRowCard novel={makeNovel()} onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

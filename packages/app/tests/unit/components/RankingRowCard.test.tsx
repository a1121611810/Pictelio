// @vitest-environment happy-dom
/**
 * RankingRowCard — 榜单行卡契约测试（spec docs/specs/ranking.md §5.3）。
 *
 * props 驱动纯渲染，不依赖 store。fixture 用真实 PixivIllust 字段结构（src/api/types.ts）；
 * 封面 URL 经真实纯函数 resolveImageUrl 转换。交互契约：click 与 Enter keydown 均触发 onClick。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { PixivIllust } from "@/api/types";
import { resolveImageUrl } from "@/utils/imageLoader";
import RankingRowCard from "@/components/ranking/RankingRowCard";

function makeIllust(overrides: Partial<PixivIllust> = {}): PixivIllust {
  return {
    id: 101,
    title: "测试作品标题",
    type: "illust",
    user: { id: 100, name: "作者名", account: "author", profile_image_urls: {} },
    image_urls: {
      square_medium:
        "https://i.pximg.net/c/250x250_80/img-master/img/2026/06/30/13/50/51/101_p0_square1200.jpg",
      medium:
        "https://i.pximg.net/c/540x540_70/img-master/img/2026/06/30/13/50/51/101_p0_master1200.jpg",
      large:
        "https://i.pximg.net/c/600x1200_90/img-master/img/2026/06/30/13/50/51/101_p0_master1200.jpg",
    },
    width: 600,
    height: 1200,
    page_count: 1,
    is_bookmarked: false,
    total_bookmarks: 1234,
    tags: [],
    x_restrict: 0,
    create_date: "2026-06-30T13:50:51+09:00",
    meta_pages: [],
    meta_single_page: {},
    ...overrides,
  } as PixivIllust;
}

describe("RankingRowCard", () => {
  afterEach(() => cleanup());

  it("渲染名次、标题、作者与 ★收藏数", () => {
    render(() => <RankingRowCard rank={7} illust={makeIllust()} onClick={vi.fn()} />);
    expect(screen.getByTestId("ranking-rank").textContent).toBe("7");
    expect(screen.getByText("测试作品标题")).toBeTruthy();
    expect(screen.getByText("作者名")).toBeTruthy();
    // toLocaleString(1234)="1,234"
    expect(screen.getByText("★1,234")).toBeTruthy();
  });

  it("封面 img src 为 resolveImageUrl(square_medium)，经项目代理路径", () => {
    const illust = makeIllust();
    render(() => <RankingRowCard rank={1} illust={illust} onClick={vi.fn()} />);
    const img = document.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(resolveImageUrl(illust.image_urls.square_medium));
    // 独立断言：必须走项目图片代理路径，不得直连 CDN（spec §6.2）
    expect(img.getAttribute("src")).toContain("/pixiv-img/");
    expect(img.getAttribute("src")).not.toBe(illust.image_urls.square_medium);
  });

  it("square_medium 为空串时回退 large（降档不丢 fallback 链）", () => {
    const illust = makeIllust({
      image_urls: {
        square_medium: "",
        medium: "https://i.pximg.net/medium.jpg",
        large: "https://i.pximg.net/large.jpg",
      } as PixivIllust["image_urls"],
    });
    render(() => <RankingRowCard rank={2} illust={illust} onClick={vi.fn()} />);
    const img = document.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(resolveImageUrl("https://i.pximg.net/large.jpg"));
  });

  it("aria-label 含名次与标题（读屏可读）", () => {
    render(() => <RankingRowCard rank={3} illust={makeIllust()} onClick={vi.fn()} />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe("第3名：测试作品标题");
  });

  it("fireEvent.click 与 Enter keydown 均触发 onClick", () => {
    const onClick = vi.fn();
    render(() => <RankingRowCard rank={1} illust={makeIllust()} onClick={onClick} />);
    const row = screen.getByRole("button");
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});

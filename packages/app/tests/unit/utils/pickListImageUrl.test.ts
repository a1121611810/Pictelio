/**
 * pickListImageUrl 纯函数单测（spec: docs/specs/webview-perf-round2.md §2 第 5 条）。
 *
 * oracle 溯源：
 * - 期望值为独立构造的真实 Pixiv CDN URL fixture（URL 形态与 IllustSingleCard.test.tsx
 *   既有 fixture 同源），非从被测实现推导；
 * - 档位语义依据 spec §2「档位事实」：medium=c/540x540_70/…_master1200、
 *   large=c/600x1200_90/…_master1200、square_medium=c/250x250_80/…_square1200（方裁切）；
 * - original 档无原图字段时回退 large（ugoira 元数据无 meta_single_page.original_image_url 的真实形态）。
 * 语义基线：与重构前 ImageCard/GridCard 私有 resolveUrl 逐字等价（语义等价重构）。
 */
import { describe, expect, it, vi } from "vitest";
import { pickListImageUrl } from "@/utils/imageLoader";
import type { PixivIllust } from "@/api/types";

// 隔离被测纯函数不涉及的 IO 依赖（与 imageLoader.test.ts 同模式，避免 settings/localStorage 链路进 node）
vi.mock("@/stores/imageHostStore", () => ({
  isImageHostEnabled: () => false,
}));
vi.mock("@/services/imageHostService", () => ({
  getEffectiveImageUrl: (url: string) => url,
  getRaceCandidateUrls: () => [],
}));

const FIXTURE = {
  square_medium:
    "https://i.pximg.net/c/250x250_80/img-master/img/2026/06/30/13/50/51/202_p0_square1200.jpg",
  medium:
    "https://i.pximg.net/c/540x540_70/img-master/img/2026/06/30/13/50/51/202_p0_master1200.jpg",
  large:
    "https://i.pximg.net/c/600x1200_90/img-master/img/2026/06/30/13/50/51/202_p0_master1200.jpg",
  original: "https://i.pximg.net/img-original/img/2026/06/30/13/50/51/202_p0.jpg",
};

/** 构造仅含 pickListImageUrl 所需字段的最小 illust（字段类型对齐 PixivIllust） */
function makeIllust(
  imageUrls: Partial<PixivIllust["image_urls"]>,
  metaSinglePage: PixivIllust["meta_single_page"] = {},
): Pick<PixivIllust, "image_urls" | "meta_single_page"> {
  return {
    image_urls: {
      square_medium: "",
      medium: "",
      large: "",
      ...imageUrls,
    },
    meta_single_page: metaSinglePage,
  };
}

describe("pickListImageUrl — 三档 quality", () => {
  it("quality=medium → medium 档 URL", () => {
    const illust = makeIllust(FIXTURE);
    expect(pickListImageUrl(illust, "medium")).toBe(FIXTURE.medium);
  });

  it("quality=large → large 档 URL", () => {
    const illust = makeIllust(FIXTURE);
    expect(pickListImageUrl(illust, "large")).toBe(FIXTURE.large);
  });

  it("quality=original → meta_single_page.original_image_url", () => {
    const illust = makeIllust(FIXTURE, { original_image_url: FIXTURE.original });
    expect(pickListImageUrl(illust, "original")).toBe(FIXTURE.original);
  });
});

describe("pickListImageUrl — original 档回退（ugoira fallback）", () => {
  it("meta_single_page 为空对象（ugoira 真实形态，无原图字段）→ 回退 large", () => {
    const illust = makeIllust(FIXTURE, {});
    expect(pickListImageUrl(illust, "original")).toBe(FIXTURE.large);
  });

  it("original_image_url 显式为 undefined → 回退 large", () => {
    const illust = makeIllust(FIXTURE, { original_image_url: undefined });
    expect(pickListImageUrl(illust, "original")).toBe(FIXTURE.large);
  });
});

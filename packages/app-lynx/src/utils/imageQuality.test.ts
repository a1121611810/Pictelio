// resolveQualityUrl 单测：详情页画质三档位映射 + fallback 链（issue #146 T1）
// resolvePageSrcs 单测（spec: app-lynx-detail-multi-image-list §2.4/§5 / ADR-0129）：
// 多图列表逐页 URL 解析——oracle = resolveQualityUrl（档位映射）+ proxyImageUrl（代理改写）各自既有语义，
// 本函数只锁「逐页 apply + 单页 original 兜底参数传递」的组合行为。
import { describe, expect, it } from "vitest"
import { resolveQualityUrl, resolvePageSrcs } from "./imageQuality"
import type { ImageQuality } from "./imageQuality"

const FULL = { medium: "m.jpg", large: "l.jpg", original: "o.jpg" }

describe("resolveQualityUrl", () => {
  it("medium → urls.medium", () => {
    expect(resolveQualityUrl(FULL, "medium")).toBe("m.jpg")
  })

  it("large → urls.large", () => {
    expect(resolveQualityUrl(FULL, "large")).toBe("l.jpg")
  })

  it("original 优先 originalImageUrl", () => {
    expect(resolveQualityUrl(FULL, "original", "orig-real.jpg")).toBe("orig-real.jpg")
  })

  it("original 无 originalImageUrl → urls.original", () => {
    expect(resolveQualityUrl(FULL, "original")).toBe("o.jpg")
  })

  it("original 无 originalImageUrl 且缺 urls.original → urls.large", () => {
    const urls = { medium: "m.jpg", large: "l.jpg" }
    expect(resolveQualityUrl(urls, "original")).toBe("l.jpg")
  })

  it("original 只剩 urls.medium → urls.medium", () => {
    expect(resolveQualityUrl({ medium: "m.jpg" }, "original")).toBe("m.jpg")
  })

  it("medium 缺档降 urls.large", () => {
    const urls = { large: "l.jpg" }
    expect(resolveQualityUrl(urls, "medium")).toBe("l.jpg")
  })

  it("large 缺档降 urls.medium", () => {
    const urls = { medium: "m.jpg" }
    expect(resolveQualityUrl(urls, "large")).toBe("m.jpg")
  })

  it("空 urls 对象 → 空串", () => {
    expect(resolveQualityUrl({}, "medium")).toBe("")
    expect(resolveQualityUrl({}, "large")).toBe("")
    expect(resolveQualityUrl({}, "original")).toBe("")
  })

  it("可选字段显式 undefined 与缺档等价", () => {
    const urls = { medium: "m.jpg", large: undefined, original: undefined }
    expect(resolveQualityUrl(urls, "original")).toBe("m.jpg")
  })

  it("全缺（仅 undefined 字段）→ 空串", () => {
    const urls = { medium: undefined, large: undefined, original: undefined }
    expect(resolveQualityUrl(urls, "original")).toBe("")
  })

  it("三档位类型约束：字面量可赋值给 ImageQuality", () => {
    const qs: ImageQuality[] = ["medium", "large", "original"]
    for (const q of qs) {
      expect(typeof resolveQualityUrl(FULL, q)).toBe("string")
    }
  })
})

describe("resolvePageSrcs（多图列表逐页 URL 解析，ADR-0129）", () => {
  // proxyImageUrl 语义（imageUrl.ts）：i.pximg.net URL → /pixiv-img/ 前缀（非本函数职责，只锁组合）
  // oracle：真实 Pixiv CDN URL 形态（i.pximg.net/img-original/...），非自洽 mock

  it("逐页解析：每页按档位取 URL + 代理改写，输出数组长度 = 页数", () => {
    // mock 为真实 Pixiv CDN 形态：medium=/c/540x_70/img-master/…_master1200.jpg、large=同档、original=img-original
    const pages = [
      { medium: "https://i.pximg.net/c/540x_70/img-master/img/2024/01/01/00/00/00/100_p0_master1200.jpg", large: "https://i.pximg.net/c/540x_70/img-master/img/2024/01/01/00/00/00/100_p0_master1200.jpg", original: "https://i.pximg.net/img-original/img/2024/01/01/00/00/00/100_p0.jpg" },
      { medium: "https://i.pximg.net/c/540x_70/img-master/img/2024/01/01/00/00/00/100_p1_master1200.jpg", large: "https://i.pximg.net/c/540x_70/img-master/img/2024/01/01/00/00/00/100_p1_master1200.jpg", original: "https://i.pximg.net/img-original/img/2024/01/01/00/00/00/100_p1.jpg" },
    ]
    const srcs = resolvePageSrcs(pages, "large")
    expect(srcs).toHaveLength(2)
    expect(srcs[0]).toBe("/pixiv-img/c/540x_70/img-master/img/2024/01/01/00/00/00/100_p0_master1200.jpg")
    expect(srcs[1]).toBe("/pixiv-img/c/540x_70/img-master/img/2024/01/01/00/00/00/100_p1_master1200.jpg")
  })

  it("original 档：优先各页 urls.original（singleOriginalUrl 仅单页场景有值，多页作品 meta_single_page 为 null）", () => {
    const pages = [
      { medium: "https://i.pximg.net/c/540x_70/img-master/img/2024/01/01/00/00/00/100_p0_master1200.jpg", large: "https://i.pximg.net/c/540x_70/img-master/img/2024/01/01/00/00/00/100_p0_master1200.jpg", original: "https://i.pximg.net/img-original/img/2024/01/01/00/00/00/100_p0.jpg" },
    ]
    expect(resolvePageSrcs(pages, "original")).toEqual([
      "/pixiv-img/img-original/img/2024/01/01/00/00/00/100_p0.jpg",
    ])
  })

  it("单页场景：原图档缺 urls.original 时用 meta_single_page.original_image_url 兜底（issue #148 T2 语义）", () => {
    const pages = [
      { medium: "https://i.pximg.net/c/540x_70/img-master/img/2024/01/01/00/00/00/200_p0_master1200.jpg", large: "https://i.pximg.net/c/540x_70/img-master/img/2024/01/01/00/00/00/200_p0_master1200.jpg" },
    ]
    expect(
      resolvePageSrcs(pages, "original", "https://i.pximg.net/img-original/img/2024/01/01/00/00/00/200_orig.jpg"),
    ).toEqual(["/pixiv-img/img-original/img/2024/01/01/00/00/00/200_orig.jpg"])
  })

  it("空页数组 → 空数组", () => {
    expect(resolvePageSrcs([], "medium")).toEqual([])
  })
})

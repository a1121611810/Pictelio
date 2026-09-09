// galleryDownload 保存编排单测（spec docs/specs/image-save-download.md §4/§6）。
// 与 app 包 tests/unit/utils/galleryDownload.test.ts 同源同规格（双端差分对齐）：
// oracle = spec §3 D3 文件名字面规则 + 原 IllustDetail originalImageUrls 语义
// （多页 meta_pages original ?? large / 单页 meta_single_page ?? large，真实响应字段结构）。
import { describe, expect, it, vi } from "vitest"
import { buildSaveFileName, extForUrl, originalPageUrls, saveIllustPages } from "./galleryDownload"
import type { PixivIllust } from "../api/types"

/** 真实响应字段结构样例（meta_pages.original / meta_single_page.original_image_url） */
function makeIllust(overrides: Partial<PixivIllust> = {}): PixivIllust {
  return {
    id: 123456,
    title: "多页作品",
    type: "illust",
    user: { id: 1, name: "a", account: "a", profile_image_urls: {} },
    image_urls: {
      square_medium: "https://i.pximg.net/c/250x250/sq.jpg",
      medium: "https://i.pximg.net/c/540x540/m.jpg",
      large: "https://i.pximg.net/img-master/l.jpg",
    },
    width: 1000,
    height: 1400,
    page_count: 2,
    is_bookmarked: false,
    total_bookmarks: 1,
    tags: [],
    x_restrict: 0,
    create_date: "2026-01-01T00:00:00+09:00",
    caption: "",
    meta_pages: [
      {
        image_urls: {
          square_medium: "https://i.pximg.net/p0_sq.jpg",
          medium: "https://i.pximg.net/p0_m.jpg",
          large: "https://i.pximg.net/p0_l.jpg",
          original: "https://i.pximg.net/img-original/123456_p0.png",
        },
      },
      {
        image_urls: {
          square_medium: "https://i.pximg.net/p1_sq.jpg",
          medium: "https://i.pximg.net/p1_m.jpg",
          large: "https://i.pximg.net/p1_l.jpg",
          original: "https://i.pximg.net/img-original/123456_p1.jpg",
        },
      },
    ],
    meta_single_page: {},
    ...overrides,
  }
}

describe("extForUrl", () => {
  it("URL 尾段白名单扩展名；query 剥离；未知回落 jpg", () => {
    expect(extForUrl("https://i.pximg.net/img-original/1_p0.jpg")).toBe("jpg")
    expect(extForUrl("https://i.pximg.net/img-original/1_p0.PNG")).toBe("png")
    expect(extForUrl("https://i.pximg.net/a.png?token=x")).toBe("png")
    expect(extForUrl("https://i.pximg.net/noext")).toBe("jpg")
    expect(extForUrl("https://i.pximg.net/a.b.com/dir")).toBe("jpg")
  })
})

describe("buildSaveFileName（spec §3 D3）", () => {
  it("单页无页号后缀；多页 0-based p<N>（对齐 Pixiv _p0 命名）", () => {
    expect(buildSaveFileName(123456, undefined, "https://i.pximg.net/o.png")).toBe("Pictelio_123456.png")
    expect(buildSaveFileName(123456, 0, "https://i.pximg.net/img-original/123456_p0.jpg")).toBe(
      "Pictelio_123456_p0.jpg",
    )
    expect(buildSaveFileName(123456, 11, "https://i.pximg.net/img-original/123456_p11.jpg")).toBe(
      "Pictelio_123456_p11.jpg",
    )
  })
})

describe("originalPageUrls", () => {
  it("多页：逐页 original ?? large；缺 original 回退 large", () => {
    const urls = originalPageUrls(makeIllust())
    expect(urls).toEqual([
      "https://i.pximg.net/img-original/123456_p0.png",
      "https://i.pximg.net/img-original/123456_p1.jpg",
    ])
    const illust = makeIllust()
    delete (illust.meta_pages[0].image_urls as { original?: string }).original
    expect(originalPageUrls(illust)[0]).toBe("https://i.pximg.net/p0_l.jpg")
  })

  it("单页：meta_single_page.original_image_url ?? large", () => {
    expect(
      originalPageUrls(
        makeIllust({
          page_count: 1,
          meta_pages: [],
          meta_single_page: { original_image_url: "https://i.pximg.net/img-original/single.jpg" },
        }),
      ),
    ).toEqual(["https://i.pximg.net/img-original/single.jpg"])
    expect(originalPageUrls(makeIllust({ page_count: 1, meta_pages: [], meta_single_page: {} }))).toEqual([
      "https://i.pximg.net/img-master/l.jpg",
    ])
  })
})

describe("saveIllustPages 编排器（spec §4）", () => {
  it("顺序逐张保存，文件名单页/多页形态正确；进度逐张回调", async () => {
    const saveOne = vi.fn().mockResolvedValue(undefined)
    const onProgress = vi.fn()
    const outcome = await saveIllustPages({
      pages: [1, 0],
      illustId: 123456,
      urlForPage: (p) => originalPageUrls(makeIllust())[p],
      saveOne,
      onProgress,
    })
    expect(saveOne.mock.calls.map((c) => c[1])).toEqual(["Pictelio_123456_p1.jpg", "Pictelio_123456_p0.png"])
    expect(outcome).toEqual({ saved: 2, failures: [] })
    expect(onProgress.mock.calls).toEqual([
      [1, 2, 1],
      [2, 2, 0],
    ])
  })

  it("单张失败不中断批次；失败计入 failures 且 console.warn 可见", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const saveOne = vi.fn().mockImplementation((url: string) =>
      url.includes("_p0") ? Promise.reject(new Error("HTTP 404")) : Promise.resolve(),
    )
    const outcome = await saveIllustPages({
      pages: [0, 1],
      illustId: 123456,
      urlForPage: (p) => originalPageUrls(makeIllust())[p],
      saveOne,
    })
    expect(saveOne).toHaveBeenCalledTimes(2)
    expect(outcome.saved).toBe(1)
    expect(outcome.failures).toEqual([{ page: 0, message: "HTTP 404" }])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("无可用 URL 的页计入失败（不静默跳过）；空选 no-op", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const saveOne = vi.fn().mockResolvedValue(undefined)
    const outcome = await saveIllustPages({
      pages: [5],
      illustId: 123456,
      urlForPage: () => undefined,
      saveOne,
    })
    expect(saveOne).not.toHaveBeenCalled()
    expect(outcome.failures).toEqual([{ page: 5, message: "无可用原图 URL" }])
    expect(await saveIllustPages({ pages: [], illustId: 1, urlForPage: () => "", saveOne })).toEqual({
      saved: 0,
      failures: [],
    })
    warn.mockRestore()
  })
})

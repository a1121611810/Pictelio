// galleryDownload 保存编排单测（spec docs/specs/image-save-download.md §4/§6）。
// 与 app 包 tests/unit/utils/galleryDownload.test.ts 同源同规格（双端差分对齐）：
// oracle = spec §3 D3 文件名字面规则 + 原 IllustDetail originalImageUrls 语义
// （多页 meta_pages original ?? large / 单页 meta_single_page ?? large，真实响应字段结构）。
import { describe, expect, it, vi } from "vitest"
import {
  buildAuthorDirSegment,
  buildSaveFileName,
  buildSaveFileNameFromTemplate,
  DEFAULT_DOWNLOAD_TEMPLATE,
  DOWNLOAD_FILENAME_MAX_LENGTH,
  DOWNLOAD_SEGMENT_MAX_LENGTH,
  DOWNLOAD_TEMPLATE_MAX_LENGTH,
  extForUrl,
  normalizeDownloadTemplate,
  originalPageUrls,
  sanitizeLimitedSegment,
  sanitizeNameSegment,
  saveIllustPages,
} from "./galleryDownload"
import { toIllustId, toUserId } from "../api/id"
import type { PixivIllust } from "../api/types"

/** 真实响应字段结构样例（meta_pages.original / meta_single_page.original_image_url） */
function makeIllust(overrides: Partial<PixivIllust> = {}): PixivIllust {
  return {
    id: toIllustId(123456),
    title: "多页作品",
    type: "illust",
    user: { id: toUserId(1), name: "a", account: "a", profile_image_urls: {} },
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

  it("naming.template 端到端：单存链与队列链共用同一命名纯函数；缺省与默认逐字节一致", async () => {
    const saveOne = vi.fn().mockResolvedValue(undefined)
    const url = "https://i.pximg.net/img-original/single.jpg"
    // 自定义模板：展开净化后的占位符（{p} 单页剥离连接符残段）
    await saveIllustPages({
      pages: [0],
      illustId: 123456,
      urlForPage: () => url,
      saveOne,
      naming: { template: "{id}_p{p}" },
    })
    expect(saveOne.mock.calls[0]?.[1]).toBe("123456.jpg")
    // 多页：模板不含 {p} 自动追加 _p<页号>（与默认后缀同形）
    await saveIllustPages({
      pages: [0],
      illustId: 123456,
      urlForPage: () => url,
      saveOne,
      naming: { template: "X_{id}" },
    })
    expect(saveOne.mock.calls[1]?.[1]).toBe("X_123456.jpg")
    // 缺省 naming/template → buildSaveFileName 硬编码默认路径，字节不变
    await saveIllustPages({ pages: [0], illustId: 123456, urlForPage: () => url, saveOne })
    expect(saveOne.mock.calls[2]?.[1]).toBe("Pictelio_123456.jpg")
  })
})

// ─── 下载命名模板矩阵（ADR-0192 / spec docs/specs/lynx-download-naming.md Testing T1–T12）───
// oracle：① 默认模板基线 = 既有 buildSaveFileName 输出（逐字节，零默认行为变化硬验收）；
// ② 净化规则 = Java GallerySaver.sanitizeFileName（[/\\] 与 \x00-\x1f → _，trim，
//    逐字镜像用例见 GallerySaverTest.sanitizeFileName_stripsSeparatorsAndControlChars）；
// ③ 目录基座 = GallerySaver 既有常量（Pictures/Pictelio，Java 侧契约测试钉住）。
// ctx 一律从 makeIllust 真实响应形状构造（测试硬约束 #2，禁手写自洽字段）。

/** 从真实 illust 形状构造命名上下文 */
function namingCtx(illust: PixivIllust, page: number) {
  return { id: illust.id, title: illust.title, author: illust.user.name, page, pageCount: illust.page_count }
}

/** 矩阵共用样例（真实响应字段形状；标题/作者带非 ASCII 以贴近真实数据） */
const sampleIllust = makeIllust({
  title: "夕暮れの庭",
  user: { id: toUserId(1), name: "画师名", account: "a", profile_image_urls: {} },
})
/** 单页变体（占位符展开隔离用例：排除多页 _p<N> 追加路径） */
const sampleSingle = makeIllust({
  page_count: 1,
  title: "夕暮れの庭",
  user: { id: toUserId(1), name: "画师名", account: "a", profile_image_urls: {} },
  meta_pages: [],
  meta_single_page: { original_image_url: "https://i.pximg.net/img-original/single.jpg" },
})
const sampleJpgUrl = "https://i.pximg.net/img-original/123456_p0.jpg"

describe("命名模板：默认模板逐字节等于现状（spec T1/T2，零默认行为变化）", () => {
  it("默认模板单页 → Pictelio_<id>.<ext>，与既有 buildSaveFileName 逐字节一致", () => {
    const illust = makeIllust({
      page_count: 1,
      meta_pages: [],
      meta_single_page: { original_image_url: "https://i.pximg.net/img-original/single.jpg" },
    })
    const url = "https://i.pximg.net/img-original/single.jpg"
    expect(buildSaveFileNameFromTemplate(DEFAULT_DOWNLOAD_TEMPLATE, namingCtx(illust, 0), url)).toBe(
      buildSaveFileName(illust.id, undefined, url),
    )
    expect(buildSaveFileNameFromTemplate(DEFAULT_DOWNLOAD_TEMPLATE, namingCtx(illust, 0), url)).toBe(
      "Pictelio_123456.jpg",
    )
  })

  it("默认模板多页 → Pictelio_<id>_p0/_p1.<ext>（0-based，逐字节一致）", () => {
    const illust = makeIllust()
    const urls = originalPageUrls(illust)
    for (let page = 0; page < 2; page++) {
      const url = urls[page]!
      expect(buildSaveFileNameFromTemplate(DEFAULT_DOWNLOAD_TEMPLATE, namingCtx(illust, page), url)).toBe(
        buildSaveFileName(illust.id, page, url),
      )
      expect(buildSaveFileNameFromTemplate(DEFAULT_DOWNLOAD_TEMPLATE, namingCtx(illust, page), url)).toBe(
        `Pictelio_123456_p${page}.${extForUrl(url)}`,
      )
    }
  })

  it("buildSaveFileName 委托默认模板展开（重构不改变既有字面输出）", () => {
    expect(buildSaveFileName(123456, undefined, "https://i.pximg.net/o.png")).toBe("Pictelio_123456.png")
    expect(buildSaveFileName(123456, 0, "https://i.pximg.net/img-original/123456_p0.jpg")).toBe(
      "Pictelio_123456_p0.jpg",
    )
  })
})

describe("命名模板：占位符展开（spec T3/T4/T5/T6）", () => {
  const illust = sampleIllust
  const jpgUrl = sampleJpgUrl

  it("T3 {id}/{title}/{author} 单独与组合展开（单页样例，排除多页后缀干扰）", () => {
    const ctx = namingCtx(sampleSingle, 0)
    expect(buildSaveFileNameFromTemplate("{id}", ctx, "https://i.pximg.net/img-original/single.jpg")).toBe("123456.jpg")
    expect(buildSaveFileNameFromTemplate("{title}", ctx, "https://i.pximg.net/img-original/single.jpg")).toBe("夕暮れの庭.jpg")
    expect(buildSaveFileNameFromTemplate("{author}", ctx, "https://i.pximg.net/img-original/single.jpg")).toBe("画师名.jpg")
    expect(buildSaveFileNameFromTemplate("{author}_{title}_{id}", ctx, "https://i.pximg.net/img-original/single.jpg")).toBe(
      "画师名_夕暮れの庭_123456.jpg",
    )
  })

  it("T4 含 {p} 模板多页就地展开（0-based），不再二次追加后缀", () => {
    expect(buildSaveFileNameFromTemplate("{id}_p{p}", namingCtx(illust, 0), jpgUrl)).toBe("123456_p0.jpg")
    expect(buildSaveFileNameFromTemplate("{id}_p{p}", namingCtx(illust, 2), jpgUrl)).toBe("123456_p2.jpg")
    expect(buildSaveFileNameFromTemplate("{id}_{p}", namingCtx(illust, 1), jpgUrl)).toBe("123456_1.jpg")
  })

  it("T5 含 {p} 模板单页 → 空串展开 + 尾随连接符剥离", () => {
    const single = makeIllust({
      page_count: 1,
      meta_pages: [],
      meta_single_page: { original_image_url: "https://i.pximg.net/s.jpg" },
    })
    const ctx = namingCtx(single, 0)
    expect(buildSaveFileNameFromTemplate("{id}_{p}", ctx, "https://i.pximg.net/s.jpg")).toBe("123456.jpg")
    // 推荐写法 {id}_p{p}：单页剥离 `_p` 残段
    expect(buildSaveFileNameFromTemplate("{id}_p{p}", ctx, "https://i.pximg.net/s.jpg")).toBe("123456.jpg")
    expect(buildSaveFileNameFromTemplate("{id}-{p}", ctx, "https://i.pximg.net/s.jpg")).toBe("123456.jpg")
    // 残段剥离发生在模板层，不误伤以 p 结尾的标题值
    const pTitle = makeIllust({
      page_count: 1,
      title: "sleep",
      meta_pages: [],
      meta_single_page: { original_image_url: "https://i.pximg.net/s.jpg" },
    })
    expect(buildSaveFileNameFromTemplate("{title}_p{p}", namingCtx(pTitle, 0), "https://i.pximg.net/s.jpg")).toBe(
      "sleep.jpg",
    )
  })

  it("T6 不含 {p} 模板多页 → 自动追加 _p<页号>（超长截断后保留页号段）", () => {
    expect(buildSaveFileNameFromTemplate("{author}_{title}", namingCtx(illust, 0), jpgUrl)).toBe(
      "画师名_夕暮れの庭_p0.jpg",
    )
    expect(buildSaveFileNameFromTemplate("{author}_{title}", namingCtx(illust, 11), jpgUrl)).toBe(
      "画师名_夕暮れの庭_p11.jpg",
    )
    const longTitle = makeIllust({ title: "超".repeat(200) })
    const name = buildSaveFileNameFromTemplate("{title}", namingCtx(longTitle, 7), jpgUrl)
    // 单段 64 截断后追加页号段：截断不吞 `_p<N>`，逐页文件名不碰撞
    expect(name).toBe("超".repeat(DOWNLOAD_SEGMENT_MAX_LENGTH) + "_p7.jpg")
  })
})

describe("命名模板：未知占位符 warn 恰一次（spec T7，测试硬约束 #3）", () => {
  it("未知占位符原样保留；同串重复名不重复告警；不同名再告警", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const ctx = namingCtx(sampleSingle, 0)
    const singleUrl = "https://i.pximg.net/img-original/single.jpg"
    const seen = new Set<string>()
    expect(buildSaveFileNameFromTemplate("{id}_{date}", ctx, singleUrl, seen)).toBe(
      "123456_{date}.jpg",
    )
    // 同一未知名（跨调用、同集合）仅首次命中 warn
    expect(buildSaveFileNameFromTemplate("{id}_{date}", ctx, singleUrl, seen)).toBe(
      "123456_{date}.jpg",
    )
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain("{date}")
    // 不同未知名 → 再告警一次
    expect(buildSaveFileNameFromTemplate("{id}_{date}_{user}", ctx, singleUrl, seen)).toBe(
      "123456_{date}_{user}.jpg",
    )
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

describe("命名模板：净化（spec T8/T9，镜像 Java GallerySaver.sanitizeFileName）", () => {
  it("T8 sanitizeNameSegment：路径分隔符/控制字符 → _，trim（与 Java 逐字同规则）", () => {
    expect(sanitizeNameSegment("Pictelio_1_p0.jpg")).toBe("Pictelio_1_p0.jpg")
    expect(sanitizeNameSegment("a/b\\c.jpg")).toBe("a_b_c.jpg")
    expect(sanitizeNameSegment("a\u0000\u001fb")).toBe("a__b")
    // 控制字符各换一个 _（a + 0x01 + 0x1F + " b" → a__ b）
    expect(sanitizeNameSegment("a\u0001\u001f b")).toBe("a__ b")
    expect(sanitizeNameSegment("  x.jpg ")).toBe("x.jpg")
    expect(sanitizeNameSegment("///")).toBe("___") // 全分隔符 → 全下划线（Java 同款用例）
  })

  it("T8 sanitizeLimitedSegment：单段 64 字符截断", () => {
    expect(sanitizeLimitedSegment("あ".repeat(100))).toHaveLength(DOWNLOAD_SEGMENT_MAX_LENGTH)
    expect(sanitizeLimitedSegment("a".repeat(64))).toHaveLength(64)
  })

  it("T9 模板字面量含 / → 净化为 _（路径注入不可行）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const singleUrl = "https://i.pximg.net/img-original/single.jpg"
    expect(buildSaveFileNameFromTemplate("../{id}", namingCtx(sampleSingle, 0), singleUrl)).toBe(
      ".._123456.jpg",
    )
    expect(buildSaveFileNameFromTemplate("a/b{id}", namingCtx(sampleSingle, 0), singleUrl)).toBe(
      "a_b123456.jpg",
    )
    warn.mockRestore()
  })

  it("标题/作者替换值净化：分隔符与控制字符 → _（值层不注入路径）+ trim", () => {
    const evil = makeIllust({
      page_count: 1,
      title: "a/b\\c",
      user: { id: toUserId(1), name: "  x\u001ay ", account: "a", profile_image_urls: {} },
      meta_pages: [],
      meta_single_page: { original_image_url: "https://i.pximg.net/s.jpg" },
    })
    expect(buildSaveFileNameFromTemplate("{title}_{author}", namingCtx(evil, 0), "https://i.pximg.net/s.jpg")).toBe(
      "a_b_c_x_y.jpg",
    )
  })
})

describe("命名模板：截断与读取期净化（spec T10 + D6）", () => {
  it("T10 最终名（含扩展名）≤120：双段 128 触顶时基段截断到 120-ext-1，边界相等可达", () => {
    // 双段 64+64=128 > 120：基段截断到 120 - "jpg".length - 1 = 116，最终名（含 .jpg）恰 120
    // （spec D3 逐字语义：展开 + 扩展名拼装后的最终文件名 ≤120，.ext 恒完整）
    const combo = makeIllust({
      page_count: 1,
      title: "T".repeat(100),
      user: { id: toUserId(1), name: "A".repeat(100), account: "a", profile_image_urls: {} },
      meta_pages: [],
      meta_single_page: { original_image_url: "https://i.pximg.net/s.jpg" },
    })
    const name = buildSaveFileNameFromTemplate("{author}{title}", namingCtx(combo, 0), "https://i.pximg.net/s.jpg")
    expect(name).toBe(
      "A".repeat(DOWNLOAD_SEGMENT_MAX_LENGTH) +
        "T".repeat(DOWNLOAD_FILENAME_MAX_LENGTH - 1 - "jpg".length - DOWNLOAD_SEGMENT_MAX_LENGTH) +
        ".jpg",
    )
    expect(name).toHaveLength(DOWNLOAD_FILENAME_MAX_LENGTH)
  })

  it("T10 .jpeg（4 字符扩展名）：预算按 ext 长度收缩，最终名仍恰 120 且 .jpeg 完整", () => {
    const combo = makeIllust({
      page_count: 1,
      title: "T".repeat(100),
      user: { id: toUserId(1), name: "A".repeat(100), account: "a", profile_image_urls: {} },
      meta_pages: [],
      meta_single_page: { original_image_url: "https://i.pximg.net/s.jpeg" },
    })
    const name = buildSaveFileNameFromTemplate("{author}{title}", namingCtx(combo, 0), "https://i.pximg.net/s.jpeg")
    expect(name.endsWith(".jpeg")).toBe(true)
    expect(name).toHaveLength(DOWNLOAD_FILENAME_MAX_LENGTH)
    expect(name.startsWith("A".repeat(DOWNLOAD_SEGMENT_MAX_LENGTH))).toBe(true)
  })

  it("T10 多页：页号段计入最终名 ≤120 预算且完整保留（双段触顶边界恰 120）", () => {
    // 双段 128 触顶 + _p11 后缀（4 字符）：基段截断到 116 - 4 = 112，最终名恰 120
    const longTitle = makeIllust({
      title: "T".repeat(100),
      user: { id: toUserId(1), name: "A".repeat(100), account: "a", profile_image_urls: {} },
    })
    const multiName = buildSaveFileNameFromTemplate("{author}{title}", namingCtx(longTitle, 11), sampleJpgUrl)
    expect(multiName).toHaveLength(DOWNLOAD_FILENAME_MAX_LENGTH)
    expect(multiName.endsWith("_p11.jpg")).toBe(true)
    // 单段触不到 120 上限（段级 64 先行收口）：页号段仍完整保留、最终名 ≤120
    const single = makeIllust({ title: "タ".repeat(300) })
    const name = buildSaveFileNameFromTemplate("{title}", namingCtx(single, 0), sampleJpgUrl)
    expect(name.length).toBeLessThanOrEqual(DOWNLOAD_FILENAME_MAX_LENGTH)
    expect(name.endsWith("_p0.jpg")).toBe(true)
  })

  it("normalizeDownloadTemplate：空/全净化为空 → 回落默认（fallback=true）；超长截断；分隔符净化", () => {
    expect(normalizeDownloadTemplate("Pictelio_{id}")).toEqual({ value: "Pictelio_{id}", fallback: false })
    expect(normalizeDownloadTemplate("")).toEqual({ value: DEFAULT_DOWNLOAD_TEMPLATE, fallback: true })
    expect(normalizeDownloadTemplate("   ")).toEqual({ value: DEFAULT_DOWNLOAD_TEMPLATE, fallback: true })
    // 全分隔符净化为 "___"（非空，镜像 Java sanitizeFileName 对 "///" 的合法结果，不回落）
    expect(normalizeDownloadTemplate("///")).toEqual({ value: "___", fallback: false })
    expect(normalizeDownloadTemplate(" a/b{id} ")).toEqual({ value: "a_b{id}", fallback: false })
    expect(normalizeDownloadTemplate("x".repeat(500)).value).toHaveLength(DOWNLOAD_TEMPLATE_MAX_LENGTH)
  })

  it("模板为空/展开为空 → 回落默认模板 + console.warn（禁静默回落）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const single = makeIllust({
      page_count: 1,
      meta_pages: [],
      meta_single_page: { original_image_url: "https://i.pximg.net/s.jpg" },
    })
    // 空模板：读取期回落默认
    expect(buildSaveFileNameFromTemplate("", namingCtx(single, 0), "https://i.pximg.net/s.jpg")).toBe(
      "Pictelio_123456.jpg",
    )
    // 展开为空（模板恰为 {p} 的单页作品）：展开层回落默认
    expect(buildSaveFileNameFromTemplate("{p}", namingCtx(single, 0), "https://i.pximg.net/s.jpg")).toBe(
      "Pictelio_123456.jpg",
    )
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe("作者目录段（spec T11/T12，ADR-0192 D5）", () => {
  it("T11 矩阵：开关关 → 空串（现行为字节不变）；开关开 + 作者 → 净化段", () => {
    expect(buildAuthorDirSegment(false, "画师名")).toBe("")
    expect(buildAuthorDirSegment(false, undefined)).toBe("")
    expect(buildAuthorDirSegment(true, "画师名")).toBe("画师名")
    expect(buildAuthorDirSegment(true, "a/b\\c")).toBe("a_b_c")
    expect(buildAuthorDirSegment(true, "  trim  ")).toBe("trim")
  })

  it("T12 作者缺失/净化后为空 → 空串（目录退化基座）+ console.warn（禁静默）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(buildAuthorDirSegment(true, undefined)).toBe("")
    expect(buildAuthorDirSegment(true, "")).toBe("")
    expect(buildAuthorDirSegment(true, "  ")).toBe("")
    expect(warn).toHaveBeenCalledTimes(3)
    warn.mockRestore()
  })
})

// 命名模板「空段残段不得静默」不变量单测（#757）。
//
// 缺陷：saveIllustPages 的命名 ctx 把 title 写死 "" 且不传 author，含 {title}/{author} 的
// 模板在该链展开成空段，连接符残段（`_123456.jpg` / `-123456.jpg`）既不剥离也无告警。
// 同一展开内核对 {p} 单页已有模板层剥离——本文件钉住 title/author 两段的对称处置。
//
// 核心风险（= 剥离必须在**模板层**）：值替换后清洗会把「真实标题自带的尾部下划线」
// 当成残段吃掉。断言「suffix_」逐字保留即为该风险的门禁。
import { describe, expect, it, vi } from "vitest"
import {
  buildSaveFileNameFromTemplate,
  DEFAULT_DOWNLOAD_TEMPLATE,
  saveIllustPages,
  type SaveNamingContext,
} from "./galleryDownload"
import { toIllustId, toUserId } from "../api/id"
import type { PixivIllust } from "../api/types"

/** 真实响应形状的单页作品（测试硬约束 #2：禁手写自洽字段） */
function makeSingleIllust(title: string, author: string): PixivIllust {
  return {
    id: toIllustId(123456),
    title,
    type: "illust",
    user: { id: toUserId(1), name: author, account: "a", profile_image_urls: {} },
    image_urls: {
      square_medium: "https://i.pximg.net/c/150x150/sq.jpg",
      medium: "https://i.pximg.net/c/540x540/m.jpg",
      large: "https://i.pximg.net/img-master/l.jpg",
    },
    width: 1000,
    height: 1400,
    page_count: 1,
    is_bookmarked: false,
    total_bookmarks: 1,
    tags: [],
    x_restrict: 0,
    create_date: "2026-01-01T00:00:00+09:00",
    meta_pages: [],
    meta_single_page: { original_image_url: "https://i.pximg.net/img-original/single.jpg" },
  }
}

/** 单页命名上下文：字段取自真实响应形状的 illust（pageCount=1 排除多页 _p<N> 追加路径） */
function singleCtx(illust: PixivIllust): SaveNamingContext {
  return { id: illust.id, title: illust.title, author: illust.user.name, page: 0, pageCount: 1 }
}

/** 「作者缺失」= ctx 里 author 缺位；生产中 `illust.user?.name` 在 user 缺位时正是此形 */
function noAuthorCtx(illust: PixivIllust): SaveNamingContext {
  return { ...singleCtx(illust), author: undefined }
}

const url = "https://i.pximg.net/img-original/single.jpg"

describe("命名模板：空段残段在模板层剥离（#757）", () => {
  it("title 为空 → 连同紧邻连接符剥离，产出不以 _ 开头（等价于 {id} 单独展开）", () => {
    expect(buildSaveFileNameFromTemplate("{title}_{id}", singleCtx(makeSingleIllust("", "画师名")), url)).toBe(
      "123456.jpg",
    )
  })

  it("author 缺失 → 连同紧邻连接符剥离，产出不以 - 开头", () => {
    expect(buildSaveFileNameFromTemplate("{author}-{id}", noAuthorCtx(makeSingleIllust("题", "画师名")), url)).toBe(
      "123456.jpg",
    )
    // 作者名存在但净化后为空（纯空白）同样按空段处置
    expect(buildSaveFileNameFromTemplate("{author}-{id}", singleCtx(makeSingleIllust("题", "   ")), url)).toBe(
      "123456.jpg",
    )
  })

  it("相邻两段同时为空不留下连续连接符；空段在末尾不留尾随连接符", () => {
    expect(
      buildSaveFileNameFromTemplate(
        "{title}_{author}_{id}",
        noAuthorCtx(makeSingleIllust("  ", "画师名")),
        url,
      ),
    ).toBe("123456.jpg")
    expect(buildSaveFileNameFromTemplate("{id}_{title}", singleCtx(makeSingleIllust("", "画师名")), url)).toBe(
      "123456.jpg",
    )
  })

  it("非空值不被误伤：真实标题/作者逐字保留（队列链与 ugoira 链既有行为不变）", () => {
    const ctx = singleCtx(makeSingleIllust("夕暮れの庭", "画师名"))
    expect(buildSaveFileNameFromTemplate("{title}_{id}", ctx, url)).toBe("夕暮れの庭_123456.jpg")
    expect(buildSaveFileNameFromTemplate("{author}-{id}", ctx, url)).toBe("画师名-123456.jpg")
  })

  it("剥离发生在模板层：以连接符结尾的真实值不丢尾（值层清洗会吃掉它）", () => {
    expect(
      buildSaveFileNameFromTemplate("{title}_{id}", singleCtx(makeSingleIllust("suffix_", "画师名")), url),
    ).toBe("suffix__123456.jpg")
    expect(buildSaveFileNameFromTemplate("{author}_{id}", singleCtx(makeSingleIllust("题", "a-")), url)).toBe(
      "a-_123456.jpg",
    )
  })

  it("模板恰为单一空段占位符 → 展开为空仍走既有「回落默认模板 + console.warn」兜底", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(
      buildSaveFileNameFromTemplate("{title}", singleCtx(makeSingleIllust("", "画师名")), url),
    ).toBe("Pictelio_123456.jpg")
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("默认模板逐字节不变：即使 title/author 皆空也不受剥离影响（零默认行为变化硬验收）", () => {
    expect(
      buildSaveFileNameFromTemplate(DEFAULT_DOWNLOAD_TEMPLATE, noAuthorCtx(makeSingleIllust("", "画师名")), url),
    ).toBe("Pictelio_123456.jpg")
  })
})

describe("saveIllustPages 编排器：恒空 ctx 不再静默产出残段（#757 缺陷现场）", () => {
  const run = (template: string, saveOne: (url: string, fileName: string) => Promise<void>) =>
    saveIllustPages({
      pages: [0],
      illustId: 123456,
      urlForPage: () => url,
      saveOne,
      naming: { template },
    })

  it("{title}_{id} / {author}-{id} 在单存链落盘名不带连接符残段", async () => {
    const saveOne = vi.fn().mockResolvedValue(undefined)
    await run("{title}_{id}", saveOne)
    await run("{author}-{id}", saveOne)
    expect(saveOne.mock.calls.map((c) => c[1])).toEqual(["123456.jpg", "123456.jpg"])
  })

  it("缺省模板（无占位符）路径逐字节不变", async () => {
    const saveOne = vi.fn().mockResolvedValue(undefined)
    await saveIllustPages({ pages: [0], illustId: 123456, urlForPage: () => url, saveOne })
    expect(saveOne.mock.calls[0]?.[1]).toBe("Pictelio_123456.jpg")
  })
})

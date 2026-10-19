// 命名模板「空段残段不得静默」不变量单测（#757）。
//
// 历史缺陷：已删除的单存链 `saveIllustPages`（#1043）把命名 ctx 的 title 写死 "" 且不传
// author，含 {title}/{author} 的模板在该链展开成空段，连接符残段（`_123456.jpg` /
// `-123456.jpg`）既不剥离也无告警。该链已删，但**剥离规则仍是活的**：队列链
// `buildImageTasks` 的 `namingCtxFor` 直接透传 `illust.title`，而 title 允许是空串或
// 全空白（见 `utils/artworkTitle.ts` 头注），此时同样会展开出空段。本文件钉住
// title/author 两段的对称处置，不随单存链退场。
//
// 核心风险（= 剥离必须在**模板层**）：值替换后清洗会把「真实标题自带的尾部下划线」
// 当成残段吃掉。断言「suffix_」逐字保留即为该风险的门禁。
//
// #1032 追加：第三种空段触发路径 = 「**占位符解析结果为空**」——单页作品的 `{p}` 展开为空串。
// 既有 `{p}` 剥离只吃占位符**前侧**连接符，模板首部的 `{p}` 因此留下孤立连接符
// （`{p}_{id}` → `_123456.jpg`，与 #757 修复前的 `{title}_{id}` 同形）。本文件同族断言：
// `{p}` 空段与 title/author 空段**同口径**（两侧连接符都吃、位置无关）。
import { describe, expect, it, vi } from "vitest"
import {
  buildSaveFileNameFromTemplate,
  DEFAULT_DOWNLOAD_TEMPLATE,
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

/** 多页语境（#1032）：`{p}` 解析为 0-based 页号（**非空**）⇒ 不作空段处置 */
function multiCtx(illust: PixivIllust, page: number): SaveNamingContext {
  return { ...singleCtx(illust), page, pageCount: 2 }
}

const url = "https://i.pximg.net/img-original/single.jpg"

describe("命名模板：空段残段在模板层剥离（#757 / #1032）", () => {
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

  // ── #1032：{p} 解析为空 = 第三种空段触发路径（与 title/author 空段同口径）──
  it("{p} 单页解析为空 → 连同紧邻两侧连接符剥离（首部形态不留孤立前导连接符）", () => {
    const ctx = singleCtx(makeSingleIllust("夕暮れの庭", "画师名"))
    expect(buildSaveFileNameFromTemplate("{p}_{id}", ctx, url)).toBe("123456.jpg")
    expect(buildSaveFileNameFromTemplate("{p}-{id}", ctx, url)).toBe("123456.jpg")
    expect(buildSaveFileNameFromTemplate("{p}_{title}", ctx, url)).toBe("夕暮れの庭.jpg")
  })

  it("两侧都吃、位置无关：{p} 居中时两侧连接符一并剥除、两段直接相接（同 title/author 空段口径）", () => {
    const ctx = singleCtx(makeSingleIllust("夕暮れの庭", "画师名"))
    expect(buildSaveFileNameFromTemplate("{author}_{p}_{title}", ctx, url)).toBe("画师名夕暮れの庭.jpg")
  })

  it("{p} 解析为非空（多页页号）→ 不作空段处置，连接符逐字保留", () => {
    const illust = makeSingleIllust("夕暮れの庭", "画师名")
    expect(buildSaveFileNameFromTemplate("{p}_{id}", multiCtx(illust, 0), url)).toBe("0_123456.jpg")
    expect(buildSaveFileNameFromTemplate("{p}_{title}", multiCtx(illust, 1), url)).toBe("1_夕暮れの庭.jpg")
  })

  it("单页 {p} 与空标题段语义等价：路径形态模板产出逐字节相同", () => {
    const ctx = singleCtx(makeSingleIllust("", "画师名"))
    // 推导：模板字面量 `/` 净化为 `_` → `{p}_..` → 剥 `{p}` 及其紧邻 `_` → `..` → 拼 `.jpg`
    expect(buildSaveFileNameFromTemplate("{p}/..", ctx, url)).toBe("...jpg")
    expect(buildSaveFileNameFromTemplate("{title}/..", ctx, url)).toBe("...jpg")
  })
})

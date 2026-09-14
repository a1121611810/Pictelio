// ─── api/illust 收藏加标签契约测试（T3 / issue #531，spec docs/specs/bookmark-tags.md D1/D4）───
// oracle 溯源：
//  - addBookmark tags 序列化：pixivpy3 aapi.py `illust_bookmark_add`（tags 以空格 join 成
//    单值、字面量字段名 `tags[]`，空标签集不发 tags 字段）——六实现差分互证见
//    docs/research/bookmark-tags-similar-clients.md §7.1；
//  - bookmark/detail 与 bookmark-tags/illust 端点与响应形状：同报告 §7.3/§7.4。
// mock 风格：跟随 ranking.test.ts（vi.hoisted + vi.mock("./client")）——序列化决策单点在
// illust.ts，断言传给 apiClient 的载荷字面量；URLSearchParams 编码由 client.test.ts 契约覆盖。
// IO 边界（AGENTS.md 测试硬约束 1）：三函数成功与失败双路径都测。
import { describe, expect, it, vi, beforeEach } from "vitest"

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }))

vi.mock("./client", () => ({
  apiClient: { get: getMock, post: postMock },
}))

import { addBookmark, loadBookmarkDetail, loadUserBookmarkTags } from "./illust"

describe("api/illust addBookmark（tags 序列化契约，oracle=pixivpy3 aapi.py）", () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
    postMock.mockResolvedValue(undefined)
  })

  it("无标签（默认 restrict=public）：仅 illust_id + restrict，不发 tags[] 字段", async () => {
    await addBookmark(111)
    expect(postMock).toHaveBeenCalledWith("/v2/illust/bookmark/add", {
      illust_id: "111",
      restrict: "public",
    })
  })

  it("空标签数组同样不发 tags[]（空集语义与不传一致）", async () => {
    await addBookmark(111, "public", [])
    expect(postMock).toHaveBeenCalledWith("/v2/illust/bookmark/add", {
      illust_id: "111",
      restrict: "public",
    })
  })

  it("单标签：字面量键 tags[]，restrict=private 透传", async () => {
    await addBookmark(222, "private", ["風景"])
    expect(postMock).toHaveBeenCalledWith("/v2/illust/bookmark/add", {
      illust_id: "222",
      restrict: "private",
      "tags[]": "風景",
    })
  })

  it("多标签：空格 join 成单值、顺序保持", async () => {
    await addBookmark(333, "public", ["風景", "花", "オリジナル"])
    expect(postMock).toHaveBeenCalledWith("/v2/illust/bookmark/add", {
      illust_id: "333",
      restrict: "public",
      "tags[]": "風景 花 オリジナル",
    })
  })

  it("含空格标签原样透传（服务端切分为生态位已知行为，spec D11）", async () => {
    await addBookmark(444, "public", ["東方 Project"])
    expect(postMock).toHaveBeenCalledWith("/v2/illust/bookmark/add", {
      illust_id: "444",
      restrict: "public",
      "tags[]": "東方 Project",
    })
  })

  it("失败路径向上传播（不静默吞错）", async () => {
    postMock.mockRejectedValue(new Error("bookmark add failed"))
    await expect(addBookmark(1)).rejects.toThrow("bookmark add failed")
  })
})

describe("api/illust loadBookmarkDetail（GET /v2/illust/bookmark/detail）", () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it("成功：illust_id 字符串化进参数，响应原样返回", async () => {
    const detail = {
      bookmark_detail: {
        is_bookmarked: true,
        restrict: "private",
        tags: [{ name: "風景", is_registered: true }],
      },
    }
    getMock.mockResolvedValue(detail)
    const result = await loadBookmarkDetail(555)
    expect(getMock).toHaveBeenCalledWith(
      "/v2/illust/bookmark/detail",
      { illust_id: "555" },
      undefined,
    )
    expect(result).toEqual(detail)
  })

  it("未收藏：bookmark_detail=null 原样透传（宽容解析由消费方处理）", async () => {
    getMock.mockResolvedValue({ bookmark_detail: null })
    const result = await loadBookmarkDetail(556)
    expect(result).toEqual({ bookmark_detail: null })
  })

  it("失败路径向上传播（HTTP 非 2xx 由 client 归一为 ApiError 后抛出）", async () => {
    getMock.mockRejectedValue(new Error("HTTP 500"))
    await expect(loadBookmarkDetail(1)).rejects.toThrow("HTTP 500")
  })
})

describe("api/illust loadUserBookmarkTags（GET /v1/user/bookmark-tags/illust）", () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it("成功：user_id + restrict 进参数，无 offset 不发该字段", async () => {
    const tags = { bookmark_tags: [{ name: "風景", count: 12 }], next_url: null }
    getMock.mockResolvedValue(tags)
    const result = await loadUserBookmarkTags(789, "public")
    expect(getMock).toHaveBeenCalledWith(
      "/v1/user/bookmark-tags/illust",
      { user_id: "789", restrict: "public" },
      undefined,
    )
    expect(result).toEqual(tags)
  })

  it("restrict 默认 public", async () => {
    getMock.mockResolvedValue({ bookmark_tags: [], next_url: null })
    await loadUserBookmarkTags(789)
    expect(getMock).toHaveBeenCalledWith(
      "/v1/user/bookmark-tags/illust",
      { user_id: "789", restrict: "public" },
      undefined,
    )
  })

  it("offset 提供时字符串化进参数（分页）", async () => {
    getMock.mockResolvedValue({
      bookmark_tags: [{ name: "花", count: 3 }],
      next_url: "https://app-api.pixiv.net/v1/user/bookmark-tags/illust?offset=30",
    })
    await loadUserBookmarkTags(789, "private", 30)
    expect(getMock).toHaveBeenCalledWith(
      "/v1/user/bookmark-tags/illust",
      { user_id: "789", restrict: "private", offset: "30" },
      undefined,
    )
  })

  it("失败路径向上传播", async () => {
    getMock.mockRejectedValue(new Error("network down"))
    await expect(loadUserBookmarkTags(789, "public")).rejects.toThrow("network down")
  })
})

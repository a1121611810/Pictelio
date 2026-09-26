// ─── api/user getMyPixivUsers 好P友列表契约测试（ADR-0193 D1 / #754 T7）───
// fixture 形状来源（测试硬约束 #2 真实样例）：envelope 逐字对齐 ADR-0193 六客户端交叉验证的
// GET /v1/user/mypixiv 响应形状（user_previews + next_url，元素 { user, illusts, novels, is_muted }）；
// user 对象逐字段复用仓库既有真实抓包 fixture（tests/fixtures/novel-recommended.real.json 的
// 真实 user 块：id/name/account/profile_image_urls/is_followed/is_accept_request + i.pximg.net
// 真实 URL 形状），非手写自洽字段。is_muted 保留透传不消费（ADR-0193 已否决本地过滤）。
// mock 风格跟随 notification.test.ts（vi.hoisted + vi.mock("./client")）。
// IO 边界（测试硬约束 #1）：成功与失败双路径都测。
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi, beforeEach } from "vitest"

const getMock = vi.hoisted(() => vi.fn())

vi.mock("./client", () => ({
  apiClient: { get: getMock, post: vi.fn() },
}))

import { getMyPixivUsers, loadUserListNext } from "./user"
import { toUserId } from "./id"
import type { PixivUserFollowingResponse } from "./types"

function loadFixture(): PixivUserFollowingResponse {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL("./__fixtures__/mypixiv-users.json", import.meta.url)), "utf8"),
  ) as PixivUserFollowingResponse
}

describe("api/user getMyPixivUsers（GET /v1/user/mypixiv，ADR-0193 D1）", () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it("请求契约：path=/v1/user/mypixiv，仅 user_id（无 restrict/filter 冗余参数——好P友无 restrict 维度）", async () => {
    getMock.mockResolvedValue(loadFixture())
    await getMyPixivUsers(toUserId(100000000))
    expect(getMock).toHaveBeenCalledTimes(1)
    expect(getMock).toHaveBeenCalledWith("/v1/user/mypixiv", { user_id: "100000000" })
  })

  it("offset 可选参数：存在时字符串化展开，缺省不出现", async () => {
    getMock.mockResolvedValue(loadFixture())
    await getMyPixivUsers(toUserId(100000000), 30)
    expect(getMock).toHaveBeenCalledWith("/v1/user/mypixiv", { user_id: "100000000", offset: "30" })
  })

  it("响应解析：真实样例 fixture 逐字透传（user_previews 元素含 user/illusts/novels/is_muted）", async () => {
    const fixture = loadFixture()
    getMock.mockResolvedValue(fixture)
    const result = await getMyPixivUsers(toUserId(100000000))
    expect(result).toEqual(fixture)
    // 真实样例结构钉 schema（ADR-0193 风险节：以真实形状 fixture 钉 schema）
    expect(result.user_previews).toHaveLength(2)
    const first = result.user_previews[0]!
    expect(typeof first.user.id).toBe("number")
    expect(typeof first.user.name).toBe("string")
    expect(typeof first.user.account).toBe("string")
    expect(typeof first.user.profile_image_urls?.medium).toBe("string")
    expect(Array.isArray(first.illusts)).toBe(true)
    // lynx 侧 novels 字段对齐 webview 同形（本批不消费，类型对齐防解析面分叉）
    expect(Array.isArray(first.novels)).toBe(true)
    expect(typeof first.is_muted).toBe("boolean")
    // 静音用户保留透传不过滤（ADR-0193 已否决本地过滤）
    expect(result.user_previews.some((p) => p.is_muted === true)).toBe(true)
  })

  it("offset 续页：fixture 的 next_url 经 loadUserListNext 完整 URL 透传（既有管道零改动）", async () => {
    const fixture = loadFixture()
    getMock.mockResolvedValue(fixture)
    const first = await getMyPixivUsers(toUserId(100000000))
    expect(first.next_url).not.toBeNull()
    getMock.mockResolvedValue({ user_previews: [], next_url: null })
    const second = await loadUserListNext(first.next_url!)
    expect(getMock).toHaveBeenLastCalledWith(
      "https://app-api.pixiv.net/v1/user/mypixiv?user_id=100000000&offset=30",
    )
    expect(second.next_url).toBeNull()
  })

  it("空列表：user_previews=[] 响应原样透传（空态判定交页面）", async () => {
    getMock.mockResolvedValue({ user_previews: [], next_url: null })
    const result = await getMyPixivUsers(toUserId(100000000))
    expect(result.user_previews).toEqual([])
    expect(result.next_url).toBeNull()
  })

  it("is_followed 缺失：端点层原样透传不播种（与 FollowList following 列表的播种特判无关）", async () => {
    const noSeed: PixivUserFollowingResponse = {
      user_previews: [
        {
          user: {
            id: toUserId(69931305),
            name: "Anna Wimbledon",
            account: "user_avxc7842",
            profile_image_urls: {
              medium: "https://i.pximg.net/user-profile/img/2023/08/09/07/41/04/24784896_3eb8b1ac3f180bc491634e943fc1eeb5_170.png",
            },
          },
          illusts: [],
          novels: [],
          is_muted: false,
        },
      ],
      next_url: null,
    }
    getMock.mockResolvedValue(noSeed)
    const result = await getMyPixivUsers(toUserId(100000000))
    // 断言端点封装不改写服务端真值（缺失保持缺失 → 页面按 falsy 渲染「关注」可点）
    expect(result.user_previews[0]!.user.is_followed).toBeUndefined()
  })

  it("错误路径：ApiError 上抛（client 归一，不静默吞错）", async () => {
    const apiError = { type: "SERVER", message: "服务器错误 (HTTP 500)" }
    getMock.mockRejectedValue(apiError)
    await expect(getMyPixivUsers(toUserId(100000000))).rejects.toEqual(apiError)
  })
})

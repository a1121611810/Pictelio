// ─── api/user getMyPixivUsers 好P友列表契约测试（ADR-0193 D1 / #754 T7）───
// fixture 形状来源（测试硬约束 #2 真实样例）：**本仓真实抓包**（2026-10-23 登录态账号实测，
// 过程与逐项量测见 docs/research/mypixiv-real-capture-2026-10.md）。
// __fixtures__/mypixiv-users.json = GET /v1/user/mypixiv?user_id=220294 的真实分页响应
// （前 9 项逐字未改，含 2 项非空 novels，next_url 为服务端原文）；envelope 为
// user_previews + next_url，元素 { user, illusts, novels, is_muted }——user 块含
// id/name/account/profile_image_urls/is_followed/is_accept_request（真包实测 28/28 均在；fixture 取前 9 项）。
// __fixtures__/mypixiv-users.empty.json = 真实空态响应 {"user_previews":[],"next_url":null}。
// 非手写自洽字段。is_muted 保留透传不消费（ADR-0193 已否决本地过滤）。
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

/** 真实空态响应（抓包原文）：{"user_previews":[],"next_url":null} */
function loadEmptyFixture(): PixivUserFollowingResponse {
  return JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./__fixtures__/mypixiv-users.empty.json", import.meta.url)),
      "utf8",
    ),
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
    // 真实样例结构钉 schema（ADR-0193 风险节：已由真实抓包兑现，见 research 文档）
    // 期望值出处 = 真实抓包的分页响应条目数（截取前 9 项），非手写数字
    expect(result.user_previews).toHaveLength(9)
    const first = result.user_previews[0]!
    expect(typeof first.user.id).toBe("number")
    expect(typeof first.user.name).toBe("string")
    expect(typeof first.user.account).toBe("string")
    expect(typeof first.user.profile_image_urls?.medium).toBe("string")
    expect(Array.isArray(first.illusts)).toBe(true)
    // novels 字段（本批不消费，类型对齐防解析面分叉）
    expect(Array.isArray(first.novels)).toBe(true)
    expect(typeof first.is_muted).toBe("boolean")
    // 静音用户保留透传不过滤（ADR-0193 已否决本地过滤）——fixture 9/9 的 is_muted 均为 false，
    // 故「透传不过滤」按行为断言单独钉（下方「is_muted=true 不被本地过滤」用例）
    expect(result.user_previews.every((p) => typeof p.is_muted === "boolean")).toBe(true)
  })

  it("真实抓包形状：每个条目的 4 个键齐全，user 块含 is_accept_request 布尔（ADR-0193 风险节兑现）", async () => {
    const fixture = loadFixture()
    getMock.mockResolvedValue(fixture)
    const result = await getMyPixivUsers(toUserId(100000000))
    // fixture 量测（9/9；抓包 28/28 同形）：条目键 = user/illusts/novels/is_muted；user 键 =
    // id/name/account/profile_image_urls/is_followed/is_accept_request
    for (const item of result.user_previews) {
      expect(Object.keys(item).sort()).toEqual(["illusts", "is_muted", "novels", "user"])
      expect("is_accept_request" in item.user).toBe(true)
      expect(typeof item.user.is_accept_request).toBe("boolean")
      expect(typeof item.user.is_followed).toBe("boolean")
      expect(Array.isArray(item.illusts)).toBe(true)
      expect(Array.isArray(item.novels)).toBe(true)
    }
    // 真包含 is_accept_request=true 的条目（不是只有 false 的单边样本）
    expect(result.user_previews.some((p) => p.user.is_accept_request === true)).toBe(true)
    // 真包含 novels 非空的条目 → novel 元素形状可查（旧 fixture 全为空数组，此项无元素可查）
    const withNovel = result.user_previews.find((p) => (p.novels ?? []).length > 0)
    expect(withNovel).toBeDefined()
    const novel = withNovel!.novels![0]!
    expect(typeof novel.id).toBe("number")
    expect(typeof novel.title).toBe("string")
    expect(typeof novel.page_count).toBe("number")
    expect(typeof novel.text_length).toBe("number")
    expect(typeof novel.x_restrict).toBe("number")
    expect(typeof novel.is_bookmarked).toBe("boolean")
    expect(typeof novel.total_bookmarks).toBe("number")
    expect(typeof novel.create_date).toBe("string")
    expect(Array.isArray(novel.tags)).toBe(true)
  })

  it("is_muted=true 不被本地过滤（透传行为断言；从**真实条目**派生，不手写 user 块）", async () => {
    // ⚠️ 测试硬约束 #2（契约 mock 必须来自真实样例）：fixture 9/9 条目的 is_muted 恰好全为 false
    // ⇒ 直接取不到 true 的样本。此处从真实抓包 fixture 取**一个真实条目**，
    // **只把 is_muted 翻成 true**，其余字段（user / illusts / novels）逐字来自真实抓包
    // ⇒ 真实形状若漂移，漂移会跟着漂移，不会被手写的自洽字段掩盖。
    const fixture = loadFixture()
    const real = fixture.user_previews[0]!
    expect(real.is_muted).toBe(false)
    const muted: PixivUserFollowingResponse = {
      user_previews: [{ ...real, is_muted: true }],
      next_url: null,
    }
    getMock.mockResolvedValue(muted)
    const result = await getMyPixivUsers(toUserId(100000000))
    expect(result.user_previews).toHaveLength(1)
    expect(result.user_previews[0]!.is_muted).toBe(true)
    // 派生自真实条目 ⇒ 其余字段与真实抓包逐字一致（user 块含 is_accept_request）
    expect(result.user_previews[0]!.user).toEqual(real.user)
    expect("is_accept_request" in result.user_previews[0]!.user).toBe(true)
  })

  it("offset 续页：fixture 的 next_url 经 loadUserListNext 完整 URL 透传（既有管道零改动）", async () => {
    const fixture = loadFixture()
    getMock.mockResolvedValue(fixture)
    const first = await getMyPixivUsers(toUserId(100000000))
    expect(first.next_url).not.toBeNull()
    getMock.mockResolvedValue({ user_previews: [], next_url: null })
    const second = await loadUserListNext(first.next_url!)
    // 期望值 = 真实抓包响应里服务端下发的 next_url 原文（拼自该次请求的 user_id）
    expect(getMock).toHaveBeenLastCalledWith(
      "https://app-api.pixiv.net/v1/user/mypixiv?user_id=220294&offset=30",
    )
    expect(second.next_url).toBeNull()
  })

  it("空列表：真实空态 fixture 原样透传（空态判定交页面）", async () => {
    getMock.mockResolvedValue(loadEmptyFixture())
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
          // novels 缺省（**类型可选**是编译期防线，勿收紧；真实抓包实测 mypixiv 与 following
          // 响应的条目均带 novels 键——可选性是保守选择，不是「该端点无此字段」的事实）
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

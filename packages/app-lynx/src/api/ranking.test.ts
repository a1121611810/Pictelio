// 排行榜薄传输层（spec docs/specs/ranking.md §6.1）。
// oracle：端点/参数真值在 packages/ranking-core/tests/buildRequest.test.ts；此处只验 GET 装配与失败传播。
import { describe, expect, it, vi, beforeEach } from "vitest"

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))

vi.mock("./client", () => ({
  apiClient: { get: getMock, post: vi.fn() },
}))

import { loadRanking, loadRankingNext } from "./ranking"

describe("api/ranking（薄传输层）", () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it("日榜·今日：GET /v1/illust/ranking，date 不携带", async () => {
    getMock.mockResolvedValue({ illusts: [], next_url: null })
    await loadRanking({ mode: "daily", date: null })
    expect(getMock).toHaveBeenCalledWith(
      "/v1/illust/ranking",
      { mode: "day", filter: "for_ios" },
      undefined,
    )
  })

  it("历史日期透传（apiMode 由 ranking-core 映射）", async () => {
    getMock.mockResolvedValue({ illusts: [], next_url: null })
    await loadRanking({ mode: "weekly", date: "2026-09-01" })
    expect(getMock).toHaveBeenCalledWith(
      "/v1/illust/ranking",
      { mode: "week", filter: "for_ios", date: "2026-09-01" },
      undefined,
    )
  })

  it("loadRankingNext 透传 next_url 与 AbortSignal", async () => {
    getMock.mockResolvedValue({ illusts: [], next_url: null })
    const controller = new AbortController()
    const url = "https://app-api.pixiv.net/v1/illust/ranking?mode=day&offset=30"
    await loadRankingNext(url, controller.signal)
    expect(getMock).toHaveBeenCalledWith(url, undefined, controller.signal)
  })

  it("失败路径向上传播（不静默吞错）", async () => {
    getMock.mockRejectedValue(new Error("network down"))
    await expect(loadRanking({ mode: "daily", date: null })).rejects.toThrow("network down")
  })
})

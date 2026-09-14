// 排行榜薄传输层（spec docs/specs/ranking.md §6.1）。
// oracle：端点/参数真值在 packages/ranking-core/tests/buildRequest.test.ts（GET 装配此处只验传递）；
// next_url 域名守卫与 request 失败传播为独立行为断言。
import { describe, expect, it, vi, beforeEach } from "vitest";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

// 保留 client 模块真实导出（urlGuard 复用真实的 isTrustedPixivHost 白名单），只替换 apiClient
vi.mock("@/api/client", async (importActual) => {
  const actual = await importActual<typeof import("@/api/client")>();
  return { ...actual, apiClient: { get: getMock, post: vi.fn() } };
});

import { fetchRanking, fetchRankingNext } from "@/api/ranking";

describe("api/ranking.ts（薄传输层）", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("日榜·今日：GET /v1/illust/ranking，date 不携带、mode=day、filter=for_ios", async () => {
    getMock.mockResolvedValue({ illusts: [], next_url: null });
    await fetchRanking({ mode: "daily", date: null });
    expect(getMock).toHaveBeenCalledWith(
      "/v1/illust/ranking",
      { mode: "day", filter: "for_ios" },
      undefined,
    );
  });

  it("历史日期：date 按 YYYY-MM-DD 透传（apiMode 由 ranking-core 映射）", async () => {
    getMock.mockResolvedValue({ illusts: [], next_url: null });
    await fetchRanking({ mode: "weekly", date: "2026-09-01" });
    expect(getMock).toHaveBeenCalledWith(
      "/v1/illust/ranking",
      { mode: "week", filter: "for_ios", date: "2026-09-01" },
      undefined,
    );
  });

  it("fetchRankingNext 透传已校验的 next_url 与 AbortSignal", async () => {
    getMock.mockResolvedValue({ illusts: [], next_url: null });
    const controller = new AbortController();
    const url = "https://app-api.pixiv.net/v1/illust/ranking?mode=day&offset=30";
    await fetchRankingNext(url, controller.signal);
    expect(getMock).toHaveBeenCalledWith(url, undefined, controller.signal);
  });

  it("fetchRankingNext 拒绝非 Pixiv 域名的 next_url（SSRF 守卫，不发请求）", () => {
    expect(() => fetchRankingNext("https://evil.example.com/steal")).toThrow(/trusted Pixiv host/);
    expect(getMock).not.toHaveBeenCalled();
  });

  it("失败路径：请求错误向上传播（不静默吞掉）", async () => {
    getMock.mockRejectedValue(new Error("network down"));
    await expect(fetchRanking({ mode: "daily", date: null })).rejects.toThrow("network down");
  });
});

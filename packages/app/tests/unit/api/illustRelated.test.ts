// loadRelated API 单元测试（spec docs/specs/related-injection.md §6）。
// Oracle 溯源：端点/参数形状来自官方 App API `/v1/illust/related`（与 /v1/illust/recommended
// 同构，filter=for_ios 为项目恒定惯例），期望值非从被测实现反推。
import { describe, expect, it, vi, beforeEach } from "vitest";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock("@/api/client", () => ({
  apiClient: { get: getMock, post: vi.fn() },
}));

import { loadRelated } from "@/api/illust";

describe("loadRelated（相关作品）", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("GET /v1/illust/related，携带 illust_id 与 filter=for_ios", async () => {
    getMock.mockResolvedValue({ illusts: [], next_url: null });
    await loadRelated(123);
    expect(getMock).toHaveBeenCalledWith(
      "/v1/illust/related",
      { illust_id: "123", filter: "for_ios" },
      undefined,
    );
  });

  it("透传 AbortSignal", async () => {
    getMock.mockResolvedValue({ illusts: [], next_url: null });
    const controller = new AbortController();
    await loadRelated(456, controller.signal);
    const [, , signalArg] = getMock.mock.calls[0];
    expect(signalArg).toBe(controller.signal);
  });

  it("失败路径：网络错误向上传播（调用方 consume 捕获并 warn）", async () => {
    getMock.mockRejectedValue(new Error("network down"));
    await expect(loadRelated(789)).rejects.toThrow("network down");
  });
});

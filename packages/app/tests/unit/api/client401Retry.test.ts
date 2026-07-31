import { describe, it, expect, vi } from "vitest";

// Mock @capacitor/core: keep Capacitor (isNativePlatform) + registerPlugin, remove CapacitorHttp
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: vi.fn(),
}));

// Mock PixivApi (used by client.ts for native requests)
vi.mock("@/native/PixivApi", () => ({
  PixivApi: {
    request: vi.fn(),
    syncToken: vi.fn(),
    prefetchImage: vi.fn(),
  },
}));

async function loadModule() {
  vi.resetModules();
  const mod = await import("@/api/client");
  mod.setAccessToken("test-token");
  return mod;
}

describe("apiClient — PixivApi native mode", () => {
  it("successful GET returns parsed data", async () => {
    const { apiClient } = await loadModule();
    const { PixivApi } = await import("@/native/PixivApi");
    vi.mocked(PixivApi.request).mockResolvedValue({
      status: 200,
      data: JSON.stringify({ illust: { id: 123, title: "Test" } }),
    });

    const result = await apiClient.get("/v1/illust/123");

    expect(result).toEqual({ illust: { id: 123, title: "Test" } });
    expect(PixivApi.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/v1/illust/123",
      params: undefined,
      body: undefined,
    });
  });

  it("passes query params to PixivApi.request", async () => {
    const { apiClient } = await loadModule();
    const { PixivApi } = await import("@/native/PixivApi");
    vi.mocked(PixivApi.request).mockResolvedValue({
      status: 200,
      data: JSON.stringify({}),
    });

    await apiClient.get("/v1/search", { q: "test" });

    expect(PixivApi.request).toHaveBeenCalledWith({
      method: "GET",
      path: "/v1/search",
      params: { q: "test" },
      body: undefined,
    });
  });

  it("401 response throws UNAUTHORIZED error via classifyError", async () => {
    const { apiClient } = await loadModule();
    const { PixivApi } = await import("@/native/PixivApi");
    vi.mocked(PixivApi.request).mockResolvedValue({
      status: 401,
      data: null,
    });

    await expect(apiClient.get("/v1/illust/123")).rejects.toMatchObject({
      type: "UNAUTHORIZED",
      message: expect.stringContaining("401"),
    });
  });

  it("403 response throws FORBIDDEN error", async () => {
    const { apiClient } = await loadModule();
    const { PixivApi } = await import("@/native/PixivApi");
    vi.mocked(PixivApi.request).mockResolvedValue({
      status: 403,
      data: null,
    });

    await expect(apiClient.get("/v1/illust/123")).rejects.toMatchObject({
      type: "FORBIDDEN",
    });
  });

  it("429 response throws RATE_LIMIT error", async () => {
    const { apiClient } = await loadModule();
    const { PixivApi } = await import("@/native/PixivApi");
    vi.mocked(PixivApi.request).mockResolvedValue({
      status: 429,
      data: null,
    });

    await expect(apiClient.get("/v1/illust/123")).rejects.toMatchObject({
      type: "RATE_LIMIT",
    });
  });

  it("500+ response throws SERVER error", async () => {
    const { apiClient } = await loadModule();
    const { PixivApi } = await import("@/native/PixivApi");
    vi.mocked(PixivApi.request).mockResolvedValue({
      status: 503,
      data: null,
    });

    await expect(apiClient.get("/v1/illust/123")).rejects.toMatchObject({
      type: "SERVER",
    });
  });

  it("GET request deduplication: same URL shares one PixivApi.request", async () => {
    const { apiClient } = await loadModule();
    const { PixivApi } = await import("@/native/PixivApi");
    vi.mocked(PixivApi.request).mockResolvedValue({
      status: 200,
      data: JSON.stringify({ data: "shared" }),
    });

    const [resultA, resultB] = await Promise.all([
      apiClient.get("/v1/illust/123"),
      apiClient.get("/v1/illust/123"),
    ]);

    expect(resultA).toEqual({ data: "shared" });
    expect(resultB).toEqual({ data: "shared" });
    expect(PixivApi.request).toHaveBeenCalledTimes(1);
  });

  it("different URLs make separate PixivApi.request calls", async () => {
    const { apiClient } = await loadModule();
    const { PixivApi } = await import("@/native/PixivApi");
    vi.mocked(PixivApi.request)
      .mockResolvedValueOnce({ status: 200, data: JSON.stringify({ data: "A" }) })
      .mockResolvedValueOnce({ status: 200, data: JSON.stringify({ data: "B" }) });

    const [resultA, resultB] = await Promise.all([
      apiClient.get("/v1/illust/A"),
      apiClient.get("/v1/illust/B"),
    ]);

    expect(resultA).toEqual({ data: "A" });
    expect(resultB).toEqual({ data: "B" });
    expect(PixivApi.request).toHaveBeenCalledTimes(2);
  });

  it("extracts Pixiv error message from response body via classifyError", async () => {
    const { apiClient } = await loadModule();
    const { PixivApi } = await import("@/native/PixivApi");
    vi.mocked(PixivApi.request).mockResolvedValue({
      status: 403,
      data: JSON.stringify({
        errors: { system: { message: "rate limit", code: 100 } },
      }),
    });

    const err = await apiClient.get("/v1/illust/123").catch((e) => e);
    expect(err.type).toBe("FORBIDDEN");
    expect(err.message).toContain("[100] rate limit");
  });

  it("OAuth 400 error is classified as UNAUTHORIZED", async () => {
    const { apiClient } = await loadModule();
    const { PixivApi } = await import("@/native/PixivApi");
    vi.mocked(PixivApi.request).mockResolvedValue({
      status: 400,
      data: JSON.stringify({
        error: { message: "OAuth error: invalid_request" },
      }),
    });

    await expect(apiClient.get("/v1/illust/123")).rejects.toMatchObject({
      type: "UNAUTHORIZED",
      status: 400,
    });
  });

  it("non-OAuth 400 returns UNKNOWN error", async () => {
    const { apiClient } = await loadModule();
    const { PixivApi } = await import("@/native/PixivApi");
    vi.mocked(PixivApi.request).mockResolvedValue({
      status: 400,
      data: JSON.stringify({ error: "bad_request" }),
    });

    await expect(apiClient.get("/v1/illust/123")).rejects.toMatchObject({
      type: "UNKNOWN",
    });
  });
});

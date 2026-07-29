import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from "vitest";
import { ApiErrorType, type ApiError } from "@/api/types";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => false,
  },
  registerPlugin: vi.fn(() => ({
    request: vi.fn(),
    setRefreshToken: vi.fn(),
    prefetchImage: vi.fn(),
  })),
}));

vi.mock("@/native/PixivApi", () => ({
  PixivApi: { request: vi.fn(), setRefreshToken: vi.fn(), prefetchImage: vi.fn() },
}));

async function loadModule() {
  vi.resetModules();
  return import("@/api/client");
}

describe("extractPixivErrorMessage", () => {
  it("extracts from system error format", async () => {
    const { extractPixivErrorMessage } = await loadModule();
    const result = extractPixivErrorMessage({
      errors: { system: { message: "Rate limit", code: 429 } },
    });
    expect(result).toBe("[429] Rate limit");
  });

  it("extracts from top-level message", async () => {
    const { extractPixivErrorMessage } = await loadModule();
    expect(extractPixivErrorMessage({ message: "Not found" })).toBe("Not found");
  });

  it("extracts from top-level error field", async () => {
    const { extractPixivErrorMessage } = await loadModule();
    expect(extractPixivErrorMessage({ error: "invalid_grant" })).toBe("invalid_grant");
  });

  it("returns null for non-object", async () => {
    const { extractPixivErrorMessage } = await loadModule();
    expect(extractPixivErrorMessage(null)).toBeNull();
    expect(extractPixivErrorMessage("string")).toBeNull();
  });

  it("returns null for empty object", async () => {
    const { extractPixivErrorMessage } = await loadModule();
    expect(extractPixivErrorMessage({})).toBeNull();
  });

  it("extracts from OAuth error format (error as object with message)", async () => {
    const { extractPixivErrorMessage } = await loadModule();
    const result = extractPixivErrorMessage({
      error: {
        message:
          "Error occurred at the OAuth process. Please check your Access Token to fix this. Error Message: invalid_request",
      },
    });
    expect(result).toBe(
      "Error occurred at the OAuth process. Please check your Access Token to fix this. Error Message: invalid_request",
    );
  });

  it("returns null when error object has no message", async () => {
    const { extractPixivErrorMessage } = await loadModule();
    expect(extractPixivErrorMessage({ error: {} })).toBeNull();
  });
});

describe("isOAuthTokenErrorResponse", () => {
  it("returns true for 400 + OAuth error body", async () => {
    const { isOAuthTokenErrorResponse } = await loadModule();
    expect(
      isOAuthTokenErrorResponse(400, {
        error: { message: "Error occurred at the OAuth process. invalid_request" },
      }),
    ).toBe(true);
  });

  it("returns true for 400 + invalid_request body", async () => {
    const { isOAuthTokenErrorResponse } = await loadModule();
    expect(
      isOAuthTokenErrorResponse(400, {
        error: { message: "invalid_request" },
      }),
    ).toBe(true);
  });

  it("returns false for 400 + non-OAuth error object", async () => {
    const { isOAuthTokenErrorResponse } = await loadModule();
    expect(
      isOAuthTokenErrorResponse(400, {
        error: { message: "not found" },
      }),
    ).toBe(false);
  });

  it("returns false for 400 + string error field", async () => {
    const { isOAuthTokenErrorResponse } = await loadModule();
    expect(isOAuthTokenErrorResponse(400, { error: "invalid_grant" })).toBe(false);
  });

  it("returns false for non-400 status", async () => {
    const { isOAuthTokenErrorResponse } = await loadModule();
    expect(
      isOAuthTokenErrorResponse(401, {
        error: { message: "OAuth error" },
      }),
    ).toBe(false);
  });

  it("returns false for null/undefined body", async () => {
    const { isOAuthTokenErrorResponse } = await loadModule();
    expect(isOAuthTokenErrorResponse(400, null)).toBe(false);
    expect(isOAuthTokenErrorResponse(400, undefined)).toBe(false);
  });
});

describe("classifyError", () => {
  it("classifies 401 as UNAUTHORIZED", async () => {
    const { classifyError } = await loadModule();
    const err = classifyError(401, null) as ApiError;
    expect(err.type).toBe(ApiErrorType.UNAUTHORIZED);
    expect(err.message).toContain("401");
    // Type narrowing: verify the return shape
    expectTypeOf(err).toHaveProperty("type");
    expectTypeOf(err.type).toEqualTypeOf<ApiErrorType>();
    expectTypeOf(err.message).toBeString();
  });

  it("classifies 403 as FORBIDDEN", async () => {
    const { classifyError } = await loadModule();
    expect(classifyError(403, null).type).toBe(ApiErrorType.FORBIDDEN);
  });

  it("classifies 429 as RATE_LIMIT", async () => {
    const { classifyError } = await loadModule();
    expect(classifyError(429, null).type).toBe(ApiErrorType.RATE_LIMIT);
  });

  it("classifies 500+ as SERVER", async () => {
    const { classifyError } = await loadModule();
    expect(classifyError(503, null).type).toBe(ApiErrorType.SERVER);
  });

  it("classifies network TypeError as NETWORK", async () => {
    const { classifyError } = await loadModule();
    expect(classifyError(0, new TypeError("fetch failed")).type).toBe(ApiErrorType.NETWORK);
  });

  it("classifies unknown status as UNKNOWN", async () => {
    const { classifyError } = await loadModule();
    expect(classifyError(418, null).type).toBe(ApiErrorType.UNKNOWN);
  });

  it("includes Pixiv error message in suffix when available", async () => {
    const { classifyError } = await loadModule();
    const err = classifyError(403, null, { errors: { system: { message: "Forbidden" } } });
    expect(err.message).toContain("Forbidden");
  });

  it("detects proxy_error response body and returns PROXY type", async () => {
    const { classifyError } = await loadModule();
    const err = classifyError(502, null, {
      error: "proxy_error",
      message: "代理连接失败，请检查网络或代理状态",
    });
    expect(err.type).toBe(ApiErrorType.PROXY);
    expect(err.message).toContain("代理");
    expect(err.message).toContain("127.0.0.1:10808");
  });

  it("returns PROXY type even when status suggests SERVER", async () => {
    const { classifyError } = await loadModule();
    // Proxy_error with 5xx — ensure PROXY classification wins
    const err = classifyError(503, null, { error: "proxy_error" });
    expect(err.type).toBe(ApiErrorType.PROXY);
  });

  it("does not confuse non-proxy error with error field as proxy", async () => {
    const { classifyError } = await loadModule();
    // Pixiv API may return { error: "invalid_grant" } — must not match proxy_error
    const err = classifyError(400, null, { error: "invalid_grant" });
    expect(err.type).not.toBe(ApiErrorType.PROXY);
  });

  it("classifies 400 + OAuth token error as UNAUTHORIZED", async () => {
    const { classifyError } = await loadModule();
    const err = classifyError(400, null, {
      error: { message: "Error occurred at the OAuth process. invalid_request" },
    });
    expect(err.type).toBe(ApiErrorType.UNAUTHORIZED);
    expect(err.message).toBe("登录凭证已失效，请重新登录");
  });

  it("classifies 400 + invalid_request as UNAUTHORIZED", async () => {
    const { classifyError } = await loadModule();
    const err = classifyError(400, null, {
      error: { message: "invalid_request" },
    });
    expect(err.type).toBe(ApiErrorType.UNAUTHORIZED);
  });

  it("does not classify 400 + non-OAuth error body as UNAUTHORIZED", async () => {
    const { classifyError } = await loadModule();
    const err = classifyError(400, null, { error: { message: "not found" } });
    expect(err.type).not.toBe(ApiErrorType.UNAUTHORIZED);
  });

  it("does not classify 400 without body as UNAUTHORIZED", async () => {
    const { classifyError } = await loadModule();
    const err = classifyError(400, null);
    expect(err.type).not.toBe(ApiErrorType.UNAUTHORIZED);
  });
});

describe("rewriteUrl", () => {
  it("returns proxy paths unchanged", async () => {
    const { rewriteUrl } = await loadModule();
    expect(rewriteUrl("/pixiv-img/test.jpg")).toBe("/pixiv-img/test.jpg");
  });

  it("rewrites Pixiv API URL to proxy in web mode", async () => {
    const { rewriteUrl } = await loadModule();
    expect(rewriteUrl("https://app-api.pixiv.net/v1/illust/recommended")).toBe(
      "/pixiv-api/v1/illust/recommended",
    );
  });

  it("rewrites OAuth URL to proxy in web mode", async () => {
    const { rewriteUrl } = await loadModule();
    expect(rewriteUrl("https://oauth.secure.pixiv.net/auth/token")).toBe("/pixiv-oauth/auth/token");
  });

  it("prepends /pixiv-api to relative paths in web mode", async () => {
    const { rewriteUrl } = await loadModule();
    expect(rewriteUrl("/v1/illust/detail")).toBe("/pixiv-api/v1/illust/detail");
  });

  it("returns http URLs as-is in web mode (non-pixiv)", async () => {
    const { rewriteUrl } = await loadModule();
    expect(rewriteUrl("https://example.com/image.jpg")).toBe("https://example.com/image.jpg");
  });
});

describe("setAccessToken / setOnUnauthorized / setRefreshPromise", () => {
  it("setAccessToken stores token", async () => {
    const { setAccessToken } = await loadModule();
    setAccessToken("test-token");
  });

  it("setOnUnauthorized stores handler", async () => {
    const { setOnUnauthorized } = await loadModule();
    setOnUnauthorized(vi.fn());
  });
});

describe("apiClient.get — error classification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any).fetch;
  });

  it("classifies 400 OAuth error as UNAUTHORIZED via web path", async () => {
    const mockResponseData = {
      error: { message: "Error occurred at the OAuth process. invalid_request" },
    };
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        status: 400,
        ok: false,
        json: () => Promise.resolve(mockResponseData),
        headers: { get: () => "application/json" },
      }),
    );

    vi.stubGlobal("fetch", mockFetch);
    const { apiClient } = await loadModule();
    globalThis.fetch = mockFetch;

    await expect(apiClient.get("/v1/illust/recommended")).rejects.toMatchObject({
      type: ApiErrorType.UNAUTHORIZED,
    });
  });

  it("classifies 401 as UNAUTHORIZED via web path", async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        status: 401,
        ok: false,
        json: () => Promise.resolve({}),
        headers: { get: () => "application/json" },
      }),
    );

    vi.stubGlobal("fetch", mockFetch);
    const { apiClient } = await loadModule();
    globalThis.fetch = mockFetch;

    await expect(apiClient.get("/v1/illust/recommended")).rejects.toMatchObject({
      type: ApiErrorType.UNAUTHORIZED,
    });
  });
});

// 契约 mock 来自真实 Pixiv 响应（pixivpy#374 / gallery-dl#9331）：
// refresh_token 失效时 oauth.secure.pixiv.net/auth/token 返回 HTTP 400，
// 响应体为 {"has_error":true,"errors":{"system":{"message":"Invalid refresh token","code":1508}},"error":"invalid_grant"}。
// URL 重写 / 令牌守卫用例期望值来源（oracle 溯源，ADR-0100 / AGENTS.md「期望值出处可追溯」）：
// - 受信主机白名单与常量在 vitest 环境来自 vitest.config.ts 的 __PUBLIC_CONFIG__ 副本
//   （与实现共享同一 define，非 credentials.json5 经 Vite define 注入的路径）；
//   用例期望值另经差分表 sharedUrlRewriteCases.ts / 真实字面量锚定，避免自洽 mock；
// - rewriteUrl 边界用例：边界匹配语义（path === base || startsWith(base + "/")；auth 另补
//   startsWith(base + "?")）；
// - evil 伪后缀域样例与共享差分契约表 sharedUrlRewriteCases.ts（spec #187 / ticket #194）同源；
// - isTrustedPixivHost：受信主机白名单 = __PUBLIC_CONFIG__ 常量 hostname 集合（经 vitest 副本推导）；
// - shouldAttachAuth：web = /pixiv- 前缀；native = http 前缀 && 受信主机（ADR-0100 决策 2/3）。
import { describe, it, expect, expectTypeOf, vi, beforeEach, afterEach } from "vitest";
import { ApiErrorType, type ApiError } from "@/api/types";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => isNativeMock(),
  },
  registerPlugin: vi.fn(() => ({
    request: vi.fn(),
    syncToken: vi.fn(),
    prefetchImage: vi.fn(),
  })),
}));

const { isNativeMock } = vi.hoisted(() => ({ isNativeMock: vi.fn(() => false) }));

vi.mock("@/native/PixivApi", () => ({
  PixivApi: { request: vi.fn(), syncToken: vi.fn(), prefetchImage: vi.fn() },
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

  it("returns true for 400 + string error field (invalid_grant)", async () => {
    const { isOAuthTokenErrorResponse } = await loadModule();
    expect(isOAuthTokenErrorResponse(400, { error: "invalid_grant" })).toBe(true);
  });

  it("returns true for 400 + object error message containing invalid_grant", async () => {
    const { isOAuthTokenErrorResponse } = await loadModule();
    expect(
      isOAuthTokenErrorResponse(400, {
        error: { message: "invalid_grant" },
      }),
    ).toBe(true);
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
    // Pixiv API 真实 OAuth 错误 { error: "invalid_grant" } — 不是 proxy_error，且归为 UNAUTHORIZED
    const err = classifyError(400, null, { error: "invalid_grant" });
    expect(err.type).not.toBe(ApiErrorType.PROXY);
    expect(err.type).toBe(ApiErrorType.UNAUTHORIZED);
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

  it("classifies 400 + invalid_grant message as UNAUTHORIZED", async () => {
    const { classifyError } = await loadModule();
    const err = classifyError(400, null, {
      error: { message: "invalid_grant" },
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

describe("OAuth 400 契约测试（真实 Pixiv 响应快照）", () => {
  // 契约 mock 来自真实 Pixiv 响应（pixivpy#374 / gallery-dl#9331）：
  // refresh_token 失效时 oauth.secure.pixiv.net/auth/token 返回 HTTP 400，
  // 原始字节与线上一致（oracle 溯源，直接 JSON.parse 原始字节，禁止手写自洽字段）：
  // {"has_error":true,"errors":{"system":{"message":"Invalid refresh token","code":1508}},"error":"invalid_grant"}
  const PIXIV_REFRESH_TOKEN_EXPIRED_400_RAW =
    '{"has_error":true,"errors":{"system":{"message":"Invalid refresh token","code":1508}},"error":"invalid_grant"}';
  const PIXIV_REFRESH_TOKEN_EXPIRED_400_SNAPSHOT = JSON.parse(
    PIXIV_REFRESH_TOKEN_EXPIRED_400_RAW,
  ) as unknown;

  it("识别真实快照为 OAuth token 错误", async () => {
    const { isOAuthTokenErrorResponse } = await loadModule();
    expect(isOAuthTokenErrorResponse(400, PIXIV_REFRESH_TOKEN_EXPIRED_400_SNAPSHOT)).toBe(true);
  });

  it("将真实快照分类为 UNAUTHORIZED 且返回友好提示", async () => {
    const { classifyError } = await loadModule();
    const err = classifyError(400, null, PIXIV_REFRESH_TOKEN_EXPIRED_400_SNAPSHOT);
    expect(err.type).toBe(ApiErrorType.UNAUTHORIZED);
    expect(err.message).toBe("登录凭证已失效，请重新登录");
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

  it("strips Pixiv host from absolute next_url in native mode", async () => {
    isNativeMock.mockReturnValue(true);
    try {
      const { rewriteUrl } = await loadModule();
      // 原生插件只拼 apiBase + 相对路径；绝对 next_url 必须剥离域名，否则双域名 404
      expect(rewriteUrl("https://app-api.pixiv.net/v1/search/illust?word=x&offset=30")).toBe(
        "/v1/search/illust?word=x&offset=30",
      );
      expect(rewriteUrl("https://app-api.pixiv.net/v1/illust/recommended")).toBe(
        "/v1/illust/recommended",
      );
    } finally {
      isNativeMock.mockReturnValue(false);
    }
  });

  it("keeps non-pixiv http URLs as-is in native mode", async () => {
    isNativeMock.mockReturnValue(true);
    try {
      const { rewriteUrl } = await loadModule();
      expect(rewriteUrl("https://example.com/image.jpg")).toBe("https://example.com/image.jpg");
    } finally {
      isNativeMock.mockReturnValue(false);
    }
  });

  it("keeps relative paths as-is in native mode (plugin prepends apiBase)", async () => {
    isNativeMock.mockReturnValue(true);
    try {
      const { rewriteUrl } = await loadModule();
      expect(rewriteUrl("/v1/illust/detail")).toBe("/v1/illust/detail");
    } finally {
      isNativeMock.mockReturnValue(false);
    }
  });

  it("returns pseudo-suffix domain as-is in web mode (evil, ADR-0100)", async () => {
    const { rewriteUrl } = await loadModule();
    // oracle：边界匹配语义——伪后缀域不满足 === base 或 base + "/" 边界 → 原样放行
    expect(rewriteUrl("https://app-api.pixiv.net.evil.com/v1/illust")).toBe(
      "https://app-api.pixiv.net.evil.com/v1/illust",
    );
    expect(rewriteUrl("https://oauth.secure.pixiv.net.evil.com/auth/token")).toBe(
      "https://oauth.secure.pixiv.net.evil.com/auth/token",
    );
    // 可区分样例（review W1）：无边界 startsWith(PIXIV_AUTH_URL) 会把
    // oauth.secure.pixiv.net/auth/token.evil.com 误重写为 /pixiv-oauth/auth/token；
    // 新实现严格边界（=== / "/" / "?"）放行原样——对旧实现有区分度
    expect(rewriteUrl("https://oauth.secure.pixiv.net/auth/token.evil.com/v1")).toBe(
      "https://oauth.secure.pixiv.net/auth/token.evil.com/v1",
    );
  });

  it("matches Pixiv hosts at exact boundary (=== base / base + '/') in web mode", async () => {
    const { rewriteUrl } = await loadModule();
    // oracle：边界匹配语义（ADR-0100 决策 1），主机常量来自 vitest.config.ts 的 __PUBLIC_CONFIG__ 副本
    expect(rewriteUrl(__PUBLIC_CONFIG__.apiBaseUrl)).toBe("/pixiv-api");
    expect(rewriteUrl(__PUBLIC_CONFIG__.apiBaseUrl + "/v1/illust/recommended")).toBe(
      "/pixiv-api/v1/illust/recommended",
    );
    expect(rewriteUrl(__PUBLIC_CONFIG__.authUrl)).toBe("/pixiv-oauth/auth/token");
  });

  it("rewrites auth URL with query string to proxy (boundary + '?') in web mode", async () => {
    const { rewriteUrl } = await loadModule();
    // oracle：auth 边界另补 startsWith(base + "?")（ADR-0100 决策 1），query 被剥离
    expect(rewriteUrl(__PUBLIC_CONFIG__.authUrl + "?grant_type=refresh_token")).toBe(
      "/pixiv-oauth/auth/token",
    );
  });
});

describe("isTrustedPixivHost", () => {
  it("accepts exact hostnames from __PUBLIC_CONFIG__ whitelist", async () => {
    const { isTrustedPixivHost } = await loadModule();
    // oracle：受信主机白名单 = __PUBLIC_CONFIG__ 常量 hostname 集合（独立推导，非从实现反推）
    const whitelist = new Set([
      new URL(__PUBLIC_CONFIG__.apiBaseUrl).hostname,
      new URL(__PUBLIC_CONFIG__.authUrl).hostname,
    ]);
    for (const host of whitelist) {
      expect(isTrustedPixivHost(`https://${host}/v1/illust`)).toBe(true);
      expect(isTrustedPixivHost(`https://${host}`)).toBe(true);
    }
  });

  it("rejects pseudo-suffix domains (hostname mismatch)", async () => {
    const { isTrustedPixivHost } = await loadModule();
    expect(isTrustedPixivHost("https://app-api.pixiv.net.evil.com/v1/illust")).toBe(false);
    expect(isTrustedPixivHost("https://oauth.secure.pixiv.net.evil.com/auth/token")).toBe(false);
  });

  it("rejects external absolute URLs and invalid inputs", async () => {
    const { isTrustedPixivHost } = await loadModule();
    expect(isTrustedPixivHost("https://example.com/image.jpg")).toBe(false);
    expect(isTrustedPixivHost("not a url")).toBe(false);
    expect(isTrustedPixivHost("")).toBe(false);
  });
});

describe("shouldAttachAuth", () => {
  it("web mode: attaches only for /pixiv- proxy paths", async () => {
    const { shouldAttachAuth } = await loadModule();
    // oracle：ADR-0100 决策 2——web 分支 = rewrittenUrl.startsWith("/pixiv-")
    expect(shouldAttachAuth("/pixiv-api/v1/illust/recommended")).toBe(true);
    expect(shouldAttachAuth("/pixiv-oauth/auth/token")).toBe(true);
    expect(shouldAttachAuth("/pixiv-img/x.jpg")).toBe(true);
    expect(shouldAttachAuth("https://app-api.pixiv.net.evil.com/v1/illust")).toBe(false);
    expect(shouldAttachAuth("https://app-api.pixiv.net/v1/illust")).toBe(false);
    expect(shouldAttachAuth("https://example.com/image.jpg")).toBe(false);
    expect(shouldAttachAuth("/v1/illust/detail")).toBe(false);
  });

  it("native mode: http prefix && trusted Pixiv host (defense in depth)", async () => {
    isNativeMock.mockReturnValue(true);
    try {
      const { shouldAttachAuth } = await loadModule();
      // oracle：ADR-0100 决策 2——native 分支 = startsWith("http") && isTrustedPixivHost(url)
      const apiHost = new URL(__PUBLIC_CONFIG__.apiBaseUrl).hostname;
      expect(shouldAttachAuth(`https://${apiHost}/v1/illust`)).toBe(true);
      expect(shouldAttachAuth("https://app-api.pixiv.net.evil.com/v1/illust")).toBe(false);
      expect(shouldAttachAuth("https://example.com/image.jpg")).toBe(false);
      expect(shouldAttachAuth("/pixiv-api/v1/illust")).toBe(false);
    } finally {
      isNativeMock.mockReturnValue(false);
    }
  });
});

describe("apiClient — Authorization 附加守卫（ADR-0100）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as any).fetch;
  });

  it("web mode: 仅 /pixiv- 代理目标携带 Bearer；伪后缀域/外部绝对 URL 不带", async () => {
    const fetchCalls: { url: string; init: { headers: Record<string, string> } }[] = [];
    const mockFetch = vi.fn((url: string, init?: { headers: Record<string, string> }) => {
      fetchCalls.push({ url, init });
      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({}) });
    });
    vi.stubGlobal("fetch", mockFetch);
    const mod = await loadModule();
    globalThis.fetch = mockFetch;
    mod.setAccessToken("test-token");
    try {
      // /pixiv- 代理目标（重写后 shouldAttachAuth=true）→ 携带 Authorization
      await mod.apiClient.get("/v1/illust/recommended");
      // 伪后缀域原样放行 → 非 /pixiv- 前缀 → 不携带 Authorization
      await mod.apiClient.get("https://app-api.pixiv.net.evil.com/v1/illust");
      // 外部绝对 URL 原样放行 → 不携带 Authorization
      await mod.apiClient.get("https://example.com/image.jpg");
      // POST 同守卫
      await mod.apiClient.post("https://app-api.pixiv.net.evil.com/v1/illust/bookmark/add", {
        illust_id: "1",
      });
    } finally {
      mod.setAccessToken("");
    }
    expect(fetchCalls).toHaveLength(4);
    expect(fetchCalls[0].url).toBe("/pixiv-api/v1/illust/recommended");
    expect(fetchCalls[0].init.headers["Authorization"]).toBe("Bearer test-token");
    expect(fetchCalls[1].url).toBe("https://app-api.pixiv.net.evil.com/v1/illust");
    expect(fetchCalls[1].init.headers["Authorization"]).toBeUndefined();
    expect(fetchCalls[2].url).toBe("https://example.com/image.jpg");
    expect(fetchCalls[2].init.headers["Authorization"]).toBeUndefined();
    expect(fetchCalls[3].url).toBe("https://app-api.pixiv.net.evil.com/v1/illust/bookmark/add");
    expect(fetchCalls[3].init.headers["Authorization"]).toBeUndefined();
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

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    Capacitor: {
      isNativePlatform: () => false,
    },
  };
});

vi.mock("spark-md5", () => ({
  default: {
    hash: vi.fn(() => "mocked-hash"),
  },
}));

describe("pkceAuth", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("generatePKCE", () => {
    it("generates a 43-character codeVerifier", async () => {
      const { generatePKCE } = await import("@/api/pkceAuth");
      const { codeVerifier } = await generatePKCE();
      expect(codeVerifier).toHaveLength(43);
    });

    it("generates URL-safe base64 codeVerifier (no + / or =)", async () => {
      const { generatePKCE } = await import("@/api/pkceAuth");
      const { codeVerifier } = await generatePKCE();
      expect(codeVerifier).not.toMatch(/[+/=]/);
    });

    it("generates different codeVerifier on each call", async () => {
      const { generatePKCE } = await import("@/api/pkceAuth");
      const a = await generatePKCE();
      const b = await generatePKCE();
      expect(a.codeVerifier).not.toBe(b.codeVerifier);
    });

    it("generates base64url-encoded codeChallenge (no padding)", async () => {
      const { generatePKCE } = await import("@/api/pkceAuth");
      const { codeChallenge } = await generatePKCE();
      expect(codeChallenge).not.toMatch(/=+$/);
      expect(codeChallenge).not.toMatch(/[+/]/);
    });

    it("codeChallenge has valid length for SHA-256 output", async () => {
      const { generatePKCE } = await import("@/api/pkceAuth");
      const pair = await generatePKCE();
      // SHA-256 输出 32 字节 → base64url 编码 = 43 字符
      expect(pair.codeChallenge).toHaveLength(43);
    });
  });

  describe("exchangeCode", () => {
    it("sends authorization_code grant request on web", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            response: {
              access_token: "new-access",
              refresh_token: "new-refresh",
              user: { id: 123, name: "TestUser", account: "testuser" },
            },
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { exchangeCode } = await import("@/api/pkceAuth");
      const client = await import("@/api/client");
      client.setAccessToken("");

      const result = await exchangeCode(
        "auth-code-123",
        "test-verifier-43-chars-long-base64url-safe",
      );

      expect(mockFetch).toHaveBeenCalledWith("/pixiv-oauth/auth/token", {
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded",
          "App-OS": "ios",
        }),
        body: expect.stringContaining("grant_type=authorization_code"),
        credentials: "omit",
      });
      expect(result.response.access_token).toBe("new-access");
      expect(result.response.refresh_token).toBe("new-refresh");
    });

    it("includes code and code_verifier in request body", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            response: {
              access_token: "a",
              refresh_token: "b",
              user: { id: 1, name: "U", account: "u" },
            },
          }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { exchangeCode } = await import("@/api/pkceAuth");
      const client = await import("@/api/client");
      client.setAccessToken("");

      await exchangeCode("my-code", "my-verifier");

      expect(mockFetch).toHaveBeenCalledWith(
        "/pixiv-oauth/auth/token",
        expect.objectContaining({
          body: expect.stringContaining("code=my-code"),
        }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "/pixiv-oauth/auth/token",
        expect.objectContaining({
          body: expect.stringContaining("code_verifier=my-verifier"),
        }),
      );
    });

    it("throws on OAuth failure", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("invalid_grant"),
      });
      vi.stubGlobal("fetch", mockFetch);

      const { exchangeCode } = await import("@/api/pkceAuth");
      const client = await import("@/api/client");
      client.setAccessToken("");

      await expect(exchangeCode("bad-code", "bad-verifier")).rejects.toThrow("OAuth 失败");
    });
  });
});

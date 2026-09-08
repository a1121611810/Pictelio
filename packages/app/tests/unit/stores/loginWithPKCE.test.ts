import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──

const mockSetAccessToken = vi.fn();
const mockSetOnUnauthorized = vi.fn();

vi.mock("@/api/client", () => ({
  setAccessToken: (...args: unknown[]) => mockSetAccessToken(...args),
  setOnUnauthorized: (...args: unknown[]) => mockSetOnUnauthorized(...args),
}));

const mockRefreshToken = vi.fn();
const mockExchangeCodeForToken = vi.fn();

vi.mock("@/api/auth", () => ({
  refreshToken: (...args: unknown[]) => mockRefreshToken(...args),
  exchangeCodeForToken: (...args: unknown[]) => mockExchangeCodeForToken(...args),
}));

let mockSecureGetResult: string | null = null;
const mockSecureSet = vi.fn();
const mockSecureRemove = vi.fn();

vi.mock("@/utils/secureStorage", () => ({
  restoreRefreshToken: vi.fn(() => Promise.resolve(mockSecureGetResult)),
  saveRefreshToken: (...args: unknown[]) => mockSecureSet(...args),
  clearRefreshToken: (...args: unknown[]) => mockSecureRemove(...args),
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })),
  },
}));

async function loadStore() {
  vi.resetModules();
  return import("@/stores/authStore");
}

describe("authStore loginWithPKCE", () => {
  beforeEach(() => {
    mockExchangeCodeForToken.mockReset();
    mockSecureGetResult = null;
  });

  it("logs in with valid authorization code and verifier", async () => {
    mockExchangeCodeForToken.mockResolvedValue({
      access_token: "pkce-access",
      refresh_token: "pkce-refresh",
      user: { id: 42, name: "PKCEUser", account: "pkcu" },
    });

    const { loginWithPKCE, isLoggedIn, user } = await loadStore();
    await loginWithPKCE("auth-code", "verifier-123");

    expect(isLoggedIn()).toBe(true);
    expect(user()?.id).toBe(42);
    expect(mockExchangeCodeForToken).toHaveBeenCalledWith("auth-code", "verifier-123");
    expect(mockSetAccessToken).toHaveBeenCalledWith("pkce-access");
    expect(mockSecureSet).toHaveBeenCalled();
    expect(mockSetOnUnauthorized).toHaveBeenCalled();
  });

  it("throws on exchange failure", async () => {
    mockExchangeCodeForToken.mockRejectedValue(new Error("OAuth error"));

    const { loginWithPKCE } = await loadStore();
    await expect(loginWithPKCE("bad-code", "bad-verifier")).rejects.toThrow("OAuth error");
  });
});

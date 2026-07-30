import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ──

const mockSetAccessToken = vi.fn();
const mockSetOnUnauthorized = vi.fn();

vi.mock("@/api/client", () => ({
  setAccessToken: (...args: unknown[]) => mockSetAccessToken(...args),
  setOnUnauthorized: (...args: unknown[]) => mockSetOnUnauthorized(...args),
  setRefreshPromise: vi.fn(),
  setTokenReadyPromise: vi.fn(),
  setAuthPermanentFailure: vi.fn(),
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
let mockPrefToken: string | null = null;

vi.mock("@/utils/secureStorage", () => ({
  getRefreshToken: vi.fn(() => Promise.resolve(mockSecureGetResult)),
  setRefreshToken: (...args: unknown[]) => mockSecureSet(...args),
  removeRefreshToken: (...args: unknown[]) => mockSecureRemove(...args),
  migrateRefreshTokenFromPreferences: vi.fn(() => Promise.resolve(mockPrefToken)),
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

describe("authStore", () => {
  beforeEach(() => {
    mockSecureGetResult = null;
    mockPrefToken = null;
  });

  describe("initial state", () => {
    it("starts logged out with no user", async () => {
      const { isLoggedIn, user, isLoading } = await loadStore();
      expect(isLoggedIn()).toBe(false);
      expect(user()).toBeNull();
      expect(isLoading()).toBe(true);
    });
  });

  describe("initializeAuth", () => {
    it("no token found: stays logged out (loading state managed by RootLayout)", async () => {
      const { initializeAuth, isLoading, isLoggedIn } = await loadStore();
      await initializeAuth();
      expect(isLoading()).toBe(true);
      expect(isLoggedIn()).toBe(false);
    });

    it("token from secure storage: performs refresh and logs in", async () => {
      mockSecureGetResult = "valid-refresh-token";
      mockRefreshToken.mockResolvedValue({
        access_token: "new-access",
        refresh_token: "new-refresh",
        user: { id: 1, name: "Test", account: "test" },
      });

      const { initializeAuth, isLoading, isLoggedIn, user } = await loadStore();
      await initializeAuth();

      expect(isLoading()).toBe(true);
      expect(isLoggedIn()).toBe(true);
      expect(user()?.id).toBe(1);
      expect(mockRefreshToken).toHaveBeenCalledWith("valid-refresh-token");
      expect(mockSetAccessToken).toHaveBeenCalledWith("new-access");
      expect(mockSetOnUnauthorized).toHaveBeenCalled();
    });

    it("两次调用等待同一操作，都正确完成", async () => {
      mockSecureGetResult = "valid-refresh-token";
      let resolveOAuth: (v: unknown) => void;
      const oauthPromise = new Promise((r) => { resolveOAuth = r; });
      mockRefreshToken.mockReturnValue(oauthPromise);

      const { initializeAuth, isLoggedIn } = await loadStore();

      // 模拟 main.tsx 的 void initializeAuth()（不 await）
      const promise1 = initializeAuth();
      // 模拟 __root.tsx 的 await initializeAuth()
      const promise2 = initializeAuth();

      // 两个 Promise 都还在 pending（OAuth 未返回）
      // 如果它们共享同一个异步操作，两者都应 resolve
      resolveOAuth!({
        access_token: "new-access",
        refresh_token: "new-refresh",
        user: { id: 1, name: "Test", account: "test" },
      });

      await promise1;
      await promise2;
      expect(isLoggedIn()).toBe(true);
    });

    it("loginWithToken 重置 Promise 链", async () => {
      mockSecureGetResult = "stale-token";
      mockRefreshToken.mockResolvedValue({
        access_token: "stale-access",
        refresh_token: "stale-refresh",
        user: { id: 9, name: "Stale", account: "st" },
      });

      const { initializeAuth, loginWithToken, isLoggedIn } = await loadStore();

      // 先触发一次 initializeAuth（后台运行中）
      const oldPromise = initializeAuth();

      // 用户主动登录
      mockRefreshToken.mockResolvedValue({
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
        user: { id: 10, name: "Fresh", account: "fr" },
      });
      await loginWithToken("active-login-token");

      expect(isLoggedIn()).toBe(true);

      // 之后 initializeAuth 应使用新 Promise（不与旧 Promise 相同）
      const newPromise = initializeAuth();
      expect(newPromise).not.toBe(oldPromise);
    });

    it("loginWithPKCE 重置 Promise 链", async () => {
      mockSecureGetResult = null; // 没有 token，避免 initializeAuth 启动 OAuth
      mockExchangeCodeForToken.mockResolvedValue({
        access_token: "pkce-access",
        refresh_token: "pkce-refresh",
        user: { id: 20, name: "PKCEUser", account: "pk" },
      });

      const { initializeAuth, loginWithPKCE, isLoggedIn } = await loadStore();

      // 安全确认：initializeAuth 不会启动后台刷新（无 token）
      const oldPromise = initializeAuth();

      await loginWithPKCE("auth-code", "verifier-123");

      expect(isLoggedIn()).toBe(true);

      // 之后 initializeAuth 应使用新 Promise（不与旧 Promise 相同）
      const newPromise = initializeAuth();
      expect(newPromise).not.toBe(oldPromise);
    });

    it("refresh fails: logs out", async () => {
      mockSecureGetResult = "expired-token";
      mockRefreshToken.mockRejectedValue(
        new Error("OAuth 失败 (HTTP 400): {\"error\":{\"message\":\"invalid_grant\"}}"),
      );

      const { initializeAuth, isLoading, isLoggedIn, user } = await loadStore();
      await initializeAuth();

      expect(isLoading()).toBe(true);
      expect(isLoggedIn()).toBe(false);
      expect(user()).toBeNull();
      expect(mockSecureRemove).toHaveBeenCalled();
    });

    it("OAuth 400（永久失效）：删除 token", async () => {
      mockSecureGetResult = "oauth-expired-token";
      mockRefreshToken.mockRejectedValue(
        new Error("OAuth 失败 (HTTP 400): {\"error\":{\"message\":\"invalid_grant\"}}"),
      );

      const { initializeAuth, isLoading, isLoggedIn } = await loadStore();
      await initializeAuth();

      expect(isLoading()).toBe(true);
      expect(isLoggedIn()).toBe(false);
      // OAuth 400 → 永久失效 → logout → 删除 token
      expect(mockSecureRemove).toHaveBeenCalled();
    });

    it("TypeError（网络超时）：保留 token", async () => {
      mockSecureGetResult = "network-flaky-token";
      mockRefreshToken.mockRejectedValue(new TypeError("Failed to fetch"));

      const { initializeAuth, isLoading, isLoggedIn } = await loadStore();
      await initializeAuth();

      expect(isLoading()).toBe(true);
      expect(isLoggedIn()).toBe(false);
      // 网络错误 → 临时故障 → 不清除 token
      expect(mockSecureRemove).not.toHaveBeenCalled();
    });

    it("migrates token from Preferences if secure storage is empty", async () => {
      mockSecureGetResult = null;
      mockPrefToken = "migrated-token";
      mockRefreshToken.mockResolvedValue({
        access_token: "migrated-access",
        refresh_token: "migrated-refresh",
        user: { id: 2, name: "Migrated", account: "mig" },
      });

      const { initializeAuth, isLoading, isLoggedIn, user } = await loadStore();
      await initializeAuth();

      expect(isLoading()).toBe(true);
      expect(isLoggedIn()).toBe(true);
      expect(user()?.id).toBe(2);
      expect(mockRefreshToken).toHaveBeenCalledWith("migrated-token");
    });
  });

  describe("loginWithToken", () => {
    it("logs in with a valid refresh token", async () => {
      mockRefreshToken.mockResolvedValue({
        access_token: "login-access",
        refresh_token: "login-refresh",
        user: { id: 10, name: "LoginUser", account: "lu" },
      });

      const { loginWithToken, isLoggedIn, user } = await loadStore();
      await loginWithToken("login-token");

      expect(isLoggedIn()).toBe(true);
      expect(user()?.id).toBe(10);
      expect(mockRefreshToken).toHaveBeenCalledWith("login-token");
      expect(mockSetAccessToken).toHaveBeenCalledWith("login-access");
      expect(mockSecureSet).toHaveBeenCalled();
      expect(mockSetOnUnauthorized).toHaveBeenCalled();
    });

    it("throws on failure", async () => {
      mockRefreshToken.mockRejectedValue(new Error("OAuth error"));

      const { loginWithToken } = await loadStore();
      await expect(loginWithToken("bad-token")).rejects.toThrow("OAuth error");
    });
  });

  describe("logout", () => {
    it("clears all auth state", async () => {
      mockSecureGetResult = "some-token";
      mockRefreshToken.mockResolvedValue({
        access_token: "acc",
        refresh_token: "ref",
        user: { id: 5, name: "U", account: "u" },
      });

      const store = await loadStore();
      await store.initializeAuth();

      expect(store.isLoggedIn()).toBe(true);

      await store.logout();

      expect(store.isLoggedIn()).toBe(false);
      expect(store.user()).toBeNull();
      expect(store.accessTokenSig()).toBe("");
      expect(store.refreshTokenSig()).toBeNull();
      expect(mockSecureRemove).toHaveBeenCalled();
    });
  });
});

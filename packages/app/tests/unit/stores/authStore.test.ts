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

    it("refresh fails: logs out", async () => {
      mockSecureGetResult = "expired-token";
      mockRefreshToken.mockRejectedValue(new Error("invalid_grant"));

      const { initializeAuth, isLoading, isLoggedIn, user } = await loadStore();
      await initializeAuth();

      expect(isLoading()).toBe(true);
      expect(isLoggedIn()).toBe(false);
      expect(user()).toBeNull();
      expect(mockSecureRemove).toHaveBeenCalled();
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

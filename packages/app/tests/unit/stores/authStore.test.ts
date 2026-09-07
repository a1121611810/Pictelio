import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ──

const mockSetAccessToken = vi.fn();
const mockSetOnUnauthorized = vi.fn();
const mockSetAuthPermanentFailure = vi.fn();

vi.mock("@/api/client", () => ({
  setAccessToken: (...args: unknown[]) => mockSetAccessToken(...args),
  setOnUnauthorized: (...args: unknown[]) => mockSetOnUnauthorized(...args),
  setRefreshPromise: vi.fn(),
  setTokenReadyPromise: vi.fn(),
  setAuthPermanentFailure: (...args: unknown[]) => mockSetAuthPermanentFailure(...args),
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

// ── Mock App（前台恢复预刷新：捕获 appStateChange 回调供用例触发） ──
let mockAppStateChange: ((state: { isActive: boolean }) => void) | null = null;

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn((_event: string, callback: (state: { isActive: boolean }) => void) => {
      mockAppStateChange = callback;
      return Promise.resolve({ remove: vi.fn() });
    }),
  },
}));

// ── Mock Native bridge（轮换监听） ──
const mockRotationListener = { remove: vi.fn() };
let mockRotationCallback: ((data: { token: string }) => void) | null = null;

vi.mock("@/native/PixivApi", () => ({
  PixivApi: {
    addListener: vi.fn((_event: string, callback: (data: { token: string }) => void) => {
      mockRotationCallback = callback;
      return Promise.resolve(mockRotationListener);
    }),
  },
}));

// S2：logout 必须经 clearPersistedFeedsAndCache 原子清空（抑制订阅写回 + 删持久化 + 清内存），
// mock 掉真实实现以断言调用契约（防回退成手写「clearPersistedFeeds + clear」两步复活空 payload）
const mockClearPersistedFeedsAndCache = vi.fn();
vi.mock("@/api/feedQueryPersist", () => ({
  clearPersistedFeedsAndCache: (...args: unknown[]) => mockClearPersistedFeedsAndCache(...args),
}));

async function loadStore() {
  vi.resetModules();
  return import("@/stores/authStore");
}

describe("authStore", () => {
  beforeEach(() => {
    mockSecureGetResult = null;
    mockAppStateChange = null;
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
      // 乐观登录：路由放行不等待刷新；user 由后台刷新异步就位（spec #393）
      expect(isLoggedIn()).toBe(true);
      await vi.waitFor(() => expect(user()?.id).toBe(1));
      expect(mockRefreshToken).toHaveBeenCalledWith("valid-refresh-token");
      expect(mockSetAccessToken).toHaveBeenCalledWith("new-access");
      expect(mockSetOnUnauthorized).toHaveBeenCalled();
    });

    it("乐观登录：刷新完成前 isLoggedIn 即为 true（启动不被网络阻塞）", async () => {
      mockSecureGetResult = "valid-refresh-token";
      // 永不 resolve 的刷新 = 模拟直连抖动/弱网窗口（spec #393）
      mockRefreshToken.mockReturnValue(new Promise(() => {}));

      const { initializeAuth, isLoggedIn } = await loadStore();
      await initializeAuth();

      expect(isLoggedIn()).toBe(true);
      expect(mockSecureRemove).not.toHaveBeenCalled();
    });

    it("两次调用等待同一操作，都正确完成", async () => {
      mockSecureGetResult = "valid-refresh-token";
      let resolveOAuth: (v: unknown) => void;
      const oauthPromise = new Promise((r) => {
        resolveOAuth = r;
      });
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

    it("OAuth 400 永久失效：乐观登录后被后台刷新登出并删除 token", async () => {
      // oracle：invalid_grant 载荷 = 跨端 OAuth reject 契约的真实样例（_oauthFetch /
      // AuthPlugin oauthRejectMessage 的 "OAuth failed (HTTP 400): <body>" 抛错形态）
      mockSecureGetResult = "oauth-expired-token";
      mockRefreshToken.mockRejectedValue(
        new Error('OAuth 失败 (HTTP 400): {"error":{"message":"invalid_grant"}}'),
      );

      const { initializeAuth, isLoading, isLoggedIn, user, refreshTokenSig } = await loadStore();
      await initializeAuth();

      expect(isLoading()).toBe(true);
      // 乐观登录先置 true，后台刷新判定永久失效 → logout 收敛为 false（spec #393）
      await vi.waitFor(() => expect(isLoggedIn()).toBe(false));
      expect(user()).toBeNull();
      // logout 全套清理的强断言：内存 refresh_token 也被清（区分"logout 清理"与"从未置位"）
      expect(refreshTokenSig()).toBeNull();
      expect(mockSecureRemove).toHaveBeenCalled();
    });

    it("TypeError（网络超时）：保持登录态且保留 token", async () => {
      // spec #393：瞬时失败仅告警——登录态保持（乐观登录不被回滚）、
      // 持久化凭证不清、会话阻断标志不置位，待前台恢复预刷新自愈
      mockSecureGetResult = "network-flaky-token";
      mockRefreshToken.mockRejectedValue(new TypeError("Failed to fetch"));

      const { initializeAuth, isLoading, isLoggedIn } = await loadStore();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await initializeAuth();

      expect(isLoading()).toBe(true);
      expect(isLoggedIn()).toBe(true);
      // 宏任务切一次：等后台刷新的失败分类落地后再断言（瞬时失败不收敛登录态）
      await new Promise((r) => setTimeout(r, 0));
      expect(isLoggedIn()).toBe(true);
      expect(mockSecureRemove).not.toHaveBeenCalled();
      expect(mockSetAuthPermanentFailure).not.toHaveBeenCalled();
      // 「仅告警"是瞬时路径唯一的外部行为，必须可观测（禁静默降级，spec #393）
      expect(warnSpy).toHaveBeenCalledWith(
        "[authStore] token 刷新瞬时失败（保持登录态，网络恢复后自愈）",
        expect.any(TypeError),
      );
      warnSpy.mockRestore();
    });

    it("瞬时失败后前台恢复预刷新自愈（登录态保持，user 就位）", async () => {
      mockSecureGetResult = "self-heal-token";
      mockRefreshToken.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      const { initializeAuth, isLoggedIn, user } = await loadStore();
      await initializeAuth();
      await new Promise((r) => setTimeout(r, 0));
      expect(isLoggedIn()).toBe(true);

      // 网络恢复：前台恢复事件触发预判性刷新成功（lastRefreshTime 未被瞬时失败推进）
      mockRefreshToken.mockResolvedValue({
        access_token: "healed-access",
        refresh_token: "healed-refresh",
        user: { id: 7, name: "Heal", account: "heal" },
      });
      mockAppStateChange?.({ isActive: true });

      await vi.waitFor(() => expect(user()?.id).toBe(7));
      expect(isLoggedIn()).toBe(true);
      expect(mockSecureRemove).not.toHaveBeenCalled();
    });

    it("世代守卫：logout 后迟到的后台刷新成功被丢弃（不复活登录态不落盘凭证）", async () => {
      // spec #393 P1 竞态防线：乐观登录后启动刷新 in-flight，用户此刻登出——
      // 迟到的成功回调若不按世代丢弃，会复活登录态并把刚删的凭证写回 secureStorage
      mockSecureGetResult = "stale-session-token";
      let resolveRefresh!: (v: unknown) => void;
      mockRefreshToken.mockReturnValue(new Promise((r) => (resolveRefresh = r)));

      const store = await loadStore();
      await store.initializeAuth();
      expect(store.isLoggedIn()).toBe(true);

      await store.logout();
      expect(store.isLoggedIn()).toBe(false);

      resolveRefresh!({
        access_token: "stale-access",
        refresh_token: "stale-refresh",
        user: { id: 9, name: "Stale", account: "stale" },
      });
      await new Promise((r) => setTimeout(r, 0));

      expect(store.isLoggedIn()).toBe(false);
      expect(store.refreshTokenSig()).toBeNull();
      expect(store.user()).toBeNull();
      expect(mockSecureSet).not.toHaveBeenCalledWith("stale-refresh");
    });

    it("重登复位会话阻断标志：logout 后 loginWithToken 解除 authPermanentFailure", async () => {
      // spec #393 P2：authPermanentFailure 置位后无任何重置点（logout→重登请求全部快速失败）
      const store = await loadStore();
      await store.logout();
      expect(mockSetAuthPermanentFailure).toHaveBeenCalledWith(true);

      mockRefreshToken.mockResolvedValue({
        access_token: "relogin-access",
        refresh_token: "relogin-refresh",
        user: { id: 3, name: "Re", account: "re" },
      });
      await store.loginWithToken("fresh-token");

      expect(mockSetAuthPermanentFailure).toHaveBeenCalledWith(false);
      expect(store.isLoggedIn()).toBe(true);
    });

    it("世代复检：save 期间 logout → 磁盘补清（防迟到写回复活）", async () => {
      // saveRefreshToken 挂起期间登出——apply 前守卫已过（世代当时有效），
      // 复检分支必须补清磁盘（P1 磁盘写回复活防线的直接覆盖）
      mockSecureGetResult = "recheck-token";
      let resolveSave!: () => void;
      mockSecureSet.mockReturnValue(new Promise((r) => (resolveSave = r)));
      mockRefreshToken.mockResolvedValue({
        access_token: "recheck-access",
        refresh_token: "recheck-refresh",
        user: { id: 8, name: "Recheck", account: "rc" },
      });

      const store = await loadStore();
      await store.initializeAuth(); // 后台刷新卡在 saveRefreshToken 的 await

      await store.logout(); // save 挂起期间登出（世代 +1，清一次磁盘）
      resolveSave(); // 迟到的 save 完成 → 进入世代复检分支

      await new Promise((r) => setTimeout(r, 0));
      // logout 清一次 + 复检补清一次；当前无会话（refreshTokenSig null）→ 必须补清
      expect(mockSecureRemove).toHaveBeenCalledTimes(2);
      expect(store.isLoggedIn()).toBe(false);
    });

    it("世代复检：save 期间已重登新会话 → 不误清新会话凭证", async () => {
      // 极窄误伤边界：stale save 滞缓期间 logout→重登，复检不得清掉新会话凭证
      mockSecureGetResult = "recheck-token";
      let resolveSave!: () => void;
      mockSecureSet.mockReturnValue(new Promise((r) => (resolveSave = r)));
      mockRefreshToken.mockResolvedValue({
        access_token: "recheck-access",
        refresh_token: "recheck-refresh",
        user: { id: 8, name: "Recheck", account: "rc" },
      });

      const store = await loadStore();
      await store.initializeAuth();

      await store.logout(); // save 挂起期间登出
      // 新会话自身的落盘不再挂起（旧 deferred 仅服务迟到的 stale save）
      mockSecureSet.mockResolvedValue(undefined);
      mockRefreshToken.mockResolvedValue({
        access_token: "new-session-access",
        refresh_token: "new-session-refresh",
        user: { id: 4, name: "New", account: "new" },
      });
      await store.loginWithToken("new-session-token"); // 已重登，refreshTokenSig 非空
      resolveSave(); // 迟到的 save 完成 → 复检见新会话在位 → 跳过补清

      await new Promise((r) => setTimeout(r, 0));
      // 仅 logout 清过一次；新会话的磁盘凭证不得被迟到复检误清
      expect(mockSecureRemove).toHaveBeenCalledTimes(1);
      expect(store.refreshTokenSig()).toBe("new-session-refresh");
      expect(store.isLoggedIn()).toBe(true);
    });

    it("restores login from legacy token (restoreRefreshToken 已迁移旧 Preferences token)", async () => {
      // 旧版 Preferences 迁移在 restoreRefreshToken 内部完成（secureStorage 层测试覆盖），
      // 此处模拟 restore 返回迁移后的 token
      mockSecureGetResult = "migrated-token";
      mockRefreshToken.mockResolvedValue({
        access_token: "migrated-access",
        refresh_token: "migrated-refresh",
        user: { id: 2, name: "Migrated", account: "mig" },
      });

      const { initializeAuth, isLoading, isLoggedIn, user } = await loadStore();
      await initializeAuth();

      expect(isLoading()).toBe(true);
      expect(isLoggedIn()).toBe(true);
      await vi.waitFor(() => expect(user()?.id).toBe(2));
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
      expect(mockRotationListener.remove).toHaveBeenCalled();
      // S2 防线：必须走原子清空封装（内部含 queryClient.clear），不得回退成两步手写
      expect(mockClearPersistedFeedsAndCache).toHaveBeenCalledTimes(1);
    });

    it("Java 401 轮换事件 → 持久化新 token 并更新内存", async () => {
      mockSecureGetResult = "valid-refresh-token";
      mockRefreshToken.mockResolvedValue({
        access_token: "acc",
        refresh_token: "ref",
        user: { id: 5, name: "U", account: "u" },
      });

      const store = await loadStore();
      await store.initializeAuth();
      expect(mockRotationCallback).not.toBeNull();

      // 模拟 Java 401 静默刷新发现 token 被轮换
      mockRotationCallback?.({ token: "rotated-token" });

      expect(store.refreshTokenSig()).toBe("rotated-token");
      expect(mockSecureSet).toHaveBeenCalledWith("rotated-token");
    });
  });
});

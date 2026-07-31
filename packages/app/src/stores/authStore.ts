import {
  setAccessToken,
  setOnUnauthorized,
  setRefreshPromise,
  setTokenReadyPromise,
  setAuthPermanentFailure,
} from "../api/client";
import { refreshToken, exchangeCodeForToken } from "../api/auth";
import type { PixivUser } from "../api/types";
import { restoreRefreshToken, saveRefreshToken, clearRefreshToken } from "../utils/secureStorage";
import { App } from "@capacitor/app";
import { queryClient } from "../api/queryClient";
import { PixivApi } from "@/native/PixivApi";
import { tryAsync } from "@/utils/tryAsync";

const [accessTokenSig, setAccessTokenSig] = createSignal<string | null>(null);
const [refreshTokenSig, setRefreshTokenSig] = createSignal<string | null>(null);
const [user, setUser] = createSignal<PixivUser | null>(null);
const [isLoggedIn, setIsLoggedIn] = createSignal(false);
const [isLoading, setIsLoading] = createSignal(true);

/** 上次 token 刷新的时间戳 */
let lastRefreshTime = 0;
/** 预判性刷新阈值：前台恢复后距离上次刷新超过此值则预刷新（10 分钟） */
const PRE_REFRESH_THRESHOLD_MS = 10 * 60 * 1000;

export { isLoggedIn, user, isLoading, setIsLoading, accessTokenSig, refreshTokenSig };

function syncToken(token: string) {
  setAccessTokenSig(token);
  setAccessToken(token);
}

/** 安装 onUnauthorized 处理器 + 前台恢复预刷新监听 */
let appStateListener: Awaited<ReturnType<typeof App.addListener>> | null = null;
/** Java 401 静默刷新轮换 refresh_token 的监听（Web 环境无插件，注册失败则跳过） */
let rotationListener: { remove: () => void } | null = null;

async function setupUnauthorizedHandler() {
  setOnUnauthorized(async () => {
    const latest = refreshTokenSig();
    if (latest) {
      await performRefresh(latest);
    } else {
      await logout();
    }
  });

  // Java 侧 401 静默刷新若发现 refresh_token 被轮换，通知 JS 持久化新值
  // （避免重启后从加密存储恢复旧 token，导致 Java 401 刷新持续失败）
  const [err, handle] = await tryAsync(
    PixivApi.addListener("refreshTokenRotated", ({ token }) => {
      if (token) {
        setRefreshTokenSig(token);
        void saveRefreshToken(token);
      }
    }),
  );
  if (!err && handle) {
    rotationListener = handle;
  }

  // 前台恢复时预判性刷新：如果距离上次刷新超过阈值，提前 refresh
  appStateListener = await App.addListener("appStateChange", ({ isActive }) => {
    if (isActive && refreshTokenSig() && Date.now() - lastRefreshTime > PRE_REFRESH_THRESHOLD_MS) {
      const latest = refreshTokenSig();
      if (latest) {
        performRefresh(latest);
      }
    }
  });
}

/** 防止 initializeAuth 被重复调用（startup 和 onMount 都可能触发） */
let _authPromise: Promise<void> | null = null;

export async function initializeAuth() {
  if (_authPromise) return _authPromise;
  _authPromise = (async () => {
    // restoreRefreshToken 内部完成：备份完整性检查（失效则清 token）→ 读取（含旧 Preferences 迁移）→ Native 注入
    let token = await restoreRefreshToken();
    if (token) {
      setRefreshTokenSig(token);
      await setupUnauthorizedHandler();
      // 设置 tokenReady barrier：在此 barrier resolve 之前所有 API 请求被阻塞在 client.ts 入口
      let resolveTokenReady: () => void;
      setTokenReadyPromise(
        new Promise((r) => {
          resolveTokenReady = r;
        }),
      );
      // 设置 refreshPromise，让并发请求在初始 token 刷新期间等待
      const promise = performRefresh(token).finally(() => {
        setRefreshPromise(null);
        resolveTokenReady?.();
      });
      setRefreshPromise(promise);
      await promise;
    }
  })();
  return _authPromise;
}

/** 清除内存中的认证状态，但不删除持久化的 refresh_token */
function clearAuthState() {
  appStateListener?.remove();
  appStateListener = null;
  setAuthPermanentFailure(true);
  setTokenReadyPromise(Promise.resolve());
  syncToken("");
  setRefreshTokenSig(null);
  setUser(null);
  setIsLoggedIn(false);
}

/**
 * 判断 OAuth 错误是否为永久性（token 已永久失效，不可恢复）。
 *
 * - TypeError：网络层错误（DNS、连接超时等），为临时故障
 * - OAuth HTTP 400-409 错误（invalid_grant / invalid_request等）：token 已过期/被撤销，为永久失效
 * - OAuth HTTP 429（请求过于频繁）被排除在外，为临时故障
 */
function isAuthErrorPermanent(err: unknown): boolean {
  if (err instanceof TypeError) return false;
  const msg =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err);
  return msg.includes("OAuth 失败 (HTTP 40") || msg.includes("OAuth failed (HTTP 40");
}

async function performRefresh(token: string) {
  const [err] = await tryAsync(
    refreshToken(token).then(async (resp) => {
      syncToken(resp.access_token);
      setRefreshTokenSig(resp.refresh_token);
      setUser(resp.user);
      setIsLoggedIn(true);
      lastRefreshTime = Date.now();
      await saveRefreshToken(resp.refresh_token);
    }),
  );
  if (err) {
    if (isAuthErrorPermanent(err)) {
      await logout();
    } else {
      // 临时故障（网络错误等）：只清内存状态，保留 token 供下次重试
      clearAuthState();
    }
  }
}

export async function loginWithToken(token: string) {
  _authPromise = null; // 主动登录重置 Promise 链
  const resp = await refreshToken(token);
  syncToken(resp.access_token);
  setRefreshTokenSig(resp.refresh_token);
  setUser(resp.user);
  setIsLoggedIn(true);
  await setupUnauthorizedHandler();
  await saveRefreshToken(resp.refresh_token);
  _authPromise = Promise.resolve();
}

/**
 * 使用 OAuth Authorization Code + PKCE 登录。
 *
 * @param code authorization_code（从浏览器/WebView 回调 URL 中提取）
 * @param codeVerifier PKCE code_verifier（生成 code_challenge 时保存的值）
 */
export async function loginWithPKCE(code: string, codeVerifier: string) {
  _authPromise = null; // 主动登录重置 Promise 链
  const resp = await exchangeCodeForToken(code, codeVerifier);
  syncToken(resp.access_token);
  setRefreshTokenSig(resp.refresh_token);
  setUser(resp.user);
  setIsLoggedIn(true);
  await setupUnauthorizedHandler();
  await saveRefreshToken(resp.refresh_token);
  _authPromise = Promise.resolve();
}

export async function logout() {
  // 设置永久失效标记，阻塞后续所有 API 请求
  setAuthPermanentFailure(true);
  setTokenReadyPromise(Promise.resolve());
  appStateListener?.remove();
  appStateListener = null;
  rotationListener?.remove();
  rotationListener = null;
  syncToken("");
  setRefreshTokenSig(null);
  setUser(null);
  setIsLoggedIn(false);
  // 清除持久化 token + Native 内存（含历史明文残留），一次调用全覆盖
  await clearRefreshToken();
  // 清空所有 TQ 缓存，防止退出登录后数据泄漏
  queryClient.clear();
}

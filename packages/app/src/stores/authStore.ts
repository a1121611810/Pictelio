import { setAccessToken, setOnUnauthorized, setRefreshPromise } from "../api/client";
import { refreshToken, exchangeCodeForToken } from "../api/auth";
import type { PixivUser } from "../api/types";
import {
  getRefreshToken,
  setRefreshToken,
  removeRefreshToken,
  migrateRefreshTokenFromPreferences,
} from "../utils/secureStorage";
import { App } from "@capacitor/app";
import { queryClient } from "../api/queryClient";

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

async function setupUnauthorizedHandler() {
  setOnUnauthorized(async () => {
    const latest = refreshTokenSig();
    if (latest) {
      await performRefresh(latest);
    } else {
      await logout();
    }
  });

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
let _authInitialized = false;

export async function initializeAuth() {
  if (_authInitialized) return;
  _authInitialized = true;
  let token = await getRefreshToken();
  if (!token) {
    token = await migrateRefreshTokenFromPreferences();
  }
  if (token) {
    setRefreshTokenSig(token);
    await setupUnauthorizedHandler();
    // 设置 refreshPromise，让并发请求在初始 token 刷新期间等待
    const promise = performRefresh(token).finally(() => setRefreshPromise(null));
    setRefreshPromise(promise);
    await promise;
  }
}

async function performRefresh(token: string) {
  const [err] = await tryAsync(
    refreshToken(token).then(async (resp) => {
      syncToken(resp.access_token);
      setRefreshTokenSig(resp.refresh_token);
      setUser(resp.user);
      setIsLoggedIn(true);
      lastRefreshTime = Date.now();
      await setRefreshToken(resp.refresh_token);
    }),
  );
  if (err) await logout();
}

export async function loginWithToken(token: string) {
  const resp = await refreshToken(token);
  syncToken(resp.access_token);
  setRefreshTokenSig(resp.refresh_token);
  setUser(resp.user);
  setIsLoggedIn(true);
  await setupUnauthorizedHandler();
  await setRefreshToken(resp.refresh_token);
}

/**
 * 使用 OAuth Authorization Code + PKCE 登录。
 *
 * @param code authorization_code（从浏览器/WebView 回调 URL 中提取）
 * @param codeVerifier PKCE code_verifier（生成 code_challenge 时保存的值）
 */
export async function loginWithPKCE(code: string, codeVerifier: string) {
  const resp = await exchangeCodeForToken(code, codeVerifier);
  syncToken(resp.access_token);
  setRefreshTokenSig(resp.refresh_token);
  setUser(resp.user);
  setIsLoggedIn(true);
  await setupUnauthorizedHandler();
  await setRefreshToken(resp.refresh_token);
}

export async function logout() {
  appStateListener?.remove();
  appStateListener = null;
  syncToken("");
  setRefreshTokenSig(null);
  setUser(null);
  setIsLoggedIn(false);
  await removeRefreshToken();
  // 清空所有 TQ 缓存，防止退出登录后数据泄漏
  queryClient.clear();
}

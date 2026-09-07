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
import { clearPersistedFeedsAndCache } from "../api/feedQueryPersist";
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

/**
 * 会话世代守卫（spec #393）：logout / 主动登录递增。乐观登录把启动刷新移出关键路径后，
 * 迟到的后台刷新结果（成功或永久失败）必须按世代丢弃——否则登出后登录态与凭证会被
 * 复活（共享设备隐私面），重登窗口内会被旧账号覆盖，或迟到的 invalid_grant 登出新会话。
 */
let authEpoch = 0;

export async function initializeAuth() {
  if (_authPromise) return _authPromise;
  _authPromise = (async () => {
    // restoreRefreshToken 内部完成：备份完整性检查（失效则清 token）→ 读取（含旧 Preferences 迁移）→ Native 注入
    const token = await restoreRefreshToken();
    if (token) {
      setRefreshTokenSig(token);
      await setupUnauthorizedHandler();
      // 乐观登录（spec #393）：持久凭证存在即登录态，路由立即放行，不再被启动刷新阻塞——
      // 网络瞬时故障（直连抖动/弱网）不应把用户误判为未登录踢到登录页。
      setIsLoggedIn(true);
      // 后台刷新仅补 user 信息（access_token 预热由 Java 侧 401 静默刷新承担，
      // restore 已把 token 同步进 Java 堆）；瞬时失败由 performRefresh 内部告警自愈
      const refresh = performRefresh(token).finally(() => {
        setRefreshPromise(null);
      });
      setRefreshPromise(refresh);
      void refresh;
    }
  })();
  return _authPromise;
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
  const epoch = authEpoch;
  const [err] = await tryAsync(
    refreshToken(token).then(async (resp) => {
      // 世代守卫：会话已登出/重登则丢弃迟到结果（不写信号、不落盘凭证）
      if (epoch !== authEpoch) return;
      syncToken(resp.access_token);
      setRefreshTokenSig(resp.refresh_token);
      setUser(resp.user);
      setIsLoggedIn(true);
      lastRefreshTime = Date.now();
      await saveRefreshToken(resp.refresh_token);
      // 世代复检：saveRefreshToken 的 await 期间若发生 logout（clearRefreshToken），
      // 此处补清磁盘——防刚删掉的凭证被迟到的磁盘写回复活（spec #393 隐私面）。
      // 仅当前无会话时补清（refreshTokenSig 非空 = 已重登新会话，误清会丢新会话凭证）；
      // 补清失败必须可见（陈旧凭证滞留磁盘是隐私面，禁静默）
      if (epoch !== authEpoch && !refreshTokenSig()) {
        const [clearErr] = await tryAsync(clearRefreshToken());
        if (clearErr) {
          console.warn("[authStore] 世代复检清除迟到凭证失败（陈旧凭证滞留磁盘）", clearErr);
        }
      }
    }),
  );
  if (err) {
    // 世代过期：迟到失败与本会话无关，不告警也不登出
    if (epoch !== authEpoch) return;
    if (isAuthErrorPermanent(err)) {
      await logout();
    } else {
      // 瞬时故障（spec #393）：仅告警，不清任何状态——登录态与持久化凭证保持，
      // 自愈路径 = 前台恢复预刷新 + 请求级 401 静默刷新。旧 clearAuthState 会置
      // authPermanentFailure 砖死整个会话并踢登录页，属瞬时失败的过度惩罚，已移除。
      console.warn("[authStore] token 刷新瞬时失败（保持登录态，网络恢复后自愈）", err);
    }
  }
}

export async function loginWithToken(token: string) {
  _authPromise = null; // 主动登录重置 Promise 链
  authEpoch++; // 世代递增：丢弃启动后台刷新的迟到结果（spec #393）
  const resp = await refreshToken(token);
  // 新会话建立：解除 logout 置位的会话阻断（authPermanentFailure 无重置点则重登后请求永久快速失败）
  setAuthPermanentFailure(false);
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
  authEpoch++; // 世代递增：丢弃启动后台刷新的迟到结果（spec #393）
  const resp = await exchangeCodeForToken(code, codeVerifier);
  // 新会话建立：解除 logout 置位的会话阻断（同 loginWithToken，spec #393）
  setAuthPermanentFailure(false);
  syncToken(resp.access_token);
  setRefreshTokenSig(resp.refresh_token);
  setUser(resp.user);
  setIsLoggedIn(true);
  await setupUnauthorizedHandler();
  await saveRefreshToken(resp.refresh_token);
  _authPromise = Promise.resolve();
}

export async function logout() {
  // 世代递增：启动后台刷新（乐观登录，spec #393）与在途预刷新的迟到结果按世代丢弃
  authEpoch++;
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
  // 原子清空（S2）：抑制订阅写回的窗口内删持久化 feed 缓存 + 清空 TQ 内存缓存。不可手写两步：
  // queryClient.clear() 的 removed 事件会让订阅把空快照写回刚删掉的 key（空 payload 复活）；
  // 同时防下一账号启动时 restore 到上一账号的 feed 数据（跨账号泄漏）
  clearPersistedFeedsAndCache();
}

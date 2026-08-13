import { registerPlugin } from "@capacitor/core";

/**
 * OAuthPlugin.startOAuth 的请求参数。
 */
interface OAuthStartOptions {
  /** Pixiv OAuth 登录 URL（含 PKCE code_challenge）。提供时直接使用此 URL。 */
  loginUrl?: string;
  /** PKCE code_challenge。未提供 loginUrl 时，Native 层自动构建完整 URL。 */
  codeChallenge?: string;
}

/**
 * OAuthPlugin.startOAuth 的响应结构。
 */
interface OAuthStartResult {
  /** 从回调 URL 中提取的 authorization_code。 */
  code: string;
}

/**
 * OAuthPlugin.exchangeCode 的请求参数。
 */
interface OAuthExchangeOptions {
  /** authorization_code。 */
  code: string;
  /** PKCE code_verifier。 */
  codeVerifier: string;
}

/**
 * OAuthPlugin.exchangeCode 的响应结构。
 */
interface OAuthExchangeResult {
  /** 新的 access_token（Bearer token）。 */
  accessToken: string;
  /** 服务端返回的 refresh_token。 */
  refreshToken: string;
  /** Pixiv 用户 ID。 */
  userId: number;
  /** 用户显示名称。 */
  userName: string;
  /** 用户登录账号。 */
  userAccount: string;
  /** 用户头像 URL 集合。 */
  profileImageUrls?: Record<string, string>;
}

/**
 * OAuthPlugin Capacitor 插件类型定义。
 *
 * 提供两个 Native 方法：
 *
 * 1. startOAuth() — 在 App 内打开 WebView 导航到 Pixiv 登录页，
 *    拦截回调 URL 提取 authorization_code，返回给 JS 层。
 *
 * 2. exchangeCode() — 使用 authorization_code 交换 access_token + refresh_token。
 *    OAuth 凭证（CLIENT_ID / CLIENT_SECRET / HASH_SECRET）仅存在于 Java 字节码中，
 *    不暴露给 JS 层。
 */
export interface OAuthPlugin {
  /**
   * 打开内嵌 WebView 进行 Pixiv OAuth 登录。
   *
   * WebView 导航到 loginUrl，用户完成登录后 Pixiv 重定向到回调 URL。
   * Native 插件拦截 shouldOverrideUrlLoading，从回调 URL 中提取 code 参数。
   *
   * @param options 包含 loginUrl
   * @returns 包含 authorization_code 的结果
   */
  startOAuth(options: OAuthStartOptions): Promise<OAuthStartResult>;

  /**
   * 使用 authorization_code 交换 access_token + refresh_token。
   *
   * OAuth 凭证和 X-Client-Time/X-Client-Hash 计算在 Native 层完成。
   *
   * @param options 包含 code 和 codeVerifier
   * @returns 认证结果
   */
  exchangeCode(options: OAuthExchangeOptions): Promise<OAuthExchangeResult>;
}

export const OAuthPlugin = registerPlugin<OAuthPlugin>("OAuthPlugin");

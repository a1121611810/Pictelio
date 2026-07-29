import { registerPlugin } from "@capacitor/core";

/**
 * AuthPlugin.refreshToken 的响应结构。
 */
export interface AuthRefreshResult {
  /** 新的 access_token（Bearer token）。 */
  accessToken: string;
  /** 服务端返回的 refresh_token（可能已轮换）。 */
  refreshToken: string;
  /** Pixiv 用户 ID。 */
  userId: number;
  /** 用户显示名称。 */
  userName: string;
  /** 用户登录账号。 */
  userAccount: string;
  /** 用户头像 URL 映射（如 px_16x16、px_50x50、px_170x170）。 */
  profileImageUrls?: Record<string, string>;
}

/**
 * AuthPlugin.refreshToken 的请求参数。
 */
export interface AuthRefreshOptions {
  /** 当前有效的 refresh_token。 */
  refreshToken: string;
}

/**
 * AuthPlugin Capacitor 插件类型定义。
 */
export interface AuthPlugin {
  /**
   * 使用 refresh_token 交换新的 access_token。
   *
   * OAuth 凭证（CLIENT_ID / CLIENT_SECRET / HASH_SECRET）
   * 仅存在于 Native 插件中，不暴露给 JS 层。
   *
   * @param options 包含 refreshToken 字段
   * @returns 认证结果
   */
  refreshToken(options: AuthRefreshOptions): Promise<AuthRefreshResult>;

  /**
   * 通知 Native 层关闭 Splash Screen。
   *
   * 内容就绪时由 JS 侧调用，MainActivity 中的 SplashScreen 会优雅退出。
   */
  hideSplash(): Promise<void>;
}

export const AuthPlugin = registerPlugin<AuthPlugin>("AuthPlugin");

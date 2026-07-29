import { Capacitor } from "@capacitor/core";
import { setAccessToken } from "./client";
import type { PixivAuthResponse } from "./types";
import { AuthPlugin } from "@/native/AuthPlugin";
import { PixivApi } from "@/native/PixivApi";

// ─── 平台检测 ───
const isNative = Capacitor.isNativePlatform();

/**
 * 使用 refresh_token 交换新的 access_token。
 *
 * ── 生产环境（Android Native） ──
 * 通过 AuthPlugin 在 Java 端完成 OAuth 认证。
 * CLIENT_ID / CLIENT_SECRET / HASH_SECRET 仅存在于编译后的字节码中（classes.dex），
 * 不出现在 JS bundle 中。
 *
 * ── 开发环境（浏览器 pnpm dev） ──
 * 通过 JS fallback 处理，凭证在此分支中明文出现。
 * pnpm build 时 Rolldown 将 import.meta.env.DEV 替换为 false，
 * terser 消除 if (false) { ... } 整个块，此分支的凭证和 spark-md5 均不进入生产 bundle。
 */
export async function refreshToken(token: string): Promise<PixivAuthResponse> {
  if (isNative) {
    await PixivApi.setRefreshToken({ refreshToken: token });
    const result = await AuthPlugin.refreshToken({ refreshToken: token });
    await PixivApi.setAccessToken({ accessToken: result.accessToken });
    setAccessToken(result.accessToken);
    return {
      access_token: result.accessToken,
      expires_in: 3600,
      refresh_token: result.refreshToken,
      token_type: "bearer",
      user: {
        id: result.userId,
        name: result.userName,
        account: result.userAccount,
        profile_image_urls: result.profileImageUrls ?? {},
        is_followed: false,
      },
    };
  }

  // ── DEV-ONLY 分支 ──────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (import.meta.env.DEV) {
    const { oauthFetch } = await import("./_oauthFetch");
    return oauthFetch("refresh_token", { refresh_token: token });
  }

  throw new Error("Auth not available outside native or dev mode");
}

/**
 * 使用 authorization_code 交换 access_token + refresh_token。
 *
 * @param code authorization_code
 * @param codeVerifier PKCE code_verifier
 * @returns OAuth 认证响应
 */
export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
): Promise<PixivAuthResponse> {
  if (isNative) {
    const { OAuthPlugin } = await import("@/native/OAuthPlugin");
    const result = await OAuthPlugin.exchangeCode({ code, codeVerifier });
    await PixivApi.setAccessToken({ accessToken: result.accessToken });
    setAccessToken(result.accessToken);
    return {
      access_token: result.accessToken,
      expires_in: 3600,
      refresh_token: result.refreshToken,
      token_type: "bearer",
      user: {
        id: result.userId,
        name: result.userName,
        account: result.userAccount,
        profile_image_urls: result.profileImageUrls ?? {},
        is_followed: false,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (import.meta.env.DEV) {
    const { oauthFetch } = await import("./_oauthFetch");
    return oauthFetch("authorization_code", {
      code,
      code_verifier: codeVerifier,
      redirect_uri: __CREDENTIALS__.redirectUri,
    });
  }

  throw new Error("Auth not available outside native or dev mode");
}

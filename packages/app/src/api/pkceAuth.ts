import { Capacitor } from "@capacitor/core";
import { setAccessToken } from "./client";
import type { PixivAuthResponse } from "./types";

const isNative = Capacitor.isNativePlatform();

/**
 * 生成 PKCE code_verifier + code_challenge。
 */
export async function generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  let binary = "";
  for (let i = 0; i < random.length; i++) {
    binary += String.fromCharCode(random[i]);
  }
  const codeVerifier = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, 43);

  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(codeVerifier));
  const codeChallenge = base64url(hash);

  return { codeVerifier, codeChallenge };
}

function base64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 使用 authorization_code 交换 access_token + refresh_token。
 * 仅 Native 路径在此实现；DEV 路径委托给 auth.ts 的 exchangeCodeForToken。
 */
export async function exchangeCode(code: string, codeVerifier: string): Promise<PixivAuthResponse> {
  if (isNative) {
    const { OAuthPlugin } = await import("@/native/OAuthPlugin");
    const result = await OAuthPlugin.exchangeCode({ code, codeVerifier });
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

  // DEV 路径委托给 auth.ts 的 exchangeCodeForToken
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (import.meta.env.DEV) {
    const { exchangeCodeForToken } = await import("./auth");
    return exchangeCodeForToken(code, codeVerifier);
  }

  throw new Error("Auth not available outside native or dev mode");
}

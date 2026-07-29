/**
 * DEV 模式下共享的 OAuth HTTP 请求函数。
 *
 * 构建 SparkMD5 签名头，POST 到 /pixiv-oauth/auth/token，
 * 解析响应、调用 extractAuth、setAccessToken。
 *
 * 注意：此文件仅被 auth.ts 和 pkceAuth.ts 在 `if (import.meta.env.DEV)` 分支中
 * 动态导入。生产构建中 Rolldown 替换 import.meta.env.DEV 为 false，
 * Oxc minifier（Rolldown 内置，Rust）消除整个分支，此文件及
 * __CREDENTIALS__ 引用均不进入生产 bundle。
 */
import { setAccessToken } from "./client";
import type { PixivAuthResponse } from "./types";
import { PIXIV_USER_AGENT } from "./userAgent";

function extractAuth(data: any): { accessToken: string; refreshToken: string } {
  const d = data.response || data;
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
  };
}

export async function oauthFetch(
  grantType: string,
  extraParams: Record<string, string>,
): Promise<PixivAuthResponse> {
  const {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    hashSecret: HASH_SECRET,
  } = __CREDENTIALS__;

  const { default: SparkMD5 } = await import("spark-md5");

  const time = new Date().toISOString().replace(/Z$/u, "+00:00");
  const hash = SparkMD5.hash(time + HASH_SECRET);

  const headers: Record<string, string> = {
    "X-Client-Time": time,
    "X-Client-Hash": hash,
    "App-OS": __CREDENTIALS__.appOs,
    "App-OS-Version": __CREDENTIALS__.appOsVersion,
    "User-Agent": PIXIV_USER_AGENT,
  };

  const bodyStr = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: grantType,
    get_secure_url: "1",
    ...extraParams,
  }).toString();

  const resp = await fetch("/pixiv-oauth/auth/token", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
    body: bodyStr,
    credentials: "omit",
  });

  if (!resp.ok) {
    const [_err, textResult] = await tryAsync(Promise.resolve(resp.text()));
    const text = _err ? "" : textResult!;
    throw new Error(`OAuth 失败 (HTTP ${resp.status}): ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  const auth = extractAuth(data);
  setAccessToken(auth.accessToken);
  return data;
}

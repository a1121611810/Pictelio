import { isTrustedPixivHost } from "./client";

/**
 * next_url 域名守卫（防御 SSRF）：分页 URL 只允许指向受信 Pixiv 主机或本地代理前缀。
 * 受信主机白名单单点在 client.ts（从 __PUBLIC_CONFIG__ 解析、https-only fail-closed，
 * 禁硬编码域名字符串——ADR-0100）；本模块只做分页场景的入口封装。
 */
export function assertPixivUrl(url: string, fnName: string): void {
  // 允许本地代理路径（Web 模式经 /pixiv-api 代理）
  if (url.startsWith("/pixiv-api")) return;
  if (isTrustedPixivHost(url)) return;
  throw new Error(`${fnName}: invalid next_url — must point to a trusted Pixiv host`);
}

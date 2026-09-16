// ─── 代理 URL 脱敏（纯函数，可单测） ───
// 安全：代理 URL 可能含 user:pass 凭据（含 scheme-less 格式），
// 日志/错误输出只打印主机部分，绝不输出 userinfo。
//
// 迁移（review P1-1 挂账清账）：解析改经 utils/safeParseUrl.extractAuthority
// （禁 URL 全局——lynx 运行时 `.hostname` 为 undefined，ADR-0163）。
import { extractAuthority } from './safeParseUrl'

/** 匹配 scheme 前缀（http/https 之外的代理 scheme 如 socks5 也取，仅用于输出前缀） */
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//

/**
 * 脱敏代理 URL：去除 userinfo（user:pass），只保留 protocol + host[:port]。
 * 处理 scheme-less 格式（如 "user:pass@host:8080"）——统一补 http:// 前缀后再解析，
 * 避免被解析成 scheme="user:" 而绕过脱敏。
 * 非 http(s) scheme（如 socks5://user:pass@host:8080）：authority 解析不适用（本函数
 * 接缝只认 http(s)），走下方保守剥离——凭据仍被剥离（安全目标达成），scheme 前缀丢失
 * 属日志输出可接受的形态差异。
 */
export function redactProxyUrl(url: string): string {
  const normalized = url.includes("://") ? url : `http://${url}`
  const authority = extractAuthority(normalized)
  if (authority !== null) {
    const scheme = SCHEME_RE.exec(normalized)?.[1] ?? "http"
    return `${scheme.toLowerCase()}://${authority}`
  }
  // 无法解析（含 protocol-relative "//user:pass@host" 空 authority 分支）：
  // 保守处理，取 @ 后段（主机猜测），丢弃可能的凭据前缀
  const atIdx = url.lastIndexOf("@")
  return atIdx !== -1 ? url.slice(atIdx + 1) : url
}

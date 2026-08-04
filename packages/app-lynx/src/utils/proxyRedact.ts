// ─── 代理 URL 脱敏（纯函数，可单测） ───
// 安全：代理 URL 可能含 user:pass 凭据（含 scheme-less 格式），
// 日志/错误输出只打印主机部分，绝不输出 userinfo。

/**
 * 脱敏代理 URL：去除 userinfo（user:pass），只保留 protocol + host。
 * 处理 scheme-less 格式（如 "user:pass@host:8080"），防止被 WHATWG URL
 * 解析为 scheme="user:" 而绕过脱敏。
 */
export function redactProxyUrl(url: string): string {
  try {
    const normalized = url.includes("://") ? url : `http://${url}`
    const u = new URL(normalized)
    if (u.hostname) {
      return `${u.protocol}//${u.host}`
    }
  } catch {
    /* fallthrough: 走下面的保守剥离 */
  }
  // 无法解析（含 protocol-relative "//user:pass@host" 空 hostname 分支）：
  // 保守处理，取 @ 后段（主机猜测），丢弃可能的凭据前缀
  const atIdx = url.lastIndexOf("@")
  return atIdx !== -1 ? url.slice(atIdx + 1) : url
}

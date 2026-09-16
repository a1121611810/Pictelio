// ─── 平台 API 收口：URL 域名字符串解析（spec docs/specs/qa-defense-lines.md §3.T4）───
// lynx 新代码的 URL 域名解析唯一入口：任何需要 hostname 的业务一律经本函数，
// 禁用 URL 全局（new URL / .hostname）。
// 存量迁移挂账（review P1-1，先于本收口存在，语义为 fail-closed 无现行功能破坏）：
// api/client.ts isTrustedPixivHost、utils/imageUrl.ts isTrustedImageHost、
// utils/proxyRedact.ts redactProxyUrl —— 迁移前本函数的「唯一」指 lynx 新代码面。
//
// Oracle（期望值出处，禁止从实现反推）：
// - lynx 运行时事实（取证 2026-09-15，模拟器 logcat 实证，ADR-0163）：URL 全局 polyfill
//   不抛错但 `.hostname` 字段为 undefined（happy-dom/浏览器为正常语义）——合法的
//   app-api.pixiv.net 绝对 URL 经 new URL 断言 100% 误拒 → 曾致搜索翻页必败
//   （修复 commit 6dc641d1 改字符串解析）。平台事实若回归，由 PlatformCheck
//   自检页（/platform-check）矩阵项「URL 全局 hostname」常驻可见。
// - 解析语义锚 WHATWG URL 标准（独立实现 = 浏览器 / happy-dom 的 URL.hostname）：
//   authority 形如 [userinfo@]host[:port]，结果去 userinfo 与端口，仅保留 host。
//
// 实现：与 api/search.ts 修复版（6dc641d1）同构的正则解析——仅 http(s) 绝对 URL
// 可解析，其余（相对路径 / 其它 scheme）返回 null，由调用方决策。
/**
 * 合法主机形态：点分标签（字母数字/连字符，标签不以连字符起止）或方括号 IPv6 字面量。
 * 端口：纯数字（空端口 "" 按 WHATWG 视为无端口）。
 * 校验意义（review P1-1 迁移对齐）：旧实现经 WHATWG URL 构造——非法 host/port（如
 * `host:badport`、含空格主机）会 throw，白名单类调用点因此返回 false（fail-closed）。
 * 纯正则解析不带该校验会**放松**语义（`https://i.pximg.net:badport/` 从拒绝变接受），
 * 故此处显式补校验，任一段不合规 → null（调用方 fail-closed）。
 */
const HOST_RE =
  /^(?:\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*)$/
const PORT_RE = /^\d+$/

/** 拆分 authority（已去 userinfo）为 host 与 port（IPv6 感知）；形态不合规返回 null */
function splitAuthority(authority: string): { host: string; port: string | null } | null {
  let host: string
  let port: string | null = null
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]")
    if (close === -1) return null
    host = authority.slice(0, close + 1)
    const rest = authority.slice(close + 1)
    if (rest !== "") {
      if (!rest.startsWith(":")) return null
      port = rest.slice(1)
    }
  } else {
    const idx = authority.indexOf(":")
    if (idx === -1) {
      host = authority
    } else {
      host = authority.slice(0, idx)
      port = authority.slice(idx + 1)
    }
  }
  if (!HOST_RE.test(host)) return null
  if (port !== null && port !== "" && !PORT_RE.test(port)) return null
  return { host, port }
}

export function extractHostname(url: string): string | null {
  const authority = extractAuthority(url)
  if (authority === null) return null
  return splitAuthority(authority)?.host ?? null
}

/**
 * 提取 http(s) 绝对 URL 的 authority（去 userinfo，**保留端口**）。
 * 供需要 host:port 形态的调用方使用（如 proxyRedact 的脱敏输出），
 * 与 extractHostname（去端口）共用同一解析正则与形态校验——平台事实与禁用 URL 全局
 * 的约束同前。非 http(s) 或非绝对 URL、authority 形态不合规均返回 null。
 */
export function extractAuthority(url: string): string | null {
  const m = /^https?:\/\/([^/?#]+)/.exec(url)
  if (!m) return null
  const authority = m[1].split("@").pop() ?? null
  if (authority === null) return null
  return splitAuthority(authority) === null ? null : authority
}

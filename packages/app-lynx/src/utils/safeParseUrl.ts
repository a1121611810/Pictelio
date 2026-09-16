// ─── 平台 API 收口：URL 域名字符串解析（spec docs/specs/qa-defense-lines.md §3.T4）───
// 全仓唯一 URL 域名解析入口（术语 safeParseURL）：任何需要 hostname 的业务一律经本函数，
// 禁用 URL 全局（new URL / .hostname）。
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
export function extractHostname(url: string): string | null {
  const m = /^https?:\/\/([^/?#]+)/.exec(url)
  if (!m) return null
  const authority = m[1].split("@").pop() ?? m[1]
  const host = authority.split(":")[0]
  return host || null
}

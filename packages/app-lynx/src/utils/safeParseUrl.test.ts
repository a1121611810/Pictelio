// safeParseUrl.extractHostname 单测 + 源级防线（spec docs/specs/qa-defense-lines.md §3.T4，issue #550）。
// 期望值出处（Oracle 溯源）：
// - 正向用例锚 WHATWG URL 标准（独立实现 = 浏览器 / happy-dom 的 URL.hostname 语义）：
//   authority 形如 [userinfo@]host[:port]，结果去 userinfo 与端口，仅保留 host。
// - 负向用例锚收口契约（与 api/search.ts 6dc641d1 修复版同构）：仅小写 http(s) 绝对
//   URL 可解析，相对路径 / 其它 scheme 一律返回 null（调用方决策，如 search.ts 的
//   /pixiv-api 代理路径先 startsWith 放行再走断言）。
// 源级防线：本工具是 lynx 新代码的 URL 域名解析唯一入口，禁 URL 全局（lynx `.hostname` 为
// undefined，取证 2026-09-15，ADR-0163）——剥注释后断言无 `new URL(`。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extractHostname } from './safeParseUrl'

describe('extractHostname 正常解析（WHATWG URL.hostname 语义）', () => {
  it('host + path + query：仅保留 host', () => {
    expect(extractHostname('https://app-api.pixiv.net/v1/search?word=x')).toBe('app-api.pixiv.net')
  })

  it('无 path 的裸 authority', () => {
    expect(extractHostname('https://example.com')).toBe('example.com')
  })

  it('path 上带 query 与 fragment：不串入 host', () => {
    expect(extractHostname('https://example.com/a?b=1#frag')).toBe('example.com')
  })
})

describe('extractHostname 去端口', () => {
  it('host:port → 去端口仅保留 host', () => {
    expect(extractHostname('http://example.com:8443/path')).toBe('example.com')
  })

  it('无 path 带端口的裸 authority', () => {
    expect(extractHostname('https://example.com:8080')).toBe('example.com')
  })
})

describe('extractHostname 去 userinfo', () => {
  it('user:pass@host → 仅保留 host', () => {
    expect(extractHostname('https://user:pass@example.com/path')).toBe('example.com')
  })

  it('仅 user@host → 仅保留 host', () => {
    expect(extractHostname('https://user@example.com/x')).toBe('example.com')
  })
})

describe('extractHostname 非 http(s) 与相对路径（收口契约：返回 null）', () => {
  it('其它 scheme（ftp）→ null', () => {
    expect(extractHostname('ftp://example.com/file')).toBe(null)
  })

  it('大写 scheme 不可解析（实现契约：仅小写 http(s) 前缀，锁定防语义漂移）', () => {
    expect(extractHostname('HTTPS://example.com/x')).toBe(null)
  })

  it('裸相对路径（如 /pixiv-api 代理形态）→ null', () => {
    expect(extractHostname('/pixiv-api/v1/search?word=x')).toBe(null)
  })

  it('无 scheme 的裸域名字符串 → null', () => {
    expect(extractHostname('app-api.pixiv.net/v1/x')).toBe(null)
  })
})

// ── 源级防线（spec §3.T4.4：search.ts / safeParseUrl.ts 均禁裸 new URL(）──
// search.ts 由同目录 search.template.test.ts 守卫；本文件守卫收口工具自身。
describe('safeParseUrl.ts 源级守卫（lynx URL 全局不可用防线）', () => {
  const src = readFileSync(fileURLToPath(new URL('./safeParseUrl.ts', import.meta.url)), 'utf8')
  /** 去注释后的代码本文（负向断言对象；头注释 oracle 会提到 new URL——需剥离） */
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('收口工具自身不依赖 URL 全局（new URL / .hostname）', () => {
    expect(code).not.toMatch(/new\s+URL\(/)
    expect(code).not.toContain('.hostname')
  })
})

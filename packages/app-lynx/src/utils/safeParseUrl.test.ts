// safeParseUrl 单测 + 源级防线（spec docs/specs/qa-defense-lines.md §3.T4，issue #550）。
// 期望值出处（Oracle 溯源）：
// - 正向用例锚 WHATWG URL 标准（独立实现 = 浏览器 / happy-dom 的 URL.hostname 语义）：
//   authority 形如 [userinfo@]host[:port]，结果去 userinfo 与端口，仅保留 host。
// - 负向用例锚收口契约（与 api/search.ts 6dc641d1 修复版同构）：仅小写 http(s) 绝对
//   URL 可解析，相对路径 / 其它 scheme 一律返回 null（调用方决策，如 search.ts 的
//   /pixiv-api 代理路径先 startsWith 放行再走断言）。
// 源级防线：本工具是 lynx 新代码的 URL 域名解析唯一入口，禁 URL 全局（lynx `.hostname` 为
// undefined，取证 2026-09-15，ADR-0163）——剥注释后断言无 `new URL(`。
// 迁移守卫（review P1-1 清账）：三处存量裸 URL 全局（client.ts / imageUrl.ts /
// proxyRedact.ts）已迁入本模块，源级断言防回流。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extractAuthority, extractHostname } from './safeParseUrl'

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

// ── extractAuthority（保留端口，供 proxyRedact 等 host:port 形态消费；review P1-1 迁移新增）──
describe('extractAuthority（authority 解析：去 userinfo、保留端口）', () => {
  it('保留端口；无端口时即 host', () => {
    expect(extractAuthority('http://proxy.example:7897/path')).toBe('proxy.example:7897')
    expect(extractAuthority('https://app-api.pixiv.net/x')).toBe('app-api.pixiv.net')
  })

  it('剔除 userinfo（凭据不进 authority）', () => {
    expect(extractAuthority('http://user:pass@proxy.example:7897/path')).toBe('proxy.example:7897')
  })

  it('非 http(s) / 非绝对 URL → null（收口契约同 extractHostname）', () => {
    expect(extractAuthority('socks5://proxy.example:1080')).toBe(null)
    expect(extractAuthority('//proxy.example:7897')).toBe(null)
    expect(extractAuthority('/pixiv-api/v1/x')).toBe(null)
  })
})

// ── 形态校验（对齐 WHATWG 对非法 host/port 抛错的 fail-closed 语义；review P1-1 迁移补）──
// 旧实现经 URL 构造：坏端口/非法主机 → throw → 白名单调用点返回 false。纯正则若无校验会
// 放松为接受（安全方向错误），故显式校验并在此锁定。
describe('形态校验：非法 host / port → null（fail-closed）', () => {
  it('非数字端口 → null（WHATWG 对 badport 抛错）', () => {
    expect(extractHostname('https://i.pximg.net:badport/x')).toBe(null)
    expect(extractAuthority('http://host:badport')).toBe(null)
  })

  it('非法主机字符（空格 / 下划线）→ null', () => {
    expect(extractHostname('https://exa mple.com/x')).toBe(null)
    expect(extractHostname('https://under_score.com/x')).toBe(null)
  })

  it('空端口按 WHATWG 视为无端口（放行）', () => {
    expect(extractHostname('https://example.com:/x')).toBe('example.com')
  })

  it('IPv6 字面量（带括号与端口）可解析且括号保留', () => {
    expect(extractHostname('http://[::1]:8080/x')).toBe('[::1]')
    expect(extractAuthority('http://[2001:db8::1]:7897/x')).toBe('[2001:db8::1]:7897')
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

describe('迁移守卫：三处存量裸 URL 全局已收口（review P1-1 清账，ADR-0163）', () => {
  /** 剥注释后断言（注释会提到 new URL——需剥离，同 *.template.test.ts 惯例） */
  const strip = (relPath: string) =>
    readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

  it.each([
    ['../api/client.ts', 'isTrustedPixivHost'],
    ['../utils/imageUrl.ts', 'isTrustedImageHost'],
    ['./proxyRedact.ts', 'redactProxyUrl'],
    // 新增（ADR-0172 §3）：翻译层的 Azure 判定曾用 new URL(...).hostname —— 在 lynx 上
    // .hostname 为 undefined → Azure endpoint 被静默判为非 Azure。已改走 extractHostname。
    ['../api/translate.ts', 'isAzureBaseURL'],
  ])('%s 无裸 `new URL(`（%s 迁移）', (relPath) => {
    expect(strip(relPath)).not.toMatch(/new\s+URL\(/)
  })
})

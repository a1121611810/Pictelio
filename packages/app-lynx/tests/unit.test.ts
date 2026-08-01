// ─── app-lynx 单元测试（Vitest，node 环境） ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { proxyImageUrl, thumbUrl } from '../src/utils/imageUrl'
import { classifyError, isOAuthTokenErrorResponse, rewriteUrl, shouldAttachAuth } from '../src/api/client'
import { ApiErrorType } from '../src/api/types'
import { extractNovelTextFromHtml } from '../src/api/novel'
import { matchRoute } from '../src/routerCore'
import { redactProxyUrl } from '../src/utils/proxyRedact'

describe('imageUrl.proxyImageUrl', () => {
  it('将 i.pximg.net URL 重写为本地代理路径', () => {
    expect(
      proxyImageUrl('https://i.pximg.net/c/540x540_70/img-master/img/2020/01/01/00/00/00/1_p0_master1200.jpg'),
    ).toBe('/pixiv-img/c/540x540_70/img-master/img/2020/01/01/00/00/00/1_p0_master1200.jpg')
  })

  it('已代理路径原样返回', () => {
    expect(proxyImageUrl('/pixiv-img/a.jpg')).toBe('/pixiv-img/a.jpg')
  })

  it('thumbUrl 优先 square_medium', () => {
    expect(
      thumbUrl({
        square_medium: 'https://i.pximg.net/sm.jpg',
        medium: 'https://i.pximg.net/m.jpg',
      }),
    ).toBe('/pixiv-img/sm.jpg')
  })

  it('空 URL 安全返回空串', () => {
    expect(proxyImageUrl('')).toBe('')
  })
})

describe('client.classifyError', () => {
  it('401 → UNAUTHORIZED', () => {
    const e = classifyError(401, null, null)
    expect(e.type).toBe(ApiErrorType.UNAUTHORIZED)
  })

  it('429 → RATE_LIMIT', () => {
    const e = classifyError(429, null, null)
    expect(e.type).toBe(ApiErrorType.RATE_LIMIT)
  })

  it('400 OAuth 错误 → UNAUTHORIZED（refresh_token 失效）', () => {
    const body = { error: { message: 'OAuth error invalid_request' } }
    expect(isOAuthTokenErrorResponse(400, body)).toBe(true)
    const e = classifyError(400, null, body)
    expect(e.type).toBe(ApiErrorType.UNAUTHORIZED)
  })

  it('Pixiv 真实 OAuth 错误体 {error:"invalid_grant"} → UNAUTHORIZED', () => {
    const body = { has_error: true, error: 'invalid_grant' }
    expect(isOAuthTokenErrorResponse(400, body)).toBe(true)
    const e = classifyError(400, null, body)
    expect(e.type).toBe(ApiErrorType.UNAUTHORIZED)
  })

  it('object 形式 {error:{message:"invalid_grant"}} → UNAUTHORIZED', () => {
    const body = { error: { message: 'invalid_grant' } }
    expect(isOAuthTokenErrorResponse(400, body)).toBe(true)
    const e = classifyError(400, null, body)
    expect(e.type).toBe(ApiErrorType.UNAUTHORIZED)
  })

  it('proxy_error → PROXY', () => {
    const e = classifyError(502, null, { error: 'proxy_error', message: '代理失败' })
    expect(e.type).toBe(ApiErrorType.PROXY)
  })

  it('网络错误（TypeError）→ NETWORK', () => {
    const e = classifyError(0, new TypeError('fetch failed'), null)
    expect(e.type).toBe(ApiErrorType.NETWORK)
  })
})

describe('client.rewriteUrl', () => {
  it('相对路径 → /pixiv-api 前缀', () => {
    expect(rewriteUrl('/v1/illust/recommended')).toBe('/pixiv-api/v1/illust/recommended')
  })

  it('apiBaseUrl 绝对 URL → /pixiv-api', () => {
    expect(rewriteUrl('https://app-api.pixiv.net/v1/illust/detail')).toBe(
      '/pixiv-api/v1/illust/detail',
    )
  })

  it('authUrl → /pixiv-oauth/auth/token', () => {
    expect(rewriteUrl('https://oauth.secure.pixiv.net/auth/token')).toBe('/pixiv-oauth/auth/token')
  })

  it('已代理路径原样', () => {
    expect(rewriteUrl('/pixiv-img/x.jpg')).toBe('/pixiv-img/x.jpg')
  })
})

describe('client.shouldAttachAuth（Bearer 决策）', () => {
  // 注：shouldAttachAuth 接收「已重写」的 URL（execute 内先 rewriteUrl 再决策）
  it('重写后的代理路径 → 附加 Bearer', () => {
    expect(shouldAttachAuth('/pixiv-api/v1/illust/recommended')).toBe(true)
    expect(shouldAttachAuth('/pixiv-oauth/auth/token')).toBe(true)
  })

  it('外部绝对 URL（next_url 指向非 Pixiv 域）→ 不附加 Bearer', () => {
    expect(shouldAttachAuth('https://evil.example.com/steal')).toBe(false)
  })

  it('伪后缀域名（app-api.pixiv.net.evil.com）→ 不附加 Bearer', () => {
    expect(shouldAttachAuth('https://app-api.pixiv.net.evil.com/x')).toBe(false)
  })

  it('非代理相对路径 → 不附加 Bearer', () => {
    expect(shouldAttachAuth('/some-local-path')).toBe(false)
  })
})

describe('client.rewriteUrl（主机边界匹配）', () => {
  it('精确 Pixiv API 主机 → /pixiv-api', () => {
    expect(rewriteUrl('https://app-api.pixiv.net/v1/illust/detail')).toBe(
      '/pixiv-api/v1/illust/detail',
    )
  })

  it('OAuth 主机 → /pixiv-oauth/auth/token', () => {
    expect(rewriteUrl('https://oauth.secure.pixiv.net/auth/token')).toBe(
      '/pixiv-oauth/auth/token',
    )
  })

  it('OAuth 带 query string → /pixiv-oauth/auth/token', () => {
    expect(rewriteUrl('https://oauth.secure.pixiv.net/auth/token?grant_type=x')).toBe(
      '/pixiv-oauth/auth/token',
    )
  })

  it('裸 Pixiv API 主机 → /pixiv-api', () => {
    expect(rewriteUrl('https://app-api.pixiv.net')).toBe('/pixiv-api')
  })

  it('伪后缀域名不被误判（rewriteUrl 原样返回）', () => {
    expect(rewriteUrl('https://app-api.pixiv.net.evil.com/v1/x')).toBe(
      'https://app-api.pixiv.net.evil.com/v1/x',
    )
  })
})

describe('novel.extractNovelTextFromHtml', () => {
  it('从 HTML 提取小说正文', () => {
    const html = `<script>window.pixiv = { novel: { "text": "第一行\\n第二行\\n第三行" } }</script>`
    expect(extractNovelTextFromHtml(html)).toBe('第一行\n第二行\n第三行')
  })

  it('正文缺失返回空串', () => {
    expect(extractNovelTextFromHtml('<html><body>no text</body></html>')).toBe('')
  })
})

describe('routerCore 路由匹配', () => {
  const coreRoutes = [
    { path: '/login', name: 'login' },
    { path: '/recommended', name: 'recommended' },
    { path: '/illust/:id', name: 'illust-detail' },
    { path: '/novels', name: 'novels' },
    { path: '/novel/:id', name: 'novel-detail' },
    { path: '/me', name: 'me' },
  ]

  it('静态路径精确匹配', () => {
    const m = matchRoute(coreRoutes, '/recommended')
    expect(m?.route.name).toBe('recommended')
    expect(m?.params).toEqual({})
  })

  it('参数路径提取 params', () => {
    const m = matchRoute(coreRoutes, '/illust/12345')
    expect(m?.route.name).toBe('illust-detail')
    expect(m?.params).toEqual({ id: '12345' })
  })

  it('路径段数不匹配 → null', () => {
    expect(matchRoute(coreRoutes, '/illust/1/2')).toBeNull()
  })

  it('未知路径 → null', () => {
    expect(matchRoute(coreRoutes, '/nope')).toBeNull()
  })
})

describe('authStore 安全：refresh_token 不持久化', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('restoreToken 不读 localStorage（无持久化 token → 未登录）', async () => {
    const { restoreToken, isLoggedIn } = await import('../src/stores/authStore')
    const ok = await restoreToken()
    const lsGet = (globalThis.localStorage as { getItem: ReturnType<typeof vi.fn> }).getItem
    expect(ok).toBe(false)
    expect(isLoggedIn.value).toBe(false)
    expect(lsGet).not.toHaveBeenCalled()
  })

  it('登录成功后不写 localStorage', async () => {
    // mock 登录成功路径：OAuth 返回有效响应，验证成功后也绝不写存储
    vi.mock('../src/api/auth', () => ({
      loginWithRefreshToken: vi.fn(async () => ({
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: 1, name: 'u', account: 'u', profile_image_urls: {} },
      })),
    }))
    const { loginWithToken } = await import('../src/stores/authStore')
    const lsSet = (globalThis.localStorage as { setItem: ReturnType<typeof vi.fn> }).setItem
    await loginWithToken('some-token')
    expect(lsSet).not.toHaveBeenCalled()
  })
})

describe('proxyRedact.redactProxyUrl（代理凭据脱敏）', () => {
  it('http://user:pass@host 去除 userinfo', () => {
    expect(redactProxyUrl('http://user:secret@proxy.example.com:8080')).toBe(
      'http://proxy.example.com:8080',
    )
  })

  it('scheme-less user:pass@host:port 也能脱敏（防 WHATWG scheme 绕过）', () => {
    expect(redactProxyUrl('user:secret@proxy.example.com:8080')).toBe(
      'http://proxy.example.com:8080',
    )
  })

  it('scheme-less 无凭据 host:port 正常', () => {
    expect(redactProxyUrl('127.0.0.1:10808')).toBe('http://127.0.0.1:10808')
  })

  it('无凭据完整 URL 保留 protocol+host', () => {
    expect(redactProxyUrl('http://127.0.0.1:10808')).toBe('http://127.0.0.1:10808')
  })

  it('输出中绝不含 userinfo 片段', () => {
    const out = redactProxyUrl('user:secret@proxy.example.com:8080')
    expect(out).not.toContain('user:secret')
    expect(out).not.toContain('@')
  })

  it('protocol-relative //user:pass@host 也能脱敏（防空 hostname 绕过）', () => {
    const out = redactProxyUrl('//user:secret@proxy.example.com:8080')
    expect(out).not.toContain('user:secret')
    expect(out).not.toContain('@')
  })

  it('不可解析输入（坏端口）保守剥离 @ 前缀', () => {
    expect(redactProxyUrl('user:secret@host:badport')).toBe('host:badport')
  })
})

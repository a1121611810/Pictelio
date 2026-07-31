// ─── app-lynx 单元测试（Vitest，node 环境） ───
import { describe, it, expect } from 'vitest'
import { proxyImageUrl, thumbUrl } from '../src/utils/imageUrl'
import { classifyError, isOAuthTokenErrorResponse, rewriteUrl } from '../src/api/client'
import { ApiErrorType } from '../src/api/types'
import { extractNovelTextFromHtml } from '../src/api/novel'
import { matchRoute } from '../src/routerCore'

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

// ─── app-lynx 单元测试（Vitest，node 环境） ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { proxyImageUrl, thumbUrl } from '../src/utils/imageUrl'
import { classifyError, isNativeMode, isOAuthTokenErrorResponse, rewriteUrl, shouldAttachAuth } from '../src/api/client'
import { ApiErrorType } from '../src/api/types'
import { extractNovelTextFromHtml } from '../src/api/novel'
import { matchRoute, evaluateSystemBack, SYSTEM_BACK_EXIT_WINDOW_MS } from '../src/routerCore'
import { redactProxyUrl } from '../src/utils/proxyRedact'
import { apiClient } from '../src/api/client'
import { isOAuthCredsInjected } from '../src/api/auth'
import { getUserDetail, getUserFollowing, getUserFollowers, followUser, unfollowUser, loadUserListNext } from '../src/api/user'
import { loadUserIllusts, loadFollow, loadBookmarks } from '../src/api/illust'
import { loadUserNovels, loadBookmarks as loadNovelBookmarks, loadFollow as loadNovelFollow } from '../src/api/novel'
import { bytesToDataUrl, downloadUgoiraFrames } from '../src/api/ugoira'
import type { UgoiraExtractMode } from '../src/api/ugoira'
import { ugoiraMode as lynxUgoiraMode, setUgoiraMode as lynxSetUgoiraMode } from '../src/stores/settingsStore'
import { ME_A11Y_LABELS, LOGIN_A11Y_LABELS, RECOMMENDED_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../src/utils/accessibility'

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

describe('client 原生模式（#53：NativeModules 存在 → 绝对 URL 直连）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rewriteUrl 相对 API 路径 → 绝对 apiBaseUrl', () => {
    vi.stubGlobal('NativeModules', { PictelioApp: {} })
    expect(rewriteUrl('/v1/illust/recommended')).toBe(
      'https://app-api.pixiv.net/v1/illust/recommended',
    )
  })

  it('rewriteUrl 绝对 URL 原样（不重写为代理路径）', () => {
    vi.stubGlobal('NativeModules', { PictelioApp: {} })
    expect(rewriteUrl('https://app-api.pixiv.net/v1/x')).toBe('https://app-api.pixiv.net/v1/x')
    expect(rewriteUrl('https://oauth.secure.pixiv.net/auth/token')).toBe(
      'https://oauth.secure.pixiv.net/auth/token',
    )
  })

  it('rewriteUrl /pixiv-img 相对路径原样（交给原生 PictelioImageService）', () => {
    vi.stubGlobal('NativeModules', { PictelioApp: {} })
    expect(rewriteUrl('/pixiv-img/x.jpg')).toBe('/pixiv-img/x.jpg')
  })

  it('shouldAttachAuth 原生绝对 URL → 附加 Bearer', () => {
    vi.stubGlobal('NativeModules', { PictelioApp: {} })
    expect(shouldAttachAuth('https://app-api.pixiv.net/v1/x')).toBe(true)
  })

  it('web 模式行为不变（无 NativeModules）', () => {
    expect(rewriteUrl('/v1/illust/recommended')).toBe('/pixiv-api/v1/illust/recommended')
    expect(shouldAttachAuth('https://evil.example.com/steal')).toBe(false)
  })

  // #64 E2E 实测发现：web-core 预览在 worker 里注入空壳 NativeModules（无 Pictelio* 模块），
  // isNativeMode 若按全局存在判定会误判原生模式 → 登录报「原生认证模块不可用」
  it('isNativeMode：空壳 NativeModules（web-core 注入）→ 非原生模式', () => {
    vi.stubGlobal('NativeModules', {})
    expect(isNativeMode()).toBe(false)
  })

  it('isNativeMode：实际 Pictelio 模块存在 → 原生模式', () => {
    vi.stubGlobal('NativeModules', { PictelioAuth: {}, PictelioApi: {} })
    expect(isNativeMode()).toBe(true)
    vi.stubGlobal('NativeModules', { PictelioSecureStorage: {} })
    expect(isNativeMode()).toBe(true)
  })

  it('isNativeMode：无 NativeModules → 非原生模式', () => {
    vi.stubGlobal('NativeModules', undefined)
    expect(isNativeMode()).toBe(false)
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

describe('routerCore.evaluateSystemBack（ADR-0066 系统返回决策）', () => {
  const now = 1_000_000

  it('有历史 → navigate（返回上一页）', () => {
    expect(evaluateSystemBack(1, 0, now)).toBe('navigate')
    expect(evaluateSystemBack(3, now - 100, now)).toBe('navigate')
  })

  it('无历史且从未提示过 → hint', () => {
    expect(evaluateSystemBack(0, 0, now)).toBe('hint')
  })

  it('无历史且 2s 窗口内第二次返回 → exit', () => {
    expect(evaluateSystemBack(0, now - 100, now)).toBe('exit')
    expect(evaluateSystemBack(0, now - (SYSTEM_BACK_EXIT_WINDOW_MS - 1), now)).toBe('exit')
  })

  it('无历史且超过 2s 窗口 → 重新计为 hint（不直接退出）', () => {
    expect(evaluateSystemBack(0, now - SYSTEM_BACK_EXIT_WINDOW_MS, now)).toBe('hint')
    expect(evaluateSystemBack(0, now - 5000, now)).toBe('hint')
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
    // 部分 mock：保留原模块其他导出（isOAuthCredsInjected 等），仅覆盖 loginWithRefreshToken
    vi.mock('../src/api/auth', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/api/auth')>()
      return {
        ...actual,
        loginWithRefreshToken: vi.fn(async () => ({
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: 3600,
          token_type: 'bearer',
          user: { id: 1, name: 'u', account: 'u', profile_image_urls: {} },
        })),
      }
    })
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

// ─── Tailwind 配置契约测试（issue #43） ───
// 契约：tailwind.config 颜色映射引用的每个 CSS 变量必须真实存在于 tokens.css。
// 从源码文件提取比对（真实样例，非手写 mock——实现错了测试不会全绿）。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tailwindConfigSrc = readFileSync(resolve(rootDir, 'tailwind.config.ts'), 'utf-8')
const tokensCss = readFileSync(resolve(rootDir, 'src/styles/tokens.css'), 'utf-8')

describe('tailwind.config 契约（Tailwind ↔ tokens.css）', () => {
  it('colors 映射引用的每个 CSS 变量都存在于 tokens.css', () => {
    // 提取 tailwind.config 里 colors 段引用的 var(--xxx)
    // 注意：此分割依赖 colors 为 theme.extend 的最后一个键（且缩进 4 空格），
    // 重构 tailwind.config 时若调整键序/缩进需同步此解析，否则会静默误测
    const colorsSection = tailwindConfigSrc.split('colors: {')[1].split('\n  }')[0]
    const referenced = [...new Set([...colorsSection.matchAll(/var\((--[a-zA-Z0-9]+)\)/g)].map((m) => m[1]))]
    expect(referenced.length).toBeGreaterThan(0)
    for (const varName of referenced) {
      expect(tokensCss, `tokens.css 缺少 ${varName}`).toContain(`${varName}:`)
    }
  })

  it('spacing 映射全部使用 vw 单位（不引入 rem——web-core 已知坑）', () => {
    const spacingSection = tailwindConfigSrc.split('spacing: {')[1].split('\n  }')[0]
    expect(spacingSection).not.toMatch(/rem/)
    expect(spacingSection).toMatch(/vw/)
  })

  it('fontSize 映射全部使用 rpx 单位（沿用现有字号语义）', () => {
    const fontSizeSection = tailwindConfigSrc.split('fontSize: {')[1].split('\n  }')[0]
    expect(fontSizeSection).not.toMatch(/rem/)
    expect(fontSizeSection).toMatch(/rpx/)
  })
})

describe('client 原生模式 API 转发（#53：JS 零知 access_token）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  beforeEach(async () => {
    // 清模块级状态（单例跨测试共享）：避免 401 触发前序测试注册的 onUnauthorizedHandler
    const { setOnUnauthorized, setAccessToken, setAuthPermanentFailure } = await import('../src/api/client')
    setOnUnauthorized(null)
    setAccessToken('')
    setAuthPermanentFailure(false)
  })

  it('apiClient.get 原生模式 → PictelioApi.request + 2xx 解析', async () => {
    const requestMock = vi.fn((_m: string, _p: string, _b: string, cb: (s: number, d: string) => void) =>
      cb(200, JSON.stringify({ ok: true })),
    )
    vi.stubGlobal('NativeModules', { PictelioApi: { request: requestMock } })
    const { apiClient } = await import('../src/api/client')
    const res = await apiClient.get('/v1/illust/detail', { id: '1' })
    expect(res).toEqual({ ok: true })
    expect(requestMock).toHaveBeenCalledWith('GET', '/v1/illust/detail?id=1', '', expect.any(Function))
  })

  it('apiClient.get 原生模式 4xx → reject ApiError（classifyError）', async () => {
    vi.stubGlobal('NativeModules', {
      PictelioApi: { request: (_m: string, _p: string, _b: string, cb: (s: number, d: string) => void) =>
        cb(404, JSON.stringify({ error: { message: 'not found' } })) },
    })
    const { apiClient } = await import('../src/api/client')
    await expect(apiClient.get('/v1/x')).rejects.toMatchObject({ status: 404 })
  })

  it('apiClient.get 原生模式 JS 无 access_token 不抛未登录（token 在 Java 堆）', async () => {
    const requestMock = vi.fn((_m: string, _p: string, _b: string, cb: (s: number, d: string) => void) =>
      cb(401, JSON.stringify({})),
    )
    vi.stubGlobal('NativeModules', { PictelioApi: { request: requestMock } })
    const { apiClient, getAccessToken, setAccessToken } = await import('../src/api/client')
    setAccessToken('') // 清模块级残留（模块单例跨测试共享）
    await expect(apiClient.get('/v1/x')).rejects.toMatchObject({ status: 401 })
    expect(requestMock).toHaveBeenCalled()
    expect(getAccessToken()).toBe('') // JS 零知
  })
})

describe('authStore 原生模式登录（#53：Native OAuth 交换，token 不进 JS）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('登录成功 → user 设置 + 新 refresh_token 持久化（走 PictelioSecureStorage）', async () => {
    const setItemMock = vi.fn((_k: string, _v: string, cb: () => void) => cb())
    vi.stubGlobal('NativeModules', {
      PictelioAuth: {
        loginWithRefreshToken: (_t: string, cb: (info: string, err: string) => void) =>
          cb(
            JSON.stringify({
              userId: 1,
              userName: 'テスト',
              userAccount: 'test',
              profileImageUrls: { medium: 'https://x/avatar.png' },
              refreshToken: 'new-token',
            }),
            '',
          ),
      },
      PictelioSecureStorage: {
        setItem: setItemMock,
        getItem: (_k: string, cb: (v: string | null, e: string | null) => void) => cb(null, ''),
        removeItem: (_k: string, cb: () => void) => cb(),
      },
    })
    const { loginWithToken, isLoggedIn, currentUser } = await import('../src/stores/authStore')
    await loginWithToken('old-token')
    expect(isLoggedIn.value).toBe(true)
    expect(currentUser.value?.name).toBe('テスト')
    // access_token 不进 JS（getAccessToken 仍空）；refresh_token 经原生存储持久化
    expect(setItemMock).toHaveBeenCalledWith('refresh_token', 'new-token', expect.any(Function))
  })

  it('登录失败 → authError + 永久失效（不登录）', async () => {
    vi.stubGlobal('NativeModules', {
      PictelioAuth: {
        loginWithRefreshToken: (_t: string, cb: (info: string, err: string) => void) =>
          cb('', '登录凭证无效或已失效'),
      },
    })
    const { loginWithToken, isLoggedIn, authError } = await import('../src/stores/authStore')
    await loginWithToken('bad-token')
    expect(isLoggedIn.value).toBe(false)
    expect(authError.value).toBe('登录凭证无效或已失效')
  })
})

describe('authStore logout 原生模式（#53：清 Java 堆 token）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('logout 原生模式 → PictelioAuth.clearTokens 被调用', async () => {
    const clearTokensMock = vi.fn((cb: () => void) => cb())
    vi.stubGlobal('NativeModules', {
      PictelioAuth: { clearTokens: clearTokensMock },
      PictelioSecureStorage: {
        setItem: (_k: string, _v: string, cb: () => void) => cb(),
        getItem: (_k: string, cb: (v: string | null) => void) => cb(null),
        removeItem: (_k: string, cb: () => void) => cb(),
      },
    })
    const { logout } = await import('../src/stores/authStore')
    logout()
    expect(clearTokensMock).toHaveBeenCalled()
  })
})

describe('client 原生模式 401 轮换（#53：refresh_token 持久化到 Keystore）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('request 回调携带 rotated → saveRefreshToken 写入原生存储', async () => {
    const setItemMock = vi.fn((_k: string, _v: string, cb: () => void) => cb())
    vi.stubGlobal('NativeModules', {
      PictelioApi: {
        request: (_m: string, _p: string, _b: string, cb: (s: number, d: string, r: string) => void) =>
          cb(200, JSON.stringify({ ok: true }), 'rotated-new-token'),
      },
      PictelioSecureStorage: {
        setItem: setItemMock,
        getItem: (_k: string, cb: (v: string | null) => void) => cb(null),
        removeItem: (_k: string, cb: () => void) => cb(),
      },
    })
    const { apiClient } = await import('../src/api/client')
    await apiClient.get('/v1/illust/detail')
    expect(setItemMock).toHaveBeenCalledWith('refresh_token', 'rotated-new-token', expect.any(Function))
  })
})

// ─── P0-T1：用户 API 契约（端点路径/参数与主项目 api/user.ts|illust.ts|novel.ts 同源） ───
describe('P0-T1 用户 API 契约', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('getUserDetail 调 /v1/user/detail 并带 user_id + filter=for_ios', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({
      user: { id: 123 },
      profile: {},
      profile_publicity: {},
      workspace: {},
    })
    const res = await getUserDetail(123)
    expect(spy).toHaveBeenCalledWith('/v1/user/detail', { user_id: '123', filter: 'for_ios' })
    expect(res.user.id).toBe(123)
  })

  it('getUserDetail 网络失败透传 reject（IO 边界失败路径）', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('network down'))
    await expect(getUserDetail(1)).rejects.toThrow('network down')
  })

  it('loadUserIllusts 默认 type=illust，可传 manga', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ illusts: [], next_url: null })
    await loadUserIllusts(7)
    expect(spy).toHaveBeenCalledWith('/v1/user/illusts', { user_id: '7', type: 'illust' }, undefined)
    await loadUserIllusts(7, 'manga')
    expect(spy).toHaveBeenCalledWith('/v1/user/illusts', { user_id: '7', type: 'manga' }, undefined)
  })

  it('loadUserIllusts 失败透传 reject', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('401'))
    await expect(loadUserIllusts(7)).rejects.toThrow('401')
  })

  it('loadUserNovels 调 /v1/user/novels 带 user_id + filter=for_ios', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ novels: [], next_url: null })
    await loadUserNovels(7)
    expect(spy).toHaveBeenCalledWith('/v1/user/novels', { user_id: '7', filter: 'for_ios' }, undefined)
  })

  it('loadUserNovels 失败透传 reject', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('server 500'))
    await expect(loadUserNovels(7)).rejects.toThrow('server 500')
  })
})

// ─── P0-T4：关注 Feed API 契约（/v2/illust/follow，对齐主项目 api/illust.ts） ───
describe('P0-T4 关注 Feed API 契约', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loadFollow 默认 restrict=public，可传 private', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ illusts: [], next_url: null })
    await loadFollow()
    expect(spy).toHaveBeenCalledWith('/v2/illust/follow', { restrict: 'public' }, undefined)
    await loadFollow('private')
    expect(spy).toHaveBeenCalledWith('/v2/illust/follow', { restrict: 'private' }, undefined)
  })

  it('loadFollow 失败透传 reject', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('403 forbidden'))
    await expect(loadFollow()).rejects.toThrow('403 forbidden')
  })
})

// ─── P0-T6：收藏列表 API 契约（/v1/user/bookmarks/illust|novel，对齐主项目） ───
describe('P0-T6 收藏列表 API 契约', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loadBookmarks(illust) 调 /v1/user/bookmarks/illust 带 user_id + restrict', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ illusts: [], next_url: null })
    await loadBookmarks(123)
    expect(spy).toHaveBeenCalledWith('/v1/user/bookmarks/illust', { user_id: '123', restrict: 'public' }, undefined)
    await loadBookmarks(123, 'private')
    expect(spy).toHaveBeenCalledWith('/v1/user/bookmarks/illust', { user_id: '123', restrict: 'private' }, undefined)
  })

  it('loadBookmarks(illust) 失败透传 reject', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('401'))
    await expect(loadBookmarks(123)).rejects.toThrow('401')
  })

  it('loadBookmarks(novel) 调 /v1/user/bookmarks/novel 带 user_id + restrict', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ novels: [], next_url: null })
    await loadNovelBookmarks(123)
    expect(spy).toHaveBeenCalledWith('/v1/user/bookmarks/novel', { user_id: '123', restrict: 'public' }, undefined)
  })

  it('loadBookmarks(novel) 失败透传 reject', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('server 500'))
    await expect(loadNovelBookmarks(123)).rejects.toThrow('server 500')
  })
})

// ─── P0-T2/T3：关注/粉丝列表 + 关注操作 API 契约（对齐主项目 api/user.ts|illust.ts） ───
describe('P0-T2/T3 关注 API 契约', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('getUserFollowing 调 /v1/user/following 带 user_id + restrict，可带 offset', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ user_previews: [], next_url: null })
    await getUserFollowing(5)
    expect(spy).toHaveBeenCalledWith('/v1/user/following', { user_id: '5', restrict: 'public' })
    await getUserFollowing(5, 10)
    expect(spy).toHaveBeenCalledWith('/v1/user/following', { user_id: '5', restrict: 'public', offset: '10' })
  })

  it('getUserFollowers 调 /v1/user/follower 带 user_id', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ user_previews: [], next_url: null })
    await getUserFollowers(5)
    expect(spy).toHaveBeenCalledWith('/v1/user/follower', { user_id: '5' })
  })

  it('getUserFollowing 失败透传 reject', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('403'))
    await expect(getUserFollowing(5)).rejects.toThrow('403')
  })

  it('followUser POST /v1/user/follow/add 带 user_id + restrict', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(undefined)
    await followUser(5)
    expect(spy).toHaveBeenCalledWith('/v1/user/follow/add', { user_id: '5', restrict: 'public' })
    await followUser(5, 'private')
    expect(spy).toHaveBeenCalledWith('/v1/user/follow/add', { user_id: '5', restrict: 'private' })
  })

  it('unfollowUser POST /v1/user/follow/delete 带 user_id', async () => {
    const spy = vi.spyOn(apiClient, 'post').mockResolvedValue(undefined)
    await unfollowUser(5)
    expect(spy).toHaveBeenCalledWith('/v1/user/follow/delete', { user_id: '5' })
  })

  it('followUser 失败透传 reject', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('rate limited'))
    await expect(followUser(5)).rejects.toThrow('rate limited')
  })
})

// ─── P0-T2：loadUserListNext 分页契约 ───
describe('P0-T2 关注列表分页', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loadUserListNext 透传 next_url 完整 URL（保留 query）', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ user_previews: [], next_url: null })
    await loadUserListNext('/pixiv-api/v1/user/following?user_id=5&offset=10')
    expect(spy).toHaveBeenCalledWith('/pixiv-api/v1/user/following?user_id=5&offset=10')
  })
})

// ─── P0-T5：小说关注 API 契约（/v1/novel/follow，对齐主项目 api/novel.ts） ───
describe('P0-T5 小说关注 API 契约', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loadFollow(novel) 调 /v1/novel/follow 带 restrict', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ novels: [], next_url: null })
    await loadNovelFollow()
    expect(spy).toHaveBeenCalledWith('/v1/novel/follow', { restrict: 'public' })
    await loadNovelFollow('private')
    expect(spy).toHaveBeenCalledWith('/v1/novel/follow', { restrict: 'private' })
  })

  it('loadFollow(novel) 失败透传 reject', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('403'))
    await expect(loadNovelFollow()).rejects.toThrow('403')
  })
})

// ─── T5：Ugoira 播放管线契约（bytesToDataUrl + downloadUgoiraFrames） ───
function u16(v: number, out: number[]): void {
  out.push(v & 0xff, (v >> 8) & 0xff)
}
function u32(v: number, out: number[]): void {
  out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff)
}
function nameBytes(name: string, out: number[]): void {
  for (let i = 0; i < name.length; i++) out.push(name.charCodeAt(i))
}
function buildStoreZip(frames: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: number[] = []
  const localOffsets: number[] = []
  for (const f of frames) {
    localOffsets.push(parts.length)
    u32(0x04034b50, parts)
    u16(20, parts); u16(0, parts); u16(0, parts)
    u16(0, parts); u16(0, parts); u32(0, parts)
    u32(f.data.length, parts); u32(f.data.length, parts)
    u16(f.name.length, parts); u16(0, parts)
    nameBytes(f.name, parts)
    for (const b of f.data) parts.push(b)
  }
  const cdStart = parts.length
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!
    u32(0x02014b50, parts)
    u16(20, parts); u16(20, parts); u16(0, parts); u16(0, parts)
    u16(0, parts); u16(0, parts); u32(0, parts)
    u32(f.data.length, parts); u32(f.data.length, parts)
    u16(f.name.length, parts); u16(0, parts); u16(0, parts)
    u16(0, parts); u16(0, parts); u32(0, parts)
    u32(localOffsets[i]!, parts)
    nameBytes(f.name, parts)
  }
  const cdSize = parts.length - cdStart
  u32(0x06054b50, parts)
  u16(0, parts); u16(0, parts); u16(frames.length, parts); u16(frames.length, parts)
  u32(cdSize, parts); u32(cdStart, parts); u16(0, parts)
  return new Uint8Array(parts)
}

describe('T5 Ugoira 播放管线契约', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('bytesToDataUrl 转 base64 data URL（内容可解码回原字节）', () => {
    const url = bytesToDataUrl(new Uint8Array([1, 2, 3]), 'image/png')
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    const bin = atob(url.split(',')[1]!)
    expect([...bin].map((c) => c.charCodeAt(0))).toEqual([1, 2, 3])
  })

  it('downloadUgoiraFrames：metadata + zip 下载 + 共享包取帧 → data URL', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      ugoira_metadata: {
        zip_urls: { medium: 'https://i.pximg.net/img-zip-ugoira/z.zip' },
        frames: [
          { file: 'frame_0.png', delay: 100 },
          { file: 'frame_1.png', delay: 120 },
        ],
      },
    })
    const zip = buildStoreZip([
      { name: 'frame_0.png', data: new Uint8Array([1, 2, 3]) },
      { name: 'frame_1.png', data: new Uint8Array([4, 5]) },
    ])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(zip, { status: 200 })))
    const frames = await downloadUgoiraFrames(123)
    expect(frames).toHaveLength(2)
    expect(frames[0]!.delay).toBe(100)
    expect(frames[0]!.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('downloadUgoiraFrames：zip 下载失败 → 抛错', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      ugoira_metadata: { zip_urls: { medium: 'https://i.pximg.net/z.zip' }, frames: [] },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    await expect(downloadUgoiraFrames(123)).rejects.toThrow('HTTP 500')
  })
})

// ─── T6：动图播放方案设置 + range 取帧契约 ───
describe('T6 动图播放方案', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('settingsStore.ugoiraMode 默认 fflate，setUgoiraMode 更新', () => {
    expect(lynxUgoiraMode.value).toBe('fflate')
    lynxSetUgoiraMode('range')
    expect(lynxUgoiraMode.value).toBe('range')
  })

  it('downloadUgoiraFrames range 模式：GET+Range 试探长度 → 尾部目录 → 取帧', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      ugoira_metadata: {
        zip_urls: { medium: 'https://i.pximg.net/z.zip' },
        frames: [
          { file: 'frame_0.png', delay: 100 },
          { file: 'frame_1.png', delay: 120 },
        ],
      },
    })
    const zip = buildStoreZip([
      { name: 'frame_0.png', data: new Uint8Array([1, 2, 3]) },
      { name: 'frame_1.png', data: new Uint8Array([4, 5]) },
    ])
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range
      // bytes=0-0 试探：返回 content-range 总长
      if (range === 'bytes=0-0') {
        return new Response(zip.slice(0, 1), {
          status: 206,
          headers: { 'content-range': `bytes 0-0/${zip.length}` },
        })
      }
      const m = /bytes=(\d+)-(\d+)/.exec(range ?? '')
      if (m) {
        const s = parseInt(m[1]!, 10)
        const e = parseInt(m[2]!, 10)
        return new Response(zip.slice(s, e + 1), { status: 206 })
      }
      return new Response(zip, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const frames = await downloadUgoiraFrames(123, 'range')
    expect(frames).toHaveLength(2)
    expect(frames[0]!.delay).toBe(100)
    expect(frames[0]!.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    // 断言发过 bytes=0-0 试探（原生 HEAD 规避）
    expect(fetchMock.mock.calls.some(([, i]) => (i?.headers as Record<string, string> | undefined)?.Range === 'bytes=0-0')).toBe(true)
  })

  it('downloadUgoiraFrames range 模式：非 206 → 降级 fflate（warn）', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      ugoira_metadata: {
        zip_urls: { medium: 'https://i.pximg.net/z.zip' },
        frames: [{ file: 'frame_0.png', delay: 100 }],
      },
    })
    const zip = buildStoreZip([{ name: 'frame_0.png', data: new Uint8Array([1, 2, 3]) }])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // range 试探返回 200（非 206）→ range 失败 → 降级 fflate 全量下载
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(zip, { status: 200 })))
    const frames = await downloadUgoiraFrames(123, 'range')
    expect(frames).toHaveLength(1)
    expect(frames[0]!.delay).toBe(100)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('降级 fflate'), expect.anything())
  })
})

// ─── 回归：OAuth 凭证注入 fail-closed 门禁 ───
// 背景：6a3550a 把 __CREDENTIALS__ 改为条件注入（未设 PICTELIO_LYNX_DEV=1 时为空占位符），
// 而 vue-lynx 插件覆盖 __DEV__ 为 dev 恒 true，导致 auth.ts 的 !__DEV__ 门禁失效，
// 空凭证请求照常外发 → Pixiv 400 invalid_client。
// 修复：oauthTokenRequest 内调用 isOAuthCredsInjected() 二次校验（双保险）。
describe('auth.isOAuthCredsInjected（凭证注入门禁回归）', () => {
  it('空占位符凭证（未设 PICTELIO_LYNX_DEV=1 的构建）→ false，拒绝外发', () => {
    expect(
      isOAuthCredsInjected({ clientId: '', clientSecret: '', hashSecret: '', appOs: '', appOsVersion: '' }),
    ).toBe(false)
  })

  it('部分凭证缺失 → false（clientId 为空即拒绝）', () => {
    expect(
      isOAuthCredsInjected({ clientId: '', clientSecret: 'x', hashSecret: 'y', appOs: 'ios', appOsVersion: '18.5' }),
    ).toBe(false)
  })

  it('完整凭证（真实 dev 注入形态）→ true', () => {
    expect(
      isOAuthCredsInjected({ clientId: 'c', clientSecret: 's', hashSecret: 'h', appOs: 'ios', appOsVersion: '18.5' }),
    ).toBe(true)
  })
})

// ─── Me 页 accessibility 标注（issue #103 / ADR-0061） ───
// Lynx 侧元素需 accessibility-element + accessibility-label 才能被 Appium 定位。
// 单测约定（注册表完整性）：
//   1. 注册表 label 必须非空且唯一（Appium 定位要求可区分）；
//   2. Me.vue 模板必须消费全部注册表 label（漏标注 → 测试失败）。
// 注意：vue-lynx 在 node 环境无法直接断言渲染产物属性（依赖 Lynx runtime op 队列），
// 这里以「注册表 + 模板源码断言」作为最小可行验证，真实暴露行为由模拟器 E2E 兜底。
describe('Me 页 accessibility 标注注册表（issue #103）', () => {
  const meVueSource = readFileSync(fileURLToPath(new URL('../src/pages/Me.vue', import.meta.url)), 'utf8')

  it('注册表 label 全部非空且唯一', () => {
    const labels = Object.values(ME_A11Y_LABELS)
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) expect(label.length).toBeGreaterThan(0)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('accessibility-element 常量恒为 true（模板据此开启暴露）', () => {
    expect(A11Y_ELEMENT_ENABLED).toBe(true)
  })

  it('注册表 label 全部被 Me.vue 模板消费（纯增量标注，漏一个即失败）', () => {
    for (const key of Object.keys(ME_A11Y_LABELS)) {
      expect(meVueSource).toContain(`:accessibility-label="ME_A11Y_LABELS.${key}"`)
    }
  })

  it('每个 accessibility-label 都配套开启 accessibility-element（view 默认不进 a11y 树）', () => {
    // 模板里每处 label 引用都必须伴随 element 开启，且数量与注册表严格一致，
    // 防止「登记了 label 却漏开 element」或「绕过注册表硬编码 label」。
    const labelCount = (meVueSource.match(/:accessibility-label="ME_A11Y_LABELS\.\w+"/g) ?? []).length
    const elementCount = (meVueSource.match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g) ?? []).length
    expect(labelCount).toBe(Object.keys(ME_A11Y_LABELS).length)
    expect(elementCount).toBe(labelCount)
  })

  it('「切回 WebView」入口与页面标题标注存在（模拟器 E2E 双向闭环锚点）', () => {
    expect(ME_A11Y_LABELS.switchToWebview).toBe('切换客户端到WebView')
    expect(ME_A11Y_LABELS.pageTitle).toBe('我的')
  })
})

// ─── Login / Recommended 页 accessibility 标注（issue #107 双向闭环前置） ───
// Lynx E2E 需要：Login 页注入 token + 提交、Recommended 页导航到 Me。
// 与 Me 页同一套「注册表 + 模板源码断言」约定。
describe('Login / Recommended 页 accessibility 标注（issue #107）', () => {
  const loginVue = readFileSync(fileURLToPath(new URL('../src/pages/Login.vue', import.meta.url)), 'utf8')
  const recommendedVue = readFileSync(fileURLToPath(new URL('../src/pages/Recommended.vue', import.meta.url)), 'utf8')

  it('LOGIN_A11Y_LABELS 全部被 Login.vue 消费且配套 element', () => {
    for (const key of Object.keys(LOGIN_A11Y_LABELS)) {
      expect(loginVue).toContain(`:accessibility-label="LOGIN_A11Y_LABELS.${key}"`)
    }
    const labelCount = (loginVue.match(/:accessibility-label="LOGIN_A11Y_LABELS\.\w+"/g) ?? []).length
    const elementCount = (loginVue.match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g) ?? []).length
    expect(labelCount).toBe(Object.keys(LOGIN_A11Y_LABELS).length)
    expect(elementCount).toBe(labelCount)
  })

  it('RECOMMENDED_A11Y_LABELS 全部被 Recommended.vue 消费且配套 element', () => {
    for (const key of Object.keys(RECOMMENDED_A11Y_LABELS)) {
      expect(recommendedVue).toContain(`:accessibility-label="RECOMMENDED_A11Y_LABELS.${key}"`)
    }
    const labelCount = (recommendedVue.match(/:accessibility-label="RECOMMENDED_A11Y_LABELS\.\w+"/g) ?? []).length
    const elementCount = (recommendedVue.match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g) ?? []).length
    expect(labelCount).toBe(Object.keys(RECOMMENDED_A11Y_LABELS).length)
    expect(elementCount).toBe(labelCount)
  })
})

const { normalizeKinds, supportsClientSwitch } = await import('../src/stores/clientSwitchStore')

describe('clientSwitchStore.normalizeKinds / supportsClientSwitch（ADR-0062 包能力）', () => {

  describe('normalizeKinds', () => {
    it('full 包：["webview","lynx"] → 原样', () => {
      expect(normalizeKinds(['webview', 'lynx'])).toEqual(['webview', 'lynx'])
    })

    it('独立包：["webview"] / ["lynx"] → 原样', () => {
      expect(normalizeKinds(['webview'])).toEqual(['webview'])
      expect(normalizeKinds(['lynx'])).toEqual(['lynx'])
    })

    it('含非法值 → 剔除', () => {
      expect(normalizeKinds(['webview', 'bogus'])).toEqual(['webview'])
    })

    it('非数组 / 空数组 → null', () => {
      expect(normalizeKinds(null)).toBeNull()
      expect(normalizeKinds(undefined)).toBeNull()
      expect(normalizeKinds([])).toBeNull()
      expect(normalizeKinds('webview')).toBeNull()
    })
  })

  describe('supportsClientSwitch', () => {
    it('full 包（webview+lynx）→ true', () => {
      expect(supportsClientSwitch(['webview', 'lynx'])).toBe(true)
    })

    it('webview-only → false', () => {
      expect(supportsClientSwitch(['webview'])).toBe(false)
    })

    it('lynx-only → false', () => {
      expect(supportsClientSwitch(['lynx'])).toBe(false)
    })

    it('null（未知）→ true（保守渲染）', () => {
      expect(supportsClientSwitch(null)).toBe(true)
    })
  })

  describe('initClientSetting（ADR-0062：原生能力查询填充 availableKinds）', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      vi.resetModules()
    })

    it('full 包：getClientKinds 返回 [webview,lynx] → availableKinds 填充', async () => {
      vi.stubGlobal('NativeModules', {
        PictelioApp: {
          getClientKinds: (cb: (kinds: string[], err: string | null) => void) => cb(['webview', 'lynx'], null),
          getClientKind: (cb: (kind: string, err: string | null) => void) => cb('webview', null),
        },
      })
      const mod = await import('../src/stores/clientSwitchStore')
      mod.initClientSetting()
      await new Promise((r) => setTimeout(r, 0))
      expect(mod.availableKinds.value).toEqual(['webview', 'lynx'])
      expect(mod.supportsClientSwitch(mod.availableKinds.value)).toBe(true)
    })

    it('lynx-only 包：getClientKinds 返回 [lynx] → availableKinds=[lynx]，切换不支持', async () => {
      vi.stubGlobal('NativeModules', {
        PictelioApp: {
          getClientKinds: (cb: (kinds: string[], err: string | null) => void) => cb(['lynx'], null),
          getClientKind: (cb: (kind: string, err: string | null) => void) => cb('lynx', null),
        },
      })
      const mod = await import('../src/stores/clientSwitchStore')
      mod.initClientSetting()
      await new Promise((r) => setTimeout(r, 0))
      expect(mod.availableKinds.value).toEqual(['lynx'])
      expect(mod.supportsClientSwitch(mod.availableKinds.value)).toBe(false)
    })

    it('webview-only 包：getClientKinds 返回 [webview] → 切换不支持', async () => {
      vi.stubGlobal('NativeModules', {
        PictelioApp: {
          getClientKinds: (cb: (kinds: string[], err: string | null) => void) => cb(['webview'], null),
          getClientKind: (cb: (kind: string, err: string | null) => void) => cb('webview', null),
        },
      })
      const mod = await import('../src/stores/clientSwitchStore')
      mod.initClientSetting()
      await new Promise((r) => setTimeout(r, 0))
      expect(mod.availableKinds.value).toEqual(['webview'])
      expect(mod.supportsClientSwitch(mod.availableKinds.value)).toBe(false)
    })
  })
})

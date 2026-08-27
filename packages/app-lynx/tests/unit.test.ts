// ─── app-lynx 单元测试（Vitest，node 环境） ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { proxyImageUrl, thumbUrl } from '../src/utils/imageUrl'
import { classifyError, isNativeMode, isOAuthTokenErrorResponse, rewriteUrl, shouldAttachAuth } from '../src/api/client'
import { ApiErrorType } from '../src/api/types'
import { extractNovelTextFromHtml } from '../src/api/novel'
import { matchRoute, evaluateSystemBack, evaluateBackWithBehavior, SYSTEM_BACK_EXIT_WINDOW_MS, runBackGuards, createBackGuardRegistry, evaluateBackRoute, type BackGuard } from '../src/routerCore'
import { redactProxyUrl } from '../src/utils/proxyRedact'
import { apiClient } from '../src/api/client'
import { isOAuthCredsInjected } from '../src/api/auth'
import { getUserDetail, getUserFollowing, getUserFollowers, followUser, unfollowUser, loadUserListNext } from '../src/api/user'
import { loadUserIllusts, loadFollow, loadBookmarks } from '../src/api/illust'
import { loadUserNovels, loadBookmarks as loadNovelBookmarks, loadFollow as loadNovelFollow } from '../src/api/novel'
import { bytesToDataUrl, downloadUgoiraFrames } from '../src/api/ugoira'
import type { UgoiraExtractMode } from '../src/api/ugoira'
import { ugoiraMode as lynxUgoiraMode, setUgoiraMode as lynxSetUgoiraMode } from '../src/stores/settingsStore'
import { ME_A11Y_LABELS, LOGIN_A11Y_LABELS, RECOMMENDED_A11Y_LABELS, UPDATE_A11Y_LABELS, ERROR_A11Y_LABELS, FAB_MENU_A11Y_LABELS, WATCHLIST_A11Y_LABELS, WATCHLIST_PROMPT_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../src/utils/accessibility'

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

  // security-review #165：非 Pixiv 域绝对 URL 拒绝加载（防外部/内网地址探测面）
  it('非 Pixiv 域绝对 URL → 返回空串（拒绝加载）', () => {
    expect(proxyImageUrl('https://evil.example.com/steal.jpg')).toBe('')
    expect(proxyImageUrl('https://i.pximg.net.evil.com/x.jpg')).toBe('')
    expect(proxyImageUrl('not-a-url')).toBe('')
  })

  it('pximg/pixiv 域绝对 URL 处理正确（代理化或原样）', () => {
    // i.pximg.net → 既有 marker 代理化（不变）
    expect(proxyImageUrl('https://i.pximg.net/medium.jpg')).toBe('/pixiv-img/medium.jpg')
    // 其他 pximg/pixiv 域（无 marker）→ 白名单内原样返回
    expect(proxyImageUrl('https://s.pximg.net/sm.jpg')).toBe('https://s.pximg.net/sm.jpg')
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

  it('rewriteUrl 相对 API 路径原样透传（插件内部拼 apiBase，ADR-0104）', () => {
    vi.stubGlobal('NativeModules', { PictelioApp: {} })
    expect(rewriteUrl('/v1/illust/recommended')).toBe('/v1/illust/recommended')
  })

  it('rewriteUrl 绝对 Pixiv URL 剥离域名成相对路径；非 Pixiv 绝对 URL 原样（ADR-0104）', () => {
    vi.stubGlobal('NativeModules', { PictelioApp: {} })
    expect(rewriteUrl('https://app-api.pixiv.net/v1/x')).toBe('/v1/x')
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
    expect(shouldAttachAuth('https://oauth.secure.pixiv.net/auth/token')).toBe(true)
  })

  // security-review #165：原生分支补主机白名单——非 Pixiv 域绝对 URL 不得附加 Bearer
  it('shouldAttachAuth 原生模式 + 非 Pixiv 域绝对 URL → 不附加 Bearer', () => {
    vi.stubGlobal('NativeModules', { PictelioApp: {} })
    expect(shouldAttachAuth('https://evil.example.com/steal')).toBe(false)
    expect(shouldAttachAuth('https://app-api.pixiv.net.evil.com/x')).toBe(false)
    expect(shouldAttachAuth('not-a-url')).toBe(false)
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

describe('routerCore.evaluateBackWithBehavior（更新页 backBehavior: exit）', () => {
  const now = 1_000_000

  it("backBehavior 'exit' 时恒返回 exit（跳过历史栈与双击窗口）", () => {
    expect(evaluateBackWithBehavior('exit', 3, now - 100, now)).toBe('exit')
    expect(evaluateBackWithBehavior('exit', 0, 0, now)).toBe('exit')
    expect(evaluateBackWithBehavior('exit', 0, now - 5000, now)).toBe('exit')
  })

  it('未声明 backBehavior 时走既有 evaluateSystemBack 逻辑（不回归）', () => {
    expect(evaluateBackWithBehavior(undefined, 1, 0, now)).toBe('navigate')
    expect(evaluateBackWithBehavior(undefined, 0, 0, now)).toBe('hint')
    expect(evaluateBackWithBehavior(undefined, 0, now - 100, now)).toBe('exit')
    expect(evaluateBackWithBehavior(undefined, 0, now - 5000, now)).toBe('hint')
  })
})

// ─── 返回守卫（back-guard）——期望值来源：docs/specs/app-lynx-novel-series-watchlist.md §US3
// 裁决顺序定义（modalStack → backGuard → backBehavior/history），issue #222 验收条件。
describe('routerCore.runBackGuards（守卫短路执行）', () => {
  it('空守卫列表 → 不拦截', () => {
    expect(runBackGuards([])).toBe(false)
  })

  it('全部返回 false → 不拦截', () => {
    expect(runBackGuards([() => false, () => false])).toBe(false)
  })

  it('任一守卫返回 true → 拦截', () => {
    expect(runBackGuards([() => false, () => true])).toBe(true)
  })

  it('短路：首个 true 之后续守卫不再执行', () => {
    const second = vi.fn(() => true)
    expect(runBackGuards([() => true, second])).toBe(true)
    expect(second).not.toHaveBeenCalled()
  })

  it('守卫抛错 → console.warn 记录并按未拦截处理（fail-open，不卡死返回键）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const throwing: BackGuard = () => {
      throw new Error('boom')
    }
    expect(runBackGuards([throwing, () => true])).toBe(true)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toContain('[router]')
    warn.mockRestore()
  })

  it('守卫抛错且无后续拦截守卫 → 整体不拦截', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      runBackGuards([
        () => {
          throw new Error('boom')
        },
      ]),
    ).toBe(false)
    warn.mockRestore()
  })
})

describe('routerCore.createBackGuardRegistry（注册/注销语义）', () => {
  it('注册后守卫生效，注销函数移除守卫', () => {
    const registry = createBackGuardRegistry()
    const guard = vi.fn(() => true)
    const unregister = registry.register(guard)
    expect(runBackGuards(registry.guards())).toBe(true)
    unregister()
    expect(registry.guards()).toHaveLength(0)
    expect(runBackGuards(registry.guards())).toBe(false)
  })

  it('重复注销安全（不报错、不误删同名守卫之外的内容）', () => {
    const registry = createBackGuardRegistry()
    const unregister = registry.register(() => true)
    unregister()
    expect(() => unregister()).not.toThrow()
    expect(registry.guards()).toHaveLength(0)
  })

  it('多守卫按注册序执行，注销中间守卫不影响顺序', () => {
    const registry = createBackGuardRegistry()
    const calls: string[] = []
    registry.register(() => {
      calls.push('a')
      return false
    })
    const unregB = registry.register(() => {
      calls.push('b')
      return true
    })
    registry.register(() => {
      calls.push('c')
      return false
    })
    expect(runBackGuards(registry.guards())).toBe(true)
    expect(calls).toEqual(['a', 'b']) // c 被 b 短路
    calls.length = 0
    unregB()
    expect(runBackGuards(registry.guards())).toBe(false)
    expect(calls).toEqual(['a', 'c'])
  })
})

describe('routerCore.evaluateBackRoute（系统返回完整裁决顺序）', () => {
  const now = 1_000_000
  const base = { behavior: undefined, historyLength: 1, lastBackAt: 0, now }

  it('modalStack 有打开弹层 → close-modal，守卫不被执行（modal 优先于 guard）', () => {
    const runGuards = vi.fn(() => true)
    expect(evaluateBackRoute({ ...base, hasOpenModal: true, runGuards })).toBe('close-modal')
    expect(runGuards).not.toHaveBeenCalled()
  })

  it('无弹层且守卫拦截 → intercepted（守卫消费，裁决不再进入历史栈分支）', () => {
    // historyLength=1 时若守卫未拦截本应 navigate；intercepted 说明历史栈不会被 pop
    expect(evaluateBackRoute({ ...base, hasOpenModal: false, runGuards: () => true })).toBe('intercepted')
  })

  it('无弹层且守卫放行 → 落到既有 ADR-0066 决策（navigate）', () => {
    const runGuards = vi.fn(() => false)
    expect(evaluateBackRoute({ ...base, hasOpenModal: false, runGuards })).toBe('navigate')
    expect(runGuards).toHaveBeenCalledOnce()
  })

  it('回归：backBehavior exit 优先于历史栈与双击窗口（守卫放行时行为不变）', () => {
    expect(
      evaluateBackRoute({ hasOpenModal: false, runGuards: () => false, behavior: 'exit', historyLength: 3, lastBackAt: 0, now }),
    ).toBe('exit')
  })

  it('回归：根路由双击退出窗口（守卫放行时行为不变）', () => {
    expect(
      evaluateBackRoute({ hasOpenModal: false, runGuards: () => false, behavior: undefined, historyLength: 0, lastBackAt: now - 100, now }),
    ).toBe('exit')
    expect(
      evaluateBackRoute({ hasOpenModal: false, runGuards: () => false, behavior: undefined, historyLength: 0, lastBackAt: 0, now }),
    ).toBe('hint')
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
import { readFileSync, existsSync } from 'node:fs'
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

  it('loadFollow(novel) 调 /v1/novel/follow 带 restrict（signal 可选参，ADR-0104）', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue({ novels: [], next_url: null })
    await loadNovelFollow()
    expect(spy).toHaveBeenCalledWith('/v1/novel/follow', { restrict: 'public' }, undefined)
    await loadNovelFollow('private')
    expect(spy).toHaveBeenCalledWith('/v1/novel/follow', { restrict: 'private' }, undefined)
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

  it('RECOMMENDED_A11Y_LABELS 经 navTabs 传入 NavigationBar（M3 底部导航）', () => {
    // M3 改造后「我的」入口从顶栏文字链接移入底部导航：注册表 label 在 script 的
    // navTabs 数组中消费（a11yLabel 字段），NavigationBar 组件内部对每个 tab 渲染
    // accessibility-element + accessibility-label="tab.a11yLabel"（有独立组件级断言）。
    for (const key of Object.keys(RECOMMENDED_A11Y_LABELS)) {
      expect(recommendedVue).toContain(`RECOMMENDED_A11Y_LABELS.${key}`)
    }
    expect(recommendedVue).toContain('NavigationBar')
    expect(recommendedVue).toContain(':tabs="navTabs"')
    // NavigationBar 组件内部必须为每个 tab 开启 element + label
    const navBarVue = readFileSync(fileURLToPath(new URL('../src/components/NavigationBar.vue', import.meta.url)), 'utf8')
    expect(navBarVue).toContain(':accessibility-element="A11Y_ELEMENT_ENABLED"')
    expect(navBarVue).toContain(':accessibility-label="tab.a11yLabel"')
  })
})

// ─── Update 页 accessibility 标注（检查更新：强制更新页的退出/下载按钮） ───
// 与页面级同一套「注册表 + 模板源码断言」约定。
describe('Update 页 accessibility 标注（检查更新）', () => {
  const updateVueSource = readFileSync(fileURLToPath(new URL('../src/pages/UpdatePage.vue', import.meta.url)), 'utf8')

  it('UPDATE_A11Y_LABELS 全部被 UpdatePage.vue 消费且配套 element', () => {
    for (const key of Object.keys(UPDATE_A11Y_LABELS)) {
      expect(updateVueSource).toContain(`:accessibility-label="UPDATE_A11Y_LABELS.${key}"`)
    }
    const labelCount = (updateVueSource.match(/:accessibility-label="UPDATE_A11Y_LABELS\.\w+"/g) ?? []).length
    const elementCount = (updateVueSource.match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g) ?? []).length
    expect(labelCount).toBe(Object.keys(UPDATE_A11Y_LABELS).length)
    expect(elementCount).toBe(labelCount)
  })
})

// ─── 追更列表页 accessibility 标注（issue #225） ───
// 与 Me 页同一套「注册表 + 模板源码断言」约定：漏标注或绕过注册表硬编码均失败。
describe('追更列表页 accessibility 标注（issue #225）', () => {
  const watchlistVueSource = readFileSync(fileURLToPath(new URL('../src/pages/Watchlist.vue', import.meta.url)), 'utf8')

  it('注册表 label 全部非空且唯一', () => {
    const labels = Object.values(WATCHLIST_A11Y_LABELS)
    expect(labels.length).toBeGreaterThan(0)
    for (const label of labels) expect(label.length).toBeGreaterThan(0)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('WATCHLIST_A11Y_LABELS 全部被 Watchlist.vue 消费且配套 element', () => {
    for (const key of Object.keys(WATCHLIST_A11Y_LABELS)) {
      expect(watchlistVueSource).toContain(`:accessibility-label="WATCHLIST_A11Y_LABELS.${key}"`)
    }
    const labelCount = (watchlistVueSource.match(/:accessibility-label="WATCHLIST_A11Y_LABELS\.\w+"/g) ?? []).length
    const elementCount = (watchlistVueSource.match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g) ?? []).length
    expect(labelCount).toBe(Object.keys(WATCHLIST_A11Y_LABELS).length)
    expect(elementCount).toBe(labelCount)
  })

  it('mask 条目分支存在且不可点（spec §6-7：只读展示 mask_text）', () => {
    expect(watchlistVueSource).toContain('isWatchlistSeriesMasked(item)')
    // mask 分支在 openLatest 绑定之前出现（v-if mask / v-else 正常条目）
    expect(watchlistVueSource.indexOf('isWatchlistSeriesMasked(item')).toBeLessThan(
      watchlistVueSource.indexOf('@tap="openLatest(item)"'),
    )
  })
})

describe('会话失效错误页 accessibility 标注（候选 #2）', () => {
  const errorVueSource = readFileSync(fileURLToPath(new URL('../src/pages/ErrorPage.vue', import.meta.url)), 'utf8')

  it('ERROR_A11Y_LABELS 全部被 ErrorPage.vue 消费且配套 element', () => {
    for (const key of Object.keys(ERROR_A11Y_LABELS)) {
      expect(errorVueSource).toContain(`:accessibility-label="ERROR_A11Y_LABELS.${key}"`)
    }
    const labelCount = (errorVueSource.match(/:accessibility-label="ERROR_A11Y_LABELS\.\w+"/g) ?? []).length
    const elementCount = (errorVueSource.match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g) ?? []).length
    expect(labelCount).toBe(Object.keys(ERROR_A11Y_LABELS).length)
    expect(elementCount).toBe(labelCount)
  })
})

describe('RefreshableList 组件结构（ADR-0111 M3 FAB menu）', () => {
  const refreshableListSource = readFileSync(fileURLToPath(new URL('../src/components/RefreshableList.vue', import.meta.url)), 'utf8')

  it('FAB_MENU_A11Y_LABELS 全部被消费且配套 element', () => {
    // RefreshableList 静态消费三项（toggleMenu/refreshList/backToTop，ADR-0111）；
    // 按钮分页扩展项（prevPage/nextPage，ADR-0114）由页面经 :items 传入，故在页面侧断言。
    for (const key of ['toggleMenu', 'refreshList', 'backToTop'] as const) {
      expect(refreshableListSource).toContain(`:accessibility-label="FAB_MENU_A11Y_LABELS.${key}"`)
    }
    // 页面侧消费注册表扩展键（Recommended.vue 的 fabMenuItems accessibilityLabel）
    const recommendedVue = readFileSync(fileURLToPath(new URL('../src/pages/Recommended.vue', import.meta.url)), 'utf8')
    expect(recommendedVue).toContain('FAB_MENU_A11Y_LABELS.prevPage')
    expect(recommendedVue).toContain('FAB_MENU_A11Y_LABELS.nextPage')
    const labelCount = (refreshableListSource.match(/:accessibility-label="FAB_MENU_A11Y_LABELS\.\w+"/g) ?? []).length
    // T4 扩展项（上一页/下一页）用动态 label（item.accessibilityLabel）同样配套 element：
    // element 总数 = 固定 label 数 + 扩展项 v-for 内动态 label 数
    const dynamicLabelCount = (refreshableListSource.match(/:accessibility-label="item\.accessibilityLabel"/g) ?? []).length
    const elementCount = (refreshableListSource.match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g) ?? []).length
    expect(labelCount).toBe(3) // RefreshableList 静态消费三项（扩展键由页面消费）
    expect(dynamicLabelCount).toBe(1)
    expect(elementCount).toBe(labelCount + dynamicLabelCount)
  })

  it('T4 扩展菜单项：props.items 配置渲染（visible 显隐 + 回调 + busy 互斥）', () => {
    expect(refreshableListSource).toContain('items?: FabMenuExtraItem[]')
    expect(refreshableListSource).toContain('v-for="item in props.items"')
    expect(refreshableListSource).toContain('v-if="item.visible()"')
    expect(refreshableListSource).toContain('@tap="onExtraItemTap(item)"')
    expect(refreshableListSource).toContain('onExtraItemTap(item: FabMenuExtraItem)')
    expect(refreshableListSource).toContain('item-rise-extra')
    // 异步回调复用 busy 维度（与刷新同互斥规则）：操作中禁展开/禁其他项
    expect(refreshableListSource).toContain('menu.startRefresh()')
    expect(refreshableListSource).toContain('menu.endRefresh()')
    expect(refreshableListSource).toContain('refreshing.value || menu.isBusy')
  })

  it('已移除旧 REFRESH_A11Y_LABELS / BACK_TO_TOP_A11Y_LABELS 引用（ADR-0111 替换）', () => {
    expect(refreshableListSource).not.toContain('REFRESH_A11Y_LABELS')
    expect(refreshableListSource).not.toContain('BACK_TO_TOP_A11Y_LABELS')
  })

  it('模板包含 M3 FAB menu 关键结构：scrim、两项菜单、close button 图标切换', () => {
    expect(refreshableListSource).toContain('v-if="menu.isOpen"')
    expect(refreshableListSource).toContain('FAB_MENU_A11Y_LABELS.refreshList')
    expect(refreshableListSource).toContain('FAB_MENU_A11Y_LABELS.backToTop')
    expect(refreshableListSource).toContain('↻')
    expect(refreshableListSource).toContain('↑')
    expect(refreshableListSource).toContain('{{ menu.isOpen ? \'✕\' : \'↻\' }}')
  })

  it('回顶通过 emit(\'back-to-top\') 与页面契约连接', () => {
    expect(refreshableListSource).toContain("emit('back-to-top')")
  })

  it('未复用已废弃的 <refresh> XElement（ADR-0107）', () => {
    expect(refreshableListSource).not.toContain('<refresh')
  })

  it('FAB menu 状态机通过 createFabMenuState 接入，刷新逻辑仍保留 try/finally 复位', () => {
    expect(refreshableListSource).toContain('createFabMenuState')
    expect(refreshableListSource).toContain('finally')
    expect(refreshableListSource).toContain('menu.endRefresh')
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

// ─── 会话失效触发错误页（候选 #2：reportSessionError 触发链） ───
describe('authStore 会话失效触发错误页（候选 #2）', () => {
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
    vi.restoreAllMocks()
  })

  it('登录页输入错误 token 不触发 reportSessionError（内联错误是正确行为）', async () => {
    // 非 hoisted mock：仅本测试生效，不影响其他 authStore describe
    vi.doMock('../src/api/auth', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/api/auth')>()
      return {
        ...actual,
        loginWithRefreshToken: vi.fn(async () => {
          const e = new Error('登录凭证已失效，请重新登录 (HTTP 400)') as Error & { type?: string }
          e.type = ApiErrorType.UNAUTHORIZED
          throw e
        }),
      }
    })
    const spy = vi
      .spyOn(await import('../src/utils/errorPresentation'), 'reportSessionError')
      .mockImplementation(() => {})
    const { loginWithToken } = await import('../src/stores/authStore')
    await loginWithToken('bad-token')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('已登录会话 401 刷新失败（unauthorized）→ reportSessionError 被调用', async () => {
    let failNext = false
    vi.doMock('../src/api/auth', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/api/auth')>()
      return {
        ...actual,
        loginWithRefreshToken: vi.fn(async () => {
          if (failNext) {
            const e = new Error('登录凭证已失效，请重新登录 (HTTP 400)') as Error & { type?: string }
            e.type = ApiErrorType.UNAUTHORIZED
            throw e
          }
          return {
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: 3600,
            token_type: 'bearer',
            user: { id: 1, name: 'u', account: 'u', profile_image_urls: {} },
          }
        }),
      }
    })
    // 捕获 client.setOnUnauthorized 注册的 401 刷新 handler
    const clientMod = await import('../src/api/client')
    let captured: ((() => Promise<void>) | null) = null
    const setSpy = vi.spyOn(clientMod, 'setOnUnauthorized').mockImplementation((h) => {
      captured = h as () => Promise<void>
    })
    const spy = vi
      .spyOn(await import('../src/utils/errorPresentation'), 'reportSessionError')
      .mockImplementation(() => {})
    const { loginWithToken, registerUnauthorizedHandler } = await import('../src/stores/authStore')
    // 先登录成功（会话就绪），再注册 401 刷新 handler
    await loginWithToken('good-token')
    registerUnauthorizedHandler()
    expect(captured).not.toBeNull()
    // 触发 401 刷新：此时刷新失败 → 会话失效 → 全屏错误页
    failNext = true
    await captured!()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ type: ApiErrorType.UNAUTHORIZED })
    setSpy.mockRestore()
    spy.mockRestore()
  })

  it('网络类错误（非 unauthorized）不触发 reportSessionError', async () => {
    vi.doMock('../src/api/auth', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/api/auth')>()
      return {
        ...actual,
        loginWithRefreshToken: vi.fn(async () => {
          throw new Error('网络不可用，请检查连接')
        }),
      }
    })
    const spy = vi
      .spyOn(await import('../src/utils/errorPresentation'), 'reportSessionError')
      .mockImplementation(() => {})
    const { loginWithToken } = await import('../src/stores/authStore')
    await loginWithToken('bad-token')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

// ─── RefreshableList 列表操作 FAB menu（ADR-0111，整合 ADR-0107/0108/0110） ───
// 期望值出处（oracle）：
//   - 接口形状（:refresh 函数 prop + slot、防重入、try/finally 复位）= ADR-0111 spec
//   - FAB menu 视觉/行为 = M3 官方 components/fab-menu/* 四页规范
//   - 状态机不变量 = createFabMenu.test.ts 纯逻辑单测
//   - a11y label = src/utils/accessibility.ts 注册表常量（backupRulesConsistency 模式）
//   - 负向断言 = ADR-0107/0110 平台事实（防原生路线/scroll 感知复活）
describe('RefreshableList 列表操作 FAB menu（ADR-0111）', () => {
const refreshableListVue = readFileSync(
  fileURLToPath(new URL('../src/components/RefreshableList.vue', import.meta.url)),
  'utf8',
)

it('接口保持：:refresh prop + @back-to-top 事件 + 默认 slot（9 页零改动）', () => {
  expect(refreshableListVue).toContain('refresh: () => Promise<void> | void')
  expect(refreshableListVue).toContain(`(e: 'back-to-top')`)
  expect(refreshableListVue).not.toContain('refreshing: boolean')
})

it('刷新状态机内收：防重入 guard + try/finally 复位 + 异常 warn 可见（硬约束 #3）', () => {
  expect(refreshableListVue).toContain('if (refreshing.value || menu.isBusy) return')
  expect(refreshableListVue).toContain('await props.refresh()')
  expect(refreshableListVue).toContain('refreshing.value = false')
  expect(refreshableListVue).toContain('menu.endRefresh')
  expect(refreshableListVue).toContain(`console.warn('[RefreshableList]`)
})

it('M3 FAB menu 视觉：主 FAB 56dp + 展开面板 pill 项 + scrim + 从右上角浮出动画', () => {
  expect(refreshableListVue).toContain('w-[14.933vw]')
  expect(refreshableListVue).toContain('rounded-[var(--md-shape-large)]')
  expect(refreshableListVue).toContain('bg-primary-container')
  expect(refreshableListVue).toContain('shadow-[var(--md-elevation-3)]')
  expect(refreshableListVue).toContain('bottom-4 right-4')
  expect(refreshableListVue).toContain('z-30')
  expect(refreshableListVue).toContain('bg-[var(--md-scrim)]')
  expect(refreshableListVue).toContain('v-if="menu.isOpen"')
  expect(refreshableListVue).toContain('menu.isOpen ? \'✕\' : \'↻\'')
  expect(refreshableListVue).toContain('bg-[var(--md-scrim)]')
  expect(refreshableListVue).toContain('rounded-full')
  expect(refreshableListVue).toContain('@keyframes item-rise')
})

it('主 FAB 变身为 close button：图标切换绑定在原位 56dp FAB 上（M3 官方规格）', () => {
  expect(refreshableListVue).toContain("{{ menu.isOpen ? '✕' : '↻' }}")
  // close button 与 FAB 同节点，尺寸不变
  expect(refreshableListVue.match(/w-\[14\.933vw\]/g)?.length).toBeGreaterThanOrEqual(1)
})

it('菜单项：刷新 + 回顶，label 与图标成对，a11y 注册表完整消费', () => {
  expect(refreshableListVue).toContain('FAB_MENU_A11Y_LABELS.refreshList')
  expect(refreshableListVue).toContain('FAB_MENU_A11Y_LABELS.backToTop')
  expect(refreshableListVue).toContain('FAB_MENU_A11Y_LABELS.toggleMenu')
  expect(refreshableListVue).toContain('↻')
  expect(refreshableListVue).toContain('↑')
})

it('刷新中旋转动画：主 FAB 图标在非展开态时旋转（ADR-0108）', () => {
  expect(refreshableListVue).toContain('@keyframes fab-spin')
  expect(refreshableListVue).toMatch(/animation: fab-spin 1s linear infinite/)
  expect(refreshableListVue).toContain('refreshing && !menu.isOpen ? \'fab-spin\'')
  expect(refreshableListVue).toContain('opacity: 0.6')
})

it('回顶通过 emit(@back-to-top) 触发页面重建；保留 1000ms 防重入 + onUnmounted 清理', () => {
  expect(refreshableListVue).toContain(`(e: 'back-to-top')`)
  expect(refreshableListVue).toContain("emit('back-to-top')")
  expect(refreshableListVue).toMatch(/BACK_TO_TOP_RESET_MS = 1000/)
  expect(refreshableListVue).toContain('if (backToTopPending.value) return')
  expect(refreshableListVue).toContain('onUnmounted')
})

it('组件无 refreshEpoch：重建 workaround 必须在页面侧同 tick flush（ADR-0107 D4 实测）', () => {
  expect(refreshableListVue).not.toContain('refreshEpoch')
})

it('负向断言：原生下拉路线零残留 + 旧双 FAB 结构已删 + 感知/直绑通道已删（防复活）', () => {
  expect(refreshableListVue).not.toContain('<refresh')
  expect(refreshableListVue).not.toContain('refresh-header')
  expect(refreshableListVue).not.toContain('createSelectorQuery')
  expect(refreshableListVue).not.toContain('finishRefresh')
  expect(refreshableListVue).not.toContain('PictelioApp')
  expect(refreshableListVue).not.toContain('isNativeMode')
  expect(refreshableListVue).not.toContain('REFRESH_A11Y_LABELS')
  expect(refreshableListVue).not.toContain('BACK_TO_TOP_A11Y_LABELS')
  expect(refreshableListVue).not.toContain('bottom-[25.6vw]')
  expect(refreshableListVue).not.toContain('@keyframes back-to-top-in')
  expect(refreshableListVue).not.toContain('createBackToTopState')
  expect(refreshableListVue).not.toContain('scrollProps')
  expect(refreshableListVue).not.toContain('scroll-to-index')
})
})

// ─── 列表页 RefreshableList 接入（ADR-0107 T3'） ───
// 期望值出处：spec docs/specs/app-lynx-fab-refresh.md「页面改造」节（9 实例 :refresh 绑定表、
// 页面禁自持刷新态红线）；结构断言遵循本文件既有约定。
describe('列表页 RefreshableList 接入（ADR-0107）', () => {
const PAGE_NAMES = [
  'Recommended',
  'IllustList',
  'NovelList',
  'Following',
  'Bookmarks',
  'UserHome',
  'FollowList',
] as const
const pageSources = Object.fromEntries(
  PAGE_NAMES.map((n) => [
    n,
    readFileSync(fileURLToPath(new URL(`../src/pages/${n}.vue`, import.meta.url)), 'utf8'),
  ]),
)

it('7 个列表页全部经 RefreshableList 组件（红线：页面无裸 <refresh> 标签）', () => {
  for (const n of PAGE_NAMES) {
    const src = pageSources[n]
    expect(src, n).toContain('<RefreshableList')
    expect(src, n).toContain(`from '../components/RefreshableList.vue'`)
    // 裸 <refresh 标签禁止出现在页面；'<RefreshableList' 大小写不同不误伤
    expect(src, n).not.toContain('<refresh')
  }
})

it('9 实例均为 :refresh 函数绑定（ADR-0107 D2）；FollowList 绑 fetchFirstPage', () => {
  for (const n of PAGE_NAMES) {
    expect(pageSources[n], n).toContain(':refresh="')
  }
  // 异构数据层同构接入：fetchFirstPage 幂等（重置 users/nextUrl/errorMsg）
  expect(pageSources.FollowList).toContain(':refresh="fetchFirstPage"')
})

it('页面零自持刷新态：无 refreshing prop/ref、onRefresh 包装器', () => {
  for (const n of PAGE_NAMES) {
    const src = pageSources[n]
    expect(src, n).not.toContain(':refreshing=')
    expect(src, n).not.toContain('@refresh=')
    expect(src, n).not.toMatch(/[rR]efreshing\s*=\s*ref\(/)
    expect(src, n).not.toContain('onRefresh')
  }
  for (const n of ['Bookmarks', 'UserHome'] as const) {
    expect(pageSources[n], n).not.toContain('illustRefreshing')
    expect(pageSources[n], n).not.toContain('novelRefreshing')
  }
})

it('patch workaround：7 页 list 均 :key 绑定且 epoch 在页面刷新函数内同步 ++（ADR-0107 D4）', () => {
  for (const n of PAGE_NAMES) {
    const src = pageSources[n]
    expect(src, n).toContain(':key="refreshEpoch"')
    expect(src, n).toContain('refreshEpoch = ref(0)')
    expect(src, n).toContain('refreshEpoch.value++')
  }
})

it('回顶：7 页 9 实例均 @back-to-top="refreshEpoch++"（ADR-0110 修订：emit 驱动重建回顶）', () => {
  for (const n of PAGE_NAMES) {
    const src = pageSources[n]
    expect(src, n).toContain('@back-to-top="refreshEpoch++"')
  }
})

it('Fab.vue 组件文件不存在（seam 无第二适配器，FAB 内联 RefreshableList）', () => {
  expect(
    existsSync(fileURLToPath(new URL('../src/components/Fab.vue', import.meta.url))),
  ).toBe(false)
  for (const n of PAGE_NAMES) {
    expect(pageSources[n], n).not.toContain('Fab.vue')
  }
})

it('列表页计数：Bookmarks/UserHome 各 2 个 RefreshableList，其余各 1 个（共 9 实例）', () => {
  const count = (s: string) => s.split('<RefreshableList').length - 1
  expect(count(pageSources.Bookmarks)).toBe(2)
  expect(count(pageSources.UserHome)).toBe(2)
  for (const n of ['Recommended', 'IllustList', 'NovelList', 'Following', 'FollowList'] as const) {
    expect(count(pageSources[n]), n).toBe(1)
  }
})
})

// ─── 类型徽章行接入（ADR-0113，spec: docs/specs/work-type-badges.md 决策 6） ───
// oracle 溯源：五页面清单来自 ADR-0113 决策 5 / spec 决策 6（独立 oracle）；
// import 配对断言的期望值来自原生失败实证——2026-08-25 模拟器实测 UserHome 缺 import 时
// vue-lynx resolveComponent 落空，组件名作为原生自定义标签直达 Lynx，抛 990200
// 「No BehaviorController defined for class IllustTypeBadgeRow」整客户端崩到错误页。
// 该失败在 web-core/单测/tsc 全绿下不可见，仅此断言能防回归。
describe('类型徽章行页面接入（ADR-0113）', () => {
const BADGE_PAGES = ['Recommended', 'IllustList', 'Bookmarks', 'Following', 'UserHome'] as const
const badgePageSources = Object.fromEntries(
  BADGE_PAGES.map((n) => [
    n,
    readFileSync(fileURLToPath(new URL(`../src/pages/${n}.vue`, import.meta.url)), 'utf8'),
  ]),
)

it('五个插画瀑布流页面均接入 <IllustTypeBadgeRow>（spec 决策 6 清单）', () => {
  for (const n of BADGE_PAGES) {
    expect(badgePageSources[n], n).toContain('<IllustTypeBadgeRow :illust=')
  }
})

it('每个接入页面必须 import 组件（缺 import 原生崩溃 990200，2026-08-25 实测）', () => {
  for (const n of BADGE_PAGES) {
    expect(badgePageSources[n], n).toContain(
      "import IllustTypeBadgeRow from '../components/IllustTypeBadgeRow.vue'",
    )
  }
})
})

// ─── BookmarkButton 收藏动效（ADR-0112，spec: docs/specs/app-lynx-bookmark-animation.md） ───
// oracle 溯源：期望值来自 spec 决策表 D1–D6 / ADR-0112 / tokens.css 令牌定义，非从实现反推。
describe('BookmarkButton 收藏动效（ADR-0112）', () => {
const bookmarkBtnVue = readFileSync(
  fileURLToPath(new URL('../src/components/BookmarkButton.vue', import.meta.url)),
  'utf8',
)
const bookmarksVue = readFileSync(
  fileURLToPath(new URL('../src/pages/Bookmarks.vue', import.meta.url)),
  'utf8',
)

it('含 4 条 keyframes（主心 pop 双向 + state-layer 环双向），类名全仓唯一前缀', () => {
  for (const name of ['bookmark-pop-add', 'bookmark-pop-remove', 'bookmark-ring-out', 'bookmark-ring-in']) {
    expect(bookmarkBtnVue).toContain(`@keyframes ${name}`)
    expect(bookmarkBtnVue).toContain(`.${name} {`)
  }
})

it('红线 1：缓动/时长一律引用 M3 令牌变量，无 bezier/ms 字面量', () => {
  // 负向：禁止 cubic-bezier 字面量与 animation 中的 ms 字面量
  expect(bookmarkBtnVue).not.toMatch(/cubic-bezier\(/)
  expect(bookmarkBtnVue).not.toMatch(/animation:[^;]*\d+ms/)
  // 正向：四条动画各自引用令牌（D2/D3：pop-add=Gentle+emphasized-decelerate，pop-remove=Normal+standard，
  // ring-out=Medium3+emphasized-decelerate，ring-in=Medium1+emphasized-accelerate）
  expect(bookmarkBtnVue).toContain('animation: bookmark-pop-add var(--durationGentle) var(--motion-emphasized-decelerate) both;')
  expect(bookmarkBtnVue).toContain('animation: bookmark-pop-remove var(--durationNormal) var(--motion-standard) both;')
  expect(bookmarkBtnVue).toContain('animation: bookmark-ring-out var(--durationMedium3) var(--motion-emphasized-decelerate) both;')
  expect(bookmarkBtnVue).toContain('animation: bookmark-ring-in var(--durationMedium1) var(--motion-emphasized-accelerate) both;')
})

it('tokens.css 含 M3 duration scale 补档（--durationMedium1 250ms / --durationMedium3 350ms）', () => {
  expect(tokensCss).toContain('--durationMedium1: 250ms')
  expect(tokensCss).toContain('--durationMedium3: 350ms')
})

it('transform 承载用 view 不用 text（ADR-0108 决策 2），pop 类绑定 tap 时刻快照', () => {
  // text 元素不直接挂动画类；动画类在包裹 view 上且绑定 lastTarget 快照（失败回滚不触发反向 pop）
  expect(bookmarkBtnVue).toContain('lastTarget')
  expect(bookmarkBtnVue).not.toMatch(/<text[^>]*bookmark-(pop|ring)/)
})

it('乐观化接缝：消费 createBookmarkToggle 状态机，change 延迟用 BOOKMARK_ANIMATION_MS 常量', () => {
  expect(bookmarkBtnVue).toContain("from '../primitives/createBookmarkToggle'")
  expect(bookmarkBtnVue).toContain('BOOKMARK_ANIMATION_MS')
  expect(bookmarkBtnVue).toContain('createBookmarkToggle(')
})

it('心形用 ♥\uFE0E（VS15 强制 text presentation，防 Lynx 原生 emoji 化导致 CSS 变色失效）', () => {
  // oracle = 平台事实（ADR-0112 待验证项回写：裸 U+2665 在原生渲染为彩色 emoji 固有色 #fa242f）
  expect(bookmarkBtnVue).toContain('♥\uFE0E')
})

it('Bookmarks 页：取消收藏后隐藏集过滤 + 同 tick refreshEpoch++ 整树重建（spec D6）', () => {
  // 结构断言：onBookmarkChange 函数体内两者同现（同一同步函数 = 同一 reactive flush，ADR-0107 决策 4）
  const m = /function onBookmarkChange[\s\S]*?\n\}/.exec(bookmarksVue)
  expect(m).not.toBeNull()
  expect(m![0]).toContain('removedIllustIds.value = new Set(removedIllustIds.value).add(item.id)')
  expect(m![0]).toContain('refreshEpoch.value++')
})
})

// ─── 追更询问弹窗（issue #224 / spec §US5） ───
// 仓库无 .vue 组件渲染测试先例（node 环境，无 Lynx 渲染器），降为模板源码结构断言，
// 与既有「注册表 + 模板源码断言」约定一致（对齐 Watchlist.vue / UpdatePage.vue 先例）。
// emits 映射 / busy 禁用 / error 分支 / modalStack 注册均用源码锚点断言；
// 弹窗状态机行为本身由 createWatchlistPrompt.test.ts 单测覆盖（T4 seam）。
describe('追更询问弹窗 WatchlistPromptDialog（issue #224 / spec §US5）', () => {
const dialogVueSource = readFileSync(
fileURLToPath(new URL('../src/components/WatchlistPromptDialog.vue', import.meta.url)),
'utf8',
)

it('注册表 label 全部非空且唯一', () => {
const labels = Object.values(WATCHLIST_PROMPT_A11Y_LABELS)
expect(labels.length).toBeGreaterThan(0)
for (const label of labels) expect(label.length).toBeGreaterThan(0)
expect(new Set(labels).size).toBe(labels.length)
})

it('WATCHLIST_PROMPT_A11Y_LABELS 全部被 WatchlistPromptDialog.vue 消费且配套 element', () => {
for (const key of Object.keys(WATCHLIST_PROMPT_A11Y_LABELS)) {
expect(dialogVueSource).toContain(`:accessibility-label="WATCHLIST_PROMPT_A11Y_LABELS.${key}"`)
}
const labelCount = (dialogVueSource.match(/:accessibility-label="WATCHLIST_PROMPT_A11Y_LABELS\.\w+"/g) ?? []).length
const elementCount = (dialogVueSource.match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g) ?? []).length
expect(labelCount).toBe(Object.keys(WATCHLIST_PROMPT_A11Y_LABELS).length)
expect(elementCount).toBe(labelCount)
})

it('decline 与 cancel 是两个不同事件（spec §US5 语义差：decline 继续返回 / cancel 留页）', () => {
expect(dialogVueSource).toContain("emit('decline')")
expect(dialogVueSource).toContain("emit('cancel')")
expect(dialogVueSource).toContain("emit('confirm')")
// 「暂不」按钮经 onDecline 映射 decline（含 busy 守卫，review P2-3），不是 cancel
expect(dialogVueSource).toContain('@tap="onDecline"')
})

it('busy 禁用：tap 守卫 + 禁用态样式分支（防连点）', () => {
// onConfirm 函数体内 props.busy 守卫
const m = /function onConfirm[\s\S]*?\n\}/.exec(dialogVueSource)
expect(m).not.toBeNull()
expect(m![0]).toContain('props.busy')
// 模板 busy 分支禁用态（opacity + 去除 active 反馈）
expect(dialogVueSource).toContain("busy ? 'opacity-40'")
})

it('errorMsg 非空显示错误条（M3 error token），且「追更」按钮不被移除（可重试）', () => {
expect(dialogVueSource).toContain('v-if="errorMsg"')
expect(dialogVueSource).toContain('bg-error-container')
expect(dialogVueSource).toContain('text-error-on-container')
})

it('open 期间 registerModal 注册关闭回调 = cancel（返回键优先关弹窗），关闭/卸载注销', () => {
expect(dialogVueSource).toContain("import { registerModal } from '../stores/modalStack'")
expect(dialogVueSource).toContain("registerModal(() => emit('cancel'))")
// watch open 翻转注册/注销 + onBeforeUnmount 注销兜底
expect(dialogVueSource).toContain('() => props.open')
expect(dialogVueSource).toContain('onBeforeUnmount')
expect(dialogVueSource).toContain('unregisterModal?.()')
})
})

// ─── T6：NovelDetail 追更询问接线（issue #226 / spec §US4 接线半） ───
// 零渲染器环境下的模板源码结构断言（对齐上方 WatchlistPromptDialog 既有模式）；
// 弹窗状态机行为本身由 createWatchlistPrompt.test.ts 覆盖（T4 seam）。
describe('NovelDetail 追更询问接线（issue #226 / spec §US4/§US5）', () => {
const detailVueSource = readFileSync(
fileURLToPath(new URL('../src/pages/NovelDetail.vue', import.meta.url)),
'utf8',
)

it('左上角返回走 requestBack（与系统返回同一守卫链），不再直调 goBack', () => {
expect(detailVueSource).toContain('@tap="requestBack"')
expect(detailVueSource).toContain('requestBack')
expect(detailVueSource).not.toContain('@tap="goBack"')
})

it('registerBackGuard 注册 + onUnmounted 注销（detail 页不在 KeepAlive 白名单）', () => {
expect(detailVueSource).toContain('registerBackGuard(')
expect(detailVueSource).toContain('unregisterBackGuard()')
expect(detailVueSource).toContain('onUnmounted(')
})

it('scroll-view 双路滚动跟踪：@scroll（进度）+ @scrolltolower（到达底部兑底）', () => {
expect(detailVueSource).toContain('@scroll="onNovelScroll"')
expect(detailVueSource).toContain('@scrolltolower="onNovelToBottom"')
})

it('弹窗挂载 + 三事件语义差：decline/confirm 继续返回，cancel 留页', () => {
expect(detailVueSource).toContain('<WatchlistPromptDialog')
expect(detailVueSource).toContain('@confirm="onWatchlistConfirm"')
expect(detailVueSource).toContain('@decline="onWatchlistDecline"')
expect(detailVueSource).toContain('@cancel="onWatchlistCancel"')
// decline：decline() 后 goBack()
const declineFn = /function onWatchlistDecline[\s\S]*?\n\}/.exec(detailVueSource)
expect(declineFn).not.toBeNull()
expect(declineFn![0]).toContain('prompt?.decline()')
expect(declineFn![0]).toContain('goBack()')
// confirm：await 后弹窗已关才 goBack（失败留页可重试）
const confirmFn = /async function onWatchlistConfirm[\s\S]*?\n\}/.exec(detailVueSource)
expect(confirmFn).not.toBeNull()
expect(confirmFn![0]).toContain('await p.confirm()')
expect(confirmFn![0]).toContain('!p.dialogOpen')
// cancel：仅 cancel()，无 goBack（留页）
const cancelFn = /function onWatchlistCancel[\s\S]*?\n\}/.exec(detailVueSource)
expect(cancelFn).not.toBeNull()
expect(cancelFn![0]).toContain('prompt?.cancel()')
expect(cancelFn![0]).not.toContain('goBack')
})

it('系列信息行：《系列名》+ watchAdded=true 时「已追更」chip', () => {
expect(detailVueSource).toContain('novel?.series')
expect(detailVueSource).toContain('《{{ novel.series.title }}》')
expect(detailVueSource).toContain("prompt?.watchAdded === true")
expect(detailVueSource).toContain('已追更')
})

it('章节内跳转：watch novelId 重载（dispose + 重建，spec §6-2）', () => {
expect(detailVueSource).toContain('watch(novelId')
expect(detailVueSource).toContain('teardownPrompt()')
})
})

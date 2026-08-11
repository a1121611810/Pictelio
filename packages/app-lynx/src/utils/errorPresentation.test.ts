// ─── presentError 单测（就近测试） ───
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { presentError, reportSessionError, registerSessionErrorHandler, fatalError } from './errorPresentation'
import { ApiErrorType, type ApiError } from '../api/types'
import { classifyError } from '../api/client'

function err(type: ApiErrorType, message: string, status?: number): ApiError {
  return { type, message, status }
}

describe('utils.errorPresentation.presentError', () => {
  it('UNAUTHORIZED → 主文案 + 「请重新登录」', () => {
    expect(presentError(err(ApiErrorType.UNAUTHORIZED, '登录已过期 (HTTP 401)', 401))).toBe(
      '登录已过期 (HTTP 401)。请重新登录',
    )
  })

  it('RATE_LIMIT → 仅主文案（classifyError 主文案已含节流提示，不重复拼接）', () => {
    expect(presentError(err(ApiErrorType.RATE_LIMIT, '请求过于频繁，请稍后重试 (HTTP 429)', 429))).toBe(
      '请求过于频繁，请稍后重试 (HTTP 429)',
    )
  })

  it('NETWORK → 主文案 + 网络提示', () => {
    expect(presentError(err(ApiErrorType.NETWORK, '网络不可用，请检查连接'))).toBe(
      '网络不可用，请检查连接。请检查网络连接是否正常',
    )
  })

  it('PROXY → 主文案 + 代理提示', () => {
    expect(presentError(err(ApiErrorType.PROXY, '本地代理连接失败，请检查代理软件是否运行'))).toBe(
      '本地代理连接失败，请检查代理软件是否运行。请检查本地代理是否已运行',
    )
  })

  it('SERVER → 主文案 + 服务器提示', () => {
    expect(presentError(err(ApiErrorType.SERVER, '服务器错误 (HTTP 500)', 500))).toBe(
      '服务器错误 (HTTP 500)。Pixiv 服务器暂时不可用，请稍后重试',
    )
  })

  it('FORBIDDEN → 仅主文案（无 hint）', () => {
    expect(presentError(err(ApiErrorType.FORBIDDEN, '没有权限访问 (HTTP 403)', 403))).toBe(
      '没有权限访问 (HTTP 403)',
    )
  })

  it('UNKNOWN → 仅主文案（无 hint）', () => {
    expect(presentError(err(ApiErrorType.UNKNOWN, '请求失败 (HTTP 400)', 400))).toBe('请求失败 (HTTP 400)')
  })

  it('classifyError 产出的真实错误同样分档（401 → UNAUTHORIZED 文案）', () => {
    const classified = classifyError(401, null, null)
    expect(presentError(classified)).toBe('登录已过期 (HTTP 401)。请重新登录')
  })

  it('普通 Error → 取 message，无 hint（UNKNOWN 分类）', () => {
    expect(presentError(new Error('booom'))).toBe('booom')
  })

  it('null / undefined → fallback', () => {
    expect(presentError(null)).toBe('加载失败')
    expect(presentError(undefined)).toBe('加载失败')
  })

  it('裸字符串 / 非对象 → fallback', () => {
    expect(presentError('oops')).toBe('加载失败')
    expect(presentError(42)).toBe('加载失败')
  })

  it('自定义 fallback 保留页面语义', () => {
    expect(presentError(null, '加载更多失败')).toBe('加载更多失败')
    expect(presentError(err(ApiErrorType.UNKNOWN, ''), '加载更多失败')).toBe('加载更多失败')
  })

  it('message 为空串时 UNKNOWN 走 fallback（toApiError 语义）', () => {
    expect(presentError({ type: ApiErrorType.UNKNOWN, message: '' }, '作品加载失败')).toBe('作品加载失败')
  })
})

describe('utils.errorPresentation 会话错误触发链', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
    // 清理共享模块态，避免测试间串扰
    registerSessionErrorHandler(() => {})
  })

  it('reportSessionError 写入 fatalError 并触发注入的 handler', () => {
    const handler = vi.fn(() => {})
    registerSessionErrorHandler(handler)
    reportSessionError(err(ApiErrorType.UNAUTHORIZED, '登录已过期 (HTTP 401)', 401))
    expect(handler).toHaveBeenCalledTimes(1)
    expect(fatalError.value).toEqual({ type: ApiErrorType.UNAUTHORIZED, message: '登录已过期 (HTTP 401)', status: 401 })
  })

  it('handler 未注册时降级 console.warn 且不抛异常（独立模块实例）', async () => {
    vi.resetModules()
    const mod = await import('./errorPresentation')
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => mod.reportSessionError(err(ApiErrorType.UNAUTHORIZED, 'x'))).not.toThrow()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('fatalError 携带 toApiError 归一化的 message（原生字符串错误归类为 UNAUTHORIZED）', () => {
    const handler = vi.fn(() => {})
    registerSessionErrorHandler(handler)
    reportSessionError({ type: ApiErrorType.UNAUTHORIZED, message: '凭证无效' })
    expect(fatalError.value?.message).toBe('凭证无效')
    expect(fatalError.value?.type).toBe(ApiErrorType.UNAUTHORIZED)
  })
})

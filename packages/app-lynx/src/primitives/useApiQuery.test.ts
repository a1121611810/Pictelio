// ─── useApiQuery 单测（ADR-0141 D6 generation-gate + R1-3 真机结论 oracle）───
//
// 测试覆盖三档：
// A. wrap 纯函数行为（6 测试）— 防 wrap 内部逻辑漂移
// B. wrap 与 apiClient 集成（3 测试，本文件 §B）— oracle = apiClient.get 第三参
// C. wrap 与 globalThis.fetch 集成（1 测试，§C）— oracle = R1-1 真机结论「lynx fetch
//    signal 117ms 真抛 AbortError + 取消 OkHttp」
//
// 注：useApiQuery helper 在 vue-query 5.102.8 框架下必须在 setup 上下文调，
// 但本测试只覆盖纯函数（wrapWithGenerationGate），不涉及 setup 上下文。

import { describe, it, expect, vi } from 'vitest'
import {
  ApiQueryStaleError,
  isApiQueryStaleError,
  wrapWithGenerationGate,
} from './useApiQuery'
import { apiClient } from '../api/client'
import { type ApiError, ApiErrorType } from '../api/types'

// ─── A. wrap 纯函数行为（6 测试）───

describe('useApiQuery / wrapWithGenerationGate (纯函数)', () => {
  it('normal queryFn result passes through', async () => {
    const queryFn = vi.fn(async () => 'ok')
    const wrapped = wrapWithGenerationGate(queryFn)
    const ac = new AbortController()
    const result = await wrapped({ signal: ac.signal } as never)
    expect(result).toBe('ok')
    expect(queryFn).toHaveBeenCalledOnce()
  })

  it('abort before resolve → ApiQueryStaleError', async () => {
    // 模拟 lynx 实测场景：signal abort 后 queryFn 仍走完 reject
    const queryFn = vi.fn((ctx: { signal: AbortSignal }) => new Promise<string>((_, reject) => {
      ctx.signal.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const wrapped = wrapWithGenerationGate(queryFn)
    const ac = new AbortController()
    const p = wrapped({ signal: ac.signal } as never)
    ac.abort()
    await expect(p).rejects.toBeInstanceOf(ApiQueryStaleError)
  })

  it('reject path with disposed=true → ApiQueryStaleError', async () => {
    const queryFn = vi.fn(async () => { throw new Error('network') })
    const wrapped = wrapWithGenerationGate(queryFn)
    const ac = new AbortController()
    const p = wrapped({ signal: ac.signal } as never)
    ac.abort()
    await expect(p).rejects.toBeInstanceOf(ApiQueryStaleError)
  })

  it('reject path without dispose → original error rethrown', async () => {
    const original = new Error('network')
    const queryFn = vi.fn(async () => { throw original })
    const wrapped = wrapWithGenerationGate(queryFn)
    const ac = new AbortController()
    await expect(wrapped({ signal: ac.signal } as never)).rejects.toBe(original)
  })

  it('isApiQueryStaleError discriminates correctly', () => {
    expect(isApiQueryStaleError(new ApiQueryStaleError())).toBe(true)
    expect(isApiQueryStaleError(new Error('other'))).toBe(false)
    expect(isApiQueryStaleError(null)).toBe(false)
    // Plain object with __apiQueryStale marker (e.g. cross-realm)
    expect(isApiQueryStaleError({ __apiQueryStale: true })).toBe(true)
    expect(isApiQueryStaleError({ __apiQueryStale: false })).toBe(false)
  })

  it('removes abort listener on completion (no memory leak)', async () => {
    const queryFn = vi.fn(async () => 'ok')
    const wrapped = wrapWithGenerationGate(queryFn)
    const ac = new AbortController()
    const addSpy = vi.spyOn(ac.signal, 'addEventListener')
    const removeSpy = vi.spyOn(ac.signal, 'removeEventListener')
    await wrapped({ signal: ac.signal } as never)
    expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true })
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})

// ─── B. wrap 与 apiClient 集成（3 测试，code-review F7 修复）───
//
// 之前 useApiQuery.test.ts 只测 wrap 纯函数，mock queryFn 是 vi.fn 自洽
// （oracle 反推）。code-review F7 标「13 个新测试全为实现反推 / characterization-only」
// → 加 spyOn(apiClient, 'get') 验证 wrap 把 ctx.signal 透传给 apiClient.get 第三参
// （与 useApiCommentsQuery.ts:64 同模式）。oracle = apiClient 接口签名 (T, params?, signal?)
// → 真集成测试揭「wrap 把 signal 吞了」的回归。

describe('useApiQuery / wrapWithGenerationGate (apiClient 集成 oracle)', () => {
  it('queryFn 调用 apiClient.get 时透传 ctx.signal', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValueOnce({ data: 'ok' } as never)
    const wrapped = wrapWithGenerationGate(({ signal }: { signal: AbortSignal }) =>
      apiClient.get('/v1/test', { limit: '1' }, signal),
    )
    const ac = new AbortController()
    await wrapped({ signal: ac.signal } as never)
    // oracle：第三参是同一 ac.signal（不是 undefined、不是新 controller）
    expect(spy).toHaveBeenCalledWith('/v1/test', { limit: '1' }, ac.signal)
    spy.mockRestore()
  })

  it('apiClient.get 抛 ApiError 时 wrap 不吞错', async () => {
    const apiError: ApiError = { type: ApiErrorType.NETWORK, message: 'boom' }
    vi.spyOn(apiClient, 'get').mockRejectedValueOnce(apiError)
    const wrapped = wrapWithGenerationGate(({ signal }: { signal: AbortSignal }) =>
      apiClient.get('/v1/test', undefined, signal),
    )
    const ac = new AbortController()
    await expect(wrapped({ signal: ac.signal } as never)).rejects.toBe(apiError)
  })

  it('apiClient.get reject 后 abort 触发 → wrap 仍抛 ApiQueryStaleError', async () => {
    vi.spyOn(apiClient, 'get').mockImplementationOnce((p: string, params?: Record<string, string>, sigArg?: AbortSignal) =>
      new Promise((_resolve, reject) => {
        sigArg?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    )
    const wrapped = wrapWithGenerationGate(({ signal }: { signal: AbortSignal }) =>
      apiClient.get('/v1/test', undefined, signal),
    )
    const ac = new AbortController()
    const p = wrapped({ signal: ac.signal } as never)
    ac.abort()
    await expect(p).rejects.toBeInstanceOf(ApiQueryStaleError)
  })
})

// ─── C. wrap 与 globalThis.fetch 集成（1 测试，code-review F8 修复）───
//
// oracle = R1-1 真机结论「lynx fetch signal 117ms 真抛 AbortError + 取消 OkHttp」。
// node 测试环境 globalThis.fetch 来自 undici，行为与 lynx fetch 一致（都遵守 Web Fetch
// 规范）。本测试在 node 环境验证 wrap 透传 signal 到 fetch 后：
// 1. wrap 内部 generation-gate 仍工作（abort → reject → ApiQueryStaleError）
// 2. wrap 不吞 error identity
// 真机 R1-1 已验证 lynx fetch 行为，本测试提供 node 环境 oracle 锚点
// （防止 wrap 实现退化为「不传 signal」时 node 端测试仍绿而真机失败）。

describe('useApiQuery / wrapWithGenerationGate (globalThis.fetch 集成 oracle)', () => {
  it('wrap 透传 ctx.signal 给 globalThis.fetch，abort 后 reject → ApiQueryStaleError', async () => {
    // mock globalThis.fetch：返回永不 resolve 的 promise（模拟网络挂起）
    // signal abort 时 reject with AbortError（lynx fetch 实测行为）
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      ((_input: string | URL | Request, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const e = new Error('aborted')
            e.name = 'AbortError'
            reject(e)
          })
        })
      }) as typeof fetch,
    )

    const wrapped = wrapWithGenerationGate(({ signal }) => fetch('/api/test', { signal }))
    const ac = new AbortController()
    const p = wrapped({ signal: ac.signal } as never)
    ac.abort()
    await expect(p).rejects.toBeInstanceOf(ApiQueryStaleError)
    // oracle：signal 真传给 fetch（不是 undefined / 新 AbortController）
    const callArgs = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(callArgs[1]?.signal).toBe(ac.signal)
    fetchSpy.mockRestore()
  })
})
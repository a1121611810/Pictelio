// ─── useApiInfiniteQuery / ApiQueryError 单测（ADR-0141 D5）───
//
// 验证双错误槽位（first / pagination）：
// 1. pageParam 为 undefined → kind='first'（首屏）
// 2. pageParam 为 string/number → kind='pagination'（分页）
// 3. 原始 ApiError → 包成 ApiQueryError 携带正确 kind
// 4. 非 ApiError（fetch reject）→ 仍按 kind 包裹为 generic
// 5. generation-gate 丢弃（abort）→ ApiQueryStaleError 优先

import { describe, it, expect, vi } from 'vitest'
import { ApiErrorType, type ApiError } from '../api/types'
import { ApiQueryStaleError } from './useApiQuery'
import { ApiQueryError, isApiQueryError, wrapWithKindAndGate } from './useApiInfiniteQuery'

function makeCtx(pageParam: unknown, signal: AbortSignal) {
  return { signal, pageParam } as never
}

describe('useApiInfiniteQuery / kind 双错误槽位', () => {
  it('pageParam=undefined → kind=first', async () => {
    const err: ApiError = { type: ApiErrorType.NETWORK, message: 'boom' }
    const queryFn = vi.fn(async () => { throw err })
    const wrapped = wrapWithKindAndGate(queryFn)
    const ac = new AbortController()
    try {
      await wrapped(makeCtx(undefined, ac.signal))
      expect.fail('should have thrown')
    } catch (e) {
      expect(isApiQueryError(e)).toBe(true)
      const apiErr = e as ApiQueryError
      expect(apiErr.kind).toBe('first')
      expect(apiErr.cause).toEqual(err)
    }
  })

  it('pageParam=null → kind=first', async () => {
    const err: ApiError = { type: ApiErrorType.NETWORK, message: 'boom' }
    const queryFn = vi.fn(async () => { throw err })
    const wrapped = wrapWithKindAndGate(queryFn)
    const ac = new AbortController()
    try {
      await wrapped(makeCtx(null, ac.signal))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as ApiQueryError).kind).toBe('first')
    }
  })

  it('pageParam=string (next_url) → kind=pagination', async () => {
    const err: ApiError = { type: ApiErrorType.SERVER, message: 'oops' }
    const queryFn = vi.fn(async () => { throw err })
    const wrapped = wrapWithKindAndGate(queryFn)
    const ac = new AbortController()
    try {
      await wrapped(makeCtx('https://api.pixiv.net/next?p=2', ac.signal))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as ApiQueryError).kind).toBe('pagination')
      expect((e as ApiQueryError).cause.status).toBeUndefined()
    }
  })

  it('pageParam=number (offset) → kind=pagination', async () => {
    const err: ApiError = { type: ApiErrorType.RATE_LIMIT, message: 'slow down' }
    const queryFn = vi.fn(async () => { throw err })
    const wrapped = wrapWithKindAndGate(queryFn)
    const ac = new AbortController()
    try {
      await wrapped(makeCtx(2, ac.signal))
      expect.fail('should have thrown')
    } catch (e) {
      expect((e as ApiQueryError).kind).toBe('pagination')
    }
  })

  it('non-ApiError (fetch reject) → wraps as generic with correct kind', async () => {
    const queryFn = vi.fn(async () => { throw new Error('network down') })
    const wrapped = wrapWithKindAndGate(queryFn)
    const ac = new AbortController()
    try {
      await wrapped(makeCtx(undefined, ac.signal))
      expect.fail('should have thrown')
    } catch (e) {
      const apiErr = e as ApiQueryError
      expect(apiErr.kind).toBe('first')
      expect(apiErr.cause.type).toBe(ApiErrorType.UNKNOWN)
      expect(apiErr.cause.message).toBe('network down')
    }
  })

  it('abort before resolve → ApiQueryStaleError (not ApiQueryError)', async () => {
    // 模拟 lynx 实测场景：signal abort 后 queryFn 内部立即 reject
    // wrapWithKindAndGate catch 路径先检查 disposed=true → 替换为 ApiQueryStaleError
    const queryFn = vi.fn((ctx: { signal: AbortSignal }) => new Promise<unknown>((_, reject) => {
      ctx.signal.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const wrapped = wrapWithKindAndGate(queryFn)
    const ac = new AbortController()
    const p = wrapped(makeCtx(undefined, ac.signal))
    ac.abort()
    await expect(p).rejects.toBeInstanceOf(ApiQueryStaleError)
  })

  it('normal success → data passes through', async () => {
    const data = { items: [{ id: 1 }], nextUrl: 'https://next' }
    const queryFn = vi.fn(async () => data)
    const wrapped = wrapWithKindAndGate(queryFn)
    const ac = new AbortController()
    const result = await wrapped(makeCtx(undefined, ac.signal))
    expect(result).toEqual(data)
  })
})
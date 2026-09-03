// ─── useApiQuery / ApiQueryStaleError 单测（ADR-0141 R1-3）───
//
// 验证 generation-gate 行为：
// 1. 正常 queryFn 返回 → data 写入缓存
// 2. signal.abort 触发前 queryFn resolve → 旧响应被识别为 stale，throw ApiQueryStaleError
// 3. signal.abort 触发后 queryFn reject → 也是 ApiQueryStaleError
// 4. isApiQueryStaleError() 判别正确
//
// 真实 queryKey + apiClient 集成通过真机（pictelio_ui）验证；本单测只覆盖
// generation-gate 这层包装的纯函数行为。

import { describe, it, expect, vi } from 'vitest'
import { ApiQueryStaleError, isApiQueryStaleError, wrapWithGenerationGate } from './useApiQuery'

describe('useApiQuery / generation-gate', () => {
  it('normal queryFn result passes through', async () => {
    const queryFn = vi.fn(async () => 'ok')
    const wrapped = wrapWithGenerationGate(queryFn)
    const ac = new AbortController()
    const result = await wrapped({ signal: ac.signal } as never)
    expect(result).toBe('ok')
    expect(queryFn).toHaveBeenCalledOnce()
  })

  it('abort before resolve → ApiQueryStaleError', async () => {
    // 模拟 lynx 实测场景：signal abort 后 queryFn 内部立即 reject（lynx fetch abort 行为）
    // 但 disposed=true 在 reject 之前已经被 wrapWithGenerationGate 监听到 → 抛 ApiQueryStaleError
    const queryFn = vi.fn((ctx: { signal: AbortSignal }) => new Promise<string>((_, reject) => {
      ctx.signal.addEventListener('abort', () => {
        // lynx fetch 在 abort 触发时抛 AbortError；这里我们抛任意 error
        // wrapWithGenerationGate 的 catch 路径会先检查 disposed=true → 替换为 ApiQueryStaleError
        reject(new Error('aborted'))
      })
    }))
    const wrapped = wrapWithGenerationGate(queryFn)
    const ac = new AbortController()
    const p = wrapped({ signal: ac.signal } as never)
    ac.abort()
    await expect(p).rejects.toBeInstanceOf(ApiQueryStaleError)
  })

  it('reject path with disposed=true → ApiQueryStaleError', async () => {
    const queryFn = vi.fn(async () => {
      throw new Error('original-error')
    })
    const wrapped = wrapWithGenerationGate(queryFn)
    const ac = new AbortController()
    const p = wrapped({ signal: ac.signal } as never)
    ac.abort()
    await expect(p).rejects.toBeInstanceOf(ApiQueryStaleError)
  })

  it('reject path without dispose → original error rethrown', async () => {
    const original = new Error('original-error')
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
    // 检查 addEventListener / removeEventListener 调用
    const addSpy = vi.spyOn(ac.signal, 'addEventListener')
    const removeSpy = vi.spyOn(ac.signal, 'removeEventListener')
    await wrapped({ signal: ac.signal } as never)
    expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true })
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))
  })
})
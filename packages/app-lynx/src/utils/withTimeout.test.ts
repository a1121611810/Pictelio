// withTimeout 单测：请求挂起超时兜底（issue #128）
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withTimeout } from './withTimeout'

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('promise 在超时前 resolve → 正常返回结果', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok')
  })

  it('promise 在超时前 reject → 原错误透传', async () => {
    const boom = new Error('boom')
    await expect(withTimeout(Promise.reject(boom), 1000)).rejects.toBe(boom)
  })

  it('promise 挂起超过超时时间 → 拒绝默认超时错误', async () => {
    vi.useFakeTimers()
    const hanging = new Promise<string>(() => {
      /* 永不 settle，模拟请求挂起 */
    })
    const p = withTimeout(hanging, 1000)
    const assertion = expect(p).rejects.toThrow('请求超时')
    vi.advanceTimersByTime(1000)
    await assertion
  })

  it('自定义超时 message → 拒绝该 message', async () => {
    vi.useFakeTimers()
    const hanging = new Promise<string>(() => {
      /* 永不 settle */
    })
    const p = withTimeout(hanging, 1000, '加载超时')
    const assertion = expect(p).rejects.toThrow('加载超时')
    vi.advanceTimersByTime(1000)
    await assertion
  })

  it('超时后原 promise 才 settle → 结果被忽略，仍按超时拒绝', async () => {
    vi.useFakeTimers()
    let resolveLater!: (v: string) => void
    const late = new Promise<string>((resolve) => {
      resolveLater = resolve
    })
    const p = withTimeout(late, 1000)
    const assertion = expect(p).rejects.toThrow('请求超时')
    vi.advanceTimersByTime(1000)
    resolveLater('晚到的数据') // race 已 settle，此值被忽略
    await assertion
  })
})

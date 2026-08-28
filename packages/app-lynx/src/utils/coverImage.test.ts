import { describe, it, expect, vi, afterEach } from 'vitest'
import { deriveCoverState, deriveRetryState, isUnloadableSrc, withRetryQuery } from './coverImage'

// oracle = spec: app-lynx-recommended-carousel-image-fab-polish §2.1 / §3.1 的三态语义 + URL 语义。
// 纯函数、无 DOM；组件渲染行为归 web-core/真机（§4 验证闭环）——此处只锁纯逻辑，避免 oracle gap。

afterEach(() => vi.restoreAllMocks())

describe('deriveCoverState（图片三态推导）', () => {
  it('skeleton：未加载、未失败（加载中）', () => {
    expect(deriveCoverState(false, false)).toBe('skeleton')
  })
  it('image：已加载、未失败', () => {
    expect(deriveCoverState(true, false)).toBe('image')
  })
  it('failed：已失败（无论是否加载过）', () => {
    expect(deriveCoverState(false, true)).toBe('failed')
  })
  it('failed 优先于 image：`(true,true)` 锁失败态优先（characterization：组件 onError 会复位 loaded=false，此态不可达，但锁该不变量防优先级漂移）', () => {
    expect(deriveCoverState(true, true)).toBe('failed')
  })
})

describe('withRetryQuery（重试 cache-bust）', () => {
  it('无 query：追加 ?retry=<ts>', () => {
    const out = withRetryQuery('https://a/b.jpg')
    expect(out).toMatch(/^https:\/\/a\/b\.jpg\?retry=\d+$/)
  })
  it('已有 query：用 &retry=<ts>，不产生两个 ?', () => {
    const out = withRetryQuery('https://a/b.jpg?x=1')
    expect(out).toMatch(/^https:\/\/a\/b\.jpg\?x=1&retry=\d+$/)
    expect(out?.split('?').length).toBe(2)
  })
  it('每次调用产生不同 ts（强制重新请求 — spec §2.1 验收行为）', () => {
    // 独占 Date.now 返回顺序值，真实断言「两次调用 ts 不同」；恒定 ts 会被此处捕获
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000)
    expect(withRetryQuery('https://a/b.jpg')).toBe('https://a/b.jpg?retry=1000')
    expect(withRetryQuery('https://a/b.jpg')).toBe('https://a/b.jpg?retry=2000')
    expect(now).toHaveBeenCalledTimes(2)
  })
  it('空 src 原样返回（不追加，characterization 守卫）', () => {
    expect(withRetryQuery('')).toBe('')
  })
})

describe('deriveRetryState（重试整组状态）', () => {
  it('从干净 baseSrc 重建 imageSrc（带新 retry）+ 复位回骨架', () => {
    const base = 'https://a/b.jpg'
    const s = deriveRetryState(base)
    expect(s.loaded).toBe(false)
    expect(s.failed).toBe(false)
    expect(s.imageSrc).toMatch(/^https:\/\/a\/b\.jpg\?retry=\d+$/)
  })
  it('空 baseSrc：imageSrc 为空且保持 failed（重试不能把失败拉回骨架——空 src 永不触发 @error，拉回会无限 shimmer，非静默降级）', () => {
    const s = deriveRetryState('')
    expect(s.imageSrc).toBe('')
    expect(s.loaded).toBe(false)
    expect(s.failed).toBe(true)
  })
})

describe('isUnloadableSrc（空/无效 src → 直接判失败，非静默降级）', () => {
  it('空串视为不可加载', () => {
    expect(isUnloadableSrc('')).toBe(true)
  })
  it('非空视为可加载', () => {
    expect(isUnloadableSrc('https://a/b.jpg')).toBe(false)
  })
})

// ─── safeArea 单测（spec docs/specs/lynx-systembars.md §6 T2）───
// oracle = spec D2（订阅后拉取 + 事件更新 + 无 native 恒 0 + warn 一次）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (...args: unknown[]) => void

interface Harness {
  emitter: { listeners: Record<string, Listener[]>; addListener: (e: string, fn: Listener) => void }
  pull: (top: number, bottom: number) => void
}

function harness(): Harness {
  const emitter = { listeners: {} as Record<string, Listener[]>, addListener: () => {} }
  ;(emitter as unknown as { addListener: (e: string, fn: Listener) => void }).addListener = (
    e: string,
    fn: Listener,
  ) => {
    ;(emitter.listeners[e] ??= []).push(fn)
  }
  let pullCb: ((top: number, bottom: number) => void) | null = null
  ;(globalThis as Record<string, unknown>).lynx = { getJSModule: () => emitter }
  ;(globalThis as Record<string, unknown>).NativeModules = {
    PictelioApp: { getSafeAreaInsets: (cb: (t: number, b: number) => void) => (pullCb = cb) },
  }
  return {
    emitter,
    pull: (top: number, bottom: number) => pullCb?.(top, bottom),
  }
}

async function freshModule() {
  vi.resetModules()
  return await import('./safeArea')
}

describe('safeArea（系统栏安全区 signals）', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as Record<string, unknown>).lynx
    delete (globalThis as Record<string, unknown>).NativeModules
  })

  it('无 native（web-core 预览）：恒 0 + warn 一次', async () => {
    const m = await freshModule()
    m.initSafeArea()
    expect(m.safeTop.value).toBe(0)
    expect(m.safeBottom.value).toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('[safeArea]')
    // 幂等：二次调用不再 warn
    m.initSafeArea()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('订阅后拉取初值（D2 修订核心：不依赖 attach 期事件）', async () => {
    const h = harness()
    const m = await freshModule()
    m.initSafeArea()
    expect(warn).not.toHaveBeenCalled()
    // 拉取回调落地
    h.pull(47, 63)
    expect(m.safeTop.value).toBe(47)
    expect(m.safeBottom.value).toBe(63)
  })

  it('事件更新后续变化（载荷展开为两个数值）', async () => {
    const h = harness()
    const m = await freshModule()
    m.initSafeArea()
    h.pull(47, 63)
    const listeners = h.emitter.listeners['pictelioInsets']
    expect(listeners?.length).toBe(1)
    listeners[0](10, 20)
    expect(m.safeTop.value).toBe(10)
    expect(m.safeBottom.value).toBe(20)
    // 非法载荷整体拒绝（debug 可见，不部分应用污染现值）
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    listeners[0](Number.NaN, 30)
    expect(m.safeTop.value).toBe(10)
    expect(m.safeBottom.value).toBe(20)
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('非法载荷'), expect.anything(), expect.anything())
    debugSpy.mockRestore()
    listeners[0](12, 30)
    expect(m.safeTop.value).toBe(12)
    expect(m.safeBottom.value).toBe(30)
  })

  it('emitter 不可用：warn 且不拉取（禁静默降级）', async () => {
    ;(globalThis as Record<string, unknown>).NativeModules = {
      PictelioApp: { getSafeAreaInsets: () => {} },
    }
    const m = await freshModule()
    m.initSafeArea()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(m.safeTop.value).toBe(0)
  })
})

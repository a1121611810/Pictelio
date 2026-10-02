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

/** 注入 Lynx 全局 SystemInfo（原生注入 physical→logical 的 density 比率）。 */
function setSystemInfo(pixelRatio: number, pixelWidth = 1080): void {
  ;(globalThis as Record<string, unknown>).SystemInfo = { pixelWidth, pixelRatio }
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
    delete (globalThis as Record<string, unknown>).SystemInfo
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

// ─── 单位边界（原生物理像素 → Lynx 逻辑像素）───
// oracle = glossary-lynx-units「px = 逻辑像素（= dp）」+ 真机实证（emulator-5554 /
// density 3.0 ⇒ 状态栏 72 物理 px 曾被渲染成 216 物理 px，header 上方凭空多 144px）。
// 本组断言锁死「按 pixelRatio 折算」这一层；缺了它，换算被删掉时其余断言仍会全绿。
describe('safeArea 单位边界：原生物理像素 → 逻辑像素', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as Record<string, unknown>).lynx
    delete (globalThis as Record<string, unknown>).NativeModules
    delete (globalThis as Record<string, unknown>).SystemInfo
  })

  it('拉取初值按 pixelRatio 折算（density 3：72 物理 px → 24 逻辑 px）', async () => {
    const h = harness()
    setSystemInfo(3)
    const m = await freshModule()
    m.initSafeArea()
    h.pull(72, 66)
    expect(m.safeTop.value).toBe(24)
    expect(m.safeBottom.value).toBe(22)
  })

  it('事件分支同样折算（否则旋转/全屏切换后补偿会跳回物理值）', async () => {
    const h = harness()
    setSystemInfo(3)
    const m = await freshModule()
    m.initSafeArea()
    const listeners = h.emitter.listeners['pictelioInsets']
    listeners[0](90, 0)
    expect(m.safeTop.value).toBe(30)
    expect(m.safeBottom.value).toBe(0)
  })

  it('density 1.0（mdpi）：折算为恒等，与修复前行为一致', async () => {
    const h = harness()
    setSystemInfo(1)
    const m = await freshModule()
    m.initSafeArea()
    h.pull(47, 63)
    expect(m.safeTop.value).toBe(47)
    expect(m.safeBottom.value).toBe(63)
  })

  it('pixelRatio 缺失/非法：回退 1:1 且 warn 一次（禁静默降级）', async () => {
    const h = harness()
    setSystemInfo(0) // 非法比率（<=0）
    const m = await freshModule()
    m.initSafeArea()
    h.pull(72, 66)
    expect(m.safeTop.value).toBe(72)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('pixelRatio')
    // 重复 insets 回调只 warn 一次
    h.emitter.listeners['pictelioInsets'][0](72, 66)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('非有限物理值的处理与修复前一致（折算不改变两条路径的既有语义）', async () => {
    const h = harness()
    setSystemInfo(3)
    const m = await freshModule()
    m.initSafeArea()
    // 拉取路径：非法值归 0（修复前 `Number.isFinite(top) ? top : 0` 即此语义，未改）
    h.pull(72, 66)
    expect(m.safeTop.value).toBe(24)
    h.pull(Number.NaN, 66)
    expect(m.safeTop.value).toBe(0)
    // 事件路径：非法载荷整体忽略、**保留现值**（与既有断言同口径）
    h.pull(72, 66)
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    h.emitter.listeners['pictelioInsets'][0](Number.NaN, 66)
    expect(m.safeTop.value).toBe(24)
    expect(m.safeBottom.value).toBe(22)
    debugSpy.mockRestore()
  })
})

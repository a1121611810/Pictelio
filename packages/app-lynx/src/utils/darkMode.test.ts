// ─── 暗色哑桥单测（spec docs/specs/lynx-night-mode.md T1 §4.3）───
// 三个 seam：
// 1) web-core 预览：matchMedia 成功路径（拉初值 + change 触发更新）
// 2) web-core 预览：matchMedia 不可用路径（warn + 恒 light）
// 3) native 路径：PictelioApp.getDarkMode 拉初值 + pictelioDarkMode 事件推变化
// 4) 初始化入口 ensureDarkModeInit（无回调消费方，settingsStore 生产路径）：幂等启桥 + 不注册订阅者
// IO 边界强制覆盖（成功 + 失败双路径，禁静默降级）——safeArea.test.ts 同结构。
// vitest environment: node（vitest.config.ts 默认）；matchMedia 在 node 环境缺失，
// 通过 globalThis.matchMedia 注入可控 mock（不依赖 window/happy-dom）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

interface MockMQ {
  matches: boolean
  listeners: Array<(e: { matches: boolean }) => void>
  addEventListener: (type: 'change', cb: (e: { matches: boolean }) => void) => void
  removeEventListener?: (type: 'change', cb: (e: { matches: boolean }) => void) => void
  fire: (matches: boolean) => void
}

type NativeGetDarkModeCb = (mode: string) => void

interface MockNative {
  emitter: { listeners: Record<string, Array<(...args: unknown[]) => void>> }
  getDarkMode: (cb: NativeGetDarkModeCb) => void
  setPull: (cb: NativeGetDarkModeCb) => void
  firePull: (mode: string) => void
}

/** web-core 预览 harness：注入可控的 matchMedia（happy-dom 不提供完整 matchMedia） */
function setupMatchMedia(initialDark: boolean): MockMQ {
  const listeners: MockMQ['listeners'] = []
  const mq: MockMQ = {
    matches: initialDark,
    listeners,
    addEventListener: (_t, cb) => listeners.push(cb),
    fire(matches) {
      this.matches = matches
      for (const cb of listeners) cb({ matches })
    },
  }
  ;(globalThis as Record<string, unknown>).matchMedia = () => mq
  return mq
}

/** native harness：注入 PictelioApp.getDarkMode + GlobalEventEmitter。
 *  pull 默认不立即 fire（同步 vs setTimeout 0 都是合法的——看测试需求）。 */
function setupNative(): MockNative {
  let pullCb: NativeGetDarkModeCb | null = null
  const emitter = { listeners: {} as Record<string, Array<(...args: unknown[]) => void>> }
  ;(globalThis as Record<string, unknown>).lynx = {
    getJSModule: () => ({
      addListener: (e: string, fn: (...args: unknown[]) => void) => {
        ;(emitter.listeners[e] ??= []).push(fn)
      },
      removeListener: () => {},
    }),
  }
  ;(globalThis as Record<string, unknown>).NativeModules = {
    PictelioApp: {
      getDarkMode: (cb: NativeGetDarkModeCb) => {
        pullCb = cb
      },
    },
  }
  return {
    emitter,
    getDarkMode: (cb) => {
      pullCb = cb
    },
    setPull: (cb) => {
      pullCb = cb
    },
    firePull: (mode) => {
      pullCb?.(mode)
    },
  }
}

async function freshModule() {
  vi.resetModules()
  return await import('./darkMode')
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).lynx
  delete (globalThis as Record<string, unknown>).NativeModules
  delete (globalThis as Record<string, unknown>).matchMedia
  vi.restoreAllMocks()
})

describe('darkMode（暗色哑桥 + 三态校验）', () => {
  describe('三态清单（themeColor 同模式）', () => {
    it('DEFAULT_DARK_MODE = "system"', async () => {
      const m = await freshModule()
      expect(m.DEFAULT_DARK_MODE).toBe('system')
    })

    it('DARK_MODE_IDS 与 DARK_MODE_OPTIONS 派生一致（无第二份 id 列表漂移）', async () => {
      const m = await freshModule()
      expect(m.DARK_MODE_IDS).toEqual(['light', 'dark', 'system'])
      expect(m.DARK_MODE_OPTIONS.map((o) => o.id)).toEqual(m.DARK_MODE_IDS)
    })

    it('isDarkModeId 合法值判真', async () => {
      const m = await freshModule()
      for (const id of ['light', 'dark', 'system'] as const) {
        expect(m.isDarkModeId(id)).toBe(true)
      }
    })

    it('isDarkModeId 非法值判假', async () => {
      const m = await freshModule()
      for (const v of ['', 'auto', 'LIGHT', 'System', 'null', 'undefined']) {
        expect(m.isDarkModeId(v)).toBe(false)
      }
    })
  })

  describe('web-core 预览（matchMedia 路径）', () => {
    it('matchMedia 拉初值 light → currentDarkMode = light + 通知订阅者', async () => {
      const mq = setupMatchMedia(false)
      const m = await freshModule()
      const cb = vi.fn()
      const off = m.getDarkMode(cb)
      // matchMedia 同步设置初值；cb 首次回调 = 初值
      expect(m.currentDarkMode.value).toBe('light')
      expect(cb).toHaveBeenCalledWith('light')
      off()
      // 实际 fire 验证订阅被注册
      mq.fire(true)
      expect(m.currentDarkMode.value).toBe('dark')
    })

    it('matchMedia 拉初值 dark → currentDarkMode = dark', async () => {
      setupMatchMedia(true)
      const m = await freshModule()
      m.getDarkMode(() => {})
      expect(m.currentDarkMode.value).toBe('dark')
    })

    it('matchMedia change 触发 setMode 并通知所有订阅者（多订阅）', async () => {
      const mq = setupMatchMedia(false)
      const m = await freshModule()
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      m.getDarkMode(cb1)
      m.subscribeDarkMode(cb2)
      // 首次 getDarkMode 立即回调初值；change 不重复 fire 初值
      cb1.mockClear()
      cb2.mockClear()
      mq.fire(true)
      expect(m.currentDarkMode.value).toBe('dark')
      expect(cb1).toHaveBeenCalledWith('dark')
      expect(cb2).toHaveBeenCalledWith('dark')
    })

    it('matchMedia 不可用 → console.warn + 恒 light（禁静默降级）', async () => {
      // 显式删 matchMedia（node 环境默认无）
      delete (globalThis as Record<string, unknown>).matchMedia
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const m = await freshModule()
      const cb = vi.fn()
      m.getDarkMode(cb)
      expect(m.currentDarkMode.value).toBe('light')
      expect(cb).toHaveBeenCalledWith('light')
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[darkMode] matchMedia 不可用'),
      )
      warnSpy.mockRestore()
    })

    it('matchMedia addListener（legacy Safari < 14）兜底可用', async () => {
      const listeners: Array<(e: { matches: boolean }) => void> = []
      ;(globalThis as Record<string, unknown>).matchMedia = () => {
        const mq: unknown = {
          matches: false,
          // 仅 addListener（无 addEventListener）模拟老浏览器
          addListener: (cb: (e: { matches: boolean }) => void) => listeners.push(cb),
        }
        return mq
      }
      const m = await freshModule()
      m.getDarkMode(() => {})
      expect(m.currentDarkMode.value).toBe('light')
      // legacy fire
      for (const cb of listeners) cb({ matches: true })
      expect(m.currentDarkMode.value).toBe('dark')
    })

    it('getDarkMode 重复调用：幂等（ensureInit 一次）', async () => {
      setupMatchMedia(false)
      const m = await freshModule()
      m.getDarkMode(() => {})
      m.getDarkMode(() => {})
      m.getDarkMode(() => {})
      // currentDarkMode 仍为 light，无误覆盖
      expect(m.currentDarkMode.value).toBe('light')
    })

    it('ensureDarkModeInit：幂等启桥（拉到真实系统态）且后续 change 仍生效', async () => {
      const mq = setupMatchMedia(true)
      const m = await freshModule()
      // 调用前：初值兜底 light（模块无副作用）
      expect(m.currentDarkMode.value).toBe('light')
      // 启桥后：无需任何订阅者即拉到真实系统态
      m.ensureDarkModeInit()
      expect(m.currentDarkMode.value).toBe('dark')
      // 幂等：重复调用不改变结果
      m.ensureDarkModeInit()
      expect(m.currentDarkMode.value).toBe('dark')
      // 监听已注册（后续变化仍重算）
      mq.fire(false)
      expect(m.currentDarkMode.value).toBe('light')
    })
  })

  describe('native 路径（PictelioApp.getDarkMode + pictelioDarkMode 事件）', () => {
    it('pull 拉初值 dark → currentDarkMode = dark', async () => {
      const n = setupNative()
      const m = await freshModule()
      const cb = vi.fn()
      m.getDarkMode(cb)
      // pull 由测试显式 fire（模拟原生 setTimeout 异步拉取）
      n.firePull('dark')
      expect(m.currentDarkMode.value).toBe('dark')
      expect(cb).toHaveBeenCalledWith('dark')
    })

    it('pull 拉初值 light → currentDarkMode = light', async () => {
      const n = setupNative()
      const m = await freshModule()
      const cb = vi.fn()
      m.getDarkMode(cb)
      n.firePull('light')
      expect(m.currentDarkMode.value).toBe('light')
      expect(cb).toHaveBeenCalledWith('light')
    })

    it('ensureDarkModeInit：native 侧订阅已注册 + pull 已发起（无回调消费方也能取到系统态）', async () => {
      const n = setupNative()
      const m = await freshModule()
      m.ensureDarkModeInit()
      // 事件通道已挂（启桥的一部分）：后续变化经事件写入
      const listeners = n.emitter.listeners['pictelioDarkMode']
      expect(listeners?.length).toBe(1)
      listeners[0](JSON.stringify({ mode: 'dark' }))
      expect(m.currentDarkMode.value).toBe('dark')
      // pull 通道已发起：原生回调写入当前值
      n.firePull('light')
      expect(m.currentDarkMode.value).toBe('light')
    })

    it('pictelioDarkMode 事件（标准 JSON 载荷）：mode=dark 即时更新 + 通知订阅者', async () => {
      const n = setupNative()
      const m = await freshModule()
      const cb = vi.fn()
      m.getDarkMode(cb)
      n.firePull('light')
      cb.mockClear()
      const listeners = n.emitter.listeners['pictelioDarkMode']
      expect(listeners?.length).toBe(1)
      listeners[0](JSON.stringify({ mode: 'dark' }))
      expect(m.currentDarkMode.value).toBe('dark')
      expect(cb).toHaveBeenCalledWith('dark')
    })

    it('pictelioDarkMode 事件（裸字符串载荷兼容）："light" 直接识别', async () => {
      const n = setupNative()
      const m = await freshModule()
      const cb = vi.fn()
      m.getDarkMode(cb)
      n.firePull('dark')
      cb.mockClear()
      const listeners = n.emitter.listeners['pictelioDarkMode']
      listeners[0]('light')
      expect(m.currentDarkMode.value).toBe('light')
      expect(cb).toHaveBeenCalledWith('light')
    })

    it('pictelioDarkMode 事件非法载荷：console.warn + 忽略（不污染现值）', async () => {
      const n = setupNative()
      const m = await freshModule()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const cb = vi.fn()
      m.getDarkMode(cb)
      n.firePull('light')
      expect(m.currentDarkMode.value).toBe('light')
      cb.mockClear()
      const listeners = n.emitter.listeners['pictelioDarkMode']
      listeners[0]('something_invalid')
      // 非法 = 不变
      expect(m.currentDarkMode.value).toBe('light')
      expect(cb).not.toHaveBeenCalled()
      // console.warn 第一参含模块前缀 + 事件名（拼接单串）
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[darkMode] pictelioDarkMode 非法载荷'),
        'something_invalid',
      )
      warnSpy.mockRestore()
    })

    it('原生 pull 非法值（既非 light 也非 dark）：console.warn + 维持兜底 light', async () => {
      const n = setupNative()
      const m = await freshModule()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      m.getDarkMode(() => {})
      // pull 立即回调非法值
      n.firePull('garbage')
      // 非法 pull：currentDarkMode 不被污染（仍是兜底 light）
      expect(m.currentDarkMode.value).toBe('light')
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[darkMode] 原生 getDarkMode'),
        'garbage',
      )
      warnSpy.mockRestore()
    })

    it('native 模式 emitter 不可用 → console.warn + pull 仍可写值（禁静默降级）', async () => {
      // IO 边界 #a：GlobalEventEmitter 缺失（lynx getJSModule 返回无 addListener）
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      // 注入 PictelioApp.getDarkMode 把 cb 转发给外部控制；emitter 故意空实现。
      // 用对象作 holder 绕开 TS strict 下对闭包内 let 的 narrowing 限制。
      const holder: { cb: ((mode: string) => void) | null } = { cb: null }
      ;(globalThis as Record<string, unknown>).lynx = {
        getJSModule: () => ({
          // 故意不实现 addListener
        }),
      }
      ;(globalThis as Record<string, unknown>).NativeModules = {
        PictelioApp: {
          getDarkMode: (cb: (mode: string) => void) => {
            holder.cb = cb
          },
        },
      }
      const m = await freshModule()
      m.getDarkMode(() => {})
      // pull 仍照常 fire，验证路径未整体死锁
      expect(holder.cb).not.toBeNull()
      holder.cb?.('dark')
      expect(m.currentDarkMode.value).toBe('dark')
      // 关键是 warn 可见（禁静默降级）
      const calls = warn.mock.calls.map((c) => String(c[0]))
      expect(calls.some((msg) => msg.includes('GlobalEventEmitter 不可用'))).toBe(true)
    })

    it('native 模式 getDarkMode 不可用 → console.warn + 系统暗色恒 light', async () => {
      // IO 边界 #b：PictelioApp.getDarkMode 缺失（模拟原生插件未注册或方法被砍）
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      ;(globalThis as Record<string, unknown>).lynx = {
        getJSModule: () => ({
          addListener: () => {},
          removeListener: () => {},
        }),
      }
      ;(globalThis as Record<string, unknown>).NativeModules = {
        PictelioApp: {
          // 故意不实现 getDarkMode
        },
      }
      const m = await freshModule()
      m.getDarkMode(() => {})
      expect(m.currentDarkMode.value).toBe('light')
      const calls = warn.mock.calls.map((c) => String(c[0]))
      expect(calls.some((m) => m.includes('PictelioApp.getDarkMode 不可用'))).toBe(true)
    })

    it('订阅者回调异常：隔离硬约束（其他订阅者正常收到通知）', async () => {
      const mq = setupMatchMedia(false)
      const m = await freshModule()
      const cb1 = vi.fn(() => {
        throw new Error('boom')
      })
      const cb2 = vi.fn()
      m.subscribeDarkMode(cb1)
      m.subscribeDarkMode(cb2)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mq.fire(true)
      expect(m.currentDarkMode.value).toBe('dark')
      expect(cb1).toHaveBeenCalledWith('dark')
      expect(cb2).toHaveBeenCalledWith('dark')
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[darkMode] 订阅者回调异常'),
        expect.anything(),
      )
      warnSpy.mockRestore()
    })

    it('subscribeDarkMode 仅订阅（不立即回调）；getDarkMode 立即回调', async () => {
      const mq = setupMatchMedia(false)
      const m = await freshModule()
      const cb = vi.fn()
      m.subscribeDarkMode(cb)
      expect(cb).not.toHaveBeenCalled()
      // 触发 change
      mq.fire(true)
      expect(cb).toHaveBeenCalledWith('dark')
    })

    it('unsubscribeDarkMode / 返回 unsubscribe 函数：退订后不再通知', async () => {
      const mq = setupMatchMedia(false)
      const m = await freshModule()
      const cb = vi.fn()
      const off = m.getDarkMode(cb)
      // 取消订阅
      m.unsubscribeDarkMode(off)
      mq.fire(true)
      expect(cb).toHaveBeenCalledTimes(1) // 仅首帧立即回调，无 change 回调
      expect(cb).toHaveBeenLastCalledWith('light')
    })
  })

  describe('currentDarkMode（响应式 ref）', () => {
    it('初始值 = "light"（最保守兜底，避免暗色首闪）', async () => {
      const m = await freshModule()
      // 模块无副作用：currentDarkMode 默认 = light
      expect(m.currentDarkMode.value).toBe('light')
    })

    it('ref 是 reactive（外部赋值可见，与 settingsStore.computed 兼容）', async () => {
      const m = await freshModule()
      const localRef = ref(m.currentDarkMode)
      expect(localRef.value).toBe('light')
      m.currentDarkMode.value = 'dark'
      expect(localRef.value).toBe('dark')
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachTranslateFrameListener,
  nativeTranslateProvider,
  translatePoll,
} from '../../../src/api/nativeTranslate'

/**
 * 事件总线交付通道的单测（AGENTS.md 测试硬约束 #1：IO 边界必须成功 + 失败双路径）。
 *
 * <p>为什么必须有：这条通道是本功能**唯一可用的交付路径**（callback 通道实测一条流至多
 * 一帧；轮询实测 0 回调，见 ADR-0170「交付通道实测」）。它此前零防线。
 *
 * <p>Oracle 溯源（硬约束 #6）：期望值来自 ADR-0170 的跨端契约条款，不是实现输出——
 * 事件名 {@code pictelioTranslateFrame}、载荷为帧 JSON 字符串、非法载荷必须留 warn。
 */

type Listener = (...args: unknown[]) => void

interface FakeEmitter {
  listeners: Map<string, Listener[]>
  addListener: (event: string, cb: Listener) => void
  removeListener: (event: string, cb: Listener) => void
  emit: (event: string, ...args: unknown[]) => void
  count: (event: string) => number
}

function installFakeLynx(): FakeEmitter {
  const listeners = new Map<string, Listener[]>()
  const emitter: FakeEmitter = {
    listeners,
    addListener(event, cb) {
      listeners.set(event, [...(listeners.get(event) ?? []), cb])
    },
    removeListener(event, cb) {
      listeners.set(event, (listeners.get(event) ?? []).filter((l) => l !== cb))
    },
    emit(event, ...args) {
      for (const cb of [...(listeners.get(event) ?? [])]) cb(...args)
    },
    count(event) {
      return (listeners.get(event) ?? []).length
    },
  }
  // 与仓内既有夹具同模式（utils/safeArea.test.ts）：globalThis.lynx
  ;(globalThis as { lynx?: unknown }).lynx = { getJSModule: () => emitter }
  return emitter
}

describe('attachTranslateFrameListener（事件总线交付通道）', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    delete (globalThis as { lynx?: unknown }).lynx
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('订阅 pictelioTranslateFrame，收到帧 JSON 字符串 → 回调解析后的对象', () => {
    const emitter = installFakeLynx()
    const frames: unknown[] = []
    attachTranslateFrameListener((f) => frames.push(f))

    expect(emitter.count('pictelioTranslateFrame')).toBe(1)
    emitter.emit(
      'pictelioTranslateFrame',
      JSON.stringify({ type: 'delta_all', paragraphs: [{ index: 0, text: '译文' }] }),
    )

    expect(frames).toEqual([
      { type: 'delta_all', paragraphs: [{ index: 0, text: '译文' }] },
    ])
  })

  it('取消订阅后不再收到任何帧（终态解绑依赖此契约）', () => {
    const emitter = installFakeLynx()
    const frames: unknown[] = []
    const detach = attachTranslateFrameListener((f) => frames.push(f))
    detach()

    expect(emitter.count('pictelioTranslateFrame')).toBe(0)
    emitter.emit('pictelioTranslateFrame', JSON.stringify({ type: 'done' }))
    expect(frames).toEqual([])
  })

  it('通道不可用 → warn + no-op（禁静默降级，硬约束 #3）', () => {
    // 未安装 globalThis.lynx
    const frames: unknown[] = []
    const detach = attachTranslateFrameListener((f) => frames.push(f))
    expect(() => detach()).not.toThrow()
    expect(frames).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('全局事件通道不可用'),
    )
  })

  it('载荷类型异常（非字符串）→ warn 并丢弃，不得静默（硬约束 #3）', () => {
    const emitter = installFakeLynx()
    const frames: unknown[] = []
    attachTranslateFrameListener((f) => frames.push(f))

    emitter.emit('pictelioTranslateFrame', 42)
    emitter.emit('pictelioTranslateFrame', undefined)

    expect(frames).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('载荷类型异常'),
      expect.anything(),
    )
  })

  it('载荷无法解析为帧对象 → warn 并丢弃，不得静默（硬约束 #3）', () => {
    const emitter = installFakeLynx()
    const frames: unknown[] = []
    attachTranslateFrameListener((f) => frames.push(f))

    emitter.emit('pictelioTranslateFrame', 'not json at all')

    expect(frames).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('无法解析为帧对象'),
      expect.anything(),
    )
  })

  it('轮询回调失败（原生 reject）→ 抛错，不得静默成功', async () => {
    // 硬约束 #1 的失败路径：translatePoll 的原生错误必须显式暴露
    ;(globalThis as { NativeModules?: unknown }).NativeModules = {
      PictelioTranslate: {
        translatePoll: (_id: string, cb: (v: string | null, e: string | null) => void) =>
          cb('', '轮询失败：boom'),
      },
    }
    await expect(translatePoll('s-1')).rejects.toThrow('轮询失败：boom')
  })

  it('轮询返回 pending → 解析为 pending 对象（继续轮询的判据）', async () => {
    ;(globalThis as { NativeModules?: unknown }).NativeModules = {
      PictelioTranslate: {
        translatePoll: (_id: string, cb: (v: string | null, e: string | null) => void) =>
          cb(JSON.stringify({ type: 'pending' }), ''),
      },
    }
    await expect(translatePoll('s-1')).resolves.toEqual({ type: 'pending' })
  })

  it('Provider：原生 reject → 迭代器产出 error chunk 且不静默', async () => {
    ;(globalThis as { NativeModules?: unknown }).NativeModules = {
      PictelioTranslate: {
        translateStream: () => Promise.resolve({ abort: () => Promise.resolve() }),
        translatePoll: (_id: string, cb: (v: string | null, e: string | null) => void) =>
          cb('', '网络错误：boom'),
      },
    }
    const provider = nativeTranslateProvider()
    const iter = provider.translate(
      { novelId: 1, chapterId: 'c1', paragraphs: ['a'], options: { xRestrict: 0 } },
      { baseURL: 'https://x', apiKey: '', model: 'm' },
      new AbortController().signal,
    )
    const first = await iter.next()
    expect(first.done).toBe(false)
    expect((first.value as { type: string }).type).toBe('error')
  })

  it('连续订阅两次 → 两个监听器互不干扰（解绑只移除自己的）', () => {
    const emitter = installFakeLynx()
    const first: unknown[] = []
    const second: unknown[] = []
    const detachFirst = attachTranslateFrameListener((f) => first.push(f))
    attachTranslateFrameListener((f) => second.push(f))
    expect(emitter.count('pictelioTranslateFrame')).toBe(2)

    detachFirst()
    expect(emitter.count('pictelioTranslateFrame')).toBe(1)
    emitter.emit('pictelioTranslateFrame', JSON.stringify({ type: 'done' }))

    expect(first).toEqual([])
    expect(second).toEqual([{ type: 'done' }])
  })
})

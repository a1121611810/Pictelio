import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  attachTranslateFrameListener,
  classifyNativeError,
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

// ─────────────────── #993：时序档（与 novelTranslateStore 的 slowCacheMiss 同族但注入点不同）───────────────────
//
// 形态沿用 `novelTranslateStore.test.ts` 的 `describe.each(TIMING_PROFILES)` + `vi.waitFor`（#758/#762），
// **注入点不同**：那边延迟「provider 启动前的缓存读」，这边延迟 **原生桥方法调用本身**
// （translateStream / abortStream / translatePoll 晚 delayMs 才被调、回调也晚到）。
// 取这个注入点的原因：本文件的可观测事实不是 store 状态（没有状态可等），而是
// **事件总线监听器计数**与**原生桥调用记录**，它们唯一的上游就是原生桥 mock。
//
// 恶意档常驻运行：任何人再把 `vi.waitFor(条件)` 写回 `await sleep(N)` 后立即断言，
// 恶意档会**确定性变红**（250ms > 任何合理的 N），而不是等 CI 在负载下偶发失败。
const rawHostileDelayMs = Number(process.env.PIXIVIZER_TEST_BRIDGE_DELAY_MS)
const HOSTILE_BRIDGE_DELAY_MS =
  Number.isFinite(rawHostileDelayMs) && rawHostileDelayMs > 0 ? Math.min(rawHostileDelayMs, 1000) : 250
const TIMING_PROFILES = [
  { profile: '正常时序', bridgeDelayMs: 0 },
  {
    profile: `恶意时序·原生桥回调晚 ${HOSTILE_BRIDGE_DELAY_MS}ms`,
    bridgeDelayMs: HOSTILE_BRIDGE_DELAY_MS,
  },
] as const

/**
 * 条件等待预算：远大于注入延迟（≤1000ms）+ 负载抖动，失败时能拿到断言差异；
 * 且单次 2500ms 远小于 vitest 5s 单测超时，不会用 "Test timed out" 盖掉真实失败原因。
 */
const WAIT_FOR_OPTS = { timeout: 2500 } as const

/** 在飞的（被延迟注入的）原生桥调用数——收尾断言用：保证没有回调在用例结束后才迟到。 */
let bridgeInFlight = 0

/**
 * 原生桥延迟注入：把回调式原生方法整体延后 delayMs 才调用（回调也随之晚到）。
 * 返回值在生产侧被忽略（三个方法都是 `mod.x(args..., cb)` 形态），故不返回。
 * 正常档直接透传原对象（零行为变化）。
 */
function withBridgeDelay<T extends Record<string, unknown>>(mod: T, delayMs: number): T {
  if (delayMs <= 0) return mod
  const wrapped: Record<string, unknown> = {}
  for (const [name, raw] of Object.entries(mod)) {
    if (typeof raw !== 'function') {
      wrapped[name] = raw
      continue
    }
    const fn = raw as (...args: unknown[]) => unknown
    wrapped[name] = (...args: unknown[]) => {
      bridgeInFlight++
      setTimeout(() => {
        try {
          fn(...args)
        } finally {
          bridgeInFlight--
        }
      }, delayMs)
    }
  }
  return wrapped as T
}

/** 收尾：等本档注入的延迟桥调用全部落定（不留跨用例的在飞回调/定时器） */
const drainBridgeCalls = (): Promise<void> =>
  vi.waitFor(() => expect(bridgeInFlight).toBe(0), WAIT_FOR_OPTS)

/** 收尾：把挂起的迭代器拉到底（abort 后 next() 必抛 AbortError；此处吞掉即可） */
const settleIter = (iter: { next: () => Promise<unknown> }): Promise<unknown> =>
  iter.next().catch(() => undefined)

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

  it('原生错误消息 → 错误码分类（UI 据此选 i18n 文案，ADR-0173 D7）', () => {
    // oracle：HTTP 状态码语义（401/403 凭证、429 限流、5xx 服务端、其余网络）
    expect(classifyNativeError('HTTP 502: ')).toBe('server')
    expect(classifyNativeError('HTTP 401: invalid api key')).toBe('unauthorized')
    expect(classifyNativeError('HTTP 403: forbidden')).toBe('unauthorized')
    expect(classifyNativeError('HTTP 429: slow down')).toBe('rate_limit')
    expect(classifyNativeError('HTTP 400: bad request')).toBe('invalid_request')
    expect(classifyNativeError('HTTP 402: insufficient balance')).toBe('insufficient_balance')
    expect(classifyNativeError('HTTP 404: model not found')).toBe('model_not_found')
    expect(classifyNativeError('LLM 未返回任何译文（可能被服务端内容策略拦截）')).toBe('content_filter')
    expect(classifyNativeError('网络错误：boom')).toBe('network')
    expect(classifyNativeError(undefined)).toBe('network')
  })

  it('失败终态经事件总线 → store 收敛 failed（review 要求的修复核心防线）', async () => {
    // 这是「失败终态必须交付」的回归防线：Java 侧 publish 出 error 帧 → 适配器 → store。
    const emitter = installFakeLynx()
    let sentToken = ''
    ;(globalThis as { NativeModules?: unknown }).NativeModules = {
      PictelioTranslate: {
        translateStream: (json: string) => {
          // 本流 id = 适配器实际发出的 _abortToken（Java 回显的就是它）
          sentToken = (JSON.parse(json) as { _abortToken?: string })._abortToken ?? ''
          return Promise.resolve({ abort: () => Promise.resolve() })
        },
        translatePoll: (_id: string, cb: (v: string | null, e: string | null) => void) =>
          cb(JSON.stringify({ type: 'pending' }), ''),
      },
    }
    const provider = nativeTranslateProvider()
    const iter = provider.translate(
      { novelId: 1, chapterId: 'c1', paragraphs: ['a'], options: { xRestrict: 0 } },
      { baseURL: 'https://x', apiKey: '', model: 'm' },
      new AbortController().signal,
    )
    await new Promise((r) => setTimeout(r, 10))
    expect(sentToken).not.toBe('')
    // 事件总线送失败终态（Java 在 HTTP 非 2xx / 异常 / abort 时就是这么发的）
    emitter.emit(
      'pictelioTranslateFrame',
      JSON.stringify({ type: 'error', message: 'HTTP 502: ', streamId: sentToken }),
    )
    const first = await iter.next()
    expect(first.done).toBe(false)
    expect(first.value).toMatchObject({ type: 'error', code: 'server' })
  })

  it('transport 走 errMsg 契约失败后监听器为 0', async () => {
    // 生产里原生失败是 cb("", errMsg)（见 translateStream 终止契约），不是 throw。
    const emitter = installFakeLynx()
    ;(globalThis as { NativeModules?: unknown }).NativeModules = {
      PictelioTranslate: {
        translateStream: (_json: string, cb: (c: string | null, e: string | null) => void) => {
          setTimeout(() => cb('', 'HTTP 502'), 0)
        },
        translatePoll: (_id: string, cb: (v: string | null, e: string | null) => void) =>
          cb(JSON.stringify({ type: 'pending' }), ''),
      },
    }
    const provider = nativeTranslateProvider()
    const iter = provider.translate(
      { novelId: 1, chapterId: 'c1', paragraphs: ['a'], options: { xRestrict: 0 } },
      { baseURL: 'https://x', apiKey: '', model: 'm' },
      new AbortController().signal,
    )
    const first = await iter.next()
    expect((first.value as { type: string }).type).toBe('error')
    expect(emitter.count('pictelioTranslateFrame')).toBe(0)
  })

  it('轮询交付终态帧后监听器为 0（复审实测此处曾永久泄漏）', async () => {
    const emitter = installFakeLynx()
    ;(globalThis as { NativeModules?: unknown }).NativeModules = {
      PictelioTranslate: {
        translateStream: () => Promise.resolve({ abort: () => Promise.resolve() }),
        // #653 修复后 provider.abort() / signal.abort() 会真的调到原生 abortStream；
        // 生产 PictelioTranslate 必暴露该 @LynxMethod（ADR-0170 §D7）。漏 mock 会让无关用例
        // 抛 "mod.abortStream is not a function"。
        abortStream: (_id: string, cb: (err: string | null) => void) => cb(null),
        translatePoll: (_id: string, cb: (v: string | null, e: string | null) => void) =>
          cb(JSON.stringify({ type: 'error', message: 'boom' }), ''),
      },
    }
    const provider = nativeTranslateProvider()
    await provider
      .translate(
        { novelId: 1, chapterId: 'c1', paragraphs: ['a'], options: { xRestrict: 0 } },
        { baseURL: 'https://x', apiKey: '', model: 'm' },
        new AbortController().signal,
      )
      .next()
    expect(emitter.count('pictelioTranslateFrame')).toBe(0)
  })

  it('两路交付同一帧（同 seq）只产出一次 delta', async () => {
    // 复审 M2：旧版只断言「首块是 delta」，删掉去重实现仍绿 → 零防线。
    // 现在**数重复条数**：真实场景下 Java 两路发送的是同一字符串（入缓冲时盖一次 seq）。
    const emitter = installFakeLynx()
    ;(globalThis as { NativeModules?: unknown }).NativeModules = {
      PictelioTranslate: {
        translateStream: () => Promise.resolve({ abort: () => Promise.resolve() }),
        // #653 修复后 provider.abort() / signal.abort() 会真的调到原生 abortStream；
        // 生产 PictelioTranslate 必暴露该 @LynxMethod（ADR-0170 §D7）。漏 mock 会让无关用例
        // 抛 "mod.abortStream is not a function"。
        abortStream: (_id: string, cb: (err: string | null) => void) => cb(null),
        translatePoll: (_id: string, cb: (v: string | null, e: string | null) => void) => {
          // 轮询交付与总线同一个 seq 的帧（Java 缓冲内是同一字符串）
          cb(JSON.stringify({ type: 'delta_all', paragraphs: [{ index: 0, text: '译文' }], seq: 0 }), '')
        },
      },
    }
    const provider = nativeTranslateProvider()
    const iter = provider.translate(
      { novelId: 1, chapterId: 'c1', paragraphs: ['a'], options: { xRestrict: 0 } },
      { baseURL: 'https://x', apiKey: '', model: 'm' },
      new AbortController().signal,
    )
    await new Promise((r) => setTimeout(r, 5))
    // 事件总线交付同一 seq（同 streamId 语义）
    emitter.emit(
      'pictelioTranslateFrame',
      JSON.stringify({ type: 'delta_all', paragraphs: [{ index: 0, text: '译文' }], seq: 0 }),
    )
    await new Promise((r) => setTimeout(r, 5))

    // 数出所有 delta：去重生效时必须只有 1 条（旧断言只看首块 → 删掉去重也绿）
    const deltas: string[] = []
    for (let i = 0; i < 6; i++) {
      const n = await Promise.race([iter.next(), new Promise<null>((r) => setTimeout(() => r(null), 20))])
      if (n === null) break
      const v = n.value as { type: string; text?: string } | undefined
      if (v && v.type === 'delta') deltas.push(v.text ?? '')
      if (n.done) break
    }
    expect(deltas).toHaveLength(1)
  })

  // #993：本用例的「监听器解绑」必须在两档时序下都成立，且**自身不留下在飞 IO**——
  // 此前它只断监听器、不 abort signal，pending 轮询会以 250ms × 600 继续跑到用例之后。
  describe.each(TIMING_PROFILES)('provider.abort 收尾（[$profile]）', ({ bridgeDelayMs }) => {
    beforeEach(() => {
      bridgeInFlight = 0
    })

    it('provider.abort() 后监听器被解绑（不泄漏）', async () => {
      const emitter = installFakeLynx()
      ;(globalThis as { NativeModules?: unknown }).NativeModules = {
        PictelioTranslate: withBridgeDelay(
          {
            translateStream: () => Promise.resolve({ abort: () => Promise.resolve() }),
            // #653 修复后 provider.abort() / signal.abort() 会真的调到原生 abortStream；
            // 生产 PictelioTranslate 必暴露该 @LynxMethod（ADR-0170 §D7）。漏 mock 会让无关用例
            // 抛 "mod.abortStream is not a function"。
            abortStream: (_id: string, cb: (err: string | null) => void) => cb(null),
            translatePoll: (_id: string, cb: (v: string | null, e: string | null) => void) =>
              cb(JSON.stringify({ type: 'pending' }), ''),
          },
          bridgeDelayMs,
        ),
      }
      const provider = nativeTranslateProvider()
      const controller = new AbortController()
      // 监听器订阅在 translate() 内**同步**完成 → 直接断言，无需等任何时间
      const iter = provider.translate(
        { novelId: 1, chapterId: 'c1', paragraphs: ['a'], options: { xRestrict: 0 } },
        { baseURL: 'https://x', apiKey: '', model: 'm' },
        controller.signal,
      )
      try {
        expect(emitter.count('pictelioTranslateFrame')).toBe(1)
        provider.abort()
        expect(emitter.count('pictelioTranslateFrame')).toBe(0)
      } finally {
        // 收尾：provider.abort() 只解绑监听器、**不清轮询定时器**；不 abort signal 的话
        // pending 轮询会继续 600 × 250ms 直到用例结束之后（跨用例幽灵 IO）。
        controller.abort()
        await settleIter(iter)
        await drainBridgeCalls()
        expect(emitter.count('pictelioTranslateFrame')).toBe(0)
      }
    })
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
        // #653 修复后 provider.abort() / signal.abort() 会真的调到原生 abortStream；
        // 生产 PictelioTranslate 必暴露该 @LynxMethod（ADR-0170 §D7）。漏 mock 会让无关用例
        // 抛 "mod.abortStream is not a function"。
        abortStream: (_id: string, cb: (err: string | null) => void) => cb(null),
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

  it('按本流 id 过滤：异 id 帧被丢弃（陈旧流不得写进当前翻译）', () => {
    // id 由 transport 复用为 _abortToken，Java 回显同一个值 → 两端必然一致，
    // 故直接用本流 id 判定即可（不再让首帧夺取归属权，否则陈旧流会顶替本流）。
    const emitter = installFakeLynx()
    const mine: unknown[] = []
    attachTranslateFrameListener((f) => mine.push(f), 'my-stream')

    emitter.emit(
      'pictelioTranslateFrame',
      JSON.stringify({ type: 'delta_all', paragraphs: [{ index: 0, text: '别人的' }], streamId: 'stale-stream' }),
    )
    expect(mine).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('丢弃非本流帧'))

    emitter.emit(
      'pictelioTranslateFrame',
      JSON.stringify({ type: 'delta_all', paragraphs: [{ index: 0, text: '我的' }], streamId: 'my-stream' }),
    )
    expect(mine).toHaveLength(1)
  })

  it('未声明期望 streamId 时不做归属过滤（向后兼容旧载荷）', () => {
    const emitter = installFakeLynx()
    const frames: unknown[] = []
    attachTranslateFrameListener((f) => frames.push(f))
    emitter.emit('pictelioTranslateFrame', JSON.stringify({ type: 'done' }))
    expect(frames).toEqual([{ type: 'done' }])
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

// ─────────────────── 取消通道（ADR-0170 :344）── #653 回归 ───────────────────
//
// ADR-0170 :344 规定的形态：
//   controller.signal.addEventListener("abort", () => translateModule.abortStream(token))
//
// 此前 nativeTranslate.ts 把句柄挂在 translateStream promise 的 .then 上
// （:603-606），但该 promise 只在 callback 通道投递 done 帧时 settle（实测不可靠），
// → 句柄永远 null → abort 失联 → 用户点停止/切章节/离开页面，原生 OkHttp Call
// 不会取消。本组用例钉住：JS abort 必能触达原生 bridge。
describe.each(TIMING_PROFILES)('native 取消通道（#653：JS abort 必须触达原生 abortStream）[$profile]', ({ bridgeDelayMs }) => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    bridgeInFlight = 0
    // 用例各自安装 fake lynx；先清掉上一例留下的全局 emitter，否则「没装 emitter 的用例」
    // 会静默复用上一例的监听器表（跨用例耦合，#993 收口）
    delete (globalThis as { lynx?: unknown }).lynx
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('signal.abort() → abortStream 被调用且 streamId 与 translateStream 请求体一致', async () => {
    // 关键：mock translateStream 永不 resolve（复现 callback 通道不可靠的真实形态），
    // 如果实现依赖 promise.then 拿句柄，本测试必红。
    let abortStreamCalledWith: string | null = null
    let sentToken = ''
    ;(globalThis as { NativeModules?: unknown }).NativeModules = {
      PictelioTranslate: withBridgeDelay(
        {
          translateStream: (json: string) => {
            sentToken = (JSON.parse(json) as { _abortToken?: string })._abortToken ?? ''
            // 永不 settle —— callback 通道实测不可靠的场景
            return new Promise<{ abort: () => Promise<void> }>(() => {})
          },
          translatePoll: (_id: string, cb: (v: string | null, e: string | null) => void) =>
            cb(JSON.stringify({ type: 'pending' }), ''),
          abortStream: (id: string, cb: (err: string | null) => void) => {
            abortStreamCalledWith = id
            cb(null)
          },
        },
        bridgeDelayMs,
      ),
    }
    const provider = nativeTranslateProvider()
    const controller = new AbortController()
    const iter = provider.translate(
      { novelId: 1, chapterId: 'c1', paragraphs: ['原文'], options: { xRestrict: 0 } },
      { baseURL: 'https://x', apiKey: '', model: 'm' },
      controller.signal,
    )
    try {
      // 等条件：原生 translateStream 真被调过（恶意档下该调用晚 250ms 送达）
      await vi.waitFor(() => expect(sentToken).not.toBe(''), WAIT_FOR_OPTS)

      // 用户主动 abort
      controller.abort()

      // 关键断言 1 + 2：原生 abortStream 必被调用，且传入的 id = 请求里的 _abortToken
      // （恶意档下 abortStream 调用同样晚到 → 必须等条件，不能等时间）
      await vi.waitFor(() => expect(abortStreamCalledWith).toBe(sentToken), WAIT_FOR_OPTS)

      // 关键断言 3：迭代器抛 AbortError（spec §7.2 aborted 状态），不是 error chunk
      await expect(iter.next()).rejects.toThrow('aborted')
    } finally {
      controller.abort()
      await settleIter(iter)
      await drainBridgeCalls()
    }
  })

  it('provider.abort() → abortStream 也被调用（同 streamId）', async () => {
    // #653 的另一条入口：调用方可能只调 provider.abort() 而不走 signal（复审实测），
    // 此路径此前同样 no-op。
    let abortStreamCalledWith: string | null = null
    let sentToken = ''
    ;(globalThis as { NativeModules?: unknown }).NativeModules = {
      PictelioTranslate: withBridgeDelay(
        {
          translateStream: (json: string) => {
            sentToken = (JSON.parse(json) as { _abortToken?: string })._abortToken ?? ''
            return new Promise<{ abort: () => Promise<void> }>(() => {})
          },
          translatePoll: (_id: string, cb: (v: string | null, e: string | null) => void) =>
            cb(JSON.stringify({ type: 'pending' }), ''),
          abortStream: (id: string, cb: (err: string | null) => void) => {
            abortStreamCalledWith = id
            cb(null)
          },
        },
        bridgeDelayMs,
      ),
    }
    const provider = nativeTranslateProvider()
    const controller = new AbortController()
    const iter = provider.translate(
      { novelId: 1, chapterId: 'c1', paragraphs: ['原文'], options: { xRestrict: 0 } },
      { baseURL: 'https://x', apiKey: '', model: 'm' },
      controller.signal,
    )
    try {
      await vi.waitFor(() => expect(sentToken).not.toBe(''), WAIT_FOR_OPTS)

      provider.abort()

      await vi.waitFor(() => expect(abortStreamCalledWith).toBe(sentToken), WAIT_FOR_OPTS)
      expect(abortStreamCalledWith).not.toBe('')
    } finally {
      // 收尾：provider.abort() 不清轮询定时器（pending 会继续 600 × 250ms），
      // 必须补 abort signal + 拉干迭代器与在飞桥调用，否则泄漏跨用例。
      controller.abort()
      await settleIter(iter)
      await drainBridgeCalls()
    }
  })

  it('abort 后事件总线再投递帧 → 被丢弃（陈旧流不得写进当前翻译）', async () => {
    // 取消后原生仍可能送出在途帧（OkHttp 取消未必立刻收尾）；JS 侧必须不再写入。
    const emitter = installFakeLynx()
    ;(globalThis as { NativeModules?: unknown }).NativeModules = {
      PictelioTranslate: withBridgeDelay(
        {
          translateStream: () => new Promise<{ abort: () => Promise<void> }>(() => {}),
          translatePoll: (_id: string, cb: (v: string | null, e: string | null) => void) =>
            cb(JSON.stringify({ type: 'pending' }), ''),
          abortStream: (_id: string, cb: (err: string | null) => void) => cb(null),
        },
        bridgeDelayMs,
      ),
    }
    const provider = nativeTranslateProvider()
    const controller = new AbortController()
    const iter = provider.translate(
      { novelId: 1, chapterId: 'c1', paragraphs: ['原文'], options: { xRestrict: 0 } },
      { baseURL: 'https://x', apiKey: '', model: 'm' },
      controller.signal,
    )
    try {
      // 等条件：本流已订阅上全局事件总线（订阅随 translateStream 送达而来）
      await vi.waitFor(() => expect(emitter.count('pictelioTranslateFrame')).toBe(1), WAIT_FOR_OPTS)
      controller.abort()
      await expect(iter.next()).rejects.toThrow('aborted')

      // 在途帧抵达（OkHttp 取消未必立刻收尾 → Java 侧仍可能 emit）
      emitter.emit(
        'pictelioTranslateFrame',
        JSON.stringify({ type: 'delta_all', paragraphs: [{ index: 0, text: '陈旧' }] }),
      )

      // 监听器已解绑（abort 必须解绑，否则下次翻译会收到这条流的帧 → 污染）：
      // 解绑是**同步**事实（onAbort → detachOnce），故直接断言，不等任何时间
      expect(emitter.count('pictelioTranslateFrame')).toBe(0)
      // 迭代器不应再产出任何 chunk（finished/aborted 已生效）
      await expect(iter.next()).rejects.toThrow('aborted')
    } finally {
      controller.abort()
      await settleIter(iter)
      await drainBridgeCalls()
      expect(emitter.count('pictelioTranslateFrame')).toBe(0)
    }
  })

  it('abortStream 失败（cb(errMsg)） → console.warn 兜底，不得 unhandled rejection', async () => {
    // Oracle: AGENTS.md 测试硬约束 #3「禁静默降级」+ 修复前 sync 句柄路径无失败兜底，
    // 会以 unhandled rejection 冒泡（修复前 abort 不可达所以从不暴露）。
    const emitter = installFakeLynx()
    ;(globalThis as { NativeModules?: unknown }).NativeModules = {
      PictelioTranslate: withBridgeDelay(
        {
          translateStream: () => new Promise<{ abort: () => Promise<void> }>(() => {}),
          translatePoll: (_id: string, cb: (v: string | null, e: string | null) => void) =>
            cb(JSON.stringify({ type: 'pending' }), ''),
          // 模拟 Java 侧 abortStream 失败（如 native bridge 故障 / native 模块未注册）
          abortStream: (_id: string, cb: (err: string | null) => void) => cb('native bridge 故障'),
        },
        bridgeDelayMs,
      ),
    }
    const provider = nativeTranslateProvider()
    const controller = new AbortController()
    const iter = provider.translate(
      { novelId: 1, chapterId: 'c1', paragraphs: ['原文'], options: { xRestrict: 0 } },
      { baseURL: 'https://x', apiKey: '', model: 'm' },
      controller.signal,
    )
    try {
      await vi.waitFor(() => expect(emitter.count('pictelioTranslateFrame')).toBe(1), WAIT_FOR_OPTS)

      // abort 不应抛同步异常（catch 已包住 abortStream）
      expect(() => controller.abort()).not.toThrow()

      // 等条件：异步 abortStream rejection 被 catch 吃掉后 console.warn 才发
      // （恶意档下该回调晚 250ms → 固定墙钟等待在此确定性失败）
      await vi.waitFor(
        () =>
          expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('abort 触发失败'),
            expect.anything(),
          ),
        WAIT_FOR_OPTS,
      )

      // 监听器仍须解绑（abort 失败不能阻塞 detach 路径）
      expect(emitter.count('pictelioTranslateFrame')).toBe(0)
    } finally {
      controller.abort()
      await settleIter(iter)
      await drainBridgeCalls()
    }
  })

  it('无 DOMException（Lynx PrimJS 真实环境）→ onAbort 不抛，abortStream 仍触达', async () => {
    // 真机回归防线：Lynx PrimJS 实测 `DOMException is not defined`，原 onAbort 在
    // `new DOMException("aborted", "AbortError")` 这一行直接抛 → 后面的
    // `abortHandle?.abort()` 永远不执行 → 整个 #653 修复在设备上形同未做。
    // 本用例钉住 polyfill 路径：临时删 globalThis.DOMException，模拟 PrimJS。
    const emitter = installFakeLynx()
    let abortStreamCalledWith: string | null = null
    const originalDE = (globalThis as { DOMException?: unknown }).DOMException
    // @ts-expect-error 模拟 Lynx PrimJS：无 DOMException 全局
    delete (globalThis as { DOMException?: unknown }).DOMException
    // #993：收尾必须**先于**恢复 DOMException 收干净——只恢复全局量而不 abort /
    // 不摘监听器 / 不拉干在飞回调，才是本用例此前真正的跨用例泄漏面。
    let controller: AbortController | null = null
    let iter: { next: () => Promise<unknown> } | null = null
    try {
      ;(globalThis as { NativeModules?: unknown }).NativeModules = {
        PictelioTranslate: withBridgeDelay(
          {
            translateStream: () => new Promise<{ abort: () => Promise<void> }>(() => {}),
            translatePoll: (_id: string, cb: (v: string | null, e: string | null) => void) =>
              cb(JSON.stringify({ type: 'pending' }), ''),
            abortStream: (id: string, cb: (err: string | null) => void) => {
              abortStreamCalledWith = id
              cb(null)
            },
          },
          bridgeDelayMs,
        ),
      }
      const provider = nativeTranslateProvider()
      controller = new AbortController()
      iter = provider.translate(
        { novelId: 1, chapterId: 'c1', paragraphs: ['原文'], options: { xRestrict: 0 } },
        { baseURL: 'https://x', apiKey: '', model: 'm' },
        controller.signal,
      )
      // 等条件：本流已订阅上全局事件总线
      await vi.waitFor(() => expect(emitter.count('pictelioTranslateFrame')).toBe(1), WAIT_FOR_OPTS)

      // 必须不抛
      expect(() => controller!.abort()).not.toThrow()

      // 关键断言：即便 DOMException 缺失，abortStream 仍被调用（=核心修复未回退）
      await vi.waitFor(() => expect(abortStreamCalledWith).not.toBeNull(), WAIT_FOR_OPTS)
      // 监听器已解绑（此前 finally 只恢复 DOMException，监听器留在全局 emitter 上）
      expect(emitter.count('pictelioTranslateFrame')).toBe(0)
      // 迭代器抛 AbortError（用 err.name 判，不依赖 instanceof DOMException）
      try {
        await iter!.next()
        expect.fail('iter.next() 应当抛 AbortError')
      } catch (e) {
        expect(e).toBeInstanceOf(Error)
        expect((e as Error).name).toBe('AbortError')
      }
    } finally {
      controller?.abort()
      if (iter) await settleIter(iter)
      await drainBridgeCalls()
      expect(emitter.count('pictelioTranslateFrame')).toBe(0)
      // 恢复 globalThis，避免污染后续用例
      ;(globalThis as { DOMException?: unknown }).DOMException = originalDE
    }
  })
})

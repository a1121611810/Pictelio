// ─── 小说翻译 store：取消窗口（provider 启动前）—— 规格期望值回归防线（issue #760 / ADR-0226）───
//
// 票面来源：docs/research/flaky-novel-translate-store-diagnosis.md §5（路径分析 → 确定性复现）
// 取证与实施记录：docs/research/translate-store-cancel-window-2026-10.md
// ADR：docs/adr/ADR-0226-translate-store-cancel-window.md
//
// 被测语义：`translateChapter` 从「provider 启动前最后一个 await」到「创建 AbortController 并
// `++gen`」之间必须有一道**取消闸门**（ADR-0226 的「取消纪元」）。取消（reset()/abort()）
// 落在该窗口内时必须：
//   ① 不外发 provider 请求（正文零外发、不扣费）；
//   ② 不 `++gen`（不反转 generation ⇒ 更新章节的落地不被丢弃）；
//   ③ 结果不落地（渲染源不得含被取消章节的译文）。
//
// 期望值出处（oracle 溯源：规格条文，不来自本实现自洽反推）：
// - spec §7.2 转移表末行「任何 | chapter switch | idle | abort() if in-flight; reset state」
//   → 章节切换后 in-flight 请求必须被 abort（不得再外发），状态必须留在 idle。
// - spec §7.2「generation-gate 守门」：任何 chunk 进入 store 先比对 chapterId == currentChapterId，
//   不匹配则丢弃（防跨章节污染）。
// - spec §9.5 / §5：章节切换必须 abort 在飞请求（`abort() if in-flight`）。
//
// 📌 取证史（可追溯性）：这 4 个用例 2026-10-23 曾以「**缺陷现状断言**」形态存在过——
// 当时它们断言的是缺陷行为（取消后仍外发请求、gen 被反转），在未修实现上**红过**；
// 修法落地后翻成规格期望值 ⇒ 本文件即「改前必红 → 改后必绿」的证据。
// 缺陷态的实测输出与对照说明见 docs/research/translate-store-cancel-window-2026-10.md。
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { TranslationChunk, TranslationProvider } from '../../../src/api/translate'

// ─── mocks（hoisted 到模块顶部，vi.mock 工厂可引用） ───

const mocks = vi.hoisted(() => ({
  idbGet: vi.fn(),
  idbSet: vi.fn(),
  idbRemove: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheRemove: vi.fn(),
  cacheClear: vi.fn(),
  cacheAvailable: vi.fn(),
  providerTranslate: vi.fn(),
  settingsTranslationRestricted: vi.fn(),
  settingsLanguage: vi.fn(),
}))

vi.mock('../../../src/utils/idbKV', () => ({
  // endpoint 元数据 KV（真机走原生 prefs，web 预览走 IndexedDB —— 同一个 await 位置）
  idbGet: mocks.idbGet,
  idbSet: mocks.idbSet,
  idbRemove: mocks.idbRemove,
  openDb: () => Promise.reject(new Error('本用例不触碰 openDb')),
  STORE_TRANSLATIONS: 'translations',
}))

vi.mock('../../../src/utils/translationCache', () => ({
  isTranslationCacheAvailable: mocks.cacheAvailable,
  removeTranslation: mocks.cacheRemove,
  getTranslation: mocks.cacheGet,
  setTranslation: mocks.cacheSet,
  clearTranslationCache: mocks.cacheClear,
  makeCacheKey: (input: { novelId: number; chapterId: string; paragraphs: string[] }) => ({
    key: `k:${input.novelId}:${input.chapterId}`,
    sourceHash: `src:${input.paragraphs.length}`,
    baseURLHash: 'b:0',
  }),
  computeSourceHash: (paragraphs: string[]) => `src:${paragraphs.length}`,
  computeBaseURLHash: () => 'b:0',
}))

vi.mock('../../../src/api/nativeTranslate', () => ({
  getEndpoint: vi.fn(),
  setApiKey: vi.fn(),
  clearEndpoint: vi.fn(),
  probeEndpoint: vi.fn(),
  // web-core 路径（无 NativeModules）不该走到 native provider；真被走到即测试失败
  nativeTranslateProvider: () => {
    throw new Error('web-core 路径不应构造 native provider')
  },
}))

vi.mock('../../../src/api/translate', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../src/api/translate')>()
  return {
    ...orig,
    // 注入 fake provider：记录每一次真实 provider 调用（= 一次正文外发）
    openaiResponsesProvider: () =>
      ({
        id: 'fake-provider',
        translate: (request: unknown, cfg: unknown, signal?: AbortSignal) =>
          mocks.providerTranslate(request, cfg, signal),
        abort: vi.fn(),
      }) as unknown as TranslationProvider,
  }
})

vi.mock('../../../src/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    isTranslationRestricted: mocks.settingsTranslationRestricted,
    language: mocks.settingsLanguage(),
  }),
}))

import {
  resetNovelTranslateStoreForTest,
  useNovelTranslateStore,
} from '../../../src/stores/novelTranslateStore'

// ─── 测试小工具 ───

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

/** 可手动放行的 promise（用来把取消精确投进窗口） */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/**
 * 同步队列 + 等待者：**确定性**等待「下一条事件」，不依赖墙钟等待。
 *
 * <p>与「固定 sleep(Nms) 后读状态」的根本区别：这里等的是被观测事实本身
 * （provider 被调用了 / 迭代器被消费了），结论只取决于行为是否发生。
 */
function createChannel<T>(): {
  push: (value: T) => void
  shift: () => Promise<T>
  size: () => number
  clear: () => void
} {
  const items: T[] = []
  const waiters: Array<(value: T) => void> = []
  return {
    push: (value) => {
      // ⚠️ 有等待者时**不再入队**（否则同一条事件会被投递两次：一次给等待者、
      // 一次留在队列里 → 下一个用例读到上一条残留，结论被污染）。
      const waiter = waiters.shift()
      if (waiter) {
        waiter(value)
        return
      }
      items.push(value)
    },
    shift: () => {
      const head = items.shift()
      if (head !== undefined) return Promise.resolve(head)
      return new Promise<T>((resolve) => {
        waiters.push(resolve)
      })
    },
    size: () => items.length,
    clear: () => {
      items.length = 0
      waiters.length = 0
    },
  }
}

interface DeferredIterator {
  iter: AsyncIterator<TranslationChunk>
  push: (chunk: TranslationChunk) => void
  finish: () => void
}

/**
 * 挂起的 provider 迭代器（与真实 provider 同契约）：
 * - signal 触发 abort → `next()` 抛 AbortError（store 据此收敛 aborted）；
 * - 未 abort 时由测试显式 push 帧 / finish 收尾。
 */
function makeDeferredIterator(signal?: AbortSignal): DeferredIterator {
  const queue: TranslationChunk[] = []
  let waiter: (() => void) | null = null
  let done = false
  const onAbort = (): void => {
    done = true
    waiter?.()
    waiter = null
  }
  if (signal?.aborted === true) onAbort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  const iter: AsyncIterator<TranslationChunk> = {
    async next(): Promise<IteratorResult<TranslationChunk>> {
      if (signal?.aborted === true) throw new DOMException('aborted', 'AbortError')
      while (queue.length === 0 && !done) {
        await new Promise<void>((resolve) => {
          waiter = resolve
        })
        if (signal?.aborted === true) throw new DOMException('aborted', 'AbortError')
      }
      const value = queue.shift()
      if (value !== undefined) return { value, done: false }
      return { value: undefined as unknown as TranslationChunk, done: true }
    },
  }
  ;(iter as unknown as { [Symbol.asyncIterator]: () => AsyncIterator<TranslationChunk> })[
    Symbol.asyncIterator
  ] = () => iter
  return {
    iter,
    push: (chunk) => {
      queue.push(chunk)
      waiter?.()
      waiter = null
    },
    finish: () => {
      done = true
      waiter?.()
      waiter = null
    },
  }
}

interface ProviderCall {
  chapterId: string
  /** 真正外发的正文（证明「请求发出去的不只是元信息」） */
  paragraphs: string[]
  signal: AbortSignal
  iter: DeferredIterator
}

/** 章节原文（单段 ⇒ chunked pipeline 只切一块，语义最简） */
const CH1_PARAS = ['第一章原文']
const CH2_PARAS = ['第二章原文']

/**
 * metadata 读取的闸门队列（**窗口内的第一个 await**，也是真机上唯一的那个）。
 *
 * <p>`readEndpointMetadata()` 用 `Promise.all` 并发读 4 个键（baseURL / model /
 * targetLang / sourceLang）⇒ 每次 metadata 读取 = **4 次 idbGet**。故按「每 4 次
 * idbGet = 一次 metadata 读取」分组，第 N 组取第 N 个闸门。
 */
const META_READ_IDB_CALLS = 4
let metaGates: Array<Deferred<string | null>> = []
let idbGetCallCount = 0

/**
 * provider 调用台账（每一次真实外发都记一笔）+ 通知通道（用于「等下一次调用」）。
 *
 * <p>台账与通道分开：断言数「一共外发了几次」用台账（不消费），
 * 等「下一次调用发生」用通道（消费）。
 */
const providerCalls: ProviderCall[] = []
const providerCallChannel = createChannel<ProviderCall>()

/**
 * 是否让 provider 流**自动收尾**（默认关）。
 *
 * <p>开它是为了让「缺陷态」的失败**快且准**：缺陷实现仍会外发请求，若流悬着不收尾，
 * 用例会以 15s 超时收场（看不出是哪条断言坏了）。自动收尾 ⇒ 缺陷态直接落在断言上。
 */
let autoCompleteProvider = false

beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
  resetNovelTranslateStoreForTest()
  // 默认：web-core 路径（无 NativeModules）
  delete (globalThis as Record<string, unknown>).NativeModules
  mocks.settingsTranslationRestricted.mockReturnValue(false)
  mocks.settingsLanguage.mockReturnValue('zh-CN')
  // 缓存恒 miss（默认行为）—— 本用例要观测的是「缓存 miss 后仍会外发 provider」
  mocks.cacheGet.mockResolvedValue(null)
  mocks.cacheAvailable.mockReturnValue(true)
  mocks.cacheSet.mockResolvedValue(undefined)
  mocks.cacheRemove.mockResolvedValue(undefined)
  mocks.cacheClear.mockResolvedValue(undefined)
  // metadata 读取闸门：默认无闸门 = 立即返回（null ⇒ 端点元数据缺失 ⇒ 缓存键取默认值）
  metaGates = []
  idbGetCallCount = 0
  providerCalls.length = 0
  providerCallChannel.clear()
  autoCompleteProvider = false
  mocks.idbGet.mockImplementation(() => {
    const gate = metaGates[Math.floor(idbGetCallCount / META_READ_IDB_CALLS)]
    idbGetCallCount += 1
    return gate ? gate.promise : Promise.resolve(null)
  })
  mocks.idbSet.mockResolvedValue(undefined)
  mocks.idbRemove.mockResolvedValue(undefined)
  // provider 桩：记录每一次真实调用（= 一次正文外发），迭代器由测试驱动
  mocks.providerTranslate.mockImplementation(
    (
      request: { chapterId: string; paragraphs: string[] },
      _cfg: unknown,
      signal?: AbortSignal,
    ) => {
      const iter = makeDeferredIterator(signal)
      const call: ProviderCall = {
        chapterId: request.chapterId,
        paragraphs: request.paragraphs,
        signal: signal as AbortSignal,
        iter,
      }
      providerCalls.push(call)
      providerCallChannel.push(call)
      if (autoCompleteProvider) {
        iter.push({
          type: 'delta',
          paragraphIndex: 0,
          text: `自动收尾的译文-${request.chapterId}`,
        })
        iter.finish()
      }
      return iter.iter
    },
  )
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).NativeModules
  vi.restoreAllMocks()
})

// ─────────────────── 取消窗口：规格期望值（ADR-0226） ───────────────────

describe('取消窗口（ADR-0226）：provider 启动前被取消的 invocation 不得外发请求', () => {
  it('对照：取消落在窗口**之外**（provider 已启动）→ 请求被 abort，结果不落地', async () => {
    // 对照组：同一个取消动作，**位置不同**结局不同 ⇒ 证明「窗口位置」是唯一变量，
    // 且闸门没有误伤「provider 已启动」这条正常取消路径。
    const store = useNovelTranslateStore()
    const gate = deferred<string | null>()
    metaGates = [gate]

    const settled = store.translateChapter(1, 1, CH1_PARAS).then(
      () => 'fulfilled',
      () => 'rejected',
    )

    gate.resolve(null)
    // provider 已启动（此时 controller 已存在 → 取消能命中它）
    const call = await providerCallChannel.shift()
    expect(call.chapterId).toBe('1')
    expect(store.status).toBe('translating')

    store.abort()
    expect(call.signal.aborted).toBe(true)

    await settled

    // 窗口外取消：请求被真 abort，结果**不**落地（spec §7.2「aborted 静默切回原文」）
    expect(store.status).toBe('aborted')
    expect(store.displayParagraphs).toEqual(CH1_PARAS) // 渲染源 = 原文，没有译文落地
    expect(store.displayParagraphs).not.toContain('第一章译文')
  })

  it('章节切换（reset）落在窗口内 → 不外发 provider 请求，结果不落地', async () => {
    const store = useNovelTranslateStore()
    const gate = deferred<string | null>()
    metaGates = [gate]
    // 缺陷态下 provider 仍会被调用 ⇒ 让流自动收尾，失败落在断言上而不是 15s 超时
    autoCompleteProvider = true

    const settled = store.translateChapter(1, 1, CH1_PARAS).then(
      () => 'fulfilled',
      () => 'rejected',
    )

    // ── 前置断言：invocation 确实停在「provider 启动前」的 await 上 ──
    // metadata 读取的 4 次 idbGet 已同步发出且**尚未返回** ⇒ invocation 挂在
    // novelTranslateStore.ts:704（provider 启动前最后一个 await 之一）。
    expect(mocks.idbGet).toHaveBeenCalledTimes(4)
    expect(store.status).toBe('pending')
    expect(providerCallChannel.size()).toBe(0)

    // ── 取消：章节切换（spec §7.2 转移表末行「任何 | chapter switch | idle」）──
    store.reset()
    expect(store.status).toBe('idle')

    // ── 放行窗口内的 await ──
    gate.resolve(null)
    await settled

    // ★ 规格期望：取消后**不得**外发 provider 请求（正文零外发、不扣费）
    expect(providerCalls).toHaveLength(0)
    expect(mocks.providerTranslate).not.toHaveBeenCalled()
    expect(providerCallChannel.size()).toBe(0)
    // ★ 状态留在取消方给的状态（idle），且没有旧章节的译文落进渲染源
    expect(store.status).toBe('idle')
    expect(store.currentChapter).toBeNull()
    expect(store.displayParagraphs).toEqual([])
  })

  it('译文按钮停止（abort）落在窗口内 → 不外发 provider 请求，「停止」生效', async () => {
    const store = useNovelTranslateStore()
    const gate = deferred<string | null>()
    metaGates = [gate]
    autoCompleteProvider = true

    const settled = store.translateChapter(1, 1, CH1_PARAS).then(
      () => 'fulfilled',
      () => 'rejected',
    )

    // 窗口内（status='pending'）时 TranslateButton 的 buttonState='translating'
    // （isTranslatingThis 含 pending）⇒ 用户点「停止」会走到 store.abort()
    expect(store.status).toBe('pending')

    store.abort()
    expect(store.status).toBe('aborted')

    gate.resolve(null)
    await settled

    // ★ 规格期望：用户的「停止」必须真的停住（不外发请求、不落地译文）
    expect(providerCalls).toHaveLength(0)
    expect(mocks.providerTranslate).not.toHaveBeenCalled()
    expect(providerCallChannel.size()).toBe(0)
    expect(store.status).toBe('aborted')
    expect(store.displayParagraphs).toEqual([])
  })

  it('缓存不可用（真机形态：唯一的 await 是 metadata 读取）→ 取消仍不得外发请求', async () => {
    // 真机形态（native runtime 无 IndexedDB ⇒ 缓存层停用）：窗口内**只有** metadata
    // 读取这一个 await ⇒ 拦不住它的闸门必须单独成立（否则真机上取消仍会外发请求）。
    const store = useNovelTranslateStore()
    const gate = deferred<string | null>()
    metaGates = [gate]
    autoCompleteProvider = true
    mocks.cacheAvailable.mockReturnValue(false)

    const settled = store.translateChapter(1, 1, CH1_PARAS).then(
      () => 'fulfilled',
      () => 'rejected',
    )
    expect(mocks.idbGet).toHaveBeenCalledTimes(4)
    expect(store.status).toBe('pending')

    store.reset()
    expect(store.status).toBe('idle')

    gate.resolve(null)
    await settled

    // ★ 规格期望：缓存层停用时，metadata 读取之后的闸门仍要拦住取消
    expect(providerCalls).toHaveLength(0)
    expect(mocks.providerTranslate).not.toHaveBeenCalled()
    expect(store.status).toBe('idle')
    expect(store.displayParagraphs).toEqual([])
  })

  it('取消落在缓存读取（窗口内第二个 await）→ 不得外发 provider 请求', async () => {
    // 窗口内的第二个 await（真机原生 FS 读 / web IndexedDB 读）。
    // 前一个用例把取消投在 metadata 读取上；本例把取消投在**缓存读取**上 ⇒
    // 「缓存读之后的闸门」被单独钉住（否则它可能长期是无人证伪的摆设）。
    const store = useNovelTranslateStore()
    const gate = deferred<string | null>()
    metaGates = [gate]
    autoCompleteProvider = true
    // 缓存读可控延迟 + 「已被调用」的确定性信号
    const cacheGate = deferred<null>()
    const cacheCalled = deferred<void>()
    mocks.cacheGet.mockImplementation(() => {
      cacheCalled.resolve()
      return cacheGate.promise
    })

    const settled = store.translateChapter(1, 1, CH1_PARAS).then(
      () => 'fulfilled',
      () => 'rejected',
    )

    gate.resolve(null) // metadata 读取放行 → 落到缓存读取
    await cacheCalled.promise // 已停在缓存读取上
    expect(store.status).toBe('pending')

    // 取消落在缓存读取期间
    store.reset()
    expect(store.status).toBe('idle')

    cacheGate.resolve(null) // 放行缓存读取
    await settled

    // ★ 规格期望：取消后不得外发 provider 请求
    expect(providerCalls).toHaveLength(0)
    expect(mocks.providerTranslate).not.toHaveBeenCalled()
    expect(store.status).toBe('idle')
    expect(store.displayParagraphs).toEqual([])
  })

  it('重译（retranslate）在缓存失效期间被取消 → 不得发起 provider 请求', async () => {
    // retranslate 在「缓存失效」阶段也有 await（removeTranslation）⇒ 同一个窗口问题。
    // 它必须在调 translateChapter **之前**再核对一次取消纪元，否则等于「取消后重新发起」。
    const store = useNovelTranslateStore()
    const gate = deferred<string | null>()
    metaGates = [gate]
    autoCompleteProvider = true
    // 缓存失效可控延迟 + 「已被调用」的确定性信号
    const removeGate = deferred<void>()
    const removeCalled = deferred<void>()
    mocks.cacheRemove.mockImplementation(() => {
      removeCalled.resolve()
      return removeGate.promise
    })

    const settled = store.retranslate(1, 1, CH1_PARAS).then(
      () => 'fulfilled',
      () => 'rejected',
    )

    // retranslate 的第一个 await = metadata 读取
    expect(mocks.idbGet).toHaveBeenCalledTimes(4)
    gate.resolve(null)
    await removeCalled.promise // 已进入「缓存失效」这一步

    // 取消（章节切换）落在缓存失效期间
    store.reset()
    expect(store.status).toBe('idle')

    removeGate.resolve() // 放行缓存失效
    await settled

    // ★ 规格期望：取消后不得重新发起翻译（不外发 provider 请求）
    expect(providerCalls).toHaveLength(0)
    expect(mocks.providerTranslate).not.toHaveBeenCalled()
    expect(store.status).toBe('idle')
  })

  it('窗口内取消 + 新章节先恢复 → 旧 invocation 静默退出，新章节落地不被丢弃', async () => {
    const store = useNovelTranslateStore()
    const gateOld = deferred<string | null>()
    const gateNew = deferred<string | null>()
    metaGates = [gateOld, gateNew]
    autoCompleteProvider = true

    // 旧章节（ch1）发起翻译 → 挂在窗口内
    const pOld = store.translateChapter(1, 1, CH1_PARAS).then(
      () => 'fulfilled',
      () => 'rejected',
    )
    expect(mocks.idbGet).toHaveBeenCalledTimes(4)

    // 章节切换：取消旧章节
    store.reset()

    // 新章节（ch2）发起翻译 → 也挂在窗口内
    const pNew = store.translateChapter(1, 2, CH2_PARAS).then(
      () => 'fulfilled',
      () => 'rejected',
    )
    expect(mocks.idbGet).toHaveBeenCalledTimes(8)

    // ── 新章节先恢复：发出 provider 请求 ──
    gateNew.resolve(null)
    const callNew = await providerCallChannel.shift()
    expect(callNew.chapterId).toBe('2')

    // ── 旧章节后恢复：取消闸门命中 ⇒ 静默退出（不建 controller / 不 ++gen / 不发请求）──
    gateOld.resolve(null)
    await pOld

    // ★ 只有新章节那一次请求（旧章节被取消的不再外发）
    expect(providerCalls).toHaveLength(1)
    expect(providerCalls[0].chapterId).toBe('2')
    // ★ 旧 invocation 不得反过来 abort 新章节的请求
    expect(callNew.signal.aborted).toBe(false)

    await pNew

    // ★ 规格期望：新章节的落地**不被丢弃**；渲染源与 currentChapter 一致（不跨章节污染）
    expect(store.currentChapter).toBe(2)
    expect(store.displayParagraphs).toEqual(['自动收尾的译文-2'])
  })
})

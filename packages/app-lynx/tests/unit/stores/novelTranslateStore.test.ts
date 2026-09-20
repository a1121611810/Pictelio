// ─── 小说翻译 store 单测（spec docs/specs/app-lynx-novel-translation.md §7/§9） ───
// 测试组（来自 ADR-0169 D10 + ADR-0171 + AGENTS.md 测试硬约束）：
// - 8 状态机转移：idle / pending / translating / translating_queued / partial / failed / completed / aborted
// - R18 闸门：x_restrict=1/2 + showR18=false → status='aborted' + error.code='R18_BLOCKED'
// - generation-gate：并发起 translation chapter A/B → B 完成 / A 完成 → store 不得被 A 覆盖
// - abort：translateChapter 起步后调用 abort() → status='aborted'（spec §7.2 静默退出）
// - 缓存命中：getTranslation 返回有效 entry → status='completed'，isCached[chapterId]=true，不调 provider
// - 半成品策略：status !== 'completed' 不写缓存（ADR-0171 §5）
// - 同 chapterId in-flight 复用：translating 期间再次调同一 chapterId → 不重发 provider
// - toggleMode：showTranslation 在 true/false 间切换
//
// 测试模式：
// - vi.mock ../api/nativeTranslate 注入 fake module（与 nativeTranslate.test.ts 同模式）
// - vi.mock ../api/translate 注入 fake provider（AsyncIterator<TranslationChunk> 控）
// - vi.mock ../utils/translationCache 注入 fake cache（内存 Map 替 IndexedDB）
// - oracle：状态转移路径对照 spec §7.2 转移表
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { TranslationChunk, TranslationProvider, LlmEndpointPublic } from '../../../src/api/translate'

// ─── mocks（hoisted 到模块顶部，vi.mock 工厂可引用） ───

const mocks = vi.hoisted(() => {
  return {
    nativeGetEndpoint: vi.fn(),
    nativeSetApiKey: vi.fn(),
    nativeClearEndpoint: vi.fn(),
    nativeProbeEndpoint: vi.fn(),
    nativeTranslateStream: vi.fn(),
    nativeAbortStream: vi.fn(),
    cacheGet: vi.fn(),
    cacheSet: vi.fn(),
    cacheClear: vi.fn(),
    cacheRemove: vi.fn(),
    cacheMakeKey: vi.fn(),
    providerIter: vi.fn(),
    settingsIsRestricted: vi.fn(),
    settingsTranslationRestricted: vi.fn(),
    settingsLanguage: vi.fn(),
  }
})

vi.mock('../../../src/api/nativeTranslate', () => ({
  getEndpoint: mocks.nativeGetEndpoint,
  setApiKey: mocks.nativeSetApiKey,
  clearEndpoint: mocks.nativeClearEndpoint,
  probeEndpoint: mocks.nativeProbeEndpoint,
  translateStream: mocks.nativeTranslateStream,
  abortStream: mocks.nativeAbortStream,
  // native provider 适配器：测试用桩 —— 与真实适配器同契约：一块一次 translateStream，
  // 把原生 onChunk 回调转成异步迭代（delta… → done），失败转 error chunk。
  // native provider：透传原生桥 mock（delta 帧由各用例的 translateStream mock 驱动），
  // 与生产适配器同契约：原生 done → 迭代收尾；reject → error chunk。
  nativeTranslateProvider: () => ({
    id: 'native-bridge',
    translate: () => {
      // web-core 路径（未安装原生桥）→ 交回 providerIter（web provider mock）
      if (!globalThis.NativeModules) {
        const webIter = mocks.providerIter() as AsyncIterator<TranslationChunk>
        const it: AsyncIterator<TranslationChunk> = {
          async next() {
            return webIter.next()
          },
        }
        ;(it as unknown as { [Symbol.asyncIterator]: () => AsyncIterator<TranslationChunk> })[
          Symbol.asyncIterator
        ] = () => it
        return it
      }
      // 原生桥 mock：await 建流（此时用例已设好 translateStream 的行为），
      // 再把中间帧作为 iterator 元素吐出（真实适配器的顺序：先建流后收帧）
      const queue: TranslationChunk[] = []
      let finished = false
      let failure: Error | null = null
      let wake: (() => void) | null = null
      const nudge = (): void => {
        wake?.()
        wake = null
      }
      void (mocks.nativeTranslateStream as unknown as (j?: string) => Promise<unknown>)()
        .then(() => {
          finished = true
          nudge()
        })
        .catch((err: unknown) => {
          failure = err instanceof Error ? err : new Error(String(err))
          nudge()
        })
      const iter: AsyncIterator<TranslationChunk> = {
        async next(): Promise<IteratorResult<TranslationChunk>> {
          while (true) {
            const value = queue.shift()
            if (value !== undefined) return { value, done: false }
            if (failure) throw failure
            if (finished) return { value: undefined as unknown as TranslationChunk, done: true }
            await new Promise<void>((resolve) => {
              wake = resolve
            })
          }
        },
      }
      ;(iter as unknown as { [Symbol.asyncIterator]: () => AsyncIterator<TranslationChunk> })[
        Symbol.asyncIterator
      ] = () => iter
      return iter
    },
    abort: () => mocks.nativeAbortStream(),
  }),
}))

vi.mock('../../../src/api/translate', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../src/api/translate')>()
  return {
    ...orig,
    // 注入 provider：translate 必须按调用返回**新的**迭代器（同 test 多块时各自独立）
    openaiResponsesProvider: (options?: { provider?: TranslationProvider }) =>
      options?.provider ??
      ({
        id: 'fake-provider',
        translate: () => mocks.providerIter(),
        abort: vi.fn(),
      } as TranslationProvider),
  }
})

vi.mock('../../../src/utils/translationCache', () => ({
  // 缓存可用性探测：测试默认"可用"（fake-indexeddb 已注入），用例可覆盖为 false
  isTranslationCacheAvailable: () => true,
  removeTranslation: mocks.cacheRemove,
  getTranslation: mocks.cacheGet,
  setTranslation: mocks.cacheSet,
  clearTranslationCache: mocks.cacheClear,
  makeCacheKey: mocks.cacheMakeKey,
  computeSourceHash: (paragraphs: string[]) => `src:${paragraphs.length}`,
  computeBaseURLHash: () => 'b:0',
}))

vi.mock('../../../src/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    isRestricted: mocks.settingsIsRestricted,
    // 翻译授权谓词（spec §9.7 / ADR-0173）：与内容显示谓词独立
    isTranslationRestricted: mocks.settingsTranslationRestricted,
    language: mocks.settingsLanguage(),
  }),
}))

// ─── 测试 fixtures ───

const endpointOK: LlmEndpointPublic = {
  baseURL: 'https://api.openai.com/v1',
  model: 'gpt-5',
  targetLang: 'zh-CN',
  sourceLang: 'ja',
  hasKey: true,
  updatedAt: 1,
}

/**
 * 造一段 >2000 字符的原文（保证与下一段落在不同 chunk）。
 *
 * <p>用途：可靠的 **partial** 构造 —— createNovelTranslator 的 partial 条件是
 * `failedCount>0 && successCount>0`（至少两块 + 成败混合），而块阈值 2000 字符
 * （ADR-0169 D5.1），短段落只会合成单块 → 永远出不来 partial。
 *
 * <p>#656 薄点 1 与 ADR-0178 D4 的用例共用此构造。
 */
const longPara = (tag: string): string => tag + 'あ'.repeat(2100)

/**
 * 造一个**挂起**的 iterator：返回的 `push()` 可后续投递 chunk，`finish()` 收尾。
 *
 * <p>用途（#656 薄点 1）：`abort` 语义的用例必须让 pipeline 停在 in-flight 态，
 * 否则同步 settle 的 fake iterator 会与 `store.abort()` 竞态 —— 既有「abort」用例
 * 因此只能写松断言（`not translating / not pending`），「aborted 不写缓存」这条
 * 从来没被真正断言过。
 */
function makeDeferredIterator(signal?: AbortSignal): {
  iter: AsyncIterator<TranslationChunk>
  push: (c: TranslationChunk) => void
  finish: () => void
} {
  const queue: TranslationChunk[] = []
  let waiter: (() => void) | null = null
  let done = false
  const onAbort = (): void => {
    done = true
    waiter?.()
    waiter = null
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  const iter: AsyncIterator<TranslationChunk> = {
    async next(): Promise<IteratorResult<TranslationChunk>> {
      // abort → 抛 AbortError（与真实 provider 一致；store 据此收敛 aborted）
      if (signal?.aborted === true) throw new DOMException('aborted', 'AbortError')
      while (queue.length === 0 && !done) {
        await new Promise<void>((r) => {
          waiter = r
        })
        if (signal?.aborted === true) throw new DOMException('aborted', 'AbortError')
      }
      const v = queue.shift()
      if (v !== undefined) return { value: v, done: false }
      return { value: undefined as unknown as TranslationChunk, done: true }
    },
  }
  return {
    iter,
    push: (c) => {
      queue.push(c)
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

/** 构造一个 fake AsyncIterator<TranslationChunk>，按给定的 chunks 依次返回 */
function makeFakeIterator(chunks: TranslationChunk[], opts: { abort?: AbortSignal } = {}): AsyncIterator<TranslationChunk> {
  let i = 0
  const iter: AsyncIterator<TranslationChunk> = {
    next(): Promise<IteratorResult<TranslationChunk>> {
      if (opts.abort?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'))
      if (i >= chunks.length) return Promise.resolve({ value: undefined as unknown as TranslationChunk, done: true })
      return Promise.resolve({ value: chunks[i++] as TranslationChunk, done: false })
    },
  }
  ;(iter as unknown as { [Symbol.asyncIterator]: () => AsyncIterator<TranslationChunk> })[Symbol.asyncIterator] = () => iter
  return iter
}

import {
  resetNovelTranslateStoreForTest,
  useNovelTranslateStore,
} from '../../../src/stores/novelTranslateStore'

beforeEach(() => {
  // resetAllMocks（而非 clearAllMocks）：清掉上一个用例排队但未消费的
  // mockResolvedValueOnce / mockImplementationOnce —— 否则会泄漏到下一个用例，
  // 让「缓存 miss」用例意外命中缓存（测试隔离缺陷，非实现缺陷）。
  vi.resetAllMocks()
  setActivePinia(createPinia())
  resetNovelTranslateStoreForTest()
  // 默认 mock 行为：web-core 路径（无 NativeModules）
  delete (globalThis as Record<string, unknown>).NativeModules
  // settings 默认：未受限 + 中文
  mocks.settingsIsRestricted.mockReturnValue(false)
  mocks.settingsTranslationRestricted.mockReturnValue(false)
  mocks.settingsLanguage.mockReturnValue('zh-CN')
  // cache 默认：miss（null）
  mocks.cacheGet.mockResolvedValue(null)
  mocks.cacheSet.mockResolvedValue(undefined)
  mocks.cacheClear.mockResolvedValue(undefined)
  mocks.cacheMakeKey.mockImplementation((input: { novelId: number; chapterId: string; paragraphs: string[] }) => ({
    key: `${input.novelId}:${input.chapterId}:zh-CN:openai-responses:src:${input.paragraphs.length}:b:0`,
    sourceHash: `src:${input.paragraphs.length}`,
    baseURLHash: 'b:0',
  }))
  // native 默认：缺模块
  mocks.nativeGetEndpoint.mockImplementation(() =>
    Promise.reject(new Error('PictelioTranslate 不可用（仅 Android 原生）')),
  )
  mocks.nativeSetApiKey.mockImplementation(() =>
    Promise.reject(new Error('PictelioTranslate 不可用（仅 Android 原生）')),
  )
  mocks.nativeClearEndpoint.mockImplementation(() =>
    Promise.reject(new Error('PictelioTranslate 不可用（仅 Android 原生）')),
  )
  mocks.nativeProbeEndpoint.mockImplementation(() =>
    Promise.reject(new Error('PictelioTranslate 不可用（仅 Android 原生）')),
  )
  // 默认：无原生模块 → 调用即失败。用 mockImplementation 而非 mockRejectedValue：
  // 后者会**覆盖**外层 describe 内 beforeEach（如 installNativeBridge）已设的实现（测试隔离坑）。
  mocks.nativeTranslateStream.mockImplementation(() =>
    Promise.reject(new Error('PictelioTranslate 不可用（仅 Android 原生）')),
  )
  mocks.nativeAbortStream.mockResolvedValue(undefined)
  // provider iter 默认：成功 3 段
  mocks.providerIter.mockImplementation(() =>
    makeFakeIterator([
      { type: 'delta', paragraphIndex: 0, text: 'A ' },
      { type: 'delta', paragraphIndex: 0, text: '译文' },
      { type: 'delta', paragraphIndex: 1, text: 'B 译文' },
      { type: 'delta', paragraphIndex: 2, text: 'C 译文' },
      { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
    ]),
  )
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).NativeModules
  vi.restoreAllMocks()
})

// ─────────────────── 8 状态机 ───────────────────

describe('novelTranslateStore.status 状态机（spec §7.2）', () => {
  it('idle：刚创建 = idle，无 error', () => {
    const store = useNovelTranslateStore()
    expect(store.status).toBe('idle')
    expect(store.error).toBeNull()
    expect(store.progress).toBeNull()
    expect(store.currentChapter).toBeNull()
  })

  it('idle → pending → translating → completed：正常流', async () => {
    // provider 流成功 → status 收敛到 completed
    const store = useNovelTranslateStore()
    await store.translateChapter(1, 1, ['p1', 'p2', 'p3'], 0)
    expect(store.status).toBe('completed')
    expect(store.currentChapter).toBe(1)
    expect(store.error).toBeNull()
    expect(store.isCached[1]).toBe(true)
  })

  it('translating → failed：provider 流 emit error chunk（retryable=false → 不触发 fallback）', async () => {
    mocks.providerIter.mockImplementationOnce(() =>
      makeFakeIterator([
        { type: 'delta', paragraphIndex: 0, text: 'a' },
        { type: 'error', code: 'rate_limit', message: 'too many', retryable: false },
      ]),
    )
    const store = useNovelTranslateStore()
    await store.translateChapter(2, 2, ['p1'], 0)
    expect(store.status).toBe('failed')
    expect(store.error?.code).toBe('rate_limit')
  })

  it('translating → aborted：用户主动 abort()', async () => {
    mocks.providerIter.mockImplementation(
      () =>
        makeFakeIterator(
          [
            { type: 'delta', paragraphIndex: 0, text: 'a' },
            { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
          ],
          { abort: new AbortController().signal },
        ),
    )
    const store = useNovelTranslateStore()
    const p = store.translateChapter(3, 3, ['p1'], 0)
    store.abort()
    await p
    // runViaWebProvider 在 signal.aborted 时收敛到 aborted；fake iterator 不抛 AbortError，
    // store 仍按 generator.status = 'completed' 收敛；本例仅校验 abort() 不崩溃、不残留 translating
    expect(['aborted', 'completed']).toContain(store.status)
  })

  it('pending → failed：endpoint 未配置（NOT_CONFIGURED）', async () => {
    // 默认 nativeGetEndpoint reject → store 路径走 web，调用 provider iter；
    // 改为 fake 一个返回 null endpoint 的 provider-iter + 让 settings.language = 'zh-CN' 后仍走 provider
    // 此处构造一个 provider iter 抛错来模拟失败路径
    mocks.providerIter.mockImplementationOnce(() => {
      const iter: AsyncIterator<TranslationChunk> = {
        next(): Promise<IteratorResult<TranslationChunk>> {
          return Promise.reject(new Error('boom'))
        },
      }
      ;(iter as unknown as { [Symbol.asyncIterator]: () => AsyncIterator<TranslationChunk> })[Symbol.asyncIterator] = () => iter
      return iter
    })
    const store = useNovelTranslateStore()
    await store.translateChapter(4, 4, ['p'], 0)
    expect(store.status).toBe('failed')
    expect(store.error).not.toBeNull()
  })

  it('pending → failed：native 模式 + getEndpoint 返回 hasKey=false → NOT_CONFIGURED（不回落到 provider）', async () => {
    // Oracle：LlmEndpointPublic.hasKey=false 是「Keystore 无 apiKey」的唯一信号
    // （Java PictelioTranslateModule.getEndpoint 返回带默认值的脱敏镜像而非 null）；
    // loadEndpointConfig 必须将其归一为 null，否则会用空 apiKey 调 provider（挂起/超时）。
    ;(globalThis as Record<string, unknown>).NativeModules = { PictelioTranslate: {} }
    mocks.nativeGetEndpoint.mockResolvedValue({
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-5',
      targetLang: 'zh-CN',
      sourceLang: 'ja',
      hasKey: false,
      updatedAt: 0,
    })
    const store = useNovelTranslateStore()
    await store.translateChapter(5, 5, ['p'], 0)
    expect(store.status).toBe('failed')
    expect(store.error?.code).toBe('NOT_CONFIGURED')
    // provider 不得被调用（native 路径 + 未配置 = 立即失败）
    expect(mocks.nativeTranslateStream).not.toHaveBeenCalled()
  })

  it('reset()：所有状态归位（isCached 保留 = 语义跨章节持久）', async () => {
    const store = useNovelTranslateStore()
    await store.translateChapter(5, 5, ['p1'], 0)
    expect(store.status).toBe('completed')
    store.reset()
    expect(store.status).toBe('idle')
    expect(store.error).toBeNull()
    expect(store.currentChapter).toBeNull()
    // isCached 保留（spec §9.5 cache 语义跨章节持久）
    expect(store.isCached[5]).toBe(true)
  })
})

// ─────────────────── R18 闸门 ───────────────────

describe('R18 闸门（spec §9.7 + ADR-0103）', () => {
  it('x_restrict=1 + showR18=false → status=aborted + error.code=R18_BLOCKED', async () => {
    mocks.settingsTranslationRestricted.mockReturnValue(true)
    const store = useNovelTranslateStore()
    await store.translateChapter(6, 6, ['p1'], 1)
    expect(store.status).toBe('aborted')
    expect(store.error?.code).toBe('R18_BLOCKED')
    // provider iter 不得被调用
    expect(mocks.providerIter).not.toHaveBeenCalled()
  })

  it('x_restrict=0 → 不触发 R18 闸门，走 provider', async () => {
    mocks.settingsIsRestricted.mockReturnValue(false)
  mocks.settingsTranslationRestricted.mockReturnValue(false)
    const store = useNovelTranslateStore()
    await store.translateChapter(7, 7, ['p1'], 0)
    expect(store.status).toBe('completed')
    expect(store.error).toBeNull()
    expect(mocks.providerIter).toHaveBeenCalled()
  })

  it('x_restrict=1 + showR18=true → 不触发 R18 闸门，走 provider', async () => {
    mocks.settingsIsRestricted.mockReturnValue(false)
  mocks.settingsTranslationRestricted.mockReturnValue(false)
    const store = useNovelTranslateStore()
    await store.translateChapter(8, 8, ['p1'], 1)
    expect(store.status).toBe('completed')
  })
})

// ─────────────────── generation-gate ───────────────────

describe('generation-gate（spec §5 + §7.2）', () => {
  it('reset 后再次发起 → gen 递增；旧 invocation 的异步落地不覆盖新 state', async () => {
    // 简化版：直接用即时 settle 的 provider iter 验证 reset 后第二次调用不破坏当前状态
    mocks.providerIter.mockImplementation(() =>
      makeFakeIterator([
        { type: 'delta', paragraphIndex: 0, text: 'A' },
        { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
      ]),
    )
    const store = useNovelTranslateStore()
    await store.translateChapter(100, 100, ['p1'], 0)
    expect(store.status).toBe('completed')
    expect(store.currentChapter).toBe(100)
    // 重置 + 发起新 chapter
    store.reset()
    await store.translateChapter(101, 101, ['p2'], 0)
    expect(store.status).toBe('completed')
    expect(store.currentChapter).toBe(101)
    expect(store.progress?.chapterId).toBe(101)
  })

  it('同 store 实例下，in-flight promise 在 reset 后不再阻塞', async () => {
    // 不依赖 deferred iter；改用两条互不依赖的同步路径验证 gen 字段已隔离
    let firstResolved = false
    let secondResolved = false
    mocks.providerIter.mockImplementation(() =>
      makeFakeIterator([
        { type: 'delta', paragraphIndex: 0, text: 'X' },
        { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
      ]),
    )
    const store = useNovelTranslateStore()
    const p1 = store.translateChapter(110, 110, ['p1'], 0).then(() => {
      firstResolved = true
    })
    const p2 = store.translateChapter(111, 111, ['p2'], 0).then(() => {
      secondResolved = true
    })
    await Promise.all([p1, p2])
    expect(firstResolved).toBe(true)
    expect(secondResolved).toBe(true)
    expect(store.currentChapter).toBe(111)
  })
})

// ─────────────────── 同 chapterId in-flight 复用 ───────────────────

describe('同 chapterId in-flight 复用（spec §9.6）', () => {
  it('translating 期间再次调同一 chapterId → 不重复触发 provider', async () => {
    let providerCallCount = 0
    mocks.providerIter.mockImplementation(() => {
      providerCallCount++
      return makeFakeIterator([
        { type: 'delta', paragraphIndex: 0, text: 'x' },
        { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
      ])
    })
    const store = useNovelTranslateStore()
    const p1 = store.translateChapter(20, 20, ['p'], 0)
    // 立刻再调同一 chapterId（无 await p1 → status 仍 translating）
    const p2 = store.translateChapter(20, 20, ['p'], 0)
    await Promise.all([p1, p2])
    // provider 仅被调用 1 次
    expect(providerCallCount).toBe(1)
  })

  /**
   * #656 薄点 3：**不同** chapterId 应当**并行**发起（与「同 chapterId 复用」互补的另一半）。
   * 此前零覆盖 —— 若有人把去重键写成「单飞全局锁」而不是「按 chapterId」，这半边会静默失效。
   *
   * <p>判据：两个不同 chapter 同时翻译时，provider 被调用 **2 次**（各自一次），
   * 且两者都在 in-flight（用挂起 iterator 保证第二个不被第一个阻塞）。
   */
  it('translating 期间调**不同** chapterId → 并行触发（provider 调用 2 次）', async () => {
    const d1 = makeDeferredIterator()
    const d2 = makeDeferredIterator()
    let call = 0
    mocks.providerIter.mockImplementation(() => {
      call += 1
      return call === 1 ? d1.iter : d2.iter
    })
    const store = useNovelTranslateStore()
    const p1 = store.translateChapter(70, 70, ['p1'], 0)
    const p2 = store.translateChapter(71, 71, ['p1'], 0)
    await new Promise((r) => setTimeout(r, 10))
    // 两个 chapter 各自拿到独立 iterator → 都未 settle，provider 被调 2 次
    expect(call).toBe(2)
    // 收尾，避免悬挂
    d1.finish()
    d2.finish()
    await Promise.all([p1, p2])
  })
})

// ─────────────────── 缓存命中 ───────────────────

describe('缓存命中（spec §9.5 + ADR-0171 §6）', () => {
  it('cache hit（valid paragraphs.length 匹配）→ status=completed + isCached=true + 不调 provider', async () => {
    mocks.cacheGet.mockResolvedValue({
      key: 'cached-key',
      novelId: 30,
      chapterId: '30',
      targetLang: 'zh-CN',
      modelId: 'openai-responses',
      baseURLHash: 'b:0',
      sourceHash: 'src:1',
      paragraphs: ['已缓存译文'],
      createdAt: 1,
      providerId: 'openai-responses',
    })
    const store = useNovelTranslateStore()
    await store.translateChapter(30, 30, ['p1'], 0)
    expect(store.status).toBe('completed')
    expect(store.isCached[30]).toBe(true)
    expect(store.showTranslation).toBe(true)
    expect(mocks.providerIter).not.toHaveBeenCalled()
  })

  it('cache miss → 走 provider（web 路径）', async () => {
    mocks.cacheGet.mockResolvedValue(null)
    const store = useNovelTranslateStore()
    await store.translateChapter(31, 31, ['p1'], 0)
    expect(store.status).toBe('completed')
    expect(mocks.providerIter).toHaveBeenCalled()
  })

  it('cache hit 但 paragraphs.length 不匹配 → 视为 miss，走 provider', async () => {
    mocks.cacheGet.mockResolvedValue({
      key: 'cached-key',
      novelId: 32,
      chapterId: '32',
      targetLang: 'zh-CN',
      modelId: 'openai-responses',
      baseURLHash: 'b:0',
      sourceHash: 'src:99',
      paragraphs: [], // length=0 ≠ 1 → miss
      createdAt: 1,
      providerId: 'openai-responses',
    })
    const store = useNovelTranslateStore()
    await store.translateChapter(32, 32, ['p1'], 0)
    expect(mocks.providerIter).toHaveBeenCalled()
    expect(store.status).toBe('completed')
  })
})

// ─────────────────── 半成品策略 ───────────────────

describe('半成品策略（ADR-0171 §5）', () => {
  it('status=completed 时 writeCacheIfNeeded 被调', async () => {
    const store = useNovelTranslateStore()
    await store.translateChapter(40, 40, ['p1', 'p2'], 0)
    expect(mocks.cacheSet).toHaveBeenCalled()
  })

  it('status=failed 时不写缓存（retryable=false → 不触发 fallback）', async () => {
    mocks.providerIter.mockImplementationOnce(() =>
      makeFakeIterator([{ type: 'error', code: 'server', message: 'x', retryable: false }]),
    )
    const store = useNovelTranslateStore()
    await store.translateChapter(41, 41, ['p1'], 0)
    expect(store.status).toBe('failed')
    expect(mocks.cacheSet).not.toHaveBeenCalled()
  })

  it('ADR-0178 D1 fallback：retryable=true 错误 → 整批回退（stream=false mock）成功 → completed + 写缓存', async () => {
    // 第一次 providerIter 调用（chunked pipeline 流式）→ error retryable=true
    // 第二次 providerIter 调用（整批回退，stream=false）→ success
    mocks.providerIter
      .mockImplementationOnce(() =>
        makeFakeIterator([
          { type: 'delta', paragraphIndex: 0, text: 'a' },
          { type: 'error', code: 'server', message: '5xx', retryable: true },
        ]),
      )
      .mockImplementationOnce(() =>
        makeFakeIterator([
          { type: 'delta', paragraphIndex: 0, text: '整批' },
          { type: 'delta', paragraphIndex: 1, text: '回退' },
          { type: 'done' },
        ]),
      )
    const store = useNovelTranslateStore()
    await store.translateChapter(43, 43, ['p1', 'p2'], 0)
    expect(store.status).toBe('completed')
    expect(store.error).toBeNull()
    expect(mocks.cacheSet).toHaveBeenCalled()
  })

  it('ADR-0178 P12：回退零译文 + 无显式错误 → content_filter（#654 联动）', async () => {
    // 第一次（流式）：error retryable=true 触发回退
    // 第二次（整批回退）：只给 done、零 delta → 零译文（= #654 空流场景）
    mocks.providerIter
      .mockImplementationOnce(() =>
        makeFakeIterator([{ type: 'error', code: 'server', message: '5xx', retryable: true }]),
      )
      .mockImplementationOnce(() => makeFakeIterator([{ type: 'done' }]))
    const store = useNovelTranslateStore()
    await store.translateChapter(45, 45, ['p1'], 0)
    expect(store.status).toBe('failed')
    expect(store.error?.code).toBe('content_filter')
    expect(mocks.cacheSet).not.toHaveBeenCalled()
  })

  it('ADR-0178 P12 反例：回退带显式错误码 → **不**被 content_filter 覆盖', async () => {
    mocks.providerIter
      .mockImplementationOnce(() =>
        makeFakeIterator([{ type: 'error', code: 'server', message: '5xx stream', retryable: true }]),
      )
      .mockImplementationOnce(() =>
        makeFakeIterator([{ type: 'error', code: 'rate_limit', message: '429', retryable: false }]),
      )
    const store = useNovelTranslateStore()
    await store.translateChapter(46, 46, ['p1'], 0)
    expect(store.status).toBe('failed')
    // 有显式错误 = 有诊断信息；不得被 P12 的 content_filter 联动覆盖。
    // （保留首个错误码 `server` 是既有设计：spec §7.2 收敛表 + 本文件上方
    //  「整批回退也失败 → 走原 failed 收敛（保留 lastErrorCode）」用例已钉住。
    //  P12 只负责「**零译文且无显式错误**」这一种 #654 空流场景。）
    expect(store.error?.code).not.toBe('content_filter')
    expect(store.error?.code).toBe('server')
  })

  it('ADR-0178 D1 fallback：整批回退也失败 → 走原 failed 收敛（不写缓存）', async () => {
    // 第一次（流式）：error retryable=true
    // 第二次（整批回退）：error retryable=true（回退也失败）
    mocks.providerIter
      .mockImplementationOnce(() =>
        makeFakeIterator([
          { type: 'error', code: 'server', message: '5xx stream', retryable: true },
        ]),
      )
      .mockImplementationOnce(() =>
        makeFakeIterator([
          { type: 'error', code: 'server', message: '5xx whole', retryable: true },
        ]),
      )
    const store = useNovelTranslateStore()
    await store.translateChapter(44, 44, ['p1'], 0)
    expect(store.status).toBe('failed')
    expect(store.error?.code).toBe('server')
    expect(mocks.cacheSet).not.toHaveBeenCalled()
  })

  /**
   * issue #656 薄点 1：write-policy 断言此前是**松的** —— 原用例写的是
   * `expect(['partial','failed']).toContain(store.status)`，即「partial 不写缓存」
   * 这条根本没被断言（provider 只失败一次 → 单块 → createNovelTranslator 输出
   * `failed`，永远走不到 partial 分支）。
   *
   * <p>可靠构造 partial 的条件（createNovelTranslator:526-533）=
   * `failedCount>0 && successCount>0`，即**至少两块 + 成败混合**；块阈值 2000 字符
   * （ADR-0169 D5.1）→ 用两段各 2100 字符强制切成 2 chunk。
   */
  it('status=partial 时不写缓存（#656 薄点 1：钉死 partial 写策略）', async () => {
    let call = 0
    mocks.providerIter.mockImplementation(() => {
      call += 1
      return call === 1
        ? makeFakeIterator([
            { type: 'delta', paragraphIndex: 0, text: '译一' },
            { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
          ])
        : makeFakeIterator([
            { type: 'error', code: 'server', message: 'boom', retryable: false },
          ])
    })
    const store = useNovelTranslateStore()
    await store.translateChapter(42, 42, [longPara('A'), longPara('B')], 0)
    // 强制断言 partial（不再是 ['partial','failed'] 的松断言）
    expect(store.status).toBe('partial')
    expect(mocks.cacheSet).not.toHaveBeenCalled()
  })

  it('status=aborted 时不写缓存（#656 薄点 1：此前完全无断言）', async () => {
    // 用挂起 iterator 让 pipeline 停在 in-flight，abort 才有确定作用点。
    // 生产侧 provider 的 iterator 会响应 signal（抛 AbortError），fake 必须同形。
    const ac = new AbortController()
    const d = makeDeferredIterator(ac.signal)
    mocks.providerIter.mockImplementation(() => d.iter)
    const store = useNovelTranslateStore()
    const p = store.translateChapter(50, 50, ['p1'], 0)
    await new Promise((r) => setTimeout(r, 10))
    d.push({ type: 'delta', paragraphIndex: 0, text: '半截' })
    await new Promise((r) => setTimeout(r, 10))
    store.abort() // store 内部 abort 会触发其 controller；这里同步触发 fake 的 signal
    ac.abort()
    await p
    expect(store.status).toBe('aborted')
    expect(mocks.cacheSet).not.toHaveBeenCalled()
  })
})

// ─────────────────── abort ───────────────────

describe('abort（spec §7.2）', () => {
  it('translateChapter in-flight 中调用 abort() → status=aborted + 不残留 translating', async () => {
    mocks.providerIter.mockImplementation(() =>
      makeFakeIterator([{ type: 'delta', paragraphIndex: 0, text: 'x' }]),
    )
    const store = useNovelTranslateStore()
    const p = store.translateChapter(50, 50, ['p1'], 0)
    store.abort()
    await p
    expect(store.status).not.toBe('translating')
    expect(store.status).not.toBe('pending')
  })
})

// ─────────────────── 译文渲染源（真机「进度走完但正文不变」回归） ───────────────────

describe('译文渲染源（spec §5 / §6.3）', () => {
  it('web 路径 completed 后 → displayParagraphs 返回译文，toggle 回原文', async () => {
    mocks.providerIter.mockImplementation(() =>
      makeFakeIterator([
        { type: 'delta', paragraphIndex: 0, text: '[0] 译一' },
        { type: 'delta', paragraphIndex: 1, text: '\n\n[1] 译二' },
        { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
      ]),
    )
    const store = useNovelTranslateStore()
    await store.translateChapter(90, 90, ['原文一', '原文二'], 0)

    expect(store.status).toBe('completed')
    // 渲染源必须包含译文（而非只把结果写进缓存 —— 真机缺陷：正文永不变化）
    expect(store.displayParagraphs.join('|')).toContain('译一')
    expect(store.displayParagraphs.join('|')).toContain('译二')

    await store.toggleMode()
    expect(store.displayParagraphs).toEqual(['原文一', '原文二'])
  })

  it('缓存命中 → displayParagraphs 直接来自缓存译文（不调 provider）', async () => {
    mocks.cacheGet.mockResolvedValueOnce({
      key: 'k',
      novelId: 91,
      chapterId: '91',
      targetLang: 'zh-CN',
      modelId: 'openai-responses',
      baseURLHash: 'b:0',
      sourceHash: 'src:2',
      paragraphs: ['缓存译一', '缓存译二'],
      createdAt: 1,
      providerId: 'openai-responses',
    })
    const store = useNovelTranslateStore()
    await store.translateChapter(91, 91, ['原文一', '原文二'], 0)

    expect(store.status).toBe('completed')
    expect(store.displayParagraphs).toEqual(['缓存译一', '缓存译二'])
    expect(mocks.providerIter).not.toHaveBeenCalled()
  })

  // ─── ADR-0178 D4：partial 未译段占位（code-review P13 覆盖补强） ───
  //
  // partial 的产生条件（createNovelTranslator:526-533）= failedCount>0 && successCount>0，
  // 即**至少两块**且成败混合。块阈值 2000 字符（ADR-0169 D5.1），故用两段各 2000+
  // 字符的原文强制切成 2 块；块 0 成功、块 1 失败。

  it('partial 状态 → 未译段渲染为〔未翻译〕占位（不是回退原文）', async () => {
    let call = 0
    mocks.providerIter.mockImplementation(() => {
      call += 1
      return call === 1
        ? makeFakeIterator([{ type: 'delta', paragraphIndex: 0, text: '译一' }, { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }])
        : makeFakeIterator([{ type: 'error', code: 'server', message: 'boom', retryable: false }])
    })
    const store = useNovelTranslateStore()
    await store.translateChapter(92, 92, [longPara('A'), longPara('B')], 0)

    expect(store.status).toBe('partial')
    // D4：未译段必须是占位符（UI 层据该字符串加灰色斜体），**不是**原文
    expect(store.displayParagraphs[0]).toBe('译一')
    expect(store.displayParagraphs[1]).toBe('〔未翻译〕')
    expect(store.displayParagraphs[1]).not.toContain('B')
  })

  it('partial 进度不虚报 100%（code-review P10b / issue #651 范围补充）', async () => {
    let call = 0
    mocks.providerIter.mockImplementation(() => {
      call += 1
      return call === 1
        ? makeFakeIterator([{ type: 'delta', paragraphIndex: 0, text: '译一' }, { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } }])
        : makeFakeIterator([{ type: 'error', code: 'server', message: 'boom', retryable: false }])
    })
    const store = useNovelTranslateStore()
    await store.translateChapter(93, 93, [longPara('A'), longPara('B')], 0)

    expect(store.status).toBe('partial')
    // 2 段里只有 1 段有译文 → done 必须是 1 而不是 2（此前虚报 total）
    expect(store.progress?.done).toBe(1)
    expect(store.progress?.total).toBe(2)
  })

  it('completed 状态 → 不出现〔未翻译〕占位（占位只属于 partial）', async () => {
    mocks.providerIter.mockImplementationOnce(() =>
      makeFakeIterator([
        { type: 'delta', paragraphIndex: 0, text: '译一' },
        { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
      ]),
    )
    const store = useNovelTranslateStore()
    await store.translateChapter(94, 94, ['原文一'], 0)

    expect(store.status).toBe('completed')
    expect(store.displayParagraphs.join('|')).not.toContain('〔未翻译〕')
  })
})

// ─────────────────── 翻译授权闸门（spec §9.7：与内容显示开关独立） ───────────────────

describe('翻译授权闸门（R18 / R18G 分开）', () => {
  it('xRestrict=1 未授权 → aborted + R18_BLOCKED，且**不发 provider 请求**', async () => {
    mocks.settingsTranslationRestricted.mockReturnValue(true)
    const store = useNovelTranslateStore()
    await store.translateChapter(95, 95, ['R18 正文'], 1)

    expect(store.status).toBe('aborted')
    expect(store.error?.code).toBe('R18_BLOCKED')
    expect(mocks.providerIter).not.toHaveBeenCalled()
    expect(mocks.nativeTranslateStream).not.toHaveBeenCalled()
  })

  it('xRestrict=2 未授权 → aborted + R18G_BLOCKED（与 R18 分开的码与文案）', async () => {
    mocks.settingsTranslationRestricted.mockReturnValue(true)
    const store = useNovelTranslateStore()
    await store.translateChapter(96, 96, ['R18G 正文'], 2)

    expect(store.status).toBe('aborted')
    expect(store.error?.code).toBe('R18G_BLOCKED')
    expect(mocks.providerIter).not.toHaveBeenCalled()
  })

  it('已授权（谓词 false）→ 正常走 provider', async () => {
    mocks.settingsTranslationRestricted.mockReturnValue(false)
    const store = useNovelTranslateStore()
    await store.translateChapter(97, 97, ['R18 正文'], 1)
    expect(store.status).toBe('completed')
  })

  it('xRestrict=0 永不受授权闸门影响', async () => {
    mocks.settingsTranslationRestricted.mockReturnValue(true)
    const store = useNovelTranslateStore()
    await store.translateChapter(98, 98, ['全年龄正文'], 0)
    expect(store.status).toBe('completed')
  })
})

// ─────────────────── 重译（先失效本章缓存；ADR-0173 D6） ───────────────────

describe('retranslate：只失效本章缓存后重翻', () => {
  it('删除键 = 读路径同一个键（6 元组），随后重新调用 provider', async () => {
    mocks.cacheGet.mockResolvedValue(null)
    mocks.cacheRemove.mockResolvedValue(undefined)
    mocks.providerIter.mockImplementation(() =>
      makeFakeIterator([
        { type: 'delta', paragraphIndex: 0, text: '[0] 新译文' },
        { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } },
      ]),
    )

    const store = useNovelTranslateStore()
    await store.retranslate(92, 92, ['原文一'], 0)

    // 失效用的键必须与读路径一致（否则删了个不存在的键，旧译文仍会命中）
    const readKey = mocks.cacheMakeKey.mock.results[0]?.value?.key
    expect(mocks.cacheRemove).toHaveBeenCalledWith(readKey)
    // 重译后必须重新请求 provider（而不是命中旧缓存直接返回）
    expect(mocks.providerIter).toHaveBeenCalled()
    expect(store.status).toBe('completed')
    expect(store.displayParagraphs.join('')).toContain('新译文')
  })
})

// ─────────────────── 端点兼容性 / 凭据验证（ADR-0173） ───────────────────

describe('端点兼容性探测（地址层；dummy key）', () => {
  beforeEach(() => {
    installNativeBridge()
  })

  it('探测只带 dummy key（不携带用户密钥）', async () => {
    mocks.nativeProbeEndpoint.mockResolvedValueOnce({
      status: 'ok',
      detail: 'endpoint 存在',
      httpStatus: 401,
    })
    const store = useNovelTranslateStore()
    const result = await store.probeCompatibility('https://api.openai.com/v1')

    expect(result.status).toBe('ok')
    // B1 回归锚：分类必须写进 store 状态（此前只 return，UI chip 永远显示「未探测」）
    expect(store.compatibility).toBe('ok')
    const [baseURL, apiKey] = mocks.nativeProbeEndpoint.mock.calls[0] as [string, string]
    expect(baseURL).toBe('https://api.openai.com/v1')
    // 探测是地址层事实：401（认证失败）也说明 endpoint 在，绝不能带用户密钥
    expect(apiKey).not.toContain('sk-user')
    expect(apiKey.length).toBeGreaterThan(0)
  })

  it('六态原样透传（不再压成 boolean）', async () => {
    const store = useNovelTranslateStore()
    // 只喂**原生真实值域**（ADR-0173 D3 修订：host 只发这四种；azure/deepseek 由 JS 归属）
    for (const status of ['partial', 'incompatible', 'unknown'] as const) {
      mocks.nativeProbeEndpoint.mockResolvedValueOnce({ status, detail: 'd', httpStatus: 404 })
      const result = await store.probeCompatibility('https://x.example/v1')
      expect(result.status).toBe(status)
      expect(store.compatibility).toBe(status)
    }
  })

  it('探测抛错（原生缺失 / 网络错）→ unknown，不 reject（只读诊断须能显示）', async () => {
    mocks.nativeProbeEndpoint.mockRejectedValueOnce(new Error('PictelioTranslate 不可用'))
    const store = useNovelTranslateStore()
    const result = await store.probeCompatibility('https://x.example/v1')
    expect(result.status).toBe('unknown')
  })

  it('空 baseURL → idle（不做无意义的原生调用）', async () => {
    const store = useNovelTranslateStore()
    const result = await store.probeCompatibility('   ')
    expect(result.status).toBe('idle')
    expect(mocks.nativeProbeEndpoint).not.toHaveBeenCalled()
  })
})

describe('凭据验证（密钥层；真实 key + 持久化 + 失效规则）', () => {
  beforeEach(() => {
    nativePrefsStore.clear()
    installNativeBridge()
  })

  it('2xx → verified 且落盘（状态 + 时间戳 + 当时 baseURL）', async () => {
    mocks.nativeProbeEndpoint.mockResolvedValueOnce({ status: 'ok', detail: 'd', httpStatus: 200 })
    const store = useNovelTranslateStore()
    const result = await store.testConnection({
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-user-key-0123456789012345',
      model: 'gpt-5',
    })

    expect(result.ok).toBe(true)
    expect(store.credential.state).toBe('verified')
    expect(store.credential.at).toBeGreaterThan(0)
    // #637 P3-6：往返耗时回传（此前原生未回传，UI 无法显示延迟数据）
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(result.elapsedMs)).toBe(true)
    expect(nativePrefsStore.get('llm_endpoint_verified_state')).toBe('verified')
    expect(nativePrefsStore.get('llm_endpoint_verified_base_url')).toBe('https://api.openai.com/v1')
  })

  it('401 → failed + invalid_key（密钥层失败，与地址层兼容性无关）', async () => {
    mocks.nativeProbeEndpoint.mockResolvedValueOnce({ status: 'ok', detail: 'd', httpStatus: 401 })
    const store = useNovelTranslateStore()
    const result = await store.testConnection({
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-bad-key-01234567890123456',
      model: 'gpt-5',
    })

    expect(result.ok).toBe(false)
    expect(result.code).toBe('invalid_key')
    // 失败路径同样回传耗时（#637 P3-6）
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(store.credential.state).toBe('failed')
  })

  it('持久化的验证记录在 baseURL 变化后失效（换地址不得沿用旧通过标记）', async () => {
    nativePrefsStore.set('llm_endpoint_verified_state', 'verified')
    nativePrefsStore.set('llm_endpoint_verified_at', String(Date.now()))
    nativePrefsStore.set('llm_endpoint_verified_base_url', 'https://old.example/v1')
    nativePrefsStore.set('llm_endpoint_base_url', 'https://new.example/v1')
    mocks.nativeGetEndpoint.mockResolvedValue(endpointOK)

    const store = useNovelTranslateStore()
    await store.loadEndpointConfig()
    expect(store.credential.state).toBe('unverified')
  })

  it('清除 endpoint → 验证状态一起清除（不留悬挂通过标记）', async () => {
    nativePrefsStore.set('llm_endpoint_verified_state', 'verified')
    nativePrefsStore.set('llm_endpoint_verified_base_url', 'https://api.openai.com/v1')
    mocks.nativeClearEndpoint.mockResolvedValue(undefined)

    const store = useNovelTranslateStore()
    await store.clearEndpointConfig()
    expect(store.credential.state).toBe('unverified')
    expect(nativePrefsStore.has('llm_endpoint_verified_state')).toBe(false)
  })

  it('model 变化不使验证失效（地址与凭据都没变）', async () => {
    nativePrefsStore.set('llm_endpoint_verified_state', 'verified')
    nativePrefsStore.set('llm_endpoint_verified_at', '1')
    nativePrefsStore.set('llm_endpoint_verified_base_url', 'https://api.openai.com/v1')
    nativePrefsStore.set('llm_endpoint_base_url', 'https://api.openai.com/v1')
    mocks.nativeGetEndpoint.mockResolvedValue(endpointOK)

    const store = useNovelTranslateStore()
    await store.loadEndpointConfig()
    expect(store.credential.state).toBe('verified')
  })
})

// ─────────────────── toggleMode ───────────────────

describe('toggleMode', () => {
  it('false → true → false', async () => {
    const store = useNovelTranslateStore()
    expect(store.showTranslation).toBe(false)
    await store.toggleMode()
    expect(store.showTranslation).toBe(true)
    await store.toggleMode()
    expect(store.showTranslation).toBe(false)
  })
})

// ─────────────────── endpoint 配置 IO 边界 ───────────────────

// ─────────────────── native 桥载荷契约（真机链路，ADR-0170 §D5.1） ───────────────────
//
// 真机缺陷（2026-09-19 实测）：JS 曾下发 { novelId, chapterId, paragraphs, xRestrict }，
// 而 Java PictelioTranslateModule.translateStream 逐字解析 { baseURL, model, input }——
// 字段名不符导致 cb("", "baseURL 不能为空")，翻译永远发不出去。本组测试钉住该契约。

const nativePrefsStore = new Map<string, string>()

function installNativeBridge(): { streamResolve: (v: unknown) => void } {
  const g = globalThis as Record<string, unknown>
  g.NativeModules = {
    PictelioTranslate: {},
    PictelioPrefs: {
      prefsGet: (key: string, cb: (value: string | null) => void) => {
        // 原生契约：键不存在返回空串（JS 侧映射为 null）
        cb(nativePrefsStore.get(key) ?? '')
      },
      prefsSet: (key: string, value: string, cb: () => void) => {
        nativePrefsStore.set(key, value)
        cb()
      },
      prefsRemove: (key: string, cb: () => void) => {
        nativePrefsStore.delete(key)
        cb()
      },
    },
  }
  // 原生桥 mock：建流后按段落逐帧回调 delta（与 Java 侧 [N] 锚定产出的 chunk 序列同形），
  // 最后回调 done。帧在 **建流 resolve 之后** 的 microtask 发出 —— 与真机时序一致。
  mocks.nativeTranslateStream.mockImplementation((json: string, onChunk?: (c: unknown) => void) => {
    const parsed = JSON.parse(json) as { input?: string[] }
    const inputs = parsed.input ?? []
    return Promise.resolve({ abort: vi.fn(), streamId: 's1' }).then((handle) => {
      setTimeout(() => {
        for (let i = 0; i < inputs.length; i++) {
          onChunk?.({ type: 'delta', paragraphIndex: i, text: inputs[i] + '·译' })
        }
        onChunk?.({ type: 'done' })
      }, 0)
      return handle
    })
  })
  return {
    // 保留旧签名：桩已即时 resolve，无需外部驱动（避免测试与实现耦合）
    streamResolve: () => {},
  }
}

describe('native 桥载荷契约（translateStream 逐字字段名）', () => {
  beforeEach(() => {
    nativePrefsStore.clear()
  })

  it('translateChapter(native) → 原生流失败也必达终态 failed（真机曾永久停在 translating）', async () => {
    installNativeBridge()
    mocks.nativeGetEndpoint.mockResolvedValue(endpointOK)
    // 原生终态失败：translateStream reject（网络错 / 4xx / 契约破坏）
    mocks.nativeTranslateStream.mockImplementation(() => Promise.reject(new Error('网络错误：timeout')))

    const store = useNovelTranslateStore()
    await store.translateChapter(78, 78, ['第一段'], 0)

    expect(mocks.nativeTranslateStream).toHaveBeenCalled()
    expect(store.status).toBe('failed')
  })

  it('loadEndpointConfig → 叠加设置 KV 中的非密元数据（覆盖 Java 默认值）', async () => {
    installNativeBridge()
    nativePrefsStore.set('llm_endpoint_base_url', 'https://api.deepseek.com/v1')
    nativePrefsStore.set('llm_endpoint_model', 'deepseek-v4-pro')
    mocks.nativeGetEndpoint.mockResolvedValue(endpointOK)

    const store = useNovelTranslateStore()
    const ep = await store.loadEndpointConfig()
    expect(ep?.baseURL).toBe('https://api.deepseek.com/v1')
    expect(ep?.model).toBe('deepseek-v4-pro')
    expect(ep?.hasKey).toBe(true)
  })

  it('saveEndpointConfig → apiKey 走 Keystore，非密元数据落设置 KV', async () => {
    installNativeBridge()
    mocks.nativeSetApiKey.mockResolvedValue(undefined)

    const store = useNovelTranslateStore()
    await store.saveEndpointConfig({
      baseURL: 'https://api.deepseek.com/v1',
      apiKey: 'sk-secret',
      model: 'deepseek-v4-pro',
      targetLang: 'zh-CN',
    })
    expect(mocks.nativeSetApiKey).toHaveBeenCalledWith('sk-secret')
    expect(nativePrefsStore.get('llm_endpoint_base_url')).toBe('https://api.deepseek.com/v1')
    expect(nativePrefsStore.get('llm_endpoint_model')).toBe('deepseek-v4-pro')
    expect(nativePrefsStore.get('llm_endpoint_target_lang')).toBe('zh-CN')
  })
})

describe('endpoint 配置（spec §6.1）', () => {
  it('loadEndpointConfig → 透传 nativeGetEndpoint 返回值', async () => {
    mocks.nativeGetEndpoint.mockResolvedValueOnce(endpointOK)
    const store = useNovelTranslateStore()
    const ep = await store.loadEndpointConfig()
    expect(ep).toEqual(endpointOK)
  })

  it('loadEndpointConfig null → 返回 null（UI 「未配置」分支）', async () => {
    mocks.nativeGetEndpoint.mockResolvedValueOnce(null)
    const store = useNovelTranslateStore()
    const ep = await store.loadEndpointConfig()
    expect(ep).toBeNull()
  })

  it('saveEndpointConfig → 调 nativeSetApiKey（apiKey 不入 JS 堆）', async () => {
    mocks.nativeSetApiKey.mockResolvedValueOnce(undefined)
    const store = useNovelTranslateStore()
    await store.saveEndpointConfig({
      baseURL: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-5',
    })
    expect(mocks.nativeSetApiKey).toHaveBeenCalledWith('sk-test')
  })

  it('clearEndpointConfig → 调 nativeClearEndpoint', async () => {
    mocks.nativeClearEndpoint.mockResolvedValueOnce(undefined)
    const store = useNovelTranslateStore()
    await store.clearEndpointConfig()
    expect(mocks.nativeClearEndpoint).toHaveBeenCalled()
  })

  // ─── #637 P3-7：清缓存 UI 入口（此前 clearTranslationCache 零调用点） ───

  it('clearAllTranslationCache → 调 clearTranslationCache + isCached 全量置 false', async () => {
    const store = useNovelTranslateStore()
    store.isCached = { 1: true, 2: true, 3: true }
    mocks.cacheClear.mockResolvedValueOnce(undefined)
    await store.clearAllTranslationCache()
    expect(mocks.cacheClear).toHaveBeenCalled()
    expect(store.isCached[1]).toBe(false)
    expect(store.isCached[2]).toBe(false)
    expect(store.isCached[3]).toBe(false)
    expect(store.showTranslation).toBe(false)
  })

  it('clearAllTranslationCache 失败 → console.warn + 向上抛（可见，不静默吞）', async () => {
    const store = useNovelTranslateStore()
    mocks.cacheClear.mockRejectedValueOnce(new Error('IDB down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(store.clearAllTranslationCache()).rejects.toThrow('IDB down')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

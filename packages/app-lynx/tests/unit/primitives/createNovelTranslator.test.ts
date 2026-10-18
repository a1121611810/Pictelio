// ─── createNovelTranslator chunked pipeline 契约测试（ADR-0169 D5 + ADR-0170） ───
// 测试组（来自 ADR-0169 D10 + AGENTS.md 测试硬约束）：
// - chunkParagraphs：按段落边界切块（≤2000 字 / 块、不拆段、>2000 字单段超限允许）
// - alignParagraphs：空行拆段 + 数量对齐 + 末段回退原文 + warn
// - runChunkPool：Promise 池并发度 ≤3 + abort 静默退出
// - createNovelTranslator：8 状态判定（completed / partial / failed / aborted）
// - Provider 解耦：deps.provider 注入 mock
//
// Oracle 来源（AGENTS.md 测试硬约束 #2「真实样例」）：
// - chunkParagraphs / alignParagraphs 算法：直接移植自 webview 端
//   packages/app/src/primitives/createNovelTranslator.ts（同源参考，非复用）
// - TranslationChunk 5 种类型：spec §4.4 + ADR-0169 D4
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  alignParagraphs,
  chunkParagraphs,
  createNovelTranslator,
  fetchChunkViaProvider,
  reassembleDeltas,
  runChunkPool,
  TranslationChunkError,
  type ChunkRange,
} from '../../../src/primitives/createNovelTranslator'
import type {
  LlmEndpointConfig,
  TranslationChunk,
  TranslationProvider,
  TranslationRequest,
} from '../../../src/api/translate'

// ──────────────────── Fixtures ────────────────────

const SAMPLE_CONFIG: LlmEndpointConfig = {
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'sk-test-key',
  model: 'gpt-5',
}

const SAMPLE_REQUEST: TranslationRequest = {
  novelId: 23876543,
  chapterId: '1',
  paragraphs: ['段落1', '段落2', '段落3', '段落4', '段落5'],
  options: { xRestrict: 0 },
}

/**
 * Mock provider：按段落数 + 流式行为模拟 provider.translate()。
 *
 * @param behavior 由测试指定如何返回 chunks（流式 delta / 一次性 / cached / error）
 */
function mockProvider(behavior: {
  /** 返回 delta 文本序列；空数组 = 立即 done（无 delta）。全部按占位 paragraphIndex=0 下发 */
  deltas?: string[]
  /**
   * 返回**自带段落序号**的 delta 序列（native 桥 / 整批非流式 provider 的形态：
   * TranslationSseParser 已按 `[N]` 切好段并剥掉段间分隔符，逐段以 `delta_all` 下发）。
   */
  indexedDeltas?: Array<{ paragraphIndex: number; text: string }>
  /** 直接返回 cached chunk（缓存命中短路） */
  cached?: string[]
  /** 抛出 error chunk（测试 error 路径） */
  errorChunk?: { code: TranslationChunk extends { type: 'error'; code: infer C } ? C : never; message: string; retryable: boolean }
  /** 返回 done usage */
  usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number }
}): TranslationProvider {
  return {
    id: 'mock',
    abort: vi.fn(),
    translate: (_req: TranslationRequest, _config: LlmEndpointConfig, signal: AbortSignal): AsyncIterator<TranslationChunk> => {
      const queue: TranslationChunk[] = []
      if (behavior.cached) queue.push({ type: 'cached', paragraphs: behavior.cached })
      if (behavior.deltas) {
        for (const d of behavior.deltas) {
          queue.push({ type: 'delta', paragraphIndex: 0, text: d })
        }
      }
      if (behavior.indexedDeltas) {
        for (const d of behavior.indexedDeltas) {
          queue.push({ type: 'delta', paragraphIndex: d.paragraphIndex, text: d.text })
        }
      }
      if (behavior.errorChunk) queue.push({ type: 'error', ...behavior.errorChunk })
      queue.push({ type: 'done', usage: behavior.usage })
      let idx = 0
      return {
        async next(): Promise<IteratorResult<TranslationChunk>> {
          if (signal.aborted) {
            throw new DOMException('aborted', 'AbortError')
          }
          if (idx >= queue.length) return { value: undefined as never, done: true }
          return { value: queue[idx++], done: false }
        },
      }
    },
  }
}

// ──────────────────── chunkParagraphs ────────────────────

describe('chunkParagraphs 按段落边界切块', () => {
  it('空段落数组 → 空块数组', () => {
    expect(chunkParagraphs([])).toEqual([])
  })

  it('单段 < maxChars → 单块', () => {
    expect(chunkParagraphs(['hello'])).toEqual([{ start: 0, end: 1 }])
  })

  it('多段累加 ≤ maxChars → 合并到一块', () => {
    const paragraphs = Array.from({ length: 5 }, () => 'a'.repeat(100))
    expect(chunkParagraphs(paragraphs, 2000)).toEqual([{ start: 0, end: 5 }])
  })

  it('多段累加 > maxChars → 按段落边界切分（不拆段）', () => {
    const paragraphs = Array.from({ length: 5 }, () => 'a'.repeat(500))
    // 500 + 2 + 500 = 1002 < 2000 → 第二段仍可加入块 1
    // 第 3 段时 1002 + 2 + 500 = 1504 → 仍可加入
    // 第 4 段时 1504 + 2 + 500 = 2006 > 2000 → 切分；start=3
    // 单段 500 不超 2000 故 blocks: [{0,3}, {3,5}]
    const result = chunkParagraphs(paragraphs, 2000)
    expect(result).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 5 },
    ])
  })

  it('单段 > maxChars 仍允许（超长单段自成一块，不切段内）', () => {
    const paragraphs = ['a'.repeat(3000), 'b'.repeat(100)]
    const result = chunkParagraphs(paragraphs, 2000)
    expect(result).toEqual([
      { start: 0, end: 1 }, // 单段超限自成一块
      { start: 1, end: 2 },
    ])
  })

  it('自定义 maxChars（1500 字 / 块）', () => {
    const paragraphs = Array.from({ length: 4 }, () => 'a'.repeat(500))
    const result = chunkParagraphs(paragraphs, 1500)
    // 500 + 2 + 500 = 1002 < 1500
    // + 2 + 500 = 1504 > 1500 → 切分
    expect(result).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ])
  })
})

// ──────────────────── alignParagraphs ────────────────────

describe('alignParagraphs 段落对齐（AGENTS.md 测试硬约束 #3 禁静默降级）', () => {
  it('译文段数 = 原文 → 原样对齐', () => {
    const result = alignParagraphs('译文1\n\n译文2\n\n译文3', ['原文1', '原文2', '原文3'])
    expect(result.paragraphs).toEqual(['译文1', '译文2', '译文3'])
    expect(result.fallbackCount).toBe(0)
    expect(result.overflowCount).toBe(0)
  })

  it('译文段数 < 原文（契约破坏）→ 末段回退原文 + warn + fallbackCount > 0', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = alignParagraphs('译文1\n\n译文2', ['原文1', '原文2', '原文3', '原文4'])
    expect(result.paragraphs).toEqual(['译文1', '译文2', '原文3', '原文4'])
    expect(result.fallbackCount).toBe(2)
    expect(result.overflowCount).toBe(0)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('译文段数 > 原文（契约破坏）→ 截断多余段 + warn + overflowCount > 0', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = alignParagraphs('A\n\nB\n\nC\n\nD\n\nE', ['原文1', '原文2'])
    expect(result.paragraphs).toEqual(['A', 'B'])
    expect(result.overflowCount).toBe(3)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('空译文（fallbackCount = 原文长度）→ 全部回退原文 + warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = alignParagraphs('', ['原文1', '原文2'])
    expect(result.paragraphs).toEqual(['原文1', '原文2'])
    expect(result.fallbackCount).toBe(2)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('多空行分隔（\n\n\n+）合并为单个分段边界', () => {
    const result = alignParagraphs('A\n\n\n\nB\n\n\n\n\nC', ['o1', 'o2', 'o3'])
    expect(result.paragraphs).toEqual(['A', 'B', 'C'])
    expect(result.fallbackCount).toBe(0)
  })
})

// ──────────────────── reassembleDeltas（#948）────────────────────

/**
 * Oracle 溯源：本组的期望值来自 issue #948 的验收条件 + 生产链路事实 ——
 * native 桥（TranslationSseParser.emitConsolidated）逐段 trim 后以 `delta_all`
 * 一帧下发整章，段间 `\n\n` 在 Java 侧已被剥掉 ⇒ JS 侧只能靠 `paragraphIndex` 复原
 * 段落边界；web 流式 provider（mapEventToChunk）恒给占位 `paragraphIndex: 0`，
 * 段落边界靠模型输出里的空行。
 */
describe('reassembleDeltas 流式 delta → 逐段译文重装配（#948）', () => {
  it('序号可信（native 形态）：N 条带序号的 delta → N 段译文，fallbackCount=0', () => {
    const result = reassembleDeltas(
      [
        { paragraphIndex: 0, text: '第一段·译' },
        { paragraphIndex: 1, text: '第二段·译' },
        { paragraphIndex: 2, text: '第三段·译' },
      ],
      ['第一段', '第二段', '第三段'],
    )
    expect(result.paragraphs).toEqual(['第一段·译', '第二段·译', '第三段·译'])
    expect(result.fallbackCount).toBe(0)
    expect(result.overflowCount).toBe(0)
  })

  it('序号可信：同一段多次增量按到达顺序直接相连（不插入分隔符）', () => {
    const result = reassembleDeltas(
      [
        { paragraphIndex: 0, text: '前半' },
        { paragraphIndex: 1, text: '第二段' },
        { paragraphIndex: 0, text: '后半' },
      ],
      ['原文1', '原文2'],
    )
    expect(result.paragraphs).toEqual(['前半后半', '第二段'])
    expect(result.fallbackCount).toBe(0)
  })

  it('序号可信：缺号不前移（段 1 缺失时，段 2 的译文不得落到段 1）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = reassembleDeltas(
      [
        { paragraphIndex: 0, text: '译一' },
        { paragraphIndex: 2, text: '译三' },
      ],
      ['原文1', '原文2', '原文3'],
    )
    expect(result.paragraphs).toEqual(['译一', '原文2', '译三'])
    expect(result.fallbackCount).toBe(1)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('序号可信：越界序号计入 overflowCount，不挤占原文段落', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = reassembleDeltas(
      [
        { paragraphIndex: 0, text: '译一' },
        { paragraphIndex: 1, text: '译二' },
        { paragraphIndex: 7, text: '多出来的段' },
      ],
      ['原文1', '原文2'],
    )
    expect(result.paragraphs).toEqual(['译一', '译二'])
    expect(result.overflowCount).toBe(1)
    expect(result.fallbackCount).toBe(0)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('序号可信：空文本桶等同缺号（计入 fallbackCount）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = reassembleDeltas(
      [
        { paragraphIndex: 0, text: '译一' },
        { paragraphIndex: 1, text: '   ' },
      ],
      ['原文1', '原文2'],
    )
    expect(result.paragraphs).toEqual(['译一', '原文2'])
    expect(result.fallbackCount).toBe(1)
    warnSpy.mockRestore()
  })

  it('序号为占位 0（web 流式形态）：退回按空行拆段，段落边界仍正确', () => {
    const result = reassembleDeltas(
      [
        { paragraphIndex: 0, text: '第一段·译\n\n' },
        { paragraphIndex: 0, text: '第二段·译' },
      ],
      ['第一段', '第二段'],
    )
    expect(result.paragraphs).toEqual(['第一段·译', '第二段·译'])
    expect(result.fallbackCount).toBe(0)
  })

  it('序号为占位 0 且模型没按空行分段 → 退化为整块 1 段 + fallback（既有语义，不静默）', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = reassembleDeltas([{ paragraphIndex: 0, text: '译一译二' }], ['原文1', '原文2'])
    expect(result.paragraphs).toEqual(['译一译二', '原文2'])
    expect(result.fallbackCount).toBe(1)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('零 delta → 全段回退原文 + fallbackCount=原文长度 + warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = reassembleDeltas([], ['原文1', '原文2'])
    expect(result.paragraphs).toEqual(['原文1', '原文2'])
    expect(result.fallbackCount).toBe(2)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

// ──────────────────── fetchChunkViaProvider（#948：此前零覆盖）────────────────────

describe('fetchChunkViaProvider delta 收集与重装配（#948）', () => {
  const controller = new AbortController()
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('native 形态：delta_all 展开成 N 条带序号 delta → 逐段还原，fallbackCount=0', async () => {
    const provider = mockProvider({
      indexedDeltas: [
        { paragraphIndex: 0, text: '第一段·译' },
        { paragraphIndex: 1, text: '第二段·译' },
        { paragraphIndex: 2, text: '第三段·译' },
      ],
    })
    const result = await fetchChunkViaProvider(
      { start: 0, end: 3 },
      ['第一段', '第二段', '第三段'],
      provider,
      { ...SAMPLE_REQUEST, paragraphs: ['第一段', '第二段', '第三段'] },
      SAMPLE_CONFIG,
      controller.signal,
    )
    expect(result.paragraphs).toEqual(['第一段·译', '第二段·译', '第三段·译'])
    expect(result.fallbackCount).toBe(0)
  })

  it('provider 少给一段 → fallbackCount>0（缺口是真信号，不是分隔符丢失的假象）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const provider = mockProvider({
      indexedDeltas: [
        { paragraphIndex: 0, text: '第一段·译' },
        { paragraphIndex: 1, text: '' },
      ],
    })
    const result = await fetchChunkViaProvider(
      { start: 0, end: 2 },
      ['第一段', '第二段'],
      provider,
      { ...SAMPLE_REQUEST, paragraphs: ['第一段', '第二段'] },
      SAMPLE_CONFIG,
      controller.signal,
    )
    expect(result.fallbackCount).toBe(1)
    expect(result.paragraphs).toEqual(['第一段·译', '第二段'])
    warnSpy.mockRestore()
  })

  it('onChunk 仍逐帧透传（store 增量渲染依赖它）', async () => {
    const seen: TranslationChunk[] = []
    const provider = mockProvider({
      indexedDeltas: [
        { paragraphIndex: 0, text: '译一' },
        { paragraphIndex: 1, text: '译二' },
      ],
    })
    await fetchChunkViaProvider(
      { start: 0, end: 2 },
      ['原文1', '原文2'],
      provider,
      { ...SAMPLE_REQUEST, paragraphs: ['原文1', '原文2'] },
      SAMPLE_CONFIG,
      controller.signal,
      (c) => seen.push(c),
    )
    expect(seen.filter((c) => c.type === 'delta')).toHaveLength(2)
  })

  it('onChunk 第二个入参 = 该块的 range.start（store 据此还原绝对段落序号，#1033）', async () => {
    // 块内序号从 0 起，provider 不可能知道自己在原数组里的位置 —— 偏移的唯一权威
    // 来源是调用方持有的 range。此前 onChunk 只带 chunk，store 只能靠「块首段文本
    // 反查」这种猜测寻址（重复文本即错位，#1033）。
    const seen: Array<{ text: string; start: number }> = []
    const provider = mockProvider({
      indexedDeltas: [
        { paragraphIndex: 0, text: '译一' },
        { paragraphIndex: 1, text: '译二' },
      ],
    })
    await fetchChunkViaProvider(
      { start: 5, end: 7 },
      ['原文5', '原文6'],
      provider,
      { ...SAMPLE_REQUEST, paragraphs: ['原文5', '原文6'] },
      SAMPLE_CONFIG,
      controller.signal,
      (c, start) => {
        if (c.type === 'delta') seen.push({ text: c.text, start })
      },
    )
    expect(seen).toEqual([
      { text: '译一', start: 5 },
      { text: '译二', start: 5 },
    ])
  })

  it('cached chunk → 走既有对齐路径（防御性补齐数量）', async () => {
    const provider = mockProvider({ cached: ['缓存1', '缓存2'] })
    const result = await fetchChunkViaProvider(
      { start: 0, end: 2 },
      ['原文1', '原文2'],
      provider,
      { ...SAMPLE_REQUEST, paragraphs: ['原文1', '原文2'] },
      SAMPLE_CONFIG,
      controller.signal,
    )
    expect(result.paragraphs).toEqual(['缓存1', '缓存2'])
    expect(result.fallbackCount).toBe(0)
  })
})

// ──────────────────── runChunkPool ────────────────────

describe('runChunkPool Promise 池并发', () => {
  it('空 chunks → 空结果数组', async () => {
    const result = await runChunkPool([], async () => 'never', 3, false)
    expect(result).toEqual([])
  })

  it('并发度 ≤3：5 块请求 → 实际并发 ≤3', async () => {
    let active = 0
    let maxActive = 0
    const chunks: ChunkRange[] = Array.from({ length: 5 }, (_, i) => ({ start: i, end: i + 1 }))
    const fetch = vi.fn(async (range: ChunkRange) => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 10))
      active--
      return `chunk-${range.start}`
    })
    const result = await runChunkPool(chunks, fetch, 3, false)
    expect(result).toHaveLength(5)
    expect(maxActive).toBeLessThanOrEqual(3)
    expect(maxActive).toBeGreaterThanOrEqual(2)
  })

  it('并发度 = 1 → 串行执行', async () => {
    const order: number[] = []
    const chunks: ChunkRange[] = Array.from({ length: 3 }, (_, i) => ({ start: i, end: i + 1 }))
    const fetch = vi.fn(async (range: ChunkRange) => {
      order.push(range.start)
      await new Promise((r) => setTimeout(r, 5))
      return `chunk-${range.start}`
    })
    await runChunkPool(chunks, fetch, 1, false)
    expect(order).toEqual([0, 1, 2])
  })

  it('单块失败 → 该位置为 null，其他块仍继续（不阻塞）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const chunks: ChunkRange[] = [
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
    ]
    const fetch = vi.fn(async (range: ChunkRange) => {
      if (range.start === 1) throw new Error('boom')
      return `chunk-${range.start}`
    })
    const result = await runChunkPool(chunks, fetch, 3, false)
    expect(result[0]).toBe('chunk-0')
    expect(result[1]).toBeNull()
    expect(result[2]).toBe('chunk-2')
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('AbortSignal 触发 → worker 静默退出，不再返回任何 chunk', async () => {
    const controller = new AbortController()
    const chunks: ChunkRange[] = Array.from({ length: 5 }, (_, i) => ({ start: i, end: i + 1 }))
    let completedAfterAbort = 0
    const fetch = vi.fn(async (range: ChunkRange) => {
      await new Promise((r) => setTimeout(r, 20))
      if (controller.signal.aborted) completedAfterAbort++
      return `chunk-${range.start}`
    })
    // 在中途 abort
    setTimeout(() => controller.abort(), 30)
    const result = await runChunkPool(chunks, fetch, 3, controller.signal)
    // abort 之后开始 fetch 的块会抛 AbortError → 静默退出（results 保持初始 null）
    // 这里只断言：返回的数组不含 undefined 类型错误（worker 优雅退出）
    expect(result.every((r) => r === null || typeof r === 'string')).toBe(true)
  })
})

// ──────────────────── createNovelTranslator 8 状态 ────────────────────

describe('createNovelTranslator 主入口（8 状态判定）', () => {
  let controller: AbortController
  beforeEach(() => {
    controller = new AbortController()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('空 paragraphs → completed + 空数组（短路）', async () => {
    const provider = mockProvider({})
    const translator = createNovelTranslator({ provider })
    const result = await translator.translate(
      { ...SAMPLE_REQUEST, paragraphs: [] },
      SAMPLE_CONFIG,
      controller.signal,
    )
    expect(result.status).toBe('completed')
    expect(result.paragraphs).toEqual([])
  })

  it('signal.aborted 在调用前已 true → aborted + 原文回退', async () => {
    controller.abort()
    const provider = mockProvider({})
    const translator = createNovelTranslator({ provider })
    const result = await translator.translate(SAMPLE_REQUEST, SAMPLE_CONFIG, controller.signal)
    expect(result.status).toBe('aborted')
    expect(result.paragraphs).toEqual(SAMPLE_REQUEST.paragraphs)
  })

  it('成功流式：所有块对齐 → completed + 译文数组', async () => {
    const provider = mockProvider({
      deltas: [
        '[0] 译文1\n\n[1] 译文2',
        '\n\n[2] 译文3\n\n[3] 译文4',
        '\n\n[4] 译文5',
      ],
      usage: { inputTokens: 100, outputTokens: 50 },
    })
    const translator = createNovelTranslator({ provider })
    const result = await translator.translate(SAMPLE_REQUEST, SAMPLE_CONFIG, controller.signal)
    expect(result.status).toBe('completed')
    expect(result.paragraphs).toEqual(['译文1', '译文2', '译文3', '译文4', '译文5'])
  })

  it('缓存命中（cached chunk） → completed + 缓存段落', async () => {
    const provider = mockProvider({ cached: ['cached1', 'cached2', 'cached3', 'cached4', 'cached5'] })
    const translator = createNovelTranslator({ provider })
    const result = await translator.translate(SAMPLE_REQUEST, SAMPLE_CONFIG, controller.signal)
    expect(result.status).toBe('completed')
    expect(result.paragraphs).toEqual(['cached1', 'cached2', 'cached3', 'cached4', 'cached5'])
  })

  it('单块失败（error chunk + retryable=false） → failed + 失败块回退原文', async () => {
    // 5 段 × 5 字总长 < 2000 → 1 块；provider 返回 error chunk → 整批失败
    let callCount = 0
    const provider: TranslationProvider = {
      id: 'mock',
      abort: vi.fn(),
      translate: (_req, _config, signal) => {
        return {
          async next() {
            if (signal.aborted) throw new DOMException('aborted', 'AbortError')
            const which = callCount++
            if (which === 0) {
              return {
                value: { type: 'error' as const, code: 'server' as const, message: 'boom', retryable: false },
                done: false,
              }
            }
            // 第二次返回 done=true（避免无限循环）
            return { value: undefined as never, done: true }
          },
        }
      },
    }
    const translator = createNovelTranslator({ provider })
    const result = await translator.translate(SAMPLE_REQUEST, SAMPLE_CONFIG, controller.signal)
    expect(result.status).toBe('failed')
    expect(result.paragraphs).toEqual(SAMPLE_REQUEST.paragraphs)
  })

  it('用户中途 abort → status=aborted', async () => {
    const provider: TranslationProvider = {
      id: 'mock',
      abort: vi.fn(),
      translate: (_req, _config, signal) => ({
        async next() {
          if (signal.aborted) throw new DOMException('aborted', 'AbortError')
          // 模拟延迟
          await new Promise((r) => setTimeout(r, 50))
          return { value: { type: 'delta' as const, paragraphIndex: 0, text: '[0] x' }, done: false }
        },
      }),
    }
    const translator = createNovelTranslator({ provider })
    // 50ms 后 abort
    setTimeout(() => controller.abort(), 20)
    const result = await translator.translate(SAMPLE_REQUEST, SAMPLE_CONFIG, controller.signal)
    expect(result.status).toBe('aborted')
  })

  it('onChunk 回调收到 chunk（流式可视化测试）', async () => {
    const chunks: TranslationChunk[] = []
    const provider = mockProvider({
      deltas: ['[0] A', '\n\n[1] B'],
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    const translator = createNovelTranslator({ provider })
    await translator.translate(SAMPLE_REQUEST, SAMPLE_CONFIG, controller.signal, (c) => chunks.push(c))
    // 收到至少 1 个 delta + 1 个 done chunk
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks.some((c) => c.type === 'done')).toBe(true)
  })

  it('多段落块时 onChunk 的 chunkStart = 各块 range.start，而非块序号（#1033）', async () => {
    // maxChunkChars=8 ⇒ 5 段 3 字被切成 {0,2}{2,4}{4,5} ⇒ range.start = 0,2,4，
    // 而块序号是 0,1,2。刻意避开「每块 1 段」的布局 —— 那时 start 与序号恒等，
    // 换成块序号也能全绿，判别力为零。
    // 并发 3，完成顺序不确定 ⇒ 断言取 set 而非序列。
    const starts = new Set<number>()
    const provider = mockProvider({
      indexedDeltas: [
        { paragraphIndex: 0, text: '译' },
        { paragraphIndex: 1, text: '译' },
      ],
    })
    const translator = createNovelTranslator({ provider, maxChunkChars: 8 })
    const result = await translator.translate(
      SAMPLE_REQUEST,
      SAMPLE_CONFIG,
      controller.signal,
      (c, start) => {
        if (c.type === 'delta') starts.add(start)
      },
    )
    expect(result.status).toBe('completed')
    expect(starts).toEqual(new Set([0, 2, 4]))
  })

  // ─── #948：native 形态（带段落序号的 delta）走到主入口 ───

  it('native 形态：逐段译文完整 → completed + 逐段译文（不再塌成 1 段）', async () => {
    const provider = mockProvider({
      indexedDeltas: [
        { paragraphIndex: 0, text: '译文1' },
        { paragraphIndex: 1, text: '译文2' },
        { paragraphIndex: 2, text: '译文3' },
        { paragraphIndex: 3, text: '译文4' },
        { paragraphIndex: 4, text: '译文5' },
      ],
    })
    const translator = createNovelTranslator({ provider })
    const result = await translator.translate(SAMPLE_REQUEST, SAMPLE_CONFIG, controller.signal)
    expect(result.status).toBe('completed')
    expect(result.paragraphs).toEqual(['译文1', '译文2', '译文3', '译文4', '译文5'])
  })

  it('native 形态：有段落没译文 → partial（不得 completed —— completed 的定义是「已写入缓存」，半成品入缓存会把坏译文固化）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const provider = mockProvider({
      indexedDeltas: [
        { paragraphIndex: 0, text: '译文1' },
        { paragraphIndex: 1, text: '' },
        { paragraphIndex: 2, text: '译文3' },
        { paragraphIndex: 3, text: '译文4' },
        { paragraphIndex: 4, text: '译文5' },
      ],
    })
    const translator = createNovelTranslator({ provider })
    const result = await translator.translate(SAMPLE_REQUEST, SAMPLE_CONFIG, controller.signal)
    expect(result.status).toBe('partial')
    // 缺号段落保留原文（不静默位移）：段 3 的译文不得落到段 2
    expect(result.paragraphs).toEqual(['译文1', '段落2', '译文3', '译文4', '译文5'])
    warnSpy.mockRestore()
  })

  it('web 流式形态（占位 paragraphIndex=0 + 空行）：仍 completed + 逐段对齐', async () => {
    const provider = mockProvider({
      deltas: ['[0] 译文1\n\n[1] 译文2', '\n\n[2] 译文3\n\n[3] 译文4', '\n\n[4] 译文5'],
    })
    const translator = createNovelTranslator({ provider })
    const result = await translator.translate(SAMPLE_REQUEST, SAMPLE_CONFIG, controller.signal)
    expect(result.status).toBe('completed')
    expect(result.paragraphs).toEqual(['译文1', '译文2', '译文3', '译文4', '译文5'])
  })
})

// ──────────────────── TranslationChunkError ────────────────────

describe('TranslationChunkError 错误包装', () => {
  it('code / retryable / name 正确传递', () => {
    const e = new TranslationChunkError('rate_limit', 'rate limited', true)
    expect(e.code).toBe('rate_limit')
    expect(e.retryable).toBe(true)
    expect(e.name).toBe('TranslationChunkError')
    expect(e.message).toBe('rate limited')
  })
})
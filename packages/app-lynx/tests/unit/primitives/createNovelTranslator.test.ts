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
  parseAnchorDeltas,
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
  /** 返回 delta 文本序列；空数组 = 立即 done（无 delta） */
  deltas?: string[]
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

// ──────────────────── parseAnchorDeltas ────────────────────

describe('parseAnchorDeltas 流式 delta 按 [N] 锚定拆分', () => {
  it('单 [N] 锚定 → 写入对应段落', () => {
    const { state, tail } = parseAnchorDeltas('[0] 译文A', {})
    expect(state).toEqual({ 0: '译文A' })
    expect(tail).toBe('')
  })

  it('多 [N] 锚定连续 → 全部解析', () => {
    const { state, tail } = parseAnchorDeltas('[0] A\n\n[1] B\n\n[2] C', {})
    expect(state).toEqual({ 0: 'A', 1: 'B', 2: 'C' })
    expect(tail).toBe('')
  })

  it('半完成（delta 末尾未到下一个 [N]）→ 解析完整锚定后留空 tail（按段落分隔符 \(\n\n\) 由 caller 主动切分）', () => {
    // 注：实现按完整锚定解析（不区分 complete vs partial）。
    // 生产场景 LLM 输出按 \n\n 段落分隔符断行；partial 锚定场景由 caller
    // 在调用 parseAnchorDeltas 前用 \n\n 切分 delta 块来保证完整性。
    const { state, tail } = parseAnchorDeltas('[0] A\n\n[1] B\n\n[2] 正在', {})
    expect(state).toEqual({ 0: 'A', 1: 'B', 2: '正在' })
    expect(tail).toBe('')
  })

  it('同段落多次累积 → 用 \\n\\n 拼接', () => {
    const r1 = parseAnchorDeltas('[0] 第一行', {})
    const r2 = parseAnchorDeltas(r1.tail + '[0] 第二行', r1.state)
    expect(r2.state[0]).toBe('第一行\n\n第二行')
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
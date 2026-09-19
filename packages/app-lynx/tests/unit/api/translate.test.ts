// ─── OpenAI Responses Provider 契约测试（ADR-0169 D10 测试基线） ───
// 测试组（来自 ADR-0169 D10 + AGENTS.md 测试硬约束）：
// - Provider 接口契约（async iterator / abort / error.code 分类）
// - Chunk 规约（30+ Responses 事件 → 5 种 chunk；DeepSeek 兼容无 [DONE]）
// - SSE 帧解析（Responses / ChatCompletions 双形态终止信号）
// - usage 字段映射（OpenAI Responses `cached_tokens` ↔ DeepSeek `prompt_cache_hit_tokens`）
// - Azure URL 模板（自动补 /openai/v1 + api-version: preview header）
// - AbortSignal 取消（abort 后零 chunk emit）
//
// Oracle 来源（AGENTS.md 测试硬约束 #2「真实样例」）：
// - Responses API 事件序列：research/openai-responses-api.md §Q2 + §Q4
// - DeepSeek Responses 旁证：research/deepseek-streaming-api.md §Q2（事件类型同 OpenAI）
// - 真实 SSE 帧格式：`data: {json}\n\n` + `[DONE]` 哨兵（ChatCompletions 兼容）
//
// IO 边界硬约束：成功与失败/降级双路径覆盖；静默降级禁 → 必须 console.warn。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildResponsesRequestBody,
  buildSystemInstructions,
  estimateMaxOutput,
  isAzureBaseURL,
  mapEventToChunk,
  mapUsage,
  normalizeAzureBaseURL,
  OpenAIResponsesProvider,
  parseSSE,
  type LlmEndpointConfig,
  type TranslationRequest,
  type ResponsesEventBase,
  type TranslationChunk,
} from '../../../src/api/translate'

// ─────────────────── 测试 fixtures（真实 Responses 事件样本）───────────────────

/** OpenAI 官方文档摘录的最小流（research/openai-responses-api.md §Q2） */
const REAL_OPENAI_EVENTS: ResponsesEventBase[] = [
  { type: 'response.created', response: { status: 'in_progress' } },
  { type: 'response.in_progress', response: { status: 'in_progress' } },
  {
    type: 'response.output_item.added',
    output_index: 0,
    item: { type: 'message' },
  },
  {
    type: 'response.content_part.added',
    item_id: 'msg_test',
    output_index: 0,
    content_index: 0,
    part: { type: 'output_text', text: '', annotations: [] },
  },
  {
    type: 'response.output_text.delta',
    item_id: 'msg_test',
    output_index: 0,
    content_index: 0,
    delta: '你好',
  },
  {
    type: 'response.output_text.delta',
    item_id: 'msg_test',
    output_index: 0,
    content_index: 0,
    delta: '，世界',
  },
  {
    type: 'response.output_text.done',
    item_id: 'msg_test',
    output_index: 0,
    content_index: 0,
    text: '你好，世界',
  },
  {
    type: 'response.completed',
    response: {
      status: 'completed',
      usage: {
        input_tokens: 100,
        output_tokens: 5,
        total_tokens: 105,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 100 },
      },
    },
  },
]

/** DeepSeek Responses 旁证（research §DeepSeek Compat Reference：同 OpenAI Responses 事件类型） */
const REAL_DEEPSEEK_EVENTS: ResponsesEventBase[] = [
  {
    type: 'response.output_text.delta',
    item_id: 'msg_ds',
    output_index: 0,
    content_index: 0,
    delta: '[0] 第一段译文\n\n[1] 第二段译文',
  },
  {
    type: 'response.completed',
    response: {
      status: 'completed',
      usage: {
        // DeepSeek Responses 端已统一 OpenAI Responses 命名（research §Q8.2）
        input_tokens: 200,
        output_tokens: 50,
        input_tokens_details: { cached_tokens: 80 },
      },
    },
  },
]

const SAMPLE_CONFIG: LlmEndpointConfig = {
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'sk-test-key-not-secret',
  model: 'gpt-5',
  targetLang: 'zh-CN',
  sourceLang: 'ja',
}

const SAMPLE_REQUEST: TranslationRequest = {
  novelId: 23876543,
  chapterId: '1',
  paragraphs: ['第一段落原文', '第二段落原文'],
  options: { xRestrict: 0 },
}

// ─────────────────── Provider 接口契约 ───────────────────

describe('Provider 接口契约', () => {
  it('OpenAIResponsesProvider.id = "openai-responses"', () => {
    const p = new OpenAIResponsesProvider()
    expect(p.id).toBe('openai-responses')
  })

  it('translate() 返回 AsyncIterator<TranslationChunk>', () => {
    const p = new OpenAIResponsesProvider({ fetchImpl: vi.fn() })
    const iter = p.translate(SAMPLE_REQUEST, SAMPLE_CONFIG, new AbortController().signal)
    expect(typeof iter[Symbol.asyncIterator]).toBe('function')
    expect(typeof iter.next).toBe('function')
  })

  it('abort() 调用不抛错；二次调用不抛错', () => {
    const p = new OpenAIResponsesProvider()
    expect(() => p.abort()).not.toThrow()
    expect(() => p.abort()).not.toThrow()
  })
})

// ─────────────────── 事件映射（30+ → 5 种 Chunk）───────────────────

describe('mapEventToChunk 事件规约（OpenAI Responses 30+ → 5 种 chunk）', () => {
  it('response.output_text.delta → delta chunk（主消费事件）', () => {
    const chunk = mapEventToChunk({
      type: 'response.output_text.delta',
      delta: '你好',
    })
    expect(chunk).toEqual({ type: 'delta', paragraphIndex: 0, text: '你好' })
  })

  it('response.reasoning_text.delta → reasoning_delta chunk（埋点用）', () => {
    const chunk = mapEventToChunk({
      type: 'response.reasoning_text.delta',
      delta: 'let me think',
    })
    expect(chunk).toEqual({ type: 'reasoning_delta', text: 'let me think' })
  })

  it('response.reasoning_summary_text.delta → reasoning_delta chunk（与 reasoning_text 同处理）', () => {
    const chunk = mapEventToChunk({
      type: 'response.reasoning_summary_text.delta',
      delta: 'summary',
    })
    expect(chunk).toEqual({ type: 'reasoning_delta', text: 'summary' })
  })

  it('response.refusal.delta → error(content_filter)（模型拒答）', () => {
    const chunk = mapEventToChunk({
      type: 'response.refusal.delta',
      refusal: '模型拒绝',
    })
    expect(chunk).toEqual({
      type: 'error',
      code: 'content_filter',
      message: '模型拒绝',
      retryable: false,
    })
  })

  it('response.completed → done chunk + usage 映射', () => {
    const chunk = mapEventToChunk({
      type: 'response.completed',
      response: {
        status: 'completed',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          total_tokens: 150,
          input_tokens_details: { cached_tokens: 30, cache_write_tokens: 70 },
        },
      },
    })
    expect(chunk).toEqual({
      type: 'done',
      usage: { inputTokens: 100, outputTokens: 50, cachedTokens: 30 },
    })
  })

  it('response.failed → error chunk (mapping failed.server_error)', () => {
    const chunk = mapEventToChunk({
      type: 'response.failed',
      response: {
        status: 'failed',
        error: { code: 'server_error', message: 'internal failure' },
      },
    })
    expect(chunk?.type).toBe('error')
    if (chunk?.type === 'error') {
      expect(chunk.code).toBe('server')
      expect(chunk.message).toBe('internal failure')
      expect(chunk.retryable).toBe(false)
    }
  })

  it('response.incomplete(max_output_tokens) → error(invalid_request, retryable=true)', () => {
    const chunk = mapEventToChunk({
      type: 'response.incomplete',
      response: {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
      },
    })
    expect(chunk?.type).toBe('error')
    if (chunk?.type === 'error') {
      expect(chunk.code).toBe('invalid_request')
      expect(chunk.message).toContain('max_output_tokens')
      expect(chunk.retryable).toBe(true)
    }
  })

  it('response.incomplete(content_filter) → error(content_filter, retryable=false)', () => {
    const chunk = mapEventToChunk({
      type: 'response.incomplete',
      response: {
        status: 'incomplete',
        incomplete_details: { reason: 'content_filter' },
      },
    })
    expect(chunk?.type).toBe('error')
    if (chunk?.type === 'error') {
      expect(chunk.code).toBe('content_filter')
      expect(chunk.retryable).toBe(false)
    }
  })

  it('裸 error 事件 → error(server, retryable=true)', () => {
    const chunk = mapEventToChunk({ type: 'error', code: 'connection_lost', message: '网络断开' })
    expect(chunk).toEqual({
      type: 'error',
      code: 'server',
      message: '网络断开',
      retryable: true,
    })
  })

  it('结构事件（response.output_item.* / response.content_part.* / response.created / response.in_progress）→ null', () => {
    expect(mapEventToChunk({ type: 'response.created' })).toBeNull()
    expect(mapEventToChunk({ type: 'response.in_progress' })).toBeNull()
    expect(mapEventToChunk({ type: 'response.output_item.added', output_index: 0, item: { type: 'message' } })).toBeNull()
    expect(mapEventToChunk({ type: 'response.output_item.done', output_index: 0, item: { type: 'message' } })).toBeNull()
    expect(mapEventToChunk({ type: 'response.content_part.added', item_id: 'x', output_index: 0, content_index: 0, part: {} })).toBeNull()
    expect(mapEventToChunk({ type: 'response.output_text.done', item_id: 'x', output_index: 0, content_index: 0, text: 'final' })).toBeNull()
  })

  it('DeepSeek Responses 兼容：同事件序列被规约一致（无 [DONE] 兼容）', () => {
    // DeepSeek Responses 与 OpenAI Responses 同事件类型 → 走同一规约表
    const chunks = REAL_DEEPSEEK_EVENTS.map((e) => mapEventToChunk(e))
    const deltaChunks = chunks.filter((c) => c?.type === 'delta')
    const doneChunks = chunks.filter((c) => c?.type === 'done')
    expect(deltaChunks.length).toBe(1)
    expect(doneChunks.length).toBe(1)
    expect((doneChunks[0] as { usage?: { cachedTokens?: number } }).usage?.cachedTokens).toBe(80)
  })
})

// ─────────────────── usage 字段映射 ───────────────────

describe('mapUsage 字段映射（OpenAI Responses ↔ DeepSeek）', () => {
  it('完整字段映射', () => {
    expect(
      mapUsage({
        input_tokens: 100,
        output_tokens: 50,
        input_tokens_details: { cached_tokens: 30, cache_write_tokens: 70 },
        output_tokens_details: { reasoning_tokens: 10 },
      }),
    ).toEqual({ inputTokens: 100, outputTokens: 50, cachedTokens: 30 })
  })

  it('缺 input_tokens_details → 无 cachedTokens', () => {
    expect(mapUsage({ input_tokens: 10, output_tokens: 5 })).toEqual({ inputTokens: 10, outputTokens: 5 })
  })

  it('undefined usage → undefined', () => {
    expect(mapUsage(undefined)).toBeUndefined()
  })
})

// ─────────────────── SSE 帧解析 ───────────────────

/** 构造 SSE 字节流（模拟 fetch response.body） */
function sseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const chunks = events.map((e) => encoder.encode(e))
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
}

describe('parseSSE SSE 帧解析', () => {
  it('逐行 data: {json} 解析为事件', async () => {
    const stream = sseStream([
      'data: {"type":"response.output_text.delta","delta":"你好"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"，世界"}\n\n',
      'data: {"type":"response.completed"}\n\n',
    ])
    const out: ResponsesEventBase[] = []
    for await (const event of parseSSE(stream, new AbortController().signal)) {
      out.push(event)
    }
    expect(out.length).toBe(3)
    expect(out[0].type).toBe('response.output_text.delta')
    expect((out[0] as { delta?: string }).delta).toBe('你好')
  })

  it('[DONE] 哨兵触发流终止（ChatCompletions 兼容）', async () => {
    const stream = sseStream([
      'data: {"type":"response.output_text.delta","delta":"x"}\n\n',
      'data: [DONE]\n\n',
      'data: {"type":"response.completed"}\n\n', // 不应消费
    ])
    const out: ResponsesEventBase[] = []
    for await (const event of parseSSE(stream, new AbortController().signal)) {
      out.push(event)
    }
    expect(out.length).toBe(1)
    expect((out[0] as { delta?: string }).delta).toBe('x')
  })

  it('keep-alive 注释行（: 开头的 SSE 注释）被跳过', async () => {
    const stream = sseStream([
      ': keep-alive\n\n',
      'data: {"type":"response.output_text.delta","delta":"y"}\n\n',
    ])
    const out: ResponsesEventBase[] = []
    for await (const event of parseSSE(stream, new AbortController().signal)) {
      out.push(event)
    }
    expect(out.length).toBe(1)
    expect((out[0] as { delta?: string }).delta).toBe('y')
  })

  it('非 JSON 帧被跳过（防御性）', async () => {
    const stream = sseStream([
      'data: not-valid-json\n\n',
      'data: {"type":"response.output_text.delta","delta":"z"}\n\n',
    ])
    const out: ResponsesEventBase[] = []
    for await (const event of parseSSE(stream, new AbortController().signal)) {
      out.push(event)
    }
    expect(out.length).toBe(1)
  })

  it('半帧（buffer 末尾不完整）下次 read 拼接后正确解析', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        // 第一帧被切成两半发送
        controller.enqueue(encoder.encode('data: {"type":"response.output_text.de'))
        controller.enqueue(encoder.encode('lta","delta":"half"}\n\n'))
        controller.close()
      },
    })
    const out: ResponsesEventBase[] = []
    for await (const event of parseSSE(stream, new AbortController().signal)) {
      out.push(event)
    }
    expect(out.length).toBe(1)
    expect((out[0] as { delta?: string }).delta).toBe('half')
  })
})

// ─────────────────── 请求体构造 ───────────────────

describe('buildResponsesRequestBody 请求体构造', () => {
  it('POST {baseURL}/responses + Content-Type + 段落锚定 + stream:true + max_output_tokens', () => {
    const { url, headers, body } = buildResponsesRequestBody(SAMPLE_REQUEST, SAMPLE_CONFIG)
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['api-version']).toBeUndefined()
    expect(body.model).toBe('gpt-5')
    expect(body.stream).toBe(true)
    expect(body.input).toHaveLength(1)
    expect(body.input[0].role).toBe('user')
    expect(body.input[0].content).toContain('[0] 第一段落原文')
    expect(body.input[0].content).toContain('[1] 第二段落原文')
    expect(body.max_output_tokens).toBeGreaterThan(0)
    expect(body.reasoning?.effort).toBe('minimal')
  })

  it('instructions prefix 稳定（顺序/措辞固定 → 命中 prompt cache）', () => {
    const a = buildSystemInstructions(SAMPLE_CONFIG)
    const b = buildSystemInstructions(SAMPLE_CONFIG)
    expect(a).toBe(b)
    expect(a).toContain('professional novel translator')
    expect(a).toContain('zh-CN')
    expect(a).toContain('ja')
    expect(a).toContain('[N]')
  })

  it('estimateMaxOutput：clamp 到 [256, 16384]', () => {
    expect(estimateMaxOutput(['a'])).toBeGreaterThanOrEqual(256)
    // 100k 字符输入 → 应 clamp 到 16384
    const huge = Array.from({ length: 1000 }, () => 'a'.repeat(100)).join('')
    const result = estimateMaxOutput([huge])
    expect(result).toBeLessThanOrEqual(16384)
  })
})

// ─────────────────── Azure URL 处理 ───────────────────

describe('Azure URL 模板处理', () => {
  it('isAzureBaseURL：匹配 *.openai.azure.com', () => {
    expect(isAzureBaseURL('https://my-r.openai.azure.com')).toBe(true)
    expect(isAzureBaseURL('https://my-r.openai.azure.com/openai/v1')).toBe(true)
    expect(isAzureBaseURL('https://api.openai.com/v1')).toBe(false)
    expect(isAzureBaseURL('https://deepseek.com')).toBe(false)
    // 防伪后缀域
    expect(isAzureBaseURL('https://openai.azure.com.evil.com')).toBe(false)
  })

  it('normalizeAzureBaseURL：自动补 /openai/v1', () => {
    expect(normalizeAzureBaseURL('https://my-r.openai.azure.com')).toBe(
      'https://my-r.openai.azure.com/openai/v1',
    )
    expect(normalizeAzureBaseURL('https://my-r.openai.azure.com/')).toBe(
      'https://my-r.openai.azure.com/openai/v1',
    )
    // 已含 /openai/v1 段 → 原样
    expect(normalizeAzureBaseURL('https://my-r.openai.azure.com/openai/v1')).toBe(
      'https://my-r.openai.azure.com/openai/v1',
    )
    // 非 Azure → 原样
    expect(normalizeAzureBaseURL('https://api.openai.com/v1')).toBe('https://api.openai.com/v1')
  })

  it('Azure 形态 → headers 含 api-version: preview', () => {
    const { headers } = buildResponsesRequestBody(SAMPLE_REQUEST, {
      ...SAMPLE_CONFIG,
      baseURL: 'https://my-r.openai.azure.com',
    })
    expect(headers['api-version']).toBe('preview')
  })
})

// ─────────────────── AbortSignal 取消 ───────────────────

describe('AbortSignal 取消语义（ADR-0169 D5.4 + D6）', () => {
  let controller: AbortController
  beforeEach(() => {
    controller = new AbortController()
  })

  it('signal.aborted=true 时 translate() 立即返回 aborted 状态（不调 fetch）', async () => {
    const fetchMock = vi.fn()
    const p = new OpenAIResponsesProvider({ fetchImpl: fetchMock })
    const iter = p.translate(SAMPLE_REQUEST, SAMPLE_CONFIG, controller.signal)
    controller.abort()
    await expect(iter.next()).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('流中途 abort → 抛出 AbortError，不 emit error chunk', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"x"}\n\n'))
            // 模拟服务端持续发送但不关闭
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    )
    const p = new OpenAIResponsesProvider({ fetchImpl: fetchMock })
    const iter = p.translate(SAMPLE_REQUEST, SAMPLE_CONFIG, controller.signal)
    // 收到第一 chunk 后立即 abort
    const first = await iter.next()
    expect(first.value?.type).toBe('delta')
    controller.abort()
    await expect(iter.next()).rejects.toThrow()
  })

  it('HTTP 401 → emit error(unauthorized) + 不抛错', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'invalid_api_key', message: 'Invalid API key' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const p = new OpenAIResponsesProvider({ fetchImpl: fetchMock })
    const iter = p.translate(SAMPLE_REQUEST, SAMPLE_CONFIG, controller.signal)
    const first = await iter.next()
    expect(first.value?.type).toBe('error')
    if (first.value?.type === 'error') {
      expect(first.value.code).toBe('unauthorized')
      expect(first.value.retryable).toBe(false)
    }
    // 不抛错（流式契约）
    const second = await iter.next()
    expect(second.done).toBe(true)
  })

  it('HTTP 404 (含 /responses) → emit error(endpoint_not_responses)（OpenRouter / 智谱 / Qwen）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Unknown URL' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const p = new OpenAIResponsesProvider({ fetchImpl: fetchMock })
    const iter = p.translate(SAMPLE_REQUEST, SAMPLE_CONFIG, controller.signal)
    const first = await iter.next()
    expect(first.value?.type).toBe('error')
    if (first.value?.type === 'error') {
      expect(first.value.code).toBe('endpoint_not_responses')
    }
  })

  it('HTTP 429 → emit error(rate_limit, retryable=true)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded' } }), {
        status: 429,
      }),
    )
    const p = new OpenAIResponsesProvider({ fetchImpl: fetchMock })
    const iter = p.translate(SAMPLE_REQUEST, SAMPLE_CONFIG, controller.signal)
    const first = await iter.next()
    expect(first.value?.type).toBe('error')
    if (first.value?.type === 'error') {
      expect(first.value.code).toBe('rate_limit')
      expect(first.value.retryable).toBe(true)
    }
  })

  it('fetch 失败（TypeError）→ emit error(network, retryable=true)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const p = new OpenAIResponsesProvider({ fetchImpl: fetchMock })
    const iter = p.translate(SAMPLE_REQUEST, SAMPLE_CONFIG, controller.signal)
    const first = await iter.next()
    expect(first.value?.type).toBe('error')
    if (first.value?.type === 'error') {
      expect(first.value.code).toBe('network')
      expect(first.value.retryable).toBe(true)
    }
  })
})

// ─────────────────── 缓存键 helper 见 tests/unit/utils/translationCache.test.ts ────────────────────

afterEach(() => {
  vi.restoreAllMocks()
})
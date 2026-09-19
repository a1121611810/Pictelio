// ─── app-lynx 小说翻译：类型 + Provider 抽象 + OpenAI Responses 适配层 ───
// 范围限定在 app-lynx 端（spec docs/specs/app-lynx-novel-translation.md）；
// 不复用 webview 端 createNovelTranslator / translationCache / translationStore
// / TranslateSheet / SettingsTranslate / prompts.ts（map #617 Q1 / Q3）。
//
// 设计依据：
// - spec #618 §4 领域模型（22 决策收敛后的 IR 契约）；
// - ADR-0169（TranslationProvider 无关接口 + chunked pipeline 骨架）；
// - ADR-0170（chunked pipeline 与重试的交付入口，本文件仅放 Provider 层）；
// - research/openai-responses-api.md（Q2 事件序列 + Q4 错误模型 + Q8 字段映射）；
// - research/deepseek-streaming-api.md（DeepSeek Responses 旁证：流式无 `[DONE]`、
//   终止由 event 类型决定；unsupported 字段 silently ignored）。
//
// 关键不变式：
// - 接口形态 = Provider 无关（current 唯一实现 = OpenAIResponsesProvider；seam 已留）。
// - 流式契约 = `AsyncIterator<TranslationChunk>`（spec Q16；Lynx SWC es2015 +
//   Symbol.asyncIterator polyfill 已由 research/lynx-async-iterator-support.md 验证）。
// - API key 全程不在 JS 堆明文（ADR-0037 字节零进 JS 堆；本文件的 fetch 路径仅在
//   web-core dev 预览下透传 Authorization 头以便测试；T7 Java NativeModule 上线后
//   JS 侧永不持有 apiKey 明文——native 路径走 PictelioTranslate.fetchStream）。
// - Azure URL 模板：baseURL 匹配 *.openai.azure.com 时自动补 `/openai/v1` 段
//   + header `api-version: preview`（spec §9.2）。

// ───────────────────────── 类型 ─────────────────────────

/**
 * 用户在设置页填写的 LLM endpoint 配置。
 * 完整 config（含 apiKey）走 SecureStorage（Android Keystore via PictelioTranslate Java 模块）；
 * JS 侧只能拿到「脱敏镜像」`LlmEndpointPublic`，不能拿到明文 API key。
 *
 * @see ADR-0169 D2
 */
// URL 解析唯一入口（ADR-0172 §3：lynx 侧禁用 URL 全局）
import { extractHostname } from '../utils/safeParseUrl'

export interface LlmEndpointConfig {
  /** 形如 "https://api.openai.com/v1"，不含 "/responses" 后缀 */
  baseURL: string
  /** API key 明文；仅在 Java 侧消费，JS 侧永不持有（参考 ADR-0037） */
  apiKey: string
  /** 模型 ID；用户自由填写（gpt-5 / deepseek-v4-pro / 任意 vLLM model 等） */
  model: string
  /** 目标语言 BCP-47，默认 "zh-CN"；影响 prompt 措辞 */
  targetLang?: string
  /** 源语言 BCP-47；留空由 provider / detect 推断，默认 "ja"（Pixiv 小说原文） */
  sourceLang?: string
}

/** 仅给 JS 侧使用的「脱敏展示」镜像（不含 apiKey） */
export interface LlmEndpointPublic {
  baseURL: string
  model: string
  targetLang: string
  /** 源语言 BCP-47（Java 侧默认 "ja"；仅透传，当前不参与请求构造） */
  sourceLang?: string
  /** 用于 UI 的 「key 已配置 ✓ / 未配置 ⚠」 状态 */
  hasKey: boolean
  /** 设置保存时间（毫秒时间戳）；用于设置页排序 */
  updatedAt: number
}

/**
 * 翻译请求 IR。调用方提供 paragraphs 数组（已按章节 split + 段落 split 的纯文本）；
 * provider 内部按 ≤2000 字符切块（ADR-0169 D5 + ADR-0170）。
 *
 * @see ADR-0169 D3
 */
export interface TranslationRequest {
  novelId: number
  /** Pixiv 小说系列内章节 ID；单本小说 = novelId */
  chapterId: string
  /** 纯文本段落（已剥 HTML / 注音 / 行内样式） */
  paragraphs: string[]
  options: {
    /** 章节 R18 等级：0 / 1 / 2；用于应用层闸门（Q22）与 provider 元数据透传（Q13） */
    xRestrict: 0 | 1 | 2
    /** 续翻场景：仅翻译 cache miss 的段落；空数组 = 全量翻译 */
    failedIndices?: number[]
    /** 缓存命中段落：直接由 store 写入 translatedParagraphs，不进入 provider 流 */
    cachedIndices?: number[]
  }
}

/**
 * 流式 chunk。OpenAI Responses API 30+ 事件类型被规约为 5 种 chunk
 * （消费侧只需关心这 5 种，详见 mapEventToChunk 规约表）。
 *
 * @see ADR-0169 D4
 */
export type TranslationChunk =
  | { type: 'delta'; paragraphIndex: number; text: string } // 某段增量文本
  | { type: 'reasoning_delta'; text: string } // reasoning 增量（埋点用，不展示）
  | { type: 'cached'; paragraphs: string[] } // 缓存命中直接给整章
  | { type: 'done'; usage?: TranslationUsage } // 流成功结束
  | { type: 'error'; code: TranslationErrorCode; message: string; retryable: boolean }

export interface TranslationUsage {
  inputTokens: number
  outputTokens: number
  /**
   * 缓存命中 token；OpenAI Responses = `input_tokens_details.cached_tokens`，
   * DeepSeek = `prompt_cache_hit_tokens`（provider 适配层做映射，ADR-0169 D6.3）。
   */
  cachedTokens?: number
}

/**
 * @see ADR-0169 D4 错误码清单；research/openai-responses-api.md §Q4
 */
export type TranslationErrorCode =
  | 'unauthorized' // 401 → API key 无效
  | 'rate_limit' // 429
  | 'insufficient_balance' // 402
  | 'invalid_request' // 400
  | 'model_not_found' // 404 → model 字段错
  | 'endpoint_not_responses' // 404 / 405 → endpoint 不支持 /v1/responses
  | 'server' // 5xx
  | 'network' // fetch failed / DNS / proxy
  | 'content_filter' // finish_reason=content_filter
  | 'aborted' // 用户中断
  | 'unknown'

/**
 * 单章翻译状态机（spec §7；与 webview 端 translationStore 命名刻意区别）。
 * 8 状态包含 2 个「排队态」预留扩展点（背景模式 / 续翻队列）。
 */
export type TranslationStatus =
  | 'idle' // 初始；未开始翻译
  | 'pending' // 任务已派发，provider 未开始
  | 'translating' // 流式进行中（至少收到 1 个 delta）
  | 'translating_queued' // 流内排队事件触发（预留，Responses API 当前不发射）
  | 'partial' // 流中断 / 部分完成（缓存失效 + UI 标 〔部分译文〕）
  | 'failed' // 终态失败（可重试）
  | 'completed' // 终态成功（已写入缓存）
  | 'aborted' // 用户主动中断（与 failed 区分；不计费归因）

/**
 * Provider 接口（ADR-0169 D1）。
 * 消费方：store / novelTranslateStore.action.startTranslate()。
 */
export interface TranslationProvider {
  /** provider 标识，用于 store / 日志 / 缓存键 namespace / telemetry */
  readonly id: string

  /**
   * 发起流式翻译。返回 AsyncIterator，消费方 for-await-of。
   * 失败 / 中断 → iterator.next() 抛 AbortError / TypeError。
   *
   * @param request 翻译请求 IR（含段落 + 元数据）
   * @param config 用户自填 LLM endpoint 配置（apiKey 仅 Java 侧消费，JS 不可见）
   * @param signal AbortSignal（用户切章节 / 关闭详情页触发 abort()）
   */
  translate(
    request: TranslationRequest,
    config: LlmEndpointConfig,
    signal: AbortSignal,
  ): AsyncIterator<TranslationChunk>

  /** 中断在途请求（AbortController 包装层）。abort 后 iterator.next() 抛 AbortError */
  abort(): void
}

// ─────────────────────── Azure URL 处理 ───────────────────────

/**
 * 检测 baseURL 是否为 Azure OpenAI 形态（含/不含 `/openai/v1` 段都视为 Azure）。
 * 精确 hostname 后缀匹配（防伪后缀域）。
 */
export function isAzureBaseURL(baseURL: string): boolean {
  // 经 safeParseUrl 收口（lynx 新代码 URL 解析唯一入口，ADR-0172 §3）：
  // lynx 运行时 URL 全局不 throw 但 .hostname 为 undefined（ADR-0163 取证），
  // 裸用 new URL 会把所有 Azure endpoint 静默判成非 Azure（漏补 /openai/v1 与 api-version）。
  const host = extractHostname(baseURL)
  return host !== null && host.toLowerCase().endsWith('.openai.azure.com')
}

/**
 * Azure baseURL 归一化：自动补齐 `/openai/v1` 段（如果用户漏写）。
 * 非 Azure 形态原样返回。
 *
 * 例：`https://my-r.openai.azure.com` → `https://my-r.openai.azure.com/openai/v1`
 *
 * @see spec §9.2
 */
export function normalizeAzureBaseURL(baseURL: string): string {
  if (!isAzureBaseURL(baseURL)) return baseURL
  // 已含 /openai/v1 段 → 原样
  if (/\/openai\/v1\/?$/i.test(baseURL)) return baseURL
  // 末尾斜杠归一
  const trimmed = baseURL.replace(/\/+$/u, '')
  return `${trimmed}/openai/v1`
}

// ─────────────────── Responses API 请求体 ───────────────────

/**
 * OpenAI Responses API 请求体（最小子集；spec §9.4 + ADR-0169 D6.1）。
 * 字段命名 = OpenAI 官方 API（research/openai-responses-api.md §Q1）。
 */
export interface ResponsesRequest {
  model: string
  /** 顶层 system 指令（spec §9.4：prefix 稳定 → 命中 prompt cache） */
  instructions: string
  input: Array<{ role: 'user'; content: string }>
  stream: true
  max_output_tokens: number
  reasoning?: { effort: 'minimal' | 'low' | 'medium' | 'high' }
}

/**
 * 构造 Responses API 请求体（spec §9.4 + ADR-0169 D6.1）。
 *
 * - 系统指令放最前（prefix 稳定 → GPT-5.6+ prompt cache ≥1024 visible tokens 命中）；
 * - 段落以 `[N]` 前缀锚定，便于模型按行对齐输出；
 * - 不发 previous_response_id / conversation / store / background（DeepSeek unsupported，
 *   silently ignored；OpenAI Responses 端也用不到——翻译无状态）；
 * - 不发 tools / tool_choice（翻译场景未启用）；
 * - `reasoning.effort = "minimal"`：reasoning 计费最低 + Reasoning Delta 仍可被
 *   provider 收到用于埋点。
 *
 * @returns 含归一化 baseURL + headers + body 的 fetch 初始化参数（不含 Authorization，
 *   Authorization 在 Native bridge 内部组装，web-core dev 预览由调用方注入）。
 */
export function buildResponsesRequestBody(
  request: TranslationRequest,
  config: LlmEndpointConfig,
): { url: string; headers: Record<string, string>; body: ResponsesRequest } {
  const instructions = buildSystemInstructions(config)
  const inputText = request.paragraphs
    .map((p, i) => `[${i}] ${p}`)
    .join('\n\n')

  const body: ResponsesRequest = {
    model: config.model,
    instructions,
    input: [{ role: 'user', content: inputText }],
    stream: true,
    max_output_tokens: estimateMaxOutput(request.paragraphs),
    reasoning: { effort: 'minimal' },
  }

  const url = `${normalizeAzureBaseURL(config.baseURL).replace(/\/+$/u, '')}/responses`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (isAzureBaseURL(config.baseURL)) {
    // Azure：api-version 走 header（不是 query string，spec §9.2）
    headers['api-version'] = 'preview'
  }

  return { url, headers, body }
}

/**
 * 构造系统指令（prefix 稳定 → 命中 prompt cache）。
 * 顺序：source lang 声明 → target lang 声明 → 翻译风格约束 → 段落对齐锚定说明。
 *
 * 严禁随意调整字段顺序 / 措辞——会破坏 prefix byte-equal 命中（research/openai-responses-api.md §Q8.3）。
 */
export function buildSystemInstructions(config: LlmEndpointConfig): string {
  const target = config.targetLang ?? 'zh-CN'
  const source = config.sourceLang ?? 'ja'
  return [
    `You are a professional novel translator. Translate from ${source} to ${target}.`,
    'Preserve paragraph order. Each input paragraph is prefixed with `[N]`; output the translated paragraph on its own line, also prefixed with `[N]`.',
    'Use a single blank line between paragraphs. Do not merge or split paragraphs.',
    'Do not add commentary, footnotes, or markdown.',
    'Preserve character names and proper nouns; use natural idiomatic target language.',
  ].join('\n')
}

/**
 * 估算 max_output_tokens。
 * 经验值：日文小说译文长度 ≤ 原文 1.5-2x；公式 = ceil(input chars / 2) * 2 + 512
 * （粗略按 1 token ≈ 2 chars 估算；留 reasoning 余量）。
 *
 * 不追求精确——超出会触发 `response.incomplete`（max_output_tokens），store 层面
 * 视作可重试或拆分。
 */
export function estimateMaxOutput(paragraphs: string[]): number {
  const totalChars = paragraphs.reduce((acc, p) => acc + p.length, 0)
  const estimated = Math.ceil(totalChars / 2) * 2 + 512
  // clamp 1..16384（OpenAI Responses 允许上限 = 16384；GPT-5.x 文档示例 2048）。
  return Math.max(256, Math.min(16384, estimated))
}

// ────────────────────── 事件映射（30+ → 5） ──────────────────────

/**
 * Responses API 事件原生形态（最小子集）。
 * 仅含本实现关心的字段；其他字段（如 `response.output_item.*` / `response.content_part.*`）
 * 由 mapEventToChunk 透传忽略。
 */
interface ResponsesEventBase {
  type: string
  // delta 事件
  delta?: string
  item_id?: string
  output_index?: number
  content_index?: number
  // refusal 事件
  refusal?: string
  // 终止事件携带 response snapshot
  response?: {
    status?: 'completed' | 'failed' | 'incomplete' | 'in_progress' | 'queued' | 'cancelled'
    incomplete_details?: { reason?: 'max_output_tokens' | 'max_messages' | 'content_filter' | 'steered' }
    error?: { code?: string; message?: string; type?: string }
    usage?: {
      input_tokens?: number
      output_tokens?: number
      total_tokens?: number
      input_tokens_details?: {
        cached_tokens?: number
        cache_write_tokens?: number
      }
      output_tokens_details?: {
        reasoning_tokens?: number
      }
    }
  }
  // 裸 error 事件
  code?: string
  message?: string
}

/**
 * 30+ Responses API 事件 → 5 种 TranslationChunk 规约表（ADR-0169 D6.2）。
 *
 * 关键映射：
 * - `response.created` → 不 emit（仅 generation-gate chapterId 注入用；store 层面在
 *   provider.translate() 调用时已闭包 chapterId，无需额外 chunk metadata）；
 * - `response.output_text.delta` → `{ type: 'delta' }`（主消费事件）；
 * - `response.reasoning_text.delta` / `response.reasoning_summary_text.delta`
 *   → `{ type: 'reasoning_delta' }`（埋点用，不展示）；
 * - `response.refusal.delta/done` → `{ type: 'error', code: 'content_filter' }`；
 * - `response.completed` → `{ type: 'done', usage: mapUsage() }`；
 * - `response.failed` → `{ type: 'error', code: mapErrorCode() }`；
 * - `response.incomplete` → 由 `incomplete_details.reason` 决定 → `done` 或 `error`；
 * - 裸 `error` 事件 → `{ type: 'error', code: 'server', retryable: true }`。
 *
 * DeepSeek Responses 兼容性：DeepSeek 与 OpenAI Responses 同事件序列、同事件类型
 * （research/openai-responses-api.md §DeepSeek Compat Reference）；DeepSeek 端无
 * `[DONE]` 哨兵、按 event 类型终止——本规约天然兼容，无需额外 fallback。
 */
export function mapEventToChunk(event: ResponsesEventBase): TranslationChunk | null {
  const type = event.type

  // 主消费：output_text.delta
  if (type === 'response.output_text.delta') {
    const text = event.delta ?? ''
    // paragraphIndex 从 `[N]` 锚定前缀解析：delta 形态上不一定含 `[N]`（增量可能跨段），
    // 但模型按 spec 提示按行对齐；典型实现 = provider 内部在切块完成后注入锚定。
    // 本 primitive 层不解析锚定（chunked pipeline 在 `createNovelTranslator` 注入）；
    // 此处给 paragraphIndex = 0（占位），上层 consumer 须用 chunk.metadata 替换。
    return { type: 'delta', paragraphIndex: 0, text }
  }

  // Reasoning 增量（埋点用，不展示）
  if (type === 'response.reasoning_text.delta' || type === 'response.reasoning_summary_text.delta') {
    return { type: 'reasoning_delta', text: event.delta ?? '' }
  }

  // 模型拒答
  if (type === 'response.refusal.delta' || type === 'response.refusal.done') {
    return {
      type: 'error',
      code: 'content_filter',
      message: event.refusal ?? 'model refused',
      retryable: false,
    }
  }

  // 流终止：completed
  if (type === 'response.completed') {
    return { type: 'done', usage: mapUsage(event.response?.usage) }
  }

  // 流终止：failed
  if (type === 'response.failed') {
    const err = event.response?.error
    return {
      type: 'error',
      code: mapErrorCode(err?.code, err?.message),
      message: err?.message ?? 'response failed',
      retryable: false,
    }
  }

  // 流终止：incomplete（截断，非错误；语义由 incomplete_details.reason 决定）
  if (type === 'response.incomplete') {
    const reason = event.response?.incomplete_details?.reason
    if (reason === 'content_filter') {
      return {
        type: 'error',
        code: 'content_filter',
        message: `model refused (${reason})`,
        retryable: false,
      }
    }
    // max_output_tokens / max_messages / steered → 视为可重试（store 决策）
    return {
      type: 'error',
      code: reason === 'max_messages' ? 'invalid_request' : 'invalid_request',
      message: `stream truncated: ${reason ?? 'unknown'}`,
      retryable: reason === 'max_output_tokens' || reason === 'max_messages',
    }
  }

  // 裸 error 事件（连接级错误：超时 / proxy / 服务端崩溃）
  if (type === 'error') {
    return {
      type: 'error',
      code: 'server',
      message: event.message ?? 'connection error',
      retryable: true,
    }
  }

  // 其他事件（response.output_item.* / response.content_part.* /
  // response.output_text.done / response.in_progress / response.created 等）→ 吞掉
  return null
}

/**
 * usage 字段映射（ADR-0169 D6.3；research/openai-responses-api.md §Q8）。
 * DeepSeek 路径下 `cachedTokens` 也由 OpenAI Responses 命名走（research §DeepSeek
 * Compat Reference §Q8：DeepSeek 在 Responses 端点已统一 OpenAI Responses 命名）。
 */
export function mapUsage(
  usage:
    | {
        input_tokens?: number
        output_tokens?: number
        total_tokens?: number
        input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number }
        output_tokens_details?: { reasoning_tokens?: number }
      }
    | undefined,
): TranslationUsage | undefined {
  if (!usage) return undefined
  const result: TranslationUsage = {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
  }
  if (usage.input_tokens_details?.cached_tokens !== undefined) {
    result.cachedTokens = usage.input_tokens_details.cached_tokens
  }
  return result
}

/**
 * Responses API error.code → TranslationErrorCode 映射（research §Q4.1）。
 */
function mapErrorCode(code: string | undefined, message: string | undefined): TranslationErrorCode {
  if (!code) return 'unknown'
  if (code === 'invalid_api_key' || code === 'invalid_request_error') {
    // 区分 401 vs 400：消息包含 'api key' / 'unauthorized' 视为认证
    if (typeof message === 'string' && /api key|unauthorized/i.test(message)) return 'unauthorized'
    return 'invalid_request'
  }
  if (code === 'rate_limit_exceeded' || code === 'slow_down') return 'rate_limit'
  if (code === 'insufficient_quota' || code === 'insufficient_balance') return 'insufficient_balance'
  if (code === 'model_not_found' || code === 'engine_not_found') return 'model_not_found'
  if (code === 'server_error' || code === 'server_is_overloaded') return 'server'
  return 'unknown'
}

// ──────────────────────── SSE 帧解析 ────────────────────────

/**
 * SSE 帧解析器：把 ReadableStream<Uint8Array> 解析为 `data:` JSON 事件流。
 *
 * 帧格式：`data: {json}\n\n`；每帧以空行分隔。
 * 终止信号：OpenAI Responses / DeepSeek Responses 端均**无** `[DONE]` 哨兵——
 * 流结束由 `response.completed/incomplete/failed` 事件决定（HTTP 连接关闭）。
 * ChatCompletions 形态的 `[DONE]` 哨兵为兼容保留（视为流终止）。
 *
 * 错误处理：
 * - fetch failed / DNS / proxy → 由 caller 抛 TypeError（已 AbortError 检查前置）；
 * - 单帧 JSON 解析失败 → 跳过（不抛错）；provider 层应容忍非 JSON keep-alive 行
 *   （以 `:` 开头的 SSE 注释行）。
 *
 * @param stream SSE ReadableStream（fetch response.body）
 * @param signal AbortSignal（用户中断）
 * @returns AsyncIterable<ResponsesEventBase>
 */
export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<ResponsesEventBase> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const abortHandler = (): void => {
    void reader.cancel().catch(() => undefined)
  }
  if (signal.aborted) {
    void reader.cancel().catch(() => undefined)
  } else {
    signal.addEventListener('abort', abortHandler, { once: true })
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // 按 \n\n 拆帧；保留 buffer 末尾可能不完整的半帧
      let frameEnd = buffer.indexOf('\n\n')
      while (frameEnd !== -1) {
        const frame = buffer.slice(0, frameEnd)
        buffer = buffer.slice(frameEnd + 2)
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload) continue
          if (payload === '[DONE]') {
            // ChatCompletions 兼容：视为流终止（Responses API 不会发）
            return
          }
          try {
            const event = JSON.parse(payload) as ResponsesEventBase
            yield event
          } catch {
            // 非 JSON 帧跳过（keep-alive 注释 / 噪声行）
          }
        }
        frameEnd = buffer.indexOf('\n\n')
      }
    }
    // 收尾：处理 buffer 末尾残留（部分帧）
    if (buffer.trim()) {
      for (const line of buffer.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const event = JSON.parse(payload) as ResponsesEventBase
          yield event
        } catch {
          /* skip */
        }
      }
    }
  } finally {
    signal.removeEventListener('abort', abortHandler)
    try {
      reader.releaseLock()
    } catch {
      /* reader already released */
    }
  }
}

// ───────────────────── OpenAIResponsesProvider ─────────────────────

/**
 * Provider 构造选项：分离 fetch 实现便于测试注入（happy-dom / node test）。
 */
export interface OpenAIResponsesProviderOptions {
  /** 自定义 fetch 实现；默认 = globalThis.fetch（fetchWrapper 注入） */
  fetchImpl?: typeof fetch
}

/**
 * OpenAI Responses API provider 实现（ADR-0169 D6 + ADR-0169 D7）。
 *
 * 唯一职责 = 把 Responses API 的 30+ 事件类型规约为 TranslationChunk 五种类型。
 * 网络请求：
 * - web-core dev 预览：直接 fetch + Authorization Bearer（仅 dev 调试用，T7 上线后
 *   Native 路径优先）；
 * - 原生 LynxView（future）：PictelioTranslate.fetchStream NativeModule 转发 Java，
 *   apiKey 仅 Java 堆组装（ADR-0169 D6 Native 路径——本版本未实现，
 *   仅留 seam）。
 */
export class OpenAIResponsesProvider implements TranslationProvider {
  readonly id = 'openai-responses'

  private abortController: AbortController | null = null
  private readonly fetchImpl: typeof fetch

  constructor(options: OpenAIResponsesProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch ?? fetch
  }

  /**
   * 发起流式翻译。返回 AsyncIterator<TranslationChunk>。
   * 失败 / 中断 → iterator.next() 抛 AbortError / TypeError。
   */
  translate(
    request: TranslationRequest,
    config: LlmEndpointConfig,
    signal: AbortSignal,
  ): AsyncIterator<TranslationChunk> {
    // 已 abort：返回立即抛 AbortError 的 iterator（不触发 fetch，AGENTS.md 硬约束）
    if (signal.aborted) {
      return makeAbortedIterator()
    }
    // 闭包持有 abort 链路：caller 的 signal → provider 内部 controller → fetch
    const innerController = new AbortController()
    this.abortController = innerController
    const onOuterAbort = (): void => innerController.abort()
    signal.addEventListener('abort', onOuterAbort, { once: true })

    const iterator = this.streamChunks(request, config, innerController.signal, signal, onOuterAbort)
    return iterator
  }

  abort(): void {
    this.abortController?.abort()
  }

  private async *streamChunks(
    request: TranslationRequest,
    config: LlmEndpointConfig,
    innerSignal: AbortSignal,
    outerSignal: AbortSignal,
    onOuterAbort: () => void,
  ): AsyncIterator<TranslationChunk> {
    // 防御性兜底：进入 generator 时再 check 一次（caller 可能在调用 iter.next() 前 abort）
    if (outerSignal.aborted) {
      outerSignal.removeEventListener('abort', onOuterAbort)
      throw new DOMException('aborted', 'AbortError')
    }
    const { url, headers, body } = buildResponsesRequestBody(request, config)
    // Authorization 头：web-core dev 路径明文注入；native 路径由 PictelioTranslate
    // Java NativeModule 内部组装（apiKey 字节零进 JS 堆）。
    const reqHeaders: Record<string, string> = { ...headers, Authorization: `Bearer ${config.apiKey}` }

    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(body),
        signal: innerSignal,
      })
    } catch (err) {
      outerSignal.removeEventListener('abort', onOuterAbort)
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 用户中断：不抛 error chunk（store 通过 status='aborted' 感知，spec §7.2）
        throw err
      }
      // 网络错（fetch failed / DNS / proxy）→ emit error chunk
      yield {
        type: 'error',
        code: 'network',
        message: err instanceof Error ? err.message : 'network error',
        retryable: true,
      }
      return
    }

    if (!response.ok) {
      outerSignal.removeEventListener('abort', onOuterAbort)
      // HTTP 4xx/5xx 同步错误：流未启动 → emit error chunk + 解析 body error.code
      const status = response.status
      let code: string | undefined
      let message: string | undefined
      try {
        const errBody = (await response.json()) as {
          error?: { code?: string; message?: string; type?: string }
        } | null
        code = errBody?.error?.code ?? errBody?.error?.type
        message = errBody?.error?.message
      } catch {
        /* not JSON */
      }
      const finalMessage = message ?? `HTTP ${status}`
      let errorCode: TranslationErrorCode
      if (status === 401) errorCode = 'unauthorized'
      else if (status === 402) errorCode = 'insufficient_balance'
      else if (status === 404) {
        // 404：可能是 model 错也可能是 endpoint 不支持 /v1/responses（OpenRouter / 智谱 / Qwen）
        // 区分：URL path 含 /responses + 4xx → 倾向 endpoint_not_responses
        if (url.includes('/responses')) errorCode = 'endpoint_not_responses'
        else errorCode = 'model_not_found'
      } else if (status === 405) errorCode = 'endpoint_not_responses'
      else if (status === 400) errorCode = mapErrorCode(code, message)
      else if (status === 429) errorCode = 'rate_limit'
      else if (status >= 500) errorCode = 'server'
      else errorCode = 'unknown'

      yield {
        type: 'error',
        code: errorCode,
        message: finalMessage,
        retryable: errorCode === 'server' || errorCode === 'rate_limit' || errorCode === 'network',
      }
      return
    }

    if (!response.body) {
      outerSignal.removeEventListener('abort', onOuterAbort)
      yield {
        type: 'error',
        code: 'unknown',
        message: 'response body is null',
        retryable: false,
      }
      return
    }

    try {
      for await (const event of parseSSE(response.body, innerSignal)) {
        if (outerSignal.aborted) {
          throw new DOMException('aborted', 'AbortError')
        }
        const chunk = mapEventToChunk(event)
        if (chunk !== null) yield chunk
      }
    } finally {
      outerSignal.removeEventListener('abort', onOuterAbort)
    }
    // 流自然结束后再 check：上游 stream 未关闭但 caller 已 abort（happy-dom / node 行为差异）
    if (outerSignal.aborted) {
      throw new DOMException('aborted', 'AbortError')
    }
  }
}

// ─────────────────────── Provider 工厂 ───────────────────────

/**
 * 工厂函数（ADR-0169 D1 + ADR-0170 seam）。
 * 默认实现 = OpenAIResponsesProvider；inject deps 便于测试。
 *
 * @see createNovelTranslator 注入点（primitives 层 Provider 解耦）
 */
export interface OpenAIResponsesProviderFactoryOptions extends OpenAIResponsesProviderOptions {
  /** 自定义 Provider 实现（用于测试桩；默认 OpenAIResponsesProvider） */
  provider?: TranslationProvider
}

/**
 * 工厂：构造 OpenAI Responses provider（默认）。
 * 若 `translator` 字段被显式注入，则返回注入的实例——便于 chunked pipeline 测试。
 */
export function openaiResponsesProvider(
  options: OpenAIResponsesProviderFactoryOptions = {},
): TranslationProvider {
  if (options.provider) return options.provider
  return new OpenAIResponsesProvider(options)
}

/**
 * 立即抛 AbortError 的 AsyncIterator（用于 caller signal 已 aborted 的场景）。
 * 避免触发 fetch / 网络 IO（AGENTS.md 硬约束 #1：IO 边界成功 + 失败双路径）。
 */
function makeAbortedIterator(): AsyncIterator<TranslationChunk> {
  const err = new DOMException('aborted', 'AbortError')
  const iter: AsyncIterator<TranslationChunk> = {
    next(): Promise<IteratorResult<TranslationChunk>> {
      return Promise.reject(err)
    },
  }
  // Symbol.asyncIterator self-reference：让 for-await-of 找到正确的迭代器
  ;(iter as unknown as { [Symbol.asyncIterator]: () => AsyncIterator<TranslationChunk> })[
    Symbol.asyncIterator
  ] = () => iter
  return iter
}
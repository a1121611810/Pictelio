// ─── app-lynx 小说翻译 chunked pipeline primitive ───
// 范围：仅做分块 + 并发池 + 对齐规则 + AbortSignal 静默退出。
// Provider 解耦：deps.provider 注入，便于测试桩（spec Q4 + ADR-0169 D5）。
//
// 与 webview 端 packages/app/src/primitives/createNovelTranslator.ts 的关系：
// **抽象边界参考**，**不复用代码**（map #617 Q1 + Q3 收敛「完全从零」）。
// 设计差异（与 webview 端）：
// - 接口返回 `Promise<{ status, paragraphs }>`，status 沿用 8 状态枚举；
// - chunked pipeline 在 chunk 完成后 emit `delta` chunk（按段落增量），由 caller
//   store 写入 translatedParagraphs；webview 端是 onProgress 回调。
// - 失败块静默回退原文（不写 chunk，让 consumer 自行 fallback）；
// - abort 后不 emit 任何 chunk（store 通过 status='aborted' 感知，spec §7.2）。
//
// 实现要点（ADR-0169 D5 + ADR-0170）：
// - chunkParagraphs：按段落边界切块（≤2000 字符），不拆段；
// - runChunkPool：Promise 池（≤3 并发）；队列完成后返回；
// - alignParagraphs：空行拆段 + 数量对齐 + 末段回退原文；
// - AbortSignal：abort 触发即跳出循环，不再 emit 任何 chunk。
import type {
  LlmEndpointConfig,
  TranslationProvider,
  TranslationRequest,
  TranslationChunk,
  TranslationStatus,
} from '../api/translate'

// ─── 切块 ───

/**
 * chunk 区间（沿段落边界，不拆段）。
 * start 含 / end 不含；与 webview 端 `ChunkRange` 语义一致。
 */
export interface ChunkRange {
  start: number
  end: number
}

/**
 * 按段落边界切块：每块 ≤maxChars 字符（含段落间 `\n\n` 分隔符），不拆段落。
 * 超长单段自成一块（允许该块超限——避免零字符块）。
 *
 * @param paragraphs 原文段落数组
 * @param maxChars 单块最大字符数（默认 2000；ADR-0169 D5.1）
 */
export function chunkParagraphs(paragraphs: string[], maxChars = 2000): ChunkRange[] {
  if (paragraphs.length === 0) return []
  const chunks: ChunkRange[] = []
  let start = 0
  let acc = 0
  for (let i = 0; i < paragraphs.length; i++) {
    const len = paragraphs[i].length + (i > start ? 2 : 0) // +2 = '\n\n' 段落分隔
    if (i > start && acc + len > maxChars) {
      chunks.push({ start, end: i })
      start = i
      acc = paragraphs[i].length
    } else {
      acc += len
    }
  }
  if (start < paragraphs.length) {
    chunks.push({ start, end: paragraphs.length })
  }
  // 过滤空块（防御性兜底；正常不会触发）
  return chunks.filter((c) => c.end > c.start)
}

// ─── 对齐 ───

/**
 * 段落对齐元信息（spec §7.2 + AGENTS.md 测试硬约束 #3 禁静默降级）。
 *
 * `fallbackCount > 0` 视为契约破坏：模型输出段数不足原文（spec Q14）。
 * 上层 cache 写入决策：`fallbackCount === 0` → 可写缓存；`> 0` → 永不写（半成品）。
 */
export interface AlignResult {
  paragraphs: string[]
  fallbackCount: number
  /** 译文段数 > 原文（截断多余段；同样视为契约破坏） */
  overflowCount: number
}

/**
 * 译文段落对齐：模型输出按空行拆段后与原文段落数对齐。
 *
 * 数量不符策略（AGENTS.md 测试硬约束 #3 禁静默降级 + 必须 warn）：
 * - 译文段数 < 原文：不足段回退原文（末段连续填充）；
 * - 译文段数 > 原文：截断多余段。
 *
 * 锚定前缀剥离：模型按 spec 提示以 `[N] ` 锚定输出，alignParagraphs 自动剥离锚定
 * （这是对齐职责的一部分 —— caller 拿到的是 `original.length` 个无锚定段落）。
 *
 * @param translated 模型输出文本（按 `\n\n+` 拆段）
 * @param original 原文段落数组
 */
export function alignParagraphs(translated: string, original: string[]): AlignResult {
  const rawParts = translated
    .split(/\n\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  // 剥离每段前缀 `[N] `（spec §9.4 锚定约定）
  const parts = rawParts.map(stripAnchorPrefix)
  let fallbackCount = 0
  let overflowCount = 0
  if (parts.length < original.length) {
    fallbackCount = original.length - parts.length
    console.warn(
      `[createNovelTranslator] translated paragraph count (${parts.length}) < original (${original.length}); falling back last ${fallbackCount} to original`,
    )
  } else if (parts.length > original.length) {
    overflowCount = parts.length - original.length
    console.warn(
      `[createNovelTranslator] translated paragraph count (${parts.length}) > original (${original.length}); truncating ${overflowCount} extra segments`,
    )
  }
  const paragraphs: string[] = []
  for (let i = 0; i < original.length; i++) {
    paragraphs.push(i < parts.length ? parts[i] : original[i])
  }
  return { paragraphs, fallbackCount, overflowCount }
}

/**
 * 剥离段落文本开头的 `[N] ` 锚定前缀。
 * - `[0] 你好` → `你好`
 * - `[12] Hello` → `Hello`
 * - 无锚定文本 → 原样返回
 * - `[abc] 中文`（非数字）→ 原样返回（不算有效锚定；spec §9.4 锚定为数字）
 */
function stripAnchorPrefix(s: string): string {
  const m = /^\[(\d+)\]\s*/u.exec(s)
  if (m) return s.slice(m[0].length).trim()
  return s
}

// ─── chunk 解析：流式 delta → 完整段落译文 ───

/**
 * 把流式 `delta` chunks 累积为段落译文（按 `[N]` 锚定拆分）。
 * provider 返回的 delta 形态：模型按 `[N]` 锚定逐段输出；本函数把累积 delta
 * 按 `[N]` 前缀切段、写入对应 paragraphIndex。
 *
 * 非流式场景（provider 直接返回 `done` 而无 delta）：调用方用 alignParagraphs。
 */
export interface ParsedChunkEvent {
  paragraphIndex: number
  /** 当前段落累积的完整译文（增量更新） */
  text: string
}

/**
 * 把累积的 delta 字符串按 `[N]` 锚定拆为段落；返回更新后的 paragraphIndex → text map。
 *
 * @param accumulated delta 字符串（流式累积至今）
 * @param state 当前段落 map；首次调用传空对象
 * @returns 更新后的 map + 未消费的尾巴（不含完整段锚定的部分）
 */
export function parseAnchorDeltas(
  accumulated: string,
  state: Record<number, string>,
): { state: Record<number, string>; tail: string } {
  // 寻找下一个 `[N]` 锚定；从 tail 起始位置向后
  // 简化：每次扫描 `[(\d+)\]` 锚定，把对应段落追加到 state[i]
  const anchorRegex = /\[(\d+)\][^\[]*/gu
  let lastIndex = 0
  let match: RegExpExecArray | null
  const next: Record<number, string> = { ...state }
  while ((match = anchorRegex.exec(accumulated)) !== null) {
    const idx = Number(match[1])
    if (Number.isNaN(idx)) continue
    const segment = match[0].slice(match[1].length + 2).trim() // 去掉 `[N]` 前缀
    next[idx] = (next[idx] ?? '') + (next[idx] ? '\n\n' : '') + segment
    lastIndex = match.index + match[0].length
  }
  const tail = accumulated.slice(lastIndex)
  return { state: next, tail }
}

// ─── chunk 并发池 ───

/**
 * Promise 池：固定 worker 数，各自从 chunks 数组取块执行。
 * 任一 in-flight 完成后 worker 取下一块；所有块完成后全部 worker 退出。
 *
 * 单块失败策略（非用户中断）：
 * - 可重试错误 → 自动重试（≤maxRetries 次，指数退避）；
 * - 不可重试 / 重试上限 → 该块标记失败、返回 null（不阻塞其他块）；
 * - 用户中断（signal.aborted）→ 所有 worker 静默退出、不返回失败块。
 *
 * @param chunks 块区间数组
 * @param fetch 单块执行函数
 * @param concurrency 并发路数（默认 3，ADR-0169 D5.2）
 * @param signal AbortSignal
 * @param maxRetries 单块最大重试次数（默认 0 = 不重试；store 层做整批回退）
 */
export async function runChunkPool<T>(
  chunks: ChunkRange[],
  fetch: (range: ChunkRange) => Promise<T>,
  concurrency: number,
  signal: AbortSignal,
  maxRetries = 0,
): Promise<Array<T | null>> {
  if (chunks.length === 0) return []
  const results: Array<T | null> = new Array(chunks.length).fill(null)
  let cursor = 0

  const workers = Array.from(
    { length: Math.min(concurrency, chunks.length) },
    async () => {
      while (true) {
        if (signal.aborted) return
        const idx = cursor++
        if (idx >= chunks.length) return
        const range = chunks[idx]
        let lastErr: unknown = null
        let success = false
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (signal.aborted) return
          try {
            results[idx] = await fetch(range)
            success = true
            break
          } catch (err) {
            lastErr = err
            if (err instanceof DOMException && err.name === 'AbortError') return
            if (attempt >= maxRetries) break
            // 简化：固定 500ms 退避；与 webview 端 retryDelayMs 等价但简化为不依赖外部 import
            await sleep(500 * 2 ** attempt, signal)
          }
        }
        if (!success && !signal.aborted) {
          // 失败块 = null（caller 视为回退原文）
          console.warn('[createNovelTranslator] chunk failed', { chunkIndex: idx, err: lastErr })
          results[idx] = null
        }
      }
    },
  )
  await Promise.all(workers)
  return results
}

/**
 * Promise + AbortSignal 的 sleep。
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// ─── 单块 provider 执行：消费 AsyncIterator 收集段落译文 ───

/**
 * 把 provider.translate() 返回的 AsyncIterator<TranslationChunk> 消费为段落译文数组。
 *
 * 行为：
 * - 累积 `delta` chunk 的 text（按 `[N]` 锚定拼接）；
 * - 首个 `delta` 到达后 provider.translating 生效；
 * - `cached` chunk → 直接采用 as cur return（缓存命中短路）；
 * - `done` chunk → 终止迭代；返回累积段落译文（若有任何 delta）；
 * - `error` chunk → 抛 TranslationError（caller 决定 retry / 整批回退）；
 * - 用户中断（signal.aborted）→ 抛 AbortError，caller 静默退出。
 *
 * 回调：`onChunk`（可选）— 每收到 provider chunk 时转发给 caller（含 delta / cached
 * / done / error / reasoning_delta），caller store 据此更新 translatedParagraphs
 * （spec §7.2 状态机转移）。AbortSignal 触发后不再 emit 任何 chunk。
 *
 * @returns 与 range 等长的段落译文数组（数量对齐由 alignParagraphs 收尾）
 */
export async function fetchChunkViaProvider(
  range: ChunkRange,
  paragraphs: string[],
  provider: TranslationProvider,
  request: TranslationRequest,
  config: LlmEndpointConfig,
  signal: AbortSignal,
  onChunk?: (chunk: TranslationChunk) => void,
): Promise<string[]> {
  const iter = provider.translate(request, config, signal)
  const deltas: string[] = []
  let cachedParagraphs: string[] | null = null
  let doneUsage: unknown = undefined

  try {
    while (true) {
      const { value, done } = await iter.next()
      if (done) break
      const chunk = value as TranslationChunk
      onChunk?.(chunk)
      switch (chunk.type) {
        case 'delta':
          deltas.push(chunk.text)
          break
        case 'reasoning_delta':
          // 埋点：不展示；保留 telemetry 通道（implement 阶段接入）
          break
        case 'cached':
          cachedParagraphs = chunk.paragraphs
          break
        case 'done':
          doneUsage = chunk.usage
          break
        case 'error':
          throw new TranslationChunkError(chunk.code, chunk.message, chunk.retryable)
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    if (err instanceof TranslationChunkError) throw err
    // 其他未预期错误 → 包为 unknown
    throw new TranslationChunkError(
      'unknown',
      err instanceof Error ? err.message : 'unknown error',
      true,
    )
  }

  if (cachedParagraphs !== null) {
    // 缓存命中：直接采用 + 对齐（防御性，确保数量匹配）
    const aligned = alignParagraphs(cachedParagraphs.join('\n\n'), paragraphs)
    return aligned.paragraphs
  }

  if (deltas.length === 0) {
    // 流结束但无任何 delta + 无 cached → 视为失败
    throw new TranslationChunkError('unknown', 'no chunks emitted', false)
  }

  const joined = deltas.join('')
  const aligned = alignParagraphs(joined, paragraphs)
  // 注：fallbackCount > 0 时 caller 据此决定是否缓存写；本 primitive 不决定缓存策略
  return aligned.paragraphs
}

/**
 * Provider 流式消费期间的 error chunk 异常包装（区分 abort / network / content_filter 等）。
 */
export class TranslationChunkError extends Error {
  readonly code: import('../api/translate').TranslationErrorCode
  readonly retryable: boolean

  constructor(
    code: import('../api/translate').TranslationErrorCode,
    message: string,
    retryable: boolean,
  ) {
    super(message)
    this.name = 'TranslationChunkError'
    this.code = code
    this.retryable = retryable
  }
}

// ─── 主入口：createNovelTranslator ───

export interface CreateNovelTranslatorOptions {
  /**
   * 注入 Provider（默认 = OpenAIResponsesProvider；测试桩可注入 mock）。
   * deps 解耦：primitives 层不依赖 fetch / NativeModule。
   */
  provider?: TranslationProvider
  /** 单块最大字符数（默认 2000，ADR-0169 D5.1） */
  maxChunkChars?: number
  /** 并发路数（默认 3，ADR-0169 D5.2） */
  concurrency?: number
  /** 单块最大重试次数（默认 0；store 层做整批回退） */
  maxRetries?: number
}

export interface NovelTranslatorHandle {
  /**
   * 发起翻译。返回 `Promise<{ status, paragraphs }>`。
   *
   * status 语义（spec §7）：
   * - 'completed'：所有块成功（aligned paragraphs 数量 = 原文；fallbackCount = 0）
   * - 'partial'：至少一块失败；返回的 paragraphs 失败块位置回退原文（fallbackCount > 0）
   * - 'aborted'：用户中断（signal.aborted）；paragraphs = 已成功块的译文（部分或空）
   * - 'failed'：全部块失败；paragraphs = 全部回退原文
   *
   * cache 写决策由 caller 决定：本 primitive 不写缓存（layered 边界）。
   */
  translate(
    request: TranslationRequest,
    config: LlmEndpointConfig,
    signal: AbortSignal,
    onChunk?: (chunk: TranslationChunk) => void,
  ): Promise<{ status: TranslationStatus; paragraphs: string[] }>
}

/**
 * 创建 chunked pipeline 翻译器 primitive。
 *
 * 内部算法（ADR-0169 D5）：
 * 1. chunkParagraphs：按 ≤maxChars 切块（段落边界不拆段）；
 * 2. runChunkPool：≤concurrency 并发执行 fetchChunkViaProvider；
 * 3. fetchChunkViaProvider：消费 AsyncIterator，累积 delta chunks，alignParagraphs 对齐；
 * 4. 合并所有块结果 → status 判定。
 *
 * AbortSignal 行为（ADR-0169 D5.4）：
 * - abort 触发 → provider.abort() + worker 静默退出（不抛错、不 emit error chunk）；
 * - 返回 status = 'aborted'。
 *
 * @example
 * ```ts
 * const translator = createNovelTranslator({ provider: myMockProvider })
 * const { status, paragraphs } = await translator.translate(
 *   { novelId: 1, chapterId: '1', paragraphs: ['...'], options: { xRestrict: 0 } },
 *   { baseURL: '...', apiKey: '...', model: '...' },
 *   new AbortController().signal,
 *   (chunk) => console.log(chunk),
 * )
 * ```
 */
export function createNovelTranslator(
  options: CreateNovelTranslatorOptions = {},
): NovelTranslatorHandle {
  const provider = options.provider
  const maxChars = options.maxChunkChars ?? 2000
  const concurrency = options.concurrency ?? 3
  const maxRetries = options.maxRetries ?? 0

  return {
    async translate(
      request: TranslationRequest,
      config: LlmEndpointConfig,
      signal: AbortSignal,
      onChunk?: (chunk: TranslationChunk) => void,
    ): Promise<{ status: TranslationStatus; paragraphs: string[] }> {
      if (request.paragraphs.length === 0) {
        return { status: 'completed', paragraphs: [] }
      }

      if (signal.aborted) {
        return { status: 'aborted', paragraphs: request.paragraphs.slice() }
      }

      const chunks = chunkParagraphs(request.paragraphs, maxChars)
      const totalChunks = chunks.length

      // 收集每块结果（成功 = 段落译文数组；失败 = null）
      // onChunk 透传：caller store 拿到每个 provider chunk 用于流式 UI 更新
      const blockResults = await runChunkPool(
        chunks,
        async (range) => {
          // 每个块构造独立的 request 切片（仅含该块段落）
          const slice = request.paragraphs.slice(range.start, range.end)
          const subRequest: TranslationRequest = {
            novelId: request.novelId,
            chapterId: request.chapterId,
            paragraphs: slice,
            options: request.options,
          }
          try {
            return await fetchChunkViaProvider(
              range,
              slice,
              provider!,
              subRequest,
              config,
              signal,
              onChunk,
            )
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') throw err
            if (err instanceof TranslationChunkError) throw err
            throw err
          }
        },
        concurrency,
        signal,
        maxRetries,
      )

      // 状态判定
      if (signal.aborted) {
        return { status: 'aborted', paragraphs: request.paragraphs.slice() }
      }

      let failedCount = 0
      let successCount = 0
      const paragraphs: string[] = new Array(request.paragraphs.length).fill('')
      for (let i = 0; i < blockResults.length; i++) {
        const result = blockResults[i]
        const range = chunks[i]
        if (result === null) {
          failedCount++
          // 失败块回退原文
          for (let j = range.start; j < range.end; j++) {
            paragraphs[j] = request.paragraphs[j]
          }
        } else {
          successCount++
          for (let j = range.start; j < range.end; j++) {
            paragraphs[j] = result[j - range.start] ?? request.paragraphs[j]
          }
        }
      }

      // 状态机收敛
      let status: TranslationStatus
      if (failedCount === 0) {
        status = 'completed'
      } else if (successCount === 0) {
        status = 'failed'
      } else {
        status = 'partial'
      }
      return { status, paragraphs }
    },
  }
}
# ADR-0169: app-lynx 端 TranslationProvider 无关接口 + chunked pipeline

- 状态：accepted（2026-09-19）
- 日期：2026-09-19
- 关联：wayfinder 地图 [#617](https://github.com/a1121611810/Pictelio/issues/617)（决策票 #619）；spec [docs/specs/app-lynx-novel-translation.md](../specs/app-lynx-novel-translation.md) commit `006d9e38`（22 决策 + 领域模型 §4）；研究 [#622](https://github.com/a1121611810/Pictelio/issues/622) `research/openai-responses-api.md` commit `85ca33b4` / `research/deepseek-streaming-api.md` commit `eb70ed84676f`；研究 [#623](https://github.com/a1121611810/Pictelio/issues/623) `research/lynx-async-iterator-support.md` commit `bc6dc018`（Q16）；研究 [#625](https://github.com/a1121611810/Pictelio/issues/625) `research/llm-endpoint-compatibility.md` commit `c648b174`（兼容性矩阵 + Azure URL 模板）；后续 ticket — ADR-0170（chunked pipeline 实现细节）/ ADR-0171（缓存键与模型档位）/ prototype #624（设置页 + 失败 UX 视觉定型）；ADR-0037（PixivApiPlugin 网关——API key 字节零进 JS 堆先例）、ADR-0053（Lynx NativeModule 契约——双通道探测 + 回调禁 null）、ADR-0085（DeepSeek 通道既有先例——`scripts/lib/release-notes-ai.mjs`）、ADR-0166（通用 OpenAI 兼容通道——脚本侧模型调用口径，与本 ADR 是 lynx / scripts 两端的同源设计）、ADR-0167（app-lynx novel intro 三段式——M3 + Lynx-only 范围双锚点）

## 背景

app-lynx 客户端无小说翻译能力（spec §1），需要在 `packages/app-lynx/` 从零搭建完整 BYOK 翻译栈。地图 #617 收敛的 22 决策中，**接口无关性 + 流式形态 + chunked pipeline + provider 适配层** 四件事必须在 implement 之前一次性写死：

1. **不抽共享包（Q1）+ 完全从零（Q3）**：webview 端的 `createNovelTranslator` / `translationCache` / `translationStore` / `TranslateSheet` / `SettingsTranslate` / `prompts.ts` 保持原状不动；app-lynx 端**重新设计**接口形态、缓存策略、prompt 构造、chunked pipeline 算法、状态机。复用边界仅限**抽象边界**（provider 接口形态 / 缓存键设计 / policy 决策点）。
2. **统一协议（Q18）= OpenAI Responses API**（`POST /v1/responses`）：所有 LLM 调用走新一代协议；不写死 chat/completions 旧协议。当前唯一原生实现 = OpenAI 官方 + Azure OpenAI + DeepSeek（部分兼容）+ vLLM 自托管；OpenRouter / 智谱 / Qwen / 文心 / LocalAI / LM Studio 仅 `/chat/completions`，由前端硬拒绝（spec §9.1）。
3. **流式接口 = AsyncIterator（Q16）**：`async function*` 返回 `AsyncIterator<TranslationChunk>`，消费方 `for-await-of`。调研 #623 已验证 Lynx 双平台（web-core + Lynx native）零运行时风险——rspeedy SWC target=es2015 + `@swc/helpers` `_async_generator` 链 + Lynx polyfill 自动注入 `Symbol.asyncIterator`。
4. **混合返回模式（Q6）= 流式优先 + 整批回退**：流中断时**自动回退整批重试一次**（`stream=false`、`max_output_tokens` 调高）；成功则 `completed`，失败则 `failed`。
5. **chunked pipeline 算法**：单章 paragraphs 按段落边界切块（≤2000 字 / 块），并发度 ≤3；失败块回退原文（不污染缓存）；`AbortSignal` 触发即静默退出（不计费归因）。
6. **DeepSeek 部分兼容（Q13 / Q18 / 调研 #625）**：`previous_response_id` / `conversation` / `store` / `background` / 内置工具缺失；unsupported 字段 silently ignored；流式无 `[DONE]` 哨兵（按 event 类型解析而非按哨兵终止）；prompt cache 字段命名差异（`usage.input_tokens_details.cached_tokens` vs DeepSeek `prompt_cache_hit_tokens`）。
7. **API key 走 Native bridge（Q5 / Q15）**：新建独立 Java NativeModule `PictelioTranslate`，API key 仅在 Android Keystore + Java 堆可见，**字节零进 JS 堆**（沿用 ADR-0037 原则；与 ADR-0053 双通道探测 + 回调禁 null 契约一致）。

不解决的**接口形态 + chunked pipeline 算法**会让 implement 阶段陷入以下三处僵局：

- **僵局 A — provider 写死**：先实现 DeepSeek 一套，后续加 OpenAI 官方时改协议、改字段名、改终止信号 → 不利于 Q17「用户自填 endpoint」（用户可能填 OpenAI 官方 / vLLM 自托管 / Azure / DeepSeek 任意一种）。
- **僵局 B — 流式形态选错**：直接返回 Promise + 整批响应 → 失去流式 UX（首屏增量化、按钮显示「翻译中 N%」），用户感知卡死（章节 > 5000 字时延 30s+）。或返回 EventSource 自定义事件 → 与 Lynx 双平台不兼容（#623 调研结论）。
- **僵局 C — chunked pipeline 缺位**：单次整章请求 → 章节 > 8000 字时易触发 `max_output_tokens` 截断（`response.incomplete`，调研 #622 §Q10）；用户必须重发整章；流式增量在中途变得无意义。

## 决策

### D1 · TranslationProvider 接口（Q4 / Q16 / Q17）

app-lynx 端**第一个 provider = `OpenAIResponsesProvider`**（统一走 `POST /v1/responses`），但**接口形态 = provider 无关**——便于未来扩展（即便本 ADR 不实现 chat/completions 适配器，seam 已留）。`TranslationProvider` 接口（TS 伪代码，implement 阶段拆为 `types.ts` + `provider.ts`）：

```ts
/**
 * 流式翻译 provider 接口（provider 无关）。
 * 当前唯一实现 = OpenAIResponsesProvider；接口接受任意 LLM endpoint 配置。
 * 消费方：store / novelTranslateStore.action.startTranslate()
 */
export interface TranslationProvider {
  /** provider 标识，用于 store / 日志 / 缓存键 namespace / telemetry */
  readonly id: 'openai-responses' | string

  /**
   * 发起流式翻译。返回 AsyncIterator，消费方 for-await-of。
   * 失败 / 中断 → 抛错 / 抛 AbortError；不返回 rejected Promise（流式契约）。
   *
   * @param request 翻译请求 IR（含段落 + 元数据，详见 D3）
   * @param config 用户自填 LLM endpoint 配置（apiKey 仅 Java 侧消费，JS 不可见）
   * @param signal AbortSignal（用户切章节 / 关闭详情页触发 abort()）
   * @returns AsyncIterator<TranslationChunk>（详见 D4）
   */
  translate(
    request: TranslationRequest,
    config: LlmEndpointConfig,
    signal: AbortSignal,
  ): AsyncIterator<TranslationChunk>

  /** 中断在途请求（AbortController 包装层）。abort 后 iterator.next() 抛 AbortError */
  abort(): void
}
```

**关键不变式**：

- 接口**不暴露** LLM 协议细节（URL / header / event type）——消费方只见 `TranslationChunk` 五种类型（详见 D4）。
- 接口**不暴露** API key 明文——`LlmEndpointConfig` 含 `apiKey` 字段，但 provider 实现内部消费路径必须在 Java 侧（详见 D6）。
- 接口**接收** `AbortSignal` 而非自带 AbortController——上层 store 持有 controller，决定何时 abort（章节切换 / 关闭详情页）。

### D2 · `LlmEndpointConfig` 配置（Q17 / ADR-0037 字节零进 JS 堆）

```ts
/**
 * 用户在设置页填写的 LLM endpoint 配置。
 * 完整 config（含 apiKey）走 SecureStorage（Android Keystore via PictelioTranslate Java 模块）；
 * JS 侧只能拿到「脱敏镜像」LlmEndpointPublic，**不能拿到明文 API key**。
 */
export interface LlmEndpointConfig {
  /** 形如 "https://api.openai.com/v1"，不含 "/responses" 后缀 */
  baseURL: string
  /** API key 明文；仅在 Java 侧消费，JS 侧永不持有（参考 ADR-0037） */
  apiKey: string
  /** 模型 ID；用户自由填写（gpt-5 / deepseek-v4-pro / 任意 vLLM model） */
  model: string
  /** 目标语言 BCP-47，默认 "zh-CN" */
  targetLang?: string
  /** 源语言 BCP-47；默认 "ja"（Pixiv 小说原文） */
  sourceLang?: string
}

/** 仅给 JS 侧使用的「脱敏展示」镜像（不含 apiKey） */
export interface LlmEndpointPublic {
  baseURL: string
  model: string
  targetLang: string
  /** 「key 已配置 ✓ / 未配置 ⚠」UI 状态 */
  hasKey: boolean
  /** 设置保存时间戳；用于设置页排序 */
  updatedAt: number
}
```

**守门**：provider 实现接 `LlmEndpointConfig` 后必须 **立即将 apiKey 字段复制到 Java 侧存储**（通过 PictelioTranslate NativeModule），并**清零 JS 堆的 apiKey 引用**。任何 `console.log(config)` / store 序列化 / devtools 抓取都看不到明文（沿用 ADR-0037 §安全策略）。

### D3 · `TranslationRequest` 翻译请求 IR（Q9 / Q13 / Q22）

```ts
/**
 * 翻译请求 IR。调用方提供 paragraphs 数组（已按章节 split + 段落 split 的纯文本）。
 * provider 内部按 ≤2000 字符切块（详见 D5 chunked pipeline 算法）。
 */
export interface TranslationRequest {
  novelId: number
  /** Pixiv 小说系列内章节 ID；单本小说 = novelId */
  chapterId: string
  /** 纯文本段落（已剥 HTML / 注音 / 行内样式） */
  paragraphs: string[]
  options: {
    /** 章节 R18 等级：0 / 1 / 2；应用层闸门（Q22）+ provider 元数据透传（Q13） */
    xRestrict: 0 | 1 | 2
    /**
     * 续翻场景：仅翻译 cache miss 的段落；空数组 = 全量翻译。
     * provider 据此在 chunked pipeline 阶段跳过已命中段。
     */
    failedIndices?: number[]
    /**
     * 缓存命中段落：直接由 store 写入 translatedParagraphs，不进入 provider 流；
     * 用于 Q6 整批回退时区分「已缓存 vs 待翻译」段落。
     */
    cachedIndices?: number[]
  }
}
```

**关键约束**：调用方**不带** prompt 模板（Q14）；`instructions` 字段由 provider 自行决定是否填充（spec §9.4：系统指令 / 术语表 / 翻译风格示例放最前，原文放最后；GPT-5.6+ prompt cache 要求 ≥1024 visible input tokens）。

### D4 · `TranslationChunk` 五种类型（流式消费契约）

```ts
/**
 * 流式 chunk。OpenAI Responses API 30+ 事件类型被规约为 5 种 chunk
 * （消费侧只需关心这 5 种，详见 D7 事件映射）。
 */
export type TranslationChunk =
  | { type: 'delta'; paragraphIndex: number; text: string }       // 某段增量文本
  | { type: 'reasoning_delta'; text: string }                      // reasoning 增量（埋点用，不展示）
  | { type: 'cached'; paragraphs: string[] }                       // 缓存命中直接给整章
  | { type: 'done'; usage?: TranslationUsage }                     // 流成功结束
  | { type: 'error'; code: TranslationErrorCode; message: string; retryable: boolean }

export interface TranslationUsage {
  inputTokens: number
  outputTokens: number
  /** 缓存命中 token；OpenAI Responses = `input_tokens_details.cached_tokens`，DeepSeek = `prompt_cache_hit_tokens`（provider 适配层做映射） */
  cachedTokens?: number
}

export type TranslationErrorCode =
  | 'unauthorized'           // 401 → API key 无效
  | 'rate_limit'             // 429
  | 'insufficient_balance'   // 402
  | 'invalid_request'        // 400
  | 'model_not_found'        // 404 → model 字段错
  | 'endpoint_not_responses' // 404 / 405 → endpoint 不支持 /v1/responses
  | 'server'                 // 5xx
  | 'network'                // fetch failed / DNS / proxy
  | 'content_filter'         // finish_reason=content_filter
  | 'aborted'                // 用户中断
  | 'unknown'
```

**消费守门**（spec §7.2 generation-gate）：任何 chunk 进入 store 前先比对 `request.chapterId === currentChapterId`；不匹配则丢弃（防跨章节污染）。`chapterId` 由 provider 在流起始处注入 chunk metadata（可作为 `delta` 类型的扩展字段，或由 store 在调用 provider 时闭包注入）。

### D5 · chunked pipeline 算法（≤2000 字 / 块，并发度 ≤3）

> **范围说明**：spec §11 ADR 边界将「chunked pipeline 与重试」分配给 **ADR-0170**（#620），但本 ADR 必须给出算法骨架（≤2000 字 / 块、并发度 ≤3、对齐规则、失败块回退原文、`AbortSignal` 静默退出），使接口契约完整。ADR-0170 在此骨架上**收敛**具体实现细节（退避算法、整批回退触发条件、缓存淘汰）。

#### D5.1 切块规则（沿段落边界）

```
输入：paragraphs: string[]（已剥 HTML 的纯文本段落数组）
输出：Chunk[]（每个 chunk 含起始段落索引 + 终止段落索引 + 拼接文本）

算法：
  1. 初始化 chunks = []；currentText = ''；startIndex = 0
  2. 遍历 paragraphs：
     - 尝试加入 currentText 后字符数（含 '\n\n' 段落分隔符）
     - 若 currentText.length + para.length + 2 > 2000：
        → push chunk(startIndex, i-1, currentText)
        → startIndex = i；currentText = para
     - 否则：currentText += '\n\n' + para
  3. push chunk(startIndex, len-1, currentText)
  4. 过滤：空 chunk 丢弃；< 50 字的尾部 chunk 与上一个 chunk 合并（避免模型响应分摊到两个 chunk）
```

**对齐规则**：每个 chunk 输出**完整段落**（不切断段落）；`paragraphIndex` 字段标识**该 chunk 起始段落在原数组中的索引**；store 据此把 chunk 译文回填到 `translatedParagraphs[startIndex + offset]`。

**为什么 2000 字**：

- 日文小说段落典型 100-300 字；单章 5000-10000 字 → 切 3-5 块；
- 与 OpenAI `max_output_tokens` 截断触发阈值（≈2048 tokens 含 reasoning 余量）匹配，**单 chunk 几乎不会触发截断**；
- 短章节（≤2000 字）→ 1 块；不浪费并发调度。

#### D5.2 并发调度（并发度 ≤3）

```
调度策略（per chunked pipeline 调用）：
  - 维护 active = 0；queue = [...chunks]
  - while queue.length > 0 && !signal.aborted:
      - if active < 3: dequeue chunk → provider.translateChunk(chunk) → active++
      - await provider.nextChunkPromise (await 任一 in-flight 完成)
      - on chunk done / error: active-- → 消费 chunk → 进 store
  - 全部 done → emit { type: 'done' }
```

**为什么 ≤3**：

- **OpenAI 默认 TPM 限制**：单组织 60k-150k TPM；单 chunk ≈1500 input tokens + ≈2000 output tokens ≈ 3500 tokens；并发 3 ≈ 10.5k tokens / 轮；安全余量。
- **DeepSeek 并发配额**：`deepseek-v4-pro = 500`、`deepseek-flash = 2500`（调研 `deepseek-streaming-api.md` §Q7）；并发 3 远低于配额上限。
- **流式增量 UX**：并发过高 → 多段同时涌出 → 段落顺序错乱；并发 3 保持「前段 → 中段 → 后段」大致顺序（流式响应本身是时间有序的，多 chunk 串行 / 半并行足够）。

#### D5.3 失败块回退原文（Q6 整批回退子路径）

**单 chunk 失败语义**（非用户中断）：

```
on chunk error (retryable=true):
  1. 把该 chunk 的 paragraphIndex 范围标记为 failedIndices
  2. 累计该 chunk 失败次数；连续 ≤ 2 次 → 整体重试（带 backoff 1s → 2s）
  3. 第 3 次失败 → emit { type: 'error', code, message, retryable: false }
  4. store 接 error → status = 'partial' | 'failed'
     - 'partial' = 部分段落译文已成功（store 渲染已译段 + 未译段 fallback 〔未翻译〕占位）
     - 'failed' = 全部 chunk 均失败（无任何译文）
  6. 缓存写**永不**在 'partial' / 'failed' / 'aborted' 状态下执行（仅 'done' 之后写，spec §7.2）
```

**整批回退触发**（Q6，spec §9.6.1）：**全章流中断**（不是单 chunk 失败）时，store 自动 `stream=false` + `max_output_tokens` 调高（× 2）+ 整章 paragraphs 一次性提交（不走 chunked pipeline）。回退成功 → `completed`；回退失败 → `failed`。

#### D5.4 AbortSignal 静默退出

```
任何时刻 signal.aborted === true:
  1. provider.abort()（内部关闭 SSE 连接）
  2. 调度循环跳出 while 循环（不 emit error chunk）
  3. store 接 abort → status = 'aborted'（不计费归因）
  4. 缓存写**不**触发（半成品不污染缓存）
```

**关键约束**：abort 触发时**不抛错**（不 emit `{ type: 'error', code: 'aborted' }`）；store 通过 `status = 'aborted'` 单点感知。原因是 abort 频繁触发（用户切章节 / 关闭详情页）→ 不应计入错误监控 / 日志噪音。

### D6 · OpenAIResponsesProvider 适配层（POST /v1/responses，30+ 事件映射到 5 种 Chunk）

```ts
/**
 * OpenAI Responses API provider 实现。
 * 唯一职责 = 把 Responses API 的 30+ 事件类型规约为 TranslationChunk 五种类型。
 * 网络请求通过 NativeModule（PictelioTranslate.fetchStream）走 Java 侧；
 * apiKey 仅在 Java 堆组装 Authorization header，JS 堆零明文。
 */
export class OpenAIResponsesProvider implements TranslationProvider {
  readonly id = 'openai-responses' as const
  private abortController: AbortController | null = null

  async *translate(
    request: TranslationRequest,
    config: LlmEndpointConfig,
    signal: AbortSignal,
  ): AsyncIterator<TranslationChunk> {
    this.abortController = new AbortController()
    signal.addEventListener('abort', () => this.abortController?.abort())

    // 1. 构造 Responses API 请求体（详见 D6.1）
    const body = buildResponsesRequestBody(request, config)

    // 2. 调用 NativeModule 发起 SSE 流（apiKey 在 Java 侧注入 header）
    const stream = PictelioTranslate.fetchStream({
      baseURL: config.baseURL,
      path: '/v1/responses',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,                                       // 含 apiKey 占位，Java 侧替换
      signal: this.abortController.signal,
    })

    // 3. 解析 SSE 事件流（详见 D6.2 事件映射）
    for await (const event of parseSSE(stream)) {
      yield mapEventToChunk(event, request)      // 详见 D6.2
    }
  }

  abort() { this.abortController?.abort() }
}
```

#### D6.1 请求构造（`buildResponsesRequestBody`）

```ts
function buildResponsesRequestBody(
  request: TranslationRequest,
  config: LlmEndpointConfig,
): ResponsesRequest {
  return {
    model: config.model,
    // Q14：调用方不带 prompt 模板；provider 自行决定 instructions 内容
    instructions: buildSystemPrompt(config),         // spec §9.4 prompt cache prefix 设计
    input: [
      {
        role: 'user',
        content: request.paragraphs.map((p, i) =>
          `[${i}] ${p}`                              // 段落索引锚定，模型按行对齐输出
        ).join('\n\n'),
      },
    ],
    stream: true,                                    // 流式必须
    max_output_tokens: estimateMaxOutput(request),    // ceil(inputTokens * 2) + 512
    // Q13：xRestrict 不透传给 LLM（应用层闸门已拦截，Q22）
    // Q13：unsupported 字段（store / background / previous_response_id）不发
  }
}
```

**Azure 特殊处理**（调研 #625 §Q2 / spec §9.2）：

- baseURL 匹配 `*.openai.azure.com` 时：
  - **自动补齐** `/openai/v1` 段（如用户填 `https://my-r.openai.azure.com`，provider 内部补 → `https://my-r.openai.azure.com/openai/v1`）
  - 在请求 header 加 `api-version: "preview"`（**非** query string）
  - `model` 字段用 deployment 名（不是 OpenAI 模型命名空间）
- 不做自动迁移（用户必须显式选 Azure base URL；不提供 Azure preset 按钮——Q5 / Q17 纯净边界）

#### D6.2 30+ 事件映射到 5 种 Chunk（核心规约表）

| Responses API 事件 | TranslationChunk | 备注 |
|---|---|---|
| `response.created` | _（不 emit，标记流起始）_ | 仅用于 generation-gate chapterId 注入 |
| `response.output_text.delta` | `{ type: 'delta', paragraphIndex, text }` | **主消费事件**；`paragraphIndex` 从 `[N]` 锚定段解析 |
| `response.output_text.done` | _（吞掉，delta 已聚合）_ | — |
| `response.output_item.added/done` | _（吞掉，结构信息）_ | — |
| `response.content_part.added/done` | _（吞掉，结构信息）_ | — |
| `response.reasoning_text.delta` | `{ type: 'reasoning_delta', text }` | **埋点用，不展示**；通过 telemetry 收集 |
| `response.reasoning_summary_text.delta` | `{ type: 'reasoning_delta', text }` | 同上 |
| `response.refusal.delta/done` | `{ type: 'error', code: 'content_filter', message: '模型拒答', retryable: false }` | 终止流 |
| `response.function_call_arguments.*` | _（吞掉，翻译场景未启用 tools）_ | — |
| `response.file_search_call.*` / `web_search_call.*` / `code_interpreter_call.*` / `mcp_call.*` / `image_generation_call.*` | _（吞掉，unsupported）_ | — |
| `response.completed` | `{ type: 'done', usage: mapUsage(...) }` | **流成功结束**；从 `response.usage` 提取 token |
| `response.failed` | `{ type: 'error', code: mapErrorCode(...), message, retryable }` | 流终止失败 |
| `response.incomplete` | `{ type: 'error', code: 'invalid_request', message: 'max_output_tokens', retryable: false }` 或 `{ type: 'done', usage }` (incomplete=true) | 截断；语义由 `incomplete_details.reason` 决定 |
| `error`（裸事件） | `{ type: 'error', code: 'server', retryable: true }` | 连接级错误（超时 / proxy / 服务端崩溃） |

**关键事件类型数**：30+ Responses 事件 → 5 种 Chunk（消费侧零感知协议细节）。

#### D6.3 usage 字段映射（OpenAI / DeepSeek 差异收敛）

| 字段 | OpenAI Responses 路径 | DeepSeek 路径 | provider 适配层映射 |
|---|---|---|---|
| 输入 token | `usage.input_tokens` | `usage.prompt_tokens` | → `TranslationUsage.inputTokens` |
| 输出 token | `usage.output_tokens` | `usage.completion_tokens` | → `TranslationUsage.outputTokens` |
| 缓存命中 token | `usage.input_tokens_details.cached_tokens` | `usage.prompt_cache_hit_tokens` | → `TranslationUsage.cachedTokens` |
| 缓存写入 token | `usage.input_tokens_details.cache_write_tokens` | _（不存在）_ | → 0（DeepSeek 无此概念） |
| Reasoning token | `usage.output_tokens_details.reasoning_tokens` | `usage.completion_tokens`（含 reasoning） | → 仅记录，不展开 |

### D7 · DeepSeek 兼容层 70% 复用点

DeepSeek 是 `research/deepseek-streaming-api.md` + `research/openai-responses-api.md` 调研的旁证——DeepSeek `/v1/responses` 是为 Codex 集成而新增的**部分兼容** Responses API 路径。**与 OpenAI Responses 的实现共用 70% 代码**：

| 子层 | 复用率 | 说明 |
|---|---|---|
| SSE 帧格式（`data: {json}\n\n`） | **100%** | 与 OpenAI Responses 一致；DeepSeek `/chat/completions` 走 `[DONE]` 哨兵，但 `/v1/responses` **无 `[DONE]`**，靠 `response.completed/incomplete/failed` 终止 |
| NativeModule 探测 + AbortController | **100%** | ADR-0053 双通道探测（`NativeModules` + `globalThis`）；AbortSignal 触发即关底层 TCP |
| 请求字段（`model` / `input` / `stream` / `max_output_tokens`） | **100%** | DeepSeek 支持 OpenAI Responses 同名同义字段 |
| 错误响应（HTTP 4xx/5xx 同步 + 流内 `response.failed`） | **80%** | DeepSeek 错误**只**走 HTTP 状态码（流内无 error 事件）；OpenAI Responses 有 `response.failed` 结构化终止事件——provider 统一在流终止时检查 `response.status` |
| 取消语义（AbortController / 关闭 TCP） | **100%** | DeepSeek 无服务端 cancel endpoint；与 OpenAI Responses 同步流语义一致 |
| prompt cache 字段命名 | **30%**（需映射） | OpenAI = `input_tokens_details.cached_tokens`；DeepSeek = `prompt_cache_hit_tokens`（`prompt_cache_miss_tokens` 冗余存在）；详见 D6.3 |
| 流式事件类型 | **100%** | DeepSeek 复用 OpenAI Responses 同套事件类型（`response.created` / `response.output_text.delta` / `response.completed` 等）；**DeepSeek 无 `[DONE]`** 已是 Responses API 标准，不需额外兼容 |
| 重试策略（429 / 5xx 指数退避 + Retry-After） | **100%** | DeepSeek HTTP header `Retry-After` 字段与 OpenAI 一致（OpenAI 兼容协议事实） |
| `previous_response_id` / `conversation` / `store` / `background` | **0%**（不实现） | DeepSeek 不支持 stateless；provider 内部**根本不发送**这些字段——`previous_response_id` 等传值会被 silently ignored（调研 #625 §Q3 兼容矩阵） |
| 内置工具（`web_search` / `file_search` / `mcp`） | **0%**（不实现） | DeepSeek ignored；翻译场景不依赖——provider 不发 `tools` 字段 |
| `reasoning.summary` | **50%** | DeepSeek `effort` 支持；`summary` 接受但不生成——provider 发 `effort: "minimal"`，不发 `summary` |

**结论**：`OpenAIResponsesProvider` 实现即作为 DeepSeek / OpenAI / Azure / vLLM 的**统一适配层**（统一走 `POST /v1/responses` 协议 + 用户自填 endpoint 配置）。**不另写 DeepSeekProvider**——本 ADR 范围内**唯一实现**。

### D8 · 不抽 `@pictelio/novel-translate` 共享包（Q1 收窄）

- 实现文件全部位于 `packages/app-lynx/src/features/novel-translate/`：
  - `types.ts`（接口 + IR）
  - `provider.ts`（`TranslationProvider` 接口）
  - `openai-responses-provider.ts`（唯一实现）
  - `pipeline.ts`（chunked pipeline 调度器 + 切块算法）
  - `usage-mapping.ts`（OpenAI / DeepSeek usage 字段映射）
  - `azure-url.ts`（Azure URL 模板补齐 + header 注入）
- 测试位于 `packages/app-lynx/tests/unit/features/novel-translate/`（vitest `environment: 'node'`）。
- **禁止**在 `packages/` 根目录新增 `novel-translate` 包——Q1「只做 app-lynx 端」收窄；将来如需共享，重新开新 map + 新 ADR。

### D9 · 与现有架构契约的双锚点

| 契约 | 本 ADR 怎么遵守 | 参考 |
|---|---|---|
| API key 字节零进 JS 堆 | apiKey 仅在 PictelioTranslate Java NativeModule 内部组装 `Authorization: Bearer ...` header；JS 堆任何位置（store / props / console）都拿不到明文 | ADR-0037 §安全策略 |
| NativeModule 双通道探测 | `PictelioTranslate` 通过 `NativeModules`（裸全局）+ `globalThis.NativeModules` 双探测判定原生模式 | ADR-0053 §1 |
| NativeModule 回调禁 null | 成功回调 `cb()` / `cb(value)`；错误回调 `cb(errMsg)`（单参 string） | ADR-0053 §2 |
| 流式契约 = AsyncIterator | `translate()` 返回 `AsyncIterator<TranslationChunk>`；store `for-await-of` | Q16 / 调研 #623 |
| 续翻 = 章节粒度 | store 持有 `Map<chapterId, AbortController>`；同 chapterId 复用 in-flight；`signal.abort` 触发即静默退出 | Q12 / D5.4 |
| Provider 自决定 R18 元数据（Q13） | `TranslationRequest.options.xRestrict` 透传给 provider；当前 OpenAIResponsesProvider **不使用**该字段（不发 LLM）——应用层闸门已拦截（Q22） | Q13 / Q22 |
| 调用方不带 prompt（Q14） | provider 自行构造 `instructions` 字段（spec §9.4 prompt cache prefix 设计）；调用方不传 system prompt | Q14 |
| 缓存键粒度 = novel id + chapter id（Q7） | provider 键哈希含 `novelId | chapterId | targetLang | modelId | sourceHash | baseURLHash`；改任一字段自动 miss | Q7 / ADR-0171 |

### D10 · 测试基线（IO 边界硬约束）

> spec §10.1 已对齐 AGENTS.md「测试硬约束」五条；本 ADR 收敛 provider 层的具体测试组：

| 测试组 | 用例 | oracle |
|---|---|---|
| Provider 接口契约 | `translate()` 返回 `AsyncIterator`；`abort()` 真中断；`error.code` 分类正确 | D1 / D4 |
| Chunk 规约 | `response.output_text.delta` → `delta`；`response.reasoning_text.delta` → `reasoning_delta`；`response.completed` → `done`；`response.failed` / `response.incomplete` → `error` 或 `done`(incomplete=true) | 调研 `openai-responses-api.md` §Q2 / §Q4 |
| SSE 帧解析 | 30+ Responses API 事件类型正确分派；DeepSeek 无 `[DONE]` 兼容（已天然兼容，因 Events API 不用 `[DONE]`）；reasoning 与 text 双通道分离 | 调研 #625 §Q3 |
| usage 字段映射 | OpenAI `input_tokens_details.cached_tokens` ↔ DeepSeek `prompt_cache_hit_tokens` 双向映射正确 | 调研 `openai-responses-api.md` §Q8 / `deepseek-streaming-api.md` §Q6 |
| chunked pipeline 算法 | 100 / 1500 / 5000 / 20000 字章节切块正确；并发度 ≤3 守门；失败块回退原文；abort 后零 chunk emit | D5.1 / D5.2 / D5.3 / D5.4 |
| Azure URL 模板 | baseURL `*.openai.azure.com` → 自动补 `/openai/v1` + `api-version: preview` header | spec §9.2 |
| Inline probe | HTTP 401/403 → 兼容；404 → 不兼容；405 → 仅 chat/completions；网络错 → unknown | 调研 `llm-endpoint-compatibility.md` §Q7 |
| R18 闸门 | `xRestrict=1/2` + 设置关闭 → 拒绝（不发请求）；开启 → 允许 | spec §9.7 |
| Generation-gate | 跨章节 chunk 注入 → store 丢弃（防跨章节污染） | D4 / spec §7.2 |

**mock 来源**：真实 Pixiv novel HTML 样例（来自 `tests/unit/fixtures/`）+ 真实 Responses API SSE 帧（来自 OpenAI 官方文档摘录，调研 `openai-responses-api.md`）+ 真实 DeepSeek Responses API 帧（来自 `deepseek-streaming-api.md` 摘录）。**禁止**手写自洽字段（AGENTS.md 测试硬约束 #2）。

## 否决的替代方案

### 方案 A：不抽 provider 抽象，直接写 DeepSeek 一套（已拒绝）

**理由**：

- 与 Q17「用户自填 endpoint（base URL + API key + model）」冲突——用户可能填 OpenAI 官方 / vLLM 自托管 / Azure OpenAI / DeepSeek 任意一种；写死 DeepSeek 协议 → 90% 用户填错 endpoint 即失败。
- 与 Q18「协议 = OpenAI Responses API」冲突——DeepSeek `/chat/completions` 是 OpenAI 兼容旧协议，与 Q18 选定的 Responses API 是**两套协议**。
- 与 ADR-0085 / ADR-0166 的「通用 OpenAI 兼容通道」先例冲突——脚本侧已收敛「通用通道优于绑死某家」，lynx 端不应反向走回头路。
- **未来扩展 provider 痛苦**：新增 OpenAI 官方时改 URL / 改字段名 / 改终止信号 → 接口零复用。

### 方案 B：复用 webview 端 `createNovelTranslator`（已拒绝）

**理由**：

- 违反 Q3「完全从零——prompt / 算法 / 缓存策略 / store / UI 全部新建」；wayfinder map #617 的 `复用边界` 段明确「不引用 webview 端的 `createNovelTranslator` / `translationCache` / `translationStore` / `TranslateSheet` / `SettingsTranslate` / `prompts.ts`」。
- webview 端是 SolidJS 2.0 + Fluent Design 2 + 单一 endpoint 配置（DeepSeek 绑死 + Vite 代理）；app-lynx 端是 Vue 3 + M3 + 用户自填 endpoint（base URL + key + model + 多 provider 兼容）。**栈不同**（SolidJS vs Vue + Lynx runtime）+ **协议不同**（DeepSeek `/chat/completions` vs OpenAI `/v1/responses`）+ **样式不同**（Fluent 2 vs M3）+ **安全约束不同**（Vite 代理可拿 key vs Java NativeModule 隔离）—— 复用收益 < 抽象成本。
- **违反即时导航硬约束 #3「竞态防护」**：复用 webview 端的 SolidJS `createResource` 模式与 Vue 3 异步范式不兼容；强行复用会引入范式冲突。
- **违反 AGENTS.md「Fluent Design 强制」**：webview 端代码含 Fluent 2 token（`tokens.css` / UnoCSS shortcuts），插到 M3 lynx 项目里是**架构污染**。
- 可参考其**抽象边界**（provider 接口形态 / 缓存键设计 / policy 决策点），但不直接搬运实现。

### 方案 C：提供多 provider 预设（DeepSeek / OpenAI / Azure 切换按钮）（已拒绝）

**理由**：

- 违反 Q17「LLM endpoint = 用户自填（base URL + API key + model）由用户在设置页填写，不预设任何 provider」；spec §6.1 / §2.5 明确「**不**在设置页提供 DeepSeek / OpenAI / Azure / 自托管 等 preset 按钮」。
- 强制 preset → 用户必须从固定列表选 → 与 Q18「OpenAI Responses API 统一协议」背后假设的「用户自由选 endpoint」语义不符。
- preset 隐含「我们（开发方）推荐 DeepSeek」——违背 BYOK 纯净边界（用户的 key / 模型选择完全用户控制）。
- preset UI 增加设置页复杂度（4-6 个按钮 + 每个按钮的 i18n 文案 + 切换交互）—— 收益是「降低 5% 新用户首次配置摩擦」，成本是「破化完全用户自填语义」+ 「未来加新 provider 要改 UI」。

### 方案 D：写死 chat/completions 协议（已拒绝）

**理由**：

- 违反 Q18「协议 = OpenAI Responses API（`POST /v1/responses`）」——wayfinder map #617 `Notes` 段明确「当前不写死 chat/completions 旧协议；后续如需支持，可单独扩展」。
- chat/completions 旧协议的 prompt cache 字段、reasoning 暴露、终止信号（`finish_reason` vs `response.completed/incomplete/failed` 三态）**与 Responses API 全部不一致**——写死 chat/completions 会失去 Responses API 30+ 事件的结构化优势。
- DeepSeek / OpenAI / Azure / vLLM 全部原生支持 `/v1/responses`（调研 #625 兼容性矩阵）；写死 chat/completions 意味着**故意**走更老的协议——零收益。
- **未来扩展 provider 痛苦**：如未来需要支持 OpenRouter / 智谱 / Qwen / 文心（这些仅 `/chat/completions`），作为**单独 ticket + 单独 map** 处理；不预先引入 chat/completions fallback（调研 #625 §5.4 明确「不要为了『让更多用户能跑通』而在 implement 阶段增加 chat/completions 回退路径」）。

## 后果

### 正面

- **抽象干净**：provider 无关接口 → 未来加 chat/completions 适配器 / Claude 适配器只需新增 `ChatCompletionsProvider : TranslationProvider`，store / pipeline 零改动。
- **provider 可替换**：用户自填 endpoint（Q17）+ OpenAI Responses API 统一协议（Q18）+ Provider 接口无关抽象（Q4）三层叠加 → 用户填任意 Responses API 兼容 endpoint（OpenAI / Azure / DeepSeek / vLLM）零配置切换。
- **测试易写**：接口契约 5 种 Chunk 类型 + 30+ 事件规约表 → 单测覆盖点明确；mock 来自真实 Responses API 帧（AGENTS.md 测试硬约束 #2「真实样例」）。
- **安全契约一致**：API key 走 PictelioTranslate Java NativeModule + ADR-0037 字节零进 JS 堆原则 + ADR-0053 双通道探测 + 回调禁 null——与现有 Pixiv API / OAuth 通道同一安全等级。
- **chunked pipeline 骨架完整**：≤2000 字 / 块 + 并发度 ≤3 + 对齐规则 + 失败块回退原文 + AbortSignal 静默退出 — 全部章节长度（100 / 1500 / 5000 / 20000 字）覆盖；流式增量 UX 友好（用户看到段落实时填充）。
- **DeepSeek 70% 复用**：OpenAIResponsesProvider 即作为 DeepSeek / OpenAI / Azure / vLLM 统一适配层；研发成本不重复投入。

### 负面 / 成本

- **抽象层增加**：与「直接写 DeepSeek 一套」相比，多 1 层 `TranslationProvider` 接口 + `TranslationChunk` IR 规约 + chunked pipeline 调度器；估计 +200-300 行 TS 代码（实现 + 测试）。
- **DeepSeek 部分兼容需在事件类型解析层处理**：`previous_response_id` / `conversation` / `store` / `background` 不发送；流式无 `[DONE]` 哨兵（按 event 类型解析）——已在 D7 收敛 70% 复用点，**剩余 30% 是事件类型映射层**（不影响调用方）。
- **chunked pipeline 算法细节推迟到 ADR-0170**：本 ADR 给出骨架（≤2000 字 / 块、并发度 ≤3、对齐规则、失败块回退、`AbortSignal` 静默退出），但**整批回退触发条件**（Q6 `stream=false` 整批重试）、**退避算法**（1s → 2s → 4s 指数 + jitter）、**缓存淘汰**（LRU 容量上限）由 ADR-0170 收敛——本 ADR 不阻塞 implement 阶段开工。
- **Azure URL 模板**需在 provider 内部加一段补齐逻辑（约 20 行 TS）——复杂度可控。
- **测试覆盖范围广**：30+ Responses API 事件类型 + 5 种 Chunk 规约 + 4 章字数切块测试 + Azure 模板 + 用量字段映射 + generation-gate——估计 +15-20 测试用例。

### 排除面（Out of Scope）

- **chat/completions 旧协议支持**：当前只走 OpenAI Responses API `/v1/responses`；如未来需要回退支持，作为单独 ticket + 单独 map（调研 #625 §5.4 明确「硬拒绝 + 清晰错误」是当前最优解）。
- **webview 端的翻译栈**：保持现状（`createNovelTranslator` / `translationCache` / `translationStore` / `TranslateSheet` / `SettingsTranslate` / `prompts.ts` 不动）。
- **抽 `@pictelio/novel-translate` 共享包**：用户明确只做 app-lynx 端（Q1）；将来如需共享，重新开新 map。
- **`@pictelio/novel-export` 包改动**：翻译结果纳入导出可在后续 map 单独处理。
- **provider preset UI**：不在设置页提供「DeepSeek / OpenAI / Azure」等 preset 按钮（保持完全用户自填的纯净边界）。
- **多 endpoint 切换**：当前只支持单一 endpoint 配置；多 endpoint 轮询 / 并行 / fallback 不在本 map。
- **i18n 字典补全**：spec 阶段定义键（`novelTranslate.*` 50 个）；zh-CN / en 字符串实际翻译留到 implement 阶段补全。

## References

- wayfinder map [#617](https://github.com/a1121611810/Pictelio/issues/617)（app-lynx 端小说翻译，22 决策 + 4 后续 ADR / prototype ticket）
- spec [docs/specs/app-lynx-novel-translation.md](../specs/app-lynx-novel-translation.md) commit `006d9e38`（939 行，22 决策 + 领域模型 §4 + 数据流 §5 + 状态机 §7 + i18n §8 + 边界异常 §9 + 测试 §10 + ADR 边界 §11）
- 调研 `research/openai-responses-api.md`（#622，commit `85ca33b4`，777 行 — `POST /v1/responses` 协议 + 30+ 事件类型 + prompt cache 字段 + 流终止三态）
- 调研 `research/deepseek-streaming-api.md`（#622 旁证，commit `eb70ed84676f`，335 行 — DeepSeek 流式 `[DONE]` 哨兵 + 并发配额 + keep-alive 机制）
- 调研 `research/lynx-async-iterator-support.md`（#623，commit `bc6dc018`，360 行 — Lynx 双平台 SWC es2015 target + Symbol.asyncIterator polyfill 已验证）
- 调研 `research/llm-endpoint-compatibility.md`（#625，commit `c648b174`，416 行 — OpenAI / Azure / DeepSeek / vLLM 支持；OpenRouter / 智谱 / Qwen / 文心 / LocalAI / LM Studio 不支持；Azure URL 模板 + DeepSeek 部分兼容矩阵）
- 后续 ticket — ADR-0170（chunked pipeline 实现细节，整批回退触发条件 + 退避算法）/ ADR-0171（缓存键与模型档位 + LRU 容量）/ prototype #624（设置页 + 失败 UX 视觉定型）
- ADR-0037（PixivApiPlugin 网关——API key 字节零进 JS 堆先例 + 401 自动刷新）
- ADR-0053（Lynx NativeModule 契约——双通道探测 + 回调禁 null + access_token 隔离）
- ADR-0085（DeepSeek 通道既有先例——`scripts/lib/release-notes-ai.mjs` AI 断言收缩）
- ADR-0166（通用 OpenAI 兼容通道——scripts 侧模型调用，与本 ADR 是 lynx / scripts 两端的同源设计）
- ADR-0167（app-lynx novel intro 三段式——M3 + Lynx-only 范围双锚点的最近先例）
- 术语：`openwiki/domain/novel-reader.md` §AI Translation（webview 端参考，**非复用**）
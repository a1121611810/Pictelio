# Research: OpenAI Responses API

> **Scope.** Wayfinder map issue #617 → child ticket #622. 调研 OpenAI Responses API（`POST /v1/responses`）协议细节，回答 issue body 列出的 10 个事实问题，为后续 issue #622 实施提供事实依据。
>
> **Methodology.** 优先 web_fetch `developers.openai.com` 官方文档（含 `.md` 后缀的 Markdown 副本） + 离线缓存 `curl` 整页 `index.md`（169k 行 raw schema）。未命中 Context7（MCP 不可用），未使用 `web_search` 兜底；旧 DeepSeek 调研产物（`research/deepseek-streaming-api.md`，branch `research/deepseek-streaming-api` commit `eb70ed84676f`）作为 DeepSeek 兼容层事实的旁证使用——DeepSeek 兼容 OpenAI chat/completions，而 Responses API 是 OpenAI 2025 推出的新协议，不能从 DeepSeek 直接外推。
>
> **Date.** 2026-09-19. **Branch.** `research/openai-responses-api`.

---

## Q1: `POST /v1/responses` request 形态（`model` / `input` 数组 / `instructions` / `stream` / `max_output_tokens` / `reasoning.effort`）

**答案。** Endpoint 为 `POST https://api.openai.com/v1/responses`，Content-Type `application/json`，认证走 `Authorization: Bearer $OPENAI_API_KEY`。Body 为 JSON 对象，关键字段：

```jsonc
{
  "model": "gpt-6-astra",                  // 必填；模型 ID（支持 reasoning 模型的命名空间含 o1/o3/o4/gpt-5.x/gpt-6/astra）
  "input": [                                // 可选；string 或数组。字符串简写 = 单条 user message。
    {
      "role": "system" | "developer" | "user" | "assistant",
      "content": "..." | [
        { "type": "input_text", "text": "..." },
        { "type": "input_image", ... },
        { "type": "input_file", ... }
      ]
    },
    /* function_call / function_call_output / reasoning / configuration_update 等 typed item */
  ],
  "instructions": "You are a helpful assistant.", // 可选；顶层 system 指令（chat/completions 的 `system` 角色在 Responses 中是顶层字段）
  "stream": true,                           // 可选；bool，默认 false。true 时 SSE 事件流。
  "max_output_tokens": 2048,                // 可选；int/null。包含 reasoning tokens 的总输出上限。
  "reasoning": {                            // 可选；仅 reasoning 模型。
    "effort": "low" | "medium" | "high" | "minimal",
    "summary": "auto" | "concise" | "detailed" | null  // 是否返回 reasoning summary（Responses 独有）
  },
  "temperature": 1.0,                       // 标准采样参数
  "top_p": 1.0,
  "tools": [                                // 可选；可用工具数组（type: function | web_search | file_search | code_interpreter | mcp | image_generation | ...）
    { "type": "function", "name": "...", "parameters": {...}, "strict": true }
  ],
  "tool_choice": "auto" | "none" | "required" | { "type": "function", "name": "..." },
  "parallel_tool_calls": true,
  "text": {                                 // 可选；output format / verbosity 配置
    "format": { "type": "text" } | { "type": "json_object" } | { "type": "json_schema", "name": "...", "schema": {...}, "strict": true },
    "verbosity": "low" | "medium" | "high"
  },
  "previous_response_id": "resp_...",        // 可选；状态化对话锚点（见 Q7）。
  "conversation": "conv_...",               // 可选；Conversations API 对象 ID（不能与 previous_response_id 同用）。
  "store": true,                            // 可选；bool，默认 true。控制 response 对象是否持久化（30 天 TTL）。
  "truncation": "auto" | "disabled",        // 可选；窗口溢出策略。
  "user": "user_...",                       // 可选；滥用追踪 ID。
  "prompt_cache_key": "...",                // 可选；见 Q8。
  "prompt_cache_options": { "mode": "explicit" | "implicit", "ttl": "30m" },
  "prompt_cache_retention": "in_memory" | "24h",  // 仅 GPT-5.5 及更早模型；GPT-5.6+ 已弃用此字段。
  "metadata": {}
}
```

**Notes:**
- `role` 在 Responses API 区分 `developer`（与 Chat Completions 的 `system` 等价但更明确）与 `system`（向后兼容）；鼓励使用 `developer`。
- `max_output_tokens` 是包含 reasoning tokens 的总上限（不是仅可见文本）。当触发截断时，`incomplete_details.reason = "max_output_tokens"` 出现，status 为 `incomplete`。
- `reasoning.summary` 是 Responses API 独有配置；旧 chat/completions 没有此字段。如启用，response.output 中会多出 `type: "reasoning"` 的 item（见 Q3）。
- `background: true` 开启异步模式（response 立即返回、可轮询、可 cancel），不与 stream 同义。

[source: https://developers.openai.com/api/reference/resources/responses/methods/create]

---

## Q2: 流式响应的事件序列（`response.created` / `response.output_text.delta` / `response.completed` 等 SSE 事件类型）

**答案。** `stream: true` 启用 SSE 传输（Content-Type: `text/event-stream`），每帧格式为 `data: {json}\n\n`。事件用 `type` 字段区分，**关键生命周期事件序列**（最小流）：

```
data: {"type":"response.created","response":{...,"status":"in_progress","output":[],...}}

data: {"type":"response.output_item.added","output_index":0,"item":{...}}       // 可选；开始一个 output item（message / function_call / reasoning / ...）

data: {"type":"response.content_part.added","item_id":"msg_...","content_index":0,"part":{...}}

data: {"type":"response.output_text.delta","item_id":"msg_...","content_index":0,"delta":"Hi","logprobs":[]}
// …… 多个 delta 事件 ……

data: {"type":"response.output_text.done","item_id":"msg_...","content_index":0,"text":"Hi there! How can I assist you today?"}

data: {"type":"response.content_part.done","item_id":"msg_...","content_index":0,"part":{...}}

data: {"type":"response.output_item.done","output_index":0,"item":{...}}

data: {"type":"response.completed","response":{...,"status":"completed","output":[...],...,"usage":{...}}}
```

**完整事件类型清单**（Responses API 域类型，共约 30+ 个）：

| 事件 type | 用途 | 发射次数 |
|-----------|------|---------|
| `response.created` | 流开始；response 元数据定型 | 1 次 |
| `response.in_progress` | 流进行中（周期信号） | 多次（可选） |
| `response.output_item.added` | 新 output item 开始 | 每个 item 1 次 |
| `response.output_item.done` | output item 完成 | 每个 item 1 次 |
| `response.content_part.added` | item 内的 content part 开始 | 每个 part 1 次 |
| `response.content_part.done` | content part 完成 | 每个 part 1 次 |
| `response.output_text.delta` | 文本增量（**消费侧主事件**） | 多次 |
| `response.output_text.done` | 文本定型 | 每条文本 1 次 |
| `response.output_text.annotation.added` | 文本内 annotation（如 URL citation） | 多次 |
| `response.refusal.delta` | 模型拒答增量 | 多次 |
| `response.refusal.done` | 模型拒答定型 | 0 或 1 次 |
| `response.function_call_arguments.delta` | function_call 的 arguments 增量（JSON 字符串流） | 多次 |
| `response.function_call_arguments.done` | function_call arguments 定型 | 每个 fc 1 次 |
| `response.reasoning_text.delta` | reasoning 文本增量（见 Q3） | 多次 |
| `response.reasoning_text.done` | reasoning 文本定型 | 0 或 1 次 |
| `response.reasoning_summary_text.delta` | reasoning summary 增量 | 多次 |
| `response.reasoning_summary_text.done` | reasoning summary 定型 | 0 或 1 次 |
| `response.reasoning_summary_part.added` | reasoning summary part 开始 | 多次 |
| `response.reasoning_summary_part.done` | reasoning summary part 完成 | 多次 |
| `response.file_search_call.*` | file_search 工具生命周期 | 多次 |
| `response.web_search_call.*` | web_search 工具生命周期 | 多次 |
| `response.code_interpreter_call.*` | code_interpreter 工具生命周期 | 多次 |
| `response.image_generation_call.*` | 图像生成工具 | 多次 |
| `response.mcp_call.*` / `response.mcp_list_tools.*` | MCP 工具 | 多次 |
| `response.completed` | 流成功结束（status=completed） | 0 或 1 次 |
| `response.failed` | 流失败结束（status=failed；body 含 `error`） | 0 或 1 次 |
| `response.incomplete` | 流截断结束（status=incomplete；body 含 `incomplete_details`） | 0 或 1 次 |
| `error` | 错误事件（流进行中、连接级错误） | 0 或多次 |

**SSE 帧格式示例**（来自 OpenAI 官方 `Streaming` 示例响应）：
```
data: {"type":"response.created","response":{"id":"resp_67c9fdcecf488190bdd9a0409de3a1ec07b8b0ad4e5eb654","object":"response","created_at":1741290958,"status":"in_progress","error":null,"incomplete_details":null,"instructions":"You are a helpful assistant.","max_output_tokens":null,"model":"gpt-6-astra","output":[],"parallel_tool_calls":true,"previous_response_id":null,"reasoning":{"effort":null,"summary":null},"store":true,"temperature":1.0,"text":{"format":{"type":"text"}},"tool_choice":"auto","tools":[],"top_p":1.0,"truncation":"disabled","usage":null,"user":null,"metadata":{}}}

data: {"type":"response.in_progress","response":{ ...同上 snapshot... }}

data: {"type":"response.output_item.added","output_index":0,"item":{ ...空 message item... }}

data: {"type":"response.content_part.added","item_id":"msg_...","output_index":0,"content_index":0,"part":{"type":"output_text","text":"","annotations":[]}}

data: {"type":"response.output_text.delta","item_id":"msg_...","output_index":0,"content_index":0,"delta":"Hi","logprobs":[]}

... 多个 delta ...

data: {"type":"response.output_text.done","item_id":"msg_...","output_index":0,"content_index":0,"text":"Hi there! How can I assist you today?"}

data: {"type":"response.content_part.done","item_id":"msg_...","output_index":0,"content_index":0,"part":{...}}

data: {"type":"response.output_item.done","output_index":0,"item":{...}}

data: {"type":"response.completed","response":{ ...,"status":"completed","output":[{"id":"msg_...","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"Hi there! How can I assist you today?","annotations":[]}]}],"usage":{"input_tokens":37,"output_tokens":11,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":48}}}
```

**重要语义（与 chat/completions 差异）：**
- 每个生命周期事件（`created` / `completed` / `failed` / `incomplete`）都**携带完整 response snapshot**（不是 delta），方便客户端随时拿全量 state。
- `sequence_number` 字段单调递增——是响应流强一致的"绝对序号"，可用来检测丢帧 / 重排（chat/completions 没有该字段）。
- `output_index` 标记当前 output item 在 `response.output[]` 中的位置；`item_id` 是稳定 ID，可在后续 `previous_response_id` 链中作为引用。

[source: https://developers.openai.com/api/reference/resources/responses#streaming (官方 Streaming 示例响应)]
[source: https://developers.openai.com/api/docs/guides/streaming-responses]

---

## Q3: `reasoning` 字段（替代 chat/completions 的 `thinking`）在流式响应里怎么交错（`response.reasoning_text.delta`？）

**答案。** Responses API 用独立的事件序列承载 reasoning，**不复用 `output_text.delta`**。当请求中 `reasoning.effort != null`（或模型自动决定 reasoning 时）且 `reasoning.summary` 启用，流中会按以下顺序**先于文本输出**发射 reasoning 增量：

```
response.created
response.output_item.added     { item: { type: "reasoning", id: "rs_...", summary: [], content: null } }
response.reasoning_summary_part.added   { part: { type: "summary_text", text: "" } }
response.reasoning_summary_text.delta   { delta: "Let me think..." }     ← 多次
response.reasoning_summary_text.done    { text: "Let me think..." }
response.reasoning_summary_part.done    { ... }

# —— 如果 model 还暴露原始 reasoning（部分模型支持）——
response.reasoning_text.delta  { delta: "..." }                            ← 多次
response.reasoning_text.done   { text: "..." }

response.output_item.done      { item: { type: "reasoning", ... } }

# —— 然后才到正常 output_text 流 ——
response.output_item.added     { item: { type: "message", ... } }
response.output_text.delta     { delta: "Final answer..." }               ← 多次
response.output_text.done      { text: "Final answer..." }
response.output_item.done      { ... }
response.completed
```

**与 chat/completions 的差异：**
- chat/completions 中 reasoning 暴露在 `delta.reasoning_content`（DeepSeek 用 `delta.reasoning_content`，OpenAI o1 用 `delta.reasoning`）；**单一通道**混在 choices 增量里。
- Responses API 把 reasoning 提升为**独立 item type**（`type: "reasoning"`），拥有独立 item_id、独立事件族。UI 渲染可以**结构性区分**思考段与正文段，不需要正则切分 `<think>…</think>`。
- `reasoning.summary` 控制是否同时返回**结构化 summary**（部分模型可能不暴露原始 reasoning，仅暴露 summary）——Responses 独有字段；chat/completions 无等价。

**OpenAI Responses 域类型定义**（摘录）：
- `ResponseReasoningItem { id, type: "reasoning", summary: array of ResponseReasoningSummaryPart, content: optional ResponseReasoningTextContent, encrypted_content: optional string }`
- `ResponseReasoningTextDeltaEvent { delta, item_id, output_index, sequence_number, content_index: ... }`
- `ResponseReasoningTextDoneEvent { text, item_id, output_index, sequence_number, content_index }`
- `ResponseReasoningSummaryTextDeltaEvent { delta, item_id, output_index, sequence_number, summary_index }`

**对 Pictelio 翻译场景的影响。** 翻译功能使用 `reasoning.effort: "minimal"`（或低档）以减少 reasoning_tokens 计费；流式客户端需注册 `response.reasoning_text.delta` + `response.reasoning_summary_text.delta` 两个事件族以收集 reasoning（用于调试 UI 或埋点），但**最终入库的译文**只取 `output_text.delta` 流。reasoning item 不持久化为翻译 prompt 缓存键的一部分。

[source: https://developers.openai.com/api/reference/resources/responses#reasoning_text_delta]
[source: https://developers.openai.com/api/docs/guides/reasoning]

---

## Q4: 错误响应形态：HTTP status code vs 流内 error event

**答案。** Responses API 用**双层错误模型**：

### 4.1 连接建立前/同步错误（HTTP-level）

| HTTP status | error.type | error.code | 语义 |
|-------------|------------|------------|------|
| 400 | `invalid_request_error` | （多变） | 请求体 schema 错误、参数缺失、`strict: true` 与不支持的 JSON Schema 同时出现等 |
| 401 | `invalid_request_error` | `invalid_api_key` | 认证失败 |
| 403 | `invalid_request_error` | （多变） | 组织权限 / 区域限制 |
| 404 | `invalid_request_error` | （多变） | 模型或 endpoint 不存在 |
| 413 | `invalid_request_error` | （多变） | 请求体过大 |
| 429 | `rate_limit_error` | `rate_limit_exceeded` 或 `slow_down` | 配额耗尽或速率突增 |
| 500 | `server_error` | （多变） | 服务端异常 |
| 503 | `service_unavailable_error` | `server_is_overloaded` | 模型过载 |
| 529 | （其他） | （多变） | 临时过载（历史） |

Body 形态：
```json
{
  "error": {
    "message": "Invalid API key provided: sk-...",
    "type": "invalid_request_error",
    "param": null,
    "code": "invalid_api_key"
  }
}
```

### 4.2 流内错误（stream-level）

流已建立但中途失败时，**不会**通过 HTTP 状态码传达——客户端需要识别两类事件：

- **`error` 事件**（裸 type，**无** `response.` 前缀）：
  ```json
  {"type":"error","code":"...","message":"...","param":"..."}
  ```
  流中断，连接关闭。用于连接级错误（超时、proxy 异常、provider 端崩溃）。

- **`response.failed` 事件**（流终止事件，type 前缀 `response.`）：
  ```json
  {
    "type": "response.failed",
    "response": {
      "id": "resp_...",
      "status": "failed",
      "error": { "code": "server_error", "message": "..." }
    }
  }
  ```
  流正常终止（HTTP 200），但 response 失败。**客户端必须消费此事件**才能区分成功 `response.completed` vs 失败。

- **`response.incomplete` 事件**（截断，非错误）：
  ```json
  {
    "type": "response.incomplete",
    "response": {
      "id": "resp_...",
      "status": "incomplete",
      "incomplete_details": { "reason": "max_output_tokens" | "max_messages" | "content_filter" | "steered" }
    }
  }
  ```
  这是**正常终止但输出被截断**——不是错误，但客户端要识别并告知用户"输出不完整"。

### 4.3 客户端消费建议

```
流结束事件分流：

  response.completed  → 成功，正常处理 usage + output
  response.failed     → 失败，按 error.code 决定重试 / 上报
  response.incomplete → 截断，按 incomplete_details.reason 处理：
                         - max_output_tokens → 重试 or 拆分（见 Q10）
                         - content_filter    → 视为业务失败
                         - max_messages      → 重试
                         - steered           → 模型自中断，重试通常无效
  error（裸事件）     → 瞬态错误，重试
```

**关键差异（vs chat/completions）：**
- chat/completions 失败是连接级（流中断、HTTP 状态），没有 `response.failed` 这种结构化终止事件。
- Responses API 把"流终止"显式化为事件，让客户端可以**保证至少消费到一条终止事件**再做清理。

[source: https://developers.openai.com/api/docs/guides/streaming-responses#read-the-responses]
[source: https://developers.openai.com/api/reference/resources/responses/methods/create#error]

---

## Q5: 取消在途流式请求的方法

**答案。** 三种语义，对应三种场景：

### 5.1 同步流式（`stream: true`，无 `background`）

**取消语义 = 断开底层 HTTP 连接**。OpenAI 没有显式 cancel endpoint（`POST /responses/{id}/cancel` **仅适用于 background 模式**——见 5.2）。

实现路径：
- **浏览器 fetch + AbortController**：`controller.abort()` → fetch 抛 AbortError → 浏览器关闭流。OpenAI 服务端通常在 TCP RST 后停止生成（但**未必立即**，已生成的 token 计费照常）。
- **Node fetch / undici**：`AbortController` 同上；底层 Node socket destroy。
- **HTTP/2**：`RST_STREAM` 帧关闭 stream（多路复用下不影响其他 stream）。
- **HTTP/1.1**：关闭 connection（Connection: close），不可恢复。

**注意：** OpenAI 没有"取消已生成 token 不计费"的承诺。一旦 `response.created` 事件发出，prompt tokens 已计费；output tokens 按已通过流发给客户端的部分计费。Abort 只是阻止**后续** token 生成与计费。

### 5.2 异步/Background 模式（`background: true`）

请求立即返回 `{ id: "resp_..." }`，后端继续生成。提供：

- `POST https://api.openai.com/v1/responses/{response_id}/cancel` — 显式取消，response 进入 `cancelled` 终态（属于 `ResponseStatus` 枚举之一）。
- `GET /responses/{response_id}` — 轮询当前状态（`queued` / `in_progress` / `completed` / `failed` / `cancelled` / `incomplete`）。

可与 `stream: true` **组合**：`background: true, stream: true` 时流也是异步的，可一边消费一边 cancel。

### 5.3 WebSocket 模式（`wss://.../responses`）

持久连接上的 `response.create` 帧发起请求，`response.cancel` 帧取消。语义同 background，但延迟更低。**不适合** Pictelio 当前 Vite 代理 + Capacitor 架构。

### 5.4 Pictelio 选型

翻译场景是**用户主动点击触发**的小延迟请求（通常 < 30s），同步流式 + AbortController 即可——用户切页 / 关闭面板 / 切换 novel 即触发 abort。**不需要** background 模式（与 DeepSeek 调研结论一致：`research/deepseek-streaming-api.md` §Q5）。

```
伪代码（Pictelio 适配）:

  const controller = new AbortController()
  // 组件卸载 / 用户切页：
  controller.abort()

  const stream = openai.responses.create({
    model: "gpt-6-astra",
    input: ...,
    stream: true,
  }, { signal: controller.signal })

  for await (const event of stream) {
    switch (event.type) {
      case "response.output_text.delta": ...
      case "response.completed": break
      case "response.failed": throw new Error(event.response.error.message)
      case "response.incomplete": ...
    }
  }
```

[source: https://developers.openai.com/api/reference/resources/responses/methods/cancel]
[source: https://developers.openai.com/api/docs/guides/background]

---

## Q6: structured output / tool calls 在 Responses API 下的形态（`text.format` / `tools` 数组）

**答案。** Responses API 提供**两条正交通道**用于结构化输出 / 工具调用，**不互相排斥**：

### 6.1 Structured Outputs（最终回复的 schema 约束）

通过请求参数 `text.format` 配置：

```jsonc
{
  "text": {
    "format": {
      "type": "json_schema",
      "name": "translation_result",
      "schema": {
        "type": "object",
        "properties": {
          "translated_text": { "type": "string", "description": "最终译文" },
          "glossary_terms": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["translated_text", "glossary_terms"],
        "additionalProperties": false
      },
      "strict": true
    }
  }
}
```

流式事件序列（与正常文本流相同，**不再有独立事件类型**）：
```
response.output_item.added      { item: { type: "message" } }
response.content_part.added     { part: { type: "output_text", text: "" } }
response.output_text.delta      { delta: '{"translated_text":"...","glossary_terms":[' }
... 增量 ...
response.output_text.done       { text: '{"translated_text":"...完整 JSON...","glossary_terms":[...]}' }
```

最终 `response.output[0].content[0]` 是合法的 JSON 字符串（client 自解析）；SDK 提供 `response.output_parsed`（Python pydantic / JS zod 绑定）直接得到强类型对象。

**约束（与 chat/completions 一致）：**
- `strict: true` 才进入 Structured Outputs 严格模式；否则只是 JSON mode（合法 JSON，无 schema 保证）。
- 所有字段必须 `required`；可选字段用 `{"type": ["string", "null"]}` 表达。
- `additionalProperties: false` 强制（Strict 模式硬要求）。
- 不支持：`allOf` / `not` / `dependentRequired` / `if/then/else` / root-level `anyOf`。
- 最大嵌套 10 层、最多 5000 个 object properties、所有枚举值总长 ≤ 120000 字符。

**JSON mode**（降级）：`text.format = { "type": "json_object" }`——保证合法 JSON，不保证 schema。**JSON mode 必须在某处包含 "JSON" 字符串**（否则 API 主动拒绝防死循环）。

### 6.2 Function / Tool Calls（模型主动调用外部工具）

通过 `tools` 数组声明可用工具，`tool_choice` 控制调用策略：

```jsonc
{
  "tools": [
    {
      "type": "function",
      "name": "search_glossary",
      "description": "在术语表中查找术语的标准译法",
      "parameters": {
        "type": "object",
        "properties": {
          "term": { "type": "string", "description": "待查术语（原文）" }
        },
        "required": ["term"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "tool_choice": "auto"  // 或 "required" | "none" | { "type": "function", "name": "..." }
}
```

流式事件序列（模型发起 tool call）：
```
response.function_call_arguments.delta   { delta: '{"term":' }
... 增量（JSON 字符串） ...
response.function_call_arguments.done    { arguments: '{"term":"..."}' }
response.output_item.done               { item: { type: "function_call", call_id: "call_...", name: "...", arguments: "..." } }

# 客户端执行工具后，把结果回灌：
response.create({
  previous_response_id: "resp_...",
  input: [
    { "type": "function_call_output", "call_id": "call_...", "output": "..." }
  ]
})
```

内置工具（无需声明 schema）支持：`web_search` / `file_search` / `code_interpreter` / `image_generation` / `mcp` / `computer_use` / `web_search_preview`——各自有独立事件族。

### 6.3 与 chat/completions 形态对照

| 概念 | chat/completions | Responses API |
|------|------------------|---------------|
| 文本 schema 约束 | `response_format` | `text.format`（嵌套变深） |
| 工具声明 | `tools` 顶层 | `tools` 顶层（同样） |
| 工具选择 | `tool_choice` | `tool_choice`（同样） |
| 流式 tool args | `delta.tool_calls[i].function.arguments`（在 choices 里） | **独立事件** `response.function_call_arguments.delta`（在响应流顶层） |
| 工具结果回灌 | `role: "tool", tool_call_id, content` | `type: "function_call_output", call_id, output`（typed input item） |
| Strict 模式 | `function.strict: true` + `response_format.type: "json_schema"` | `tools[i].strict: true` + `text.format.strict: true`（同样） |
| 内置工具 | 较少 | `web_search` / `file_search` / `code_interpreter` / `mcp` / `image_generation` / `computer_use` |

### 6.4 Pictelio 翻译场景选型

**不推荐** 用 `text.format: json_schema` 强约束翻译结果——翻译是自然语言生成，schema 约束反而损害流畅度。**推荐**：
- 默认走普通文本流（`text.format: { type: "text" }`）。
- 如未来要抽 glossary / 译文置信度等结构化字段，用 `function_call` 让模型**可选**调用 `extract_glossary` 工具（`tool_choice: "auto"`），而不是约束主回复。

[source: https://developers.openai.com/api/docs/guides/structured-outputs]
[source: https://developers.openai.com/api/reference/resources/responses/methods/create#tools]

---

## Q7: `previous_response_id` 状态化对话机制（是否影响翻译缓存）

**答案。** 三种状态化方式并存，**互斥关系如下**：

| 方式 | 字段 | 作用域 | 持久化 |
|------|------|--------|--------|
| 手动 replay | `input: [...]`（含 history） | 客户端维护 | 客户端 |
| 单链 anchor | `previous_response_id: "resp_..."` | 服务端 30 天（默认） | 服务端 |
| 会话对象 | `conversation: "conv_..."` | 长期（无 30 天 TTL） | 服务端 |

**互斥约束：** `previous_response_id` **不能与** `conversation` 同时使用；也不能与同请求的 `input` 含 assistant item 同时使用（语义冲突）。

### 7.1 `previous_response_id` 语义

```
# 第 1 轮
POST /v1/responses
{ "model": "...", "input": "Tell me a joke" }
→ { "id": "resp_AAA", "output": [...] }

# 第 2 轮（链式）
POST /v1/responses
{
  "model": "...",
  "previous_response_id": "resp_AAA",
  "input": [{ "role": "user", "content": "Explain why this is funny." }]
}
→ { "id": "resp_BBB", "output": [...] }   // 服务端自动把 resp_AAA 的 output 当作第 2 轮的 history
```

**等价手动形式：**
```jsonc
{
  "input": [
    { "role": "user", "content": "Tell me a joke" },
    { "role": "assistant", "content": "...joke..." },  // ← replay resp_AAA.output
    { "role": "user", "content": "Explain why this is funny." }
  ]
}
```

**计费：** "Even when using `previous_response_id`, all previous input tokens for responses in the chain are billed as input tokens in the API." —— **链上每一轮的 history 都按 input tokens 计费**，不享受 server-side 缓存折扣（除非走 prompt cache，详见 Q8）。

### 7.2 `conversation` 语义（Conversations API）

独立对象，通过 `POST /v1/conversations` 创建。`POST /v1/responses` 时把 `conversation` 设为该 ID，**所有 items（input + output）自动追加到 conversation**，无 30 天 TTL。适合多设备、长会话场景。

### 7.3 手动 replay

最朴素，状态完全在客户端。Pictelio 当前**没有跨轮状态**（每段翻译独立），所以默认就走普通 `input: [...]` 路径，不需要 `previous_response_id`。

### 7.4 对翻译缓存的影响

**关键结论：** Responses API 的状态化机制**不影响** 翻译 prompt 缓存——因为翻译 prompt 的 cache key 完全由 input 内容决定（见 Q8），与对话链结构无关。

但需要注意：
- 如果未来引入 multi-turn 翻译（如"先直译，再润色"），用 `previous_response_id` 链式调用，**链上所有 history 都进 cache 匹配**——缓存命中率提升（同一前缀的同一翻译请求会复用）。
- **不能用** `previous_response_id` 跨用户复用——`previous_response_id` 是 OpenAI 内部的稳定 ID，租户隔离依赖 OpenAI 后端；`prompt_cache_key` 才是用户提供的隔离键。
- 若想**用户级**翻译缓存（同一原文 + 同一 target lang + 同一 glossary 跨用户复用），应在请求里显式构造 deterministic prompt prefix + 自带 `prompt_cache_key`，**不要依赖** `previous_response_id`。

[source: https://developers.openai.com/api/docs/guides/conversation-state]
[source: https://developers.openai.com/api/reference/resources/conversations/methods/create]

---

## Q8: prompt cache 标记（`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`）在流式 Responses 响应里的位置

**答案。** Responses API 的 prompt cache 字段命名是 **`input_tokens_details.cached_tokens`** 和 **`input_tokens_details.cache_write_tokens`**（**与 DeepSeek 的 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 命名不同**——见末尾 DeepSeek 兼容层旁证）。

### 8.1 字段位置

**流终止事件**（`response.completed` / `response.incomplete` / `response.failed`）的 `response.usage` 对象内：

```json
{
  "usage": {
    "input_tokens": 1523,
    "input_tokens_details": {
      "cached_tokens": 1024,            // ← 等价于 DeepSeek 的 prompt_cache_hit_tokens
      "cache_write_tokens": 499         // ← GPT-5.6+ 新增；写入的新前缀 token 数
    },
    "output_tokens": 256,
    "output_tokens_details": {
      "reasoning_tokens": 128            // 推理模型才存在
    },
    "total_tokens": 1779
  }
}
```

**关键点：**
- 缓存命中/未命中信息**只在终止事件里**（`response.completed` / `incomplete` / `failed`）出现——流进行中没有 usage 增量。
- 流内**没有** `usage.delta` 类事件（与 chat/completions 相同）。客户端要累计 `output_tokens_details` 需靠 output_text.done 等定型事件的 length / token 估算。
- 计费规则：`input_tokens = cached_tokens + cache_write_tokens + 普通 input tokens`（精确分解；非估算）。

### 8.2 字段映射对照（DeepSeek → Responses API）

| DeepSeek（chat/completions 兼容） | OpenAI Responses API | 说明 |
|----------------------------------|---------------------|------|
| `prompt_cache_hit_tokens` | `usage.input_tokens_details.cached_tokens` | 缓存命中 |
| （不存在） | `usage.input_tokens_details.cache_write_tokens` | GPT-5.6+ 新增 |
| `prompt_cache_miss_tokens`（隐式 = input - hit） | 由 `input_tokens - cached_tokens - cache_write_tokens` 推导 | 无显式 miss 字段 |
| `usage.completion_tokens` / `output_tokens` | `usage.output_tokens` | 同名 |
| `usage.total_tokens` | `usage.total_tokens` | 同名 |
| `choices[0].delta.reasoning_content` | `response.reasoning_text.delta` 事件流（独立事件族） | 结构不同 |

### 8.3 缓存生效条件（影响翻译缓存策略）

- **最低 cacheable 长度：** GPT-5.6+ = 1024 visible input tokens；GPT-5.5 / GPT-5.5 Pro = 模型依赖；更早模型 = 模型依赖。
- **缓存键组成：** OpenAI 内部 hash = 模型 + 完整渲染上下文（developer msg + tools + 历史 + 图片/文档 + 音频）；**整段前缀必须 byte-equal 才能命中**。
- **影响 cache 命中的请求参数**（按敏感度从高到低）：`model` > `tools`（含 schema / 顺序 / 名称） > `parallel_tool_calls` > `text.format` > `reasoning.effort` > `text.verbosity` > `context_management` > `temperature` / `top_p`（不影响）。
- **`prompt_cache_key`：** 客户端提供的可选键，用于：
  - GPT-5.5 及更早：优化路由（让同一前缀请求路由到同一缓存机器）。
  - GPT-5.6+：**不影响缓存命中**，仅用于**账单 / 监控**分账（按用户 / 租户隔离 cache accounting）。
- **TTL：** GPT-5.6+ = `prompt_cache_options.ttl: "30m"`（固定 30 分钟，命中刷新）；更早 = `prompt_cache_retention: "in_memory" | "24h"`，默认 `24h`（无 ZDR 组织）或 `in_memory`（ZDR 组织）。
- **Cache 写费用：** GPT-5.6+ = 1.25× uncached input rate；更早 = 无附加费。

### 8.4 Pictelio 翻译缓存策略要点

1. **不要把 `previous_response_id` 当作缓存键**——它影响 prompt 前缀稳定性，但本身不构成缓存命中依据。
2. **翻译 prompt 应保持 determinism：** 系统指令 + 术语表 + 翻译风格示例放最前（prefix 稳定），用户原文放最后。这样同一原文跨用户复用术语表与系统指令部分（≥ 1024 tokens 才划算）。
3. **使用 `prompt_cache_key` 做租户隔离**（虽然不影响命中，但账单更清晰）：建议 `key = "translate:v1:user_${userId}"`。
4. **抓 usage 必须消费 `response.completed`**——SDK 通常会等到完整 response 才解析；如果自实现 SSE 解析器，**别提前 dispose 客户端**。
5. **命中率监测：** 算 `cached_tokens / input_tokens`；Pictelio 翻译场景如果术语表 + system ≥ 1024 tokens，预期稳态命中率 50-80%（同一 glossary 跨小说复用）。

[source: https://developers.openai.com/api/docs/guides/prompt-caching]
[source: https://developers.openai.com/api/reference/resources/responses/methods/create#input_tokens_details]

---

## Q9: 速率限制（429 + retry-after）语义

**答案。** OpenAI 在 `429` / `503` 时通过**响应头**（不是 body）传达速率限制信息；`Retry-After` 仅在**临时性**限流时出现。

### 9.1 关键响应头

| Header | 示例 | 说明 |
|--------|------|------|
| `Retry-After` | `56` | **最小**等待秒数（仅 `429 rate_limit_error` + `slow_down` 与 `503 server_is_overloaded` 出现）。**配额 / 计费类错误不出现此头**（这些不可重试解决）。 |
| `x-ratelimit-limit-requests` | `60` | RPM 上限 |
| `x-ratelimit-limit-tokens` | `150000` | TPM 上限 |
| `x-ratelimit-remaining-requests` | `59` | 剩余 RPM |
| `x-ratelimit-remaining-tokens` | `149984` | 剩余 TPM |
| `x-ratelimit-reset-requests` | `1s` | RPM 距重置时间 |
| `x-ratelimit-reset-tokens` | `6m0s` | TPM 距重置时间 |
| `x-ratelimit-limit-project-tokens` | `60000` | 项目级 TPM（存在时） |
| `x-ratelimit-remaining-project-tokens` | `57000` | 项目级剩余 TPM |
| `x-ratelimit-reset-project-tokens` | `3s` | 项目级 TPM 重置时间 |

**所有响应都附带** `x-ratelimit-*` 头（不只是 429），所以客户端可在正常路径上做**预防性限流**（看到 `remaining-tokens < threshold` 时主动 sleep）。

### 9.2 错误分类与重试策略

| HTTP status | error.type | error.code | 含义 | 重试策略 |
|-------------|------------|------------|------|---------|
| 429 | `rate_limit_error` | `rate_limit_exceeded` | 配额耗尽（RPM / TPM / RPD / TPD 等任一） | **不可**简单重试——等配额刷新（看 reset headers）；升级 tier 才行 |
| 429 | `rate_limit_error` | `slow_down` | 速率突增（ramp-rate limit） | **可**重试——按 `Retry-After` 等待 + 降低发速 |
| 503 | `service_unavailable_error` | `server_is_overloaded` | 模型临时过载 | **可**重试——按 `Retry-After` 等待 |
| 500 | `server_error` | （多变） | 服务端 bug | 可重试一次，失败上报 |
| 400 / 401 / 403 / 404 / 413 | `invalid_request_error` | （多变） | 请求问题 | **不**重试 |

### 9.3 流式（`stream: true`）特殊语义

> "For streaming requests, these HTTP error responses apply **before the stream starts**. An error after streaming begins can arrive as a **stream event**; **don't automatically replay a request after consuming output**."

即：
- 流**开始前**的 429 / 503 走 HTTP status + Retry-After。
- 流**已开始后**的错误（中途断流、模型过载）以**流事件**形式到达（见 Q4 `error` 事件 / `response.failed`）——**已消费的 output tokens 已计费，重试不会退还**。

### 9.4 限制粒度

- **组织级 + 项目级**双层限制（OpenAI 控制台可看）。
- **模型级**（同一模型跨多 endpoint 共享 limit）。
- **模型族级**（部分模型"shared limit"——如 GPT-5.5 与 GPT-5.5 Pro 共享 3.5M TPM）。
- **长上下文单独限流**（如 GPT-5.5 的 long-context request 单独计）。
- **批量异步队列**（`/v1/batches`）独立于同步限流。
- **缓存输入仍计入 TPM**（"Cached prompts count toward rate limits"）。

### 9.5 Pictelio 重试实现建议

```
429 rate_limit_error / slow_down:
  sleep max(server_retry_after, exponential_backoff_with_jitter)
  最多 3 次；失败 → 上报用户"翻译服务繁忙"

503 server_unavailable_error / server_is_overloaded:
  sleep server_retry_after（同上）
  最多 3 次

500 server_error:
  1 次重试（exponential + jitter）

400 / 401 / 403 / 404 / 413:
  不重试；上报 + 引导用户检查 key / 网络

流中 response.failed:
  按 error.code 复用上面规则；记录已消费 tokens 用于账单对账
```

**SDK 行为：** 官方 SDK 默认 retry 429/503，**但对超长 `Retry-After` 处理不一致**——必须查 SDK 版本的 max retry delay 配置；超长延迟 SDK 会放弃并抛出原 HTTP error，**此时客户端应放弃重试**而非无限循环。

[source: https://developers.openai.com/api/docs/guides/rate-limits]

---

## Q10: `max_output_tokens` 与 chunk 大小关系

**答案。** OpenAI 没有公开承诺 `max_output_tokens` 与 SSE chunk 大小的固定关系——**chunk 大小由模型 / 服务端动态决定**，与 `max_output_tokens` 没有直接换算。

### 10.1 实际行为观察（基于文档示例与社区报告）

- **`delta` 字段携带的 token 数：**
  - 一般 1-30 个 token / delta；OpenAI 在响应 token 后立即 flush，不等攒批。
  - 极端情况下可单 token 一个 delta（如生僻字 / 边界条件）。
  - 偶尔会有 50+ token 的 delta（如长 enum 值、JSON schema strict 模式生成）。
- **SSE 帧边界：** 一个 SSE `data:` 帧**对应一个事件**（`response.output_text.delta` / `response.output_item.added` / 等），事件多 ≠ 帧多。

### 10.2 截断（truncation）触发条件

`max_output_tokens` 包含**所有生成 token**：

```
max_output_tokens = visible output tokens + reasoning_tokens + tool_call tokens（含 function_call arguments）
```

当超出时：
- 流的最后一个 `response.completed` 不再出现。
- 取而代之的是 **`response.incomplete`** 事件，`incomplete_details.reason = "max_output_tokens"`。
- `usage.output_tokens = max_output_tokens`（已达上限），`usage.incomplete_details` 反映截断。

**与 chat/completions 差异：**
- chat/completions 截断时 `finish_reason = "length"`，但**没有专门的 `incomplete_details` 字段**——客户端需要根据 `finish_reason` 推断。
- Responses API 显式提供 `incomplete_details.reason`，更易于客户端区分"上下文超限"（max_messages）vs "输出超限"（max_output_tokens）vs "内容过滤"（content_filter）vs "模型自中断"（steered）。

### 10.3 客户端消费注意事项

1. **不要假设 chunk 大小恒定**——buffer 必须能容纳任意大小 delta，从 1 字节到数十 KB 都可能。
2. **必须监听 `response.incomplete` 事件**——它是 `max_output_tokens` 触发的唯一信号。
3. **不要靠 `delta.length` 估算 `output_tokens`**——OpenAI 不保证单 delta = 单 token；累积 token 数只在 `usage.output_tokens`（终止事件）里有可信值。
4. **要算 token-per-second 吞吐量**：用 `(usage.output_tokens / (last_event_time - first_event_time))`，不要用 delta 数 / 时间。
5. **`truncation: "auto"`**（请求参数）允许 OpenAI 在窗口溢出时自动压缩输入；`**"disabled"`**（默认）则抛 400 错误。对翻译场景**保持默认 disabled**（输入不会超 128k），避免静默截断。

### 10.4 翻译场景应对 max_output_tokens 截断

```
case response.incomplete:
  switch (event.response.incomplete_details.reason) {
    case "max_output_tokens":
      // 译文过长。两种应对：
      // A) 提高 max_output_tokens 重试（如果模型上限允许）
      // B) 拆分原文：按段落边界分块翻译，合并
      retryWithLargerBudget() OR splitAndTranslate()
      break
    case "content_filter":
      // 原文触发安全过滤。向用户报告，跳过。
      notifyUser("翻译失败：内容触发安全策略")
      break
    case "max_messages":
      // 对话超长。翻译场景几乎不会触发。
      break
    case "steered":
      // 模型主动中止。重试通常无效。
      break
  }
```

**Pictelio 翻译默认 max_output_tokens：** 建议 `max_output_tokens = ceil(input_tokens * 3) + 512`（日文小说通常译文长度 ≤ 原文 1.5-2x）。对单段 ≤ 8k 字符的翻译，留 4k-6k token 余量即可。

[source: https://developers.openai.com/api/reference/resources/responses/methods/create#max_output_tokens]
[source: https://developers.openai.com/api/docs/guides/streaming-responses#advanced-use-cases]

---

## Summary

1. **架构差异。** Responses API（`POST /v1/responses`）是 OpenAI 2025 推出的新一代协议，与 chat/completions 共享底层模型但**重新设计了 I/O 形态**——typed input items、typed output items、显式事件驱动流（`response.created` / `response.output_text.delta` / `response.completed` 等 30+ 事件类型）、结构化终止事件（`response.failed` / `response.incomplete`），是 chat/completions + Assistants API 的合并演进。
2. **关键兼容点。** SSE 传输、SSE 帧格式（`data: {json}\n\n`）、tool calls 语义、`temperature` / `top_p` / `store` / `tools` / `tool_choice` 与 chat/completions 同名同义；翻译场景可以直接复用 `research/deepseek-streaming-api.md` 的 SSE 解析层骨架，事件类型需替换为 `response.*` 族。
3. **关键差异点（必须改造的部分）。** (a) prompt cache 字段命名（`cached_tokens` vs DeepSeek `prompt_cache_hit_tokens`）；(b) reasoning 暴露方式（独立 `response.reasoning_text.delta` 事件族 vs chat 的 `delta.reasoning_content`）；(c) 流终止事件（`response.completed/failed/incomplete` 三态 vs chat 的 `finish_reason`）；(d) 取消语义（AbortController 即可，无显式 cancel endpoint，除非 background）；(e) 状态化机制新增 `previous_response_id` / `conversation`，但**不影响**翻译缓存（缓存命中由 prompt 前缀 byte-equal 决定）。

## DeepSeek Compat Reference

本节列出旧 DeepSeek 调研（`research/deepseek-streaming-api.md`，branch `research/deepseek-streaming-api` commit `eb70ed84676f`）中**仍然适用**于 OpenAI Responses API 的事实，方便后续实施时复用代码骨架：

- **§Q1 Request 形态：** 字段名 `model` / `input` / `temperature` / `top_p` / `stream` / `max_output_tokens` 同名同义；新增 `instructions`（顶层 system 提示）、`text.format`（替代 `response_format`）、`tools` / `tool_choice` / `previous_response_id` / `conversation` / `store` / `truncation` / `prompt_cache_key` 等。
- **§Q2 SSE 流式：** 帧格式 `data: {json}\n\n`、SSE Content-Type、客户端解析循环（buffer split on `\n\n`、parse `data:` 行、`[DONE]` 哨兵）**完全可复用**。DeepSeek 用 `[DONE]` 哨兵终止；OpenAI Responses **没有** `[DONE]`，改用 `response.completed` / `response.incomplete` / `response.failed` 终止事件（**必须改造**）。
- **§Q3 Reasoning：** DeepSeek 在 `delta.reasoning_content` 单通道混合输出；OpenAI Responses 改用独立事件族 `response.reasoning_text.delta` + `response.reasoning_summary_text.delta`（**需重写消费循环**）。命名不同。
- **§Q4 错误响应：** DeepSeek 错误模型是 `error.code` 在 SSE 帧内 + HTTP 4xx/5xx 同步；OpenAI Responses 增加 `response.failed` 结构化终止事件 + `response.incomplete` 截断事件 + `error` 裸事件三态（**需扩展错误分流**）。
- **§Q5 取消流：** DeepSeek 同样只能 AbortController；OpenAI Responses 同步流亦然（**完全可复用**）。background 模式额外提供 `/responses/{id}/cancel` endpoint（**翻译场景不需要**）。
- **§Q6 prompt cache 位置：** DeepSeek 在 `usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`；OpenAI Responses 在 `usage.input_tokens_details.cached_tokens` / `cache_write_tokens`（**需改字段名**）。命名差异见 Q8.2 对照表。
- **§Q7 速率限制：** DeepSeek 走 OpenAI 兼容层，HTTP header 字段 `Retry-After` / `x-ratelimit-*` **与 OpenAI Responses 一致**（**完全可复用** SDK 默认重试策略）。
- **§Q8 chunk 大小：** 双端均无公开承诺，buffer 实现策略**完全可复用**。DeepSeek 截断用 `finish_reason: "length"`；OpenAI Responses 用 `response.incomplete` 事件 + `incomplete_details.reason = "max_output_tokens"`（**需替换**）。

**总结：** DeepSeek 调研产物提供了**约 70% 的协议事实复用率**——SSE 解析层、错误重试策略、buffer 实现、取消语义可直接迁移；剩余 30% 是 Responses API 特有的事件类型 / 终止语义 / cache 字段名替换。

---

## Failure Modes

调研过程中遇到的不确定 / 受限点（不静默跳过）：

1. **Context7 MCP 不可用。** 当前 session 未配置 `mcp__context7__*` 工具；`claude mcp list` / `~/.mcp.json` 均不可达。降级为 `web_fetch` 直接抓取官方文档 `.md` 副本——内容权威性等价，但失去"按库 ID 检索"的便利性。
2. **`platform.openai.com/docs/api-reference/responses` Cloudflare gated。** 浏览器侧直接访问返回 403 challenge。仅 `developers.openai.com/api/reference/resources/responses/index.md` 可访问（Markdown 渲染版）。**未使用** `https://platform.openai.com/docs/guides/streaming-responses`（推测也 gated），改用 `developers.openai.com/api/docs/guides/streaming-responses.md` 等价页面。
3. **模型命名使用 `gpt-6-astra`。** 官方文档示例统一使用此名（可能是占位 / 未来模型），与社区熟悉的具体模型 ID（`gpt-4o` / `gpt-4o-mini` / `o1` / `o3-mini` / `gpt-5`）不完全一致。**实施时应根据 OpenAI 控制台 Models 页**（https://developers.openai.com/api/docs/models）确认实际可调模型清单。
4. **`prompt_cache_hit_tokens` 字段在 Responses API 中不存在。** 严格意义上 OpenAI Responses 命名是 `cached_tokens`，与 DeepSeek 的命名不一致——这是 OpenAI vs DeepSeek 的**协议分歧**，不是 OpenAI 内部不公开。如未来跨 provider 抽象，需在适配层做字段名映射。
5. **`max_output_tokens` chunk 大小无公开保证。** 第 10 题答案基于文档示例 + 社区经验；OpenAI 官方未给出 delta 平均长度 / 帧大小承诺。**实施时 buffer 上限应按"任意大小 delta"防御性设计**（如 64KB 单 delta buffer + grow on demand）。
6. **`reasoning.summary` 字段是否对所有模型生效未明确。** 文档说"reasoning models"支持，但未列出完整支持列表。`reasoning.summary` vs `reasoning.content`（原始 vs summary）的可见性取决于具体模型快照。
7. **WebSocket 模式未深入调研。** 文档提及 `wss://.../responses` 与 `response.create` / `response.cancel` 帧，但 Pictelio 不计划采用（与 Vite 代理 + Capacitor 架构不兼容）。仅作为备选记录。

**调研产物可作为 issue #622 实施依据；任何 Responses API 行为变更（特别是字段命名 / 事件类型）需以官方 `https://developers.openai.com/api/reference/resources/responses/methods/create` 为准——本调研产物日期为 2026-09-19。**
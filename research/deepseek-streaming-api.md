# Research: DeepSeek Streaming API

> **目的**：回答 issue #622 的 8 个事实问题，为 Wayfinder map #617 的子 ticket（DeepSeek 流式 API 集成）提供事实底座。
> **调研时间**：2026-09-19（DeepSeek 文档本次抓取日期）。
> **结论一句话**：DeepSeek `/chat/completions` 是 OpenAI 兼容协议（SSE + `[DONE]` 哨兵 + 增量 `delta`），thinking 模式通过 `delta.reasoning_content` 与 `delta.content` 同级共存；流内**不携带**错误事件，所有错误走 HTTP 状态码（400/401/402/422/429/500/503）；流取消依赖客户端关闭底层 HTTP/SSE（无服务端取消端点）；429 由**并发配额**触发（不是 RPM），平台 API key UI 详情需要登录 cloudfront 后访问。

---

## Q1: 流式请求的 request 形态

**Endpoint**：`POST https://api.deepseek.com/chat/completions`
**Header**：`Authorization: Bearer <DEEPSEEK_API_KEY>`、`Content-Type: application/json`
**关键字段**（与 SSE 行为相关）：

| 字段 | 类型 | 默认 | 对 SSE 行为的影响 |
| --- | --- | --- | --- |
| `model` | string | — | 模型名；`deepseek-v4-pro` / `deepseek-flash`（v4.1-flash） |
| `messages` | array | — | 多轮对话（system/user/assistant/tool） |
| `stream` | boolean | `false` | **必须 `true`** 才走 SSE |
| `stream_options` | object | `null` | `{include_usage: true}` 可让最后一个 SSE chunk 携带 `usage` 字段（用于 prompt cache 读取，见 Q6） |
| `thinking` | object | `{type: "enabled"}`（v4-pro / v4-flash 默认可控） | `thinking.type: "enabled"` 时 SSE delta 中**会**出现 `reasoning_content` 字段；`"disabled"` 时该字段为空 / 不出现 |
| `reasoning_effort` | enum `low`/`high`/`max` | `high` | 仅在 `thinking.type=enabled` 时生效；控制思考预算（不影响 SSE 字段名，只影响 token 用量与耗时） |
| `temperature`、`top_p`、`presence_penalty`、`frequency_penalty` | number | — | **thinking 模式下会被服务端忽略**（兼容性静默丢弃），SSE 输出不变 |
| `tools`、`tool_choice` | array / string | — | 工具调用；流式下 `finish_reason` 可能为 `tool_calls`（见 Q2） |
| `max_tokens` | int | — | 触发 `finish_reason: "length"` |

**思考模式互斥参数**（v4-pro / v4-flash）：在 `thinking.type=enabled` 时，服务端把 `temperature/top_p/presence_penalty/frequency_penalty` 一律忽略，**只**取 `top_p=0.95` 和默认采样参数。这是兼容老客户端的"静默降级"，调用方不会感知到错误。

**最小流式请求示例**：

```json
{
  "model": "deepseek-v4-pro",
  "messages": [{"role":"user","content":"Hello"}],
  "stream": true,
  "stream_options": {"include_usage": true},
  "thinking": {"type": "enabled"}
}
```

[source: https://api-docs.deepseek.com/api/create-chat-completion]
[source: https://api-docs.deepseek.com/guides/thinking_mode]

---

## Q2: SSE 响应的事件序列

**Content-Type**：`text/event-stream`
**事件格式**：每行 `data: <json>`，多个 chunk 之间以 `\n\n` 分隔；结束哨兵是裸行 `data: [DONE]`（注意：仍是 `data:` 前缀，但 payload 是字符串 `[DONE]`，**不是** JSON）。

**完整事件序列**（典型 stream-from-empty case）：

```
data: {"id":"...","object":"chat.completion.chunk","created":1700000000,
       "model":"deepseek-v4-pro","system_fingerprint":"fp_xxx","choices":
       [{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"...","choices":[{"index":0,"delta":
       {"reasoning_content":""},"finish_reason":null}]}

data: {"id":"...","choices":[{"index":0,"delta":
       {"reasoning_content":"The user said hello, I should..."},
       "finish_reason":null}]}

data: {"id":"...","choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":null}]}

data: {"id":"...","choices":[{"index":0,"delta":{"content":" there!"},"finish_reason":null}]}

data: {"id":"...","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],
       "usage":{"prompt_tokens":...,"completion_tokens":...,
                "total_tokens":...,
                "prompt_tokens_details":{"cached_tokens":...},
                "prompt_cache_hit_tokens":...,"prompt_cache_miss_tokens":...}}

data: [DONE]
```

**关键事实**：

1. **首个 chunk**只携带 `delta.role: "assistant"`，无 content / reasoning_content；这是 OpenAI 兼容协议的事实标准，不是 DeepSeek 私有行为。
2. **每个 chunk 的 `delta`** 同时包含 `content` 与 `reasoning_content` 两个可选字段；在 thinking 模式下先出现 `reasoning_content`、再出现 `content`（见 Q3）。
3. **`finish_reason` 只在最后一条带 content 的 chunk 之后的那条 chunk 里出现一次**，值域固定为以下六种之一：
   - `stop`（自然结束）
   - `length`（命中 `max_tokens`）
   - `content_filter`（内容审核拦截）
   - `tool_calls`（触发了 tool call，工具定义在流式下会单独走 `delta.tool_calls` 增量数组）
   - `insufficient_system_resource`（服务端算力不足；流式下偶发可见）
   - `aborted`（服务端主动中断；不是客户端主动 cancel，见 Q5）
4. **`usage` 字段**：仅当请求带 `stream_options: {include_usage: true}` 时，在**倒数第二条** chunk（`finish_reason` 出现的那条）里附在根级；不带 `include_usage` 则整条流没有 `usage`，调用方拿不到 token 计数与 cache 命中。
5. **`system_fingerprint`** 出现在首条 chunk，模型版本指纹；可用于客户端日志埋点。
6. **`[DONE]` 哨兵**：固定为字面量 `data: [DONE]\n\n`，客户端解析逻辑就是 `payload === "[DONE]"`。

[source: https://api-docs.deepseek.com/api/create-chat-completion]

---

## Q3: `reasoning_content` 与 `content` 在 SSE 里的交错

**字段位置**：`reasoning_content` 与 `content` **同级**，都挂在 `choices[].delta` 上，不是嵌套对象：

```json
{"choices":[{"index":0,"delta":{"reasoning_content":"...","content":""}}]}
```

**交错顺序**（thinking 模式下，按生成先后）：

1. **思考阶段**：连续若干条 chunk，`delta.reasoning_content` 累加字符串，`delta.content` 通常为空字符串 `""`，**`finish_reason` 始终为 `null`**。这些 chunk 之间会穿插 SSE keep-alive 注释行（见 Q5/Q7）。
2. **答复阶段**：模型推理完成后切换，`delta.reasoning_content` 不再增长（保持为空 `""` 或缺失），`delta.content` 开始累加字符串。`finish_reason` 仍为 `null`。
3. **终止 chunk**：`delta` 字段为空对象 `{}`，`finish_reason` 出现（`stop` / `length` / `tool_calls` 等），整流结束，最后跟 `data: [DONE]`。

**同一个 chunk 内** `reasoning_content` 与 `content` **可以**同时非空（边界帧），但实际生产中极少同时出现，常见模式是二选一。

**non-thinking 模式**：`reasoning_content` 始终为空 `""`，客户端解析时若只需展示 content，可直接忽略 `reasoning_content`（判 `length === 0` 即可）。

**客户端拼装建议**：

- 拼接两个独立字符串：`reasoning_text += delta.reasoning_content ?? ""` 与 `answer_text += delta.content ?? ""`。
- 不要把 `reasoning_content` 与 `content` 拼到同一个 buffer 里——用户展示与日志埋点通常需要分开。

[source: https://api-docs.deepseek.com/api/create-chat-completion]
[source: https://api-docs.deepseek.com/guides/thinking_mode]

---

## Q4: 错误响应的 SSE 形态

**结论先行**：DeepSeek 流式响应中**没有**流内错误事件，**所有错误都走 HTTP 状态码**，SSE 流在状态码非 200 时不会启动（或在启动后被服务端主动关闭）。

**HTTP 状态码语义**：

| 状态码 | 含义 | 触发条件 |
| --- | --- | --- |
| `400` | Invalid Format | 请求体不是合法 JSON / 缺字段 |
| `401` | Authentication Fails | API key 缺失、错误或被吊销 |
| `402` | Insufficient Balance | 账户余额或赠送额度耗尽 |
| `422` | Invalid Parameters | 字段类型 / 取值不合法（例如 messages 为空数组、temperature 越界） |
| `429` | Rate Limit Reached | **并发配额超限**（不是 RPM，详见 Q7） |
| `500` | Server Error | 服务端内部错误 |
| `503` | Server Overloaded | 算力紧张 |

**错误响应体**（非流式，直接 JSON）：

```json
{
  "error": {
    "message": "Authentication Fails (no such user api key)",
    "type": "authentication_error",
    "code": "invalid_request_error"
  }
}
```

**对 SSE 的影响**：

- 当 HTTP 状态码 ≥ 400 时，**不会**返回 `text/event-stream`，调用方拿到的就是一段 JSON 错误体。
- **如果**流已经建立（HTTP 200 + `text/event-stream`）后服务端出问题（例如连接中途 5xx），按 HTTP/1.1 长连接语义，TCP 连接会被服务端断开；客户端通过读取 IOException / `EOFException` 感知。
- 流内**不会**出现 `event: error` 这类 SSE 事件（与 Anthropic Messages API 的 `event: error` 行为不同），DeepSeek 严格遵循 OpenAI 风格——只在 HTTP 层报错。

**4xx 可重试性提示**（不在文档中，由 HTTP 语义推断）：

- `400/401/402/422` 是请求/凭据类错误，**不可**自动重试，客户端应直接报错。
- `429` 是限流错误，**可**配合指数退避重试（详见 Q7）。
- `500/503` 是服务端错误，**可**退避重试（无文档明确的 `Retry-After` 头规范）。

[source: https://api-docs.deepseek.com/quick_start/error_codes]

---

## Q5: 取消在途流式请求的方法

**官方文档没有专门讲"如何取消在途流式请求"。** 这是 DeepSeek 与 OpenAI 兼容协议的共同事实——服务端不提供 cancel endpoint，客户端只能通过**关闭底层 TCP 连接**中断流。

**客户端实现矩阵**：

| 客户端栈 | 取消方式 |
| --- | --- |
| OkHttp（Android / JVM） | `Call.cancel()` 或关闭 `EventSourceListener`；底层会发送 TCP FIN/RST；OkHttp 在调用 cancel 后 `Response.body().source()` 读 EOF / 抛 `IOException` |
| `fetch` + `ReadableStream`（Web） | `controller.abort()`；流 listener `onAbort` / `onError` 触发 |
| Node `eventsource-parser` / `openai-node` | `stream.controller.abort()`（OpenAI SDK 4.x 暴露的 `Stream.controller`） |
| OpenAI Python SDK | `stream.close()` 或 `with` 块退出；底层是 `httpx.Response` 的 stream |
| SolidJS / 浏览器 fetch | 同 Web；`AbortController.abort()` |

**服务端行为**（来自 keep-alive 文档）：

- **Keep-alive**：流式响应在用户推理完成前，DeepSeek 服务端会**周期性**发送 SSE 注释行 `: keep-alive\n\n`（无前缀 `data:`），间隔约 15-30 秒，目的为穿透中间代理（nginx、负载均衡）不被踢掉。
- **10 分钟空闲超时**：如果一个流式请求超过 10 分钟仍未开始生成 token（即 reasoning 阶段都没启动），服务端会**主动关闭连接**。客户端会感知到对端关闭（EOF），并在代码中表现为流读取抛出 `IOException` / 触发 `onError`。
- **`finish_reason: "aborted"`**：这是服务端**自身**的中断（例如推理过程被打断 / 资源回收），**不是**客户端取消的语义。客户端主动 cancel 时通常不会拿到这条 chunk——TCP RST 来得更早。

**客户端取消的设计建议**（基于文档推断，非官方推荐）：

1. 在 UI 层用 `AbortController` / `Call` 持有引用，用户切页 / 关闭按钮触发 `abort()`。
2. 不需要给服务端发"取消"信号——关闭 TCP 就够。
3. 不要尝试解析 `[DONE]` 来判断"是否结束"；取消路径下永远不会有 `[DONE]`，要靠 `IOException` / `abort` 事件判断。

[source: https://api-docs.deepseek.com/quick_start/rate_limit]（keep-alive 与 10 分钟超时）

---

## Q6: Prompt cache 标记在流式响应里的位置

**字段树**（仅在 `stream_options.include_usage: true` 时出现，位于 `finish_reason` 所在的那条 chunk 的根级 `usage`）：

```json
{
  "usage": {
    "prompt_tokens": 1234,
    "completion_tokens": 567,
    "total_tokens": 1801,
    "prompt_tokens_details": {
      "cached_tokens": 800
    },
    "prompt_cache_hit_tokens": 800,
    "prompt_cache_miss_tokens": 434
  }
}
```

**注意三个字段的语义**：

1. `prompt_tokens_details.cached_tokens` —— OpenAI 兼容字段，等于 DeepSeek 缓存命中 token 数。
2. `prompt_cache_hit_tokens` —— DeepSeek 自有字段，与 `cached_tokens` 同义冗余（为了兼容两种读取习惯）。
3. `prompt_cache_miss_tokens` —— DeepSeek 自有字段，未命中缓存的输入 token 数。
4. `prompt_tokens == prompt_cache_hit_tokens + prompt_cache_miss_tokens`（同一请求内守恒）。

**缓存语义**（重要，影响计费）：

- DeepSeek 默认开启**磁盘前缀缓存（Context Caching on Disk）**，用户**无需任何配置**。
- 命中条件：**请求的输入前缀完全等于**之前某次请求已持久化的"cache prefix unit"。
- 持久化时机：请求边界（用户输入末尾 / 模型输出末尾）、公共前缀检测、固定 token 间隔。
- 计费：缓存命中时，输入 token 走"cache hit"价格（off-peak $0.003/1M = `deepseek-flash`，$0.022/1M = `deepseek-v4-pro`）；未命中走 cache miss 价格（$0.15 / $0.66 off-peak）。
- 多轮对话天然命中：连续多轮 messages 数组的 prefix 会被自动复用。

**对调用方的契约**：

- 不发 `stream_options.include_usage: true` → 整条流**拿不到** cache 命中信息 → 无法做成本归因。
- 拿到 `usage` 后应在流**结束**（即 `[DONE]` 之前的那条 chunk）解析，不要在中间 chunk 去找。
- 非流式响应（`stream: false`）下，`usage` 在响应体的根级，结构一致。

[source: https://api-docs.deepseek.com/guides/kv_cache]
[source: https://api-docs.deepseek.com/quick_start/pricing]
[source: https://api-docs.deepseek.com/quick_start/token_usage]

---

## Q7: 速率限制（429 + retry-after）的语义

**核心结论**：DeepSeek 公开文档**只**按**并发数（concurrency）**限速，**没有公开**每分钟请求数（RPM）或每秒 token 数（TPS）配额。

**当前并发配额**（2026-09-10 更新）：

| 模型 | 并发上限 |
| --- | --- |
| `deepseek-flash` (V4.1-Flash) | 2500 |
| `deepseek-v4-pro` (V4-Pro) | 500 |

**触发条件**：同一 API key 下，**同时活跃的请求数**超过上述阈值时，新请求返回 `429 Rate Limit Reached`。

**隔离维度（user_id）**：默认按调用方的"user"概念隔离——这对个人开发者影响不大，但对多租户后端服务有约束：建议在请求体里加 `"user": "<stable-id>"` 字段来把不同用户/项目的并发配额分开。KVCache 也按 `user_id` 隔离，避免跨租户污染。

**Retry-After 头**：

- DeepSeek 文档**没有**显式声明 429 响应是否带 `Retry-After` 头或 `Retry-After: <unix-timestamp>` 语义。
- 按 HTTP 标准语义推断：客户端应优先读 `Retry-After`；缺失则按指数退避（首次 1s，cap 30s）。
- **不要**盲目短间隔重试——并发超限不会因为重试而释放配额，需要等待在飞请求完成。

**Keep-alive 与超时**（与流式限速相关）：

- 非流式：服务端返回前会发空行 keep-alive。
- 流式：服务端发 `: keep-alive` SSE 注释（见 Q5）。
- 任一形态下，**若 10 分钟内未开始推理**，服务端会主动关闭连接（视为请求超时，不是 429）。

**429 后的客户端策略建议**（基于文档 + HTTP 语义推断）：

1. 读取 `Retry-After` 头；若有则 sleep 等待；若没有则 1s → 2s → 4s → 8s 指数退避（cap 8-16s）。
2. 不要立即重试——并发计数是"在飞请求"维度，等待几秒即可。
3. 429 与 5xx 不同的语义：429 = "配额问题，重试可能成功"；5xx = "服务端问题，重试可能成功"。两者都可重试，但 429 的等待时间通常更长。

[source: https://api-docs.deepseek.com/quick_start/rate_limit]
[source: https://api-docs.deepseek.com/quick_start/pricing]

---

## Q8: DeepSeek API key 权限范围（创建、撤销、配额）

**官方文档覆盖面**：`api-docs.deepseek.com` 对 API key 的管理只提到**"在哪里创建"**——`https://platform.deepseek.com/api_keys`。**未**文档化权限模型、配额、撤销流程、过期机制等细节。

**API key 管理的实际位置**：

- 入口：`https://platform.deepseek.com/api_keys`（Web UI，需登录）。
- 本次抓取返回 **403 ERROR**（CloudFront 拒绝），UI 内容无法直接读取——属于"已知不可达"，详见 Failure Modes。

**从公开信息 + OpenAI 兼容协议推断**（标 ⚠️ 表示非官方文档证实）：

| 维度 | 行为 |
| --- | --- |
| 创建 | Web UI "API Keys" 页面 → "Create new secret key"；生成一次性明文，后续**只显示一次**；无公开 API 创建端点 ⚠️ |
| 撤销 / 删除 | Web UI 列出所有 key，每条可"Delete"；删除后立即失效（401）；无公开 API 撤销端点 ⚠️ |
| 权限范围（scope） | **未文档化**；推断为单 key 等同账户访问（所有可用模型、所有可用功能）⚠️ |
| 配额 | 按账户级别，并发配额见 Q7；余额走 `402 Insufficient Balance`；无 per-key 配额设置 ⚠️ |
| 过期 | 无文档化过期机制；账户充值即可维持 ⚠️ |
| 绑定 IP / 来源 | 无文档化 IP 白名单；HTTPS + Bearer 即可 ⚠️ |
| 子账户 / RBAC | 无文档化；账户级别单一 ⚠️ |

**给 issue #622 的实现提示**：

- 单 key 即"全权限账户代理"——建议在客户端把 key 存到平台原生安全存储（Android Keystore），不要给 UI 暴露明文。
- 撤销检测：401 + 错误消息含 `Authentication Fails (no such user api key)` → 提示用户重新生成。
- 余额监控：402 → 提示充值；429 → 退避重试；两者语义不重叠。

[source: https://api-docs.deepseek.com/quick_start/error_codes]（提及创建 key 入口）
[source: https://platform.deepseek.com/api_keys]（本次抓取 403，不可达）

---

## Summary

1. **协议形态**：DeepSeek `/chat/completions` 是 OpenAI 兼容 SSE（`data:` 行 + `[DONE]` 哨兵），`thinking.type=enabled` 时在 `delta` 里增加 `reasoning_content` 字段且先于 `content` 输出；启用 `stream_options.include_usage: true` 后 `usage`（含 `prompt_cache_hit_tokens`）出现在 `finish_reason` 所在的那条 chunk。
2. **错误与限流语义**：错误**只**走 HTTP 状态码（400/401/402/422/429/500/503），SSE 流内**无**错误事件；限流是**并发配额**（`deepseek-flash`=2500、`deepseek-v4-pro`=500），文档**未**声明 `Retry-After` 头语义，需客户端自行退避。
3. **取消与 key 管理**：取消完全靠客户端关闭 TCP（无服务端 cancel endpoint，10 分钟空闲会被服务端主动关连接）；API key 权限粒度、撤销、配额**未**在官方文档中明文——只有"创建入口"指向 Web UI，相关深度信息在 `platform.deepseek.com/api_keys` 上（本次抓取被 CloudFront 403 阻断，详见 Failure Modes）。

---

## Failure Modes

调研过程中遇到的失败路径与备选方案：

| 失败 | 现象 | 备选 / 处理 |
| --- | --- | --- |
| `platform.deepseek.com/api_keys` | CloudFront 返回 **403 ERROR**（"Request blocked. We can't connect to the server for this app or website at this time"），抓取不到 UI 内容 | 文档未覆盖 key 权限模型；改在 Q8 中**显式标注 ⚠️ 推断**；如需权威信息，需登录 DeepSeek 账户手动核对（属用户操作，agent 不应代为执行） |
| `static.deepseek.com/faq/index.html`（FAQ 站点） | 单页 SPA，HTML body 为空 `<div id="root"></div>`，需 JS 渲染才能拿到内容；`web_fetch` 不渲染 JS | 已记录为已知失败源；FAQ 内容不影响 8 个核心问题答案 |
| 取消（Q5）官方文档 | 文档**未**单独讲述"客户端如何取消流式请求" | 依赖 OpenAI 兼容协议的事实 + 官方 keep-alive / 10 分钟超时段落间接推断；建议在实现里加 AbortController，并在测试中以 TCP 关闭而非 HTTP cancel 验证 |
| `Retry-After` 头语义（Q7） | 文档未声明 429 响应是否带 `Retry-After` 头 | 标注为"按 HTTP 标准推断"；建议在客户端先用 `if (response.headers.get('Retry-After'))` 探测，没有则退避 |
| API key 权限 / scope（Q8） | 文档仅指向 Web UI，无 API 文档 | 显式声明"⚠️ 非官方文档证实"，建议运营侧人工核对；不臆造"per-key 配额"或"过期机制" |
| Model 版本 | 调研期间（2026-09-19）DeepSeek 文档为最新：V4.1-Flash 发布于 2026-09-10，`deepseek-chat` / `deepseek-reasoner` 旧别名已停服（2026-07-24） | 引用均带 URL 与抓取日期；建议引用方再次核对版本一致性 |
| `Context7` 工具不可用 | 本次环境无 `mcp__context7__*` 工具 | 降级到 `web_fetch` 抓 `api-docs.deepseek.com`，所有引用为官方一手 URL |
| Git push | 任务规约禁止 push 到 origin | 仅本地 commit，等用户审阅 |
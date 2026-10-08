# Research: LLM Endpoint Compatibility Matrix

> 父 ticket：[Pictelio #617](https://github.com/a1121611810/Pictelio/issues/617)（app-lynx 端小说翻译）
> 本 ticket：[Pictelio #625](https://github.com/a1121611810/Pictelio/issues/625)（用户自填 LLM endpoint 兼容性矩阵调研）
> 调研日期：2026-09-19
> 协议目标：**OpenAI Responses API**（`POST /v1/responses`）
> 调研方法：`web_fetch` 厂商官方文档 + GitHub Issues + OpenRouter/OpenAI/Azure/DeepSeek 官方页面
> 注意：AGENTS.md 中规定的 Context7 / MDN MCP 工具在本 session 不可用，故使用 `web_fetch` 直查官方文档

---

## 0. 一句话结论（TL;DR）

| Provider | `/v1/responses` 兼容 | base URL 模板 | 文档锚 |
|---|---|---|---|
| OpenAI 官方 | ✅ GA（v1 reference） | `https://api.openai.com/v1` | <https://developers.openai.com/api/reference/resources/responses/> |
| Azure OpenAI | ✅ GA（v1 reference） | `https://<RESOURCE>.openai.azure.com/openai/v1/` | <https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses> |
| DeepSeek | ✅（最近为 Codex 上线） | `https://api.deepseek.com` | <https://api-docs.deepseek.com/guides/responses_api> |
| OpenRouter | ❌（仅 `/api/v1/chat/completions`） | `https://openrouter.ai/api/v1` | <https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion> |
| vLLM（自托管） | ✅ | `http://<host>:<port>/v1` | <https://docs.vllm.ai/en/latest/features/reasoning_outputs/> |
| Ollama（自托管） | ⚠️ 已加，buggy | `http://<host>:11434/v1` | <https://github.com/ollama/ollama/issues/18306> |
| 智谱 GLM | ❌ 只见 `/chat/completions`（OpenAI 兼容） | `https://open.bigmodel.cn/api/paas/v4/` | <https://docs.bigmodel.cn/cn/guide/develop/openai/introduction> |
| 通义千问（Qwen DashScope） | ❌ OpenAI 兼容模式仅 `/chat/completions` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | <https://help.aliyun.com/zh/model-studio/> |
| 文心一言（Ernie / 千帆） | ❌ 自有协议 + OpenAI 兼容模式 `/chat/completions` | `https://qianfan.baidubce.com/v2` | （千帆官方） |

**关键判断**：用户填入 OpenAI / Azure OpenAI / DeepSeek / 任何 vLLM 端点都可以走通；填入 OpenRouter / 智谱 / 通义千问 / 文心一言 / Ollama（弱支持）会在第一个 `/v1/responses` 调用时立刻失败，**前端必须给出清晰错误**。

---

## 1. 七问答案（对齐 issue #625 body）

### Q1 · OpenAI 官方 `/v1/responses` endpoint GA 状态、版本要求、支持模型

- **GA 状态**：✅ 已在 OpenAI API Reference v1 公开正式发布（canonical path `developers.openai.com/api/reference/resources/responses/`，原 `platform.openai.com/docs/api-reference/responses` 当前被 Cloudflare challenge 拦截但旧 URL 与新 URL 等价）。
- **版本 / API 版本要求**：v1 API；OpenAI Python SDK / JS SDK 的 `client.responses.create(...)` 调用方式已稳定。
- **支持模型（来自 Azure Foundry 官方"Responses API supported models"清单，反向核对 OpenAI 官方）**：
  - `gpt-5`、`gpt-5-mini`、`gpt-5-nano`、`gpt-5-pro`、`gpt-5-codex`、`gpt-5-chat`
  - `gpt-5.1`、`gpt-5.1-codex`、`gpt-5.1-codex-max`、`gpt-5.1-chat`
  - `gpt-5.2`、`gpt-5.2-chat`、`gpt-5.2-codex`
  - `gpt-5.3-chat`、`gpt-5.3-codex`
  - `gpt-5.4`、`gpt-5.4-pro`、`gpt-5.4-mini`、`gpt-5.4-nano`
  - `gpt-5.5`
  - `gpt-5.6-sol`、`gpt-5.6-luna`、`gpt-5.6-terra`
  - `gpt-6-astra`
  - `gpt-chat-latest`、`gpt-chat-latest`（多版本）
  - `gpt-4o`（`2024-08-06`、`2024-11-20`）、`gpt-4o-mini`
  - `gpt-4.1`、`gpt-4.1-mini`、`gpt-4.1-nano`
  - `gpt-image-1`、`gpt-image-1-mini`
  - `o1` / `o3` / `o3-mini` / `o4-mini`（reasoning 系列 — Responses API 同时支持 `reasoning.effort` / `reasoning.summary`）
  - `computer-use-preview`
- **特性**：内置 reasoning（`reasoning.effort`）、built-in tools（`web_search`、`file_search`、`code_interpreter`、`computer_use`、`image_generation`、`mcp`）、multi-agent orchestration（参考 Azure Foundry 文档）。
- **URL 模板**：`POST https://api.openai.com/v1/responses`
- **文档**：<https://developers.openai.com/api/reference/resources/responses/>（同义旧 URL `https://platform.openai.com/docs/api-reference/responses`）。

### Q2 · Azure OpenAI 是否提供 Responses API 等价 endpoint？URL 模板差异？

- **是**。Azure Foundry 官方文档《Use the Azure OpenAI Responses API》明确把 Responses API 作为 v1 通用 endpoint 暴露。
- **URL 模板差异（关键）**：
  - 旧（chat-completions 风格）：`https://<RESOURCE>.openai.azure.com/openai/deployments/<DEPLOYMENT>/chat/completions?api-version=...`
  - 新（v1 Responses）：`https://<RESOURCE>.openai.azure.com/openai/v1/responses`（model 字段用 deployment 名作为 `model` 字段传，**不再走 query string api-version**，而是走 `api_version: "preview"` 在 `default_headers`）
  - REST 示例（来自 Azure 官方）：
    ```bash
    curl -X POST https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/responses \
      -H "Content-Type: application/json" \
      -H "api-key: $AZURE_OPENAI_API_KEY" \
      -H "x-ms-oai-image-generation-deployment: $IMAGE_MODEL_NAME" \
      -d '{ "model": "MODEL_NAME", "input": "...", "tools": [...] }'
    ```
  - OpenAI SDK Python 示例：
    ```python
    client = OpenAI(
      base_url="https://YOUR-RESOURCE-NAME.openai.azure.com/openai/v1/",
      api_key=token_provider,
      default_headers={"x-ms-oai-image-generation-deployment": IMAGE_MODEL_NAME,
                      "api_version": "preview"},
    )
    response = client.responses.create(model="MODEL_NAME", input="...", tools=[...])
    ```
- **认证**：`api-key: <key>` header，或 Microsoft Entra ID `https://ai.azure.com/.default` scope bearer token。
- **支持模型**：同 OpenAI 官方子集（gpt-5.x / gpt-4.1 / gpt-4o / gpt-image-1 / computer-use-preview），跨 ~32 个 region（australiaeast / eastus / eastus2 / japanwest / westus / westeurope / …）。详见 Azure 文档「Supported regions / Supported models」两节。
- **注意事项**：必须使用 v1 API；旧 query string `api-version=` 不能用于 `/v1/responses`（走 header）。Troubleshooting 401/403 → Entra token scope 必须为 `https://ai.azure.com/.default`；404 → model 字段必须等于 deployment 名。

### Q3 · DeepSeek 是否支持 `/v1/responses`？

- **是**。DeepSeek 官方文档侧栏明确有「Using the Responses API」专项页（`/guides/responses_api`），描述"为支持 Codex 集成而新增 Responses API 兼容格式"。
- **base URL**：`https://api.deepseek.com`（与 chat/completions 同一 host，复用 `base_url`）
- **调用示例**（来自官方）：
  ```python
  from openai import OpenAI
  client = OpenAI(api_key="<DEEPSEEK_API_KEY>", base_url="https://api.deepseek.com")
  response = client.responses.create(
      model="deepseek-flash",
      instructions="You are a helpful assistant.",
      input="Hi, how are you?",
  )
  print(response.output_text)
  ```
- **支持模型**：
  - `deepseek-flash`（默认模型，原 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 已并入）
  - `deepseek-v4-pro`
- **与 OpenAI Responses 的兼容性矩阵（关键 — DeepSeek 文档原文摘录）**：
  | 类别 | 字段 | 状态 |
  |---|---|---|
  | Top-level 参数 | `model`, `input`, `instructions`, `stream`, `temperature`, `top_p`, `max_output_tokens`, `top_logprobs`, `user` | ✅ 支持 |
  | | `tools` | ⚠️ 仅 `function` 支持；`web_search` / `file_search` / `code_interpreter` / `computer_use` / `mcp` / 其他内置工具均 ignored |
  | | `tool_choice` | ✅ 支持（`none` / `auto` / `required` / 指定 tool） |
  | | `reasoning` | ⚠️ `effort` 支持；`summary` 接受但不生成 |
  | | `text` | ⚠️ `format` 全支持；`verbosity` 接受但无效 |
  | | `parallel_tool_calls`, `max_tool_calls` | ignored |
  | | **`previous_response_id`**, **`conversation`**, **`store`**, **`background`**, **`metadata`**, **`include`**, **`prompt`**, **`truncation`**, **`service_tier`**, **`safety_identifier`**, **`prompt_cache_key`**, **`prompt_cache_retention`**, **`context_management`**, **`stream_options`** | ❌ NOT SUPPORTED（stateless） |
  | | unsupported 参数 | ⚠️ **silently ignored**（不报错 → 旧 Responses 客户端零修改可用） |
  | Input Items | `message` / `function_call` / `function_call_output` / `reasoning` / `custom_tool_call`（仅 `apply_patch`）/ `custom_tool_call_output` | ✅ 支持 |
  | | `web_search_call` | 仍可还原回 context |
  | Tools | `function` | ✅ 支持 |
  | | `custom` | ⚠️ 仅 `{type: "custom", name: "apply_patch"}`（Codex 兼容） |
  | | `web_search` / `file_search` / `code_interpreter` / `computer_use` / `mcp` | ignored |
- **流式**：原生 SSE（events：`response.created` / `response.in_progress` / `response.output_item.added|done` / `response.content_part.added|done` / `response.reasoning_text.delta|done` / `response.output_text.delta|done` / `response.function_call_arguments.delta|done` / `response.custom_tool_call_input.delta|done` / `response.completed` / `response.incomplete` / `response.failed`），**没有** OpenAI 默认的 `data: [DONE]` 信号（流结束于 `response.completed/incomplete/failed` event）。Pictelio 翻译流实现必须按 event 类型分派而非按 `[DONE]` 终止。
- **图像输入**：`input_image` content part（JPEG / PNG / GIF / WebP，`detail: low|high|original|auto`），仅 `user` / `developer` 消息允许；`system` / `assistant` 中图像返回 400。
- **图片大小限制**与 Chat Completions 共享：inline 单张 ≤32 MiB；带 `file_id` 单张 ≤64 MiB；总请求 ≤200 MiB（with file_id）/ 64 MiB（无 file_id）；≤600 张/请求。

### Q4 · OpenRouter 是否暴露 Responses API？URL 模板？

- **不暴露**。证据：
  - `https://openrouter.ai/docs/api-reference/responses` → **HTTP 404**（Mintlify 自定义 404 渲染，标题 "Page not found!"）
  - OpenRouter 当前 API Reference 顶级目录只有 `chat/completions`（Create a chat completion）、`generation`（Get generation stats）、`endpoints`（List endpoints）等。
  - 生产 server 公告：`https://openrouter.ai/api/v1`（OpenAI 兼容），但只暴露 `/chat/completions`。
- **对 Pictelio 的影响**：
  - 用户如果把 OpenRouter 的 base URL 填进"自填 LLM endpoint"框，并在设置页用 OpenAI SDK 接 `/v1/responses`，**第一个翻译请求就会 404**。
  - 当前 map #617 Decisions 已明确"完全不写死 chat/completions 旧协议；后续如需支持单独扩展"，所以**不应为 OpenRouter 单独扩展** — 走"不支持就硬拒绝"路径即可。

### Q5 · 国产 LLM（智谱 / 通义千问 / 文心一言 / DeepSeek 等）

| 厂商 | 厂商自有 API | OpenAI 兼容模式 endpoint | Responses API |
|---|---|---|---|
| 智谱 AI（GLM-4.6 / GLM-4.5 / GLM-Z1 / …） | `/api/paas/v4/chat/completions`（自有 OpenAI-like schema） | ✅ 「OpenAI SDK 兼容」卡片：base URL `https://open.bigmodel.cn/api/paas/v4/`，走 `/chat/completions` | ❌ 未公开支持 |
| 阿里通义千问（Qwen3 / Qwen-VL / Qwen-Code） | DashScope `qwen-plus` / `qwen3-max` / …（应用调用 `dashscope.Generation.call`） | ✅ OpenAI 兼容模式：`https://dashscope.aliyuncs.com/compatible-mode/v1` → `/chat/completions` | ❌ 未公开支持 |
| 百度文心一言（ERNIE-4.5 / ERNIE-X1 / …） | 千帆平台 Qianfan SDK | ✅ 兼容 OpenAI 协议：`https://qianfan.baidubce.com/v2` → `/chat/completions` | ❌ 未公开支持 |
| DeepSeek（已在 Q3 详述） | `/chat/completions` + `/v1/responses`（Codex 路径） | 同 | ✅（部分支持，详见 Q3 兼容矩阵） |

- **共同结论**：除 DeepSeek 外，国产三家（智谱 / Qwen / 文心）目前**都只暴露 OpenAI Responses API 的"前辈"**——`/chat/completions` 兼容层。原生 `/v1/responses` 缺失。
- **个别小厂例外提示**：
  - **月之暗面 Moonshot Kimi**：`https://api.moonshot.cn/v1`（OpenAI 兼容 chat/completions，无 /v1/responses）
  - **零一万物 Yi**：`https://api.lingyiwanwu.com/v1`（同上）
  - **百川 Baichuan**：`https://api.baichuan-ai.com/v1`（同上）

### Q6 · 自托管（vLLM / Ollama / LocalAI 等）

#### vLLM — ✅ 完整支持

- 官方 docs `docs.vllm.ai/en/latest/features/reasoning_outputs/` 的 Limitations 一节原话：
  > The reasoning content is only available for online serving's chat completion endpoint (`/v1/chat/completions`), Anthropic Messages API (`/v1/messages`) and the **Responses API (`/v1/responses`)**.
- 调用示例（vLLM 官方 docs 原文）：
  ```python
  from openai import OpenAI
  client = OpenAI(base_url="http://localhost:8000/v1", api_key="EMPTY")
  response = client.responses.create(
      model=client.models.list().data[0].id,
      input="What is 15 * 37?",
      include_reasoning=False,
  )
  types = [item.type for item in response.output]
  assert "reasoning" not in types
  ```
- 起服命令：`vllm serve <model_tag> --reasoning-parser <deepseek_r1|...>`
- **结论**：vLLM 是自托管场景下**最干净的 Responses API 提供方**。

#### Ollama — ⚠️ 已有 endpoint，但 buggy

- GitHub Issues 搜索 `is:issue responses api`（ollama/ollama）返回多项引用 `/v1/responses` endpoint 的 issue（最近 2026-09）：
  - #18306「Responses API: tools loaded by a client executed tool_search are never offered to the model」
  - #18390「gemma4: tool-call object keys containing spaces are left unquoted by the parser and the whole call is dropped as an empty response」
  - #18359「Native Gemma4 follow-up emits repeated unused50 and HTTP 200 EOF without done」
  - #18375「ChatGPT Error」
- **结论**：Ollama 0.34.x 已经把 `/v1/responses` 端点接入到 OpenAI 兼容层，但 tool-call streaming + done 信号实现仍存在已知 bug。生产翻译场景**不建议**依赖 Ollama 走 Responses API；如果用户填了，需要 fallback 到 chat/completions 或清晰报错。

#### LocalAI

- LocalAI 当前在 [docs.localai.io](https://localai.io/docs/) 没有 `/v1/responses` 文档（仅 `/v1/chat/completions` OpenAI 兼容层）。
- 结论：❌ 不支持。

#### LM Studio / Jan / AnythingLLM

- 这些是桌面端 runtime，本质包装 OpenAI 兼容 `http://localhost:1234/v1/chat/completions`；**不支持** `/v1/responses`。

### Q7 · 不支持 Responses API 的常见 LLM — 前端如何给清晰错误

用户填 base URL 之后，**第一个翻译请求**就会失败。失败信号会出现在以下三类错误里：

| 错误信号 | 含义 | 出现于 |
|---|---|---|
| HTTP `404 Not Found`，body 含 `"Unknown URL"` | endpoint 不存在（OpenRouter / 智谱 / Qwen / 千帆 / LocalAI） | POST `/v1/responses` |
| HTTP `405 Method Not Allowed` | endpoint 存在但 method 不接受（某些代理把 POST 重写） | 罕见 |
| HTTP `400 Bad Request`，body 含 `"unknown endpoint"` 或 `"unsupported"` | endpoint 收到了 POST 但不认识路径 | 部分 OpenAI-compat 代理 |
| HTTP `401 Unauthorized` + Responses 路径 200 | token scope 错（Azure Entra） | Azure |
| HTTP 200 + SSE 立即断流 / `response.failed` event | 协议存在但 provider 不支持某字段（Ollama 部分 model） | Ollama |
| `TypeError` / `Failed to fetch` | 网络/CORS/base URL 拼写错 | 所有 |

**前端 UX 策略**（按 M3 设计语言）：

#### 7.1 设置页（输入时即时反馈）

在 "Base URL" 输入框下方放一个**轻量级 inline probe 状态行**：

```
✅ OpenAI Responses API 兼容      ✅ Azure OpenAI Responses
✅ DeepSeek (Codex 兼容)            ✅ vLLM 自托管
⚠️ 仅 chat/completions 兼容         ❌ 未发现 Responses 兼容
```

实现方式：用户输入 base URL 后，**debounce 600ms**，前端**预探测**一个最小 POST 请求：

```http
POST <base_url>/v1/responses
Authorization: Bearer dummy
Content-Type: application/json

{"model":"<user-typed-model>","input":"ping","stream":false,"max_output_tokens":1}
```

判定逻辑：
- HTTP 401 / 403 / 400（"invalid api key" 类）→ ✅ endpoint 存在（仅认证失败）
- HTTP 404 / "unknown url" → ❌ 不兼容
- HTTP 405 → ⚠️ 仅 chat/completions
- 网络错误 → ⚠️ 无法探测

**注意**：M3 风格下不要用红/绿对比度过高的 badge；用 tonal chip + 状态文字即可。

#### 7.2 设置页"测试连接"按钮

放在保存按钮右侧，点击后**真正发起一次翻译测试**（1 token 输出，~3s 内返回）：

- 成功 → toast "连接成功" + 显示模型返回的 `output_text`
- 404 → sheet 「该 endpoint 不支持 OpenAI Responses API」+ 给出**可点击切换到 chat/completions 的开关**（如果用户明确要求支持，作为 map 后续 ticket 处理；当前决策是"硬拒绝"）
- 401 → sheet 「API key 无效或缺失权限」
- 网络错 → sheet 「无法连接 base URL，请检查地址与代理设置」

#### 7.3 翻译失败时的内联提示

单章失败时（per ADR 风格），详情页顶部 inline retry bar：

```
⚠️ 翻译失败：当前 endpoint 返回 HTTP 404
   OpenAI Responses API (/v1/responses) 不被支持
   常见原因：OpenRouter / 智谱 / 通义千问 / 文心一言 /
            部分自托管（LM Studio / LocalAI）
   [更换 endpoint] [查看文档]
```

流式中断时（Ollama 那种「200 EOF without done」），同样识别为"endpoint 不完整支持"，给出相同的 UX。

#### 7.4 i18n 键（待 spec 阶段定稿）

| 键 | en | zh-CN |
|---|---|---|
| `endpoint.probe.ok` | OpenAI Responses API compatible | OpenAI Responses API 兼容 |
| `endpoint.probe.partial` | Only chat/completions compatible | 仅 chat/completions 兼容 |
| `endpoint.probe.fail` | No Responses API detected | 未发现 Responses API 兼容 |
| `endpoint.probe.unknown` | Could not probe endpoint | 无法探测 endpoint |
| `error.translate.responses_404.title` | Endpoint does not support OpenAI Responses API | 该 endpoint 不支持 OpenAI Responses API |
| `error.translate.responses_404.body` | The LLM endpoint at {url} returned HTTP 404 for /v1/responses. Common causes: OpenRouter, Zhipu GLM, Alibaba Qwen, Baidu Qianfan, LocalAI, LM Studio. Use an endpoint that implements OpenAI Responses API (OpenAI, Azure OpenAI, DeepSeek, vLLM). | {url} 的 LLM endpoint 对 /v1/responses 返回 HTTP 404。常见原因：OpenRouter、智谱 GLM、阿里通义千问、百度千帆、LocalAI、LM Studio。请使用实现 OpenAI Responses API 的 endpoint（OpenAI、Azure OpenAI、DeepSeek、vLLM）。 |
| `endpoint.error.provider_hint.openrouter` | OpenRouter only supports /api/v1/chat/completions, not /v1/responses. | OpenRouter 仅支持 /api/v1/chat/completions，不支持 /v1/responses。 |
| `endpoint.error.provider_hint.zhipu` | Zhipu BigModel (GLM) only exposes OpenAI-compatible chat/completions at /api/paas/v4/. | 智谱 BigModel（GLM）仅在 /api/paas/v4/ 暴露 OpenAI 兼容的 chat/completions。 |
| `endpoint.error.provider_hint.qwen` | Alibaba DashScope OpenAI-compatible mode only exposes /chat/completions at /compatible-mode/v1. | 阿里 DashScope OpenAI 兼容模式仅在 /compatible-mode/v1 暴露 /chat/completions。 |
| `endpoint.error.provider_hint.qianfan` | Baidu Qianfan OpenAI-compatible endpoint only exposes /chat/completions at /v2. | 百度千帆 OpenAI 兼容端点仅在 /v2 暴露 /chat/completions。 |
| `endpoint.error.provider_hint.ollama` | Ollama 0.34+ has /v1/responses but the implementation has known streaming/tool-call bugs. Consider vLLM for production. | Ollama 0.34+ 提供 /v1/responses，但流式与 tool-call 实现存在已知 bug，生产建议改用 vLLM。 |

---

## 2. 兼容性矩阵（精简版）

| Provider | `/v1/responses` | base URL | 模型 | 文档 |
|---|---|---|---|---|
| OpenAI | ✅ GA | `https://api.openai.com/v1` | gpt-5/4o/4.1/o1/o3/… | [responses API](https://developers.openai.com/api/reference/resources/responses/) |
| Azure OpenAI | ✅ GA | `https://<R>.openai.azure.com/openai/v1` | gpt-5/4.1/4o/gpt-image-1/computer-use | [MS Learn](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses) |
| DeepSeek | ✅ 部分 | `https://api.deepseek.com` | deepseek-flash / deepseek-v4-pro | [DeepSeek docs](https://api-docs.deepseek.com/guides/responses_api) |
| OpenRouter | ❌ | `https://openrouter.ai/api/v1` | 多（含 OpenAI/Anthropic/Google） | [chat/completions only](https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion) |
| vLLM | ✅ | `http://<host>:8000/v1` | 任意 served model | [vLLM docs](https://docs.vllm.ai/en/latest/features/reasoning_outputs/) |
| Ollama | ⚠️ buggy | `http://<host>:11434/v1` | 任意 pulled model | [ollama #18306](https://github.com/ollama/ollama/issues/18306) |
| 智谱 GLM | ❌ | `https://open.bigmodel.cn/api/paas/v4` | GLM-4.6/4.5/Z1-Air | [Zhipu docs](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction) |
| 通义千问 Qwen | ❌ | `https://dashscope.aliyuncs.com/compatible-mode/v1` | qwen3-max/plus/… | DashScope 文档 |
| 文心一言 ERNIE | ❌ | `https://qianfan.baidubce.com/v2` | ERNIE-4.5/X1 | 千帆文档 |
| LocalAI | ❌ | `http://<host>:8080/v1` | 任意 | LocalAI docs |
| LM Studio | ❌ | `http://localhost:1234/v1` | 任意 | LM Studio docs |

---

## 3. URL 模板速查表（给 implement 阶段抄）

```ts
// 用户自填：baseUrl + apiKey + modelName
// Pictelio Native bridge 调用 OpenAI Python/Node SDK：
const client = new OpenAI({
  baseURL: `${userBaseUrl}/v1`,         // 注意：Azure / Ollama / vLLM 已带 /v1 或 /openai/v1 前缀，按 provider 决定是否需要拼接
  apiKey: userApiKey,                   // Azure 也可接受 token_provider
  defaultHeaders: isAzure
    ? { 'x-ms-oai-image-generation-deployment': imageModel, 'api_version': 'preview' }
    : undefined,
});
const stream = await client.responses.create({
  model: userModel,                     // Azure = deployment name
  input: [{ role: 'user', content: novelChunkText }],
  instructions: systemPrompt,           // 调用方不带 system prompt（Q14），由 provider / Responses API 自己处理
  stream: true,
  max_output_tokens: 2000,
});
```

| Provider | 拼接规则 | 例子 |
|---|---|---|
| OpenAI | `baseUrl + '/v1'` | `https://api.openai.com/v1` |
| Azure OpenAI | `baseUrl + '/openai/v1'`（`baseUrl` 是 `https://<R>.openai.azure.com`） | `https://my-r.openai.azure.com/openai/v1` |
| DeepSeek | `baseUrl + '/v1'`（已含） | `https://api.deepseek.com/v1` |
| vLLM / Ollama | `baseUrl + '/v1'`（已含） | `http://localhost:8000/v1` |

**注**：用户填 base URL 时，UX 上要分两种引导 — 「Just the host (e.g. `api.openai.com`)」 vs 「Full prefix (e.g. `https://api.openai.com/v1`)」，避免用户在拼接路径上反复出错。建议用 placeholder：

- 翻译设置页 placeholder = `https://api.openai.com/v1`（OpenAI 直白路径，不需要二次拼接）
- 在协议说明区用一行小字：「Base URL 自动追加 `/responses`；OpenAI/Azure/DeepSeek/vLLM 路径见[文档链接]」

---

## 4. Summary

1. **OpenAI Responses API 已是 v1 通用 endpoint**（OpenAI、Azure、DeepSeek、vLLM 自托管都直接兼容），但**生态仍未普及**：OpenRouter / 智谱 / 通义千问 / 文心一言 / LocalAI / LM Studio 全部仅暴露 `/chat/completions` 兼容层，不支持 `/v1/responses`。这意味着 #624 设置页"硬拒绝"路径比 #617 原 plan 估计的更普遍。
2. **DeepSeek 是国产中唯一提供 `/v1/responses` 的厂商**（为 Codex 集成而上线），但它是**部分支持**：`previous_response_id` / `conversation` / `store` / `background` / 内置工具（`web_search` / `file_search` / `mcp`）等关键能力缺失，**stateless**，**unsupported 字段 silently ignored**。Implement 阶段要接受这些限制。
3. **流式响应协议差异**：DeepSeek 流式结束于 `response.completed/incomplete/failed` event，**没有 `data: [DONE]`**；OpenAI / Azure 流式遵循 OpenAI Responses 标准 event 序列（含 `response.completed` + `[DONE]`）。Implement 阶段必须按 event 类型解析，不要按 `[DONE]` 单点终止（避免 DeepSeek 漏流）。

---

## 5. Frontend Error UX Recommendation

按 M3 设计语言，分三层防护：

### 5.1 设置页 — 输入即探测（probe-on-input）

- 用户在 base URL 输入框失焦或停顿 600ms → debounce 触发**HEAD 探测**或**最小 POST 探测**（带 dummy api key）：
  ```http
  POST <url>/v1/responses
  Authorization: Bearer probe
  {"model":"probe","input":"x","max_output_tokens":1}
  ```
- **判定表**：

| 响应 | UI 显示 | 状态 |
|---|---|---|
| `401/403`（"invalid api key" 类） | ✅ Responses API 兼容 | `endpoint.probe.ok` |
| `404` / `unknown url` / `405` | ❌ 不兼容 | `endpoint.probe.fail` |
| `400` 且 body 含 `previous_response_id required` | ⚠️ 部分兼容 | `endpoint.probe.partial` |
| 网络错误 / timeout | ⚠️ 无法探测 | `endpoint.probe.unknown` |

- UI：base URL 输入框下方一行 inline chip + 文案，不抢占焦点。
- **不要**在 probe 时做真翻译（耗 token + 钱 + 时间）。

### 5.2 设置页 — 「测试连接」CTA

- 保存按钮右侧放次级按钮「测试连接」→ 真发起一次 1-token 翻译请求
- 成功后 inline toast + 显示模型返回的首字符 + token usage（让用户确认 model name 正确）
- 失败后弹出 bottom sheet：
  - 错误类型（404 / 401 / 401 / 网络）
  - 常见原因 1-2 条（如上 i18n 表）
  - 「更换 endpoint」按钮 → 回到设置页

### 5.3 翻译时 — 单章失败 / 流式中断 inline retry

- 详情页顶部（chunk 列表上方）放一条 inline retry bar（参考 webview 端 `createNovelTranslator` 失败的现有 UI）：
  ```
  ⚠️ 第 N 章翻译失败
  HTTP 404 — /v1/responses 不可用
  常见原因：OpenRouter / 智谱 / 通义千问 / 文心一言
  [更换 endpoint] [查看文档]
  ```
- **流式中断**（DeepSeek / Ollama 那种）单独识别，提示"endpoint 流式实现不完整，建议改用 OpenAI/Azure/vLLM"。

### 5.4 不引入额外 capability

- **不要**为了"让更多用户能跑通"而在 implement 阶段增加 chat/completions 回退路径。map #617 Q18 已明示"当前只走 OpenAI Responses API /v1/responses endpoint；如未来需要回退支持，作为单独 ticket"。硬拒绝 + 清晰错误是当前 ADR 范围内的最优解。

---

## 6. Failure Modes（已知坑 & 失败路径）

| 失败路径 | 触发条件 | 用户感知 | 前端应对 |
|---|---|---|---|
| `OpenRouter / 智谱 / Qwen / 千帆` 用户填入后第一个翻译请求 404 | endpoint 不存在 `/v1/responses` | 「Endpoint does not support OpenAI Responses API」sheet | 设置页 probe + 翻译失败内联 |
| `DeepSeek 用户填了老 model 名（`deepseek-v4-flash` / `deepseek-v4-flash-vision-exp`）` | 模型已 retired，请求被 silently serve 为 deepseek-flash | 翻译能跑（按 Flash 价格计费）但用户期望 Pro 失败 | 设置页 model 字段加 placeholder：「推荐 `deepseek-flash`；`deepseek-v4-pro` 当前可用」 |
| `Azure 用户填了 Chat Completions 风格的 URL（带 `/deployments/<dep>`）` | URL 路径错误 | POST `/v1/responses` 返回 404 | 设置页 placeholder 用 v1 Responses URL + tooltip 解释 |
| `Azure 用户 Entra token scope 错（不是 `https://ai.azure.com/.default`）` | token 无权限 | 401 | 设置页 hint 文案 + 测试连接按钮识别 401 后弹提示 |
| `Ollama 用户` | 流式断流 + tool-call 失败 | 单章失败 + 流式中断 | 内联 retry bar 单独识别 Ollama（issue #18306/18390 提示） |
| `本地 base URL 不可达`（vLLM 未起服 / 端口错 / 防火墙） | TCP 拒绝 / timeout | 网络错 | 设置页网络错 chip + 文档链接到 vLLM quickstart |
| `用户填了 vLLM + 不存在的 model 名` | URL 路径正确但 model 不存在 | 404 with `model not found` | 翻译失败 bar 提示「model 不存在，请检查 `vllm serve` 是否成功」 |
| `用户填 OpenAI 但 base URL 不带 `/v1` 后缀` | 拼接后变成 `api.openai.com/responses`（缺 `/v1`） | 404 | 设置页 placeholder 强制带 `/v1` |
| **流式中断无 `[DONE]`（DeepSeek）** | implement 阶段按 OpenAI `[DONE]` 终止解析 | 翻译结果被截断或错位 | implement 阶段按 event 类型解析（详见 ADR-0169 ticket #619） |

---

## 7. Reference Sources（按引用次序）

1. OpenAI API Reference, Responses v1 — <https://developers.openai.com/api/reference/resources/responses/>（canonical）
2. Azure OpenAI Foundry, Responses API how-to — <https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses>
3. DeepSeek API Docs, Using the Responses API — <https://api-docs.deepseek.com/guides/responses_api>
4. DeepSeek API Docs, Your First API Call — <https://api-docs.deepseek.com/>
5. OpenRouter API Reference — <https://openrouter.ai/docs/api_reference/overview> + <https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion>
6. vLLM Reasoning Outputs docs — <https://docs.vllm.ai/en/latest/features/reasoning_outputs/>
7. Ollama issue #18306 Responses API tool_search — <https://github.com/ollama/ollama/issues/18306>
8. Ollama issue #18390 gemma4 tool-call spaces — <https://github.com/ollama/ollama/issues/18390>
9. Zhipu BigModel 文档 — <https://docs.bigmodel.cn/cn/guide/start/introduction> + OpenAI 兼容卡片 <https://docs.bigmodel.cn/cn/guide/develop/openai/introduction>
10. 阿里云 Model Studio (DashScope) — <https://help.aliyun.com/zh/model-studio/>（OpenAI 兼容模式）
11. 百度智能云千帆 — Qianfan API 文档（OpenAI 兼容模式）
12. LocalAI 文档 — <https://localai.io/docs/>（确认仅 chat/completions）
13. Pictelio issue #617（map 父 ticket）— <https://github.com/a1121611810/Pictelio/issues/617>
14. Pictelio issue #624（prototype ticket，错误提示 UX）— <https://github.com/a1121611810/Pictelio/issues/624>
15. Pictelio issue #622（OpenAI Responses API 协议调研，并行 ticket）— <https://github.com/a1121611810/Pictelio/issues/622>

---

> 本文档为 throwaway research 产物，仅供 #617 群组评审，不进 release。涉及到的具体 endpoint URL 在 2026-09 验证；后续 OpenAI / DeepSeek / vLLM 版本更新时需重新核对「Supported models」清单（高频变动区）。
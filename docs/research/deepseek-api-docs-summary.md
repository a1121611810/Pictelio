# DeepSeek API 文档全量通读摘要（面向小说翻译功能）

> 来源：https://api-docs.deepseek.com/zh-cn/ 全站 40 页文档，agent-browser 逐页抓取通读（2026-07-31）
> 原始抓取文本保留于本地 `/tmp/ds-docs/`（40 个 .txt，本文档为提炼摘要）
> 配套：`docs/research/deepseek-facts.md`（档位/定价/政策专题调研）、`docs/research/novel-ai-translation-feasibility.md`（翻译功能可行性）

## 1. 模型与版本（2026-07-31 最新）

| 模型 | 版本状态 | 角色定位 |
|---|---|---|
| `deepseek-v4-flash` | **正式版已上线公测（V4-Flash-0731，2026-07-31）** | 经济档，Agent 能力大幅增强（Terminal Bench 82.7 / NL2Repo 54.2 / Cybergym 76.7 / Toolathlon 70.3）；结构同 Preview，仅重新后训练 |
| `deepseek-v4-pro` | 仍为 Preview，正式版"尽快发布" | 旗舰档，性能对标顶级闭源（Agentic Coding 优于 Sonnet 4.5、接近 Opus 4.6 非思考） |

- 旧模型名 `deepseek-chat` / `deepseek-reasoner` 已于 **2026-07-24 完全停止使用**（评估文档 3.2 章的预设已过时）
- 两模型均 1M 上下文 / 最大输出 384K，同时支持思考与非思考模式
- 两个模型名固定为 `deepseek-v4-flash` / `deepseek-v4-pro`，**无 /v1 前缀要求**（`https://api.deepseek.com` 直接可用；`/v1` 前缀仍兼容）

## 2. 端点与协议

| 接口 | 端点 | 用途 |
|---|---|---|
| Chat Completions | `POST https://api.deepseek.com/chat/completions` | **翻译主用**，OpenAI 兼容，两个模型均支持 |
| Responses API | `POST https://api.deepseek.com/responses` | 仅 flash 支持（pro 2026-08 初）；Codex 用 |
| FIM 补全（Beta） | `POST https://api.deepseek.com/beta/completions` | 代码补全，翻译不用 |
| 模型列表 | `GET https://api.deepseek.com/models` | 可运行时校验模型名 |
| 查询余额 | `GET https://api.deepseek.com/user/balance` | 返回 `is_available` + `balance_infos`；**可做翻译前余额预检** |

认证：`Authorization: Bearer <user key>`，无中间服务器。Anthropic 兼容端点 `https://api.deepseek.com/anthropic`（翻译不走此协议，备选）。

## 3. Chat Completions 关键参数（翻译相关）

| 参数 | 说明 | 翻译建议 |
|---|---|---|
| `model` | `deepseek-v4-flash` / `deepseek-v4-pro` | 质量等级 = 两档映射 |
| `thinking` | `{"type":"enabled"/"disabled"}`，**默认 enabled** | **翻译必须显式 `{"type":"disabled"}`**，否则 reasoning token 计费 + 变慢 |
| `reasoning_effort` | `low/high/max`；flash 三档、pro 仅 high/max（low→high 映射，8 月初支持三档） | 翻译禁用思考时不适用 |
| `max_tokens` | 限制输出；1M 上下文 / 384K 输出 | 分块后按块大小设置 |
| `temperature` | ≤2，默认 1 | 翻译建议低值（如 0.3~0.7）提高确定性；**思考模式下不生效** |
| `top_p` | ≤1，默认 1 | 与 temperature 二选一调整 |
| `response_format` | `{"type":"json_object"}` 需 prompt 含 "json" 字样；**有概率返回空 content**（官方承认） | 翻译输出纯文本即可，不依赖 JSON Output |
| `stream` | SSE 流式，`data: [DONE]` 结尾 | Phase 2 再做流式 |
| `user_id` | `[a-zA-Z0-9\-_]{1,512}`；内容安全 / KVCache / 调度隔离 | 可选传入以隔离用户 |
| `tools` / `tool_choice` | 工具调用 | 翻译不用 |
| `logprobs` / `top_logprobs` | 对数概率 | 不用 |
| `frequency_penalty` / `presence_penalty` | **已弃用**（传入无效） | 不传 |

## 4. 思考模式（翻译必读）

- 默认开启，effort 默认 high
- 关闭方式：Chat Completions `"thinking":{"type":"disabled"}`；Anthropic 格式 `"reasoning":{"effort":"none"}`
- 思考模式下 **temperature/top_p/presence_penalty/frequency_penalty 不生效**（不报错）
- 思维链通过 `reasoning_content` 返回（与 `content` 同级）
- 多轮拼接规则：无工具调用时 reasoning_content 无需回传（会被忽略）；**有工具调用时必须完整回传**，否则 400
- **翻译场景：单轮分块 + 禁用思考 → 完全规避这些复杂度**

## 5. KV 缓存（省钱关键）

- 对所有用户**默认开启**，无需配置
- 缓存命中价 ≈ 未命中价 1/50（flash：命中 ¥0.02 vs 未命中 ¥1）
- 前缀匹配规则：请求结束位置落盘 / 公共前缀检测落盘 / 固定 token 间隔落盘；后续请求须**完整匹配缓存前缀单元**才命中
- **翻译分块策略红利**：各块共享相同 system prompt + 译文上下文前缀 → 除首块外大概率命中缓存，成本大幅下降
- usage 中可观测：`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`
- 缓存"尽力而为"不保证命中；不使用的缓存数小时~数天自动清空

## 6. 错误处理（翻译客户端须覆盖）

| 错误码 | 含义 | 翻译处理 |
|---|---|---|
| 400 | 请求体格式错误 | 提示用户检查配置 |
| 401 | API key 错误 | **提示 key 无效**（用户自查） |
| 402 | **余额不足** | 提示用户充值（翻译场景高频出现） |
| 422 | 参数错误 | 内部 bug，上报 |
| 429 | 并发/速率超限 | 指数退避重试（并发 2-3 路远低于 2500 限额，罕见） |
| 500 | 服务器故障 | 重试 |
| 503 | 服务器繁忙 | 退避重试 |

- 账号并发限制：flash 2500 / pro 500（账号粒度，与 key 无关）
- 翻译 2~3 路并发完全无压力
- **请求保活机制**：响应前持续返回空行（非流式）或 `: keep-alive` SSE 注释（流式）——**解析 JSON body 时必须容忍空行/注释**；10 分钟未开始推理则服务端关闭连接
- 政策拒绝信号：`finish_reason=content_filter`（R18 失败即止检测，详见 deepseek-facts.md）

## 7. 限速与隔离

- 并发限制以**账号**粒度计（与 API Key 无关）；超出返回 429
- `user_id` 隔离：内容安全隔离 / KVCache 隔离 / 调度隔离；提升并发配额用户每 user_id 单独限流
- 翻译功能：单账号个人使用，无需 user_id（如未来做多用户隔离再引入）

## 8. 峰谷定价（新风险）

- 即将上线：高峰时段（**北京时间每日 9:00~12:00、14:00~18:00**）价格 **×2**，适用所有计费项，生效时间待官方通知
- 翻译功能影响：可忽略（单篇几毛钱级）或提示；不作为核心约束

## 9. 成本估算（更新）

| 项 | 值 |
|---|---|
| flash 输入（未命中） | ¥1 / 1M token |
| flash 输入（缓存命中） | ¥0.02 / 1M token |
| flash 输出 | ¥2 / 1M token |
| pro 输入（未命中 / 命中） | ¥3 / ¥0.025 / 1M token |
| pro 输出 | ¥6 / 1M token |
| token 换算 | 1 中文字符 ≈ 0.6 token；1 英文字符 ≈ 0.3 token |
| 万字中文小说（约 6K 输入 token，分 3~5 块） | flash 成本 ≈ **¥0.03~0.06**（首块未命中 + 后续块命中） |

比评估文档估算（¥0.07）更低；比 deepseek-facts.md 估算（¥0.04）持平或略优（缓存红利 + 实际 token 率）。

## 10. 对翻译功能实现的具体建议

1. **参数模板**：`model=deepseek-v4-flash`、`thinking:{"type":"disabled"}`、`temperature:0.3~0.7`、`max_tokens` 按块设置、非流式（Phase 2 再流式）
2. **错误处理**：重点覆盖 401（key 无效）/ 402（余额不足）/ 429（退避重试）；请求保活空行容忍
3. **KV 缓存利用**：所有分块共享同一 system prompt 与术语前缀，最大化缓存命中；分块顺序不必强制并发乱序
4. **余额预检**（可选增强）：翻译前 GET /user/balance 检查 `is_available`，避免 402 中断体验
5. **模型档位**（质量等级）：v4-flash = 标准/性价比；v4-pro = 高质量/更贵——两档映射「质量等级」UI
6. **R18 政策拒绝**：`finish_reason=content_filter` 作为失败即止的可编程信号（见 deepseek-facts.md §5 条款与实测建议）
7. **峰谷定价**：不作为硬约束；如需省成本可避开高峰时段批量翻译（Phase 3 系列批量翻译时再考虑）

## 11. FAQ 补充（static.deepseek.com/faq 全量 44 条通读，2026-07-31）

来源：https://static.deepseek.com/faq/index.html?lang=zh （分类：登录问题 8 条 / 使用引导 11 条 / 对话问题 10 条 / API相关 15 条，agent-browser 逐条点击抓取通读）

**与翻译功能（BYOK）直接相关的事实：**

| 事实 | 来源条目 | 对翻译功能的意义 |
|---|---|---|
| **API key 泄漏处理**：登录开放平台 → API keys 页删除泄漏 key（立即失效、不可恢复）→ 尽快创建新 key 替换到应用；官方明确提示"不要与他人共享，或将其暴露在浏览器或其他客户端代码中" | api-08 | 设置页须提供 **key 删除/更换入口**；UI 提示用户妥善保管 key、不外泄 |
| **账号停用机制**：账号因违反平台使用规范触发停用，申诉审核约 3 个工作日 | login-08 | R18 翻译"封号/停用风险"的官方佐证，强化二次告知文案可信度 |
| 余额充值后**永久有效**、未消费**支持退款**（在线支付自助、对公转账走工单）；充值需实名认证 | api-01/03/04 | 用户自付成本的官方说明，翻译前余额提示可引用 |
| 限速：统一收费标准、**无分级套餐**；更高并发需提交扩容工单、**扩容不额外收费** | api-10 | 翻译 2~3 路并发无需任何扩容 |
| 个人/企业实名认证在权益与功能上**无差异**；企业认证类型不可再变更 | api-12/14 | 无关紧要，用户须知 |
| 请求保活机制（非流式返回空行 / 流式 `: keep-alive`、10 分钟断连）——与第 6 节一致 | api-15 | 同第 6 节：JSON 解析须容忍空行 |
| 其他（登录问题/使用引导/对话问题分类）：微信登录不支持海外 IP、Google 登录不支持大陆 IP、注销账号余额视为放弃、已删对话不可恢复、导出对话链接 7 天有效等 | login/guide/chat 全部 | 与翻译功能无关，仅记录 |

原始抓取文本保留于本地 `/tmp/faq/`（44 个 .txt）

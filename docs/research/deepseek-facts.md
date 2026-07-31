# DeepSeek 模型档位与 R18 容忍度调研事实卡

> 状态：调研事实卡（供实现与政策文案引用）· 调研日期：2026 年 8 月（官方文档 Copyright © 2026）
> 用途：支撑 `docs/research/novel-ai-translation-feasibility.md`（2025-11 版）的模型预设、成本、R18 章节更新。
> 结论先行：**模型线已换代**——`deepseek-chat`/`deepseek-reasoner` 于 2026-07-24 退役，现在是 `deepseek-v4-flash` / `deepseek-v4-pro`（1M 上下文、双模式、价格更低）；**书面条款继续明确禁止色情内容（官方）**，执行宽松度仍是社区传闻；**新陷阱：思考模式默认开启**，翻译请求必须显式关闭。

---

## 1. 当前开放模型列表（官方）

| 模型名 | 版本 | 参数量（官方新闻） | 上下文 / 最大输出 | 思考模式 | 适用场景（官方描述） |
|--------|------|------------------|------------------|---------|---------------------|
| `deepseek-v4-flash` | DeepSeek-V4-Flash-0731（2026-07-31 正式版 API 公测） | 284B 总参 / 13B 激活 | **1M** / 384K | 非思考 + 思考（默认思考） | 快速、经济；推理能力接近 Pro；简单 Agent 任务与 Pro 相当。**翻译类任务的经济之选** |
| `deepseek-v4-pro` | DeepSeek-V4-Pro（preview，正式版官方称"很快发布"） | 1.6T 总参 / 49B 激活 | **1M** / 384K | 非思考 + 思考（默认思考） | 顶级推理/世界知识（官方称比肩顶级闭源模型，知识仅次于 Gemini-3.1-Pro） |

- **API 能力**（两模型均支持）：JSON Output、Tool Calls、Anthropic API、FIM 补全（仅非思考模式）、对话前缀续写（Beta）。Responses API **仅 v4-flash** 支持（官方称 2026 年 8 月初增加 v4-pro 支持）。
- **思考模式参数**：`{"thinking": {"type": "enabled/disabled"}}`，默认 **enabled**；`reasoning_effort`：low/high/max（v4-flash 三档齐全；v4-pro 暂仅 high/max，low 按 high、xhigh 按 max 映射，8 月初补齐）。思考模式下 temperature/top_p 不生效（不报错但无效）。
- **旧模型退役**（⚠️ 与评估文档重大差异）：`deepseek-chat` 与 `deepseek-reasoner` 2026-04-24 起进入三个月过渡期（分别路由到 v4-flash 非思考/思考模式），**2026-07-24 15:59 UTC 后完全退役、不可访问**。当前 API 参考文档的 model 可选值仅 `[deepseek-v4-flash, deepseek-v4-pro]`。
- **"1M 上下文是 DeepSeek 所有官方服务的标配"**（官方新闻原话）。

来源（全部官方）：
- 模型与价格页（英）：https://api-docs.deepseek.com/quick_start/pricing ；中文：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
- V4 发布新闻（中）：https://api-docs.deepseek.com/zh-cn/news/news260424 ；英：https://api-docs.deepseek.com/news/news260424
- 更新日志：https://api-docs.deepseek.com/updates
- 思考模式指南：https://api-docs.deepseek.com/guides/thinking_mode
- Chat Completions API 参考（model 可选值）：https://api-docs.deepseek.com/api/create-chat-completion

---

## 2. 最新定价（官方，单位：每 1M tokens）

### 人民币（官方中文页，当前生效）

| 模型 | 输入（缓存命中） | 输入（缓存未命中） | 输出 |
|------|:---:|:---:|:---:|
| `deepseek-v4-flash` | ¥0.02 | ¥1 | ¥2 |
| `deepseek-v4-pro` | ¥0.025 | ¥3 | ¥6 |

### 美元（官方英文页，当前生效）

| 模型 | 输入（缓存命中） | 输入（缓存未命中） | 输出 |
|------|:---:|:---:|:---:|
| `deepseek-v4-flash` | $0.0028 | $0.14 | $0.28 |
| `deepseek-v4-pro` | $0.003625 | $0.435 | $0.87 |

### 关键规则
- **上下文硬盘缓存（KV Cache）默认开启、零代码生效**：自动匹配前缀，命中部分按"缓存命中"价（约未命中的 1/50~1/72）。响应 `usage` 返回 `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`。⚠️ 命中按"完整缓存前缀单元"匹配（滑动窗口注意机制），分块翻译共享同一段 system prompt 前缀可显著提高命中率。
- **峰谷定价（即将实行，风险项）**：高峰时段（北京时间每日 9:00–12:00 与 14:00–18:00）所有计费项价格为平时 **2 倍**；生效日期官方称"以正式通知为准"。→ 翻译功能需考虑高峰成本翻倍（可提示或延迟非紧急翻译）。
- **并发限制**（账号级）：v4-flash 2500、v4-pro 500；超限返回 HTTP 429。翻译 2~3 路并发毫无压力。
- **成本重估（相对评估文档 10.1）**：单篇万字小说（保守输入 15K + 输出 12K，v4-flash 非思考、无缓存命中）= 15K×¥1/M + 12K×¥2/M ≈ **¥0.04**，比评估文档估算的 ≈¥0.07 更低。若共享 system prompt 前缀命中缓存，输入成本可再降约 98%。

来源（全部官方）：
- 模型与价格（中文/英文）：https://api-docs.deepseek.com/zh-cn/quick_start/pricing ；https://api-docs.deepseek.com/quick_start/pricing
- 上下文缓存：https://api-docs.deepseek.com/guides/kv_cache
- 限速与隔离：https://api-docs.deepseek.com/quick_start/rate_limit

---

## 3. 日→中翻译质量口碑

### 官方确认（有限）
- DeepSeek 官方**无日→中翻译专项基准**。官方更新日志唯一直接相关表述：deepseek-chat 升级 V3-0324 时"**Optimized translation quality and letter writing**（优化翻译质量与书信写作）"（2025-03-24）。V4 发布说明未提翻译专项，主推 Agent/编程/世界知识。
- 来源：https://api-docs.deepseek.com/updates （2025-03-24 条目）

### 社区评价（均为传闻/经验，非官方承诺）
| 来源（时间） | 内容 | 对产品的启示 |
|-------------|------|-------------|
| V2EX t/1057544（2024-07） | 用 deepseek 翻译 2w 词英文小说："前面质量都挺好的，翻到二分之一时开始下滑，句词生硬，六分之五时开始摆烂" | 长文本后段退化 → 印证评估文档 4 章"整章分块 + 分块内完整上下文"策略；每块 ≤2000 字 |
| V2EX t/1105727（2025-01） | "deepseek 翻译日常对话确实厉害，已经拉开传统翻译太多了，特别多的专业名词和口语化表达都能完美搞定" | 通用日/英→中口语与专名能力强，适合轻小说文体 |
| Hacker News comment 43046208（2025-02） | 用 DeepSeek 将 100 部英文经典译成梵语，"translation quality is quite good, close to Claude-level" | 跨语言翻译质量接近一线模型 |
| Hacker News comment 42895610（2025-02，职业日英译者 tkgally） | R1 在长文本（日语演讲→英）后半段遗漏整段；"R1 didn't seem bad"但后段退化 | 再次印证长文本分块必要性；思考模式适合长文但注意输出截断/遗漏 |

### 结论
- 日→中轻小说翻译质量**口碑良好但无官方基准**，MVP 必须实测（评估文档 8.5 的"上线后实测数据驱动"要求保持不变）。
- V4-Flash 是翻译场景的性价比默认档；复杂长句/术语一致性可升级 v4-pro 或开思考模式（成本约 ×3~×5）。

来源：https://www.v2ex.com/t/1057544 · https://www.v2ex.com/t/1105727 · https://news.ycombinator.com/item?id=43046208 · https://news.ycombinator.com/item?id=42895610

---

## 4. 用户协议 / 内容政策：NSFW 条款（原文摘录，官方）

> 评估文档 2025-11 引用的 DeepSeek 条款为英文版 §3.4(5) 与 §8.2。本次复核：**英文版 2026-03-27 更新过，条款位置与内容不变，旧引用仍然有效**；另有中文版（更新 2025-09-05）条款更强。

### 4.1 书面条款（官方原文）
**英文版《DeepSeek Terms of Use》（Last Update: March 27, 2026）**
- **§3.4(5)**：You will not use the Services to generate, express or promote content… that *"is pornographic, obscene, or sexually explicit (e.g., sexual chatbots)"* —— **明确禁止色情/淫秽/露骨性内容**。
- **§3.4(7)(8)**：禁止 *"exploits, harms, or attempts to exploit or harm minors"* 与 *"designed to specifically appeal to or present a persona of any person under the age of 18"* —— 儿童相关红线。
- **§8.2** 违约处置：warning → deadline for correction → restricting account functions → suspending usage → **closing accounts** → prohibiting re-registration → deleting content；涉法行为 *"records will be retained, and reports will be made to the competent authorities"*（**上报主管部门**）。
- 来源：https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html （官网"法务 & 安全"栏链接）

**中文版《DeepSeek 用户协议》（更新/生效 2025-09-05）**
- **§3.3(9)** 禁止输入/输出/传播的违法不良信息包括："**散布淫秽、色情、赌博、暴力、凶杀、恐怖或者教唆犯罪的**"。
- **§3.4**：深度求索"有权采取技术手段等措施对用户使用本服务的行为及信息进行审查，包括但不限于对**输入和输出进行审查、建立风险过滤机制、建立违法内容特征库**"；禁止用变体/乱码/字符/谐音规避检测、越狱攻击。
- **§8.1** 违约处置：警示提醒→限期改正→限制账号功能→暂停使用→关闭账号→禁止重新注册→删除相关内容；涉法行为"保存有关记录，并**依法向有关主管部门报告**、配合调查"。
- 来源：https://cdn.deepseek.com/policies/zh-CN/deepseek-terms-of-use.html

**API 层官方承认存在内容过滤（工程信号）**：Chat Completions 响应 `finish_reason` 枚举含 **`content_filter`**（"content was omitted due to a flag from our content filters"）。→ 产品可用此值作为"政策拒绝"的可编程检测信号（评估文档 8.4「失败即止」可精确化：`finish_reason=content_filter` 时该块回退原文并标记「未翻译」）。
- 来源：https://api-docs.deepseek.com/api/create-chat-completion

### 4.2 实际执行宽松度（⚠️ 社区传闻，非官方确认）
| 倾向 | 证据（社区） | 说明 |
|------|-------------|------|
| 宽松 | V2EX t/1057544（2024-07）："GPT 也审，deepseek 不审"（比较对象 Gemini/GPT） | 2024 年 V2 时代 API 观察 |
| 收紧 | V2EX t/1105727（2025-01）："唯一的问题是审核，会导致某些话题的句子不翻译" | 2025 年 V3 时代观察（chat 端） |
| 结论 | 执行层随**时代、渠道（chat vs API）、内容类型**波动；不存在官方承诺的"宽松" | 评估文档 8.2「DeepSeek 书面条款并不宽松，宽松的只是实际执行」的结论本次复核**维持**；且 V4 新一代模型对齐/审查策略未知，**上线前必须实测 V4 的 R18 拒绝率** |

- **对产品文案的直接用途**（R18 开关二次告知，评估文档 8.4 建议文案可照用并补充条款号）：
  > "翻译需将正文发送至你选择的 AI 服务商。DeepSeek 用户协议明确禁止输入/生成色情内容（英文版 §3.4(5)、中文版 §3.3(9)），违反可能导致你的 API 账号被警告、暂停或封禁（§8.2/§8.1），涉法内容还可能被上报主管部门。所有风险由你自行承担。"
- **R18G 红线不变**：中文 §3.3(9)（淫秽色情）+ 英文 §3.4(7)(8)（未成年人）双重覆盖，任何情况下不发送（评估文档 8.4 的 `x_restrict=2` 拦截策略继续有效）。

---

## 5. API 端点与协议（供 fetch 客户端直连）

| 项 | 值（官方） | 实证/备注 |
|----|-----------|----------|
| base_url（OpenAI 格式） | **`https://api.deepseek.com`**（官方文档主推，无 /v1） | 实测 `https://api.deepseek.com/models` 与 `https://api.deepseek.com/v1/models` 均返回 **401**（端点存在，仅缺认证）→ 评估文档旧预设 `/v1` 路径**仍兼容**，但建议预设更新为主推路径 |
| 端点 | `POST {base}/chat/completions`；另有 `GET /models`、`GET /user/balance`、`POST /responses`（仅 v4-flash） | — |
| 认证 | `Authorization: Bearer <API Key>`（Key 在 https://platform.deepseek.com/api_keys 申请） | 与 OpenAI 一致 |
| 兼容性 | 官方明示："API format **compatible with OpenAI/Anthropic**"，可直接用 OpenAI SDK（base_url 指向 api.deepseek.com） | — |
| 额外/差异字段 | `thinking`（开关思考）、`reasoning_effort`、`user_id`（内容安全/KVCache/调度隔离，正则 `[a-zA-Z0-9\-_]+` ≤512 位）；`frequency_penalty`/`presence_penalty` 已 deprecated（传了不生效） | 翻译客户端按 OpenAI 兼容实现即可，这些是可选增强 |
| 流式 | `stream: true` → SSE，`data: [DONE]` 结束；非流式/流式响应会周期性返回**空行或 `: keep-alive` 注释**，解析时必须容忍 | 见限速页 |
| 思考模式注意 | 思考默认**开启**；思考 token 计入 `usage.completion_tokens_details.reasoning_tokens`（**计费**），且 `temperature` 等不生效 | ⚠️ |

**翻译客户端硬性建议（本卡新增）**：
1. 每个翻译请求显式传 `"thinking": {"type": "disabled"}` —— 否则思考默认开启，输出前先烧 reasoning token（计费、变慢、流式多出 `reasoning_content` 字段）。
2. 所有块共享同一段 system prompt 前缀，最大化缓存命中（价格 §2 差异 50~72 倍）。
3. 响应里 `finish_reason` 为 `content_filter` 时按"政策拒绝"处理：回退原文 + 标记「未翻译」，不自动重试（对应评估文档 8.4 失败即止）。
4. 解析 SSE 时忽略空行与 `: keep-alive` 注释；`stream_options.include_usage` 可拿全量 usage。
5. 高峰时段（9:00–12:00、14:00–18:00 北京）价格 ×2，可对非紧急批量翻译做延迟调度。

来源（全部官方）：
- 首次调用/兼容性声明：https://api-docs.deepseek.com/
- API 参考：https://api-docs.deepseek.com/api/create-chat-completion
- 思考模式：https://api-docs.deepseek.com/guides/thinking_mode
- 限速与隔离：https://api-docs.deepseek.com/quick_start/rate_limit
- 模型/价格：https://api-docs.deepseek.com/quick_start/pricing
- 官网（法务链接、平台入口）：https://www.deepseek.com/

---

## 6. 与评估文档（2025-11 版）的差异总表

| 维度 | 评估文档 2025-11 | 本次调研（2026-08） | 影响 |
|------|----------------|--------------------|------|
| 默认模型 | `deepseek-chat` | `deepseek-v4-flash`（旧名已退役） | 预设表 3.2 必须改模型名 |
| 推理模型 | `deepseek-reasoner` | `deepseek-v4-pro` / v4-flash 思考模式 | 同上 |
| 上下文 | 64K~128K（V3.x 量级） | **1M** 标配，输出 384K | 整章一次请求的可行性大幅提升；仍建议分块（时延/缓存） |
| 单篇成本 | ≈¥0.07 | ≈¥0.04（v4-flash 非思考） | 成本下降，评估文档 10.1 结论"不到 1 毛"仍然成立且更宽裕 |
| 缓存 | 评估文档未考虑 KV cache 命中 | 缓存命中输入价 ≈未命中的 1/50~1/72 | 共享 system prompt 前缀可大幅省钱（新增优化点） |
| 思考模式 | deepseek-chat 默认非思考 | **v4 默认思考开启** | 翻译必须显式 `thinking.disabled`（新增硬约束） |
| 价格风险 | 无 | 峰谷定价将上线（高峰 ×2） | 新增调度/提示项 |
| R18 条款 | 英文 §3.4(5)、§8.2（2025-11 版） | 英文版 2026-03-27 更新，条款不变；另确认中文 §3.3(9)/§8.1 | 旧引用仍有效，告知文案可补中文条款号 |
| 政策拒绝信号 | 文档未提 | `finish_reason=content_filter` | 可编程化"失败即止"（新增） |
| 并发限制 | 未涉及 | v4-flash 2500 / v4-pro 500 | 翻译 2~3 路并发无压力 |
| 执行宽松度 | "实际执行宽松（社区实践）" | 维持为**传闻**；V2 时代宽松、V3 时代有波动、V4 未知 | 上线前实测 V4 拒绝率（评估文档 8.5 不变） |

---

## 附：本次查证的关键来源清单

官方（第一优先）：
1. 模型与价格：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
2. V4 发布新闻：https://api-docs.deepseek.com/zh-cn/news/news260424
3. 更新日志：https://api-docs.deepseek.com/updates
4. API 参考：https://api-docs.deepseek.com/api/create-chat-completion
5. 思考模式：https://api-docs.deepseek.com/guides/thinking_mode
6. 上下文缓存：https://api-docs.deepseek.com/guides/kv_cache
7. 限速与隔离：https://api-docs.deepseek.com/quick_start/rate_limit
8. 用户协议中文版：https://cdn.deepseek.com/policies/zh-CN/deepseek-terms-of-use.html
9. 用户协议英文版：https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html

社区（传闻，仅作口碑/经验参考）：
- https://www.v2ex.com/t/1057544 （长文翻译退化 + "deepseek 不审"）
- https://www.v2ex.com/t/1105727 （翻译质量好 + 有审核波动）
- https://news.ycombinator.com/item?id=43046208 （英→梵语质量接近 Claude）
- https://news.ycombinator.com/item?id=42895610 （职业译者：R1 日→英长文后段遗漏）

实证：
- `GET https://api.deepseek.com/models` 与 `GET https://api.deepseek.com/v1/models` 均返回 HTTP 401（端点存在，需 Bearer 认证）。

# 小说 AI 翻译功能（MVP）—— 功能规格

> 来源：wayfinder 地图 #20（决策 #21–#25 全部已解决）；调研：`docs/research/novel-ai-translation-feasibility.md`（v3）、`docs/research/novel-ai-translation-code-facts.md`、`docs/research/deepseek-facts.md`、`docs/research/deepseek-api-docs-summary.md`；UI 原型：`docs/prototypes/novel-translation-prototype.html`
> 状态：ready-for-agent

## Problem Statement

Pixiv 小说以日文/英文为主，中文读者阅读门槛高。App 目前只展示原文，用户看不懂日文就放弃阅读，小说模块留存低。需要提供「一键翻译」：用户用自己的 DeepSeek API Key（BYOK），把小说正文翻译成中文。同时小说包含大量 R18/R18G 内容，翻译是否覆盖敏感内容需要用户可控（默认关 + 风险告知）。

## Solution

用户进入小说详情页 → 点击底部工具栏「🌐 翻译」→ 弹出翻译面板（翻译质量档位、思考开关、进度）→ 首次使用先填自己的 DeepSeek API Key（加密存本机、直连服务商、零服务器）→ 混合策略翻译（整章分块 + 首屏优先，3~10 秒首屏出译文、其余后台续翻）→ 译文渐进替换正文（可切回原文）→ 结果本地缓存（LRU 200 章），再次打开直接读译文。

敏感内容分级控制：R18 与 R18G 各有独立开关（默认关），开启时二次风险告知；R18G 差异化更强警告（法律红线）。翻译请求默认禁用思考模式（更快更省），提供「启用思考」开关（附小字提醒）。

## User Stories

1. 作为中文读者，我想在小说详情页一键翻译正文，以便看懂日文/英文小说
2. 作为用户，我想填一次自己的 DeepSeek API Key 就能开始翻译，以便按量自付、无需注册额外账号
3. 作为用户，我想在设置页管理我的 API Key（填写/显示/更换），以便随时更换或移除
4. 作为用户，我想在「标准 / 高质量」两档间选择翻译质量，以便在成本与质量间权衡
5. 作为用户，我想让翻译默认使用标准档（v4-flash），以便省钱且快
6. 作为用户，我想在详情页翻译时临时切换档位，以便某章想要更好质量时不用去设置页
7. 作为用户，我想默认禁用思考模式翻译，以便更快更省
8. 作为用户，我想可以选择开启思考模式，以便在需要时获得更高翻译质量，同时看到开启的代价提醒
9. 作为用户，我想翻译时看到进度（已翻块/总块），以便知道还要等多久
10. 作为用户，我想首屏内容先出译文、其余后台续翻，以便不用等全文翻完就能开始读
11. 作为用户，我想翻译完成后把「翻译」按钮切换为「原文/译文」切换按钮，以便随时对照原文
12. 作为用户，我想切换原文/译文不丢失阅读进度与搜索定位，以便流畅对照
13. 作为用户，我想翻译结果被缓存，再次打开直接读译文，以便不重复花钱
14. 作为用户，我想作者修改正文后译文自动失效重翻，以便读到最新内容
15. 作为用户，我想在设置页清除翻译缓存，以便管理磁盘占用
16. 作为用户，我想默认不翻译 R18 内容，以便不把敏感内容发送给服务商
17. 作为用户，我想主动开启「翻译 R18 内容」开关并确认风险后翻译 R18，以便按需阅读
18. 作为用户，我想 R18 内容开启时看到明确的风险告知（封号/上报/训练），以便知情决策
19. 作为用户，我想 R18G 内容有更强的警告与二次确认，以便清楚这是法律红线
20. 作为用户，我想某块翻译被政策拒绝时看到「未翻译」标记且原文保留，以便知道哪些没翻
21. 作为用户，我想失败块下次点击时补翻，以便不重复翻译成功块
22. 作为用户，我想翻译中途退出后译文不残留，以便不读到半成品
23. 作为用户，我想 API key 无效/余额不足时得到明确提示，以便及时处理
24. 作为用户，我想在未配置 key 时点翻译被引导去设置页填写，以便顺畅完成配置
25. 作为用户，我想中文正文（已是目标语言）不显示翻译入口，以便不无谓操作
26. 作为用户，我想 R18G 内容在未开启开关时不发送任何内容到服务商，以便守住法律底线
27. 作为用户，我想翻译期间切章/离开页面时请求被中止，以便不浪费 token 与避免竞态
28. 作为用户，我想译文标注为 AI 生成，以便知晓内容可能有错
29. 作为用户，我想翻译设置与清除本地数据联动，以便整体清理
30. 作为用户，我想系列内切章后新章节的翻译独立进行，以便逐章控制

## Implementation Decisions

### 模块划分（评估文档 13.1，代码事实核查确认复用点）

| 模块 | 职责 |
|---|---|
| 协议层 `api/translate.ts` | OpenAI 兼容 `POST /chat/completions`；**双模式**：Web fetch / Native CapacitorHttp（CORS，评估文档第 9 章硬约束）；错误归一化（复用 `classifyError` 思路 + 新增「政策拒绝」类型）；**不得复用 Pixiv `apiClient`** |
| 管线层 `primitives/createNovelTranslator.ts` | 段落净化 → 语言检测 → 分块（≤2000 字，段落边界）→ 首屏优先排序（当前阅读进度附近 3~5 块）→ 2~3 路并发（指数退避 ×2）→ 保序重组 → 进度/取消（AbortController + generation-gate） |
| 状态层 `stores/translationStore.ts` | key/默认档位/思考开关/R18 开关/R18G 开关（secure-storage 扩展存储）；Signal 状态机 |
| 缓存层 `utils/translationCache.ts` | IndexedDB `translations` store、LRU 200 章、原文 hash 失效 |
| 配置层 `utils/localeConfig.ts` / `modelPresets.ts` / `prompts.ts` | 语言矩阵 / 模型预设（纯数据）/ 提示词模板 |
| 工具 `utils/detectLanguage.ts` | MVP 区分 ja/en/zh（假名/谚文/拉丁/CJK 占比规则） |

### 注入点与布局约束（代码事实核查确认）

- **注入点**：`NovelDetail.tsx` 的 `blocks` createMemo（line 360）——译文**只替换 `TextBlock.text`**，绝不改写 `novelHtml`（会触发 3 个 createEffect 副作用）；虚拟布局自动重排（`createNovelVirtualLayout` 直接消费 `b.text`）
- **布局缓存地雷**：`novelTextLayoutCache` 缓存 key **不含译文维度**——原文↔译文切换会命中旧布局不重排；须加译文 hash 维度或调用 `clearNovelTextLayoutCache()`
- **DB 升级**：`db.ts` 新增 `translations` store 必须 **DB_VERSION 1→2** + onupgradeneeded 补建，否则运行时 NotFoundError
- **key 存储**：`secureStorage` 是 refresh_token 专用模块（`@aparajita/capacitor-secure-storage`），存用户 API key 需扩展接口；Web 环境为 base64 明文（已知限制）；登出不清 key（或由用户主动清除）

### API 契约（DeepSeek，来自 API 文档通读）

- 端点：`POST https://api.deepseek.com/chat/completions`，`Authorization: Bearer <user key>`
- 请求体：`model`（v4-flash / v4-pro）、`messages`（system 翻译指令 + user 原文块）、**`thinking: {"type":"disabled"}`**（默认）、`temperature: 0.3~0.7`、`max_tokens` 按块设置
- 响应：`choices[0].message.content` 为译文纯文本；`usage.prompt_cache_hit_tokens` 可观测 KV 缓存命中
- 错误码：400/401（key 无效）/402（**余额不足**）/422/429（退避重试）/500/503
- **请求保活**：非流式响应前持续返回空行——解析 JSON body 必须容忍空行/注释
- **政策拒绝**：`finish_reason=content_filter` → 失败即止（#23 决议）
- KV 缓存红利：所有分块共享同一 system prompt 前缀，最大化缓存命中（命中价 1/50）

### 翻译管线状态机（来自 #25 原型，决策富集部分内联）

```
idle → translating(progress: {done, total, failed[]}) → done | partial(有失败块) | failed
                      ↑_______ 补翻（断点续翻，仅失败块）______|
```

### 敏感内容分级（#23 决议，来自原型/评估文档）

```
decideTranslatePolicy(x_restrict, r18SwitchOn, r18gSwitchOn):
  x_restrict == 0 → allow                       // 全年龄，正常翻译
  x_restrict == 1 → r18SwitchOn ? allow : block // R18，需开关
  x_restrict == 2 → r18gSwitchOn ? allow : block // R18G，需开关（客户端拦截，不发送）
```

- 双开关均默认关；R18 告知（封号/暂停/封禁/训练）与 R18G 告知（法律红线/上报执法机构/App 免责）两级文案（见 #23 决议）
- 告知时机：开启开关时 + 首次翻译 R18 时双重弹窗
- 失败处理：政策拒绝块回退原文 + 段尾「未翻译」标记；不自动重试；整章不写缓存；断点续翻

### 缓存契约（#24 决议）

- 条目：`{ id(hash), novelId, targetLang, modelId, sourceHash(原文 md5, spark-md5 已有), paragraphs[], createdAt }`——**只存纯文本段落**
- 维度：novelId + targetLang + modelId 分开；原文 sourceHash 变化自动失效
- LRU 200 章 / ~8MB（对齐 `novelCache` 既有 LRU 模式）；半成品不写缓存
- 清除入口：设置页「清除翻译缓存」+ 并入全局「清除本地数据」

### UI（#25 决议，原型已交付）

- 详情页底部 `NovelFooterNav`（◀ 上一章 / 目录 / Aa 显示设置 / **🌐 翻译** / 下一章 ▶）加「翻译」按钮，随工具栏滚动隐藏
- 翻译面板（底部 sheet）：质量档位分段（标准=v4-flash ¥1/2 · 高质量=v4-pro ¥3/6）、「启用思考」开关（小字提醒：更慢/额外计费/temperature 失效）、进度条 + 状态文案、未配 key 引导
- 完成后「翻译」按钮变为「原文/译文」切换按钮（段落索引不变，进度/搜索保持）
- 设置页「翻译设置」分组：API Key（密码框 + 显示切换 + 保管提示）、默认档位、思考开关、R18/R18G 开关（二次确认）、清除翻译缓存
- 译文标注「AI 翻译」（服务协议 §3.7/§8.1 义务）

## Testing Decisions

**测试原则**（用户确认：管线 seam + IO 边界分层）：只测外部行为，不测实现细节；IO 边界成功/失败路径全覆盖（AGENTS.md 硬约束）。

- **管线 seam**：`createNovelTranslator`（最高 seam，注入 http/cache 依赖）：分块边界、首屏优先排序、并发与保序重组、进度回调、取消/竞态（generation-gate）、失败块回退 +「未翻译」标记、断点续翻、政策拒绝失败即止
- **IO 边界**：`translateRequest` 直接测：成功（真实 DeepSeek 响应快照作契约样例）、401 key 无效、402 余额不足、429 退避重试、`content_filter` 政策拒绝、网络错误、保活空行容忍；Native/Web 双模式分支
- **纯函数就近测试**：`detectLanguage`（ja/en/zh 判定）、`prompts`（system prompt 构建）、`modelPresets`、`translationCache`（LRU 淘汰、hash 失效、维度隔离）
- **契约测试**：mock 来自真实数据源——DeepSeek API 真实响应快照（`docs/research/` 已收集）；不得手写自洽字段
- **静默降级**：所有兜底路径（回退原文、失败块标记等）必须 `console.warn`（模块前缀）
- **E2E（agent-browser）**：登录 → 打开小说详情 → 配置 key → 翻译 → 首屏渐进注入 → 切换原文/译文 → R18 开关告知流程；依赖外部状态的路径用 driver 的 fetch mock 构造

## Out of Scope

- 多模型 / 自定义 baseURL（第一版仅 DeepSeek；`modelPresets` 配置表已预留扩展）
- 流式输出（SSE，Phase 2）、双语对照逐段切换（Phase 2）、用户术语表（Phase 2）
- 繁简本地转换（Phase 2+：自研精简表 vs opencc-js）
- 系列批量翻译（Phase 3，文档建议默认禁 R18 章节）、译文导出/分享
- 翻译质量评估与默认模型排序（Phase 3，需 R18 拒绝率实测数据）
- 峰谷定价规避策略（非硬约束，Phase 3 批量翻译时再考虑）

## Further Notes

- **成本**：单篇万字 ≈¥0.04（flash，KV 缓存红利下）；用户自付
- **合规**：首次翻译告知（内容发送服务商 + 可能去标识化后用于训练 + AI 生成标注）是服务协议 §3.5/§8.1 义务；R18 风险依据 §3.4/§7.1/§7.2（详见 `deepseek-api-docs-summary.md` 第 12 节）
- **峰谷定价**：高峰时段（北京 9-12/14-18）×2 即将上线，MVP 不处理
- **思考开关**：开启后 `temperature/top_p` 不生效（DeepSeek 文档确认），pro 档思考强度目前仅 high/max
- 实现按 AGENTS.md 工作流：to-tickets → implement（每个 ticket 独立可测、阻塞前置）

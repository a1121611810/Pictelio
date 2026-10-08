# OpenWiki vs graphify — 「AI agent / 工程师代码库知识载体」对比研究报告

> **调研日期**: 2026-09-07
> **调研对象**: OpenWiki（npm `openwiki`，langchain-ai）与 graphify（PyPI `graphifyy`，Graphify-Labs / safishamsi）
> **方法**: 本机一手调查（CLI 只读检查、skill/钩子/生成物文件读取）+ 官方来源网络调查（npm/PyPI/GitHub）。所有关键结论附出处（本地 `path:line`，网络 URL）。
> **姊妹报告**: 《CodeGraph vs OpenWiki》（`docs/research/codegraph-vs-openwiki.md`）已论证 CodeGraph 与 OpenWiki 互补；本报告补充 graphify 这一第三样本，并在第 6 节统一澄清三者关系。

---

## 1. TL;DR

**一句话定位**：OpenWiki 是「LLM agent 定期重写的叙事式 wiki」——产出人可读的 markdown 文档，回答"为什么这样设计"；graphify 是「AST 确定性抽取 + LLM 语义补充的知识图谱」——产出可遍历的 graph.json/交互图，回答"什么和什么有关系"。前者是**文档生成器**，后者是**图谱构建器**；产物形态、成本模型、幻觉控制方式完全不同。

**对本仓库（Pictelio）的结论**：**不建议把 graphify 作为常驻第四知识层引入**。本仓库已有 openwiki（叙事层，每日 CI 重生成）+ CodeGraph（符号层，确定性索引，693 文件/9,075 节点/28,974 边，2026-09-07 `codegraph status` 实测），两者恰好覆盖 graphify 对代码库的两类核心价值，且 AGENTS.md 已有三层工具路由硬约束——graphify 的 skill 自述"关于代码库的问题应优先作为 graphify 查询处理"（`/Users/lilianda/.agents/skills/graphify/SKILL.md:3`），引入即与现有路由冲突。graphify 的差异化价值（多模态语料建图、社区检测/god nodes 架构体检、跨仓合并）值得**按需一次性离线使用**，产物不落仓库（详见第 7 节）。

---

## 2. 各自机制拆解

### 2.1 OpenWiki：LLM 叙事文档流水线

```
输入：仓库源码 + git 历史 + openwiki/INSTRUCTIONS.md（用户简报）
  ↓
处理：DeepAgents 文档 agent（langchain-ai 官方，MIT）
      有序 page-job 队列 begin → submit_plan → next_page → submit_page → finish，
      断点续跑（openwiki/.run.json checkpoint）
      0.5.0 起引入 Grounded Claims：每页事实命题带 repo://src/...#L40-L82 版本化证据，
      --update 时证据过期强制重写受影响页面
  ↓
产物：openwiki/ 目录 markdown（本仓库 14 页 / 2,695 行 / 约 340KB）
      + AGENTS.md 内 OPENWIKI marker 区块（自动索引）
      + openwiki/.last-update.json（更新元数据）
  ↓
消费：人 / agent 直接读 md（AGENTS.md 路由强制"先 OpenWiki 后代码"）；
      SessionStart 钩子注入页面清单；openwiki visualize 可选交互图
```

- **LLM provider**：13 种开箱即用（OpenAI/Anthropic/Gemini/Bedrock/OpenRouter/任意 OpenAI 兼容端点含 Ollama、LM Studio）。本仓库走 DeepSeek OpenAI 兼容端点：`OPENWIKI_PROVIDER=openai-compatible`、`OPENWIKI_MODEL_ID=deepseek-v4-pro`（`.github/workflows/openwiki-update.yml:59-62`）。
- **freshness 模型**：**CI 定时全量重写**。GitHub Actions 每日 cron `0 8 * * *`（`openwiki-update.yml:6`）跑 `openwiki code --update --print`（`:56`），生成 PR 并 auto-merge（`:72-103`）。本仓 `.last-update.json` 显示最近一次 2026-09-06T12:00:16Z、model deepseek-v4-pro、status complete——**快照式**，两次更新之间的代码变更不反映。
- **成本模型**：每次更新都是 agent 全程读仓库 + 逐页写作 + 校验，**每日固定 LLM 开销**（DeepSeek 计费）+ CI 时长 + 每日一个 PR 的评审噪音。匿名 telemetry 默认开启（可用 `OPENWIKI_TELEMETRY_DISABLED` 关闭）。
- **版本注意**：npm 最新 0.5.0（2026-09-01），本仓 CI **锁 0.2.5**（`openwiki-update.yml:53`，注释"0.2.3 在部分仓库会卡死"）。0.5.0 README 描述的 Grounded Claims / `.claims/` sidecar 在本仓 `openwiki/` 下**不存在**（`find openwiki -maxdepth 1` 仅见 `.last-update.json` 一个隐藏条目，2026-09-07 实测）——即本仓当前版本的叙事页面**没有机器可校验的证据链**。

出处：npm 元数据（https://www.npmjs.com/package/openwiki ，name=openwiki / version=0.5.0 / license=MIT / repository=langchain-ai/openwiki）；机制与命令（https://github.com/langchain-ai/openwiki README）；本地 `.graphify` 无关文件略；用户简报 `openwiki/INSTRUCTIONS.md:1`；页面规模 `wc -l openwiki/**/*.md`（14 文件 2,695 行，2026-09-07 实测）。

### 2.2 graphify：AST + 语义双通道知识图谱

```
输入：任意文件夹（代码/文档/论文/图片/视频/SQL/配置），GitHub URL 直连克隆，
      多仓 / 多子目录 merge-graphs 合并
  ↓
处理（双通道并行）：
  A. 结构通道：代码走 tree-sitter AST 确定性抽取（~40 语言），
     「无 LLM、无 key、无网络外发」（SKILL.md:157）
  B. 语义通道：仅 docs/papers/images。有 GEMINI_API_KEY 走 Gemini
     （默认 gemini-3-flash-preview，SKILL.md:162）；无 key 则宿主 agent 派子代理充当 LLM
     （SKILL.md:196-208，强制 Task 工具并行，20-25 文件/chunk）。
     纯代码语料跳过 B 通道（SKILL.md:198 fast path）。
     语义结果按「抽取 prompt 品种 + 文件内容 hash」双键缓存（SKILL.md:220，#1939）
  ↓
图构建：networkx 建图（references/query.md:83-87 兜底路径直接 import networkx）
      → Leiden 社区检测 → god nodes / surprising connections / suggest questions
      → graph.html（交互图）+ GRAPH_REPORT.md（审计报告）+ graph.json（GraphRAG 数据）
  ↓
消费：graphify query（BFS/DFS 遍历 + 词表扩展 + --budget token 上限）
      / path（两概念最短路）/ explain（单节点解释）；
      --mcp 启动 stdio MCP server（query_graph/get_node/get_neighbors/get_community/
      god_nodes/graph_stats/shortest_path 七工具，references/exports.md:59-65）；
      导出 Obsidian vault / --wiki 每社区一篇文章 / Neo4j / FalkorDB / GraphML / SVG
```

- **准确性控制（graphify 最有辨识度的设计）**：每条边强制携带 `confidence` 标签 + `confidence_score` 分数——`EXTRACTED`（源码显式，恒 1.0）/ `INFERRED`（推理，离散档 0.95/0.85/0.75/0.65/0.55，**禁止 0.5 兜底**）/ `AMBIGUOUS`（0.1-0.3，不确定就标注而非省略）（`references/extraction-spec.md:13-16, 47-59`）。SKILL.md 末尾还有五条 Honesty Rules：「Never invent an edge」「Always show token cost」等（`SKILL.md:704-711`）。
- **freshness 模型**：**增量 + 事件驱动，多档位**——
  - `--update`：只重抽 new/changed 文件；**纯代码变更完全跳过语义通道、零 LLM**（`references/update.md:64`）；
  - `--watch`：常驻监听，代码变更自动重建（无 LLM），文档变更写 `needs_update` flag 等手动处理（`references/add-watch.md:47-52`；`SKILL.md:32`）；
  - post-commit hook：`graphify hook install`，每次 commit 后对 diff 中的代码文件重跑 AST（`references/hooks.md:9-17`）；
  - 本机用户级 SessionStart 钩子在 graph.json 落后 ≥7 天时注入漂移警告（`~/.zcode/hooks/graphify-session-start.sh:22-29`）。
- **成本模型**：代码通道**零 token**；语义通道一次抽取后按缓存复用（内容不变不重抽）；社区命名可选 LLM（`graphify label --backend=...`，`graphify --help`）；累计成本写入 `graphify-out/cost.json`（`SKILL.md:595-617`）。
- **查询体验的短板**：`query` CLI 的节点匹配是「case-folded 子串 + IDF」，无词干/同义/跨语言匹配，需要 agent 先做词表扩展（从 graph.json 节点标签提 vocab、限选 12 个 token、禁止发明词），否则答案塌缩为噪音（`references/query.md:23-59`）。另有 save-result 反馈回路：问答结果与 useful/dead_end/corrected 标注写回图谱，`graphify reflect` 生成 LESSONS.md 工作记忆（`references/query.md:168-183`）。

出处：PyPI 元数据（https://pypi.org/project/graphifyy/ ，graphifyy 0.9.55 / 2026-09-05 / Apache-2.0 / requires-python>=3.10 / tree-sitter ~40 语言）；GitHub README（https://github.com/Graphify-Labs/graphify ，~115.3k stars / 11.2k forks / 598 open issues / 1,662 commits / YC 公司徽章 / 双 Apache-2.0-MIT）；本机安装 uv tool `graphifyy 0.9.53`（`uv tool list` 实测，CLI `~/.local/bin/graphify`，skill `~/.agents/skills/graphify/`，SKILL.md 41KB + references/ 8 文件）。

---

## 3. 逐维度对比

| 维度 | OpenWiki | graphify |
|------|----------|----------|
| **核心机制** | DeepAgents LLM agent 叙事写作（全程 LLM） | 代码 tree-sitter AST 确定性 + 文档/图片 LLM 语义，混合 |
| **产物形态** | `openwiki/` markdown 页面（人读优先）+ AGENTS.md 索引区块 | `graphify-out/`：graph.html 交互图 + GRAPH_REPORT.md + graph.json（机器查询优先） |
| **准确性 / 幻觉控制** | 叙事文本可能编造；0.5.0 用 Grounded Claims 证据链缓解，**本仓锁的 0.2.5 无此机制**（本仓 openwiki/ 无 .claims/ 实测） | 结构边零幻觉（AST）；语义边强制 EXTRACTED/INFERRED/AMBIGUOUS + 离散置信分，诚实标注设计（extraction-spec.md:13-16） |
| **新鲜度 / 漂移** | 每日 CI 快照（cron 0 8 * * *），白天必然漂移；`.last-update.json` 可查时刻 | `--update`/`--watch`/post-commit hook 近实时；纯代码变更零 LLM 即时跟；≥7 天漂移有钩子警告 |
| **成本模型** | 每次更新全量 LLM agent 运行，**每日固定开销**（本仓 DeepSeek） | 代码通道零 token；语义通道一次抽取 + 内容 hash 缓存；cost.json 追账 |
| **查询接口** | 读 markdown（人/agent 同构）；无结构化查询 | BFS/DFS query、path、explain、MCP server 七工具、GraphRAG JSON、Neo4j/FalkorDB |
| **CI / 维护负担** | 需 workflow + 双 secret（API key + PAT）+ 每日 PR 编排 + 版本锁版维护（0.2.3 卡死教训，openwiki-update.yml:52-53） | 零 CI 必选项；可选 hook/watch；graphify-out/ 入库与否需决策 |
| **人可见性** | 极高：可直接当 onboarding wiki 读（quickstart → 文档地图 → 分主题页） | 中：graph.html 可视化直观，GRAPH_REPORT.md 是审计报告而非教程；--wiki/--obsidian 可补 |
| **agent 可见性** | 高：AGENTS.md marker 区块 + SessionStart 页面清单注入 | 高：SessionStart 图谱可用性注入 + MCP server + skill fast path（graph.json 存在即直接 query） |
| **可移植性** | markdown 天然可移植；OKF 打包格式 | graph.json + GraphML/Neo4j/Obsidian/SVG 多出口；但 skill 编排深度绑定宿主 agent |
| **生态成熟度** | langchain-ai 官方；~16.2k stars；npm 23 版 / 2.5 个月（2026-06-26 起）；MIT | ~115.3k stars / 598 open issues；PyPI 223 版 / 5 个月（2026-04-04 起）；Apache-2.0/MIT 双协议；YC 背景 + 商业孪生产品 |
| **隐私** | 仓库源码全文进 LLM 上下文（可换本地 Ollama 端点缓解）；telemetry 默认开 | 代码通道纯本地零外发；仅文档/图片语义通道外发（可宿主 agent 内化）；无 telemetry |
| **多模态语料** | 不支持（代码 wiki；personal 模式接 connector 是另一条产品线） | 原生支持 PDF/图片（vision）/视频音频（whisper 转写）/URL/arXiv/SQL schema |

同类赛道坐标系（一句话带过）：DeepWiki 类产品（对 GitHub 仓库生成 AI wiki，消费在网页端）与 OpenWiki 同属「叙事文档生成」但缺少仓库内 agent 路由闭环；Sourcegraph / Cursor 的代码索引与 CodeGraph 同属「代码智能检索」，不做叙事也不做概念图谱；graphify 自我定位是「反 RAG/反向量库」的显式图遍历 + GraphRAG 数据层（https://github.com/Graphify-Labs/graphify README："Not a vector index... a real graph you traverse"）。

---

## 4. 优缺点清单

### 4.1 OpenWiki

**优点**
1. **唯一能回答"为什么"的层**：叙事页面承载设计意图、ADR 脉络、领域概念——本仓 quickstart 的 ADR 大表（`openwiki/quickstart.md:73-120`，0001→0122 逐条带链接）是 CodeGraph 和 graphify 都产不出的。
2. **人读体验最好**：front-matter + Quick Facts 表 + mermaid 时序图（`openwiki/architecture/overview.md:38-56`）+ 文档地图（`quickstart.md:32-51`），新人 onboarding 可当唯一入口。
3. **agent 路由闭环完整**：自动维护 AGENTS.md marker 区块（本仓 `AGENTS.md:674-682`）+ 本机 SessionStart 钩子动态注入页面清单（`~/.zcode/hooks/openwiki-session-start.sh:21`），生成物对 agent 的可达性是三者中最好的。
4. **Grounded Claims 证据链**（0.5.0+）：事实命题带 `repo://` 行级证据，update 时证据过期强制重写（https://github.com/langchain-ai/openwiki README）——叙事工具里少见的反幻觉设计。
5. **官方背书 + 健康迭代**：langchain-ai 官方、MIT、2.5 个月 23 个 npm 版本（`npm view openwiki time --json` 实测）。
6. **provider 灵活**：OpenAI 兼容端点意味着可用 DeepSeek（本仓现状）甚至本地 Ollama，可私有化。

**缺点**
1. **每日全量 LLM 重写的持续成本**：agent 全程读仓库 + 写 14 页 + 校验，是三者为同一代码库耗 token 最多的方案（对比 graphify 代码通道零 token）。
2. **叙事幻觉无兜底（本仓现状）**：0.2.5 无 Grounded Claims 产物（openwiki/ 无 .claims/ 实测），叙事与实现的偏差只能靠"AGENTS.md 定位其为高层理解而非代码事实"软约束缓解（`AGENTS.md:676-679` 维护规则）。
3. **快照滞后**：每日一次更新，日内的代码变更不反映（`.last-update.json` updatedAt 2026-09-06T12:00，而仓库持续提交）。
4. **上游迭代剧烈，锁版维护成本真实存在**：0.2.3 部分仓库卡死被迫 pin 0.2.5（`openwiki-update.yml:52-53`）；0.2.5 与最新 0.5.0 已差 5 个 minor 版本。
5. **CI 编排复杂**：双 secret 校验 + 脱敏诊断 + PAT 建 PR + auto-merge 幂等处理（`openwiki-update.yml:16-103`），都是持续维护面。
6. **telemetry 默认开启**（README 明示，需 `OPENWIKI_TELEMETRY_DISABLED`/`DO_NOT_TRACK` 显式关闭）。
7. **每日一个 docs PR 的评审噪音**（靠 auto-merge 消化，但仍占用 CI 时长与 git 历史）。

### 4.2 graphify

**优点**
1. **代码通道零 LLM、零 key、零外发**（`SKILL.md:157`）：隐私与成本双赢，纯代码语料全程离线（PyPI 页："nothing leaves the machine"）。
2. **诚实的置信度体系**：EXTRACTED/INFERRED/AMBIGUOUS 三档 + 禁止 0.5 兜底的离散评分卡（`extraction-spec.md:47-59`）+ 图健康诊断（ dangling/self-loop/collapsed 边检查，`SKILL.md:453-477`）——把"图谱可信度"做成了可审计的一等公民，与 OpenWiki 的叙事自证形成方法论对照。
3. **新鲜度多档位**：--update 纯代码变更零 LLM（`update.md:64`）、--watch、post-commit hook、7 天漂移钩子警告，梯度完整。
4. **查询接口最丰富**：BFS/DFS + path + explain + MCP 七工具 + GraphRAG JSON + Neo4j/FalkorDB/Obsidian/wiki 导出（`exports.md` 全篇）。
5. **多模态与跨仓**：PDF/图片/视频/URL 语料 + `merge-graphs` 跨仓合并 + GitHub 直连（`references/github-and-merge.md:16-26`）。
6. **自我改进回路**：save-result 把问答写回图谱，reflect 生成 LESSONS.md（preferred sources / dead ends / corrections）（`query.md:168-183`）。
7. **生态火热**：5 个月 223 个 PyPI 版本、~115.3k stars（https://github.com/Graphify-Labs/graphify ），issue 编号已到 #2528 量级（SKILL.md 内注释），工程迭代活跃。

**缺点**
1. **编排重依赖宿主 agent 遵从度**：SKILL.md 41KB 中 ~90% 是给 agent 的编排指令（缓存、chunk、子代理、合并、防 shrink），产物质量取决于执行 agent 是否严格照做；在不能派子代理的宿主上语义通道要降级 inline 或要 Gemini key（`SKILL.md:164`）。
2. **无叙事层**：图回答"什么和什么有关系"，不回答"为什么这么设计"；GRAPH_REPORT.md 是统计审计报告，不能替代 onboarding 文档（graphify --wiki 产物也是每社区一篇的结构化文章，非设计叙事）。
3. **查询匹配弱**：子串 + IDF，无词干/同义/跨语言，必须靠 agent 词表扩展步骤补救（`query.md:23-59`），跨语言仓库（如本仓中文注释）命中率风险高。
4. **项目极年轻**：223 个版本 / 5 个月 ≈ 每日 1.5 个版本；节点 ID 格式变更要求旧图 `--force` 重建（`extraction-spec.md:61`）；graph.json 与 skill 版本耦合，升级成本未知。
5. **产物入库决策悬空**：graphify-out/（含 graph.html 数 MB）无天然 gitignore 共识；本仓 .gitignore 只忽略了 `.codegraph/*`（`.gitignore:11`），引入需新加规则。
6. **`graphify agents install` 会改写项目 AGENTS.md**（`hooks.md:21-29`），其"codebase 问题先查 graph"的自述路由（`SKILL.md:3`）与本仓 AGENTS.md 的 openwiki/codegraph 硬约束路由**直接冲突**。
7. **>5000 节点的可视化需聚合降级**（`SKILL.md:710`、`graphify --help` cluster-only --no-viz），本仓若建图（9k+ 符号、数十 KB/文件的 md 语料）大概率触顶。

---

## 5. 适配矩阵：什么项目适合哪个

| 项目特征 | 更适合 OpenWiki | 更适合 graphify |
|----------|----------------|-----------------|
| 人类 onboarding 是首要目标（新成员多、开源社区） | ✅ 叙事 wiki 直读 | ⚠️ 图谱对人不友好（--wiki/--obsidian 可弥补一半） |
| AI agent 自主导航是首要目标（agent 占多数交互） | ✅ AGENTS.md 路由闭环 | ✅ MCP server + fast path query |
| 需要精确"代码在哪/谁调用/改动影响面" | ❌ 页面级粒度 | ⚠️ 概念级边（calls 有方向约束但非全量符号索引） |
| 预算敏感 / 内网离线 / 禁止源码外发 | ⚠️ 可接 Ollama 但 agent 全程跑本地大模型成本高 | ✅ 代码通道纯本地零外发零 token |
| 语料含大量非代码资产（论文/设计稿/录屏/PDF） | ❌ 不支持 | ✅ 原生多模态（vision/whisper/SQL） |
| monorepo / 多仓关联分析 | ⚠️ 单仓 wiki 为单位 | ✅ merge-graphs 跨子图/跨仓合并（github-and-merge.md:28-44） |
| 高频迭代、要求知识与代码同步 | ⚠️ 每日快照有日内漂移 | ✅ watch/hook 近实时（代码侧） |
| 文档密度高、设计决策记录丰富（ADR 多） | ✅ 能把 git 历史 + ADR 织成叙事 | ⚠️ 边能连出引用关系但讲不出决策逻辑 |
| 想做架构体检（耦合热点、意外关联） | ❌ | ✅ god nodes / surprising connections / 社区检测是独门能力 |
| 需要可校验的事实证据链 | ⚠️ 0.5.0+ Grounded Claims | ✅ 边级 EXTRACTED/INFERRED + source_location 溯源 |

经验法则：**两者服务的不是同一问题**——"让人和 agent 理解这个仓库的设计"选 OpenWiki；"让 agent 在异构语料上做结构化探索/发现隐藏关联"选 graphify。若只能选一个且是常规代码仓库，OpenWiki 的单位投入产出更高（graphify 的代码图价值会被任意一个符号级索引工具摊薄，见第 6 节）。

---

## 6. 易混淆点：OpenWiki vs graphify vs CodeGraph（.codegraph）

三者都带"知识/图"色彩，但**机制、产物、用途两两不同**：

| | OpenWiki | graphify | CodeGraph（本仓 `.codegraph/`） |
|---|---|---|---|
| 本质 | LLM 生成的**叙事文档** | AST+LLM 的**概念知识图谱**（GraphRAG 数据层） | 纯确定性的**符号级代码索引** |
| 图的节点/边 | 无图（文档 + 链接；visualize 仅展示用） | 概念/实体节点；边带 EXTRACTED/INFERRED/AMBIGUOUS + 置信分 | 符号节点（function/method/import/interface…，本仓 9,075 个）；边是调用/导入等确定性关系（28,974 条，`codegraph status` 实测） |
| 是否用 LLM | 全程 | 仅代码外的语义通道 | 完全不用 |
| 存储 | openwiki/*.md | graphify-out/graph.json + html + report | `.codegraph/` SQLite WAL（67.10MB，`.gitignore:11` 忽略） |
| 查询方式 | 读 md | 自然语言 BFS/DFS query / path / explain / MCP | 符号名 explore/query/callers/callees/impact/affected |
| 回答的问题 | "为什么这样设计、整体怎么运作" | "哪些东西互相关联、耦合热点在哪、跨文档有什么隐藏连接" | "这个符号在哪、谁调它、我改了会影响哪些测试" |
| 更新 | CI 每日全量重写 | --update/--watch/hook 增量 | index/sync 增量（随代码同步） |
| 测试联动 | 无 | 无 | **独有**：`git diff \| codegraph affected --stdin` |

**graphify 与 CodeGraph 的重点澄清**（最易混）：两者都产"图"，但 graphify 的图是**语料的概念地图**——节点是文档/代码里抽取的实体与概念，边允许 LLM 推理（INFERRED），服务探索与发现；CodeGraph 的图是**源码的符号调用图**——节点/边全部来自确定性 AST 解析，零幻觉，服务精确导航与影响分析。graphify 对纯代码仓库的 `calls` 边（有 caller→callee 方向约束，`extraction-spec.md:20`）看似与 CodeGraph 重叠，但前者是语义抽样的子集（还要求 agent 守方向规则），后者是全量索引。**代码理解场景 CodeGraph 严格更强，graphify 不可替代之处在非代码语料与跨文档语义发现。**

三者在用户级钩子上已呈互补编排（`~/.zcode/cli/config.json` → `/hooks/events/SessionStart` 注册三脚本）：codegraph 钩子注入索引健康摘要与使用路由（`codegraph-session-start.sh:24-28`）；openwiki 钩子在项目有 `openwiki/` 时注入页面清单与"禁止手改"提醒（`openwiki-session-start.sh:21`）；graphify 钩子在项目有 `graphify-out/graph.json` 时注入查询路由与 7 天漂移警告（`graphify-session-start.sh:31`）。三钩子都有静默门禁（各自 :6-12 行），互不干扰——这是目前三者能共存的机制基础。

---

## 7. 对本仓库（Pictelio）的具体建议

**结论：不建议作为常驻第四知识层引入；建议按需一次性离线使用，产物不落仓库。**

### 7.1 不建议常驻引入的理由

1. **生态位已被占满**：本仓 openwiki（叙事/设计意图，每日 CI）+ CodeGraph（符号/调用链/影响面，实时索引）正好覆盖 graphify 对代码库的两大产出。graphify 的代码图相对 CodeGraph 无增量价值（第 6 节），其叙事能力相对 openwiki 无增量价值。
2. **路由冲突风险**：仓库 AGENTS.md 已有强制工具路由（OpenWiki 查询规范 + 代码智能规范 + 文档查询规范，`AGENTS.md:674-682` 及前文），且 graphify 未在 AGENTS.md 出现（grep 实测 0 命中）。graphify skill 的 description 声称"codebase 问题应首先作为 graphify query 处理"（`SKILL.md:3`），`graphify agents install` 还会写入自己的 AGENTS.md 区块（`hooks.md:21-29`）——一旦激活就与现有硬约束打架。
3. **维护面净增**：graphify-out/ 无忽略规则（`.gitignore` 现只忽略 `.codegraph/*`）；223 版/5 个月的Young 项目带来 skill 与 graph 版本漂移问题；本仓前端 TS + Vue SFC + Java + Kotlin + Astro 多语言混合，graphify 每种语言的 AST 覆盖质量参差（tree-sitter grammar 依赖额外 extras）。
4. **规模触顶**：本仓 693 文件 / 9k+ 符号，graph.html 的 5000 节点上限意味着必须聚合降级（`SKILL.md:710`），交互图体验打折。

### 7.2 值得按需一次性使用的场景（不落仓库）

1. **架构体检**：对本仓跑一次全量建图，用 **god nodes**（最连通节点）定位耦合热点、**surprising connections**（跨社区意外关联）发现架构隐患、**社区检测**验证"包边界 = 模块边界"是否成立。产物放 `/tmp` 或临时目录，结论写进 `docs/research/` 即弃。这是 openwiki/CodeGraph 都给不了的视角。
2. **ADR/文档语料探索**：`docs/adr/` 有 96+ 篇决策记录（AGENTS.md 记载"最新到 ADR-0096"），openwiki 只覆盖代表性子集、CodeGraph 完全不索引 md 语义。对 `docs/` 单独建图（`graphify extract ./docs/`，headless CLI 直跑绕开 skill 编排，见 `github-and-merge.md:33-44` 的子目录模式）可以发现 ADR 之间的主题聚类与隐藏引用关系。
3. **双引擎差分**（低优先级）：`app` 与 `app-lynx` 的同语义模块（如 authStore vs authStore.ts）可用语义 `semantically_similar_to` 边做差分对照，但注意语义通道在本机要走宿主 agent 子代理（烧本会话 token）或配 GEMINI_API_KEY。

### 7.3 若未来确要引入（前提条件清单）

- 用 headless `graphify extract`（CLI 直跑），不激活 skill 编排；
- `graphify-out/` 加入 `.gitignore`（对齐 `.codegraph/*` 先例）；
- **禁止** `graphify agents install`（不改 AGENTS.md）；不安装 post-commit hook（CodeGraph sync 已覆盖代码同步需求）；
- 若要 agent 查询，走 `--mcp` 按需启动而非常驻；
- 待 graphify 图谱查询的跨语言/中文匹配改进后再评估（当前子串+IDF 匹配对本仓中文注释语料命中存疑，`query.md:25`）。

---

## 8. 引用来源

### 8.1 本地文件（绝对路径）

| 来源 | 用途 |
|------|------|
| `/Users/lilianda/.agents/skills/graphify/SKILL.md`（41KB） | graphify 编排全流程、no-key 策略(:157)、Gemini 模型(:162)、Part B 子代理(:196-208)、缓存(:220)、cost(:595-617)、Honesty Rules(:704-711)、sponsor(:635) |
| `/Users/lilianda/.agents/skills/graphify/references/extraction-spec.md` | 边置信度体系(:13-16, 47-59)、节点 ID 规则(:61)、calls 方向(:20) |
| `/Users/lilianda/.agents/skills/graphify/references/query.md` | BFS/DFS(:9-10)、词表扩展(:23-59)、save-result/reflect(:168-183)、networkx 兜底(:83-87) |
| `/Users/lilianda/.agents/skills/graphify/references/update.md` | 增量更新、code-only 零 LLM(:64) |
| `/Users/lilianda/.agents/skills/graphify/references/exports.md` | wiki/Neo4j/FalkorDB/SVG/GraphML/MCP 导出(:59-65) |
| `/Users/lilianda/.agents/skills/graphify/references/hooks.md` | post-commit hook(:9-17)、agents install(:21-29) |
| `/Users/lilianda/.agents/skills/graphify/references/github-and-merge.md` | 跨仓克隆合并(:16-26)、monorepo 子目录(:28-44) |
| `/Users/lilianda/.agents/skills/graphify/references/add-watch.md` | --watch 行为(:47-52) |
| `/Users/lilianda/.agents/skills/graphify/.graphify_version` | 本机安装版本 0.9.53 |
| `/Users/lilianda/develop/pixivizer/.github/workflows/openwiki-update.yml` | cron(:6)、锁版 0.2.5 与卡死注释(:52-53)、DeepSeek 配置(:59-62)、PR/auto-merge(:72-103) |
| `/Users/lilianda/develop/pixivizer/openwiki/`（14 页 md + INSTRUCTIONS.md + .last-update.json） | 生成物形态、篇幅（2,695 行）、mermaid(:38-56 of architecture/overview.md)、ADR 表(quickstart.md:73+)、最近更新 2026-09-06T12:00Z/deepseek-v4-pro |
| `/Users/lilianda/.zcode/hooks/{codegraph,openwiki,graphify}-session-start.sh` | 三钩子门禁与注入内容 |
| `/Users/lilianda/.zcode/cli/config.json`（`/hooks/events/SessionStart`） | 三钩子注册（codegraph 10s / openwiki 5s / graphify 5s） |
| `/Users/lilianda/develop/pixivizer/AGENTS.md` | OPENWIKI marker 区块(:674-682)、CodeGraph 章节(:700)、工具路由硬约束 |
| `/Users/lilianda/develop/pixivizer/.gitignore:11` | 仅忽略 `.codegraph/*` |
| `/Users/lilianda/develop/pixivizer/docs/research/codegraph-vs-openwiki.md` | 姊妹报告（CodeGraph 与 OpenWiki 互补论证） |
| CLI 实测（2026-09-07）：`which`（openwiki→~/.bun/bin、graphify→~/.local/bin、codegraph→~/.vite-plus/bin）、`openwiki --help`（v0.2.5）、`codegraph status`（693 文件/9,075 节点/28,974 边/67.10MB）、`graphify --help`（子命令全表）、`uv tool list`（graphifyy 0.9.53）、`npm view openwiki time --json`（23 版时间线）、PyPI JSON API（223 版时间线）、`find openwiki -maxdepth 1`（无 .claims/） | 安装与运行时事实 |

### 8.2 网络来源

| 来源 | 用途 |
|------|------|
| https://www.npmjs.com/package/openwiki | name=openwiki / version=0.5.0（2026-09-01）/ MIT / repository langchain-ai/openwiki / DeepAgents 描述 / unpackedSize |
| https://github.com/langchain-ai/openwiki | README：机制（DeepAgents、page-job 队列、.run.json）、Grounded Claims 与 repo:// 证据、13 provider、命令表、CI 策略、局限性清单、telemetry 默认开、~16.2k stars |
| https://pypi.org/project/graphifyy/ | graphifyy 0.9.55（2026-09-05）/ Apache-2.0 / tree-sitter ~40 语言 / extras 清单 / "edges tagged EXTRACTED or INFERRED" |
| https://github.com/Graphify-Labs/graphify | README：反 RAG 定位、~115.3k stars / 11.2k forks / 598 open issues / 1,662 commits、双协议、YC 徽章、benchmarks（LOCOMO/LongMemEval-S vs mem0/supermemory） |
| https://pypi.org/pypi/graphifyy/json | 223 个版本、首发 2026-04-04（0.1.1）→ 最新 2026-09-05（0.9.55）时间线 |
| https://github.com/sponsors/safishamsi | graphify 赞助链接（SKILL.md:635 引用） |

> 注：GitHub REST API 当日限流未能交叉验证 star 数，stars/forks/issues 数值以仓库页面 HTML 抓取为准（2026-09-07 时点）。graphify 仓库主分支活跃开发在 v8 分支（README 页抓取），版本节奏快，引用其能力前建议复核当下版本行为。

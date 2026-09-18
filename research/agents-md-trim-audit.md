# AGENTS.md 瘦身审计（wayfinder #598）

> 父 ticket：#597「Wayfinder map: AGENTS.md 瘦身至 32KB 以下」
> 本文档：逐 section 去留 / 重叠度 / 节省预估 + 裁剪映射表 + 总量测算 + 风险清单。
> 审计日期：2026-09-18；审计对象：`AGENTS.md` @ `origin/main`（2adbdeea），**60,584 bytes**。
> 方法说明：字节数用 awk 按 section 累加（每行 `length($0)+1`，含标题行），各 section 之和与文件总字节数精确 reconciliation（60,584）。ticket #598 给出的各 section 字节数与本文略有出入（<1%，计法差异），本文以 reconciliation 精确的数值为准。

## 0. 抽查方法与关键证据（oracle 溯源）

对下列代表性主张回源验证，证据均为一手来源（源码 / 生成文档 / 配置文件）：

| # | AGENTS.md 主张 | 验证结果 | 证据 |
|---|---|---|---|
| E1 | Monorepo 结构章节：ADR「最新到 ADR-0096」 | **陈腐**：实际最新 ADR-0167（差 71 个） | `ls docs/adr/` |
| E2 | 关键设计决策：引擎路由「15 格矩阵」 | **陈腐**：源码 `EngineRouting.decide` 共 13 条 return 路径（S1/S1a/S1b/S2/S3/S4/S5/S5′/S9/S10/S11 + stay×2）；openwiki 写「12-cell」，三方不一致 | `packages/app/android/.../engine/EngineRouting.java:53-140` |
| E3 | 代码智能规范：「MCP 配置已随 reasonix.toml / .mcp.json 一并移除」 | **属实**：两文件均不存在；但 openwiki/quickstart 仍写「CodeGraph MCP server is registered in .mcp.json」——**openwiki 侧滞后** | `ls .mcp.json reasonix.toml`（No such file）；`openwiki/quickstart.md` |
| E4 | 约定：minSdkVersion = 28 在 variables.gradle | **属实** | `packages/app/android/variables.gradle:2` |
| E5 | 约定：WebView ≥85 门槛 / 引擎降级矩阵 | **高度重叠且更细**：阈值、fail-open、双向降级、10s 超时不自动跳、`?reason=no_engine` 均有 | `docs/platform-compatibility.md:7-50` |
| E6 | 测试硬约束「与 AGENTS.md 一致」的另一镜像 | **存在**：`packages/app/tests/TESTING.md`（5,620 B）逐条镜像 6 条硬约束 | `packages/app/tests/TESTING.md:57-63` |
| E7 | openwiki CI 是否回写 AGENTS.md | **会**：workflow `add-paths` 含 `AGENTS.md`，`openwiki code --update` 维护 `<!-- OPENWIKI:START/END -->` 块 | `.github/workflows/openwiki-update.yml:79-82` |
| E8 | 命令表是否已有摘要 | **部分重叠**：quickstart「Available Scripts」13 行核心表（AGENTS.md 有 30+ 行）；权威源 = 根 `package.json` | `openwiki/quickstart.md` §Available Scripts |
| E9 | Fluent 规范是否有现成 docs home | **无**：`docs/style-guides/` 仅 `ui-copy.md`；openwiki 全库无 `durationNormal`/`cubic-bezier` 规范性内容 | `ls docs/style-guides/`；`grep -r cubic-bezier openwiki/` |
| E10 | 发布 / 签名流程文档 | **存在**：`docs/release-checklist.md`、`docs/release-signing.md` | `ls docs/` |

结论性观察：

- **描述性 inventory 已出现系统性陈腐**（E1、E2），且越细的枚举陈腐越快——支持大砍「架构 / Monorepo 结构 / 测试文件清单」。
- **openwiki 不是无条件权威**（E3 滞后、E2 与源码不一致）；迁移目标采用「openwiki 页面 + ADR/spec 锚」双指针，单一 openwiki 指针不够。
- **CI 维护块**（OPENWIKI / CODEGRAPH 标记区）裁剪前须确认归属（E7）。

## 1. 裁剪映射表（逐 section）

字节 = 现字节（awk 实测）；节省 = 预估；结果 = 预估剩余。

| Section | 现字节 | Disposition | 目的地 / 依据 | 预估节省 | 结果 | 重叠证据（一行） |
|---|---:|---|---|---:|---:|---|
| 题头 `# Pictelio` + 引言 | 337 | 原地压缩 | —（身份声明保留，双引擎一句话定位保留） | 87 | 250 | 引言与 quickstart「Quick Facts」部分重叠（`openwiki/quickstart.md`） |
| 项目概览 | 2,098 | 原地压缩 | —（保留技术栈/入口/设计系统/API 双模式 4-5 条；**路由枚举 17 条删除**，迁指针） | 1,298 | 800 | 路由表在 `openwiki/architecture/overview.md` §Routing（line 108）；包清单在 §Monorepo Layout |
| 工具触发协议 | 2,160 | **保留原文**（规范） | —；仅「持续反馈闭环」子节与「任务完成前自检」去重措辞 | 200 | 1,960 | 路由表为 agent 首跳路由层，无现存 docs 可承载（降级表唯一） |
| 代码智能规范 | 2,899 | **保留原文**（规范） | —；E3 显示 openwiki 相关叙述滞后，反而以本节为准 | 199 | 2,700 | openwiki/quickstart §Tooling 仅工具性描述，无守卫/逃逸阀规则 |
| 文档查询规范 | 1,257 | **保留原文**（规范） | — | 50 | 1,207 | 决策链唯一出处 |
| OpenWiki 查询规范 | 2,116 | **保留原文**（规范） | — | 150 | 1,966 | 指针表本身就是路由目标清单，压缩=损路由 |
| 命令 | 4,499 | 原地压缩 | 权威源 = 根 `package.json`；摘要已存在于 `openwiki/quickstart.md` §Available Scripts（E8）；保留约定句 + 8-10 核心行 | 2,999 | 1,500 | quickstart 13 行表 + ADR-0059 |
| Monorepo 结构 | 3,658 | 删除（主体 tree）+ 3 行指针 | `openwiki/architecture/overview.md` §Monorepo Layout；`openwiki/quickstart.md` §Key Source Files（均已存在，无需新建） | 3,108 | 550 | E1：本节「ADR-0096」陈腐 vs 实际 0167；tree 与 overview Layout 逐行对应 |
| 架构 | 12,914 | 删除（src/ 逐文件 tree）+ 8 行分层总览 | `openwiki/architecture/overview.md` §Component Architecture + 各 domain 页 §Key Source Files + `openwiki/quickstart.md` §Key Source Files | 12,214 | 700 | 逐文件枚举（api/stores/routes/components/primitives…）与 openwiki 各页 Key Source Files 逐一对应；陈腐最快（cf. E2） |
| 关键设计决策 | 7,329 | 原地压缩 + 分项迁移指针 | 网关/API 客户端 → `openwiki/architecture/api-layer.md`；图片流水线 → `openwiki/architecture/image-pipeline.md`；Android 增强/引擎决策 → `openwiki/integrations/android-native.md`（§Engine Availability Fallback）；虚拟滚动/R18 → `openwiki/domain/feed-and-browsing.md`；**即时导航硬约束逐字保留** | 5,429 | 1,900 | 各子节与对应 openwiki 页标题级对应；引擎「15 格」陈腐（E2） |
| 约定 | 4,548 | 原地压缩 | Android 平台/引擎 → `docs/platform-compatibility.md`（E5）；签名 → `docs/release-signing.md`；Node/pnpm → `openwiki/quickstart.md` Prerequisites；AGP/JDK 锁定 → `android/build.gradle` 头注释；Lint/fmt 细则 → `vite.config.ts` 自身 | 2,598 | 1,950 | 平台矩阵、签名步骤、版本锁定均逐字级重复 |
| Fluent Design 规范 | 3,788 | **保留原文**（规范，无现成 home，E9） | （可选远期：`docs/style-guides/fluent.md`，本 ticket 不建） | 200 | 3,588 | openwiki 仅叙述性提及 Fluent；曲线/时长/禁止清单唯一出处 |
| 测试 | 5,916 | 原地压缩 | 硬约束镜像 → `packages/app/tests/TESTING.md`（E6，已存在）；分层/门禁叙述 → `openwiki/testing/overview.md`；**文件枚举（13/13/11/2/7/2/24/14…）删除**，保留一行计数 + `tests/` 目录自身 | 3,616 | 2,300 | TESTING.md 5,620 B 已镜像硬约束；测试清单与 `tests/unit/` 实际目录一一对应且必漂移 |
| 部署 | 642 | 原地压缩 | `docs/release-checklist.md`（已存在，E10）；`.github/workflows/deploy.yml` | 402 | 240 | release-checklist 覆盖全流程 |
| 注意事项 | 432 | 原地压缩（规则保留） | —（路由数据规则是「先渲染后加载」的姊妹规则，须留） | 100 | 332 | 唯一出处；与即时导航硬约束互补 |
| 任务完成前自检 | 1,766 | **保留原文**（规范） | — | 150 | 1,616 | 检查项即路由闭环的自检锚点 |
| Notes | 1,051 | 原地压缩 | —（**CDN 代理 / 禁硬编码 Pixiv URL / Conventional Commits / pixivizer 命名 属规范须留**；router/main.tsx 叙述删除，与项目概览重复） | 451 | 600 | 首跳启动叙述与 `openwiki/architecture/overview.md` §Boot Sequence 重叠 |
| OpenWiki（`<!-- OPENWIKI:START -->` 块） | 478 | **保留**（CI 维护） | `openwiki` 工具维护（E7），手裁会被 CI 回填 | 0 | 478 | — |
| OpenWiki 维护规则 | 1,276 | **保留原文**（规范） | — | 100 | 1,176 | 维护规则的规则，唯一出处 |
| CodeGraph（`<!-- CODEGRAPH_START -->` 块） | 936 | **保留**（疑似工具维护，先确认归属再议） | 与 OPENWIKI 块同构，疑 `codegraph init` 维护 | 0 | 936 | — |
| Agent skills | 484 | 保留（已极简） | 指针已指向 `docs/agents/*.md`（均已存在） | 50 | 434 | 三节均为 1-2 行指针 |
| **合计** | **60,584** | | | **≈33,401** | **≈27,183** | |

## 2. 总量测算

```
起点        60,584 B  (59.2 KiB)
预估节省   −33,401 B
────────────────────────────
预估结果    27,183 B  ≈ 26.5 KiB
目标线      28,672 B  (28 KiB)  ✅ 低于目标 ≈1,489 B（≈5.8% 余量）
32 KiB 线   32,768 B            ✅ 低于 32 KiB ≈5,585 B
```

敏感性（关键 section 压缩不到位时的兜底）：

| 情景 | 结果估算 | 是否仍 ≤28 KiB |
|---|---:|---|
| 基准（上表） | 27,183 | ✅ |
| 「关键设计决策」只压到 50%（+1,750） | 28,933 | ❌ 超 261 B → 兜底：测试硬约束改为纯指针（再 −800）或命令表砍到 8 行（再 −300） |
| 「架构」保留 15 行总览而非 8 行（+400） | 27,583 | ✅ |
| 双标记块确认可裁（−1,414） | 25,769 | ✅（额外余量） |

结论：**按基准方案可稳定落在 ~26.5 KiB（≤28 KiB）**；即使「关键设计决策」压缩不足，也有明确的二级兜底（测试硬约束指针化 / 命令表再砍）可回到 28 KiB 以内。剩余风险不在「砍不动」，而在「砍错」——见 §4。

## 3. 规范性内容保留清单

以下内容为**默认逐字保留**（#598 处置启发式），仅允许压缩重复措辞，不得语义漂移：

**逐字保留（表格/清单/数值即规范本体）：**

1. **工具触发协议** —— 任务路由表、「允许的降级」7 条清单、「持续反馈闭环」4 条（闭环条目保留，与自检章节重复措辞可合并）。
2. **代码智能规范** —— 默认原则、工具选择速查表、tool_call 守卫（含逃逸阀）、禁止的默认行为 4 条、`codegraph init` 归属句。E3 证实 openwiki 相关叙述滞后，本节是准绳。
3. **文档查询规范** —— Context7 → MDN → web_fetch 优先级链 + 4 条禁止。
4. **OpenWiki 查询规范** —— 主题分流表 + 协作规则 3 条 + 禁止 1 条。
5. **即时导航硬约束**（在「关键设计决策」章节内）—— 4 条硬约束逐字；迁移/压缩本章节时**必须整体搬出或原位保留**，不得随描述性内容一起指针化。
6. **工作流强制规范**（在「关键设计决策」章节内）—— 四阶段流水线、强制闭环 ASCII 图、3 条例外、自我监督规则，逐字。
7. **Fluent Design 规范** —— 设计令牌规则、4 曲线表、5 时长表、交互状态 3 态、禁止清单 10 行：数值与清单条目逐字；仅允许合并表内重复措辞（估 −200 B）。
8. **测试硬约束 6 条** —— 允许压缩为「6 行条目 + 详见 `packages/app/tests/TESTING.md`」形态（该文件已自述与本节一致，E6），但 6 条语义与编号必须可一一对应，不可丢条。
9. **OpenWiki 维护规则** —— 强制约束 4 条 + 更新维护 4 条（含「不本地跑 openwiki:update」「不手改 openwiki/」「CLAUDE.md 勿提交」）。
10. **任务完成前自检** —— 全部检查项（10 条）；允许合并明显同义项，项数可减，覆盖面不可减。
11. **Notes 中混杂的规范句** —— CDN 必须走 `/pixiv-img/` 代理、禁止硬编码 `i.pximg.net`/`app-api.pixiv.net`、Conventional Commits 类型清单、目录名 pixivizer ≠ 项目名 Pictelio。
12. **注意事项** —— 路由数据规则（`createResource` 禁用、路由数据不阻塞渲染）。

**安全压缩区（规范章节的赘肉）：**

- 各规范章节的重复强调语（如每个「禁止的默认行为」条目内重复的引导句）——统一为标题后缀「（违反视为架构违规）」一次声明。
- 「工具触发协议·持续反馈闭环」与「任务完成前自检」的重叠措辞。
- 「测试」章节的文件枚举（→ 一行计数 + 目录指针）。
- 「Notes」中 router/main.tsx 启动叙述（→ 项目概览/ openwiki Boot Sequence 已覆盖）。

## 4. 风险与 Flags

**R1｜CI 维护块归属（高优先级确认项）。** `<!-- OPENWIKI:START/END -->`（478 B）由 openwiki 工具维护（E7），`<!-- CODEGRAPH_START/END -->`（936 B）疑为 `codegraph` 工具产物。合计 1,414 B 不在人工裁剪射程内——若强行删除会被 CI/工具回填。**行动：瘦身 PR 前先确认两块的维护者**（openwiki 配置 + codegraph 文档）；若确认可裁，总量再降 1.4 KiB（→ ~25.8 KiB）。

**R2｜openwiki 非权威，单一指针不安全。** E2（12-cell vs 源码 13 路径 vs AGENTS.md 15 格）、E3（.mcp.json 已删但 quickstart 仍引用）证明 openwiki 会滞后/出错。凡迁移指针，一律采用「openwiki 页面 + ADR/spec 锚」双指针形态；引擎矩阵这类精确语义应以 `docs/adr/ADR-0164` + 源码为准绳，且**迁移顺手修正 AGENTS.md 自己的陈腐**（「15 格」→ 删去格数或改为「spec §4 决策矩阵」）。

**R3｜描述性章节内藏规范。** 三处规范句藏在将被大砍的章节里，裁剪时易误删：
- 「关键设计决策」内的**即时导航硬约束** + **工作流强制规范**（本节最大迁移风险源）；
- 「Notes」内的 **CDN 代理禁令 / 禁硬编码 Pixiv URL**；
- 「约定」Android 子条款内的 **registerPlugin 必须在 super.onCreate() 之前**（与「关键设计决策·Android 原生增强」重复，两处只留一处并保留为硬约束语气）。

**R4｜路由退化风险。** 工具触发协议 / OpenWiki 查询规范 / 代码智能规范三张表是 agent 的「首跳路由层」。若瘦身时把表格压成纯文字指针（「按主题查 openwiki」），每次任务的首跳判断成本上升、且失去「允许的降级」白名单。**这三表保持表格式，不做指针化。**

**R5｜无现成 home 的内容。** ① Fluent 规范 3.8 KiB（E9，docs/style-guides/ 只有 ui-copy.md）；② 代码智能规范的 pi 扩展细节（`~/.pi/agent/extensions/pi-codegraph.ts` 在仓库外）；③ 工作流强制规范引用的 `/grill-me`、`/tdd`、fleet/parallel_tasks 等（用户级 skill，仓库内只有 code-review skill）。三者只能留 AGENTS.md；若未来 Fluent 规范迁 `docs/style-guides/fluent.md`，须保留 AGENTS.md 内禁令表（agent 不会稳定地先读 style-guide）。

**R6｜双写漂移。** 「测试硬约束」AGENTS.md ↔ `packages/app/tests/TESTING.md` 已是镜像关系（E6）。压缩为指针后，TESTING.md 成为唯一详版，其「与 AGENTS.md 一致」的表述需同步改为「AGENTS.md 为摘要」；否则下一轮换届又会长回双详版。

**R7｜陈腐是 inventory 的固有属性，不是裁剪的失败理由（反向 flag）。** E1/E2 说明保留 inventory 只会让 AGENTS.md 持续说谎；裁剪后应把「防陈腐」寄托在生成机制上（openwiki 每日 CI 重生成），并在「OpenWiki 维护规则」中补一条「AGENTS.md 不得含逐文件清单」防止回潮。

## 5. 建议执行顺序（给 #597 的落地 PR 用）

1. 先确认 R1 两标记块归属 → 决定 1.4 KiB 是否入裁。
2. 删除「架构」tree + 「Monorepo 结构」tree（≈ −15.3 KiB，单此一步即破 32 KiB 线）。
3. 压缩「命令」「测试」「约定」「关键设计决策」（按 §1 表，−14.1 KiB 的剩余部分）。
4. 收尾「项目概览 / Notes / 部署」+ 规范章节去重措辞。
5. 校验清单：§3 十二项规范性内容逐项打勾；`grep -n "15 格\|ADR-0096"` 确认陈腐清零；`wc -c AGENTS.md` ≤ 28,672。

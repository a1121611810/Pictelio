# CodeGraph vs OpenWiki — 区别与当前项目选型研究报告

> **调研对象**: 本仓库（pixivizer / Pictelio）内两个代码理解工具：CodeGraph（代码知识图谱）与 OpenWiki（AI 生成文档 wiki）
> **调研日期**: 2026-08-11
> **来源**: 仓库内 primary sources —— `openwiki/` 目录、`.codegraph/` 索引状态、根目录 `AGENTS.md`（OpenWiki 查询规范 / 代码智能规范章节）、`docs/research/` 既有研究笔记

---

## 结论（TL;DR）

**两者不是替代关系，而是互补关系，当前项目两者都已配置且健康，不存在"二选一"。**

选型取决于**问题类型**：

| 问题类型 | 首选 | 为什么 |
|----------|------|--------|
| 架构概览、领域概念、集成方式、测试指南（"为什么这样做"） | **OpenWiki** | 人工/AI 整理的高层次文档，含设计意图 |
| 符号定位、调用链追踪、影响分析（"代码在哪、怎么调用"） | **CodeGraph** | 精确到符号级的代码知识图谱，实时反映代码 |
| 理解一个功能 | **先 OpenWiki 后 CodeGraph** | 先看设计意图，再追代码细节 |

---

## 一、两者本质区别

### 1.1 CodeGraph — 本地预索引的代码知识图谱

- **本质**: 对源码做静态分析建立的图数据库（`.codegraph/codegraph.db`，当前 42.18 MB，SQLite WAL 后端）
- **粒度**: 符号级（function / method / class / interface / component / route / import…）
- **查询方式**: MCP 工具（`codegraph_explore` / `codegraph_search` / `codegraph_trace` / `codegraph_impact` / `codegraph_node` / `codegraph_status`）或 shell CLI（`codegraph explore "..."`）
- **更新机制**: 索引随代码变更重建/增量更新，**永远反映当前代码事实**
- **覆盖**: 全代码库自动索引，无需人工维护

### 1.2 OpenWiki — AI 生成的高层次项目文档

- **本质**: 从源码由 AI（deepseek-v4-pro）定期生成的 Markdown wiki（`openwiki/` 目录，约 240 KB）
- **粒度**: 文档级（架构 / API 层 / 图片流水线 / Feed / 小说阅读器 / Android 集成 / 测试策略）
- **查询方式**: `read_file` 读取 Markdown 页面（`openwiki/quickstart.md` 为入口）
- **更新机制**: GitHub Actions 定时任务（`.github/workflows/openwiki-update.yml`）每日自动执行 `openwiki --update` 生成 PR；**禁止手改生成文件**
- **覆盖**: 仅 8 个页面，覆盖**设计意图、整体流程、领域概念**等 CodeGraph 无法表达的信息

---

## 二、当前项目实际状态（2026-08-11 实测）

| 维度 | CodeGraph | OpenWiki |
|------|-----------|----------|
| 就绪状态 | ✅ 索引健康（`codegraph status` 正常，daemon 运行中） | ✅ 文档齐全，`.last-update.json` 显示 2026-08-06 完成更新 |
| 规模 | 488 文件 / 5,675 节点 / 15,216 边 | 8 个页面 + quickstart |
| 覆盖范围 | 全部 488 个源文件 | 仅架构/领域/集成/测试四大主题 |
| 实时性 | 与代码同步 | 每日快照（可能滞后于最新代码） |

**CodeGraph 索引统计**（`codegraph status` 输出）：
- 节点类型分布：import 1,887 / function 1,384 / constant 883 / method 347 / interface 270 / component 24 / route 12 等
- 后端：node:sqlite，WAL journal，daemon 常驻

**OpenWiki 页面清单**：
- `quickstart.md` — 入口、Quick Facts、文档地图
- `architecture/` — overview.md（整体架构）、api-layer.md（API 层与 OAuth）、image-pipeline.md（图片流水线）
- `domain/` — feed-and-browsing.md（Feed 与浏览）、novel-reader.md（小说阅读器）
- `integrations/` — android-native.md（Android 原生集成与构建）
- `testing/` — overview.md（测试策略）

---

## 三、能力对比

| 能力 | CodeGraph | OpenWiki |
|------|-----------|----------|
| 定位符号定义（函数/类/组件） | ✅ 精确到行 | ❌ 只到页面级 |
| 追踪 A→B 调用链（含动态分发） | ✅ `codegraph_trace` | ❌ |
| 修改前的**影响分析** | ✅ `codegraph_impact` | ❌ |
| 理解架构设计意图（"为什么"） | ❌ 只有结构没有意图 | ✅ 核心价值 |
| 领域概念解释（Feed/R18 过滤/双引擎） | ❌ | ✅ |
| 集成方式、测试指南 | ❌ | ✅ |
| 一次调用获取多个相关符号源码 | ✅ `codegraph_explore` | ❌ |
| 最新代码实时反映 | ✅ | ⚠️ 每日快照，可能滞后 |

### 各自局限

- **CodeGraph 局限**: 只回答"结构是什么"，不回答"设计意图是什么"；对跨文件业务语义（如 OAuth 为什么这么设计）无能为力。
- **OpenWiki 局限**: 是快照（最近一次更新 2026-08-06，git head `6b2d0d4`），之后的新代码不会立即出现；页面粒度粗，无法定位具体符号行号；AI 生成可能偶尔与实现有偏差（所以 AGENTS.md 要求深入代码前用它做"高层次理解"，而非当作代码事实）。

---

## 四、项目明文规定的协作规则（AGENTS.md）

仓库根 `AGENTS.md` 已把两者定位为**分层互补**：

> - **架构概览 / 领域概念 / 集成 / 测试指南** → 先读 OpenWiki 获取高层次理解
> - **具体符号定义 / 调用链 / 影响分析** → 使用 CodeGraph 精确追踪
> - **理解一个功能时** → 先用 OpenWiki 了解"为什么这样做"，再用 CodeGraph 了解"代码在哪、怎么调用"

其中 OpenWiki 优先被标记为**硬约束**（"违规示例：直接读 `src/api/client.ts` 而不先读 `openwiki/architecture/api-layer.md`"），CodeGraph 被标记为默认代码理解工具（"不是搜索失败后的兜底工具"）。

---

## 五、决策速查

接到任务时按以下顺序判断：

1. **问题涉及架构/领域概念/集成/测试**（如"图片缓存有几层"、"引擎切换怎么工作"）→ 第一步 `read_file` 对应 `openwiki/` 页面
2. **问题涉及具体代码**（如"`request()` 在哪里被调用"、"改 `settingsStore` 会影响谁"）→ 直接 `codegraph_explore` / `codegraph_trace` / `codegraph_impact`
3. **两者都涉及**（功能开发、修 bug 需要先懂背景再动手）→ 先 OpenWiki 再 CodeGraph

**例外**: 已知路径的直接读取（如"读一下 `src/api/client.ts` 第 50 行"）、纯文件搜索、CodeGraph 索引不可用等场景可降级为普通 Read/Grep/Glob（见全局 memory `mcp-codegraph-usage.md`）。

---

## 来源

- `openwiki/quickstart.md`（入口、页面地图、Quick Facts）
- `openwiki/.last-update.json`（生成时间 2026-08-06、模型 deepseek-v4-pro）
- `codegraph status` 输出（索引规模、节点分布、daemon 状态）
- 根目录 `AGENTS.md`（代码智能规范 / OpenWiki 查询规范 / OpenWiki 维护规则章节）
- 全局 memory：`mcp-codegraph-usage.md`、`openwiki-first-hard-constraint`、`mcp-doc-query.md`

# vue-lynx 深度评估（升级版）：演进、源码、测试、生产决策

> 评估日期：2026-07-31（仓库 pushed_at 2026-07-31，连续活跃）
> 前置阅读：`docs/research/vue-lynx-deep-dive.md`（架构层分析）、`docs/research/lynx-pure-engine-analysis.md`（框架选择全景）
> 本报告新增：演进历史与路线图、源码实现质量、与 ReactLynx 耦合点、已知缺口量化、成熟度评分、PoC 建议
> 结论速览：**vue-lynx 是"认真、有远见的工程，不是玩具 demo"——1013 个 Vue 官方上游测试 0 fail、双线程 ops 管线/IFR/list 全部落地。但综合成熟度约 5.5–6/10：Pre-Alpha、bus factor=1、npm 1.0.0 被抢注、list 回收与 scoped CSS 扩展两个 Pictelio 最关心的领域仍是缺口。结论：值得立即 PoC，但生产排期需按 3–6 个月技术债缓冲。**

---

## 1. 演进历史与路线图（plans/ 目录——被低估的工程纪律）

### 1.1 起源：先分析 Vue Vine，后推翻重来

- 起步不是从零：先分析 **Vue Vine**（vuejs 生态宏式 SFC）在 Lynx 上的实验分支（`vue-vine/exp/vue-vine-lynx`，18 commits），**后推翻其核心架构**（原设计把整个 Vue runtime 放 Main Thread）。
- 改为贴近 ReactLynx 的架构：**Vue core 跑 Background Thread，Main Thread 只执行 PAPI ops**（[0303-3-dual-thread-mvp.md](https://github.com/Huxpro/vue-lynx/blob/main/plans/0303-3-dual-thread-mvp.md) 原话 "It puts the entire Vue runtime... on the Main Thread... This plan implements a more reasonable architecture: Vue core runs on the BG Thread, Main Thread only executes PAPI operations"）。

### 1.2 独立仓库决策：有明确迁移路径（但未兑现）

2026-03-12 用 `git filter-repo` 从官方 `lynx-stack` 的 `packages/vue/`（33 commits）拆出（[0310-1](https://github.com/Huxpro/vue-lynx/blob/main/plans/0310-1-independent-repo-strategy.md)），理由是"自包含、独立发布节奏/CI/贡献面"。**迁移路径表：Stay independent / `@lynx-js/vue` / `@vue/lynx`——至今未兑现**（lynx-family 组织下搜不到任何 vue 仓库）。

### 1.3 版本演进节奏（npm 时间线，一周一版）

| 版本 | 日期 | 关键内容 |
|------|------|---------|
| 0.1.0-pre-alpha.0 | 3/17 | 起步 |
| 0.1.0 | 3/26 | 首个正式 pre-alpha |
| 0.2.0 / 0.3.1 | 4/4 ~ 4/6 | 双线程管线打磨 |
| **0.4.0** | 5/10 | `<style scoped>`、Teleport、KeepAlive、withModifiers、Volar |
| **0.5.0/0.5.1** | 7/17 | **IFR（首帧）+ element templates** |

### 1.4 路线图状态（计划文档约 30 份，均有 Post-Implementation Notes）

- **已完成 ✅**：双线程 MVP、scoped CSS、Teleport、KeepAlive、Transition、list 原生元素、IFR（[0711-1](https://github.com/Huxpro/vue-lynx/blob/main/plans/0711-1-ifr-instant-first-frame.md)）、element templates（[0711-2](https://github.com/Huxpro/vue-lynx/blob/main/plans/0711-2-element-templates.md)）
- **IFR 是真实性能工程**：自建确定性 replay 协议，`ifr-bench/REPORT.md` 量化：静态为主首屏 **7–15× 加速**、协议从 77.6KB 缩到 69 字节
- **规划中**：SSR/预渲染、list cell 回收（#302）、scoped CSS `:deep/:slotted/:global`（#164/#165）、element slots（#296）、Vapor 模板代码化（#337/#338）

---

## 2. 源码实现深度（"认真工程"的证据）

### 2.1 不是玩具 demo

| 证据 | 内容 |
|------|------|
| `shadow-element.ts` | 双向链表树（id=1 预留 page root），每节点字段有解释（`_vShowHidden`、`_transitionClasses`、`_tplHoles`），记录真实踩坑 |
| `node-ops.ts` | 事件分类（onXxx/bind/catch/global-bind/main-thread-*）、`.stop`→`catchEvent`、`setScopeId` 保留首次关联（引用 #317 回归教训） |
| `flush.ts` | ack 追踪 + `ACK_FALLBACK_MS = 50` 降级计时器 + `engineAckObserved` 锁存——`nextTick` 保证"ops 已在 MT 应用" |
| 全局态 | event-registry/ops buffer 放 `globalThis` 解决多模块实例问题 |

结构上与 ReactLynx 的 `BackgroundSnapshotInstance` / `ListUpdateInfoRecording` **一一对应**——是"移植官方架构"而非"从零发明"。

### 2.2 测试体系：三层，1013 个 Vue 官方上游用例 0 fail

- **Layer 1 — `upstream-tests`**：跑 **vuejs/core v3.5.12 官方测试套件**（git submodule），验证 renderer 满足 Vue renderer contract（每个 RendererOptions 方法、完整 keyed/unkeyed diff 含 LIS 优化）。数据：**1013 用例 / 882 pass / 131 skip / 0 fail**。skip 分类：Vue 私有符号（77）、平台差异（20，SVG/Web Components/Symbol）、Teleport DOM 专项（12）、vModel 表单差异（22）。
- **Layer 2 — `testing-library`**：自研双线程 E2E 管线测试（128 用例，22 个文件：ifr/keep-alive/list-diff/ops-coverage/scoped-css/teleport/transition-leak-repro/v-model）。
- **Layer 3 — `ifr-bench`**：IFR 正确性 21/21。
- 命令：`pnpm test`（testing-library）、`pnpm test:upstream`（Vue 上游）。

---

## 3. 与 ReactLynx 的关系与风险（耦合点很窄）

### 3.1 唯一运行时耦合：worklet-runtime

vue-lynx 对 `@lynx-js/react` 的**唯一运行时依赖是 `worklet-runtime` 入口**（MT 端执行 worklet 的 Lepus 运行时），其余是官方 webpack/模板插件。真正渲染内核是 `@vue/runtime-core ^3.5.0`。

### 3.2 兼容风险：中等

- 依赖声明 `^0.116.5`（0.x caret 只允许 0.116.x）→ **vue-lynx 不会自动跟随 ReactLynx 升级**；
- Lynx 工具链（rspeedy + 引擎）升级时可能脱离 vue-lynx 验证过的组合；
- 官方 ecosystem-ci 防回归机制**未实施**（0310-1 计划中 Status 未勾选）。

### 3.3 官方认可度：明确"半官方"

- lynxjs.org 首页：**"Framework Agnostic... ReactLynx is the official flavor, while Vue and Miso for Haskell come from the community"**，链接指向 `vue.lynxjs.org`（**官方子域名托管文档**）；
- 但代码仍在 Huxpro 个人仓库，未进 lynx-family org。

### 3.4 作者：bus factor = 1

Huxpro（黄玄）：lynx-family 核心成员、前 React 团队、字节跳动背景；**唯一维护者**，代码大量由 AI agent（Claude/Cursor）代写、Huxpro 亲自 commit。

---

## 4. 已知缺口量化（对 Pictelio 最关键的四项）

| # | 缺口 | 影响 | 证据 |
|---|------|------|------|
| 1 | **list cell 回收是 no-op（#302）** | **超长 Feed 内存单调增长**——`enqueueComponent` 未实现，离屏 cell 元素树永不回收（vs ReactLynx 有 `gRecycleMap` 回收池）。**Pictelio 的瀑布流/长列表是最重场景** | [issue #302](https://github.com/Huxpro/vue-lynx/issues/302) |
| 2 | **`__UpdateListCallbacks` 未刷新（#303）** | 每次 flush 不刷新回调，destroy/remount/nested 列表场景有隐患 | [issue #303](https://github.com/Huxpro/vue-lynx/issues/303) |
| 3 | **scoped CSS `:deep()/:slotted()/:global()` 不支持（#164/#165）** | **组件库/主题定制受限**——Pictelio 的 Fluent 设计系统大概率需要 | [issue #165](https://github.com/Huxpro/vue-lynx/issues/165)、[#164](https://github.com/Huxpro/vue-lynx/issues/164) |
| 4 | **文本测量只有异步**（`NodesRef.fields()` → `lynx.createSelectorQuery()`） | **同步测量不可用**（Lynx 平台限制）——小说正文逐行测量需 workaround | [shadow-element.ts](https://github.com/Huxpro/vue-lynx/blob/main/packages/vue-lynx/runtime/src/shadow-element.ts) |

**额外警示**：
- **npm 包名 `vue-lynx@1.0.0` 已被无关作者抢注**（2025-03-10，pranshuchittora，89 字节占位包）——**vue-lynx 自己永远发不了 1.0.0**（除非 npm support 干预）；
- `autoPixelUnit`（数字→px 自动转换）标记下个 major 默认关闭——**Pictelio 应显式写字符串单位**；
- 无成熟第三方组件库（仅有 vant-lynx 示例与 `@vue-lynx/motion-mini` 类散件）。

---

## 5. 成熟度评分（1–10）

| 维度 | 分 | 依据 |
|------|-----|------|
| 架构完成度 | **7.5** | 双线程 ops 管线、sign 事件、worklet、list、IFR、element templates 全部落地可验证；list 回收/SSR/scoped 扩展规划中 |
| 测试 | **8** | 1013 官方上游用例 0 fail + 128 自研双线程 E2E + ifr-bench 21/21；弱点是真机/CI 覆盖依赖人工 |
| 工具链 | **6.5** | rspeedy 插件、Volar 类型/诊断、create-vue-lynx 脚手架齐全；无稳定 1.x、HMR 生态弱、AI 生成代码长期可维护性存疑 |
| 生态 | **3** | 官方仅认可为 community flavor；无成熟第三方组件库；516 stars |
| 生产风险 | **4** | Pre-Alpha、"Expect bugs and enjoy!"、bus factor=1、依赖快速演进的 @lynx-js 包、npm 1.0.0 被占位、功能缺口集中在列表/样式定制 |

**综合：约 5.5–6/10**——技术上认真、有远见，但处于 Pre-Alpha，生产排期需按 3–6 个月技术债缓冲。

---

## 6. 对 Pictelio 的下一步建议

### 6.1 需要 PoC，且立即做（迭代太快，现在验证成本最低）

PoC 回答三个问题：
1. **`<list>` 大数据量内存曲线**——验证 #302 实际影响：滚动到 5k/50k 条是否可用（Pictelio 瀑布流是重灾区）；
2. **scoped CSS + 设计令牌**能否覆盖 Fluent 系统——验证 `enableCSSSelector`/`enableCSSInheritance`/`enableCSSInlineVariables`/`useCssVars` 组合；
3. **真实渲染链路**——原生 + Lynx for Web 双端跑 gallery 类瀑布流，IFR/`enableElementTemplates` 开与关三种配置，验证 7–15× 声明与行为一致性。

### 6.2 明确前提

- Lynx **没有 SolidJS renderer**，官方 flavor 只有 React。vue-lynx 是 **Vue 运行时**封装 → "换渲染层"的实际含义是**迁移到 Vue 生态**（用 vue-lynx）或**自研 SolidJS renderer**（可参考 vue-lynx 的双线程 ops + ShadowElement 架构做模板）。
- PoC 应同时验证 Vue 开发体验是否可接受。

### 6.3 版本锁定策略

- lock `vue-lynx@0.5.x` + `@lynx-js/*@0.116.x` 组合；把 `@lynx-js/react` 升级作为受控事件（vue-lynx 不自动跟随）；
- 订阅仓库 releases 与 `plans/`（0711 后 PR #352 已开始研究 ReactLynx `renderToOpcodes` 与下一轮性能路线）。

### 6.4 规避项

- 先别依赖 `:deep/:slotted/:global` 与超长列表回收；
- 文本测量走异步 `NodesRef.fields()`；
- 避免 `autoPixelUnit`（显式字符串单位）；
- 评估 bus factor=1 风险——把关键结论固化为自己的文档，不依赖项目内 AGENTS.md/计划文档长期存在。

---

## 附录 A：评估信息来源（一手索引，全部可核验）

- `github.com/Huxpro/vue-lynx`：`plans/0303-1|0303-3|0310-1|0418|0711-1|0711-2`、`packages/vue-lynx/CHANGELOG.md`、`packages/vue-lynx/runtime/src/*`、`packages/vue-lynx/main-thread/src/*`、`packages/vue-lynx/plugin/src/{index,entry}.ts`、`packages/upstream-tests/README.md`、`packages/ifr-bench/REPORT.md`、issues #78/#151/#153/#155/#161/#164/#165/#216/#257/#296/#302/#303/#337/#338
- `lynxjs.org`：Framework Agnostic 声明（Vue 列 community flavor）
- `registry.npmjs.org/vue-lynx`：版本时间线 + 1.0.0 抢注事实
- `api.github.com/users/Huxpro`：作者身份
- 交叉参考：`docs/research/vue-lynx-deep-dive.md`、`docs/research/lynx-pure-engine-analysis.md`

## 附录 B：关键引用（源码/文档摘录）

- "Vue core runs on the BG Thread, Main Thread only executes PAPI operations"（0303-3 双线程架构决策）
- "Separating it from lynx-stack would give the Vue Lynx effort its own release cadence, CI pipeline, and contributor surface"（0310-1 独立仓库理由）
- "Total: 1013 tests across 51 suites — 882 pass, 131 skip, 0 fail"（upstream-tests README）
- "framework-side cell recycling (enqueueComponent / recycle pool)... enqueueComponent is still a no-op. Very long / infinite feeds keep every created list-item element tree alive → higher memory than ReactLynx"（issue #302）
- "ReactLynx is the official flavor, while Vue and Miso for Haskell come from the community"（lynxjs.org 首页）
- npm `vue-lynx@1.0.0`（2025-03-10，maintainer pranshuchittora，unpackedSize 89）—— 版本被抢注

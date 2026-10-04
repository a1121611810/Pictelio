# Pictelio

Lynx 单引擎的 Pixiv 第三方客户端（vue-lynx + Material Design 3），经 Gradle 构建链直接产出 Android 原生应用。WebView 客户端的运行时随 #610 下线，其源码与依赖随 ADR-0203 删除，仓库中不再保留（术语见 `docs/adr/glossary-webview-client-removal.md`）。

## 项目概览

- **技术栈**: vue-lynx + Vue 3.5 + TypeScript 7.0 (strict) + rspeedy/rspeedy-plugin-livereload + Tailwind CSS 3.4；宿主侧 Java 21 / AGP 9.2.1 / Lynx SDK 4.0.1
- **Monorepo**: pnpm workspace：`pictelio-app-lynx`（唯一客户端）/ `@pictelio/android-host`（构建宿主）/ `@pictelio/{ugoira,update-check,novel-export,search-core,ranking-core,net-diagnostics}`（共享纯逻辑）/ `pictelio-website`
- **入口**: `packages/app-lynx/src/index.ts` → `App.vue` → `src/router.ts`（vue-router）
- **设计系统**: `pictelio-app-lynx` 使用 Material Design 3（见「约定」app-lynx 样式）。**Fluent Design 2 章节为历史存档**：它服务的是已删除的 WebView 客户端
- **Pixiv API**: `packages/app-lynx/src/api/` 经原生模块 `PictelioApiModule` 走 `PixivApiCore`，401 自动刷新 + 防死循环

## 工具触发协议（任务开始第一步，违反视为架构违规）

**任何任务开始后，第一步必须先完成工具路由判断，再动手读代码/搜索。**

| 任务涉及 | 第一步必须 | 依据 |
|----------|-----------|------|
| 架构概览 / 领域概念 / 集成方式 / 测试指南（"为什么这样设计"） | `openwiki_search` 取 section → `openwiki_read` 读该节（工具不可用时直接读 `openwiki/` 对应页面） | 「OpenWiki 查询规范」决策链 |
| 具体符号 / 调用链 / 影响分析（"代码在哪、怎么调用"） | 调用 CodeGraph（pi 原生工具 `codegraph_explore` 或 bash `codegraph` CLI） | 「代码智能规范」速查表 |
| 第三方库/框架文档 | Context7（`mcp__context7__*`） | 「文档查询规范」决策链 |
| 浏览器标准 API | MDN（`mcp__mdn__*`） | 「文档查询规范」决策链 |
| 理解一个功能（why + where 都涉及） | **先 OpenWiki 后 CodeGraph** | 「OpenWiki 查询规范」协作规则 |

### 允许的降级（仅限以下场景，未命中则必须触发）

CodeGraph/OpenWiki 不可用（`.codegraph/` 未生成、返回空结果）· 已知路径的完整文件读取 ·
非代码文本搜索（日志/配置/依赖版本/文档）· 简单文件列举 · 小范围精准定位（已知符号名 + 单文件）·
中文语义搜索失败（降级找入口再切回）· 环境缺少上述 MCP 工具时改用能力等价的可用工具
（grep/read、web 搜索）——**不视为违规**。

### 持续反馈闭环（边用边发现问题）

- **自检证据化**：任务完成前记录"路由判断 + 所用工具"（见「任务完成前自检」）。
- **当场沉淀**：发现偏差（该用没用 / 用错工具 / 顺序反了），当场记一条 feedback memory（含场景 + 正确做法），下轮会话自动召回。
- **用户反馈兜底**：发现模型没用对时随时告知，由 agent 沉淀成 memory 或修订本文档。
- **定期回顾**：每次改动本文档相关章节时，回顾已沉淀的失败案例，把高频失败固化为规则。

## 代码智能规范（Code Intelligence）

本项目使用 CodeGraph 作为默认代码理解工具（本地索引，`.codegraph/` 目录）。接入方式（无 MCP，直连 CLI）：

**pi agent** 由全局扩展 `~/.pi/agent/extensions/pi-codegraph.ts` 注册原生工具 `codegraph_explore`；
**其他 agent** 直接用 bash 调 `codegraph` CLI（输出逐字等价）。

### 默认原则

- **任何涉及"理解代码结构、定位符号、追踪调用链、分析影响范围"的任务，默认优先使用 CodeGraph。**
- CodeGraph 是默认工具，不是搜索失败后的兜底工具。
- 仅当 CodeGraph 不可用、或场景明确属于「工具触发协议」中的「允许的降级」时，才使用 Grep/Read 等替代手段。

### 工具选择速查

| 场景 | 首选 | 说明 |
|------|------|------|
| 理解代码 / 定位符号 / 调用链 / 影响面（绝大多数问题） | `codegraph_explore` 工具或 bash `codegraph explore "<符号名...>"` | 一次返回符号源码（视同已 Read）+ 调用路径 + blast radius（含关联测试）。query 写精确符号名，空格分隔多个 |
| 按名快速定位符号（只要位置不要源码） | bash `codegraph query <name>` | 比 explore 便宜 |
| 重构前影响分析 | explore 的 blast radius 已内联；需独立报告用 bash `codegraph impact <symbol>` | |
| 变更文件 → 受影响测试 | bash `git diff --name-only \| codegraph affected --stdin` | code-review / CI 场景 |
| 索引健康检查 | bash `codegraph status --json` | 节点/边计数；边数归零 = 索引腐化，人工 `codegraph index --force` |

### tool_call 守卫（pi 扩展行为）

用 grep 做"标识符形态 pattern + 全项目/代码目录"的搜索会被 block 并引导到 `codegraph_explore`。
放行场景：非代码文本（配置/文档/日志）、单文件内搜索、path 在索引根之外、正则/中文 pattern。
逃逸阀：确认覆盖不了时**原样重试同一调用即放行**（禁止换 bash 绕过——bash 搜索本就被拦截）。
- bash 中直接调 `codegraph` CLI 不被拦截，计为有效使用。

### 禁止的默认行为

未经 CodeGraph 尝试就用 Grep/Read 大规模探索、手拼调用链、顺序 Read 摸索架构、
对 explore 已返回源码的文件再 Read 复验（输出是逐字节当前源码）。
`.codegraph/` 索引未生成时，在项目根运行 `codegraph init`——**索引是用户决策，agent 不得擅自执行**。

## 文档查询规范（Documentation Query）

文档查询遵循明确的优先级链：Context7 → MDN → `web_fetch`。

### 默认原则

- **第三方库/框架的 API 文档、使用指南、配置说明，默认优先使用 Context7 工具（`mcp__context7__*`）。**
- **浏览器标准 API（HTML/CSS/JS 标准 API、Web API 语法与兼容性）优先使用 MDN 工具（`mcp__mdn__*`）。**
- 仅当 Context7 和 MDN 都不支持目标查询时，才使用 `web_fetch` 搜索官方文档。

### 禁止的默认行为

未经 Context7 尝试就用 `web_fetch` 查库文档；对同一问题重复调 `resolve-library-id` 超 2 次；
单个 `query-docs` 调里塞多个独立概念。

## OpenWiki 查询规范（OpenWiki Query）

OpenWiki 提供人工整理的高层次项目概览，与 CodeGraph（精确代码结构）互补。**路由规则见上方
「工具触发协议」速查表**（架构/领域/集成/测试 → 先 OpenWiki；符号/调用链/影响 → CodeGraph；
理解功能 → 先 OpenWiki 后 CodeGraph），本节只给文件索引。

OpenWiki 页面由 AI 定期从源码生成，内容涵盖设计意图和整体流程，CodeGraph 无法替代。

### 优先级决策链

| 场景 | 首选文档 | 说明 |
|------|---------|------|
| 快速了解项目全貌 | `openwiki/quickstart.md` | 入口点，再根据链接深入具体页面 |
| 架构概览（启动流程、路由、CSS、工具链） | `openwiki/architecture/overview.md` | 了解设计意图和整体结构 |
| API 层设计（OAuth、双模式、401 重试） | `openwiki/architecture/api-layer.md` | 设计决策与数据流 |
| 图片流水线（缓存、代理、CDN） | `openwiki/architecture/image-pipeline.md` | 三层缓存架构 |
| Feed 与浏览（推荐、虚拟滚动、R18 过滤） | `openwiki/domain/feed-and-browsing.md` | 业务逻辑与数据流 |
| 小说阅读器（虚拟布局、搜索、系列导航） | `openwiki/domain/novel-reader.md` | 核心交互流程 |
| Android 原生集成（Lynx 原生模块、构建） | `openwiki/integrations/android-native.md` | 原生桥接与构建配置 |
| 测试策略（单元测试、E2E 测试） | `openwiki/testing/overview.md` | 测试分层与工具链 |

## 命令

项目根目录执行，pnpm workspace 委托。裸名指向见 ADR-0204（取代 ADR-0059 的委托部分）：

| 命令 | 说明 |
| --- | --- |
| `dev` / `build` / `check` / `test` / `preview` | 裸名 → pictelio-app-lynx（唯一客户端） |
| `lint` / `fmt` / `fmt:check` / `outdated` | 仓库级单命令（root vite.config.ts 单配置源；**无** `:包名` 变体） |
| `dev:android-host` / `build:android-host` / `build:android-host:release` | 宿主：装调试包 / 构建 APK（release 需密码环境变量） |
| `test:android-host` / `test:android-host:unit` / `test:android-host:e2e` | 宿主单测 / JVM(Robolectric) / 模拟器 E2E（手动按需） |
| `release:android-host` / `deploy` / `deploy:dry` | 交互式发布 / 落地页预览 |
| `check:all` / `lint:all` / `test:all` / `fmt:all` | 全部包（`:all` = **有界并发**，concurrency-limit 4） |

**宿主包动作一律显式命名**，不占用裸名。CI 门禁 = `check:all` + `lint:all` + `test:all`（见「门禁边界」）。

## Monorepo 结构

monorepo 布局与逐目录职责见 `openwiki/architecture/overview.md` §Monorepo Layout、`openwiki/quickstart.md` §Key Source Files。本文档不维护目录树，结构信息走 openwiki + CodeGraph（防回潮见「OpenWiki 维护规则」）。

## 架构

`packages/app-lynx/src/` 分层（逐文件清单 → `openwiki/architecture/overview.md` §Component Architecture）：

- `api/` — Pixiv API 层（OAuth、作品/小说/搜索/用户/评论；经原生模块出网）
- `stores/` — Pinia 状态（Feed、收藏、设置、主题、更新、翻译等）
- `pages/` / `components/` — 页面与可复用 UI；路由定义在独立的 `src/router.ts`
- `primitives/` — 无 UI 逻辑原语（虚拟滚动、分页、图片构建、翻译器等）
- `composables/` — 组合式逻辑；`utils/` 工具；`services/` 服务

原生侧在 `@pictelio/android-host/android/app/src/`：`lynx/java/` 放 Lynx 原生模块（`LynxActivity`、各 `Pictelio*Module`），`main/java/` 放跨端共享核心（`PixivApiCore`、`SecureStorageCompat`、各编码器）。**「宿主包」不是客户端**——它只负责把客户端产物装进 APK 并发出去。

## 关键设计决策

细节一律**双锚指针**（openwiki + ADR；openwiki 可能滞后，精确语义以 ADR/源码为准绳）：

- **PixivApiPlugin 网关** → `openwiki/architecture/api-layer.md` + ADR-0037
- **图片流水线三层缓存** → `openwiki/architecture/image-pipeline.md` + ADR-0090
- **Android 原生集成**（返回键、`shouldInterceptRequest` 图片代理、Java 原生模块）→ `openwiki/integrations/android-native.md`
- **引擎决策（ADR-0164）**：缺省 Lynx；硬规则 = 预热与路由**必须**共用 `EngineRouting.resolve`，禁止各自读键；10s 加载超时永不自动跳 → 同上页 §Engine Availability Fallback
- **安全存储**（refresh_token 走 Keystore，首启迁移）→ 同上页
- **虚拟滚动与布局**（主 Feed 固定单列 ADR-0075）**/** **年龄限制与内容过滤** → `openwiki/domain/feed-and-browsing.md`
- **更新检查**（GitHub API + `/github-api` 代理）→ `openwiki/architecture/overview.md`

## 即时导航硬约束

**硬约束**（违反视为架构违规）：

1. **先渲染、后加载**：用户主动点击进入任何页面/弹窗/详情时，必须先渲染页面框架（含骨架屏占位），再发起数据请求。不允许任何路由级 loader/middleware 以 `await` 网络请求的方式阻塞页面渲染。
2. **全局最优**：任何方案必须从宏观（全局架构）和微观（单个组件）两个角度验证。禁止只优化局部而损害整体。方案须同时满足高可维护性、高性能、高安全性、低内存占用。
3. **竞态防护**：组件内所有异步数据请求必须使用 generation-gate、AbortController 或等效机制防护，防止请求参数变化后旧响应覆盖新数据。
4. **数据层分流**：跨组件共享数据使用全局缓存/去重层；页面独有数据由组件自身管理生命周期。

## 工作流强制规范

**硬约束**（违反视为架构违规）：所有涉及需求实现的任务必须走四阶段流水线
**禁止跳过环节，禁止在前置阶段直接进入开发实现**：

```
Grill 澄清 → to-spec → to-tickets → implement
```

1. **Grill 澄清**（`/grill-me` 无代码库 / `/grill-with-docs` 有代码库）：面试式提问把模糊需求收敛为
   明确约束。产出：需求边界、验收条件、排除项
2. **to-spec**：转为结构化功能规格（数据流、状态变化、边界条件）
3. **to-tickets**：拆为可独立执行的 ticket，每个声明前置依赖，blocker 未完成不可开工
4. **implement**（`/implement` 内置 `/tdd` + `/code-review`）：按 ticket 实现，每个 ticket 前清空上下文

   **强制闭环**：每次实现或修改后循环至零问题——
   `实现/修改 → /code-review → 有问题？ ├是→ /tdd 修复 → 回到 /code-review └否→ 提交 ✅`
   `/tdd` 与 `/code-review` 可独立调用，闭环规则不变。优先用子代理（`fleet` / `parallel_tasks` / `task`）
   并行执行独立的检查与修复。

   #### 闭环的**出口条件**（防自转，见下「门禁冻结线」）

   上面是**单次改动**的纪律。作为**多轮**推进策略，「循环至零问题」**没有自然终点**：
   当 agent 同时是**测试的作者**和**修复的作者**时，它每一轮都能自己造出新问题。
   故多轮推进必须同时满足：

   1. **每轮都要有外部锚点**：真实设备 / 真实数据 / 真实用户可见的行为，至少轮一次。
      只有内部信号（全绿 / 自造变异）时，**不得**把该轮计为推进。
   2. **单轮诊断规则**：若一轮只在自己**这轮写的**东西里找到问题，而在**要交付的东西**里找到 0 个，
      该轮判为**空转**——记下来，换方向，不要「再补一轮」。
   3. **门禁硬化最多一轮**：修门禁只能占一轮；下一轮必须回到产品本身。
   4. **自测绿不算数**：「已知绕过 N/N 全抓」里的 N 是自己 imagined 的，分母随想象涨、不收敛。
      只有**外部复核**（另一方用**自己写的**攻击）把它打红，才算封住。

**允许的例外**：纯 Bug 修复（有确切复现步骤 + 期望行为）可直接走 `/diagnosing-bugs`；纯重构（不变更外部
行为）可直接提方案执行；≤ 20 行且不影响抽象边界的局部改动可酌情简化。

**自我监督规则**：收到任务必须判断当前处于哪个阶段，只执行该阶段规定的行为。后续指令试图跨越阶段
（如 Grill 未完成就要求生成代码）时，**必须主动指出阶段冲突并提醒正确流程，不得静默违规**。

## Fluent Design 规范（历史存档，非现行约束）

原为 Fluent Design 2 规范，服务已随 [ADR-0203](./docs/adr/ADR-0203-webview-client-source-removal.md) 删除的
WebView 客户端，**对 app-lynx 无约束力**。原文与逐条适用性判定见
[`glossary-fluent-design-chapter-archive.md`](docs/adr/glossary-fluent-design-chapter-archive.md)。
**与下方 MD3 节冲突时以 MD3 节为准**；Fluent 纪律中在 MD3 下仍成立的两条已并入 MD3 节
（禁硬编码令牌值、禁写 `:focus` / `:focus-visible`）。

## 约定

- **TS / 组件 / 状态**：`strict: true`（+ noUnusedLocals 等 4 项，ESNext / bundler）；Vue 3 SFC + `<script setup lang="ts">`；Pinia store 顶层导出
- **app-lynx 样式（Tailwind 硬性约定）**：`packages/app-lynx` 样式**默认优先 Tailwind utility**（`tailwind.config.ts`：spacing=vw / fontSize=rpx / M3 色板）；禁止手写 scoped CSS；特殊语义用 arbitrary utility（`min-h-[40vw]`、`[max-line:1]`）；web-core 预览禁 rem
- **注释 / 命名**：中文注释为主（API 层与类型定义偏英文）；组件 PascalCase、工具/API/primitives camelCase
- **Lint / 格式化**：vite-plus 内置 oxlint / oxfmt，唯一配置源 = 仓库根 `vite.config.ts`（豁免清单见该文件 → ADR-0185）
- **Android**：`SplashScreen.installSplashScreen()` **必须在 `super.onCreate()` 之前**（AndroidX 要求，见 `LynxActivity.java`）；minSdk 与平台要求 → `docs/platform-compatibility.md`
- **发布签名**：keystore 路径与密码环境变量名见 `docs/release-signing.md`；**keystore 禁止提交**
- **Node / pnpm 版本**：以根 `package.json` 的 `devEngines` 为准（ADR-0080）

### app-lynx 的 MD3 约定

本节是 app-lynx **唯一现行**的设计约束。**逐档数值、项目落点、证据坐标**查
[`glossary-md3-alignment.md`](docs/adr/glossary-md3-alignment.md)（引用前先查它）。

- **数值来源（唯一基准）**：MD3 数值以 material-web 生成令牌源文件
  `tokens/versions/v0_192/_md-sys-{shape,motion,state,typescale}.scss` 为准。`m3.material.io` 是 JS 渲染、
  **抓不到正文**，只作图示参考；冲突时**以令牌文件为准，不以记忆或二手转述为准**（→ ADR-0205 决策 1）
- **role 命名法**：颜色用**角色名**（`primary` / `surface-container-*` / `outline` / `on-surface` …）而非颜色名
  —— MD3 与 MD2/Fluent 的根本分野即在此。单一事实源 = `tokens.css` 的 `--md-*`；
  Tailwind `colors` 只放 `var(--md-*)` 引用，**不含字面量**
- **禁硬编码**：颜色/间距/圆角/阴影/字号一律走令牌。窄例外仅 `src/errorPrototype/ErrorPagePreview.vue`
  ——**不在 `router.ts` 中**、仅 dev web entry 引用的原型页，px 硬编码是**有意保留**；
  「禁硬编码」条款**不覆盖该文件**，已登记白名单，**它不是范例**
- **单位换算**：375 设计稿下 `1sp = 2rpx`、`1dp = 0.2667vw`（权威见 `glossary-lynx-units.md`）。
  间距/字号/圆角随屏宽缩放是**刻意取舍**、比例关系不变，**不是缺陷**（→ ADR-0207 决策 3）
- **形状消费**：圆角档位已在 `borderRadius` 注册并**全部指向 `--md-shape-*` 令牌**（`xs`→extra-small …
  `xl`→extra-large、`full`），新代码用档位名；存量 `rounded-[var(--md-shape-*)]` 是**只读写法**，不必迁移。
  ⚠️ 裸方向类 `rounded-t` 取 `DEFAULT`（medium 12dp，**非** extra-small）
- **字号档位**：优先语义档位（`text-body-medium` …）不用旧别名（旧别名有**有意塌陷**：`base/lg/xl` 同值）。
  15 档语义档位已在 `fontSize` 落地**四元组**（size + line-height + tracking），weight 由 `fontWeight`
  档位承载（`regular`/`medium`）——**行高已由档位决定，正文不要再手写 `leading-*`**（ADR-0206 决策 1/3）
- **存量兼容层**：`--color*`（22 条）/ `--borderRadius*` / `--elevation2|4` 与旧字号别名只读，
  值全指向同一批 M3 令牌；**新增代码不得再写旧名**
- **状态层**：MD3 交互反馈是 **alpha 叠加层**（hover .08 / focus .12 / pressed .12 / dragged .16），
  四态已注册为**顶层** utility（`bg-layer-hover-*` …）。⚠️ 嵌套在 `state` 下会产出 `bg-state-layer-*`
  ——与既有 `bg-layer-*` **不同名**，写错层级就是死类名、**静默无样式**。预计算实色仅作兜底。
  `focus` / `focus-visible` 引擎不匹配（实证见下表第 5 条），禁写这两类变体
- **动效**：缓动只允许 `--motion-*` 四条、时长走 `--duration*`；`easing-legacy` 的
  `cubic-bezier(0.4,0,0.2,1)` 是 MD2 遗留，**禁用**。`standard` 与 `emphasized` 同为 `(0.2,0,0,1)`
  是**官方事实**，不是笔误

**有意偏离 MD3（封闭清单，5 条）**：经 ADR-0205 决策 4 拍板**不做整改**，留痕以免每次 review 都被当成新 bug 重提。
**只列名称与指向；理由展开与证据查 [`glossary-md3-alignment.md` §11](./docs/adr/glossary-md3-alignment.md) 与各 ADR。**

| # | 偏离名称 | 指向 |
|---|---|---|
| 1 | 动态色 / 壁纸取色**不做**（跟随壁纸会丢 logo 品牌色），保留 7 套构建期静态色板 | ADR-0205 决策 4 |
| 2 | 搜索框保持 42px 全圆角药丸，不改 MD3 filled 56dp | ADR-0205 决策 4；`SearchSheet.vue` |
| 3 | 二级 tab 保持 48px，不加大到 56px | ADR-0205 决策 4；`SubTabBar.vue` |
| 4 | `hover` 在纯触屏判定为「不适用」 | ADR-0205 决策 4 |
| 5 | `focus` / `focus-visible` 判定为「不适用」，不写这两类变体 | ADR-0207 决策 5 |

> **该清单是封闭的**：不在表内的差距**默认按「要修」处理**。重开某条须新开 ADR 推翻 ADR-0205 决策 4。

**配套 ADR**：[0205](docs/adr/ADR-0205-md3-baseline-and-scope.md) 基线 · [0206](docs/adr/ADR-0206-typography-type-scale.md) 排版 · [0207](docs/adr/ADR-0207-shape-and-state-layer-guardrails.md) 形状与状态层 · [0208](docs/adr/ADR-0208-material-symbols-icons.md) 图标 · [0209](docs/adr/ADR-0209-md3-filled-text-field-alignment.md) 文本字段 · 事实底座 [`差距分析`](docs/research/material-design-3-gap-analysis-2026-09.md)
## 测试

- **框架**：Vitest 5.0.1（`vp test`）
- **位置**：客户端 `packages/app-lynx/{src,tests}/**`；宿主 `packages/android-host/tests/{unit,android-e2e}/**`；编写约定详版 = `docs/testing/conventions.md`（本节为摘要）
- **E2E 编排**：android-e2e 10 spec 手动（发版前转换矩阵门 `transition-matrix.spec.ts` @release-gate，ADR-0163），见 `packages/android-host/tests/android-e2e/specs/`
- `passWithNoTests: false` — T0 门禁（ADR-0097，防空壳漂移 ADR-0084）

### 门禁边界（#539 拍板，2026-09-15）

- **CI 门禁**（`.github/workflows/ci.yml`）= `check:all` + `lint:all` + `test:all`（vitest 单测；E2E 不进 CI，ADR-0084）+ Robolectric Java 单测
- **任务缓存只给 `check:all` 开（`--cache`），`test:all` 必须不缓存**：`vp` 的 `run.cache = { scripts: false, tasks: true }` 使 script 默认不缓存。**测试门禁一旦缓存命中 = 测试根本没跑、只重放日志——绿灯是假的**（本仓反复在消灭的假绿）。改这两个脚本前先读 `node_modules/vite-plus/docs/config/run.md`。
- **关键行为必须有 CI 内单测防线**（语义翻转、手势契约、跨端契约、状态机）：「CI 内无机器防线」阻塞判定以本条为口径——单测防线已存在即不阻塞，android-e2e-only 不作为阻塞项复现

### 测试硬约束（违反视为架构违规；详版见 `docs/testing/conventions.md`，编号一一对应）

1. **IO 边界测试强制覆盖**：外部数据读取函数必须有成功 + 失败/降级双路径单测
2. **契约测试必须使用真实样例**：mock 来自真实数据源，禁手写自洽字段（`backupRulesConsistency.test.ts` 模式）
3. **禁止静默降级**：兜底路径必须 `console.warn`（模块前缀）或显式暴露错误
4. **重构行为不变约束**：字段/常量/默认值改动须查契约测试（缺失则补）并在 commit message 标注
5. **E2E 覆盖原则**：可达路径有 E2E；外部状态用 `driver.mockFetch()` + `driver.spyOnWindowOpen()` 构造；evaluate 注入须单行
6. **期望值出处可追溯（oracle 溯源）**：断言指向独立来源，禁自洽反推；执行 = code-review SKILL 双审计（依据 `docs/research/ai-generated-test-quality.md`）

### 门禁冻结线（防「给回归创造就业」）

门禁的价值是**防回归**，不是**显得严谨**。两者冲突时**以前者为准**。

1. **规模线**：单个门禁文件超过其**被测对象**的 30% ⇒ 停止加码，先问「我是在防回归，还是在给回归创造就业」（实例与数据见 `docs/research/md3-visual-regression-2026-09.md` §8.8）。
2. **单轮诊断**：一轮只在「自己这轮写的」里找到问题、在「要交付的东西」里找到 0 个 ⇒ 该轮判为**空转**，换方向。
3. **变异测试的分母不自选**：「已知绕过 N/N」里的 N 是自己 imagined 的，随想象涨、不收敛。
   封住一条的唯一凭据是**外部复核**（另一方用**自己写的**攻击）把它打红；自测绿**不作为**证据。
4. **Goodhart 警告**：一旦「门禁是否完美」变成目标，它就不再是目标。优先级恒为
   **真实设备 / 真实数据 / 用户可见行为 > 门禁信号**。
5. **假绿比没门禁更糟**：会骗人的门禁会被人信。故门禁的**已知失效面必须显式登记**（同上 §8.8），
   不得只记它抓到了什么。

## 部署

- **Website**：push 到 `main` 且改动 `packages/website/**` → GitHub Actions 部署 GitHub Pages（`.github/workflows/deploy.yml`）
- **Android APK**：本地构建，经 `pnpm release:android-host` 交互式发布 → 完整流程 `docs/release-checklist.md`
- **本地预览**：`pnpm deploy`（复制 landing 页面到 `_site/`）

## 任务完成前自检

- **工具路由**：本次工具选择是否按「工具触发协议」执行？（代码结构/调用链/影响面 → CodeGraph；架构/领域/集成/测试 → OpenWiki；库/框架/API → Context7/MDN）偏离时当场沉淀 feedback memory
- **CodeGraph 异常**：返回空结果先 `codegraph status` 看节点/边计数（边数归零 = 索引腐化，提示用户重建）
- **测试纪律**：逐条核对「测试硬约束」1/2/3（IO 双路径、契约用真实样例、兜底路径显式告警）
- **生成物归属**：`openwiki/` 由 CI 定时重生成（见「OpenWiki 维护规则」），提交前不手改
- **提交信息**：`type(scope): description`，type 取值见「Notes」

## Notes

- 目录名为 `pixivizer`，项目名/包名为 Pictelio；**设计系统 = Material Design 3**（非 Fluent，见「约定 → app-lynx 的 MD3 约定」）
- 图片 CDN 走 `/pixiv-img/` 代理路径访问 `i.pximg.net`，非直连；**不要**在 HTML/CSS/JS 中硬编码 Pixiv CDN URL（`i.pximg.net`、`app-api.pixiv.net`）
- `packages/app/` 整包已随 ADR-0203 删除（WebView 客户端的源码、构建配置、依赖与专属测试）。Android 侧桥接实为 `@pictelio/android-host/android/app/src/lynx/java/` 原生模块；`capacitor-storage_` / `CapacitorStorage` 是**存量用户数据格式**，一字不改（ADR-0050）
- **Conventional Commits**：commit-msg hook 经 commitlint 强制；type ∈ feat / fix / docs / style / refactor / perf / test / build / ci / chore / revert

<!-- OPENWIKI:START -->

## OpenWiki

This repository has a generated `openwiki/` evidence index. It is optional just-in-time context, not required startup reading.

- Do not enumerate, preload, or search wikis at task start. Use retrieval when the user asks for it, when unfamiliar architecture or dependency behavior materially affects the task, or when source inspection leaves an important uncertainty. Stop once the question is grounded.
- When those conditions apply and OpenWiki retrieval tools are available, use `openwiki_search` for just-in-time context and `openwiki_read` for the relevant complete sections. If search returns `workspace_required`, ask which listed workspace to use and retry with its ID.
- Use `openwiki_list_workspaces` or `openwiki_list_wikis` when workspace membership itself needs to be discovered.
- If the retrieval tools are unavailable, read `openwiki/quickstart.md` and follow its links to the relevant pages.
- Treat source code and tests as authoritative. A brief's unknowns and review items are verification gaps, not automatic requirements.
- Prefer the narrowest quiet validation that proves the changed behavior. Preserve complete failure output.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->

## OpenWiki 维护规则

### 强制约束（违反视为违规）

- **架构概览 / 领域概念 / 集成方式 / 测试指南类问题，必须先读 `openwiki/` 对应页面再深入代码**；**禁止**未查阅即用 CodeGraph / Read 从零摸索。违规示例：直接读 `src/api/client.ts` 而不先读 `openwiki/architecture/api-layer.md`

### 更新维护
- **禁止** AI Agent 本地执行 `pnpm openwiki:update`（含修改 `src/`/`packages/` 后）。openwiki/ 是生成文档，由 GitHub Actions 定时任务（`.github/workflows/openwiki-update.yml`）每日自动重生成并提交 PR，无需也不应本地触发。
- **禁止手动编辑** `openwiki/` 目录下的任何生成文件。如需更新 OpenWiki 内容，只改源码/`CONTEXT.md`，交给 CI 定时重生成。
- **AGENTS.md 不维护逐文件清单**（目录枚举必然陈腐：ADR 计数、引擎矩阵格数均曾失真）——结构信息走 openwiki + CodeGraph。
- 兜底机制：openwiki 更新失败/未及时同步不影响本地开发或 commit，无需提示或干预，CI 定时任务会收敛。
- **CLAUDE.md 已废弃删除**：CI 定时任务的 openwiki 更新可能重建该文件，**请勿提交**（CI 已自动清理）。

<!-- CODEGRAPH_START -->
## CodeGraph

已建索引（`.codegraph/` 存在）时优先于 grep/read：pi agent 用原生 `codegraph_explore`，其余 bash 调 `codegraph explore`（子命令 `query` / `impact` / `affected` / `status`）。无索引则跳过——索引是用户决策，不得擅自 `codegraph init`。
<!-- CODEGRAPH_END -->

## Agent skills

### Issue tracker

Issues 托管在 GitHub（`a1121611810/Pictelio`），通过 `gh` CLI 操作。详见 `docs/agents/issue-tracker.md`。

### Triage labels

使用默认 triage 标签词汇表（`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`）。详见 `docs/agents/triage-labels.md`。

### Domain docs

多上下文布局 —— 根目录 `CONTEXT-MAP.md` 指向各上下文的 `CONTEXT.md`。详见 `docs/agents/domain.md`。

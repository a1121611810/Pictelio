# Pictelio

双渲染客户端的 Pixiv 第三方客户端——缺省 **Lynx** 客户端（vue-lynx，Material Design 3），可切换 **WebView** 客户端（SolidJS，Fluent Design 2）；通过 Capacitor 打包为 Android 原生应用。

## 项目概览

- **技术栈**: SolidJS 2.0（rc）+ TypeScript 7.0 (strict) + Vite 8.3 + UnoCSS 66.10 + Capacitor 8.5；小说正文布局用 `@chenglou/pretext`
- **Monorepo**: pnpm workspace 五子包：`pictelio-app`（SolidJS 主体）/ `pictelio-app-lynx` / `@pictelio/ugoira` / `@pictelio/update-check` / `pictelio-website`
- **入口**: `packages/app/src/main.tsx`（settings 同步、Fluent 主题、渲染、auth 恢复）→ `App.tsx` → `router.tsx`（路由定义与 App 分离）
- **设计系统**: `pictelio-app` **强制**遵循 Microsoft Fluent Design System 2（详见「Fluent Design 规范」）；`pictelio-app-lynx` 使用 Material Design 3（见「约定」app-lynx 样式）
- **Pixiv API**: `src/api/client.ts` 双模式客户端（Web fetch + Vite 代理 / Native bridge → `PixivApiPlugin`），401 自动刷新 + 防死循环

## 工具触发协议（任务开始第一步，违反视为架构违规）

**任何任务开始后，第一步必须先完成工具路由判断，再动手读代码/搜索。**

| 任务涉及 | 第一步必须 | 依据 |
|----------|-----------|------|
| 架构概览 / 领域概念 / 集成方式 / 测试指南（"为什么这样设计"） | 读取 `openwiki/` 对应页面 | 「OpenWiki 查询规范」决策链 |
| 具体符号 / 调用链 / 影响分析（"代码在哪、怎么调用"） | 调用 CodeGraph（pi 原生工具 `codegraph_explore` 或 bash `codegraph` CLI） | 「代码智能规范」速查表 |
| 第三方库/框架文档 | Context7（`mcp__context7__*`） | 「文档查询规范」决策链 |
| 浏览器标准 API | MDN（`mcp__mdn__*`） | 「文档查询规范」决策链 |
| 理解一个功能（why + where 都涉及） | **先 OpenWiki 后 CodeGraph** | 「OpenWiki 查询规范」协作规则 |

### 允许的降级（仅限以下场景，未命中则必须触发）

- CodeGraph/OpenWiki 不可用（`.codegraph/` 未生成、返回空结果）
- 已知路径的完整文件读取（任务明确要求读某个具体文件）
- 非代码文本搜索（日志、配置、依赖版本、文档）
- 简单文件列举（Glob 列明确模式）
- 小范围精准定位（已知符号名且单文件，Grep 更快）
- 中文语义搜索失败（CodeGraph 返回空/不相关时，降级找入口再切回）
- 环境缺少上述 MCP 工具时，用能力等价的可用工具（grep/read、web 搜索等）代替，**不视为违规**

### 持续反馈闭环（边用边发现问题）

- **自检证据化**：任务完成前记录"路由判断 + 所用工具"（见「任务完成前自检」）。
- **当场沉淀**：发现偏差（该用没用 / 用错工具 / 顺序反了），当场记一条 feedback memory（含场景 + 正确做法），下轮会话自动召回。
- **用户反馈兜底**：发现模型没用对时随时告知，由 agent 沉淀成 memory 或修订本文档。
- **定期回顾**：每次改动本文档相关章节时，回顾已沉淀的失败案例，把高频失败固化为规则。

## 代码智能规范（Code Intelligence）

本项目使用 CodeGraph 作为默认代码理解工具（本地索引，`.codegraph/` 目录）。接入方式（**无 MCP**，MCP 配置已随 `reasonix.toml` / `.mcp.json` 一并移除）：

- **pi agent**：全局扩展 `~/.pi/agent/extensions/pi-codegraph.ts` 注册原生工具 `codegraph_explore`（spawn CLI，主 agent 与子代理均可用），并带 tool_call 守卫（见下）。
- **其他 agent / 任意兜底**：bash 直接调 `codegraph` CLI（输出与原生工具逐字等价）。

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
| 索引健康检查 | bash `codegraph status`（`--json` 可解析） | 节点/边计数；边数归零 = 索引腐化，人工 `codegraph index --force` |

### tool_call 守卫（pi 扩展行为）

- 用 grep 做"标识符形态 pattern + 全项目/代码目录"的搜索会被 block 并引导到 `codegraph_explore`。
- 放行场景：非代码文本（配置/文档/日志）、单文件内搜索、path 在索引根之外、正则/中文 pattern。
- 逃逸阀：确认 codegraph 覆盖不了时，**原样重试同一调用即放行**（禁止换 bash 绕过——bash 搜索本就被 search-guard 拦截）。
- bash 中直接调 `codegraph` CLI 不被拦截，计为有效使用。

### 禁止的默认行为

- 未经 CodeGraph 尝试，直接用 Grep/Read 进行大规模代码探索。
- 用 Grep 手动拼凑调用链（应用 `codegraph_explore` 命名端点一次拿路径）。
- 用 Read 顺序打开多个文件来"摸索"架构（应先用 `codegraph_explore`）。
- 对 explore 已返回源码的文件再 Read 复验（输出是 re-read from disk 的逐字节当前源码）。

> 如果 `.codegraph/` 索引尚未生成，在项目根目录运行：`codegraph init`（索引是用户决策，agent 不得擅自执行）

## 文档查询规范（Documentation Query）

文档查询遵循明确的优先级链：Context7 → MDN → `web_fetch`。

### 默认原则

- **第三方库/框架的 API 文档、使用指南、配置说明，默认优先使用 Context7 工具（`mcp__context7__*`）。**
- **浏览器标准 API（HTML/CSS/JS 标准 API、Web API 语法与兼容性）优先使用 MDN 工具（`mcp__mdn__*`）。**
- 仅当 Context7 和 MDN 都不支持目标查询时，才使用 `web_fetch` 搜索官方文档。

### 优先级决策链

| 场景 | 第一优先 | 第二优先 |
|------|---------|---------|
| 库/框架文档（SolidJS、TanStack、Capacitor、Vite 等） | `mcp__context7__*` | `web_fetch`（官网） |
| 浏览器标准 API（`fetch`、`Headers`、`Promise`、CSS 属性等） | `mcp__mdn__*` | `web_fetch`（MDN 页面） |
| 其他技术文档（非库/非浏览器标准） | `mcp__context7__*` 尝试 | `web_fetch`（官方文档） |

### 禁止的默认行为

- 未经 Context7 尝试，直接用 `web_fetch` 查第三方库文档。
- 用 `web_fetch` 搜索可在 Context7 中直接查到的库文档。
- 对同一问题重复调用 `resolve-library-id` 超过 2 次。
- 在单个 `query-docs` 调用中放入多个独立概念。

## OpenWiki 查询规范（OpenWiki Query）

OpenWiki 提供人工整理的高层次项目概览，与 CodeGraph（精确代码结构）互补。按主题分流使用。

### 默认原则

- **当问题涉及架构概览、领域概念、集成方式、测试指南等主题时，优先读取 `openwiki/` 目录下对应的文档页面，获取高层次理解后再深入代码细节。**
- OpenWiki 页面由 AI 定期从源码生成，内容涵盖设计意图和整体流程，CodeGraph 无法替代。

### 优先级决策链

| 场景 | 首选文档 | 说明 |
|------|---------|------|
| 快速了解项目全貌 | `openwiki/quickstart.md` | 入口点，再根据链接深入具体页面 |
| 架构概览（启动流程、路由、CSS、工具链） | `openwiki/architecture/overview.md` | 了解设计意图和整体结构 |
| API 层设计（OAuth、双模式、401 重试） | `openwiki/architecture/api-layer.md` | 设计决策与数据流 |
| 图片流水线（缓存、代理、CDN） | `openwiki/architecture/image-pipeline.md` | 三层缓存架构 |
| Feed 与浏览（推荐、虚拟滚动、R18 过滤） | `openwiki/domain/feed-and-browsing.md` | 业务逻辑与数据流 |
| 小说阅读器（虚拟布局、搜索、系列导航） | `openwiki/domain/novel-reader.md` | 核心交互流程 |
| Android 原生集成（Capacitor 插件、构建） | `openwiki/integrations/android-native.md` | 原生桥接与构建配置 |
| 测试策略（单元测试、E2E 测试） | `openwiki/testing/overview.md` | 测试分层与工具链 |

### 与 CodeGraph 的协作规则（强制路由，违反视为架构违规）

- **架构概览 / 领域概念 / 集成 / 测试指南** → **必须**先读 OpenWiki 获取高层次理解
- **具体符号定义 / 调用链 / 影响分析** → **必须**使用 CodeGraph 精确追踪
- **理解一个功能时** → **必须**先用 OpenWiki 了解"为什么这样做"，再用 CodeGraph 了解"代码在哪、怎么调用"

### 禁止的默认行为

- 在未查阅对应 OpenWiki 页面的情况下，直接用 CodeGraph / Read 从零摸索架构层面问题。

## 命令

项目根目录执行，pnpm workspace 委托：**裸命令** → `pictelio-app`；`<命令>:<包名>` → 对应包；`:all` → 并行全部（ADR-0059；权威清单 = 根 `package.json`）：

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` / `build` / `check` / `test` / `lint` / `fmt` | app：dev(5173) / 检查+构建 / 类型检查 / Vitest / oxlint / oxfmt |
| `pnpm <命令>:app-lynx\|:website\|:ugoira` / `:all` | 委托对应包 / 并行全部 |
| `pnpm dev:android` / `build:android(:release)` | 热重载 / Debug 或签名 Release APK（需密码环境变量） |
| `pnpm test:agent-browser` / `test:android:e2e` | AI E2E（入门禁）/ 模拟器 E2E（手动按需） |
| `pnpm release` / `cap:sync` / `deploy(:dry)` | 交互式发布 / Capacitor 同步 / 落地页预览 |

## Monorepo 结构

monorepo 布局与逐目录职责见 `openwiki/architecture/overview.md` §Monorepo Layout、`openwiki/quickstart.md` §Key Source Files。本文档不维护目录树，结构信息走 openwiki + CodeGraph（防回潮见「OpenWiki 维护规则」）。

## 架构

`packages/app/src/` 分层（逐文件清单 → `openwiki/architecture/overview.md` §Component Architecture）：

- `api/` — Pixiv API 层（OAuth、双模式客户端、作品/小说/搜索/用户/评论）
- `stores/` — SolidJS 状态（Feed、收藏、设置、主题等；顶层导出）
- `routes/` — 页面组件；路由定义在独立的 `src/router.tsx`
- `components/` — 可复用 UI（卡片、图片、查看器、面板、骨架屏等）
- `primitives/` — 无 UI 逻辑原语（虚拟滚动、下拉刷新、滚动行为、小说布局/翻译等）
- `native/` — Android 原生桥接（仅原生构建生效）；`services/` 服务；`settings/` 设置；`utils/` 工具

## 关键设计决策

细节一律**双锚指针**（openwiki + ADR；openwiki 可能滞后，精确语义以 ADR/源码为准绳）：

- **PixivApiPlugin 网关** → `openwiki/architecture/api-layer.md` + ADR-0037
- **图片流水线三层缓存** → `openwiki/architecture/image-pipeline.md` + ADR-0090
- **Android 原生集成**（返回键、`shouldInterceptRequest` 图片代理、`src/native/` 桥接）→ `openwiki/integrations/android-native.md`
- **引擎决策（ADR-0164）**：缺省 Lynx；硬规则 = 预热与路由**必须**共用 `EngineRouting.resolve`，禁止各自读键；10s 加载超时永不自动跳 → `openwiki/integrations/android-native.md` §Engine Availability Fallback + ADR-0164
- **安全存储**（refresh_token 走 Keystore，首启迁移）→ `openwiki/integrations/android-native.md`
- **虚拟滚动与布局**（主 Feed 固定单列 ADR-0075）→ `openwiki/domain/feed-and-browsing.md`
- **年龄限制与内容过滤** → `openwiki/domain/feed-and-browsing.md`
- **更新检查**（GitHub API + `/github-api` 代理）→ `openwiki/architecture/overview.md`

## 即时导航硬约束

**硬约束**（违反视为架构违规）：

1. **先渲染、后加载**：用户主动点击进入任何页面/弹窗/详情时，必须先渲染页面框架（含骨架屏占位），再发起数据请求。不允许任何路由级 loader/middleware 以 `await` 网络请求的方式阻塞页面渲染。
2. **全局最优**：任何方案必须从宏观（全局架构）和微观（单个组件）两个角度验证。禁止只优化局部而损害整体。方案须同时满足高可维护性、高性能、高安全性、低内存占用。
3. **竞态防护**：组件内所有异步数据请求必须使用 generation-gate、AbortController 或等效机制防护，防止请求参数变化后旧响应覆盖新数据。
4. **数据层分流**：跨组件共享数据使用全局缓存/去重层；页面独有数据由组件自身管理生命周期。

## 工作流强制规范

**硬约束**（违反视为架构违规）：

所有涉及需求实现的任务，必须走以下四阶段流水线，**禁止跳过环节，禁止在前置阶段直接进入开发实现**：

```
Grill 澄清 → to-spec → to-tickets → implement
```

各阶段要求：

1. **Grill 澄清**（`/grill-me` 无代码库 / `/grill-with-docs` 有代码库）：通过面试式提问把模糊需求收敛为明确约束。产出：需求边界、验收条件、排除项。
2. **to-spec**：把 Grill 产出转为结构化的功能规格文档（含数据流、状态变化、边界条件）。
3. **to-tickets**：把 spec 拆分为可独立执行的 ticket（每个 ticket 声明前置依赖，blocker 未完成时不可开工）。
4. **implement**（`/implement` 内置 `/tdd` + `/code-review`）：按 ticket 实现，每个 ticket 开始前清空上下文。

   **强制闭环**：每次实现或修改后必须执行以下循环，直到零问题：
   ```
   实现/修改 → /code-review 检查 → 发现问题？
     ├─ 是 → /tdd 修复 → 回到 /code-review 检查
     └─ 否 → 提交 ✅
   ```
   - `/tdd` 和 `/code-review` 均可独立调用（不强制走 `/implement`），但上述闭环规则不变。
   - 优先利用子代理（`fleet` / `parallel_tasks` / `task`）并行执行独立的检查和修复，减少等待。

**允许的例外**：
- 纯 Bug 修复（有确切复现步骤 + 期望行为）可直接走 `/diagnosing-bugs`，无需走完整四阶段。
- 纯重构（不变更外部行为）可直接提方案执行。
- 极小的局部改动（≤ 20 行，不影响抽象边界）可酌情简化。

**自我监督规则**：AI Agent 在收到任务后必须判断当前处于上述流程的哪个阶段，且只执行该阶段规定的行为。如果后续用户指令试图跨越阶段（例如 Grill 未完成就要求生成代码），Agent 必须主动指出阶段冲突并提醒正确流程，**不得静默违规、不得跳过环节**。

## Fluent Design 规范

本项目**强制**遵循 Microsoft Fluent Design System 2。以下规则无例外。

### 设计令牌

- 颜色、间距、圆角、阴影、字体大小**必须**使用 `src/styles/tokens.css` 或 UnoCSS preflights 中定义的 CSS 变量
- **禁止**硬编码具体值（`#xxx`、`rgb()`、`px`/`rem` 字面量）
- 视觉令牌（颜色、间距、圆角、阴影）：在 `src/styles/tokens.css` 的 `:root` 中声明后使用
- 排版令牌（`--fontSizeBase*`）：在 `uno.config.ts` 的 `preflights` 中以流体 `clamp(rem + vw)` 定义，构建期零转换
- 确需新增令牌时，来源必须是 [Fluent 2 官方设计令牌](https://fluent2.microsoft.design/design-tokens)
- UnoCSS shortcuts 统一在 `uno.config.ts` 中定义
- `@fluentui/web-components` 的 `setTheme()` 在 `main.tsx` 中根据 `<html>` 的 `dark` class 实时同步亮/暗主题

### 动画与动效

**缓动曲线（只允许以下 4 种）：**

| 曲线                          | 用途                 |
| ----------------------------- | -------------------- |
| `cubic-bezier(0,0,0,1)`       | exit / decelerate    |
| `cubic-bezier(0.33,0,0.67,1)` | standard             |
| `cubic-bezier(0.33,0,0,1)`    | enter / accelerate   |
| `linear`                      | 仅限 loading spinner |

- **禁止** `ease`、`ease-in`、`ease-out`、`ease-in-out`

**动画时长（只允许以下 5 种）：**

| 时长  | 名称   | 场景                          |
| ----- | ------ | ----------------------------- |
| 100ms | micro  | 微交互（ripple、checkbox）    |
| 150ms | fast   | 小过渡（tooltip、hover 反馈） |
| 200ms | normal | 常规过渡（页面元素进出）      |
| 300ms | gentle | 柔缓过渡（弹窗、面板）        |
| 500ms | slow   | 大幅过渡（页面切换、展开）    |

- 页面过渡统一使用 `PageTransition.tsx`
- 组件内动效优先使用 Fluent motion tokens（`--durationNormal`、`--curveEasyEase` 等，定义在 `src/styles/tokens.css`）

### 交互状态

- 每个可交互元素必须覆盖以下三种状态：
  - **hover**：视觉反馈（颜色变化或轻微提升）
  - **active**（pressed）：`scale(0.98)` 或 Fluent pressed 颜色加深
  - **focus-visible**：`outline` + `outline-offset`，**禁止**裸 `:focus` 样式
- 触控目标最小 **40×40px**（移动端优先）

### 禁止清单

| 禁止                                      | 必须使用                                             |
| ----------------------------------------- | ---------------------------------------------------- |
| 硬编码颜色值（`#xxx`、`rgb()`）           | `var(--colorXxx)`                                    |
| 硬编码圆角值（`8px`、`0.5rem`）           | `var(--borderRadiusXxx)`                             |
| 硬编码阴影值                              | `var(--elevationN)`                                  |
| 非 Fluent 缓动曲线                        | Fluent 标准曲线（见上表）                            |
| 非标准动画时长                            | Fluent duration（见上表）                            |
| 自定义字体大小（`15px`、`1.2rem`）        | `var(--fontSizeBaseXxx)` 或 `var(--fontSizeHeroXxx)` |
| 裸 `:focus` 伪类                          | `:focus-visible`                                     |
| `[color:var(--colorXxx)]` 形式            | `text-[var(--colorXxx)]`                             |
| `[background-color:var(--colorXxx)]` 形式 | `bg-[var(--colorXxx)]`                               |
| `duration-200` / `duration-300` 等        | `duration-[var(--durationNormal)]` 等                |
| `bg-black` / `text-white` 硬编码          | 使用 overlay token（`--colorOverlay*`）              |

## 约定

- **TS / 组件 / 状态 / 别名**：`strict: true`（+ noUnusedLocals 等 4 项，ESNext / bundler）；SolidJS 函数组件 `Component<Props>`、默认导出；createSignal / createStore 顶层导出；`@/` → `src/`
- **app-lynx 样式（Tailwind 硬性约定）**：`packages/app-lynx` 样式**默认优先 Tailwind utility**（`tailwind.config.ts`：spacing=vw / fontSize=rpx / M3 色板）；禁止手写 scoped CSS；特殊语义用 arbitrary utility（`min-h-[40vw]`、`[max-line:1]`）；web-core 预览禁 rem
- **注释 / 命名**：中文注释为主（API 层与类型定义偏英文）；组件 PascalCase、工具/API/primitives camelCase
- **Lint / 格式化**：`vite-plus` 内置 oxlint / oxfmt，配置在 `vite.config.ts` 的 `lint` / `fmt` 字段（oxlint：typescript/unicorn/oxc 插件，correctness=error；忽略 dist/、android/、node_modules/、.codegraph/）
- **Android**：`minSdkVersion = 28`（`variables.gradle`）；自定义 Capacitor 插件在 `MainActivity.java` 经 `registerPlugin()` 注册（**必须在 `super.onCreate()` 之前**）；平台要求 / WebView 门槛 / 引擎降级矩阵 → `docs/platform-compatibility.md`
- **发布签名**：Release 用 `android/app/pictelio-release.keystore`，密码经环境变量注入，keystore 禁止提交 → `docs/release-signing.md`
- **代理配置**：开发时自动读取 `https_proxy` / `HTTPS_PROXY` / `http_proxy` / `HTTP_PROXY`，回退 `http://127.0.0.1:7897`
- **Node**：22.22.2+（ADR-0080），pnpm 11.9.0（`devEngines` 强制校验）

## 测试

- **框架**：Vitest 4.1（`vp test`）+ `happy-dom`（SolidJS server 姿态问题，ADR-0144）
- **位置**：`tests/unit/**`（按源目录）、`tests/agent-browser/specs/**`、`src/**/*.test.ts`；编写约定详版 = `packages/app/tests/TESTING.md`（本节为摘要）
- **E2E 编排**：agent-browser 6 个 spec 入门禁；android-e2e 19 个 spec 手动按需（发版前转换矩阵门 `transition-matrix.spec.ts` @release-gate，ADR-0163），清单见 `packages/app/tests/android-e2e/specs/`
- `passWithNoTests: false` — T0 门禁（ADR-0097，防空壳漂移 ADR-0084）

### 门禁边界（#539 拍板，2026-09-15）

- **CI 门禁**（`.github/workflows/ci.yml`）= `check:all` + `lint:all` + `test:all`（app 单测 + agent-browser E2E）+ Robolectric Java 单测
- **关键行为必须有 CI 内单测防线**（语义翻转、手势契约、跨端契约、状态机）：「CI 内无机器防线」阻塞判定以本条为口径——单测防线已存在即不阻塞，android-e2e-only 不作为阻塞项复现

### 测试硬约束（违反视为架构违规；详版见 `packages/app/tests/TESTING.md`，编号一一对应）

1. **IO 边界测试强制覆盖**：外部数据读取函数必须有成功 + 失败/降级双路径单测
2. **契约测试必须使用真实样例**：mock 来自真实数据源，禁手写自洽字段（`backupRulesConsistency.test.ts` 模式）
3. **禁止静默降级**：兜底路径必须 `console.warn`（模块前缀）或显式暴露错误
4. **重构行为不变约束**：字段/常量/默认值改动须查契约测试（缺失则补）并在 commit message 标注
5. **E2E 覆盖原则**：可达路径有 E2E；外部状态用 `driver.mockFetch()` + `driver.spyOnWindowOpen()` 构造；evaluate 注入须单行
6. **期望值出处可追溯（oracle 溯源）**：断言指向独立来源，禁自洽反推；执行 = code-review SKILL 双审计（依据 `docs/research/ai-generated-test-quality.md`）

## 部署

- **Website**：push 到 `main` 且改动 `packages/website/**` → GitHub Actions 部署 GitHub Pages（`.github/workflows/deploy.yml`）
- **Android APK**：本地构建，经 `pnpm release` 交互式发布 → 完整流程 `docs/release-checklist.md`
- **本地预览**：`pnpm deploy`（复制 landing 页面到 `_site/`）

## 注意事项

- **路由数据规则**：`@solidjs/router` 无 loader/Suspense，路由级数据由路由组件内获取（`useParams`/`useLocation` + `createEffect` + 手动 fetch 或 TanStack Query 按需查询），不阻塞渲染（遵循「先渲染后加载」硬约束）；组件内局部异步仍使用 `createSignal` + `createEffect` + 手动 fetch（带 AbortController）。`createResource` 不用于路由组件。

## 任务完成前自检

- **工具使用证据**：本次涉及代码理解/架构/文档查询时，是否记录了路由判断与所用工具？（见「工具触发协议」；发现偏差当场沉淀 feedback memory）
- **代码理解优先性**：涉及代码结构、调用链、影响范围分析时，是否优先使用了 CodeGraph？（工具选择见上方速查表）
- **Fallback 合理性**：未用 CodeGraph 时，是否属于允许的例外？（不可用、已知路径读取、非代码搜索等）
- **索引健康**：CodeGraph 返回异常时，是否运行 `codegraph status` 检查了节点/边计数（边数归零 = 腐化，提示用户重建）？
- **文档查询优先性**：涉及库/框架/浏览器 API 查询时，是否遵循了「文档查询规范」的优先级链？（优先 Context7 或 MDN）
- **OpenWiki 查询优先性**：涉及架构概览、领域概念、集成、测试指南等主题时，是否先查阅了对应的 OpenWiki 页面再深入代码？
- **OpenWiki 文档同步**：修改了 `src/` 或 `packages/` 中的代码后，**不得**本地执行 `pnpm openwiki:update`（依赖 CI 定时任务每日重生成），且**不得**手改 `openwiki/` 生成文件？
- **IO 边界测试**：本次改动涉及的 fetch/存储/桥接解析函数，成功与失败路径是否都有单元测试？
- **真实样例**：新增/修改的测试 mock 是否来自真实数据结构，而非手写自洽字段？
- **静默降级**：本次改动是否有降级兜底路径（`??`、catch 默认值）？是否打了 warn 或显式暴露错误？
- **Conventional Commits 规范**：提交的 commit message 是否符合 Conventional Commits 格式（`type(scope): description`）？commitlint 会强制校验。

## Notes

- 项目必须符合 Microsoft Fluent Design 风格；目录名为 `pixivizer`，项目名/包名为 Pictelio
- 图片 CDN 走 `/pixiv-img/` 代理路径访问 `i.pximg.net`，非直连；**不要**在 HTML/CSS/JS 中硬编码 Pixiv CDN URL（`i.pximg.net`、`app-api.pixiv.net`）
- `src/native/` 原生桥接仅 Android 构建生效，Web 开发环境不加载
- **Conventional Commits**：commit-msg hook 经 commitlint 强制；type ∈ feat / fix / docs / style / refactor / perf / test / build / ci / chore / revert

<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->

## OpenWiki 维护规则

### 强制约束（违反视为违规）

- **任何涉及架构概览、领域概念、集成方式、测试指南的问题，必须先读取 `openwiki/` 对应页面再深入代码。**
- **禁止**在未查阅对应 OpenWiki 页面的情况下，直接使用 CodeGraph / Read 从零摸索架构层面问题。
- 先通过 OpenWiki 获取高层次理解，再使用 CodeGraph 精确追踪代码细节。
- 违规示例：直接读 `src/api/client.ts` 而不先读 `openwiki/architecture/api-layer.md`

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

# Pictelio

基于 SolidJS 的 Pixiv 第三方客户端，通过 Capacitor 打包为 Android 原生应用。项目名为 **Pictelio**（目录名为 pixivizer）。

## 项目概览

- **技术栈**: SolidJS 1.9 + TypeScript 6.0 (strict) + Vite 8.2 + UnoCSS 66.7 + Capacitor 8.5；小说正文布局使用 `@chenglou/pretext`
- **Monorepo**: pnpm workspace，含五个子包：`pictelio-app`（SolidJS SPA 主体）、`pictelio-app-lynx`（vue-lynx 客户端 MVP）、`@pictelio/ugoira`（Ugoira 动图帧处理库）、`@pictelio/update-check`（更新检查共享库）和 `pictelio-website`（Astro 落地页）
- **入口**: `packages/app/src/main.tsx`（bootstrap：settings 同步、Fluent 主题、渲染、auth 恢复）→ `packages/app/src/App.tsx` → `packages/app/src/router.tsx`（@solidjs/router，路由定义与 App 分离；`src/startup.ts` 为预留启动钩子，当前为空实现）
- **路由**: `/login` `/home` `/illust/$id` `/debug` `/novel/$id` `/search` `/me` `/about` `/image-host` `/image-cache` `/settings` `/client-switch` `/age-confirmation` `/scroll-restoration-confirm` `/user/$id` `/user/$id/illusts` `/user/$id/following` `/user/$id/followers` `/my/followers`（其余路径 catch-all 直接渲染 `/home`）
- **设计系统**: `pictelio-app` **强制**遵循 Microsoft Fluent Design System 2（所有视觉和交互决策基于 Fluent 令牌和规范，详见「Fluent Design 规范」）；`pictelio-app-lynx` 使用 Material Design 3（见「约定」章节 app-lynx 样式）
- **Pixiv API**: 自建 HTTP 客户端 (`src/api/client.ts` + `src/api/queryClient.ts`)，双模式（Web: fetch + Vite 代理，`devAccessToken` 编译期保护 / Native: Capacitor bridge → `PixivApiPlugin`，见 `src/native/PixivApi.ts`），iOS OAuth 凭证策略（Android 已弃用），401 自动刷新 + 防死循环
- **CSS 架构**: 分层加载 `reset.css` → `tokens.css` → `base.css` → `virtual:uno.css` → `novel-reader.css`；字号通过 UnoCSS preflights 以流体 `clamp(rem + vw)` 定义（见 `uno.config.ts`），无需构建期转换；Fluent Web Components 主题同步
- **构建工具**: 使用 `vite-plus`（内部封装 Vite + oxlint + oxfmt + vitest），通过 `vp` CLI 统一执行 dev/build/check/test/lint/fmt

## 工具触发协议（任务开始第一步，违反视为架构违规）

**任何任务开始后，第一步必须先完成工具路由判断，再动手读代码/搜索。**

| 任务涉及 | 第一步必须 | 依据 |
|----------|-----------|------|
| 架构概览 / 领域概念 / 集成方式 / 测试指南（"为什么这样设计"） | 读取 `openwiki/` 对应页面 | 「OpenWiki 查询规范」决策链 |
| 具体符号 / 调用链 / 影响分析（"代码在哪、怎么调用"） | 调用 CodeGraph（`mcp__codegraph__*`） | 「代码智能规范」速查表 |
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

> 完整细节（参数、索引维护、结果解读）在全局 memory `mcp-codegraph-usage.md` / `mcp-doc-query.md`。

### 持续反馈闭环（边用边发现问题）

- **自检证据化**：任务完成前自检记录"路由判断 + 所用工具"（见「任务完成前自检」）。
- **当场沉淀**：发现偏差（该用没用 / 用错工具 / 顺序反了），当场记一条 feedback memory（含场景 + 正确做法），下轮会话自动召回。
- **用户反馈兜底**：发现模型没用对时随时告知，由 agent 沉淀成 memory 或修订本文档。
- **定期回顾**：每次改动本文档相关章节时，回顾已沉淀的失败案例，把高频失败固化为规则。

## 代码智能规范（Code Intelligence）

本项目使用 CodeGraph 作为默认代码理解工具（通过 `mcp__codegraph__*` MCP 前缀访问）。
项目已通过 `reasonix.toml` 配置 `--path`，调用 CodeGraph 工具时**不要**手动传 `projectPath`。

### 默认原则

- **任何涉及"理解代码结构、定位符号、追踪调用链、分析影响范围"的任务，默认优先使用 CodeGraph 系列工具（`mcp__codegraph__*`）。**
- CodeGraph 是默认工具，不是搜索失败后的兜底工具。
- 仅当 CodeGraph 不可用、或场景明确属于「工具触发协议」中的「允许的降级」时，才使用 Grep/Glob/Read 等替代手段。

### 工具选择速查

| 场景 | 首选工具 | 说明 |
|------|----------|------|
| 接到功能/Bug 任务，不确定入口 | `codegraph_context` | 任何"how does X work"问题首选，返回上下文与源码 |
| 按名称快速定位符号 | `codegraph_search` | 搜索函数、组件、变量、路由等 |
| 两个符号之间的调用路径 | `codegraph_trace` | 追踪 A→B 的调用链 |
| 一次性获取多个相关符号源码 | `codegraph_explore` | 探索组件依赖的 store/service/子组件 |
| 单个符号详情（含源码） | `codegraph_node` | 用 `includeCode=true` 获取完整体 |
| 重构前影响分析 | `codegraph_impact` | 分析修改某符号会影响哪些文件 |
| 索引健康检查 | `codegraph_status` | 检查索引是否就绪、节点/边数量 |

完整规范（参数速查、调用示例、索引维护、结果解读、降级方案）保存在全局 memory `mcp-codegraph-usage.md`。

> 如果 `.codegraph/` 索引尚未生成，在项目根目录运行：`codegraph init`

### 禁止的默认行为

- 未经 CodeGraph 尝试，直接用 Grep/Glob/Bash find 进行大规模代码探索。
- 用 Grep 手动拼凑调用链（应使用 `codegraph_trace`）。
- 用 Read 顺序打开多个文件来"摸索"架构（应先用 `codegraph_context` / `codegraph_explore`）。

### projectPath 说明

CodeGraph MCP 服务器的 `projectPath` 参数用于指定要查询的项目。本项目已通过 `reasonix.toml` 在启动服务器时配置了 `--path`，因此：

- **默认不传** `projectPath`：服务器已自带本项目路径，直接调用即可。
- **报错时再传**：如果调用返回"找不到项目路径"之类的错误，将 `projectPath` 设为当前工作目录路径重试（由系统提示 `Current workspace` 字段可知）。
- **跨项目查询**：如需分析其他项目，显式传入对应项目的根路径。

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

完整规范（使用流程、降级策略、调用示例）保存在全局 memory `mcp-doc-query.md`。

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

所有命令在项目根目录执行，通过 pnpm workspace 委托。**命令约定**（详见 `docs/adr/ADR-0059-root-script-convention.md`）：

裸命令默认委托给 `pictelio-app`；`<命令>:<包目录名>` 委托给对应包（`app` / `app-lynx` / `website` / `ugoira`）；`<命令>:all` 并行执行所有拥有该脚本的包（无脚本的包自动跳过）。

| 命令                                | 说明                                                              |
| ----------------------------------- | ----------------------------------------------------------------- |
| `pnpm dev`                          | 启动 app 的 Vite 开发服务器（端口 5173）                          |
| `pnpm dev:app`                      | 同 `pnpm dev`（显式别名）                                         |
| `pnpm dev:app-lynx`                 | 启动 app-lynx（vue-lynx）开发服务器                               |
| `pnpm dev:website`                  | 启动落地页（Astro）开发服务器                                     |
| `pnpm dev:all`                      | 并行启动所有 dev 服务器（app / app-lynx / website）               |
| `pnpm dev:android`                  | 一键 Android 开发热重载流程                                       |
| `pnpm build`                        | TypeScript 检查 + Vite 构建到 `dist/`（app）                      |
| `pnpm build:app-lynx`               | 构建 app-lynx bundle                                              |
| `pnpm build:website`                | 构建落地页                                                         |
| `pnpm check`                        | 仅 TypeScript 类型检查（app）                                     |
| `pnpm check:app-lynx`               | app-lynx 类型检查                                                 |
| `pnpm check:ugoira`                 | ugoira 类型检查                                                   |
| `pnpm check:all`                    | 并行类型检查 app / app-lynx / ugoira                              |
| `pnpm preview`                      | 预览生产构建（app）                                               |
| `pnpm test`                         | 运行 Vitest 测试（app）                                           |
| `pnpm test:app`                     | 同 `pnpm test`（显式别名）                                        |
| `pnpm test:app-lynx` / `test:ugoira`| 运行对应包的单测                                                  |
| `pnpm test:all`                     | 并行运行所有包的单测                                              |
| `pnpm test:app:all`                 | app 单测 + agent-browser E2E（原 `test:all` 组合语义）             |
| `pnpm test:watch`                   | Vitest watch 模式（app）                                          |
| `pnpm test:agent-browser`            | agent-browser AI 驱动 E2E（app）                                  |
| `pnpm test:android:e2e`              | Android 模拟器 Appium E2E（app）                                  |
| `pnpm lint` / `pnpm fmt`            | oxlint 检查 / oxfmt 格式化（app）                                 |
| `pnpm fmt:check`                    | oxfmt 格式检查（不修改）                                          |
| `pnpm build:android`                | 构建 Web + Capacitor 同步 + Gradle 编译 Debug APK                 |
| `pnpm build:android:release`        | 构建签名 Release APK（需环境变量 `PICTELIO_KEYSTORE_PASSWORD` 和 `PICTELIO_KEY_PASSWORD`） |
| `pnpm release`                      | 一键交互式发布（详见 `docs/release-checklist.md`）               |
| `pnpm sync:app-lynx-bundle`         | 同步 app-lynx bundle 到 Android assets（原 `sync:lynx-bundle`）   |
| `pnpm cap:sync`                     | 同步 Web 产物和 Capacitor 配置到 Android 项目                     |
| `pnpm cap:copy`                     | 仅复制 Web 产物到 Android（不更新 Capacitor 配置）                |
| `pnpm cap:open:android`             | 在 Android Studio 中打开 `android/` 项目                          |
| `pnpm deploy` / `deploy:dry`        | 本地预览部署 / 干跑（复制 landing 页面到 `_site/`）              |

其余 `<命令>:<包名>` 变体（如 `preview:website`、`lint:all`、`fmt:app-lynx` 等）按同一约定，完整清单见根目录 `package.json`。

## Monorepo 结构

```
pixivizer/
├── packages/
│   ├── app/                     # pictelio-app — SolidJS SPA 主体
│   │   ├── src/                 # 源码（见下方架构详图）
│   │   ├── android/             # Capacitor Android 原生项目（源码纳入版本控制）
│   │   ├── scripts/             # 构建/发布/android-dev/截图脚本
│   │   ├── assets/              # 静态资源（logo、favicon 等）
│   │   ├── vite.config.ts       # Vite+ 配置（含 UnoCSS、代理、lint、fmt）
│   │   ├── uno.config.ts        # UnoCSS shortcuts（Fluent 风格）
│   │   ├── tsconfig.json        # TypeScript strict 配置
│   │   ├── vitest.config.ts     # Vitest 配置（node 环境单测）
│   │   ├── vitest.agent-browser.config.ts # agent-browser AI 驱动 E2E 配置
│   │   └── capacitor.config.ts  # Capacitor 配置（appId: io.pictelio.app）
│   ├── app-lynx/                # pictelio-app-lynx — vue-lynx 客户端 MVP（登录/推荐/小说/个人中心/引擎切换）
│   │   ├── src/                 # vue-lynx 源码（样式见「app-lynx 样式」约定）
│   │   ├── tests/               # lynx 单测
│   │   ├── scripts/             # sync-android-assets.mjs 等
│   │   ├── lynx.config.ts       # Lynx/Rspack 构建配置
│   │   ├── tailwind.config.ts   # Tailwind（spacing=vw、fontSize=rpx、M3 色板）
│   │   └── postcss.config.js
│   ├── ugoira/                  # @pictelio/ugoira — Ugoira 动图 zip 帧处理纯函数库
│   │   ├── src/                 # fflate 解压 / store 模式 Range 切片
│   │   ├── tests/
│   │   └── package.json
│   ├── update-check/            # @pictelio/update-check — 更新检查共享库（版本比较/version.json 拉取/超时兜底，ADR-0065）
│   │   ├── src/                 # index.ts（webview 与 lynx 双客户端共用）
│   │   ├── tests/
│   │   └── package.json
│   └── website/                 # pictelio-website — Astro 落地页
│       ├── src/                 # Astro 页面源码
│       │   └── pages/           # Astro 路由页面
│       ├── tests/               # 落地页测试
│       ├── version.json         # 版本信息
│       └── package.json
├── scripts/
│   ├── deploy.mjs               # GitHub Pages 本地预览脚本
│   └── kill-dev-server.mjs      # 开发服务器进程管理
├── docs/                        # 项目文档
│   ├── adr/                     # ADR（含 ADR-0059 命令约定，最新到 ADR-0085）
│   ├── agents/                  # Agent 工作流文档（issue-tracker、triage-labels、domain）
│   ├── release-checklist.md
│   ├── release-signing.md
│   ├── platform-compatibility.md
│   └── privacy-policy.md
├── dist/                        # Vite 构建输出
├── openwiki/                    # OpenWiki 生成文档（禁止手改）
├── .github/workflows/
│   ├── deploy.yml               # GitHub Pages 自动部署
│   ├── openwiki-update.yml      # OpenWiki 每日自动更新
│   └── ci.yml                   # CI 检查门禁
├── pnpm-workspace.yaml          # pnpm workspace 配置
├── reasonix.toml                # Reasonix/CodeGraph 插件配置
└── package.json                 # 根 package.json（workspace 委托层）
```

## 架构

```
packages/app/src/
├── api/                # Pixiv API 层
│   ├── auth.ts         # OAuth 认证（iOS 凭证、spark-md5 哈希、password/refresh_token）
│   ├── client.ts       # HTTP 客户端（PixivApiClient 接口、Web fetch / Native 双模式、URL 重写、401 自动刷新防死循环）
│   ├── comment.ts      # 作品评论 API：获取、发送、删除
│   ├── illust.ts       # 作品 API：推荐、关注、下一页、详情、收藏、ugoira 元数据、关注/取消关注用户
│   ├── normalizeQueryError.ts # TanStack Query 错误归一化
│   ├── novel.ts        # 小说 API：详情、系列、搜索
│   ├── pkceAuth.ts     # PKCE 登录流程
│   ├── queryClient.ts  # TanStack Query client 单例 & 默认配置
│   ├── queryKeys.ts    # TanStack Query 查询键工厂
│   ├── search.ts       # 作品/用户搜索 API
│   ├── translate.ts    # 小说 AI 翻译 API
│   ├── types.ts        # 类型定义（PixivIllust、PixivUser、ApiError、PixivAuthResponse 等）
│   ├── user.ts         # 用户 API：详情、关注列表、粉丝列表
│   ├── userAgent.ts    # User-Agent 管理
│   └── _oauthFetch.ts  # OAuth fetch 封装（详情页动态导入）
├── styles/             # CSS 分层（main.tsx 中按序导入）
│   ├── reset.css       # modern-css-reset 定制
│   ├── tokens.css      # Fluent Design System 2 设计令牌（颜色、间距、圆角、阴影、字体、动画曲线/时长）
│   ├── base.css        # 根样式、滚动条、选中色、动画关键帧、reduced-motion
│   └── novel-reader.css # 小说阅读器专属样式
├── types/              # 环境类型声明（env、fluent、spark-md5、window）
├── stores/             # SolidJS 响应式状态（createSignal + createStore 导出）
│   ├── authStore.ts    # 登录状态（isLoggedIn、user、token、自动恢复、onUnauthorized 处理器）
│   ├── backGestureStore.ts # Android 返回手势状态管理
│   ├── blockStore.ts   # 已屏蔽用户 ID 持久化
│   ├── bookmarkStore.ts# 插画收藏状态管理
│   ├── db.ts           # TanStack DB 本地数据库配置（浏览历史持久化）
│   ├── followListStore.ts # 关注/粉丝列表状态
│   ├── followStore.ts  # 关注作品 Feed 状态
│   ├── historyStore.ts # 浏览历史状态（TanStack DB 查询封装）
│   ├── imageHostStore.ts # 自定义图片托管配置状态
│   ├── novelBookmarkStore.ts # 小说收藏状态
│   ├── novelCache.ts   # 小说正文缓存（LRU）
│   ├── novelFollowStore.ts # 关注小说 Feed 状态
│   ├── novelRecommendedStore.ts # 推荐小说 Feed 状态
│   ├── readerSettingsStore.ts # 小说阅读设置（字号、字重、字体、行高、颜色）
│   ├── recommendedStore.ts # 推荐作品 Feed 状态
│   ├── reportStore.ts  # 已举报作品 ID 持久化
│   ├── searchStore.ts  # 搜索状态
│   ├── settingsStore.ts # 设置系统状态
│   ├── shared/         # 共享工厂（createTQFeedStore、createPersistedSet、feedHelpers、novelHelpers）
│   ├── themeStore.ts   # 主题管理（亮/暗/跟随系统）
│   ├── translationStore.ts # 翻译状态
│   ├── uiStore.ts      # UI 状态（当前 Tab、布局模式、R18 开关、设置面板、自动检查更新等）
│   ├── userIllustsStore.ts # 用户作品列表状态
│   └── userStore.ts    # 用户状态
├── routes/             # 页面组件（路由定义在独立的 src/router.tsx）
│   ├── __root.tsx              # 路由根布局（NavBar、页面过渡、主题/年龄确认恢复、全局监听）
│   ├── HomePage.tsx            # 首页（C shell：SideNavShell + 六个 Feed 面板）
│   ├── Login.tsx               # 登录页（refresh_token / 用户名密码 / PKCE）
│   ├── AgeConfirmation.tsx     # 年龄确认页
│   ├── IllustDetail.tsx        # 作品详情（大图查看、多页、动图播放、楼梯式浏览）
│   ├── NovelDetail.tsx         # 小说详情（正文虚拟化、搜索高亮、阅读进度）
│   ├── Search.tsx              # 搜索页（作品/用户/小说）
│   ├── FollowListPage.tsx      # 关注/粉丝列表页（mode=following/followers）
│   ├── PersonalCenter.tsx      # 个人中心 / 用户主页（根据路由参数区分）
│   ├── UserIllusts.tsx         # 用户作品列表页
│   ├── Settings.tsx            # 设置页
│   ├── ClientSwitch.tsx        # 引擎切换信息页（ADR-0064）
│   ├── ScrollRestorationConfirm.tsx # 滚动恢复二次确认
│   ├── ImageHostSettings.tsx   # 图片托管设置页
│   ├── ImageCacheSettings.tsx  # 图片缓存设置页
│   ├── About.tsx               # 关于页
│   ├── DebugImage.tsx          # 图片调试页（无应用内导航入口，E2E 可达，开发诊断用）
│   └── ...
├── components/         # 可复用 UI 组件
│   ├── BlocklistSheet.tsx       # 屏蔽列表面板
│   ├── CommentInput.tsx / CommentList.tsx # 评论输入/列表
│   ├── CommentOverlay.tsx       # 评论浮层组件
│   ├── ErrorDisplay.tsx         # 统一错误展示组件（按 ApiErrorType 渲染操作指引）
│   ├── GridCard.tsx             # 网格模式卡片
│   ├── HeartBurstEffect.tsx     # 收藏爱心爆发效果
│   ├── IllustActionMenu.tsx     # 作品操作菜单
│   ├── IllustTags.tsx           # 作品标签显示组件
│   ├── ImageCard.tsx            # Feed 卡片（含收藏/关注操作、R18 模糊、R18G 遮罩）
│   ├── ImageViewer.tsx          # 全屏图片查看器（缩放/拖拽/滑动翻页）
│   ├── LazyDetailImage.tsx      # 详情页懒加载图片包装
│   ├── LazyImageCard.tsx        # 轻量虚拟化卡片包裹（进入视口才渲染 ImageCard）
│   ├── LoadingSpinner.tsx       # 加载动画
│   ├── NavBar.tsx               # 顶部导航栏（自动隐藏）
│   ├── NovelCard.tsx            # 小说卡片
│   ├── NovelFooterNav.tsx       # 小说底部导航
│   ├── NovelSearchBar.tsx       # 小说搜索栏
│   ├── NovelTextListCard.tsx    # 小说文本列表卡片（纯渲染，无测量）
│   ├── NovelVirtualFeed.tsx     # 小说虚拟滚动 Feed（textList / coverWall）
│   ├── OAuthWebView.tsx         # OAuth 登录 WebView
│   ├── PageTransition.tsx       # 页面过渡动画
│   ├── PictelioIcon.tsx         # 应用图标
│   ├── PixivImage.tsx           # 图片组件（CDN 代理 + 尺寸优化 + 渐进加载）
│   ├── PullIndicator.tsx        # 下拉刷新指示器
│   ├── ReaderSettingsSheet.tsx  # 阅读设置面板
│   ├── ReportSheet.tsx          # 举报面板
│   ├── SearchResults.tsx / SearchableTag.tsx # 搜索结果/可点击标签
│   ├── SeriesSheet.tsx          # 作品系列面板
│   ├── SeriesSheetItem.tsx      # 系列面板条目组件
│   ├── SkeletonCard.tsx / SkeletonShimmer.tsx # 骨架屏卡片/微光
│   ├── StartupUpdateDialog.tsx  # 启动时更新检查弹窗
│   ├── ThemeSelector.tsx        # 主题选择器组件
│   ├── TranslateSheet.tsx       # 翻译面板
│   ├── UgoiraViewer.tsx         # 动图（Ugoira）播放器（@pictelio/ugoira 解压帧）
│   ├── UserAvatar.tsx           # 用户头像组件
│   ├── UserWorksFeed.tsx        # 用户作品瀑布流
│   ├── VirtualFeed.tsx          # 虚拟滚动 Feed 容器
│   ├── home/                    # C shell 专属（SideNavShell、FeedList、IllustSingleCard、NovelRowCard、AdaptiveTags、FeedPaginationSentinel 等）
│   ├── illust/                  # 详情页专属（DetailHeader、DetailCard、BottomActionBar）
│   ├── me/                      # 个人中心专属（Avatar、MenuRow）
│   ├── novel/                   # 小说阅读器专属（NovelTopBar、NovelCoverCard）
│   ├── settings/                # 设置页子组件（SettingsAccount/Appearance/Card/Client/Content/Dialogs/Image/Sections/Translate、LogoutRow）
│   ├── skeletons/               # 骨架屏（IllustDetail/NovelDetail）
│   └── ui/                      # 基础 UI（FluentDialog、FluentIcon、GlassTabBar、HeartIcon、InlineRetryBar、StickySubTabs、TagInput）
├── primitives/         # 底层抽象（无 UI 的逻辑单元）
│   ├── createFastScrollbar.ts    # 快速滚动条原语
│   ├── createFeedVirtualizer.ts  # Feed 虚拟滚动窗口管理
│   ├── createImageSizeWorker.ts  # 图片尺寸 Web Worker 通信封装
│   ├── createManualFetch.ts      # 手动 fetch 封装（AbortController 管理）
│   ├── createNovelSearch.ts      # 小说正文搜索匹配（字符索引）
│   ├── createNovelTextLayout.ts  # 小说正文纯文本布局（pretext）
│   ├── createNovelTranslator.ts  # 小说 AI 翻译流程
│   ├── createNovelVirtualLayout.ts # 小说正文虚拟化窗口管理
│   ├── createPullToRefresh.ts    # 下拉刷新原语（ADR-0076）
│   ├── imageSize.worker.ts       # Web Worker 图片尺寸计算
│   ├── isPretextSupported.ts     # pretext 运行环境检测
│   ├── novelTextLayoutCache.ts   # 小说布局结果 LRU 缓存
│   ├── rootMargins.ts            # 虚拟化 rootMargin 常量
│   ├── scroll/                   # 滚动行为（createScrollBehavior）
│   ├── types.ts                  # 布局类型定义
│   ├── useCardInteractions.ts    # 卡片交互原语
│   ├── useComments.ts            # 评论数据原语
│   ├── useContainerWidth.ts      # 容器宽度响应式 Hook
│   ├── useDetailData.ts          # 详情数据原语
│   ├── usePointerHighlight.ts    # 指针高亮原语
│   ├── useUserProfile.ts         # 用户资料原语
│   ├── viewportWidth.ts          # 视口宽度原语（小说 autoFontSize）
│   └── visibility/               # 可见性/哨兵原语
│       ├── everVisible.ts        # 一次性可见性（基于 @solid-primitives/intersection-observer）
│       ├── index.ts              # 导出
│       └── sentinel.ts           # 哨兵分页原语（基于 @solid-primitives/intersection-observer）
├── native/             # Android 原生桥接（仅原生构建生效，Web 开发环境不加载）
│   ├── PixivApi.ts     # PixivApiPlugin 网关桥（request/syncToken/setAccessToken/prefetchImage）
│   ├── AuthPlugin.ts   # 原生认证插件
│   ├── OAuthPlugin.ts  # OAuth 登录插件
│   ├── ImageCache.ts   # 原生图片缓存
│   ├── ClientInfo.ts   # 客户端信息
│   └── splashBridge.ts # 启动屏桥接
├── services/           # 服务封装
│   ├── backGestureService.ts # Android 返回手势动画服务
│   ├── imageHostService.ts # 自定义图片托管服务
│   └── updateService.ts   # 应用更新检查服务
├── settings/           # 设置系统（index、registry、codecs、types、backends/localStorage|memory|mirrored|preferences）
└── utils/              # 工具函数
    ├── clientSwitch.ts       # 客户端引擎切换
    ├── createDedupedRequest.ts # 去重请求工具
    ├── detectLanguage.ts     # 语言检测
    ├── html.ts               # HTML 处理工具
    ├── imageLoader.ts        # 图片加载与缓存（L1 已加载标记集合、预加载、CDN URL 构建）
    ├── novelBlocks.ts        # 小说段落解析工具
    ├── novelImageDimensions.ts # 小说内嵌图片尺寸提取
    ├── prompts.ts            # AI 翻译提示词
    ├── r18Filter.ts          # R18/R18G 内容过滤
    ├── scrollToTop.ts        # 回顶工具函数
    ├── searchMerger.ts       # 搜索结果合并
    ├── secureStorage.ts      # refresh_token 安全存储（capacitor-secure-storage-plugin）
    ├── themeApplier.ts       # 主题应用工具（同步 Fluent tokens）
    ├── translationCache.ts   # 翻译结果缓存
    └── tryAsync.ts           # async 错误元组封装（tryAsync/trySync）
```

## 关键设计决策

### PixivApiPlugin 网关架构

**架构变更**（ADR-0037）：所有 Pixiv API 请求和图片下载统一由 Java 侧管理。

### API 客户端（PixivApiPlugin）

- **单路径架构**：前端调用 `PixivApi.request()` → Capacitor bridge → `PixivApiPlugin.java` → OkHttp → Pixiv
- **双模式**：Native 走 JSBridge、Web 走 Vite 代理 fetch（`devAccessToken` 编译期保护）
- **access_token**：仅 Java 堆中，JS 零知。DEV 模式的 `devAccessToken` 被 `import.meta.env.DEV` + Oxc minifier 消除
- **401 自动刷新**：Java 侧 `synchronized` + `isRefreshing` 锁，防并发刷新风暴
- **图片预缓存**：Java 侧 `prefetchImage()` 直接写磁盘，零字节进 JS 堆

### 图片流水线（缓存、代理、CDN）

- **三层缓存架构**（ADR-0003 → ADR-0037 修订）：
  - L1：JS 已加载标记集合（`Map<string, number>` LRU，仅 key）
  - L2：WebView / 磁盘缓存（`shouldInterceptRequest` + `ImageCachePlugin`）
  - L3：CDN（`i.pximg.net`，Java 注入 Referer）
- **图片二进制零进 JS 堆**：下载、写盘、读取全在 Java/文件系统/WebView 渲染引擎间流转

### Android 原生增强

- **返回键处理**: Android 返回键通过 `@capacitor/app` 的 `CapApp.addListener("backButton", ...)` 统一处理：关闭查看器/设置、非根路径执行 `navigate(-1)`、根路径双击退出应用。
- **图片代理**: `MainActivity.java` 中 `shouldInterceptRequest` 拦截所有 `/pixiv-img/` 请求，代理到 `i.pximg.net` 并注入正确的 Referer 和 User-Agent 头。
- **原生桥接**: `src/native/` 目录包含 Android 原生通信模块：`PixivApi.ts`（PixivApiPlugin 网关桥）、`AuthPlugin.ts`（原生认证插件）、`OAuthPlugin.ts`（OAuth 登录）、`ImageCache.ts`（原生图片缓存）。
- **插件注册**: 自定义插件在 `MainActivity.java` 的 `onCreate` 中通过 `registerPlugin()` 注册，**必须在 `super.onCreate(savedInstanceState)` 之前**。

### 安全存储

- 使用 `capacitor-secure-storage-plugin` 存储 `refresh_token`（Android Keystore 加密）。
- 首次启动时自动从旧的 `@capacitor/preferences` 迁移 token（一次性）。
- 登录凭证不存储在 Web Storage 或内存中可被轻易读取的位置。

### 虚拟滚动与布局

- **Masonry 瀑布流**: 通过 `createImageSizeWorker.ts` + `imageSize.worker.ts`（Web Worker）异步计算图片尺寸，驱动瀑布流布局，避免阻塞主线程。
- **虚拟滚动**: `createFeedVirtualizer.ts` 计算可见窗口（startIndex/endIndex），仅渲染视口内 + overscan 范围的卡片；`createManualFetch.ts` 管理分页数据请求。
- **布局模式**: 主 Feed（首页）固定 L5 单列布局，布局模式切换器已移除（ADR-0075）；瀑布流（2 列）/单列（1 列）/网格（3 列）仅存于次级 Feed（收藏/用户作品/小说 Feed），可切换并持久化。

### 年龄限制与内容过滤

- 首次启动显示年龄确认页（`/age-confirmation`），未确认前不进入登录流程。
- R18/R18G 内容通过 `r18Filter.ts` 过滤，开关存储在 `Preferences` 中。
- R18 内容在卡片上显示模糊遮罩；R18G 内容显示额外的显式内容警告遮罩。
- `reportStore` 和 `blockStore` 管理用户举报和屏蔽列表，持久化到 `Preferences`。

### 更新检查

- `updateService.ts` 通过 GitHub API 检查最新 release 版本。
- 通过 `/github-api` 代理直连 GitHub（不经过 Pixiv 代理，避免被拦截）。
- 开发者可通过设置面板开关控制自动检查。

### 即时导航硬约束

**硬约束**（违反视为架构违规）：

1. **先渲染、后加载**：用户主动点击进入任何页面/弹窗/详情时，必须先渲染页面框架（含骨架屏占位），再发起数据请求。不允许任何路由级 loader/middleware 以 `await` 网络请求的方式阻塞页面渲染。
2. **全局最优**：任何方案必须从宏观（全局架构）和微观（单个组件）两个角度验证。禁止只优化局部而损害整体。方案须同时满足高可维护性、高性能、高安全性、低内存占用。
3. **竞态防护**：组件内所有异步数据请求必须使用 generation-gate、AbortController 或等效机制防护，防止请求参数变化后旧响应覆盖新数据。
4. **数据层分流**：跨组件共享数据使用全局缓存/去重层；页面独有数据由组件自身管理生命周期。

### 工作流强制规范

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

- **TypeScript strict**：`strict: true`，启用 `noUnusedLocals`、`noUnusedParameters`、`noFallthroughCasesInSwitch`、`verbatimModuleSyntax`。target: ESNext, moduleResolution: bundler
- **组件范式**：SolidJS 函数组件，用 `Component<Props>` 标注类型，默认导出
- **状态管理**：`createSignal` / `createStore` 直接在 store 模块顶层定义并导出，不额外封装
- **路径别名**：`@/` 映射到 `src/`（tsconfig paths + Vite alias）
- **样式与交互**：见「Fluent Design 规范」章节，不得例外
- **app-lynx 样式（Tailwind 硬性约定）**：`packages/app-lynx` 的页面/组件样式**默认优先使用 Tailwind CSS utility**（配置见 `tailwind.config.ts`：spacing=vw 档位、fontSize=rpx 档位、颜色=Material Design 3 语义色板，主名 `primary/secondary/surface/outline/error…`，旧 Fluent 语义名保留为兼容别名，值统一引用 `tokens.css` 的 M3 变量）。禁止新增手写 scoped CSS 实现新样式；现有特殊语义（如 `[lynx:fix]` 的 web-core 防护）用 arbitrary utility 表达（`min-h-[40vw]`、`[max-line:1]`、`leading-[44rpx]` 等）。web-core 预览下禁止使用 rem 单位（Tailwind 默认 rem 已通过顶层替换排除）
- **注释**：中文注释为主，API 层和类型定义处偏英文
- **文件命名**：组件 PascalCase、工具/API/primitives camelCase
- **Lint**: 使用 `vite-plus` 内置 oxlint，配置在 `vite.config.ts` 的 `lint` 字段
  - 插件: `typescript`, `unicorn`, `oxc`
  - categories: correctness=error, suspicious=warn, perf=warn, pedantic/style/restriction/nursery=off
  - 忽略: `dist/`, `android/`, `node_modules/`, `.codegraph/`, 声明文件
  - 测试文件额外启用 vitest 插件，禁用 `no-console` 和 `require-mock-type-parameters`
- **格式化**: 使用 `vite-plus` 内置 oxfmt，配置在 `vite.config.ts` 的 `fmt` 字段
- **Android**：
  - **平台要求**：`minSdkVersion = 28`（Android 9.0），WebView ≥ **85**（2020-08 Chrome/WebView）。详见 `docs/platform-compatibility.md`。
  - `minSdkVersion = 28` 在 `variables.gradle` 中定义（commit `d1ad95c` 自 30 下调）；低于 Android 9 的设备安装时由系统直接拒绝。
  - 启动时 `MainActivity` 通过 `WebView.getCurrentWebViewPackage()` 检测 WebView 主版本号，低于 85 则加载 `res/raw/upgrade.html` 提示用户升级 WebView，不初始化 Capacitor / JS 环境。
  - 项目位于 `packages/app/android/`，源码与关键配置纳入版本控制
  - `android/.gitignore` 负责忽略构建产物（`.gradle/`、`build/` 等）和 Capacitor 自动生成文件（`capacitor.config.json`、`capacitor.settings.gradle`、`app/capacitor.build.gradle`、复制的 `app/src/main/assets/public` 等）
  - 自定义 Capacitor 插件在 `MainActivity.java` 中通过 `registerPlugin()` 注册（**必须在 `super.onCreate()` 之前**）
  - 构建 APK: `pnpm build:android`（Debug）或 `pnpm build:android:release`（Release）
  - `app/build.gradle` 中 versionCode 和 versionName 通过 `scripts/sync-android-version.mjs` 从 `package.json` 同步
  - AGP 9.2.1 + Gradle 9.6.1 + JDK 21 版本锁定决策：Gradle 9.6.1 官方测试覆盖 AGP 9.0~9.3.0-alpha06，AGP 9.2.1 在此范围内。JDK 21 完整支持。详见 `android/build.gradle` 顶部注释。
- **Android 发布签名**：Release 构建使用 `android/app/pictelio-release.keystore`，密码通过环境变量 `PICTELIO_KEYSTORE_PASSWORD` 与 `PICTELIO_KEY_PASSWORD` 注入。Keystore 禁止提交到 git。详细步骤见 `docs/release-signing.md`。
- **Gradle 任务图校验**: `build.gradle` 通过 `gradle.taskGraph.whenReady` 仅在 Release 任务触发时检查签名凭据，Debug 构建不需要环境变量。
- **代理配置**：开发时自动读取 `https_proxy` / `HTTPS_PROXY` / `http_proxy` / `HTTP_PROXY` 环境变量，回退到 `http://127.0.0.1:10808`
- **Node 版本**: 22.22.2+（2026-08 jsdom 30 升级后由 20.19 抬升，见 ADR-0080），包管理器 pnpm 11.9.0（`devEngines` 强制校验）

## 测试

- **框架**: Vitest 4.1，通过 `vite-plus` 的 `vp test` 运行
- **环境**: `node`
- **测试文件位置**:
  - `tests/unit/**/*.test.{ts,tsx}` — 单元测试，按源目录结构组织
  - `tests/agent-browser/specs/**/*.test.ts` — AI 驱动 E2E 测试
  - `src/**/*.test.ts` — 辅助函数/内部模块的就近测试
- **单元测试覆盖**（`tests/unit/`）:
  - `api/` — 13 测试文件（auth、client、client401Retry、client429Retry、comment、illust、novel、pkceAuth、queryKeys、search、translate、user、userAgent）
  - `components/` — 13 文件（顶层 12 + `home/` 1；含 FluentDialog、SideNavShell、IllustSingleCard、ThemeSelector 等）
  - `primitives/` — 11 文件（createFeedVirtualizer、createManualFetch、createNovelSearch、createNovelTranslator、novelTextLayoutCache、useCardInteractions、useComments、useDetailData、createFastScrollbar、createPullToRefresh 等）
  - `routes/` — 2 文件（NovelDetail、ClientSwitch）
  - `scripts/` — 7 文件（release-overwrite、release-utils、changelog、proxy-probe、release-panel、release-uploader、upload-release-assets）
  - `services/` — 2 文件（backGestureService、imageHostService）
  - `settings/` — registry
  - `stores/` — 24 文件（覆盖所有 store + shared）
  - `utils/` — 14 文件（含 `.native.test.ts`）
  - 根测试 — PersonalCenter、router、startup
- **E2E 测试**: 12 个 spec —— agent-browser 6 个（main-flow、sub-flows、translation-flow、update-flow、route-switch-instant、adaptive-tags-240）+ android-e2e 6 个（smoke、client-kind-contract、switch-client-oneway/roundtrip/roundtrip-low/roundtrip-3x）
- `passWithNoTests: true` — 允许空测试文件不报错

### 测试硬约束（违反视为架构违规）

1. **IO 边界测试强制覆盖**：任何从外部数据源读取数据的函数（fetch/HTTP、Preferences、原生桥、JSON 解析）必须同时具备成功路径与失败/降级路径的单元测试。禁止只测纯函数而不测 IO 边界；E2E 无法构造的状态（依赖外部发布、网络时序）由函数测试兜底。
2. **契约测试必须使用真实样例**：跨文件/跨端共享数据契约（JSON 字段名、存储 key、原生桥参数）的测试 mock 必须来自真实数据源（线上文件、插件源码常量、真实响应快照），禁止手写"与实现自洽"的 mock 字段——实现错了 mock 也会全绿，是虚假信心。可参考 `backupRulesConsistency.test.ts` 的从源码提取常量比对模式。
3. **禁止静默降级**：所有降级兜底路径（`?? ""`、`?? null`、catch 后返回默认值）必须输出 `console.warn`（带模块前缀）或显式向上层暴露错误状态。字段缺失 = 契约破坏，必须可见。
4. **重构行为不变约束**：重构 commit 中凡涉及字段名、常量、配置值、默认值的改动，必须检查对应契约测试是否存在（缺失则本次补上），并在 commit message / PR 描述中标注行为变化点。"测试全绿"不构成重构无回归的充分证据。
5. **E2E 覆盖原则**：用户可到达的交互路径应有 E2E 覆盖；依赖外部状态的路径（如更新弹窗需要远端版本更高）通过 `driver.mockFetch()`（页面级 fetch mock）+ `driver.spyOnWindowOpen()` 构造状态后覆盖。agent-browser driver 的 `evaluate` 直接执行 JS（不经 shell），注入脚本必须为单行。

## 部署

- **Website**: GitHub Actions 自动部署 Astro 站点到 GitHub Pages（`.github/workflows/deploy.yml`）
  - 触发: push 到 `main` 分支且改动 `packages/website/**` 或 workflow 文件
  - 构建: `pnpm --filter pictelio-website build`
  - 复制 `version.json` 到构建产物
- **Android APK**: 本地构建，可选通过 `pnpm release`（交互式一键发布）发布到 GitHub Releases
- **本地预览**: `pnpm deploy` 从 `packages/website/` 复制 landing 页面到 `_site/`
- **Release 流程**: 详见 `docs/release-checklist.md`，包含版本号更新、构建、签名、发布到 GitHub Releases 等步骤

## 注意事项

- **路由数据规则**：`@solidjs/router` 无 loader/Suspense，路由级数据由路由组件内获取（`useParams`/`useLocation` + `createEffect` + 手动 fetch 或 TanStack Query 按需查询），不阻塞渲染（遵循「先渲染后加载」硬约束）；组件内局部异步仍使用 `createSignal` + `createEffect` + 手动 fetch（带 AbortController）。`createResource` 不用于路由组件。

## 任务完成前自检

- **工具使用证据**：本次涉及代码理解/架构/文档查询时，是否记录了路由判断与所用工具？（见「工具触发协议」；发现偏差当场沉淀 feedback memory）
- **代码理解优先性**：涉及代码结构、调用链、影响范围分析时，是否优先使用了 CodeGraph？（工具选择见上方速查表）
- **Fallback 合理性**：未用 CodeGraph 时，是否属于允许的例外？（不可用、已知路径读取、非代码搜索等，详见全局 memory `mcp-codegraph-usage.md`）
- **索引健康**：CodeGraph 返回异常时，是否检查了 `codegraph_status` 并考虑重建索引？
- **文档查询优先性**：涉及库/框架/浏览器 API 查询时，是否遵循了「文档查询规范」的优先级链？（优先 Context7 或 MDN，降级见 `mcp-doc-query.md`）
- **OpenWiki 查询优先性**：涉及架构概览、领域概念、集成、测试指南等主题时，是否先查阅了对应的 OpenWiki 页面再深入代码？
- **OpenWiki 文档同步**：修改了 `src/` 或 `packages/` 中的代码后，是否执行了 `pnpm openwiki:update` 来同步文档？
- **IO 边界测试**：本次改动涉及的 fetch/存储/桥接解析函数，成功与失败路径是否都有单元测试？
- **真实样例**：新增/修改的测试 mock 是否来自真实数据结构，而非手写自洽字段？
- **静默降级**：本次改动是否有降级兜底路径（`??`、catch 默认值）？是否打了 warn 或显式暴露错误？
- **Conventional Commits 规范**：提交的 commit message 是否符合 Conventional Commits 格式（`type(scope): description`）？commitlint 会强制校验。

## Notes

- 项目必须符合 Microsoft Fluent Design 风格
- 目录名为 `pixivizer`，但项目名/包名为 Pictelio
- 代码中图片 CDN 通过 `/pixiv-img/` 代理路径访问 `i.pximg.net`，非直连
- 不要在 HTML/CSS/JS 中硬编码 Pixiv CDN URL（`i.pximg.net`、`app-api.pixiv.net`），应使用代理路径
- 路由定义在 `src/router.tsx` 中独立管理，与 `App.tsx` 分离
- 启动编排在 `src/main.tsx`（settings 同步、Fluent 主题、渲染、auth 恢复）与 `routes/__root.tsx`（主题/年龄确认恢复、导航）中完成；`src/startup.ts` 为预留启动钩子（当前为空实现）
- `src/native/` 目录下的原生桥接文件仅 Android 构建时生效，在 Web 开发环境中不加载
- **Conventional Commits**：提交信息必须遵循 Conventional Commits 规范（`type(scope): description`），commit-msg hook 通过 commitlint 强制校验。允许的 type：`feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`

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
- **AI Agent 在提交代码前**（尤其是修改了 `src/` 或 `packages/` 目录中的代码后），应主动执行 `pnpm openwiki:update` 更新文档。
- 如 `pnpm openwiki:update` 执行失败，不阻塞后续操作，但应在回复中提示用户。
- **禁止手动编辑** `openwiki/` 目录下的生成文件。如需更新文档内容，应修改源码后通过 `pnpm openwiki:update` 重新生成。
- 兜底机制：GitHub Actions 定时任务（`.github/workflows/openwiki-update.yml`）每天自动执行 `openwiki --update` 并生成 PR，无需手动触发，也不阻塞本地 commit（pre-commit 已不再执行 openwiki 更新）。
- **CLAUDE.md 已废弃删除**：openwiki 本地更新可能重建该文件，**请勿提交**（CI 已自动清理）。

<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

## Agent skills

### Issue tracker

Issues 托管在 GitHub（`a1121611810/Pictelio`），通过 `gh` CLI 操作。详见 `docs/agents/issue-tracker.md`。

### Triage labels

使用默认 triage 标签词汇表（`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`）。详见 `docs/agents/triage-labels.md`。

### Domain docs

多上下文布局 —— 根目录 `CONTEXT-MAP.md` 指向各上下文的 `CONTEXT.md`。详见 `docs/agents/domain.md`。

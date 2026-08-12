# ADR-0080：依赖升级评估（2026-08 全库盘点）

## 背景

用户发起「分析项目所有的库，看看哪些可以升级」。经 grill-with-docs 会话逐题收敛，任务边界确定为：**产出结构化升级分析（每个库的升级风险 / 收益 / 依赖链）+ ADR + glossary，本次不执行升级**。

盘点手段（2026-08-12 快照）：

- `pnpm outdated -r` 获取全 workspace 可升级清单
- 逐包读取 `package.json` / `tsconfig.json` 核验约束（moduleResolution、types、devEngines）
- 对照官方发布说明评估 major 的破坏性变更
- 范围：5 个 workspace 包（`pictelio-app` / `pictelio-app-lynx` / `@pictelio/ugoira` / `@pictelio/update-check` / `pictelio-website`）的**直接依赖**，不含传递依赖深查

## 决策

### 总体策略

采用**均衡评估**：patch + minor 一律标「建议升级」；major 逐个评估，给出「建议升级 / 暂缓」三档结论与理由。

### 建议升级清单（本次仅记录，不执行）

| 包 | 当前 → 目标 | 类别 | 备注 |
|----|------------|------|------|
| `@capacitor/core` | 8.4.2 → 8.5.0 | minor | 需 `cap:sync` + Gradle 重建 |
| `@capacitor/android` | 8.4.2 → 8.5.0 | minor | 同上，涉及 Android 原生工程 |
| `@capacitor/cli` | 8.4.2 → 8.5.0 | minor | dev |
| `vite` | 8.1.5 → 8.2.1 | minor | dev |
| `vite-plus` | 0.2.6 → 0.2.8 | minor | dev，vite-plus 为内部封装（vite+oxlint+oxfmt+vitest） |
| `unplugin-auto-import` | 21.0.0 → 21.1.0 | minor | dev |
| `agent-browser` | 0.31.1 → 0.34.0 | minor | dev，AI 驱动 E2E 工具链 |
| `@fluentui/web-components` | 3.0.2 → 3.0.3 | patch | |
| `@tanstack/solid-virtual` | 3.13.35 → 3.13.36 | patch | |
| `vite-plugin-solid` | 2.11.13 → 2.11.14 | patch | dev |
| `happy-dom` | 20.11.1 → 20.11.2 | patch | dev |
| `@types/node` | 26.1.1 → 26.2.0 | patch | dev（app / app-lynx） |
| **`jsdom`** | 29.1.1 → **30.0.1** | **major（唯一放行）** | dev-only，见「专项决策」 |
| `astro` | 7.2.x | minor | **无需操作**——已解析到最新（outdated 显示 wanted 7.1.3 但实际安装 7.2.1 ≥ latest 7.2.0，属 registry dist-tag 展示差异） |

### 暂缓清单（major / 工具链，保持 T1 锁定）

| 包 | 当前 → 最新 | 包 | 暂缓理由 |
|----|------------|-----|---------|
| `typescript`（app） | 6.0.3 → 7.0.2 | app / ugoira / update-check | Go 原生重写（Corsa）刚发布（2026-07-08），工具链生态未跟上；app 的 tsconfig 未声明 `types`，TS7 默认 `[]` 会丢环境类型（需补 `"types": ["node"]`）；vite-plus / agent-browser 兼容性未验证 |
| `typescript`（lynx 等） | 5.9.3 → 7.0.2 | lynx / ugoira / update-check | 同上；且 Go 编译器**不支持语言插件**，`vue-lynx/types/volar-plugin` 及 `.vue` 类型检查存在不确定性（Vue 系官方亦提示暂缓） |
| `tailwindcss` | 3.4.19 → 4.3.3 | app-lynx | v4 为 Rust 引擎 + CSS-first 配置重构；`rsbuild-plugin-tailwindcss` 0.2.x 与 `@lynx-js/tailwind-preset` 是否支持 v4 未确认；lynx 非浏览器渲染引擎对 v4 依赖的现代 CSS（`@property`/`color-mix`）支持存疑 |
| `vue-router` | 4.6.4 → 5.2.0 | app-lynx | 官方称对标准 v4 用户零破坏变更，但用户决策暂缓，与 lynx 批次保持一致 |
| `@rsbuild/plugin-vue` | 1.2.9 → 2.0.1 | app-lynx | major，工具链批次 |
| `@lynx-js/rspeedy` | 0.13.6 → 0.16.3 | app-lynx | 0.x 工具链，批次 |
| `@lynx-js/web-core` | 0.23.1 → 0.24.0 | app-lynx | **`minimumReleaseAgeExclude` 的 T1 决策锁定保持不变**（PoC 已验证版本） |
| `vue` | 3.5.40 → 3.5.41 | app-lynx | patch，但归入 lynx 冻结批次 |
| `@lynx-js/tailwind-preset` | 0.5.0 → 0.5.1 | app-lynx | patch，同上 |
| `@fluentui/tokens` | 1.0.0-alpha.23 | app | **维持 exact alpha.23 锁定**：alpha 预发布无实质收益；9.x experimental 线（latest 展示）非目标，忽略 |

### 专项决策

- **jsdom 30.0.1 放行 + `devEngines` 下限同步提升**：jsdom 30 唯一破坏性变更为 Node 最低版本 `^22.22.2 || ^24.15.0 || >=26.0.0`。环境已兼容（本地 Node v24.18.0；CI `setup-node` node-version 22 解析到最新 22.x ≥ 22.22.2），且为纯 dev 测试依赖。但根 `package.json` 的 `devEngines.node` 目前声明 `>=20.19`，**升级 jsdom 时必须同步提到 `>=22.22.2`**，否则破坏 devEngines 契约。
- **T1 锁定不解除**：`pnpm-workspace.yaml` 中 `@lynx-js/web-core@0.23.1` 与 `@lynx-js/web-worker-rpc@0.23.1` 的 `minimumReleaseAgeExclude` 豁免继续生效。

## Considered Options

- **TypeScript 7 全部暂缓（采纳）** vs 全部升级 / app 单独升级：TS7 收益（~10x 类型检查提速）对 `pnpm check`/CI 实打实，但 2026-07-08 才稳定，Vue/Svelte/Astro 类框架官方提示暂缓；lynx 依赖 `vueCompilerOptions` 语言插件，Go 编译器不支持。用户决策：**等生态跟上**。
- **tailwindcss 4 暂缓（采纳）** vs `@config` 兼容模式先行 / 完整迁移 `@theme`：lynx 的定制 `tailwind.config.ts`（spacing=vw、fontSize=rpx、M3 色板）迁移成本高，且工具链（rsbuild 插件、lynx preset）未确认支持 v4，渲染引擎对现代 CSS 支持存疑。
- **vue-router 5 暂缓（采纳）** vs 建议升级 / 升级并迁移 `next()` 守卫：官方明示零破坏、一行 bump，但用户为保持 MVP 稳定统一暂缓，为 v6（ESM-only、移除 deprecated API）的迁移留待专项。
- **jsdom 30 建议升级（采纳）** vs 暂缓 / 升级不动 devEngines：dev-only 依赖 + 环境已兼容，成本最低；不升级则一直停在 29.x 线。devEngines 不同步提升属破坏契约的静默降级，否决。
- **@fluentui/tokens 维持 alpha.23（采纳）** vs 跟进 alpha.24：alpha 预发布无稳定契约，9.x experimental 线非本项目（Fluent 2）目标。

## Consequences

- 后续如需执行升级，按「建议升级清单」分批进行；**jsdom 30 与根 `devEngines` Node 下限提升必须同批提交**（IO 边界/契约变更）。
- 暂缓项各自有明确的再评估触发条件：
  - TS7：`vite-plus` / `agent-browser` 声明支持、app 补 `"types": ["node"]` 改造就绪后单独评估；
  - tailwind 4：`rsbuild-plugin-tailwindcss` 与 `@lynx-js/tailwind-preset` 支持 v4 后评估；
  - lynx 批次：下次 lynx 版本规划（或 PoC 需要）时一并评估，web-core 0.24 需同时修订 `minimumReleaseAgeExclude`。
- 本次为纯分析 + 决策记录，无代码改动，无 IO 边界测试影响。

## 补充：lynx peer 警告消解（2026-08 执行清单后）

**背景**：`pnpm peers check` 报两条警告——`@lynx-js/web-core@0.23.1` 声明 peer `css-serializer@0.1.7`（实际解析 0.1.5）；`@lynx-js/css-extract-webpack-plugin@0.7.1` 声明 peer `template-webpack-plugin@^0.11.0`（实际 0.10.9）。后者为 `template-webpack-plugin@0.10.9` 发版时的上游 packaging 不一致（其自身依赖的 css-extract 反而要求更新版本的自身）。

**决策**：在 `pnpm-workspace.yaml` 增加 `overrides` 强制对齐两个传递依赖版本，**不触碰 T1 锁定的 `web-core@0.23.1`**：
- `@lynx-js/css-serializer@0.1.7`（= web-core 0.23.1 的 devDep/peer 声明版本，lynx 上游测试矩阵）
- `@lynx-js/template-webpack-plugin@0.11.0`（= css-extract 0.7.1 的 peer 声明版本及其 devDep 配对）

**验证**：`pnpm peers check` 清零；`build:app-lynx`（bundle 体积不变）、`check:app-lynx`、`test:app-lynx`（260 项）全通过。

## 补充：capacitor 原生侧 cap:sync + Gradle 重建（2026-08 执行清单后）

**背景**：`@capacitor/core/android/cli` 由 8.4.2 → 8.5.0 后，Android 原生工程仍引用旧版本（`capacitor.settings.gradle` 指向 `@capacitor+android@8.4.2`），需执行 `cap:sync` 重新生成并 Gradle 重建验证。

**执行**：
1. `pnpm cap:sync` —— 重新生成 `capacitor.settings.gradle`，4 个插件全部指向 8.5.0（`@capacitor+android@8.5.0_@capacitor+core@8.5.0`、`app@8.1.1`、`device@8.0.3`、`preferences@8.0.1`）。
2. `pnpm build:android` 全链 —— sync:android-version → sync:credentials → web build（801 modules）→ lynx bundle（243 kB）→ sync-android-assets → cap:sync → `./gradlew assembleDebug`。

**验证**：Gradle `BUILD SUCCESSFUL in 12s`（275 tasks：128 executed、30 from cache、117 up-to-date）；三个 flavor 的 debug APK（full/lynx/webview）均在本次构建时间戳重新生成。Java 侧仅有既存的 varargs/deprecation 警告，无错误。

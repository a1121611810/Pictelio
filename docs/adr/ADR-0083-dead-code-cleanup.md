# ADR-0083：死代码清理（Dead Code Cleanup）

## 状态

已接受（2026-08-14）

## 背景

`docs/research/dead-code-analysis.md` 对 pictelio monorepo 全包做了死代码审计，发现：16 个零引用源文件、4 个死引用链路由面板、10 个未使用导出、1 个未使用依赖、8 个未接线脚本、5 个未引用资产、约 50 个导出但从未被导入的类型/常量。

全部死代码均被 Vite/Rollup tree-shaking 从生产 bundle 消除（`dist/assets/*.js` 逐一验证 0 命中），**运行时影响为零**；代价是维护负担：死文件继续被 `pnpm check` 扫描、继续接收无关修复提交（如 `8014f05` 顺带修改死组件 `FollowFeed.tsx`）、并误导阅读者（AGENTS.md 与多份 ADR 仍把旧组件描述为"在用"）。

**根因**：

1. 首页 C shell 改版（ADR-0075）未删旧 Feed 组件群（`RecommendedFeed`/`FollowFeed`/`BookmarksFeed`/`HistoryFeed` 等）；
2. 滚动原语合并（ADR-0023）后**未执行 ADR 中"删除原 3 个文件"的步骤**（`createScrollDirection.ts`/`createScrolledPast.ts`/`createScrollDrivenVisibility.ts`）；
3. 骨架屏（`FeedSkeleton`/`GridSkeleton`/`ListSkeleton`/`ProfileSkeleton`）被新实现取代后遗留；
4. 年龄确认由路由页（`AgeConfirmation`）承担后，组件 `AgeGate` 遗留。

## 决策

### 决策 1：删除高置信死代码（全部经子代理独立复核 + 生产 bundle 交叉验证）

**16 个零引用源文件 + 4 个死引用链路由面板：**

| 类别 | 文件 |
|------|------|
| 首页旧 Feed 组件群 | `components/RecommendedFeed.tsx`、`FollowFeed.tsx`、`BookmarksFeed.tsx`、`HistoryFeed.tsx`、`CollapsedHeader.tsx`、`AgeGate.tsx` |
| 废弃骨架屏 | `components/skeletons/FeedSkeleton.tsx`、`GridSkeleton.tsx`、`ListSkeleton.tsx`、`ProfileSkeleton.tsx` |
| 滚动原语（ADR-0023 补执行） | `primitives/createScrollDirection.ts`、`createScrolledPast.ts`、`createScrollDrivenVisibility.ts`、`primitives/scroll/index.ts` |
| 其他 | `primitives/measureText.ts`、`primitives/createNovelLoader.ts` |
| 死引用链路由面板 | `routes/IllustBookmarks.tsx`、`NovelBookmarks.tsx`、`NovelFollowFeed.tsx`、`NovelRecommendedFeed.tsx` |

**9 个未使用导出**（删除符号本体；§2.10 的类型/常量仅去 `export` 关键字、保留符号）：

- `api/novel.ts`：`fetchNovelText`（app 侧，零调用）
- `utils/imageLoader.ts`：`stopPeriodicGC`、`clearCacheWithFilter`、`clearCacheForPrefix`、`CacheMemoryStats` + `getMemoryUsage`
- `primitives/novelTextLayoutCache.ts`：`setNovelTextLayoutCache`（`@deprecated` 旧命名）
- `stores/searchStore.ts`：`clearSearchCache`（含 `export { clearSearchCache }`）
- `services/imageHostService.ts`：`getEffectiveImageUrlAsync`（在用为同步 `getEffectiveImageUrl`）
- `api/client.ts`：`pickBestErrorType`

> 注：初版报告 §2.3 共列 10 项，其中 app-lynx `api/novel.ts` 的 `fetchNovelText` 经复核**被 `pages/NovelDetail.vue:38` 生产调用**（初版只搜 `.ts/.tsx` 漏了 `.vue`），**不删除**。

**1 个未使用依赖**：`@capacitor/device`（src/tests/scripts/原生代码全仓零引用；`android/` 的 `capacitor.plugins.json` 为 `cap sync` 生成物、被 gitignore，不阻塞移除）。

**8 个未接线脚本**：

- `scripts/capture-real.mjs`、`capture-screenshots.mjs`、`capture-website-screenshots.mjs`、`check-props-setter-mapping.mjs`、`cleanup-auto-imports.mjs`、`generate-screenshots.mjs`、`release-github.mjs`（DEPRECATED，P11）
- `packages/app-lynx/scripts/e2e-first-frame.mjs`、`e2e-me-scroll.mjs`

**未引用资产**（高置信 3 个）：

- `assets/logo/pictelio-login-icon.svg`、`assets/logo/pictelio-logo-light.svg`、`website/public/logo.png`

### 决策 2：保留项与理由

| 项目 | 决策 | 理由 |
|------|------|------|
| §2.6 仅测试引用（`GlassTabBar`、`createManualFetch`、`useDetailData`、`exchangeCode`） | **保留** | 仓库规则"测试即消费者"——测试对符号的引用视为合法消费，不算死代码；删除需连同测试一起删，收益低、风险高 |
| §2.7 `@rsbuild/plugin-vue`（app-lynx） | **保留** | vue-lynx 的**必需** peer 依赖（`optional: false`），移除会导致 pnpm peer 缺失报错 |
| §2.8 低置信资产（`logo-512x512.png`、`privacy-policy.html`） | **保留** | 可能为 PWA/应用商店/WebView 预留 |
| §2.9 `/debug` 路由（`DebugImage`） | **保留** | 开发诊断页；无应用内导航入口但有 agent-browser E2E 覆盖（`sub-flows.test.ts:887`），启动重定向（`__root.tsx:170-179`）下真实用户不可达，E2E 经 `navigateSpa` pushState 可达 |
| §2.11 `src/startup.ts` | **保留** | 文档注明"预留启动钩子"，被 `main.tsx:34` 实际调用 |
| `scripts/lib/*` 全部 + `@resvg/resvg-js` | **保留** | `release.mjs`/`release-overwrite.mjs` 在用并引用 lib；`generate-icons.mjs` 使用 resvg |

### 决策 3：§2.10 类型/常量去 export、保符号

约 50 个导出但从未被导入的类型/常量（组件 Props、原语类型、状态/服务类型、API 类型、native 桥类型等），删除 `export` 关键字（符号在定义模块内被签名/类型推导使用，本体保留）。典型代表：`CommentInputProps`、`PullZone`、`FeedVirtualizerConfig`、`NovelNavItem`、`TRANSLATE_MODELS`（值仅用于 `typeof` 推导）、`defaultTransport`（仅作默认参数）等。

### 决策 4：文档同步

- `AGENTS.md` 架构图：移除已删组件/原语条目，更新 `skeletons/` 描述；
- `openwiki/` 由 `pnpm openwiki:update` 重新生成（禁止手改）；
- 历史 ADR（ADR-0041/0043/0073/0082、glossary-ui-cards.md）保留原文，作为历史决策记录；
- 新增本 ADR 与 `glossary-dead-code-cleanup.md`（死代码治理术语表）。

### 决策 5：全量回归门禁

删除后必须全量过测试：`pnpm check` + `pnpm test:all` + agent-browser E2E（6 specs）+ **Android 模拟器 E2E（6 specs，pictelio_ui 全量 + pictelio_low 降级）**。

## Considered Options

### 死代码的处理方式

| 方案 | 评估 |
|------|------|
| **删除（采用）** | 消除维护负担与文档误导；全部经引用计数 + bundle 交叉验证，运行时影响为零 |
| 保留并加注释 | 死文件仍被 `pnpm check` 扫描、仍会接收无关修复提交，维护负担不消除 |
| 用 knip 等工具自动化 | 仓库未安装 knip；手动引用计数 + 子代理复核已达同等置信 |

### §2.6 仅测试引用项

| 方案 | 评估 |
|------|------|
| **保留（采用）** | 测试即消费者；删除需连测试删，收益低 |
| 连同测试删除 | 缩小 API 面，但 `pkceAuth.exchangeCode` 等可能为未来 PKCE 流程保留 |

### `@rsbuild/plugin-vue`

| 方案 | 评估 |
|------|------|
| **保留（采用）** | vue-lynx 必需 peer（`optional: false`），移除破坏安装 |
| 移除 | pnpm peer 缺失报错，构建链路破坏 |

## Consequences

### 正面

- 消除 20 个死文件 + 8 个未接线脚本 + 9 个死导出 + 1 个死依赖 + 3 个死资产的维护负担；
- 补执行 ADR-0023 未完成的"删除原 3 个文件"步骤；
- AGENTS.md 架构图与 openwiki 与真实代码一致；
- `pnpm check` 扫描面缩小（373 文件 → 更少），后续 lint 噪音降低。

### 负面 / 注意

- 死代码可从 git 历史找回（`git log` / `git show`），无需担心不可逆；
- `clearCacheWithFilter`/`clearCacheForPrefix`/`getMemoryUsage` 等若未来需要缓存管理 UI，需从 git 恢复；
- app-lynx `fetchNovelText` **不在删除范围**（被 `NovelDetail.vue` 生产调用；初版报告误判，已修正）。

### 测试

- 删除后全量回归：`pnpm check` + `pnpm test:all` + agent-browser E2E + Android 模拟器 E2E；
- 无新增行为变更，测试应保持全绿。

## 相关链接

- 分析报告: `docs/research/dead-code-analysis.md`
- 术语表: `docs/adr/glossary-dead-code-cleanup.md`
- 前置 ADR: ADR-0023（滚动原语统一）、ADR-0075（首页 C shell）、ADR-0061（Android 模拟器 E2E 门禁）

# 死代码分析报告（Dead Code Analysis）

> 日期：2026-08-14（按仓库文件时间推断，实际分析于当日）
> 范围：pictelio monorepo 全包（`pictelio-app` / `pictelio-app-lynx` / `@pictelio/ugoira` / `@pictelio/update-check` / `pictelio-website`）
> 方法：主代理引用计数扫描 + 后台研究代理全量复核，全部发现经 grep 交叉验证、生产 bundle（`dist/`）核对、git 历史/ADR 佐证；未修改任何源码

---

## 0. 基线

- `pnpm check`（app：oxfmt + oxlint + `tsc --noEmit`）**通过**：373 文件格式正确、0 lint 错误、0 类型错误。
- tsconfig 启用 `noUnusedLocals` / `noUnusedParameters`（strict），**单文件内未使用局部变量在编译期即被拦截**。
- 因此本报告聚焦 TypeScript 不检查的跨模块死代码：未引用文件、未使用导出、未使用依赖、未接线脚本、死路由、死代码链。

## 1. 结论摘要

- **高置信：16 个零引用源文件**（§2.1）+ **4 个死引用链路由面板**（§2.2）+ **10 个未使用导出**（§2.3）+ **1 个未使用依赖**（§2.4）+ **8 个未接线脚本**（§2.5）。
- **中置信：4 个仅测试引用的文件/导出**（§2.6）+ 1 个疑似依赖（§2.7）。
- **未引用资产 5 个**（§2.8）；**死路由可达性 1 处**（§2.9）；**导出但从未导入的类型/常量约 50 个**（§2.10，分组处理）。
- **运行时影响为零**：全部死代码均被 Vite/Rollup tree-shaking 从生产 bundle 消除（`dist/assets/*.js` 逐一验证 0 命中）。
- **代价是维护负担**：死文件继续被 `pnpm check` 扫描、继续接收无关修复提交（如 `8014f05` 顺带改 `FollowFeed.tsx`）、并误导阅读者（AGENTS.md 与多份 ADR 仍把旧组件描述为"在用"）。
- **根因**：首页 C shell 改版（ADR-0075）未删旧 Feed 组件群；滚动原语合并（ADR-0023）后**未执行 ADR 中"删除原 3 个文件"的步骤**；骨架屏/年龄确认被新实现取代后遗留。

## 2. 发现清单

### 2.1 高置信：完全未引用的源文件（16 个）

判定：全仓（src/tests/scripts/各包/配置文件）无任何 import/require/动态导入引用，仅自身定义与注释/文档提及。

**首页旧 Feed 组件群（C shell 改版 ADR-0075 遗留，commit `baebb6d`）**

| # | 文件 | 证据 | 建议 |
|---|------|------|------|
| 1 | `components/RecommendedFeed.tsx` | 零 import；仅 `.handoff.md`/ADR/AGENTS.md 提及 | 删除 |
| 2 | `components/FollowFeed.tsx` | 零 import；注意 `8014f05`（2026-08-13）仍顺带修改它，属惯性维护 | 删除 |
| 3 | `components/BookmarksFeed.tsx` | 零 import；它引用了 §2.2 的 `IllustBookmarks`/`NovelBookmarks` | 删除 |
| 4 | `components/HistoryFeed.tsx` | 零 import | 删除 |
| 5 | `components/CollapsedHeader.tsx` | 121 行，零 import；仅 AGENTS.md:323、design doc、ADR-0024/0035 提及 | 删除（如需可从 git 找回） |
| 6 | `components/AgeGate.tsx` | 零 import；年龄确认已由 `routes/AgeConfirmation.tsx`（router.tsx:42）承担 | 删除 |

**废弃骨架屏（被 `skeletons/IllustDetailSkeleton`/`NovelDetailSkeleton` 等新实现取代）**

| # | 文件 | 证据 | 建议 |
|---|------|------|------|
| 7 | `components/skeletons/FeedSkeleton.tsx` | 零引用 | 删除 |
| 8 | `components/skeletons/GridSkeleton.tsx` | 零引用 | 删除 |
| 9 | `components/skeletons/ListSkeleton.tsx` | 零引用 | 删除 |
| 10 | `components/skeletons/ProfileSkeleton.tsx` | 零引用 | 删除 |

**滚动原语（ADR-0023 明确要求删除但从未执行；commit `634f184` 已合并为 `scroll/createScrollBehavior`，消费者 NavBar.tsx:5 等直接 import 之）**

| # | 文件 | 证据 | 建议 |
|---|------|------|------|
| 11 | `primitives/createScrollDirection.ts` | 零 import；`docs/adr/ADR-0023-unify-scroll-primitives.md:87` 原文"**5. 删除原 3 个文件（createScrollDirection.ts、createScrolledPast.ts、createScrollDrivenVisibility.ts）**" | 删除（铁证） |
| 12 | `primitives/createScrolledPast.ts` | 零 import；仅 scroll/index.ts:4 注释提及 | 删除 |
| 13 | `primitives/createScrollDrivenVisibility.ts` | 零 import | 删除 |
| 14 | `primitives/scroll/index.ts`（barrel） | 零 import；所有消费者直接 import `createScrollBehavior` | 随 11–13 删除 |

**其他**

| # | 文件 | 证据 | 建议 |
|---|------|------|------|
| 15 | `primitives/measureText.ts` | 零 import；其余 "measureText" 命中均为 Canvas API 注释（createNovelTextLayout.ts:141/179、isPretextSupported.ts:13） | 删除 |
| 16 | `primitives/createNovelLoader.ts` | 零引用（小说加载已由 createNovelVirtualLayout/createNovelTextLayout 等承担） | 删除 |

### 2.2 高置信：死引用链（4 个路由面板组件）

以下 4 个文件**被引用，但引用者全部是 §2.1 的死组件**，整体不可达；且未注册进 `router.tsx`：

| 文件 | 唯一引用来源 |
|------|-------------|
| `routes/IllustBookmarks.tsx` | `components/BookmarksFeed.tsx:3`（死） |
| `routes/NovelBookmarks.tsx` | `components/BookmarksFeed.tsx:4`（死） |
| `routes/NovelFollowFeed.tsx` | `components/FollowFeed.tsx:18`（死） |
| `routes/NovelRecommendedFeed.tsx` | `components/RecommendedFeed.tsx:19`（死） |

删除时与 §2.1 的 #1~#4 一起处理。

### 2.3 高置信：未使用导出（10 个，全仓含 tests 零调用）

| # | 位置 | 符号 | 证据 |
|---|------|------|------|
| 1 | `api/novel.ts:102` | `fetchNovelText` | app 包内零调用 |
| 2 | `packages/app-lynx/src/api/novel.ts:70` | `fetchNovelText` | 仅 `client.ts:24` 注释提及，零调用 |
| 3 | `utils/imageLoader.ts:88` | `stopPeriodicGC` | 同文件 :27 调 `schedulePeriodicGC` 但从不调 stop |
| 4 | `utils/imageLoader.ts:101` | `clearCacheWithFilter` | 零调用 |
| 5 | `utils/imageLoader.ts:113` | `clearCacheForPrefix` | 零调用 |
| 6 | `utils/imageLoader.ts:121`+`:132` | `CacheMemoryStats` + `getMemoryUsage` | 零调用 |
| 7 | `primitives/novelTextLayoutCache.ts:135` | `setNovelTextLayoutCache` | 自带注释 `@deprecated 仅用于兼容旧命名`；在用为 `getNovelTextLayoutCache`（:125） |
| 8 | `stores/searchStore.ts:88`+`:96` | `clearSearchCache` | 唯一"使用"即 :96 的 `export { clearSearchCache }` 本身 |
| 9 | `services/imageHostService.ts:149` | `getEffectiveImageUrlAsync` | 零调用；在用为同步版 `getEffectiveImageUrl`（:104，被 imageLoader.ts 引用） |
| 10 | `api/client.ts:147` | `pickBestErrorType` | 零调用；错误归一化现走 normalizeQueryError/toApiError |

### 2.4 高置信：未使用依赖（1 个）

| 位置 | 依赖 | 证据 | 建议 |
|------|------|------|------|
| `packages/app/package.json` | `@capacitor/device` | src/tests/scripts/配置全仓零引用（`Device.*` 也无） | 移除 |

### 2.5 高置信：未接线脚本（8 个，package.json/CI 全零引用）

| # | 脚本 | 证据 |
|---|------|------|
| 1 | `packages/app/scripts/capture-real.mjs` | `import { chromium } from "playwright"`，但 **playwright 不在任何 package.json**，当前依赖下无法运行 |
| 2 | `packages/app/scripts/capture-screenshots.mjs` | 同上（:12 import playwright） |
| 3 | `packages/app/scripts/capture-website-screenshots.mjs` | 零引用 |
| 4 | `packages/app/scripts/check-props-setter-mapping.mjs` | 零引用 |
| 5 | `packages/app/scripts/cleanup-auto-imports.mjs` | 零引用 |
| 6 | `packages/app/scripts/generate-screenshots.mjs` | 零引用（⚠️ `@resvg/resvg-js` 仍被 generate-icons.mjs 使用，依赖**须保留**） |
| 7 | `packages/app/scripts/release-github.mjs` | `docs/github-release.md:3` 明示 **DEPRECATED（P11）**；仍 import `lib/changelog.mjs`/`lib/release-utils.mjs`（lib 其余文件全在用，**勿删 lib**） |
| 8 | `packages/app-lynx/scripts/e2e-first-frame.mjs`、`e2e-me-scroll.mjs` | 零引用（仅 .scratch 提及 first-frame） |

> 另注：`lynx-device-check.sh`/`lynx-flow-check.sh`/`lynx-screen-analyze.py` 仅在 ADR/文档中被描述为手动开发工具，未接线——建议归入"文档化手动工具"而非死代码。

### 2.6 中置信：生产未使用、仅被自身测试引用（4 个）

按仓库规则"测试即消费者"不算死，但值得人工决定去留：

| 位置 | 符号 | 证据 |
|------|------|------|
| `components/ui/GlassTabBar.tsx` | `GlassTabBar` | 唯一引用 `tests/unit/components/GlassTabBar.test.tsx:4`；NavBar.tsx:53、usePointerHighlight.ts:7 仅注释提及 |
| `primitives/createManualFetch.ts` | `createManualFetch` | 唯一引用 `tests/unit/primitives/createManualFetch.test.ts:2`；AGENTS.md 描述过时（分页现由 createFeedVirtualizer/createTQFeedStore 承担） |
| `primitives/useDetailData.ts` | `useDetailData` | 唯一引用 `tests/unit/primitives/useDetailData.test.ts:3`；IllustDetail.tsx 无任何使用 |
| `api/pkceAuth.ts:43` | `exchangeCode` | 唯一引用 `tests/unit/api/pkceAuth.test.ts:59/74/110`；生产登录走 `authStore.loginWithPKCE:173 → auth.exchangeCodeForToken`（auth.ts:64）。注：`native/OAuthPlugin.ts` 的 `exchangeCode` 是原生插件同名方法，与本导出无关 |

### 2.7 中置信：疑似未使用依赖（1 个，需人工确认）

| 位置 | 依赖 | 说明 |
|------|------|------|
| `packages/app-lynx/package.json` | `@rsbuild/plugin-vue` | 代码/配置未直接 import（`lynx.config.ts` 用 `vue-lynx/plugin`）；可能是 vue-lynx 的 peer 依赖，移除前确认 pnpm 不报 peer 缺失 |

### 2.8 未引用资产（5 个）

| # | 资产 | 置信 | 证据 |
|---|------|------|------|
| 1 | `packages/app/assets/logo/pictelio-login-icon.svg` | 高 | 全仓零引用 |
| 2 | `packages/app/assets/logo/pictelio-logo-light.svg` | 高 | 全仓零引用 |
| 3 | `packages/website/public/logo.png` | 高 | 零运行时引用；唯一 "logo.png" 命中是 docs/image-loading-pipeline.md:293 的 Pixiv CDN URL 文本 |
| 4 | `packages/app/public/logo-512x512.png` | 低 | 仅被 generate-icons.mjs:36 生成，index.html 未引用；可能为 PWA/OG 预留 |
| 5 | `packages/app/public/privacy-policy.html` | 低 | app 源码/website 均无链接（docs/release-checklist.md、AGENTS.md 提及）；可能为应用商店/WebView 预留 |

### 2.9 死路由可达性（低置信，需人工确认）

| 路由 | 说明 |
|------|------|
| `/debug`（router.tsx:33 → `routes/DebugImage.tsx`） | 无应用内导航入口；`__root.tsx:170-179` 启动流程把所有非 /home、非 /login 路径强制重定向，真实用户无法到达；仅 E2E 经 `driver.navigateSpa`（driver.ts:65-78，pushState 绕过启动流程）可达。开发诊断页，**建议保留**但可加注 |

### 2.10 低置信：导出但从未被导入的类型/常量（约 50 个，分组条目）

**删除 `export` 关键字安全，删除符号本体不安全**——均在定义模块内被签名/类型推导使用。典型代表（symRefs=0 含 tests）：

- 组件 Props：`CommentInputProps`、`CommentListProps`、`OAuthWebViewProps`、`PictelioIconProps`、`FeedListSource`/`FeedListProps`、`SettingsSectionsProps`、`HeartIconProps`
- 原语类型：`PullZone`（PullIndicator）、`FastScrollbar`/`PointerLike`/`FastScrollbarOptions`、`FeedVirtualizerConfig`/`Result`、`NovelSearchOptions`、`LineRange`/`NovelTextLayoutInput`、`TranslateNovelOptions`/`ChunkRange`/`ChunkProgress`、`CreateNovelVirtualLayoutOptions`/`NovelVirtualLayoutResult`、`PullToRefresh`/`PullToRefreshOptions`、`CardInteractions`、`UseUserProfileResult`、`GlassTabVariant`、`VisibleTags`/`CHIP_GAP`/`MIN_PARTIAL_WIDTH`（adaptiveTagFit.ts:15/17/19）
- 状态/服务类型：`HostInput`、`ImageHostMode`、`ReportRecord`、`SearchStoreState`、`ErrorStrategy`、`TranslationProgress`/`RestrictPolicy`、`SwitchOutcome`、`DetectedLang`、`LoadedImage`/`LoadProgress`/`LoadImageResultWithProgress`、`PageBreakBlock`、`TranslationPromptOptions`、`TranslationCacheEntry`
- API 类型：`NovelNavItem`（api/types.ts:95）、`NovelImageItem`/`NovelImageSize`（api/novel.ts:23）、`TranslateMessage`/`TranslateRequestPayload`/`TranslateResult`/`TranslateErrorCode`/`HttpResponseLike`/`Transport`（api/translate.ts）
- native 桥类型：`OAuthStartOptions`/`OAuthStartResult`/`OAuthExchangeOptions`/`OAuthExchangeResult`/`AuthRefreshResult`/`AuthRefreshOptions`/`ClientInfoPlugin`
- 特殊：`api/translate.ts:20` `TRANSLATE_MODELS`（值仅用于 :21 `typeof` 推导 `TranslateModel`，运行期从未迭代——export 可去，**常量须留**）；`api/translate.ts:109` `defaultTransport`（仅 :167 作默认参数内部使用——export 可去）

### 2.11 已知/有意保留（非本次发现）

| 文件 | 说明 |
|------|------|
| `src/startup.ts` | 文档（AGENTS.md）注明为"预留启动钩子，当前为空实现"；被 `main.tsx:34` 实际调用，函数体为空。若确认不再需要可删除调用与文件 |

## 3. 已排查并排除（避免误删）

以下类别经核实**不是**死代码：

- **`modern-css-reset`**（app 依赖）：通过 `src/styles/reset.css:7` `@import "modern-css-reset"` 使用——纯 TS 扫描会漏，需查 CSS。
- **`@types/spark-md5`**（app-lynx）：`src/api/auth.ts:11` `import SparkMD5 from "spark-md5"` 需要其类型。
- **`@types/node`**（app-lynx）：配置文件（`lynx.config.ts` 等）运行于 Node，类型依赖成立。
- **`src/native/` 全部文件**：平台分支代码，仅 Android（Capacitor）构建加载——属有意设计（AGENTS.md 明示）。
- **`src/types/*.d.ts`、`vite-env.d.ts`、`auto-imports.d.ts`**：环境声明文件，经 tsconfig `include` 自动纳入。
- **`stores/`、`services/`、`api/`、`settings/`、`utils/` 其余文件**：逐一扫描均有 ≥1 引用（含 `_oauthFetch.ts`→`auth.ts`、`createImageSizeWorker.ts`→`novelImageDimensions.ts` 等间接引用）。
- **`primitives/` 除 §2.1 所列外**：`createFeedVirtualizer`/`createNovelSearch`/`createNovelTextLayout`/`createNovelVirtualLayout`/`createPullToRefresh`/`createImageSizeWorker`/`isPretextSupported`/`viewportWidth`/`novelTextLayoutCache`/`rootMargins`/`visibility/*`/`scroll/createScrollBehavior` 等均有引用。⚠️ 注意 §2.1 第 11–15 项（createScrollDirection/createScrolledPast/createScrollDrivenVisibility/measureText/scroll/index.ts）**不适用"均有引用"**，属上表遗漏，已在上文修正。
- **`@pictelio/ugoira`、`@pictelio/update-check`**：导出均被 app/app-lynx 消费（`UgoiraViewer.tsx`、`updateService.ts`、`updateStore.ts`）。
- **website 包**：无死文件（仅 index.astro + BaseLayout + content.config）。
- **`packages/app/scripts/lib/*`**：全在用（release-github.mjs 虽死，仍 import lib，勿删 lib）。

## 4. 附带观察（非死代码）

1. **常量漂移隐患**：`stores/db.ts:78` 硬编码 `"translations"` 对象仓库名，与 `utils/translationCache.ts:16` 的 `TRANSLATION_STORE = "translations"` 重复——清理死导出时建议统一为单一常量。
2. **`@pictelio/ugoira` 公共 API 面大于需求**（低置信）：`sliceFrames`（index.ts:176）仅测试引用；`ZipEocd`/`computeFrameOffset`/`sliceStoreFrame` 仅内部+测试使用、无外部消费者。

## 5. 文档同步建议（可选但推荐）

死代码的存在使以下文档过时，删除后可一并修正：

- `AGENTS.md` 架构图 §"首页 Feed 面板"与 §components 列表仍把 `RecommendedFeed/FollowFeed/BookmarksFeed/HistoryFeed/CollapsedHeader/AgeGate` 描述为在用组件；§primitives 列表含已死滚动原语与 measureText。
- `.handoff.md` 描述的是 C shell 改版**前**的旧首页结构。
- `docs/adr/ADR-0041`、`ADR-0043`、`ADR-0073`、`ADR-0082`、`glossary-ui-cards.md` 引用旧组件——历史决策记录建议保留，可加注"该组件已随 ADR-0075 移除"。
- ADR-0023 的"删除原 3 个文件"步骤**从未执行**——本次删除即为补执行该 ADR。

## 6. 局限

- 未运行 knip 等自动化工具（仓库未安装），采用手动引用计数 + 生产 bundle 交叉验证；对"死文件/死导出/死依赖/未接线脚本"结论可靠；对"同文件内死分支/恒假条件"未系统覆盖。
- 对 SolidJS JSX 使用做了 `<Foo` 与别名导入补充搜索，但字符串 key 动态访问导出对象等极端情况仍可能漏报——按"宁漏勿错"处理。
- 部分"死导出"（如 `fetchNovelText`、§2.6 测试引用项）可能是有意保留的公共 API 面或待接线功能，删除前建议确认无外部（Android 原生桥/未来功能）依赖。

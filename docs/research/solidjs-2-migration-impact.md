# SolidJS 2.0 迁移影响分析报告（Pictelio / pixivizer）

> 分析日期：2026-09-08。前置依据：`docs/research/solidjs-2-vs-1-analysis.md`（SolidJS 2.0 RC 破坏性变更清单）。
> 统计口径：所有 API 使用计数基于 `grep -rw`（词边界匹配）在 `packages/app/src/**/*.{ts,tsx}` 上执行，排除 `src/auto-imports.d.ts`（自动生成文件）；行数指"出现该词的行数"。set 后读 / effect 内写 signal 用 Python 启发式扫描（正则 `\bset[A-Z]\w*\(` 与同 getter `\b\w+\(\)` 在 8 行窗口内共现），存在漏报与误报，数字为下限估计。npm 版本信息来自 registry.npmjs.org dist-tags（`npm view` 因仓库 devEngines 校验失败，改用 curl 直连 registry）。

## TL;DR

- **总工作量评级：中高（Large）**。预估 150+ 个迁移点，遍布 69 个 signal 文件、34 个 createEffect 文件、24 个 `on:` 命名空间文件；不是 codemod 能独立完成的级别。
- **一句话结论**：生态依赖（router / vite-plugin / solid-primitives / testing-library）均已发布 2.0 适配版，升级路径通畅；真正的成本在**语义迁移**——微任务批处理导致的"set 后立即读"静默失效（已定位约 15 处真实命中）、createEffect 双阶段重写（83 处调用 / 34 文件）、以及 Fluent Web Components 依赖的 `on:change` 等 `on:` 命名空间事件（62 处 / 24 文件，2.0 移除后需改 ref 回调挂 addEventListener）。

## 依赖升级清单

| 包 | 当前版本 | 2.0 适配版本 / 状态 | 来源 |
|---|---|---|---|
| solid-js | `^1.9.14` | `next: 2.0.0-rc.6`（2026-09-02，RC，API 冻结但非 stable） | registry.npmjs.org/solid-js |
| @solidjs/web | 未直接依赖（走 `solid-js/web` 子路径） | `2.0.0-rc.6`（next）——2.0 后 render/Portal/Dynamic 从这里导入 | registry.npmjs.org/@solidjs/web |
| @solidjs/router | `^1.0.0` | `next: 2.0.0-next.21`（peer: `solid-js ^2.0.0-rc.5` + `@solidjs/web`） | registry.npmjs.org/@solidjs/router |
| vite-plugin-solid | `^2.11.14` | `next: 3.0.0-next.27`；官方后继包 `@solidjs/vite-plugin` 已到 `3.0.0-next.35/39`（OXC Rust 编译器） | registry.npmjs.org/vite-plugin-solid、@solidjs/vite-plugin |
| @solid-primitives/intersection-observer | `^2.2.5` | `next: 3.0.0-next.3`（peer `solid-js ^2.0.0-rc.0` + `@solidjs/web`） | registry.npmjs.org |
| @solid-primitives/scroll | `^2.1.6` | `next: 3.0.0-next.4`（peer 同上） | registry.npmjs.org |
| @solid-primitives/scheduled | `^1.5.3` | `next: 2.0.0-next.2`（peer 同上）；**src 中未发现任何 import，疑似死依赖，迁移时可直接移除** | registry.npmjs.org + grep 无命中 |
| @tanstack/solid-query | `^5.101.4` | `6.0.0-rc.3`（rc tag；peer `solid-js >=2.0.0-rc.6 <3.0.0` + `@solidjs/web`）。5.x peer 仅 `^1.6.0`，**必须升大版本** | registry.npmjs.org/@tanstack/solid-query |
| @tanstack/solid-db | `^0.2.30` | latest `0.2.42`，peer 仅 `solid-js >=1.9.0`，且依赖 `@solid-primitives/map ^0.7.2`（1.x 时代）；**未见 2.0 适配版，属阻塞项**，需跟踪上游或评估替换 | registry.npmjs.org/@tanstack/solid-db |
| @tanstack/solid-virtual | `^3.13.36` | latest `3.13.38` / beta `3.0.0-beta.68`，peer 均仅 `solid-js ^1.3.0`；**未见 2.0 适配版，阻塞项**（src 有 4 处 import） | registry.npmjs.org/@tanstack/solid-virtual |
| @tanstack/query-persist-client-core | `5.101.4` | latest `5.102.8`，无 peer 依赖，框架无关，**不受影响** | registry.npmjs.org |
| @solidjs/testing-library | `^0.8.10` | `next: 1.0.0-beta.3`（peer `solid-js >=2.0.0-0` + `@solidjs/web`） | registry.npmjs.org |
| 其他包（app-lynx / ugoira / update-check / website / Capacitor / Fluent UI / UnoCSS） | — | **不受影响**（Vue/纯 TS/Astro/原生，与 solid-js 无依赖关系） | package.json 确认 |

## API 迁移影响矩阵

统计范围：`packages/app/src`（排除 auto-imports.d.ts）。

| API | 使用点（行数/文件数） | 2.0 处理方式 | 风险等级 |
|---|---|---|---|
| createSignal | 275 行 / 69 文件 | 直接兼容（语义变化见高危点） | 中（语义层面） |
| createEffect | 83 行 / 34 文件 | **需重构**：拆为 compute/apply 双阶段，cleanup 改返回值，initialValue 移除 | 高 |
| createMemo | 48 行 / 19 文件 | 改名项少；initialValue 参数移除（需逐一检查是否传了第二参） | 中 |
| createStore | 1 处（`stores/uiStore.ts:24`） | 保留但 setter 改 draft-first；项目主要用 createSignal，利好 | 低 |
| produce / createMutable / reconcile | **src 实际使用 0 处**（仅 auto-imports.d.ts 声明） | 无需迁移；从 auto-import 配置中删除 | 无 |
| createResource | **0 处实际使用**（项目用手动 fetch + TanStack Query，`createManualFetch.ts` 注释明确弃用） | 无需迁移 | 无 |
| Suspense | **0 处** | 无需迁移（改名 Loading 不影响） | 无 |
| onMount | 49 行 / 28 文件（含 main.tsx、authStore、多数 routes） | 改名 `onSettled`，可返回 cleanup；机械替换为主 | 中 |
| onCleanup | 62 行 / 33 文件 | 保留；但在 ref 回调中不再可用（ref unowned），需排查 | 中 |
| batch | 4 处实际调用：`stores/recommendedStore.ts:16`、`routes/NovelDetail.tsx:374/662/716` | 移除；默认批处理 + 需要同步语义时 `flush()` | 中 |
| untrack | 4 行 / 3 文件 | 兼容保留 | 低 |
| createDeferred | 0 处实际使用 | 移除（不影响） | 无 |
| createSelector | 0 处实际使用 | 改名 createProjection（不影响） | 无 |
| createRoot | 4 处：`stores/userIllustsStore.ts:34,65`、`stores/shared/createTQFeedStore.ts:224` | 保留；但 owned-scope 写入规则影响其子树 | 中 |
| on（solid helper） | **0 处 import 使用**（grep 命中的 `on(` 均为 Node 事件/proxy） | 无需迁移 | 无 |
| Index | **0 处** | 无需迁移 | 无 |
| For / Show / Switch / Match | For 29 行/22 文件；Show 306 行/49 文件；Switch 9；Match 19 | 组件保留（For 的 keyed 语义需核对回调签名） | 低 |
| Portal / Dynamic | 各 1 处 | 保留，导入路径改 `@solidjs/web`（经 auto-import 统一处理） | 低 |
| ErrorBoundary | 3 行 / 2 文件 | 改名 `Errored`，语义升级（可自愈） | 低 |
| createContext / useContext | **0 处实际使用** | 无需迁移 | 无 |
| mergeProps | 1 处（`components/SeriesSheetItem.tsx:20`，显式 import） | 改名 `merge` | 低 |
| splitProps | 0 处实际使用 | 改名 `omit` | 无 |
| children() helper | 0 处 | 保留（不影响） | 无 |
| observable | 0 处 | 移除（不影响） | 无 |
| **`classList=` JSX 属性** | **65 处 / 28 文件** | 移除 → `class` 对象/数组形式；codemod 可覆盖大部分 | 中 |
| **`on:` 事件命名空间** | **62 处 / 24 文件**（全部挂在 `<fluent-*>` Web Components 上，如 `on:change`、`on:close`） | **移除** → 需 ref 回调 + addEventListener 或封装指令工厂；fluent 组件事件无法走 JSX 属性 | 高 |
| `use:` 指令 / `attr:` / `bool:` / `/*@once*/` | 0 处 | 不影响 | 无 |
| render 入口 | `src/main.tsx:51` `render(() => <App/>, root)`（auto-import） | 导入改 `@solidjs/web`；`jsxImportSource: "solid-js"` → `"@solidjs/web"`（tsconfig.json:7） | 低（配置项） |
| unplugin-auto-import | `vite.config.ts:65-83` 对 `"solid-js"` preset + `@solidjs/router` 显式列表；`src/auto-imports.d.ts` 声明了 batch/produce/createResource/observable 等 **2.0 已删除的 API** | preset 需换 2.0 版或改手写 imports 列表，删除已移除 API；这是构建链上的隐藏改动点 | 中 |

## 分模块迁移清单

### stores/（24 文件 + shared/）

- **利好**：`grep -lw createEffect src/stores` **零命中**——stores 是纯 signal 定义，没有 effect 内写回模式，owned-scope 写入 throw 的直接雷区不在这一层。
- 改动点：
  - `recommendedStore.ts:16` 的 `batch()` → 删除或换 `flush()` 语义审查。
  - `userIllustsStore.ts:34,65` 与 `shared/createTQFeedStore.ts:224` 的 `createRoot` 包装 TanStack Query —— 需配合 solid-query 6 重测。
  - `uiStore.ts:24` 唯一 createStore → setter draft-first 语义核对。
  - **`userIllustsStore.ts:160→165`**：set 后立即读（见高危点）。
  - `db.ts` / `historyStore.ts` 使用 `@tanstack/solid-db`（上游无 2.0 适配版，阻塞）。

### primitives/（20+ 文件）

- **重灾区**。createEffect 命中 13 个文件：`createFeedVirtualizer.ts`、`createNovelVirtualLayout.ts`、`createNovelSearch.ts`、`createProgressiveImage.ts`、`createPullToRefresh.ts`（间接）、`useComments.ts`、`useDetailData.ts`、`useUserProfile.ts`、`visibility/everVisible.ts`、`visibility/sentinel.ts`、`scroll/createScrollBehavior.ts` 等——每个都要拆 compute/apply 双阶段并迁移 cleanup。
- `@solid-primitives/intersection-observer` 5 处 import、`@solid-primitives/scroll` 2 处 import → 升 next 版并核对 API 变化。
- set 后读命中：`createPullToRefresh.ts:81→89`、`createFeedVirtualizer.ts:103/120/122/129`、`everVisible.ts:45→53`、`usePointerHighlight.ts:21,37`、`useComments.ts:82,122`、`createProgressiveImage.ts:167→173`（部分为误报，需人工甄别）。

### routes/

- 17 个页面组件。createEffect 命中 9 个（`__root`、`HomePage`、`IllustDetail`、`NovelDetail`、`Search`、`Settings`、`ClientSwitch`、`ImageHostSettings` 等）；onMount 命中 13 个。
- `NovelDetail.tsx` 有 3 处 `batch()`（:374/:662/:716）+ set 后读（:355→361、:529→533）。
- `Search.tsx:149` `store.setKeyword(""); store.keyword().trim()` —— 典型静默失效点。
- `ImageHostSettings.tsx:75→80` `setEditingHost(null); editingHost()` —— 同上。

### components/

- 40+ 组件。`classList=` 65 处/28 文件、`on:` 62 处/24 文件集中在这一层（设置页子组件 + FluentDialog + NavBar 等）。
- `ImageViewer.tsx` 多处手势逻辑 set 后读（:172→173、:191→196 等，需甄别哪些在事件回调同步段内依赖旧语义）。
- `mergeProps` 1 处（SeriesSheetItem.tsx:20）。
- createEffect 命中 12 个组件（NavBar、VirtualFeed、ImageViewer、UgoiraViewer、FluentDialog、AdaptiveTags 等）。

### 入口与构建链

- `src/main.tsx`：render 导入路径、`onMount`→`onSettled`、auth 恢复/settings 同步属"启动期命令式代码"，须审计批处理语义。
- `vite.config.ts`：vite-plugin-solid → `@solidjs/vite-plugin@next`；**unplugin-auto-import 的 solid-js preset 需要 2.0 版本或改显式 imports**（当前 auto-imports.d.ts 含 batch/produce/createResource/observable/renderToString 等 2.0 已删除项）。
- `tsconfig.json:7` `jsxImportSource: "solid-js"` → `"@solidjs/web"`。
- 测试基建：tests/unit 中 6 个测试直接 `import { render } from "solid-js/web"`（PersonalCenter、UgoiraViewer、StartupUpdateDialog、GateOverlay、PageTransition、FluentDialog 测试），需改导入。

## 高危点清单（会静默失效，编译期发现不了）

1. **set 后立即读（微任务批处理语义反转）**——启发式扫描 56 处候选，人工甄别后的高置信真实命中：
   - `src/stores/userIllustsStore.ts:160→165`：`setContentType(type)` 后同步读 `contentType()` 选 query。
   - `src/routes/Search.tsx:149→155`：`store.setKeyword("")` 后同步 `store.keyword().trim()`。
   - `src/routes/ImageHostSettings.tsx:75→80`：`setEditingHost(null)` 后同步读 `editingHost()`。
   - `src/stores/backGestureStore.ts:21→26`：push overlay 后同步读栈顶。
   - `src/primitives/createFeedVirtualizer.ts:103/120/122/129→127/131`：下拉刷新状态机连续 set 后读 `pullPhase()`——**状态机逻辑在 2.0 下会整体错位**。
   - `src/primitives/createPullToRefresh.ts:81→89`：同上模式。
   - `src/components/settings/SettingsTranslate.tsx:34→42`：`loadDsApiKey().then(() => setInputKey(...))` 后 `saveDsApiKey(inputKey())`。
   - 处理：逐点改为用局部变量传递新值，或显式 `flush()`，优先前者。
2. **`on:` 命名空间移除（62 处 / 24 文件）**——全部用于 `<fluent-switch on:change=...>`、`<fluent-dialog on:close=...>` 等 Web Components 自定义事件；2.0 删除该命名空间后这些事件**静默不再触发**（不报错）。代表文件：`SettingsContent.tsx:38,66`、`SettingsUpdate.tsx:71,98`、`SettingsAppearance.tsx:56,83`、`SettingsTranslate.tsx:210`、`FluentDialog.tsx`、`ImageHostSettings.tsx:160,505`。需要统一的 ref/指令封装方案。
3. **createEffect 内写 signal（owned-scope 写入 dev throw）**——启发式估计约 51 个 effect 体内含 setter 调用，分布 21 文件（primitives 13 + components 12 + routes 9，有重叠）。2.0 dev 下这些直接 throw，需系统性改为 derive（createMemo/function-form createSignal）或 `ownedWrite` 豁免。代表：`useDetailData.ts`、`createFeedVirtualizer.ts`、`useUserProfile.ts`、`NavBar.tsx`、`Search.tsx`。
4. **batch() 移除后的语义空洞**：`recommendedStore.ts:16`、`NovelDetail.tsx:374/662/716`——1.x 的 batch 保证同步批量，2.0 删除后若简单删调用，需确认后续同步读取点不存在。
5. **onMount→onSettled + ref 回调 unowned**：28 个文件用 onMount；若有 ref 回调内注册 onCleanup 的写法（虚拟滚动/指令类代码需逐一排查），2.0 下 onCleanup 静默不生效。

## 测试兜底建议

- 现有体系可复用：tests/unit 80+ 测试文件覆盖 stores（24）、primitives（11）、api（13）、components（13）；agent-browser E2E 6 spec + android-e2e 6 spec。
- **迁移前必须补的 oracle**：针对上述 5 类高危点，为 `createFeedVirtualizer`/`createPullToRefresh` 状态机、`userIllustsStore.setContentType`、`Search` keyword 流程、`backGestureStore` 栈操作补齐**时序行为测试**——2.0 批处理语义变化不出类型错，只能靠行为测试抓。
- 测试基建本身要迁移：`@solidjs/testing-library@next` + 6 处 `solid-js/web` render 导入；node 环境单测中依赖 signal 同步语义的断言会批量失效，预期首轮迁移后单测红一批，这本身就是迁移点的探测器。
- 迁移后跑 `pnpm test:all` + agent-browser E2E 全量；E2E 的 route-switch-instant 与 update-flow spec 对启动期时序最敏感，优先看。

## 来源引用

1. 前置调研：`docs/research/solidjs-2-vs-1-analysis.md`（本仓库）
2. npm registry dist-tags：solid-js、@solidjs/router、@solidjs/web、@solidjs/signals、vite-plugin-solid、@solidjs/vite-plugin、@solid-primitives/{intersection-observer,scheduled,scroll}、@tanstack/{solid-query,solid-db,solid-virtual,query-persist-client-core}、@solidjs/testing-library（2026-09-08 查询）
3. Solid 2.0 MIGRATION.md / RFC 01（经前置报告转引）
4. 本仓库统计：grep -rw 于 `packages/app/src`，Python 启发式扫描（212 个 .ts/.tsx 文件）

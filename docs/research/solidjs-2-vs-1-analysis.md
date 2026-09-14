# SolidJS 2.0 vs 1.x 调研报告

> 调研日期：2026-09-08。仅采用一手来源：solidjs/solid GitHub 仓库（next 分支文档、releases、discussions）、npm registry、v2.solidjs.com 官方预览文档。项目当前使用 `solid-js ^1.9.14`。

## 执行摘要（TL;DR）

- **状态**：SolidJS 2.0 已进入 **Release Candidate** 阶段（npm `next` tag = `2.0.0-rc.6`，发布于 2026-09-02），**尚无 stable 2.0**。1.x 继续维护，`latest` = `1.9.15`（2026-08-17），另有 `1.10.0-beta.0`。
- **2.0 是一次彻底重写**：响应式内核拆分为独立包 `@solidjs/signals`；异步（async/await）进入响应式图本身（"async lives in the graph"）；`createEffect` 拆分为 compute/apply 双阶段；默认微任务批处理；大量 1.x API 被移除或改名。
- **包结构重组**：`solid-js/web` → `@solidjs/web`，`solid-js/store` → 并入 `solid-js`，新增 `@solidjs/h`、`@solidjs/html`、`@solidjs/universal` 等独立包。
- **破坏性变更非常多**：`createResource`、`batch`、`onMount`、`Suspense`/`ErrorBoundary`/`Index`、`produce`/`createMutable`、`on`、`use:` 指令、`classList`、微任务前同步读取语义等全部变更。
- **生态已就绪**：@solidjs/router 2.0 next、`@solidjs/vite-plugin` 3.0 next（OXC Rust 编译器，比 Babel 快 23–355 倍）、solid-primitives、Kobalte、TanStack 生态均已适配 RC。官方提供[迁移指南](https://v2.solidjs.com/migration/from-solid-1)与 codemod 工具 `npx solid-migration-assistant`。
- **对本项目**：迁移成本**中高**。大量使用 `createSignal/createStore/createEffect`、手写 primitives、虚拟滚动，且依赖"@solidjs/router + @solid-primitives"，这些都触到 2.0 的核心变更面。建议**等 2.0 stable 发布后**再评估，目前不要动。

## 发布状态

| 项 | 值 | 来源 |
|---|---|---|
| npm `latest` | `1.9.15`（2026-08-17） | registry.npmjs.org/solid-js |
| npm `next` | `2.0.0-rc.6`（2026-09-02） | registry.npmjs.org/solid-js |
| npm `beta` | `1.10.0-beta.0`（1.x 线） | 同上 |
| 2.x 版本总数 | 59 个（experimental.0–16 → beta.0–34 → rc.0–6） | 同上 |
| RC 公告 | "v2.0.0 RC - The Big `<Reveal>`"（2026-08-13） | [discussion #2995](https://github.com/solidjs/solid/discussions/2995) |
| Beta 公告 | "v2.0.0 Beta - The `<Suspense>` is Over"（2026-03-03） | [discussion #2596](https://github.com/solidjs/solid/discussions/2596) |
| 路线图 | "The Road to 2.0"（2025-02-14） | [discussion #2425](https://github.com/solidjs/solid/discussions/2425) |

官方在 RC 公告中明确："Release Candidate means the API is frozen but not that there won't be bugs"——即 **API 已冻结，但仍可能有 bug**，鼓励生态库和 1.0 项目现在迁移并上报问题。仓库当前为 monorepo：`packages/{solid,web,signals,compiler,babel-plugin,h,html,universal,element,diagnostics}`（[solidjs/solid next 分支](https://github.com/solidjs/solid/tree/next/packages)）。

## 核心变更分类

### 1. 响应式内核（RFC 01）

来源：[RFC 01 — Reactivity, batching, and effects](https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/01-reactivity-batching-effects.md)

- **微任务批处理为默认**：setter 调用后**读取仍返回旧值**，直到微任务 flush；需要同步语义时显式 `flush()`。`batch()` 被移除。
  ```js
  setCount(1); count(); // 仍是 0；flush() 后才是 1
  ```
- **禁止 owned scope 内写入**：在 effect/memo/组件 body 中写 signal 在 dev 下**直接 throw**；仅可用 `ownedWrite: true` 窄口径豁免。
- **顶层响应式读取 dev 告警**：组件 body 顶层读取 signal/props/store（含解构 props）会警告，须移入 `createMemo/createEffect` 或显式 `untrack`。
- **createEffect 拆分双阶段**：`createEffect(compute, apply)`，compute 负责依赖追踪并返回值，apply 执行副作用并可返回 cleanup。1.x 的 `initialValue` 参数移除（compute 收到 `prev`，首跑为 `undefined`）。
- **onMount → onSettled**：可返回 cleanup。
- **createMemo**：第二参数变为 options（不再有 initialValue）；新增 `lazy` 选项（首次读取才计算、零订阅自动 dispose）；新增 `unobserved` 回调。
- **异步进入响应式图**：computation 可直接返回 Promise / AsyncIterator，下游自动理解；配套 `isPending(fn)`、`latest(fn)`、`refresh(target)`、`resolve(fn)`、`until(fn)`、`affects(target)` 等新 API。

### 2. API 变更（改名 / 移除）

来源：[MIGRATION.md](https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/MIGRATION.md)

**改名**：
- `Suspense` → `Loading`；`SuspenseList` → `Reveal`（order: sequential/together/natural）；`ErrorBoundary` → `Errored`
- `mergeProps` → `merge`；`splitProps` → `omit`；`unwrap` → `snapshot`
- `createSelector` → `createProjection` / `createStore(fn)`；`createDynamic` → `dynamic()` factory（`<Dynamic>` JSX 用法不变）
- `equalFn` → `isEqual`；`getListener` → `getObserver`；`classList` → `class`（对象/数组形式）

**移除 → 替代**：
- `createResource` → async `createMemo` + `<Loading>`（`resource.loading` → `Loading`/`isPending`；`refetch()` → `refresh()`；`mutate()` → `createOptimisticStore` + `action`）
- `batch` → 默认批处理 + `flush()`
- `startTransition` / `useTransition` → 内建 transitions + `isPending`/`latest`
- `createComputed` → `createMemo` / split `createEffect` / function-form `createSignal`
- `on` helper → split effect 的 compute 阶段即依赖声明（`defer` 成为 `createEffect` 选项）
- `onError`/`catchError` → `Errored` / effect `error` 选项（`Errored` 可自愈，`resetErrorBoundaries` 移除）
- `produce` → store setter 默认即 draft（produce 风格）
- `createMutable`/`modifyMutable` → `createStore` + draft setter
- `from`/`observable` → async iterator / effect 外推（**`observable` 无直接替代，官方承认是已知缺口**，预计由 @solid-primitives 补）
- `createDeferred`、`indexArray`（→ `mapArray` + `keyed:false`）、`enableScheduling`、`writeSignal` 移除
- `Index` 组件移除 → `<For keyed={false}>`

**新 API**：`Reveal`、`Repeat`（按 count 渲染无 diffing，适合骨架屏/窗口化）、`action(fn)`（generator 变更 + transition 协调）、`createOptimistic/createOptimisticStore`、`createProjection`、`deep(store)`、`reconcile(value, key)`、function-form `createSignal(fn)`/`createStore(fn, seed)`（派生可写原语）、`ssrSource` 选项等。

### 3. 渲染器 / DOM / JSX（RFC 07、09）

- **包路径**：`render/hydrate` 从 `@solidjs/web` 导入；`solid-js/h` → `@solidjs/h`；`solid-js/html` → `@solidjs/html`；`solid-js/universal` → `@solidjs/universal`。
- **TS 配置**：`jsxImportSource: "solid-js"` → `"@solidjs/web"`；`solid-js` 不再导出 JSX namespace 与 jsx-runtime 类型（组件类型改用 `Element` from `solid-js`）。
- **属性语义贴近 HTML**：内建属性按 attribute 处理、普遍小写；布尔属性 presence/absence；移除 `attr:`/`bool:`/`on:`/`oncapture:` 命名空间（原生 listener options 用 ref callback）。
- **`use:` 指令移除** → ref 指令工厂（两阶段：owned setup → unowned apply）。
- **ref 回调不再 owned**：回调内 `getOwner()` 为 `null`，`onCleanup` 无法在其中注册——生命周期工作须移到 `onSettled` 或指令工厂 setup 半段。
- **`/*@once*/` 编译标记移除**：用普通响应式 JSX 或 JS 侧 `untrack`。
- **事件委托归 render root 所有**：`clearDelegatedEvents()` 移除；嵌套 root、ShadowRoot、Portal 语义更清晰。
- **Context**：`Context.Provider` 移除——`<Theme value="dark">` 直接用 context 本身作 provider；无默认值的 `createContext<T>()` 的 `useContext` 返回 `T`（缺 provider 时抛 `ContextNotFoundError`），不再需要判空包装 hook。

### 4. SSR 相关

- `clientOnly()`、`httpStatus()`/`httpHeader()` 从 SolidStart 下沉到 `@solidjs/web`。
- `ssrSource`（server/hybrid/client）按原语控制 hydration 策略；`deferStream`。
- `renderToStream(...).readable` 提供 web 标准 ReadableStream。
- **SolidStart 退役**：server functions（`"use server"`）进 core，serving 层变成 `@solidjs/vite-plugin` 的 `start: true` 模式，文件系统路由独立为 router-neutral 包。SolidStart 继续维护性更新，迁移见 [from-solid-start](https://v2.solidjs.com/migration/from-solid-start)。（本项目无 SSR，仅作背景。）

## 破坏性变更清单（汇总）

1. 导入路径：`solid-js/web`、`solid-js/store`、`solid-js/h`、`solid-js/html`、`solid-js/universal`、`solid-js/jsx-runtime` 全部迁移/消失
2. setter 后同步读取语义反转（微任务批处理）
3. `createEffect` 签名与执行模型（split、无 initialValue、cleanup 返回值化）
4. `createMemo` 无 initialValue
5. `onMount` → `onSettled`
6. owned scope 内写入 throw（dev）；顶层响应式读取 warn（dev）
7. store setter 改为 draft-first（路径式写法需 `storePath(...)` 包裹）；`unwrap`→`snapshot`；`reconcile` 签名变化
8. 控制流：`Index` 移除；`For` 三种 keyed 模式回调签名不同；`Suspense/ErrorBoundary/SuspenseList` 改名且语义升级
9. JSX：`classList`、`use:`、`attr:`/`bool:`/`on:`、`/*@once*/` 移除；ref 回调 unowned
10. Context：Provider 写法与 useContext 类型/运行时行为变化
11. `createResource`、`batch`、`on`、`produce`、`createMutable`、`from`、`observable`、`createDeferred`、`mergeProps`/`splitProps` 等移除

## 生态适配状态

| 包 | 2.0 适配版本 | 证据 |
|---|---|---|
| @solidjs/router | `2.0.0-next.21`（next tag），peer: `solid-js ^2.0.0-rc.5` + `@solidjs/web` | registry.npmjs.org/@solidjs/router |
| vite-plugin-solid → `@solidjs/vite-plugin` | `3.0.0-next.27`（next tag，依赖 `@solidjs/vite-plugin`），默认启用 OXC Rust 编译器（官方基准 23x–355x 快于 Babel），Babel preset 保留为选项 | registry.npmjs.org/vite-plugin-solid；[RC 公告](https://github.com/solidjs/solid/discussions/2995) |
| @solid-primitives/* | 各包陆续发 `next` tag（如 intersection-observer `3.0.0-next.3`，peer `solid-js ^2.0.0-rc.0`）；RC 公告称 Solid Primitives "ready to use with the RC today" | registry.npmjs.org；discussion #2995 |
| Kobalte / Solid Testing Library / Storybook / AG Grid | 官方公告称已适配 RC | discussion #2995 |
| Solid Meta | 1.0，变成 2.0 内建 head registry 的薄层 | discussion #2995 |
| TanStack | fullstack-tanstack 模板；`@tanstack/solid-start@beta` | discussion #2995 |
| SolidStart | 退役（维护模式），start mode 替代 | discussion #2995 |

## 官方迁移工具与指南

- 迁移指南：[v2.solidjs.com/migration/from-solid-1](https://v2.solidjs.com/migration/from-solid-1) 与仓库 [MIGRATION.md](https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/MIGRATION.md)（1035 行，含完整 before/after）
- **Codemod / 迁移助手**：`npx solid-migration-assistant`（[solidjs-community/solid-migration-assistant](https://github.com/solidjs-community/solid-migration-assistant)）——扫描项目并对每个 1.x 迁移点（旧导入、单参 createEffect、onMount、Suspense/Index/classList、旧 store helpers）打印具体指引
- 每包附带 `CHEATSHEET.md`（列举全部 public export 及与 1.x 的差异）
- 12 篇 RFC：`documentation/solid-2.0/01–12`（reactivity、stores、async data、actions、DOM、TS/JSX、server functions、SSR 等）

## 对本项目（Pictelio）的迁移成本评估

项目特征：SolidJS 1.9 SPA（无 SSR）、Vite + vite-plugin-solid、@solidjs/router、@solid-primitives（intersection-observer 等）、大量手写 primitives（createSignal/createStore/createEffect/createMemo）、虚拟滚动、Web Worker、手动 fetch（不用 createResource）、不依赖 Suspense。

**有利因素**：
- 无 SSR → RFC 10–12 基本不涉及
- 手动 fetch + TanStack Query 管理数据 → `createResource` 移除影响小
- 不使用 Suspense 数据加载 → Loading/Errored 迁移面小
- 生态依赖（router、primitives、vite plugin）均已有 2.0 适配版本
- 官方 codemod 可机械处理导入路径与改名

**高风险点**：
1. **微任务批处理语义反转**：项目大量 store 在模块顶层导出，若存在"set 后立即读"的命令式代码（如 settings 同步、auth 恢复、generation-gate 竞态防护逻辑），行为会静默改变——这类 bug 编译期发现不了，须依赖测试。这是本项目最大的隐性风险。
2. **createEffect 拆分**：所有 `createEffect` 需逐一审视改为 compute/apply 双阶段；cleanup 从 `onCleanup` 改为 apply 返回值。手写 primitives（createFeedVirtualizer、createPullToRefresh、createManualFetch 等）每个都要重写。
3. **顶层读取告警 / owned-scope 写入 throw**：stores 模块顶层定义 + 组件内 `createEffect` 写 signal 的模式在 2.0 dev 下会大量告警/报错（如 feed store 的 effect 内 setState 写法）。需要系统性重构为"derive 而非 write-back"。
4. **onMount → onSettled、ref 回调 unowned**：虚拟滚动/快速滚动条/指令类逻辑（若有 `use:` 或 ref 内 onCleanup）需要改为指令工厂或 onSettled。
5. **`Index` / `classList` / `mergeProps` 等**：若有使用需全量替换（codemod 可覆盖大部分）。
6. **Web Worker**：`imageSize.worker.ts` 与 Worker 通信封装本身与 Solid 无关，影响小；但 Worker 驱动的响应式更新落到 signal 写入处仍受新语义约束。

**成本量级**：中高。属于"每个 store/primitive 都要人工过一遍"的级别，而非纯 codemod 可完成。建议在 2.0 stable 后立项迁移，并先在独立分支用 migration-assistant 全量扫描得出准确迁移点清单。

## 已知风险与社区反馈

- **RC ≠ 无 bug**：官方明确"API frozen but not that there won't be bugs"，并请求生态项目现在迁移报 issue（[discussion #2995](https://github.com/solidjs/solid/discussions/2995)）。
- **异步重复求值成本**：2.0 中表达式会在其 async 依赖逐个 settle 时重复求值（最坏 O(n²) 次）；重计算需手动 memo 拆分（[discussion #3020](https://github.com/solidjs/solid/discussions/3020)）。
- **async memo 自依赖语义争议**（[discussion #3051](https://github.com/solidjs/solid/discussions/3051)）。
- **`observable()` 无直接替代**：官方承认是已知缺口，预计移入 @solid-primitives（MIGRATION.md）。
- **Playground 仍跑 1.x**：2.0 预览文档在 v2.solidjs.com，playground 的 2.0 构建"on the way"（README）。
- 设计讨论：[2.0 async system design choices（#2791）](https://github.com/solidjs/solid/discussions/2791)、[Loading 检测（#2603）](https://github.com/solidjs/solid/discussions/2603)、[Retrying state（#2658）](https://github.com/solidjs/solid/discussions/2658)。

## 建议

1. **短期（现在）**：不做任何迁移动作。保持 `solid-js ^1.9.x`（1.x 仍在维护，1.10 beta 存在）。可在 ADR 中记录"2.0 RC 已发布，待 stable 后评估"。
2. **中期（2.0 stable 发布后）**：走标准四阶段流水线立项；第一步在分支上跑 `npx solid-migration-assistant` 得出迁移点清单，按 RFC 01 重点审计"set 后立即读"与"effect 内写 signal"两处模式（本项目 stores 密集，这两类是主要工作量）。
3. **测试策略**：迁移前补齐现有 store/primitive 的时序相关单测（项目已有 IO 边界测试硬约束，可复用该体系），作为语义回归的 oracle——2.0 批处理语义变化不会触发类型错误，只能靠行为测试兜底。
4. **顺带收益**：迁移后可换 OXC 编译器（构建提速）并统一 `@solidjs/web` 导入；但建议与功能迁移分开成独立 ticket，降低 blast radius。

## 来源列表

1. npm registry solid-js dist-tags/versions：https://registry.npmjs.org/solid-js
2. Solid 2.0 RC 公告（The Big Reveal，含生态/编译器/SolidStart 退役）：https://github.com/solidjs/solid/discussions/2995
3. Solid 2.0 Beta 公告：https://github.com/solidjs/solid/discussions/2596
4. The Road to 2.0：https://github.com/solidjs/solid/discussions/2425
5. 官方迁移指南 MIGRATION.md（next 分支）：https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/MIGRATION.md
6. RFC 01 Reactivity/batching/effects：https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/01-reactivity-batching-effects.md
7. solid-js 2.0 包 README（RC）：https://github.com/solidjs/solid/blob/next/packages/solid/README.md
8. solid-js CHANGELOG（next 分支）：https://github.com/solidjs/solid/blob/next/packages/solid/CHANGELOG.md
9. v2 预览文档：https://v2.solidjs.com ；迁移页：https://v2.solidjs.com/migration/from-solid-1
10. migration assistant（codemod）：https://github.com/solidjs-community/solid-migration-assistant
11. @solidjs/router 版本：https://registry.npmjs.org/@solidjs/router
12. vite-plugin-solid / @solidjs/vite-plugin 版本：https://registry.npmjs.org/vite-plugin-solid
13. @solid-primitives/intersection-observer 版本：https://registry.npmjs.org/@solid-primitives/intersection-observer
14. 社区反馈：async rendering 成本 https://github.com/solidjs/solid/discussions/3020 ；async memo 自依赖 https://github.com/solidjs/solid/discussions/3051 ；async 设计 https://github.com/solidjs/solid/discussions/2791

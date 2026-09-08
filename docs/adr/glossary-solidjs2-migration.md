# Glossary: SolidJS 2.0 迁移统一术语

> 关联：[ADR-0144](./ADR-0144-solidjs-2-migration.md)（决策）/ spec（issue tracker）/ 调研 `docs/research/solidjs-2-vs-1-analysis.md`、`docs/research/solidjs-2-migration-impact.md`
> 本文是 spec / tickets / 实施与 code-review 的**唯一术语口径**。所有 ticket、commit message、review 意见必须使用下述术语，不得自造同义词。

## 一、版本与依赖术语

| 术语 | 定义 |
|------|------|
| **RC 锁定（RC pinning）** | solid-js 2.0 尚无 stable（`latest`=1.9.15，`next`=2.0.0-rc.6，API 已冻结）。本次迁移将 2.0 生态包全部锁定在 RC/next 精确版本，禁用 `^` 漂移，防止 RC 间破坏性变化。 |
| **双包结构（two-package layout）** | 2.0 将 DOM 渲染器拆为独立包：`solid-js`（响应式内核 + store，85 个导出）+ `@solidjs/web`（render/Portal/Dynamic/JSX 类型）。项目同时依赖两者。 |
| **jsxImportSource 切换** | tsconfig 的 `jsxImportSource` 由 `"solid-js"` 改为 `"@solidjs/web"`；`solid-js` 不再导出 JSX namespace，组件类型用 `Element` from `solid-js`。 |
| **vendor 适配器（vendored virtualizer adapter）** | `@tanstack/solid-virtual` 的 solid 绑定层仅 69 行且使用 2.0 已删 API（`solid-js/store` 子路径、`onMount`、`createComputed`、`mergeProps`）。决策：将该适配器**改写为 2.0 语义后收编进 `src/primitives/`**，依赖降级为框架无关的 `@tanstack/virtual-core`。 |
| **本地集合（local history collection）** | `@tanstack/solid-db` 无 2.0 适配且使用面极窄（localStorage 单 key 持久化 + get/insert/update/delete/toArray，toArray 本就非响应式）。决策：用本地实现**等价替换**，保持 storageKey `pictelio-browsing-history` 与条目 JSON 形状不变（老用户数据无缝延续）。 |
| **solid-query 6 RC** | `@tanstack/solid-query` 6.0.0-rc.3（peer `solid-js >=2.0.0-rc.6` + `@solidjs/web`）。v5 的 peer 只支持 solid 1.x，必须随迁大版本。 |
| **OXC 编译器** | `@solidjs/vite-plugin` 3.0 next 默认的 Rust JSX 编译器（替代 Babel），构建提速副产物。`vite-plugin-solid@3 next` 是其薄壳，直接换用官方后继包。 |

## 二、响应式语义术语（迁移的"为什么"）

| 术语 | 定义 | 迁移口径 |
|------|------|---------|
| **微任务批处理（microtask batching）** | 2.0 默认行为：setter 调用后**同步读仍返回旧值**，新值在微任务 flush 后可见。1.x 的同步可见语义反转。 | 「set 后立即读」必须改为**局部变量传递**（首选）或显式 `flush()`（次选，仅命令式边界）。 |
| **flush** | 从 `solid-js` 导入；`flush()` 立即应用挂起更新，`flush(fn)` 在同步 flush 作用域内执行 fn。 | 仅用于：测试断言前、需要立即读 DOM 的命令式边界。禁止到处撒 flush 掩盖设计问题。 |
| **write-under-scope（owned scope 写入禁令）** | 在 effect compute 段 / memo / 组件 body **同步写 signal/store，dev 下直接 throw**（不是 warn）。 | effect 体里的 setter 必须移入 **apply 段**（untracked，合法）、事件处理器或 `onSettled`；能改派生的改派生（derive over write-back）。 |
| **ownedWrite 豁免** | `createSignal(init, { ownedWrite: true })` 窄口径允许 owned scope 内写。 | 仅限**内部状态信号**（如缓存标记、防重入标志），禁止用于应用状态掩盖设计问题；每处使用须在 code-review 说明理由。 |
| **顶层读取告警（strict top-level read）** | 组件 body 顶层同步读 signal/props/store（含解构 props）dev 下 **warn**（不 throw）；控制流函数子 body 同理。 | 不阻塞功能；迁移中**顺手修**（读移入 JSX 表达式 / memo / untrack），不做专项 ticket，不在 review 记 P 级问题。 |
| **拆分效应（split effect）** | 2.0 的 `createEffect(compute, apply)`：compute 段只读、返回值；apply 段 untracked、做副作用、可返回 cleanup。compute 收 `prev`（首跑 undefined），`initialValue` 参数移除。 | 所有 1.x 单函数 effect 迁移为拆分形式；cleanup 由 `onCleanup` 改为 apply 返回值。 |
| **apply 段（apply phase）** | 拆分效应的后半段，运行在 untracked 作用域。 | 写 signal 合法；但**读 store 代理属性会触发 STRICT_READ_UNTRACKED warn**——需在 compute 段提取为普通值传入。 |
| **onSettled** | `onMount` 的替代；在当前活动 settle 后运行，可返回 cleanup。**不能创建嵌套原语**（内部 createSignal/createEffect 会失败）——与 1.x onMount 的关键差异。 | 机械改名 `onMount`→`onSettled`；改名后须审计函数体：内含原语创建的改用 `createEffect(compute, apply, { defer: true })` 或重构。 |
| **unowned ref 回调** | 2.0 ref 回调内 `getOwner()` 为 null，`onCleanup` 在其中**静默失效**。 | ref 内的监听器注册/清理改：`onSettled`（组件体）或 ref 指令工厂 setup 半段。 |
| **ref 指令工厂（directive factory）** | 两阶段封装：owned setup（可建原语/注册 onCleanup）→ 返回 unowned apply 回调（只捕获元素）。`use:` 指令的替代。 | 本项目 0 处 `use:`，无需批量迁移；仅在 fluent 事件助手内部使用该模式。 |
| **derive over write-back** | 「派生而非写回」：能用 `createMemo` / function-form `createSignal(fn)` 表达的，不维护「被 effect 写的另一份 signal」。 | effect 内写 signal 的首选重构方向；`ownedWrite` 是最后手段。 |

## 三、DOM/JSX 术语

| 术语 | 定义 | 迁移口径 |
|------|------|---------|
| **class 数组形式** | `classList={{ a: bool }}` 移除，改 `class={["base", { a: bool }]}`（字符串 + 对象混排数组）。 | 机械替换；65 处。 |
| **fluent 事件助手（fluent event ref helper）** | `on:` 命名空间移除后，fluent-* Web Components 自定义事件（change/close 等，非 Solid 委托事件）统一经 `ref={fluentOn("change", handler)}` 挂 addEventListener 的共享助手（内部即 ref 指令工厂；支持 `ref={[existingRef, fluentOn(...)]}` 数组形式）。 | 62 处 `on:x` 全部迁移；**静默失效是最大回归风险**（不报错），必须有组件行为测试覆盖代表样本。 |
| **委托事件（delegated events）** | click 等内置事件由 render root 统一委托；camelCase `onClick` JSX 属性继续可用；`clearDelegatedEvents` 移除。 | 既有 `onClick` 用法不动。 |
| **属性即 attribute** | 内建属性按 attribute 小写处理、布尔属性 presence/absence。 | 逐点核对动态 class/style/value 绑定（重点：input value、fluent 属性经 ref 命令式设置的路径不受影响）。 |

## 四、迁移策略术语

| 术语 | 定义 |
|------|------|
| **expand–contract** | 宽重构序列：先并_exist新形式 → 分批迁移调用点 → 收缩删除旧形式。本次「导入路径/classList/on:」用 codemod 式一次性批量（blast radius 虽大但机械）；语义迁移按模块分批。 |
| **行为 oracle（timing oracle）** | 迁移前补齐的**时序行为测试**：锁定 set-后-读、状态机、栈操作等 1.x 同步语义下成立的行为断言。2.0 语义反转不出类型错，只能靠行为测试抓。验收时按 2.0 语义修正期望（修正须注释标注，不得删除测试）。 |
| **不降级验收（no-downgrade acceptance）** | 测试数量与覆盖面不得减少：断言只允许「按 2.0 正确语义修正」，不允许删除/跳过/skipIf 弱化。单测 + 类型 + lint + 双端页面功能全绿才算完成。 |
| **语义迁移批次（semantic batch）** | 按模块（stores → primitives → components → routes）分批迁移语义点，每批以该模块测试绿为门槛；与机械迁移（可 codemod 一次完成）分离，降低 blast radius。 |
| **双端验收（dual-surface acceptance）** | Web（dev server + 生产构建预览）与 Android 模拟器（Capacitor APK）两条面均须页面可达 + 功能可用。 |

## 五、易混淆对照

| 1.x | 2.0 | 说明 |
|-----|-----|------|
| `solid-js/web` 的 `render` | `@solidjs/web` 的 `render` | 入口与测试文件都要改导入 |
| `solid-js/store` 的 `createStore/reconcile` | `solid-js` 根导出 | 子路径消失；`unwrap`→`snapshot` |
| `onMount` | `onSettled` | 后者不能建嵌套原语 |
| `batch(fn)` | 直接写 + 需要同步时 `flush()` | 4 处调用点 |
| `mergeProps` / `splitProps` | `merge` / `omit` | 注意 `merge` 对 `undefined` 是「覆盖」而非「跳过」 |
| `ErrorBoundary` | `Errored`（fallback 收 accessor） | 3 处 |
| `createComputed` | 按意图拆：memo / split effect / function-form signal | 仅 vendor 适配器内有 |
| `reconcile(v, { key: "index" })` | `reconcile(v, "index")` | 签名简化；vendor 适配器内 |

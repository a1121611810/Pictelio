# ADR-0140: globalFab 后置迁移到 Pinia（setup store，spike 验证通过后的全量迁移）

- 状态：accepted
- 日期：2026-09-03
- 关联：[ADR-0139-app-lynx-pinia-migration.md](./ADR-0139-app-lynx-pinia-migration.md)（前置：原排除 globalFab）、[ADR-0120-app-lynx-radial-nav-fab.md](./ADR-0120-app-lynx-radial-nav-fab.md)（放射双层环悬浮 FAB 设计）、[ADR-0132-app-lynx-global-search.md](./ADR-0132-app-lynx-global-search.md)（全局搜索 / FAB search 模式）、[ADR-0123-app-lynx-fab-hit-testing-fix.md](./ADR-0123-app-lynx-fab-hit-testing-fix.md)（LynxView hit-testing 平台约束）
- 来源：spike 报告 [`docs/research/globalfab-pinia-spike-report.md`](../research/globalfab-pinia-spike-report.md)（770/770 单测过、`pnpm check:app-lynx` pass、web bundle 5.2MB 编译、启动期零 TDZ、console 0 errors、DOM 验证 `view.visible=false` 在 login 路由下正确派生）。**用户对 spike 报告拍板：接受结论，立项全量迁移。**

## 背景

ADR-0139 全量引入 Pinia 时把 `globalFab` 排除迁移，原文如下（`ADR-0139-app-lynx-pinia-migration.md:16`）：

> 不迁（2 个）：watchlistStore（非响应式 Set/Map 缓存，无渲染订阅方，无 ref/computed）；globalFab（惰性工厂接线 `let _fab`，真正响应式在 `createGlobalFab` 实例内部，本文件只是注册表）。

其下又补一句（`ADR-0139-app-lynx-pinia-migration.md:17`）：

> 实例级 primitives 不迁：`useSearch`/`createMixFeed`/`useComments` 等（每次调用独立实例、生命周期绑定页面/组件、`dispose()` 于卸载时调用）——与「全局单例 store」语义相反。

决策 8 进一步明确（`ADR-0139-app-lynx-pinia-migration.md:30`）：

> 不动 watchlistStore/globalFab；不动实例级 primitives；不引入 Pinia 持久化 plugin；不改 webview 客户端。

主对话期间用户提出"globalFab 好像可以迁移啊"——重新评估 ADR-0139 排除段的三条隐含理由：

1. **"形态不匹配"**：原话把 `globalFab.ts` 当作"注册表"，但它只是 30 行 wiring——把 wiring 与 primitive 混淆了。`createGlobalFab` 实例本身（位于 `packages/app-lynx/src/primitives/createGlobalFab.ts`）才是真正的反应式数据源；`globalFab.ts` 只是 `let _fab` 闭包单例 + 模块级 getter——这与 7 个已迁 store 的形态（模块级 ref 单例）**完全同形**。
2. **"测试已主动绕开"**：现行测试（`createGlobalFab.test.ts`）直接测 primitive，注入假 deps；`globalFab.ts` 自身无单测——这是**测试覆盖缺失**，不是迁移障碍。迁到 Pinia 后可借 `setActivePinia(createPinia())` 天然化隔离。
3. **"TDZ 接线"**：担心 `createGlobalFab({ routeState, navigate, ... })` 在模块加载期触发的循环依赖 / TDZ。spike 报告 §4.1（`globalfab-pinia-spike-report.md:120-124`）的实证：Pinia `defineStore(name, factory)` 的 factory body **不在模块加载时执行**，仅在首次 `useXStore()` 时执行——与 `let _fab` 闭包懒求值**同语义**。

三条排除理由均不成立。spike 在 vue-lynx 0.5.1 + pinia@^4.0.3 + web-core 0.23.1 组合下实证通过：

| 维度 | 结果 |
|---|---|
| `pnpm check:app-lynx`（tsc） | pass，无类型错误 |
| `pnpm test:app-lynx`（vitest） | 770/770 pass，无回归 |
| `pnpm dev:app-lynx` 构建 | 端口 3009，lynx + web 双 bundle 编译通过 |
| bundle 内 spike 标记 | `SPIKE globalFab` 字符串、`defineStore` 引用进入 main.web.bundle（5.2MB） |
| 运行时（web-core 预览） | login 页面正常渲染；console 0 errors / 0 warnings；启动期无 TDZ 报错；DOM 显示 `view.visible=false`（login 路由名命中 NON_CONTENT_ROUTE_NAMES） |

关键判断（spike §4，`globalfab-pinia-spike-report.md:118-141`）：

- **TDZ 假说验证**（`globalfab-pinia-spike-report.md:122`）：Pinia 在 `defineStore()` 返回时只是注册一个工厂函数，**不立即调用**。第一次 `useXStore()` 才调用工厂、缓存实例、返回 store proxy。与"模块顶层立即 `createGlobalFab()`"是**完全不同的代码路径**。
- **跨 store 引用**：factory body 内 `() => useSearchSheetStore().openSearch()` / `() => useModalStack().hasOpenModal()` 是箭头函数，在 `createGlobalFab` 构造时只是闭包，**不立即调用**。等价于现状（`globalFab.ts` 内同样的箭头函数），现状已实证工作。
- **view 响应性**（`globalfab-pinia-spike-report.md:136`）：`storeToRefs(fab)` 把 store 暴露的 `Ref<FabView>` mirror 为 `Ref<FabView>`，下游 `view.value.X` 反应性**完整保留**。
- **单例语义**（`globalfab-pinia-spike-report.md:140`）：Pinia store id 全局唯一；`createGlobalFab` 实例由 `_fabCache` 兜底，与原 `let _fab` 单例**等价**。

## 决策

1. **全量迁移 `globalFab.ts` 从 `let _fab` 闭包单例改为 Pinia `defineStore('globalFab', () => { ... })` setup store**。factory body 内调用 `createGlobalFab({ routeState, navigate, navTabs, openSearch, hasOpenModal })`，返回 `{ view, dispatch, usePage }`。当前 spike 版本（`packages/app-lynx/src/stores/globalFab.ts:18-34`）的 18 行工厂体直接转为迁移产物，仅删除 spike 注释与调试代码（`_factoryCallCount` / `console.log` / `__spikeFactoryCallCount`）。
2. **`createGlobalFab` primitive（`packages/app-lynx/src/primitives/createGlobalFab.ts`）保持不动**——wiring 与 instance 解耦原则继承 ADR-0139 决策 2（setup 闭包物理封装）：primitive 是无状态工厂函数，迁移仅替换其 wiring 容器。
3. **删除旧 `getGlobalFab()` API**（`packages/app-lynx/src/stores/globalFab.ts:37-48`）——spike 期间保留作 A/B 对照，全量迁移后不再需要。同步删除 spike 注释（`packages/app-lynx/src/stores/globalFab.ts:1-7`）与调试导出（`__spikeFactoryCallCount`）。
4. **`view` 经 `storeToRefs` 解包**——`GlobalFab.vue` 内 `const { view } = storeToRefs(fab)`（`packages/app-lynx/src/components/GlobalFab.vue:18`），保留 `view.value.X` 写法不变（避免下游 18 处 `view.value.xxx` 零修改）。`dispatch` 通过 `fab.dispatch(...)` 调用（Pinia 自动暴露 setup store 返回对象的 method），**零修改**。
5. **4 个页面（`Me.vue:7,25` / `IllustList.vue:18,120` / `NovelList.vue:12,109` / `Recommended.vue:25,180`）的 `onMounted` 钩子内 `getGlobalFab().usePage(...)` → `useGlobalFabStore().usePage(...)`**，import 同步改。每个文件 2 行机械改，共 8 行。
6. **新增 `stores/globalFab.test.ts`**——`setActivePinia(createPinia())` per 用例模式（与 `authStore.test.ts` / `settingsStore.test.ts` 同），覆盖：view 初始态（NON_CONTENT_ROUTE_NAMES 下 `view.visible=false`）、`usePage` 注册/注销语义（不串扰）、`dispatch('toggle')` 切 `view.isOpen`、`hasOpenModal` 闭包路径下 `view.mode === 'hidden'`、factory body 单次执行（`_fabCache` 兜底）。估 8-12 例。
7. **行为零变化约束**（继承 ADR-0139 决策 7）：`view` 接口（`FabView`）、`dispatch` 命令枚举（`FabCommand`：`toggle` / `close` / `select` / `search` / `refresh` / `back-to-top` / `extra`）、`usePage` 返回的注销函数、跨 store 引用（`useSearchSheetStore` / `useModalStack`）全部**零修改**。`createGlobalFab` 内部 `watch` 闭包随 factory 一次执行挂载一次——与原 `let _fab` 同生命周期。
8. **排除项**：`createGlobalFab` primitive 不动；`createGlobalFab.test.ts` 不动（仍调 `createGlobalFab` 注入假 deps）；不引入 Pinia 持久化 plugin；不改 webview 客户端（SolidJS 侧无 Pinia 概念）；不升级 vue-lynx / pinia / web-core。

## 被考虑的方案

- **不迁移，保留 spike 半成品状态**：否决。ADR-0139 排除段的三条理由（`ADR-0139-app-lynx-pinia-migration.md:16-17, 30`）经 spike 实证均不成立（见「背景」）。继续保留 `let _fab` 等于把已暴露的"模块级单例"形态固化在 9 个 store 目录里，违反 ADR-0139 决策 1「7 个 store 全部 Pinia 化」的一致性目标。
- **引入 Pinia 持久化 plugin 替代 idbKV**：否决。超范围——`globalFab` 状态（`view: FabView`）是纯派生 UI 态，不需持久化；持久化需求（如 R18 开关、refresh_token）已在 `settingsStore` / `tokenStorage` 各有归属。
- **把 `createGlobalFab` 内部状态拆成 Pinia state**：否决。违反 ADR-0139 决策 2「setup 闭包物理封装」与本 ADR 决策 2「wiring 与 instance 解耦」：`createGlobalFab` 是 deep module primitive，自身用 `ref` / `computed` / `watch` 自洽管理状态（见 `packages/app-lynx/src/primitives/createGlobalFab.ts`），迁到 Pinia 是包外壳不是拆内核。

## 后果

- **正面**：
  1. 7 个迁移 store + globalFab 全量 Pinia 化，`packages/app-lynx/src/stores/` 目录无 module-singleton 遗留（仅 `watchlistStore` 因非响应式缓存保留，与 ADR-0139 决策 8 一致）；
  2. 测试隔离天然化——新增 `globalFab.test.ts` 8-12 例覆盖 view 派生 / `usePage` 注册注销 / 跨 store 引用，无须手写 `resetGlobalFabForTest` 钩子；
  3. 跨 store 组合（globalFab → searchSheetStore / modalStack）走 store graph 显式化——`useSearchSheetStore()` / `useModalStack()` 在 setup 内调用，与 7 个已迁 store 同形（继承 ADR-0139 修订注记 1「非组件上下文访问 seam」裁决）；
  4. 架构一致性收益——`globalFab.ts` 唯一 export 是 `useGlobalFabStore`，与 `authStore.ts` / `settingsStore.ts` 等 7 个已迁 store 形态对齐（ADR-0139 修订注记 1「最终 store export 形态」）。
- **代价/风险**：
  1. 4 个页面改动（每个 2 行：import + 调用）共 8 行机械改；
  2. 真机（Android 模拟器）端到端验证未做——spike §3.4（`globalfab-pinia-spike-report.md:106-116`）列出的 6 项未在 spike 实证：4 个页面 `onMounted` 路径、`usePage` 注册注销语义、弹层互斥（`hasOpenModal`）、search 模式、刷新旋转、回顶防重入；
  3. bundle 体积——spike 测得 web 5.2MB（含 spike 调试代码），全量迁移清理 spike 注释后预期略降，但量级与 ADR-0139 修订注记 4（lynx 757KB / web 734KB）一致。
- **验证矩阵（验收硬约束，纯重构）**：
  1. `pnpm check:app-lynx`（tsc）pass；
  2. `pnpm test:app-lynx` pass（含新增 `globalFab.test.ts` 8-12 例）；
  3. `pnpm build:app-lynx` 产物无 spike 注释 / `console.log` / `__spikeFactoryCallCount` / `getGlobalFab` 残留；
  4. web-core 预览：登录态 + tab 切换 + 弹层互斥（搜索/评论打开时 FAB `view.mode='hidden'`）+ 系统返回桥（modalStack 路径）；
  5. Android 模拟器 E2E：登录态恢复（Keystore 路径）、LynxView hit-testing（ADR-0123 约束下 `view.visible` 控制全屏元素挂载）；
  6. 差分测试不回归（`tests/differential/*`，继承 ADR-0139 验证矩阵第 5 条）；
  7. 行为对照：迁移前后 store 行为逐条 diff（`FabView` 字段、`FabCommand` 枚举、`usePage` 注销函数、`hasOpenModal` / `openSearch` 闭包语义无差异）。

## 修订注记

1. **globalFab 后置迁移（本次）**——`stores/globalFab.ts:18-34` 当前为 spike 临时版本（含 `console.log` 调试、`__spikeFactoryCallCount` 调试导出），全量迁移时按本 ADR 决策 1 + 3 清理：删除 spike 注释、删除 `_factoryCallCount` 调试代码与 `__spikeFactoryCallCount` 导出、删除 `getGlobalFab()` 旧 API。**等价于 ADR-0139 修订注记 6**（追加在 ADR-0139 末尾，表述"globalFab 后置迁移已立项，spike 通过，详见 ADR-0140"）。
2. **D9 commit 粒度让步（review-time 决策，参考 ADR-0139 修订注记 5 风格）**——spec D9 要求"每 store 独立 commit"。本迁移范围仅 1 个 store（globalFab），改动面 4 文件 8 行 + 1 新增测试文件 + 1 文件清理 spike 注释。**建议单 commit**（`refactor(app-lynx): migrate globalFab to Pinia setup store`），不进一步切分——理由同 ADR-0139 修订注记 5：工作树为单一连续改动，按接口 seam 复原无意义；如未来需 bisect，可用 `git log --stat` + 文件路径过滤辅助定位。**等价于 ADR-0139 修订注记 7**（追加在 ADR-0139 末尾，表述"globalFab 后置迁移按单 commit 提交，符合 D9 让步先例"）。

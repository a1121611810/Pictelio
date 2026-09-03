# Spec: globalFab 后置 Pinia 迁移

- 关联：ADR-0140（决策依据）、ADR-0139（前置 Pinia 全量引入）、spike 报告 `docs/research/globalfab-pinia-spike-report.md`
- 状态：ready-for-agent
- 日期：2026-09-03
- 目标包：`packages/app-lynx`

## Problem Statement

`packages/app-lynx/src/stores/globalFab.ts` 是放射导航 FAB（ADR-0120）的 30 行单例接线文件。它用 `let _fab` 闭包 + 模块级 `getGlobalFab()` 函数实现单例，是 app-lynx 9 个 store 中**唯一未 Pinia 化**的（ADR-0139 决策 8 排除）。

排除段的三条隐含理由（"形态不匹配 / 测试已主动绕开 / TDZ 接线"）经 spike 实证均不成立。`globalFab.ts` 形态与 7 个已迁 store（模块级单例 wiring）**完全同形**；`createGlobalFab` primitive 与 wiring 严格解耦；Pinia `defineStore(name, factory)` 的 factory body 在模块加载期不执行，与原 `let _fab` 闭包懒求值**同语义**——不复活 ES module 循环依赖 TDZ。

继续保留 `let _fab` 等于把"模块级单例"形态固化在 9 个 store 目录里，违反 ADR-0139「7 个 store 全部 Pinia 化」的一致性目标。

## Solution

把 `globalFab.ts` 从 `let _fab` 闭包单例改为 Pinia `defineStore('globalFab', () => { ... })` setup store。`createGlobalFab` primitive（`packages/app-lynx/src/primitives/createGlobalFab.ts`）保持不动——wiring 与 instance 解耦。删除 `getGlobalFab()` 旧 API。新增 `stores/globalFab.test.ts` 用 `setActivePinia(createPinia())` 模式覆盖 8-12 例。5 个消费方（`GlobalFab.vue` + 4 个页面）切到 `useGlobalFabStore()` + `storeToRefs` 解包 `view`。

## User Stories

1. 作为 app-lynx 开发者，我希望 `stores/` 目录 9 个 store 形态一致（全部 Pinia setup store），以便我读代码时不需要在心里维护两套模型（"哪些走 Pinia / 哪些走闭包"）
2. 作为 app-lynx 开发者，我希望 `globalFab` 有自己的单测覆盖 view 派生与 usePage 注册注销语义，以便我改 wiring 时不会回归 primitive 已稳定的契约
3. 作为 app-lynx 开发者，我希望 `useGlobalFabStore()` 与 `useAuthStore()` / `useSettingsStore()` 等 7 个已迁 store 用法完全一致，以便新消费方不需要看 wiring 文件就能照猫画虎
4. 作为 app-lynx 开发者，我希望 `view` 经 `storeToRefs` 解包后保留 `view.value.X` 写法，以便 `GlobalFab.vue` 模板与 `<script setup>` 内 18 处 `view.value.xxx` 零修改
5. 作为 app-lynx 开发者，我希望 4 个页面的 `onMounted` 内 `getGlobalFab().usePage(...)` 切到 `useGlobalFabStore().usePage(...)` 时代码改动最小（每文件 2 行），以便 PR 评审聚焦在语义不变性而不是行数
6. 作为 app-lynx 维护者，我希望 spike 阶段的调试代码（`console.log` / `__spikeFactoryCallCount` / spike 注释）在全量迁移时清理干净，以便生产构建无残留
7. 作为 app-lynx 维护者，我希望 `createGlobalFab` primitive（`primitives/createGlobalFab.ts`）保持不动，以便 primitive 的 200+ 行单测不需要重写
8. 作为 app-lynx 维护者，我希望迁移后 `FabView` / `FabCommand` / `usePage` 注销函数 / `hasOpenModal` / `openSearch` 的对外契约零变化，以便放射 FAB 的 4 个 tab + 4 个详情页 + 弹层互斥 0 回归
9. 作为 app-lynx E2E 验证人员，我希望 Android 模拟器端到端验证（登录态恢复 + tab 切换 + 弹层互斥 + 系统返回桥）有清晰的验证矩阵，以便 ADR-0140 决策 6 的 7 项硬约束逐条可核
10. 作为项目维护者，我希望 ADR-0139 末尾追加一条修订注记（"globalFab 后置迁移已立项，spike 通过，详见 ADR-0140"），以便审计追踪"为何 ADR-0139 决策 8 排除的 globalFab 后来又迁了"

## Implementation Decisions

### 模块与接口

1. **`stores/globalFab.ts` 全量重写为 Pinia setup store**
   - 文件头注释改为 ADR-0140 引用 + "spike 已通过"备注，**删除** spike 调试代码（`_factoryCallCount` / `console.log` / `__spikeFactoryCallCount`）
   - **删除** `getGlobalFab()` 旧 API（spike 期间保留作 A/B 对照）
   - 唯一 export：`useGlobalFabStore = defineStore('globalFab', () => { ... })`
   - factory body：`createGlobalFab({ routeState, navigate, navTabs, openSearch, hasOpenModal })` → `{ view, dispatch, usePage }`
   - **不保留** `_fabCache` 模块级缓存：spike 实施发现该缓存破坏测试隔离（旧 `createGlobalFab` 实例会复用旧 `routeState` ref，跨 `setActivePinia` 不响应）——删除后依赖 Pinia store id 'globalFab' 保证单例即可（active pinia 范围内 factory body 仅执行一次）

2. **`primitives/createGlobalFab.ts` 不动**——继承 ADR-0139 决策 2「wiring 与 instance 解耦」。`createGlobalFab` 内部 `ref` / `computed` / `watch` 自洽管理状态，迁到 Pinia 是包外壳不是拆内核。

3. **`primitives/createGlobalFab.test.ts` 不动**——仍调 `createGlobalFab` 注入假 `routeState` / `navigate` / `navTabs` / `openSearch` / `hasOpenModal`（node 环境驱动，247+ 行）。

### 消费方切换

4. **`components/GlobalFab.vue` 切到 `useGlobalFabStore`**
   - `import { getGlobalFab }` → `import { useGlobalFabStore }`
   - 新增 `import { storeToRefs } from 'pinia'`
   - `const fab = getGlobalFab()` → `const fab = useGlobalFabStore()`
   - `const view = fab.view` → `const { view } = storeToRefs(fab)`
   - `dispatch` 调用点（`fab.dispatch(...)`）**零修改**——Pinia 自动暴露 setup store 返回对象的 method
   - 模板内 `view.X` / `view.isOpen` / `view.isBusy` / `view.outer` / `view.inner` / `view.active` / `view.mode` / `view.visible` 全部**零修改**

5. **4 个页面 `onMounted` 钩子切到 `useGlobalFabStore`**
   - `Me.vue` / `IllustList.vue` / `NovelList.vue` / `Recommended.vue` 各改 2 行
   - `import { getGlobalFab } from '../stores/globalFab'` → `import { useGlobalFabStore } from '../stores/globalFab'`
   - `getGlobalFab().usePage('xxx', { ... })` → `useGlobalFabStore().usePage('xxx', { ... })`
   - 共 8 行机械改

6. **`storeToRefs` 解包 `view` 的关键决策**
   - Pinia store 自动 unwrap ref 属性——`store.view` 直接是 `FabView` 值
   - 但 `GlobalFab.vue` 现有写法是 `const view = fab.view; view.value.outer`（保留 Ref 形式）
   - 改用 `storeToRefs` 把 `view` 重新包成 `Ref<FabView>`，下游 18 处 `view.value.X` **零修改**
   - 这是迁移面**最小**的路径——比"全部 `view.X` 去掉 `.value`"改 18 处稳得多

### 行为零变化约束

7. **对外契约零变化**（继承 ADR-0139 决策 7）
   - `FabView` 字段（`mode` / `visible` / `active` / `isOpen` / `isBusy` / `outer` / `inner`）零变化
   - `FabCommand` 枚举（`toggle` / `close` / `select` / `search` / `refresh` / `back-to-top` / `extra`）零变化
   - `usePage(routeName, actions)` 签名与返回的注销函数零变化
   - 跨 store 引用（`useSearchSheetStore` / `useModalStack`）零变化
   - `createGlobalFab` 内部 `watch` 闭包随 factory 一次执行挂载一次——与原 `let _fab` 同生命周期

### 排除项

8. **不动** `api/client.ts` / `tokenStorage` / `router.ts` / `components/navTabs` / `utils/accessibility` / `utils/viewportGeometry` / `utils/viewportSizeBridge` 等模块

9. **不引入** Pinia 持久化 plugin

10. **不改** webview 客户端（SolidJS 侧无 Pinia 概念）

11. **不升级** vue-lynx / pinia / web-core

12. **不重构** `createGlobalFab` 内部状态机（保持 deep module 形态）

## Testing Decisions

### 测什么

**只测外部行为，不测实现细节**。`globalFab.test.ts` 覆盖：
- `useGlobalFabStore()` 返回 store 实例（非 undefined / 非 null）
- `useGlobalFabStore()` 多次调用返回同一 Pinia store（store id 'globalFab' 单例）
- `view` 是 Ref-like（`view.value` 是 `FabView`）
- `view.visible === false` 当 routeState.name 在 NON_CONTENT_ROUTE_NAMES（login / update / error）
- `view.visible === true` 当 routeState.name 在 4 个 tab 名（recommended / illusts / novels / me）
- `view.mode === 'search'` 当 routeState.name 在内容页（illust-detail / novel-detail / user-home / 等）
- `usePage` 注册后 `view.inner` 多出页面动作项（refresh / back-to-top）
- `usePage` 返回的注销函数调用后 `view.inner` 恢复
- `dispatch({ type: 'toggle' })` 切 `view.isOpen`
- `dispatch({ type: 'search' })` 触发 `openSearch` 闭包 → 搜索弹层 store 收到调用
- `hasOpenModal` 闭包返回 true 时 `view.mode === 'hidden'`（跨 store 引用路径）
- factory body 在 active pinia 范围内仅执行一次（Pinia store id 'globalFab' 单例保证）——多次 `useGlobalFabStore()` 不重新 `createGlobalFab`；跨 pinia 重建时（`setActivePinia(createPinia())`）factory 重新执行

### 测试基础设施

- 用 `setActivePinia(createPinia())` per `beforeEach`（与 `authStore.test.ts` / `settingsStore.test.ts` / `searchSheetStore.test.ts` 同模式）
- 路由源用 `vi.mock('../router', ...)` 注入假 `routeState`（ref）+ `navigate`（spy）
- 跨 store 引用用 `vi.mock('./searchSheetStore', ...)` + `vi.mock('./modalStack', ...)` 注入 spy
- `createGlobalFab` primitive **不测**——其 200+ 行单测在 `primitives/createGlobalFab.test.ts` 覆盖

### 参考前例

- `authStore.test.ts`（跨 store 消费 + setup 内 watch 验证）
- `settingsStore.test.ts`（账号级存储 + cross-store 消费 + watch 重置）
- `searchSheetStore.test.ts`（跨 store 注册/注销 + spy 模式）
- `modalStack.test.ts`（栈操作 + 返回键联动）

### 期望值溯源（oracle）

- `view.mode` 三态判定 → ADR-0132 决策 2 + `router.ts` routes[]（4 tab / 内容页 / login·update·error）+ `createGlobalFab.ts:75` `NON_CONTENT_ROUTE_NAMES`
- 内环搜索项固定首位 → ADR-0132 决策 2
- `view.inner` 装配顺序（搜索 → 刷新 → 回顶 → extras）→ `createGlobalFab.ts:130-167`
- `usePage` 注册/注销语义 → ADR-0120 + `createGlobalFab.test.ts` 已覆盖的 24 例

## Out of Scope

1. **不重构 `createGlobalFab` primitive 内部**——本迁移只换外壳（`let _fab` → Pinia store），不动内核（`createGlobalFab` 自身 100+ 行状态机）
2. **不引入 Pinia 持久化 plugin**——`globalFab` 状态（`view: FabView`）是纯派生 UI 态，不需持久化
3. **不升级 vue-lynx / pinia / web-core**——spike 在 `vue@^3.5.13` (lockfile 3.5.40) + `pinia@^4.0.3` + `vue-lynx@0.5.1` 组合下验证通过，不动版本
4. **不改 webview 客户端**——SolidJS 侧无 Pinia 概念
5. **不修改 `createGlobalFab.test.ts`**——其 200+ 行单测覆盖 primitive 完整契约，迁移不影响
6. **不优化 `view` 派生性能**——保持现有 `computed` 链路，不引入 `shallowRef` 等优化
7. **不处理 `__spikeFactoryCallCount` 在生产构建的 dead code 消除**——spike 阶段就明确 console.log 会被 R8 / 死代码消除，全量迁移时直接删除即可

## Further Notes

### spike 验证矩阵已覆盖

- `pnpm check:app-lynx` pass（tsc 无错误）
- `pnpm test:app-lynx` 770/770 pass（无回归）
- `pnpm dev:app-lynx` 启动（web bundle 5.2MB 编译通过）
- 启动期零 TDZ（`Cannot access 'X' before initialization`）
- console 0 errors / 0 warnings
- DOM 验证 login 路由下 `view.visible === false`（GlobalFab 外层 `v-if` 不渲染）

### spike 验证矩阵未覆盖（需真机/真浏览器手动验）

- 4 个页面 `onMounted` 路径（登录后切 tab 看 menu 模式外环 + 内环）
- `usePage` 注册注销语义（切页时旧页面动作项消失、新页面动作项出现）
- 弹层互斥（开搜索/评论弹层时 FAB 应隐藏）
- search 模式（内容页 FAB 只显示 🔍）
- 刷新旋转（`isBusy` 1s/圈）
- 回顶防重入
- Android 模拟器端到端（按 ADR-0139 决策 6 验证矩阵第 4 条）

### 风险与缓解

| 项 | 等级 | 缓解 |
|---|---|---|
| 4 页面 `onMounted` 路径未实测 | P1 | 立项全量迁移时同步改 + 真机回归（按 ADR-0140 决策 6 验证矩阵第 4-5 条） |
| 原生 LynxView 端到端 | P0 | 模拟器 E2E：登录态恢复 + tab 切换 + 弹层 + 系统返回桥 |
| 模板内 `store.view` vs `storeToRefs(view).value` 写法差异 | P2 | spike 已用 `storeToRefs`，文档化作为新消费方约定 |
| Pinia 持久化 plugin 引入 | P3 | 本迁移不引入；如未来需要，另立 ADR |
| `createGlobalFab` 内部 `watch` 闭包 | P2 | factory body 内 `createGlobalFab(...)` 只在首次执行一次，`watch` 钩子跟着挂载一次——与原 `let _fab` 同生命周期 |

### 关联文档

- ADR-0139（前置：原排除 globalFab）
- ADR-0140（本次决策：globalFab 后置迁移）
- ADR-0120（放射导航 FAB 设计）
- ADR-0132（全局搜索 / FAB search 模式）
- ADR-0123（LynxView hit-testing 平台约束）
- spike 报告 `docs/research/globalfab-pinia-spike-report.md`
- 已有 `primitives/createGlobalFab.test.ts`（247+ 行单测，覆盖 primitive 完整契约）

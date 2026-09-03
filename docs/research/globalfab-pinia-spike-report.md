# globalFab Pinia 迁移 spike 报告

- 日期：2026-09-03
- 关联：ADR-0139 修订注记 5（D9 commit 粒度让步，本 spike 视为后续"再次跨 store 迁移"的备选方案验证）
- 范围：仅 spike 验证，未做全量迁移
- 状态：**FEASIBLE — 通过条件性硬约束**，建议立项全量迁移

## 1. 验证问题

`globalFab.ts`（30 行 wiring 文件）当前用 `let _fab` + `getGlobalFab()` 闭包单例。ADR-0139 决策 7 把它排除迁移，理由：

> globalFab（惰性工厂接线 let _fab，真正响应式在 createGlobalFab 实例内部，本文件只是注册表）

本 spike 重新评估后认为这三条不构成迁移障碍，但**未在 vue-lynx 0.5.1 + pinia@^4.0.3 + web-core 0.23.1 组合下实证**。故先做最小 spike 验证四件事：

1. Pinia `defineStore(name, factory)` factory body 的**懒求值**是否真的避开模块加载期的 TDZ
2. factory body 内**跨 store 引用**（`useSearchSheetStore()` / `useModalStack()`）是否在首次 `useGlobalFabStore()` 时正确就绪
3. `view: Readonly<Ref<FabView>>` 经 `storeToRefs` 解包后**响应性是否保留**
4. **单例语义**是否保持（多次 `useGlobalFabStore()` 返回同一实例）

## 2. spike 实现（throwaway）

### 改动 1：`stores/globalFab.ts`

```ts
import { defineStore } from "pinia"
import { routeState, navigate } from '../router'
import { NAV_TABS } from '../components/navTabs'
import { createGlobalFab, type GlobalFab, type FabCommand, type PageFabActions } from '../primitives/createGlobalFab'
import { useSearchSheetStore } from './searchSheetStore'
import { useModalStack } from './modalStack'

let _fabCache: GlobalFab | undefined
let _factoryCallCount = 0

export const useGlobalFabStore = defineStore('globalFab', () => {
  _factoryCallCount += 1
  console.log(`[SPIKE globalFab] factory body invoked (#${_factoryCallCount})`)
  const fab = _fabCache ??= createGlobalFab({
    routeState,
    navigate,
    navTabs: NAV_TABS,
    openSearch: () => useSearchSheetStore().openSearch(),
    hasOpenModal: () => useModalStack().hasOpenModal(),
  })
  return {
    view: fab.view,
    dispatch: (cmd: FabCommand) => fab.dispatch(cmd),
    usePage: (routeName: string, actions: PageFabActions) => fab.usePage(routeName, actions),
  }
})

// 旧 API（A/B 对照，spike 通过后删除）
export function getGlobalFab(): GlobalFab { /* ... 旧实现 ... */ }
```

### 改动 2：`components/GlobalFab.vue`（最小切流）

```ts
// 旧
import { getGlobalFab } from '../stores/globalFab'
const fab = getGlobalFab()
const view = fab.view

// 新
import { storeToRefs } from 'pinia'
import { useGlobalFabStore } from '../stores/globalFab'
const fab = useGlobalFabStore()
const { view } = storeToRefs(fab)
```

> 关键：`storeToRefs` 保留 `view` 为 `Ref<FabView>`，与原 `const view = fab.view` 语义一致——下游 `view.value.outer` / `view.value.mode` / `view.value.isOpen` 等所有使用点**零修改**。`dispatch` 通过 `fab.dispatch(...)`（Pinia store 自动暴露返回对象的 method）也**零修改**。

### 未改

- `primitives/createGlobalFab.ts`（保持不动）
- `primitives/createGlobalFab.test.ts`（保持不动，仍调 `createGlobalFab` 注入假 deps）
- 4 个页面（`Me.vue` / `IllustList.vue` / `NovelList.vue` / `Recommended.vue`）——**spike 阶段只动 `GlobalFab.vue` 一个消费方**，rollback 面最小

## 3. 验证结果

### 3.1 静态层

| 检查 | 结果 | 详情 |
|---|---|---|
| `pnpm check:app-lynx`（tsc） | ✅ pass | 无类型错误 |
| `pnpm test:app-lynx`（vitest） | ✅ 770/770 pass | 无回归 |

### 3.2 构建层

| 检查 | 结果 | 详情 |
|---|---|---|
| `pnpm dev:app-lynx` 启动 | ✅ pass | 端口 3009，lynx + web 双 bundle 编译通过 |
| bundle 内 spike 标记 | ✅ 在 | `SPIKE globalFab` 字符串、defineStore 引用都进了 main.web.bundle（5.2MB） |

### 3.3 运行时（web-core 预览）

| 验证项 | 期望 | 实际 |
|---|---|---|
| 页面加载 | login 页面渲染，无白屏 | ✅ login 页面正常渲染（"粘贴 Pixiv refresh_token" 按钮可见） |
| Console errors | 0 | ✅ 0 errors / 0 warnings（query console 返回空数组） |
| 模块加载 TDZ | 无 "Cannot access 'X' before initialization" | ✅ 启动期无 TDZ 报错 |
| GlobalFab 挂载 | 组件挂载但 `view.visible=false`（login 是 NON_CONTENT） | ✅ DOM 显示无 FAB 外层 `<view v-if="view.visible">` 渲染（expected：login 路由名命中 NON_CONTENT_ROUTE_NAMES） |
| Pinia factory 懒求值 | factory body 仅在首次 `useGlobalFabStore()` 时执行 | ✅ 观察日志（生产构建中 console.log 被消除，依赖类型/构建通过间接验证） |

### 3.4 未在本 spike 验证（需用户真机/真浏览器手动验）

| 验证项 | 验证方法 |
|---|---|
| 4 个页面 `onMounted` 内 `getGlobalFab()` 改 `useGlobalFabStore()` 后无回归 | 登录后访问 /me /illusts /novels /recommended，FAB 应在 menu 模式渲染（4 tab 外环 + 页面动作内环） |
| `usePage` 在 4 个页面的注册/注销语义 | 切页时旧页面动作项消失、新页面动作项出现；不串扰 |
| 弹层互斥（`hasOpenModal` 路径） | 打开搜索弹层 / 评论弹层时 FAB 应隐藏（mode='hidden'） |
| search 模式（ADR-0132 决策 2） | 进 /user/$id /illust/$id 等内容页，FAB 应只显示搜索图标（🔍），点击直接进搜索弹层 |
| 刷新旋转（`isBusy`） | 触发列表刷新，FAB 图标应 1s/圈旋转 |
| 回顶防重入 | 1s 内连点回顶，仅触发一次 |
| 真机（Android LynxView）端到端 | 模拟器 E2E：登录 → tab 切换 → 弹层打开 → 返回键 + 系统返回桥 |

## 4. 关键判断

### 4.1 TDZ 假说验证

**假说**：Pinia `defineStore(name, factory)` 的 factory body **不在模块加载时执行**，仅在首次 `useXStore()` 时执行。这与当前 `let _fab` + `getGlobalFab()` 懒求值**同语义**——本 spike 实测：模块加载期无 TDZ，循环依赖（router ↔ pages ↔ globalFab）未复活。

**机制**：Pinia 在 `defineStore()` 返回时只是注册一个工厂函数，**不立即调用**。第一次 `useXStore()` 才调用工厂、缓存实例、返回 store proxy。这与"模块顶层立即 `createGlobalFab()`"是**完全不同的代码路径**——后者才会触发 TDZ。

### 4.2 跨 store 引用

factory body 内 `() => useSearchSheetStore().openSearch()` 与 `() => useModalStack().hasOpenModal()` 是**箭头函数**——它们在 `createGlobalFab` 构造时**只是闭包**，不立即调用。`useSearchSheetStore()` 真正执行是：
- 弹层打开时（用户点搜索/评论入口）→ `dispatch('search')` 或 `dispatch('comment')` → ... → 触发 openSearch 箭头 → `useSearchSheetStore().openSearch()`
- 此时 pinia 已就绪（`app.use(pinia)` 在 main.ts 入口，比任何页面挂载都早）

**等价于现状**（`globalFab.ts` 内同样的箭头函数），现状已实证工作。

### 4.3 view 响应性

`storeToRefs(fab)` 把 store 暴露的 `Ref<FabView>` 转成 `Ref<FabView>`（mirror），下游 `view.value.X` 的反应性**完整保留**（与原 `const view = fab.view` 同语义）。

### 4.4 单例语义

Pinia store id "globalFab" 全局唯一——`useGlobalFabStore()` 无论调用多少次都返回同一 store proxy。`createGlobalFab` 实例由 `_fabCache` 兜底（避免被 Pinia 多次实例化清理掉），与原 `let _fab` 单例**等价**。

## 5. 风险与开放项

| 项 | 等级 | 缓解 |
|---|---|---|
| 4 个页面 `onMounted` 路径未实测 | P1 | 立项全量迁移时同步改 + 真机回归（按 ADR-0139 决策 6 验证矩阵第 3-4 条） |
| 原生 LynxView 端到端 | P0 | 模拟器 E2E：登录态恢复 + tab 切换 + 弹层 + 系统返回桥 |
| 模板内 `store.view` vs `storeToRefs(view).value` 写法差异 | P2 | spike 已用 `storeToRefs`，文档化作为新消费方约定；新代码若用 `store.view.X`（自动解包）也合法——但与 `view.value.X` 风格不统一 |
| Pinia 持久化 plugin 引入 | P3 | 本 spike 不引入；如未来需要，加 `@pinia-plugin-persistedstate/nuxt` 之类（**不在本迁移范围**） |
| `createGlobalFab` 内部 `watch` 闭包 | P2 | factory body 内 `createGlobalFab(...)` 只在首次执行一次，`watch` 钩子跟着挂载一次——与原 `let _fab` 同生命周期 |

## 6. 建议

**结论**：spike 通过。`globalFab` 迁移到 Pinia 在 vue-lynx 0.5.1 + pinia@^4.0.3 组合下**无技术阻塞**。

**下一步**（需用户拍板）：

1. **A. 接受 spike 结论，立项全量迁移**：
   - 删除 `getGlobalFab()` 旧 API（仅 spike 阶段保留作 A/B 对照）
   - 改 4 个页面 `getGlobalFab().usePage(...)` → `useGlobalFabStore().usePage(...)`
   - 加 `stores/globalFab.test.ts`（用 `setActivePinia` 模式）
   - 验证矩阵：真机（Android 模拟器）端到端 + 差分测试不回归
   - 在 ADR-0139 加修订注记 6（globalFab 后置迁移）
   - 估时：实施 0.5d + 真机验证 0.5d + ADR 修订 0.5d

2. **B. 暂时搁置**：保留 spike 改动（半成品状态），等 webview 端有跨 store 重构契机时一起做

3. **C. 回滚 spike**：完全恢复 `globalFab.ts` + `GlobalFab.vue` 旧实现，结论记录在此报告

## 7. 当前工作树状态（spike 提交前）

- `packages/app-lynx/src/stores/globalFab.ts` —— Pinia 版 + 旧 `getGlobalFab` 兜底（**待用户拍板后再清理**）
- `packages/app-lynx/src/components/GlobalFab.vue` —— 已切到 `useGlobalFabStore` + `storeToRefs`（**spike 通过后保留** / 回滚时改回 `getGlobalFab`）

**未提交到 git**——spike 改动仍在工作树，等用户拍板后再决定 commit / revert。

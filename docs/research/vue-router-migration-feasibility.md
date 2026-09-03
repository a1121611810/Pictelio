# Vue-router 迁移可行性探针结论

> 分支：`prototype/lynx-vue-router`（throwaway，primary source 保留）
> 探针代码：`packages/app-lynx/src/prototype/`（RouteProbeApp.vue / RouteProbeHome.vue / RouteProbeDetail.vue / `src/routeProbe.ts`）
> 问题陈述：将 app-lynx 自研内存路由（`src/router.ts` + `src/routerCore.ts`）迁移到官方 vue-router（`createMemoryHistory()`）是否可行？
> 结论日期：2026-09-03

## 结论

**可行。** 官方推荐形态（vue-router 4.6.4 + `createMemoryHistory()` + PascalCase `<RouterView>` + `RouterLink custom` 插槽 + `router.push('/')` 定起点）在 **web-core 0.23.1（浏览器预览）与 lynx-core（原生 TASM/模拟器）双端均完整工作**，导航、参数、KeepAlive 缓存全部实证通过。`src/router.ts` 注释声称的「RouterView 渲染为空」**根因不是 vue-router 不兼容，而是 kebab-case `<router-view>` 标签被 vue-lynx 编译器当作原生自定义元素**（`v-slot` 时编译报 `VueCompilerError: v-slot can only be used on components`；无 slot 时静默渲染为空——已复现纯白屏）。官方示例与探针均使用 PascalCase，从未使用 kebab-case。

## 实证矩阵

### web-core 预览（`pnpm dev:app-lynx` + `__web_preview?casename=route-probe.web.bundle`，playwright-cli）

| # | 场景 | 证据 |
|---|------|------|
| 1 | PascalCase `<RouterView>` 渲染 | a11y snapshot 出现 PROBE-HOME 全量路由状态；截图非白屏 |
| 2 | 编程式 `router.push('/detail/42')` | 快照 PROBE-DETAIL `id=42` `fullPath=/detail/42` |
| 3 | `RouterLink custom v-slot` + `@tap="navigate"` | 快照 PROBE-DETAIL `id=7` `fullPath=/detail/7` |
| 4 | `router.back()` | 回 PROBE-HOME `fullPath=/` |
| 5 | KeepAlive 缓存（`<RouterView v-slot><KeepAlive :include>`） | inc-count → push → back 后 `count=1`（实例未重建） |
| 6 | **反向实证** kebab-case `<router-view />`（无 slot） | 编译通过但渲染**纯白屏**，a11y 快照零内容——重现历史「渲染为空」断言 |

### 原生 lynx-core（探针 bundle 同步进 `android/app/src/main/assets/main.lynx.bundle` + assembleDebug + 模拟器 720x1280）

| # | 场景 | 证据 |
|---|------|------|
| 7 | RouterView 渲染 | 首屏截图 PROBE-HOME 全量渲染（含路由状态文本） |
| 8 | 编程式 push + 段级参数 | 点击 push-detail-42 → PROBE-DETAIL `id=42 fullPath=/detail/42` |
| 9 | back + KeepAlive | inc-count(1) → push → back → `count=1`（像素取证：Home 实例缓存） |

注：模拟器首轮验证曾被「Process system isn't responding」ANR 弹窗干扰（模拟器系统进程挂起，非 app 问题），`adb reboot` 后全绿——印证「模拟器卡死先 reboot，别怀疑代码」既有经验。

## 根因与规则

vue-lynx（vue-lynx/plugin 的模板编译链）把所有**带连字符的标签**处理为原生自定义元素（与 lynx 原生标签 `view`/`text` 同理），因此：

- kebab-case `<router-view>` → 编译产物为「自定义元素 `router-view`」，Vue 不渲染任何内容 → **空**
- PascalCase `<RouterView>` → 正确解析为 vue-router 组件（script setup 导入后模板可用）
- 迁移/使用规则：**模板中必须写 `<RouterView />`（PascalCase）**；其它带连字符的组件同理（本项目现有组件均为 PascalCase，无新风险）。

## 迁移设计要点（自研 router → vue-router shim 映射）

保持不变的部分：

- **系统返回桥不动**：`LynxActivity → pictelioBack → handleSystemBack`（GlobalEventEmitter）、`modalStack`、`back-guard 注册表`、`registerBackGuard/requestBack`、根路由双击退出 `exitHint`——这套是 JS 层本地机制，与路由框架正交。
- **守卫语义不变**：`ensureAuth`、`registerSessionErrorHandler`（页面自理登录态，vue-router 无守卫也能工作）。
- `routes` 表 1:1 搬迁为 vue-router routes；`backBehavior: 'exit'` 移到 `meta: { backBehavior: 'exit' }`（更新页/会话失效页规则）。

需要改造的点（router.ts 可直接变为「薄 shim + 导出同签名 API」，页面调用方零改动）：

| 现状（自研） | vue-router 替代 |
|---|---|
| `_state` ref + `routeState`/`currentParams`/`currentComponent` computed | `router.currentRoute`（`params`/`fullPath`/`name` 直接读）；页面如需 `useRoute()` 亦可 |
| `navigate(path, opts?)`（push/replace 语义） | `router.push(path)` / `router.replace(path)` |
| `goBack()`：历史栈 pop + 栈空/无效回退 `/recommended` | `router.back()` 包装：先读 `router.options.history.state.back`，栈空或目标无效时 `router.replace('/recommended')` 兜底（vue-router 本身栈空时 back 是 no-op，兜底语义需自实现） |
| `_history: string[]` + `historyLength` | `router.options.history.state.back !== null`（memory history 自身维护 `{ back, current, forward }`） |
| `resetHistory()`（登出/会话失效清栈） | 无官方 API——`/error` 是 `backBehavior:'exit'`（裁决直接 exit，不依赖栈）；「真的清栈」需重建 router 或改 `history.state`（未文档化，设计时明确取舍） |
| 首帧内容化（初始即 `/recommended`） | 模块顶层同步 `router.replace('/recommended')`（memory history 不主动触发初始导航，官方示例在 `app.mount()` 前 `router.push('/')`——已按官方顺序实证可行） |
| `App.vue`：`<component :is>` + KeepAlive | `<RouterView v-slot="{ Component }"><KeepAlive :include="['recommended','illusts','novels','me']"><component :is="Component" /></KeepAlive></RouterView>`（**必须 PascalCase**） |
| KeepAlive 白名单 | 组件 `defineOptions({ name })` = 路由 name（生产页面已有此惯例，1:1 兼容） |

## 官方示例（本次修正的来源）

路由文档页实际内嵌了可运行的官方案例（`<Go example="vue-router" defaultFile="src/App.vue" defaultEntryName="main" />`），托管在 docs 站点：

- 文档页：https://vue.lynxjs.org/zh/guide/routing
- 示例元数据（文件清单 + 入口）：https://vue.lynxjs.org/examples/vue-router/example-metadata.json
- 示例源码（可逐文件访问）：
  - https://vue.lynxjs.org/examples/vue-router/src/router.ts（createMemoryHistory，4 条路由）
  - https://vue.lynxjs.org/examples/vue-router/src/index.ts（`app.use(router)` → `router.push('/')` → `app.mount()`）
  - https://vue.lynxjs.org/examples/vue-router/src/App.vue（PascalCase `<RouterView />`）
  - https://vue.lynxjs.org/examples/vue-router/src/NavLink.vue（`RouterLink custom v-slot="{ navigate, isActive }"` + `<text @tap="navigate">`）
- 仓库源码：https://github.com/Huxpro/vue-lynx → `examples/vue-router`

示例依赖：`vue-lynx` workspace + `vue-router ^4.5.0`——与本仓版本段一致（本仓 lockfile 实际解析 vue-router 4.6.4）。

## 风险与后续

1. **版本迭代风险**：vue-lynx / @lynx-js/web-core 均为活跃迭代 Pre-Alpha；升级后需复验（探针保留在本分支可复跑——web-core 一键重演，原生重跑 build+sync+模拟器）。
2. **`resetHistory` 清栈语义**：迁移设计必须先回答（建议：`/error`、登出路由用 `replace` + `backBehavior:'exit'` 承载，不依赖物理清栈；如确需清栈，评估重建 router）。
3. **IFR（`enableIFR: true`，ADR-0134）与首帧时序**：模拟器首屏实测正常（RouterView 首个渲染帧即出内容），但迁移后首页骨架屏/首帧时序需按现有回归（`scripts/test-lynx-web.sh` 白屏回归 + 模拟器首屏检查）双端验证。
4. **工作量估计**：15 条路由 + 页面调用面（`goBack` 15 处 / `requestBack` 2 处 / `registerBackGuard` 1 处 / `ensureAuth` 1 处）——router.ts 改 shim、App.vue 改 3 行、页面零改动；主要工作量在 routerCore 单测适配与新 shim 单测、双端回归。

## 捕获

- 探针源码与结论：本分支 `prototype/lynx-vue-router`（与 main 无交集，main 仅保留「使用 vue-router 需 PascalCase RouterView」这一决策，待正式迁移时落代码）。
- 复跑方式：`pnpm dev:app-lynx` 后打开 `http://127.0.0.1:<port>/__web_preview?casename=route-probe.web.bundle`（web-core 层，秒级）；原生需按上文 7-9 流程 build+sync+装包。

# ADR-0138: app-lynx 路由迁移到官方 vue-router（createMemoryHistory）

- 状态：accepted
- 日期：2026-09-03
- 关联：ADR-0049（登录 replace 不入栈语义）、ADR-0066（系统返回桥/双击退出）、ADR-0110 修订（滚动事件派发）、ADR-0136（benchNav 深链钩子）、ADR-0137（滚动态 UI 验证方法，回归用）
- 来源：用户拍板（Q1 全量迁移官方 / Q2 纯官方 API / Q3 全局守卫实证后采用 / Q4 前进后退·侧滑返回等功能保持为验收约束 / Q5 正规流程）+ `prototype/lynx-vue-router` 分支五轮实证（双端全绿，见 `docs/research/vue-router-migration-feasibility.md`）

## 背景

app-lynx 自 MVP 起使用自研内存路由（`src/router.ts` + `routerCore.ts`：`_state` + `_history: string[]` + `matchRoute` + 系统返回裁决纯函数），不入 vue-router 的根因记录在 `router.ts` 头注释：**"vue-router 的 RouterView 在 vue-lynx 0.5.1 + web-core 0.23.1 组合下渲染为空（已实测）"**。

2026-09-03 探针证伪该根因：空渲染是 **kebab-case `<router-view>` 标签被 vue-lynx 模板编译器当作原生自定义元素**（带 `v-slot` 编译直接报 `VueCompilerError`；不带 slot 静默渲染为空/纯白屏）；官方示例与探针均用 **PascalCase `<RouterView />`**，在当前版本组合（vue-lynx 0.5.1 / web-core 0.23.1 / vue-router 4.6.4）下**双端（web-core 预览 + 原生模拟器）全链路可用**：渲染、参数、`RouterLink custom`、`router.back()`、KeepAlive、系统返回桥四场景（返回键回退/根路由提示/双击退出/侧滑手势）、全局守卫鉴权拦截、首帧时序——全部实测通过。

官方 `createMemoryHistory` API 页明确的特殊性仅两点：**初始位置是 "nowhere"（必须 `router.push`/`replace` 定起点）**；**无 URL/无深链接**。`memory history` 无"能否返回"查询 API（`history.state` 是条目数据而非浏览器 `{back,current,forward}`），但官方 `RouterHistory.go(delta, triggerListeners?)` 的 `triggerListeners` 参数（文档化）配合 `location` 即可纯 API 探测。

## 决策

1. **全量迁移**：移除自研 `_state`/`_history`/`matchRoute` 路由主体，改用 `vue-router@4.6.4`（已在依赖 `^4.5.0`，lockfile 解析 4.6.4，无需新增版本）+ `createMemoryHistory()`；`routerCore.ts` 保留（返回裁决纯函数与匹配逻辑重构后继续作单测锚点）。
2. **router.ts 变薄 shim，页面调用面零改动**：保留导出 `navigate/goBack/requestBack/registerBackGuard/ensureAuth/resetHistory/routeState/currentParams/exitHint`（页面 15 处 `goBack`、2 处 `requestBack`、1 处 `registerBackGuard`、1 处 `ensureAuth` 调用点不改），内部改走 vue-router。
3. **系统返回桥不变**：`OnBackPressedDispatcher → pictelioBack → handleSystemBack` 裁决链（modalStack → back-guard → meta → history → 双击退出）结构不变；「能否返回」判定见修订注记（2026-09-03 code-review：纯官方 API 探测不足以承载会话清栈，采纳「会话镜像栈 + 队列探测看门狗」混合形态，见下）。
4. **全局守卫鉴权（用户 Q3，实证采纳）**：`router.beforeEach` + `meta.requiresAuth`（**仅业务页标注**：/update、/error、/login 不标——前者是「清栈后目的页」，标注会被守卫自身重定向回 /login，P0-1）：
   - **同步判断、不 await 网络**；bootstrap 期（`restoreToken` 未完成）**放行**——首帧内容化与「先渲染后加载」不破坏，鉴权失败沿用现状兜底（页面 401 刷新失败 → `/error`、`initRouter` 收敛 replace）；
   - bootstrap 后：未登录访问业务页 → 守卫 `return { path: '/login', replace: true }`（replace 语义实证无报错）。
5. **会话清除（清栈语义承载）**：登出/会话失效 = 置 `cleared` 标记。forward：守卫拦截任何业务页导航重定向 `/login`；back：`canBack = hasBackEntry() && !cleared`（登出后返回键=提示/双击退出，等价自研 `resetHistory` 清栈语义）。清除点：登录成功（authStore 登录成功回调）；置位点：登出/会话失效（`resetHistory` 调用点）。
6. **`backBehavior:'exit'` → 路由 `meta.backBehavior`**（`/update`、`/error` 两处）：裁决链读 `currentRoute.meta`，语义不变。
7. **入口与首帧**：模块顶层 `router.replace('/recommended')` 定起点（官方示例同样式，`app.mount()` 前）；`initRouter()` 恢复登录态后按 `ok ? '/recommended' : '/login'` replace；App.vue 用 `<RouterView v-slot><KeepAlive :include><component :is></KeepAlive></RouterView>`（**必须 PascalCase**），KeepAlive 白名单语义不变（组件 `defineOptions({ name })` = 路由 name，现状已满足）。

## 修订注记（2026-09-03，code-review 双轴门禁）

迁移实现经 code-review（P0-1/P1-1/P1-2/P1-3）对决策 3/4/5 落地形态作如下修订（行为契约不变，机制调整）：

1. **「能否返回」= 会话镜像栈（`_sessionStack`）∧ 队列探测 `hasBackEntryIn`**：纯官方 API 探测无法识别 memory 队列中的**旧会话残留条目**——登出（`replace('/login')` 只覆盖当前条目）→ 重登录（`cleared` 复位）后，返回键可进入上一会话页面（跨账号缓存可见，P1-2）。镜像栈（旧 `_history` 同构）会在 `resetHistory`/`markSessionEstablished` 时**物理清空**，承载原「清历史栈」语义；队列探测保留为镜像漂移看门狗（`hasBackEntry() = `_sessionStack.length > 0 && hasBackEntryIn(history)`）。`goBack` 弹栈先行、漂移降级（清镜像 + 回推荐页）。
2. **`/update`、`/error` 不标 `meta.requiresAuth`**（P0-1）：二者是"清栈后目的页"（更新检查与 401 会话失效链均先 `resetHistory()` 再导航），标注会被守卫自身重定向回 /login，强制更新/会话错误页不可达。
3. **Me.vue 登出调用点补 `resetHistory` import**（P1-1，预既有运行时 ReferenceError：`tsc` 门禁不含 .vue，`<script setup>` 体在类型检查盲区——长期项为引入 SFC 检查，本次以集成测试锚定该路径）。

8. **排除项**：不升级 vue-lynx/web-core；不做命名路由改造/集中式路由守卫之外的守卫重构/query 能力/深链接（benchNav 不动）；不触碰 webview 客户端；`ensureAuth` 的登录取参语义由守卫+shim 收敛。

## 被考虑的方案

- **RouterView 空渲染 → 维持自研路由**：根因证伪后不成立，否决。
- **「能否返回」自跟踪栈 vs 纯官方 API（go 探测）**：两者实证均全绿；选纯官方 API（无状态、不要求导航全走包装函数、官方文档化参数）；自跟踪栈备忘为备选（与现有 `_history` 同构）。
- **守卫 await restoreToken vs bootstrap 放行**：守卫 await 将导致守卫期间 RouterView 空白（首帧丢失，违「先渲染后加载」）；选 bootstrap 放行，代价是 bootstrap 期受保护页的首次数据请求可能 401（现状机制已兜底：页面 `watch(isLoggedIn)` + 补拉）。
- **`resetHistory` 物理清栈 vs 语义拦截**：memory history 栈不可物理清空（无公开 API）；选语义拦截（cleared 标记双层拦截），行为与现状等价（返回键=提示/双击退出）。

## 后果

- 正面：路由层对齐官方（后续可渐进获得命名路由/守卫/query 等框架能力，不阻塞本次）；`routerCore` 纯函数与单测锚点保留；页面调用面零改动降低回归面。
- 代价/风险：`vue-lynx`/`@lynx-js/web-core` 属活跃 Pre-Alpha，**升级后须复验**（探针分支可复跑：web-core 秒级、原生 build+sync+模拟器）；`history.go(-1,false)` 探测属框架内部数据结构（queue/position 闭包私有、`location` getter）——行为随版本升级需复验并有单测锚点（`createMemoryHistory` 纯内存实现，node 可测）。
- 验证矩阵（验收硬约束，用户 Q4）：单测（shim/守卫/裁决纯函数/`hasBackEntry`）、`test-lynx-web.sh` 白屏回归、模拟器系统返回四场景 + 登出后返回键、`/update`/`/error` meta-exit、现有差分与 lynx 单测全绿、E2E（android-e2e switch-client 等）不回归。

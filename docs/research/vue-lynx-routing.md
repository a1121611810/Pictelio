# vue-lynx 官方路由文档调研（Pictelio 视角）

> 调研日期：2026-09-03（当日更新：官方示例确认存在 + 探针实证修正「RouterView 空渲染」结论，见 6 节 / 7 节）
> 来源：vue.lynxjs.org 官方文档（中文 + 英文）、官方示例（docs 托管的 `examples/vue-router` 与仓库 `Huxpro/vue-lynx`）、vue-router 官方 API 文档。
> 对照对象：`packages/app-lynx`（vue-lynx 客户端）现有自研内存路由（`src/router.ts` + `src/routerCore.ts`）。
> 结论速览：**官方把 vue-router 作为唯一推荐方案，并明确要求使用 `createMemoryHistory()`（Lynx 无 `window.location` / History API）；官方形态与本地的自研内存路由在"无 URL、无深链接、内存栈回退"这些核心语义上天然一致，差异集中在"是否复用 vue-router 本体"与"系统返回/弹层拦截等本地自加的集成层"；原来认定"不迁移"的根因（vue-router `RouterView` 在 vue-lynx 0.5.1 + web-core 0.23.1 渲染为空）于 2026-09-03 被探针证伪——根因是模板 kebab-case `<router-view>` 被 vue-lynx 编译器当原生标签，PascalCase `<RouterView>` 在双端（web-core + 原生模拟器）实测全部可用，结论改为"迁移可行"且给出了 shim 迁移设计。** 另注意：本页调研只覆盖"JS 层路由"，官方文档**没有**涉及 Lynx 原生系统返回（手势/按键）拦截、深链接（URL scheme）这类集成层主题——这恰是本地实现超出官方文档的部分。

---

## 1. 来源清单

| 来源 | URL | 说明 |
|------|-----|------|
| Lynx Vue 路由指南（中文） | https://vue.lynxjs.org/zh/guide/routing.md | 官方一手来源（本报告主要依据） |
| Lynx Vue 路由指南（英文） | https://vue.lynxjs.org/guide/routing.md | 与中文版同源，交叉验证 |
| vue-router 官方 API（createMemoryHistory） | https://router.vuejs.org/api/index.html#creatememoryhistory | 限制性说明补充（官方链接指向页面） |
| 官方示例：vue-router（仓库源码） | https://github.com/Huxpro/vue-lynx/tree/main/examples/vue-router | 文档页 `<Go example="vue-router" />` 指向的官方示例 |
| 官方示例：docs 托管（可在线预览/逐文件访问） | https://vue.lynxjs.org/examples/vue-router/example-metadata.json （文件清单）；https://vue.lynxjs.org/examples/vue-router/src/router.ts 等 | 路由文档页 `<Go example="vue-router" defaultFile="src/App.vue" defaultEntryName="main" />` 对应的官方在线示例，templateFiles 入口 `main`（webFile `dist/main.web.bundle`） |
| 本地实现（对照） | `packages/app-lynx/src/router.ts`、`routerCore.ts`、`App.vue`、`index.ts`、`lynx.config.ts`、`stores/modalStack.ts` | 只读分析 |
| 本地既有文档（背景） | `openwiki/architecture/overview.md`（Routing / app-lynx 章节）、`docs/research/vue-lynx-deep-dive.md` | 历史决策记录 |

---

## 2. 官方文档要点（每条均标注来源）

### 2.1 为什么必须用 `createMemoryHistory()`

- Lynx 环境**没有 `window.location` 和浏览器 History API**，因此 Web 端标准的 `createWebHistory()` 与 `createWebHashHistory()` 都不可用；文档以表格呈现三种历史模式可用性，**仅 `createMemoryHistory()` 标记为可用**（No / No / Yes）。
  来源：https://vue.lynxjs.org/zh/guide/routing.md
- `createMemoryHistory()` 官方定位是"为没有浏览器的环境设计"——SSR、测试、以及 Lynx 这类原生运行时均属此列。
  来源：https://vue.lynxjs.org/zh/guide/routing.md 、https://router.vuejs.org/api/index.html#creatememoryhistory

### 2.2 官方推荐的集成形态

三步 + 一个前提：

1. `npm install vue-router`；
2. `createRouter({ history: createMemoryHistory(), routes: [...] })` 创建路由器，`app.use(router)` 注册插件；
3. `<RouterView>` **无需任何修改即可正常使用**，用于渲染当前路由匹配的组件。
   来源：https://vue.lynxjs.org/zh/guide/routing.md

路由文件结构：官方**没有**规定任何文件结构/目录约定（如 `pages/` 自动注册、文件即路由等），路由全部在内存中显式定义，与 Web 端 vue-router 的感知差异仅限于创建方式（history 类型）与 `<RouterView>` 载体。
来源：https://vue.lynxjs.org/zh/guide/routing.md （通篇无文件结构约定论述）

### 2.3 导航方式（官方并列推荐两种）

**方式 A：`<RouterLink>` + `custom` 插槽**
- 文档指出 Lynx **没有 `<a>` 元素**，RouterLink 默认渲染的 `<a>` 不适用；
- 因此使用 `custom` prop + 作用域插槽 `v-slot="{ navigate, isActive }"`，把 `navigate` 绑定到 Lynx 原生元素（如 `<text @tap="navigate">`），并通过 `isActive` 做激活态样式。
  来源：https://vue.lynxjs.org/zh/guide/routing.md（RouterLink custom 官方 API 链接：https://router.vuejs.org/api/index.html#RouterLink-Props ）

**方式 B：编程式导航**
- 通过 `useRouter()` 取实例，`router.push('/users/${id}')` 跳转；
- 文档原文："You can also use `router.back()` and `router.replace()` as you normally would."（中文页：你可以像平常一样使用 `router.back()` 和 `router.replace()`）。
  来源：https://vue.lynxjs.org/guide/routing.md 、https://vue.lynxjs.org/zh/guide/routing.md

**参数传递**
- 动态路由段 `/users/:id` + 命名路由（`name: 'user-detail'`）；
- 读取：`useRoute()`，如 `const userId = computed(() => route.params.id as string)`；
- 跳转：模板字符串直接拼入路径。
  来源：https://vue.lynxjs.org/zh/guide/routing.md 、https://router.vuejs.org/api/index.html#useRoute

### 2.4 页面栈 / 回退 / back 语义

- memory history 把路由状态保存在**内存数组**中，模拟浏览器的历史栈，因此 `router.push()`、`router.back()`、`router.replace()` 与动态参数"如预期工作"。
- 因为不依赖浏览器 API，栈行为的语义与 Web 端一致；差别在于**不存在真实 URL**。
  来源：https://vue.lynxjs.org/zh/guide/routing.md

### 2.5 已知限制（官方明确或可推导）

| 限制 | 说明 | 来源 |
|------|------|------|
| 无 URL / 无深链接 | 内存历史不产生、不解析真实 URL；外部 deep link 无法经路由处理（只能走原生层绕行，官方未展开） | https://vue.lynxjs.org/zh/guide/routing.md |
| 初始位置是"无处" | vue-router 官方：memory history "starts in a special location that is nowhere"，**必须由用户自行 `router.push()` / `router.replace()` 指定起始位置**（官方示例在 `app.mount()` 前调用 `router.push('/')`，注释明言"createMemoryHistory doesn't trigger initial navigation automatically"） | https://router.vuejs.org/api/index.html#creatememoryhistory 、https://github.com/Huxpro/vue-lynx/tree/main/examples/vue-router/src/index.ts |
| 无 `<a>` 元素 | RouterLink 默认渲染在 Lynx 不可用，必须 custom 插槽或编程式导航 | https://vue.lynxjs.org/zh/guide/routing.md |
| 无浏览器 API | 不能使用 `createWebHistory()` / `createWebHashHistory()` | https://vue.lynxjs.org/zh/guide/routing.md |
| 文档未覆盖的主题 | 深链接、URL 变化、路由懒加载、导航守卫（`beforeEach` 等）、query/hash 参数、页面栈深度限制——官方 routing 页**均未提及**。query 支持与否取决于 vue-router 语义（memory history 的 fullPath 含 query），但官方不保证 | https://vue.lynxjs.org/zh/guide/routing.md（通篇无上述论述） |

### 2.6 官方示例实证（`examples/vue-router`）

**文档页内嵌官方在线示例**：路由文档页含 `<Go example="vue-router" defaultFile="src/App.vue" defaultEntryName="main" />` 组件，指向 docs 站托管的示例（预览入口 `main` → `dist/main.web.bundle`，与本地 `__web_preview?casename=main.web.bundle` 同机制）：

- 示例元数据（文件清单 + 入口）：https://vue.lynxjs.org/examples/vue-router/example-metadata.json
- 示例源码（逐文件可访问）：`https://vue.lynxjs.org/examples/vue-router/src/{router.ts,index.ts,App.vue,NavLink.vue,views/*}`

仓库：https://github.com/Huxpro/vue-lynx ，路径 `examples/vue-router/`（版本 0.2.9，依赖 `vue-lynx` workspace + `vue-router ^4.5.0`）。关键结构：

| 文件 | 内容 |
|------|------|
| `src/router.ts` | `createRouter({ history: createMemoryHistory(), routes: [/, /about, /users, /users/:id] })`，页组件直接静态 import |
| `src/index.ts` | `createApp(App)` → `app.use(router)` → **`router.push('/')`** → `app.mount()` |
| `src/App.vue` | **PascalCase `<RouterView />`**（官方从不使用 kebab-case `<router-view>`） |
| `src/NavLink.vue` | `<RouterLink :to="to" custom v-slot="{ navigate, isActive }">` 包 `<text @tap="navigate">`，按 `isActive` 切换样式 |
| `src/views/UserDetail.vue` | `useRoute()` 取 `params.id`、`useRouter().back()` 返回 |

来源：https://vue.lynxjs.org/examples/vue-router/example-metadata.json + https://github.com/Huxpro/vue-lynx/tree/main/examples/vue-router （源码逐文件核实）

---

## 3. 本地实现描述（packages/app-lynx）

### 3.1 形态：自研内存路由（非 vue-router）

- `src/router.ts` 头部注释（第 2–4 行）记录根因：**vue-router 的 `RouterView` 在 vue-lynx 0.5.1 + web-core 0.23.1 组合下渲染为空（Pre-Alpha 兼容问题，已实测）**，因此 MVP 采用手写内存路由 + `<component :is>`，路由语义对齐 vue-router（path/name/params），导航守卫由页面自行处理登录态。
  来源：本地 `packages/app-lynx/src/router.ts`（openwiki 同述：`openwiki/architecture/overview.md`「Routing」章节）
- `dependencies` 中已存在 `vue-router: ^4.5.0`（当前未使用）。
  来源：本地 `packages/app-lynx/package.json`

### 3.2 核心结构

| 模块 | 职责 |
|------|------|
| `src/router.ts` | 路由表 `routes: RouteDef[]`（15 条：`/login` `/recommended` `/illusts` `/illust/:id` `/novels` `/novel/:id` `/user/:id` `/user/:id/following` `/user/:id/followers` `/following` `/bookmarks` `/me` `/watchlist` `/update` `/error`）；`_state = ref<RouteState>{name,path,params}`；`_history: string[]`（纯路径栈）；`navigate(path, {replace?})`、`goBack()`、`resetHistory()`、`ensureAuth()`、`initRouter()`、`requestBack()`、`registerBackGuard()` |
| `src/routerCore.ts` | 纯逻辑层（node 可单测）：`matchRoute`（路径模板匹配 `/illust/:id` → params，`decodeURIComponent` 解码）、`evaluateSystemBack`/`evaluateBackWithBehavior`/`evaluateBackRoute`（返回裁决）、`createBackGuardRegistry`/`runBackGuards` |
| `src/stores/modalStack.ts` | 弹层关闭回调栈（LIFO），返回键优先关弹层（issue #163） |
| `src/App.vue` | `<KeepAlive :include="['recommended','illusts','novels','me']"><component :is="currentComponent" /></KeepAlive>`；全局放射 FAB（ADR-0120）、全局搜索弹层（ADR-0132）、根路由「再按一次退出」提示条（ADR-0066） |
| `src/api/client.ts` | `isNativeMode()` / `getNativeModules()`（区分 web-core 预览与原生；原生模块 `PictelioApp` 等） |

### 3.3 导航与参数传递

- **导航**：全站编程式 `navigate('/illust/${id}')`（页面内直接 import），无 RouterLink。
- **参数**：`currentParams` computed（来自 `matchRoute` 结果），页面用 `currentParams.value.id` 取参（如 `IllustDetail.vue`）。
- **替换语义**：`navigate(path, { replace: true })` 不入栈——登录/登出/首路由/强制更新页场景用 replace（ADR-0049 语义），与官方"登录页不应被返回"的实践一致。
- **页面注册**：静态 import 所有页面（注释：vue-lynx 的 `defineAsyncComponent` 需要 lazy-bundle runtime，MVP 静态加载，bundle ~160KB），路由表集中声明；`App.vue` 用 `<component :is>` 渲染当前 route 的 component（`markRaw` 包装）。

### 3.4 初始导航

- 与官方"初始位置 nowhere + 需手动 push"不同：本地 `_state` 初始值直接为 `{ path: '/recommended' }`（首帧直出骨架屏，#61/#63），`initRouter()`（App.onMounted）里 `restoreToken()` + `loadSettings()` 后 `navigate(ok ? '/recommended' : '/login', { replace: true })` 收敛登录态——首帧渲染不等待任何网络，这是项目「先渲染后加载」硬约束在 app-lynx 的体现。

### 3.5 系统返回（超出官方 JS 层路由文档的部分）

- 原生侧：`packages/app/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java`（第 198 行）拦截系统返回后 `lynxView.sendGlobalEvent("pictelioBack", ...)` 转发 JS 决策。
- JS 侧：`handleSystemBack()` → `evaluateBackRoute()` 纯函数裁决：
  1. `modalStack` 有打开的弹层 → `close-modal`（后进先出）；
  2. 页面 back-guard 拦截（如小说详情追更询问，spec §US3，issue #222）→ 消费本次返回；
  3. 路由声明 `backBehavior: 'exit'`（`/update`、`/error`）→ 直接退出应用；
  4. 历史栈非空 → `goBack()`（pop）；
  5. 根路由 → 「再按一次退出应用」提示（2s 窗口，与 webview `EXIT_DOUBLE_TAP_MS` 对齐），窗口内再按 → `PictelioApp.exitApp()`（module 级 `exitApp`，callback 必传，模拟器实测约束）。
- 页面内返回按钮走 `requestBack()`，与系统返回共用同一守卫链（两条返回路径行为一致）。
- 另有 bench 导航钩子（ADR-0136）：原生 `am start --es benchNav <scenario>` 经 `GlobalEventEmitter` 直达目标页，`__BENCH_NAV__` 编译期门禁（生产整块消除）。

### 3.6 与原生 app 的衔接

- 单入口：`lynx.config.ts` 的 lynx 环境恒为默认单入口 `src/index.ts`（web 预览环境 dev 多入口、生产单入口）——即一个 `LynxView` 内跑整个 SPA，路由完全在 LynxView 内部；
- 引擎切换：`MainActivity`（full flavor）按 `pictelio_client_kind` 路由门发行到 `LynxActivity` 或 WebView（issue #51），`PictelioAppModule.restart()` 双端统一重启机制（issue #120/#124）；
- 登录共享：同 Keystore token（`PictelioSecureStorageModule` 与 `capacitor-secure-storage-plugin` 同 alias 同密文文件），两客户端共用登录态。

---

## 4. 与官方形态的对照分析

### 4.1 一致点（语义层面天然对齐）

1. **内存路由形态**：官方要求 memory history；本地同样是纯内存栈 + 无 URL/无深链接——两者核心语义一致（历史只在进程内存中存在）。
2. **push / replace / back 语义**：官方 memory history 用内存数组模拟历史栈；本地 `_history: string[]` 同样是"push 入栈、back 出栈、replace 不入栈"，行为对齐（本地还额外对齐了 ADR-0049 的"登录页不可被返回"）。
3. **路径参数风格**：`/users/:id` ↔ `/illust/:id` 段级模板 + decodeURIComponent 解码，与 vue-router 一致；取参（`useRoute().params` ↔ `currentParams`）形态等价。
4. **页组件静态注册**：官方 `examples/vue-router` 也是静态 import（`src/router.ts` 直接 import 四个 views）；本地同为静态 import——官方示例与本地在"不懒加载"上一致（注释里官方示例也没有懒加载示例）。
5. **无 `<a>` 需求**：官方要求 custom 插槽或编程式导航；本地全编程式导航（`navigate()`），天然规避 `<a>` 问题。
6. **初始路由需显式设定**：官方示例在 mount 前 `router.push('/')`（因为 memory history 起点是 nowhere）；本地在 `initRouter()` 里 replace 到 `/recommended`/`/login`——实现位置不同（mount 前 vs mount 后异步、且本地首帧直接预置 `/recommended`），但"必须显式指定起始路由"这一点两方都遵守了。

### 4.2 差异点（与官方推荐形态不一致的地方）

| # | 官方（推荐的 vue-router 形态） | 本地（自研内存路由） | 评价 |
|---|------------------------------|---------------------|------|
| 1 | 使用 vue-router 本体（`createRouter` + `app.use`） | 自研 `router.ts` + `<component :is>`，未用 vue-router | **设计偏离的根因**：vue-router `RouterView` 在 vue-lynx 0.5.1 + web-core 0.23.1 渲染为空（已实测）——即官方"RouterView 无需修改即可用"的结论在本地版本组合上**不成立** |
| 2 | `<RouterView>` 作为 outlet | `<component :is="currentComponent" />` + `<KeepAlive>` | 功能等价，另有本地缓存白名单 |
| 3 | `<RouterLink custom>` 推荐方案之一 | 无 RouterLink，纯编程式 | 官方允许纯编程式（方式 B），不视为冲突 |
| 4 | 路由表存 fullPath（含 query）语义 | 历史栈只存 `path`（`string[]`），`matchRoute` 不支持 query/hash 段 | 本地缺 query 参数能力——但目前本地无 query 用例（搜索走全局 SearchSheet 弹层，ADR-0132） |
| 5 | vue-router 自带导航守卫 `beforeEach` / 路由 meta | 守卫手工实现：`ensureAuth()` / `initRouter()` / `registerBackGuard()` | 本地能力是"页面自行处理"，无集中式全局守卫；如未来需要集中鉴权/埋点前置，得自己造 |
| 6 | —（官方未定义） | `backBehavior: 'exit'` 路由级退出语义（`/update`、`/error`） | 本地超出官方能力；vue-router 需用 meta + 全局守卫模拟 |
| 7 | —（官方未定义） | 系统返回原生桥：`pictelioBack` 事件 + modalStack + back-guard + 双击退出 | 超出官方 JS 层文档范围（官方只讲 `router.back()`），属于原生集成层的本地创新 |
| 8 | 命名路由 `push({ name })`、路由 meta、transition（官方示例未演示但 vue-router 自带） | 仅 path 字符串 `navigate('/illust/123')` | 本地 API 面窄，迁移时需补薄封装 |

### 4.3 缺失 / 风险点

- **query/hash 无路由级支撑**：若未来需要"搜索词可回退/可恢复"（如从推荐进搜索再从详情返回后恢复搜索词），本地路由无法承载，只有弹层/Store 方案可选（现状 searchSheetStore 已覆盖）。
- **无集中式导航守卫**：登录态由 `ensureAuth()` + 页面自理 + `initRouter()` 兜底；页面遗漏时可能出现未登录访问受保护页的竞态（现有实现已用 401 刷新 + `/error` 页兜底，风险可控但非框架保证）。
- **keep-alive 与路由解耦**：本地用 `<KeepAlive :include>` 包 `<component :is>`，与 vue-router 迁移后需改为 `<router-view v-slot="{ Component }"><KeepAlive ...>` 模式——迁移时这里是主要改动点之一。
- **官方文档不覆盖深链接**：两边都没有 URL/深链接能力；本地已有 Intent 直达机制（benchNav，ADR-0136）可作为深链接的功能雏形，但它是编译期门禁的测试钩子，非产品级深链接。
- **版本组合锁定**：`vue-lynx@^0.5.1` + `@lynx-js/web-core@^0.23.1` 就是当初实测 RouterView 渲染为空的组合（本地 package.json 当前仍是该版本段）——迁移前的复验必须以升级后的实际组合为准。

---

## 5. 对本地后续演进的可落地建议

### 5.1 近期（无需动作）

- **不建议现在迁移**：官方文档并不强制使用 vue-router（文档默认前提是"如果要路由，用 vue-router + memory history"）；本地自研路由已具备官方文档要求的全部"内存路由"语义，且 bug 根因（RouterView 渲染为空）在当前锁定版本组合下无法消除。迁移收益（守卫/命名路由/query）在现有页面规模（15 条路由、无 query 用例）下不显著。
- **保持既有集成层**：`pictelioBack` 原生桥、`modalStack`、back-guard、双击退出、`/error`、`/update` 的 `backBehavior: 'exit'` 都应保留——这些是本地超越官方 JS 层文档的能力，迁移后需在"路由层"继续生效（见 5.3）。

### 5.2 中期（低成本改进，不依赖迁移）

1. **升级 vue-lynx / web-core 后做一次 RouterView 复验**（最小 spike：官方 `examples/vue-router` 代码在升级后的组合上跑 `lynx` 环境，验证 `<RouterView>` 与 `<RouterLink custom>` 真实渲染）。一旦可用，迁移成本骤降。
2. **query 能力评估**：如出现"参数需进入历史栈"需求（搜索词、列表筛选），先评估是否用 Store 承接（现状做法），不要急于为此迁移。
3. **统一导航 API 薄封装**：现有页面散布 `navigate(...)` 调用，可加一层 `appNavigate(pathOrLocation, opts)` 签名对齐 vue-router 的 `Router.push(location)` 形态（接受字符串与 `{name, params}`），为未来迁移缩小 diff。

### 5.3 若决定迁移到 vue-router（官方形态）的清单

1. 路由表：`routes` 的 `path/name/component` 与 `RouteDef` **1:1 迁移**（15 条全部兼容；`backBehavior: 'exit'` → 路由 `meta: { backBehavior: 'exit' }`）。
2. Outlet：`<component :is>` + `<KeepAlive :include>` → `<router-view v-slot="{ Component }">` + 同款 `<KeepAlive>`（include 白名单语义不变）。
3. 初始导航：`initRouter()` 收敛后 `router.replace(ok ? '/recommended' : '/login')`（保持"首帧直出"则仍可在 mount 前 `router.push('/recommended')`，登录态恢复后 replace——与官方 example 的 mount 前 push 兼容）。
4. 页面取参：`currentParams.value.id` → `useRoute().params`（computed 包装，改动集中在详情类页面）。
5. 系统返回桥**保持不动**：`pictelioBack` → `handleSystemBack()` 的裁决纯逻辑在 `routerCore.ts`，与 vue-router 是否启用无关；只把"当前路由"从 `_state` 换成 `route.currentRoute.value`（含 `meta` 读 backBehavior）。
6. 页面内 `navigate()` 调用：可直接换成 `router.push()`（签名几乎一致，`{ replace: true }` → `router.replace()`）。
7. 依赖已就位：`vue-router@^4.5.0` 已在 `packages/app-lynx/package.json`，无需新增。
8. 风险点：迁移后 `router.back()` 的失败兜底（本地：栈空回退 `/recommended`）需自定义——vue-router memory history 无栈时 `back()` 为 no-op，本地"回退推荐页"语义要在全局返回处理器中补。

### 5.4 注意事项（迁移/演进共通）

- 官方文档的"无 URL/无深链接"意味着**两份路由形态在深链接场景都无能力**；若产品要深链接，须走原生层（Activity Intent / App Link + 现有 benchNav 式 GlobalEventEmitter 注入），与路由框架本身正交。
- 官方示例中 memory history 在 **`app.mount()` 前 `router.push('/')`** 是必设动作（起点 nowhere）；本地若迁移不能漏掉这一步，否则首次渲染为空。
- 本地 `routerCore.ts` 的 `matchRoute` / `evaluateBackRoute` 有单测覆盖（`packages/app-lynx/tests/unit.test.ts`），迁移后这些纯函数的裁决逻辑（modal → guard → exit → history）应保留测试锚点。

---

## 6. 值得主 agent 进一步关注的问题

1. ~~**RouterView 空渲染是否仍是当前版本的 bug**~~ **已解决（2026-09-03，探针实证）**：`vue-lynx@0.5.1` + `@lynx-js/web-core@0.23.1` 组合下 RouterView **可正常渲染**（本机 lockfile 实际解析 vue-router 4.6.4）；「渲染为空」根因是模板写 kebab-case `<router-view>`（被 vue-lynx 编译器当原生标签，v-slot 时编译报 `VueCompilerError`，无 slot 时静默渲染为空/纯白屏）。官方示例与探针均用 PascalCase `<RouterView />`。修正结论与迁移设计见 7 节。
2. **`backBehavior: 'exit'` 的路由级语义**在 vue-router 迁移后如何承载（meta + 全局处理器）——这是本地独有的强约束（强制更新页/会话失效页不可返回），迁移设计必须先回答。
3. **query 参数的未来用例**：搜索（现为全局弹层 ADR-0132）、列表筛选（如关注/热门切换）是否会演进出"参数入历史栈"需求——决定是否值得为 query 支持做迁移投入。
4. **深链接/恢复**：Android 端如果做启动直达（如通知、分享链接），需与 `LynxActivity` 的 Intent 处理协同（现有 benchNav ADR-0136 是可参考的最小承载），官方路由文档对这块零覆盖。
5. **双客户端行为一致性**：webview 客户端的返回手势/双击退出逻辑（`EXIT_HINT_DURATION_MS` 等）与 app-lynx 已有显式对齐注释；若迁移改动返回链路，需同步核对 webview 侧（`backGestureService`）避免双端漂移。

---

## 7. 2026-09-03 探针实证修正（推翻「RouterView 渲染为空」）

**背景**：router.ts 注释（"已实测"）与本文档 4.2 节均把「RouterView 在 vue-lynx 0.5.1 + web-core 0.23.1 渲染为空」作为不迁移的根因。2026-09-03 在 throwaway 分支 `prototype/lynx-vue-router` 上按官方示例形态搭了最小探针，逐项实证：

| 探针项（web-core 预览 + 原生模拟器双端） | 结果 |
|---|---|
| PascalCase `<RouterView v-slot>` + `<KeepAlive>` | ✅ 渲染完整 |
| 编程式 `router.push('/detail/42')` + 段级参数 | ✅ `id=42` |
| `<RouterLink custom v-slot>` + `@tap="navigate"` | ✅ |
| `router.back()` | ✅ |
| KeepAlive 缓存（include 白名单） | ✅ 返回后组件状态保留（count=1） |
| **kebab-case `<router-view />`（无 slot）** | ❌ **复现纯白屏、a11y 树零内容**——即历史「渲染为空」 |

**根因**：vue-lynx 模板编译器把带连字符的标签当作原生自定义元素（与 `view`/`text` 同理）——kebab-case `<router-view>` 编译为「自定义元素」而非 vue-router 组件：带 `v-slot` 时直接编译报错（`VueCompilerError: v-slot can only be used on components`），不带 slot 时静默渲染空。**这不是 vue-router 不兼容，而是模板写法问题**；官方示例（2.6 节）与本次探针均使用 PascalCase `<RouterView />`。

**迁移结论修正**：原「近期不迁移」结论改为「**迁移可行**」——版本组合无需升级即可迁移；迁移设计（路由表/meta 承载 backBehavior/初始 push/KeepAlive 套 RouterView/系统返回桥不动/栈空回退兜底等）见 `docs/research/vue-router-migration-feasibility.md`（同分支，探针源码与其一并保留为 primary source）。

---

## 附：关键文件索引

| 文件 | 作用 |
|------|------|
| `packages/app-lynx/src/router.ts` | 自研内存路由主体（状态/历史栈/导航/系统返回桥/benchNav） |
| `packages/app-lynx/src/routerCore.ts` | 匹配与返回裁决纯逻辑（单测锚点） |
| `packages/app-lynx/src/App.vue` | outlet 渲染 + KeepAlive + 全局 FAB/搜索弹层/退出提示 |
| `packages/app-lynx/src/stores/modalStack.ts` | 弹层关闭回调栈（返回键优先关弹层） |
| `packages/app-lynx/lynx.config.ts` | 单入口构建配置（lynx 环境恒单入口） |
| `packages/app-lynx/package.json` | `vue-router@^4.5.0` 已在依赖（未使用） |
| `packages/app/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java` | 原生系统返回拦截 + `pictelioBack` 全局事件发射 |
| `docs/research/vue-lynx-deep-dive.md` | 既有 vue-lynx 总体调研（路由部分为本次的上下文） |

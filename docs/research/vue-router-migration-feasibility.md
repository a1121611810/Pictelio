# Vue-router 迁移可行性探针结论

> 分支：`prototype/lynx-vue-router`（throwaway，primary source 保留）
> 探针代码：`packages/app-lynx/src/prototype/`（RouteProbe{App,Home,Detail}.vue、probeNav.ts、`src/routeProbe.ts`）
> 问题陈述：将 app-lynx 自研内存路由（`src/router.ts` + `src/routerCore.ts`）迁移到官方 vue-router（`createMemoryHistory()`）是否可行？
> 结论日期：2026-09-03（第二轮：系统返回桥实证，含「history.state 不可用」关键发现）

## 结论

**可行。** 官方推荐形态（vue-router 4.6.4 + `createMemoryHistory()` + PascalCase `<RouterView>` + `RouterLink custom` 插槽 + `router.push('/')` 定起点）在 **web-core 0.23.1（浏览器预览）与 lynx-core（原生 TASM/模拟器）双端均完整工作**：渲染、导航、参数、KeepAlive 缓存、**系统返回桥（返回键 + 侧滑手势 + 双击退出）全部实证通过**。

`src/router.ts` 注释声称的「RouterView 渲染为空」**根因不是 vue-router 不兼容，而是 kebab-case `<router-view>` 标签被 vue-lynx 编译器当作原生自定义元素**（`v-slot` 时编译报 `VueCompilerError: v-slot can only be used on components`；无 slot 时静默渲染为空——已复现纯白屏）。官方示例与探针均使用 PascalCase。

**本轮新增（第四轮：官方 API 深度分析修正）**：vue-router 官方文档明确 memory history 只是"初始位置 nowhere、需手动 push/replace"这两个特殊性（`createMemoryHistory` API 页原文），其余能力与普通 history 一致。**"能否返回"检测不需要自跟踪栈**——官方 `RouterHistory` 接口本身就有解：

- `go(delta, triggerListeners?)`——**`triggerListeners` 是官方文档化参数**（JSDoc: "whether this should trigger listeners attached to the history"）
- `location`——官方文档化的 "Current History location"（只读 live getter）

两者组合即可原子探测"有没有上一页"（见下 `hasBackEntry()`），已实测四场景全绿（16-17 行）。`state` 的语义也修正：它是**每条历史条目可携带的数据**（`push(to, data?)`/`replace(to, data?)` 官方文档化的第二参数，读取即"当前条目的 state"，默认 `{}`）——**不是**浏览器 `history.state` 的 `{back, current, forward}` 结构（那是 `createWebHistory` 用 `replaceState` 维护的浏览器态，memory 没有）。

## 实证矩阵

### web-core 预览（`pnpm dev:app-lynx` + `__web_preview?casename=route-probe.web.bundle`，playwright-cli）

| # | 场景 | 证据 |
|---|------|------|
| 1 | PascalCase `<RouterView>` 渲染 | a11y snapshot 出现 PROBE-HOME 全量路由状态；截图非白屏 |
| 2 | 编程式 `router.push('/detail/42')` | 快照 PROBE-DETAIL `id=42` `fullPath=/detail/42` |
| 3 | `RouterLink custom v-slot` + `@tap` | 快照 PROBE-DETAIL `id=7` `fullPath=/detail/7` |
| 4 | `router.back()` | 回 PROBE-HOME `fullPath=/` |
| 5 | KeepAlive 缓存（`<RouterView v-slot><KeepAlive :include>`） | inc-count → push → back 后 `count=1`（实例未重建） |
| 6 | **反向实证** kebab-case `<router-view />`（无 slot） | 编译通过但渲染**纯白屏**，a11y 快照零内容——重现历史「渲染为空」断言 |

### 原生 lynx-core（探针 bundle 同步进 `android/app/src/main/assets/main.lynx.bundle` + assembleDebug + 模拟器 720x1280）

| # | 场景 | 证据 |
|---|------|------|
| 7 | RouterView 渲染 | 首屏截图 PROBE-HOME 全量渲染（含路由状态文本） |
| 8 | 编程式 push + 段级参数 | 点击 push-detail-42 → PROBE-DETAIL `id=42 fullPath=/detail/42` |
| 9 | back + KeepAlive | inc-count(1) → push → back → `count=1`（像素取证：Home 实例缓存） |
| 10 | **系统返回键回退** | 详情页 `input keyevent 4` → logcat `stackLen=1` → PROBE-HOME（`fullPath=/`） |
| 11 | **根路由返回提示** | 首页 `keyevent 4` → logcat `stackLen=0` → 截图可见「再按一次退出应用」提示条 |
| 12 | **双击退出** | 2s 窗口内再按 → logcat `exitApp(), PictelioApp 存在: true` → `mCurrentFocus` 切到 NexusLauncher |
| 13 | **侧滑手势返回** | gesture nav 下左缘 `swipe 2,640→720,640`（250ms）→ 原生 `LynxView sendGlobalEvent pictelioBack` → `stackLen=1` → PROBE-HOME |
| 14 | **"直调 API"形态（第三轮，用户挑战验证）**：系统拦截后**不判历史、一律 `router.back()`** | 详情页返回键 → **正常回 PROBE-HOME**（vue-router API 触发返回完全可行）；根路由返回键 → **no-op**（页面保持 home 原样，无白屏无崩溃——预期"回到 START 匹配空路由白屏"未发生，vue-router 将无匹配导航中止并保持 currentRoute） |
| 15 | **根路由直调形态的副作用** | 根路由按返回键**无任何反应**（无"再按一次退出应用"提示、无法经返回键退出应用）——本地根路由语义丢失；此为框架行为（根=START 合成位置），非回归性 bug |
| 16 | **纯官方 API 形态（第四轮，深入官方文档后验证）**：`hasBackEntry()` = `history.go(-1, false)` 静默移动指针 + `location` 比对还原 | 四场景全绿：详情返回键 `hasBackEntry=true`→home；根返回键 `false`→"再按一次退出应用"提示；2s 内再按→exitApp→桌面；侧滑手势→home（logcat 逐条取证） |
| 17 | 纯 API 形态的检测原理 | `go`/`location` 均为官方 `RouterHistory` 成员；`go(-1, false)` 同步原子（无 await 间隙），移动后 `go(1, false)` 立即还原，不触发监听/守卫，无副作用 |

注：模拟器首轮验证曾被「Process system isn't responding」ANR 弹窗干扰（模拟器系统进程挂起，非 app 问题），`adb reboot` 后全绿——印证「模拟器卡死先 reboot，别怀疑代码」既有经验。侧滑与返回键共用 `LynxActivity` 的 `OnBackPressedDispatcher`（Java 侧 `handleOnBackPressed`，已读源码确认：错误页/未加载时直接 finish，否则 `sendGlobalEvent("pictelioBack", ...)`），JS 侧裁决后行为四项均正确。

## 根因与规则

vue-lynx（vue-lynx/plugin 的模板编译链）把所有**带连字符的标签**处理为原生自定义元素（与 lynx 原生标签 `view`/`text` 同理），因此：

- kebab-case `<router-view>` → 编译产物为「自定义元素 `router-view`」，Vue 不渲染任何内容 → **空**
- PascalCase `<RouterView>` → 正确解析为 vue-router 组件（script setup 导入后模板可用）
- 迁移/使用规则：**模板中必须写 `<RouterView />`（PascalCase）**；其它带连字符的组件同理（本项目现有组件均为 PascalCase，无新风险）。

## 迁移设计要点（自研 router → vue-router shim 映射）

保持不变的部分：

- **系统返回桥原生侧不动**：`LynxActivity → pictelioBack`（`OnBackPressedDispatcher`，返回键与侧滑同路径）。JS 侧 `handleSystemBack` 裁决链（modalStack → back-guard → backBehavior → 历史 → 双击退出）结构不变，只是"当前路由/历史判定"换成 vue-router 等价物。
- **守卫语义不变**：`ensureAuth`、`registerSessionErrorHandler`（页面自理登录态，vue-router 无守卫也能工作）。
- `routes` 表 1:1 搬迁为 vue-router routes；`backBehavior: 'exit'` 移到 `meta: { backBehavior: 'exit' }`（更新页/会话失效页规则）。

需要改造的点（router.ts 可变为「薄 shim + 导出同签名 API」，页面调用方零改动）：

| 现状（自研） | vue-router 替代 |
|---|---|
| `_state` ref + `routeState`/`currentParams`/`currentComponent` computed | `router.currentRoute`（`params`/`fullPath`/`name` 直接读）；页面如需 `useRoute()` 亦可 |
| `navigate(path, opts?)`（push/replace 语义） | `router.push(path)` / `router.replace(path)` |
| `goBack()`：历史栈 pop + 栈空/无效回退 `/recommended` | 自跟踪栈 + `router.back()` 或纯 API 探测 + `router.back()`（两者任选，见下）；栈空或目标无效时 `router.replace('/recommended')` 兜底。（vue-router `back()` 栈空是 no-op，兜底需自实现） |
| `_history: string[]` + `historyLength` | **二选一**：① **纯官方 API**（推荐，第四轮实测）：`hasBackEntry()` = `history.go(-1, false)` 静默探测 + `location` 比对 + 还原——同步原子、无状态、不要求导航全走 shim；② 自跟踪栈（与现有 `_history` 同构，导航必须全走包装）。（注：`history.state` 非栈查询——它是**每条目可携带的数据**，`push(to, data?)` 官方文档化，默认 `{}`，不含 `{back,current,forward}`——那是 web history 的浏览器态） |
| `resetHistory()`（登出/会话失效清栈） | 无官方 API——`/error` 是 `backBehavior:'exit'`（裁决直接 exit，不依赖栈）；「真的清栈」需重建 router 或改自跟踪栈（后者推荐：清镜像即够，vue-router 侧 replace 到目标即可） |
| 首帧内容化（初始即 `/recommended`） | 模块顶层同步 `router.replace('/recommended')`（memory history 不主动触发初始导航，官方示例在 `app.mount()` 前 `router.push('/')`——已按官方顺序实证可行） |
| `App.vue`：`<component :is>` + KeepAlive | `<RouterView v-slot="{ Component }"><KeepAlive :include="['recommended','illusts','novels','me']"><component :is="Component" /></KeepAlive></RouterView>`（**必须 PascalCase**） |
| KeepAlive 白名单 | 组件 `defineOptions({ name })` = 路由 name（生产页面已有此惯例，1:1 兼容） |

**系统返回裁决伪码**（探针已按"纯官方 API 形态"完整实证，第 16 行）：

```
handleSystemBack():
  ① modalStack 有弹层 → close（不动）
  ② back-guard 拦截 → 返回（不动）
  ③ meta.backBehavior === 'exit' → exitApp（不动，裁决层读 currentRoute.meta）
  ④ hasBackEntry()（官方 API：history.go(-1,false)+location 比对，原子无副作用）
     → true: router.back()                        ← 实证 ✓（返回键/侧滑）
     → false: 提示 + 2s 窗口内再按 → exitApp       ← 实证 ✓（提示条 + 桌面退出）
```

## 官方 API 深度分析（第四轮，对应 https://router.vuejs.org/api/functions/createMemoryHistory.html）

## 守卫鉴权拦截实证（第五轮，Q3——用户拍板"若 vue-router 全局守卫可行则采用"）

探针在 `'/`（等同生产首路由 /recommended）` 与 `/protected` 加 `meta.requiresAuth`，`beforeEach` 全局守卫挂上后实证：

| # | 场景 | web-core | 原生模拟器 |
|---|------|----------|-----------|
| 18 | 未登录访问受保护页 → 守卫重定向 `/login`（`return { path: '/login', replace: true }`，replace 语义生效无报错） | ✅ snapshot PROBE-LOGIN | ✅ logcat `guard: 未登录访问受保护页 → 重定向 /login` |
| 19 | 已登录访问受保护页 → 守卫放行 | ✅ PROBE-PROTECTED | ✅（同链路守卫在跑） |
| 20 | 登出（会话清除）后访问业务页 → 守卫拦截重定向 /login | ✅ 登出后 goto-protected → PROBE-LOGIN | 同链路（web-core 已验证组合） |
| 21 | **首帧时序**：守卫在 bootstrap 期（restoreToken 未完成）**放行** → 首帧即时渲染（t=1.2s 快照已有内容，无空白；console `guard: bootstrap 放行`） | ✅ | ✅ 首帧 PROBE-HOME |
| 22 | **守卫 await 网络的代价**：bootstrap 完成后守卫内 800ms await → 该次受保护导航延迟 800ms 后重定向 /login（非首帧场景，可接受；**同理可证：若守卫在首帧 await 网络 → RouterView 将空白至守卫结束——生产禁用该形态**） | ✅ | — |

**Q3 定论**：vue-router 全局守卫（`beforeEach` + `meta.requiresAuth`）在 vue-lynx 双端可行，鉴权拦截采用全局守卫；配套设计规则：
1. **守卫必须同步判断、不 await 网络**：bootstrap 期（`restoreToken` 未完成）直接放行（首帧内容化 + 先渲染后加载不破坏；鉴权失败由页面 401 兜底 + `initRouter` 收敛，沿用现状）；
2. **会话清除（登出/会话失效）双层拦截**：forward（任何业务页导航）由守卫重定向 `/login`（replace）；back（系统返回）由 `canBack = hasBackEntry() && !cleared` 判定（`!cleared` 时提示/双击退出，等价"清栈"语义）；
3. `cleared` 的清除点 = 登录成功（beginSession 语义，生产映射到 authStore 登录成功回调）；置位点 = 登出/会话失效（resetHistory 等价点）。

## 官方 API 深度分析（第四轮，对应 https://router.vuejs.org/api/functions/createMemoryHistory.html）

**`createMemoryHistory` 官方页**：创建基于内存的 history（"Creates an in-memory based history"）、用途是 SSR（"to handle SSR"）、初始位置是"nowhere"特殊位置、**必须由用户自行 `router.push`/`router.replace` 指定起点**（"It's up to the user to replace that location with the starter location"）——**官方明确的特殊性只有这两点（无 URL 环境 + 手动定起点）**，其余无任何限制说明。

**官方 `RouterHistory` 接口**（API 文档页由 JSDoc 生成；本仓安装版 `vue-router@4.6.4` 的 `.d.mts` 逐字核实）：

| 成员 | 官方签名/JSDoc 要点 |
|---|---|
| `location` | `readonly location: HistoryLocation` — "Current History location"（live getter，实测随栈条目切换） |
| `state` | `readonly state: HistoryState` — "Current History state"（**当前条目的数据**；`push(to, data?)` 第二参数官方文档化："optional HistoryState to be associated with the navigation entry"；默认 `{}`） |
| `go` | `go(delta, triggerListeners?)` — "Traverses history in a given direction"；**`triggerListeners` 官方文档化**："whether this should trigger listeners attached to the history"——这就是纯 API 探测"能否返回"的关键 |
| `push`/`replace` | 第一参数 location、第二参数 `data?`（HistoryState） |
| `listen` | 外部导航（浏览器前进/后退）或 `go(..., true)` 时触发，返回取消函数 |

**结论（与首轮调研对照）**：用户的判断成立——除"无 URL/无深链接/需手动定起点/`state` 语义是条目数据而非浏览器 `{back,current,forward}`"这几点**个别特殊性**外，vue-router 的能力在 memory history 下全部可用，包括系统返回所需的**触发（`router.back()`）与检测（`go+location`）**；不迁移的根本理由（当时认为 RouterView 兼容性不可用）已被第一轮证伪。

## 官方示例（docs 托管，可逐文件访问）

路由文档页内嵌官方案例（`<Go example="vue-router" defaultFile="src/App.vue" defaultEntryName="main" />`）：

- 文档页：https://vue.lynxjs.org/zh/guide/routing
- 示例元数据（文件清单 + 入口）：https://vue.lynxjs.org/examples/vue-router/example-metadata.json
- 示例源码：`https://vue.lynxjs.org/examples/vue-router/src/{router.ts,index.ts,App.vue,NavLink.vue}`
- 仓库：https://github.com/Huxpro/vue-lynx → `examples/vue-router`
- 依赖：`vue-lynx` workspace + `vue-router ^4.5.0`——与本仓版本段一致（本仓 lockfile 实际解析 vue-router 4.6.4）

## 风险与后续

1. **`resetHistory` 清栈语义**：迁移设计按上文「清镜像（推荐）」或「重建 router」取舍；`/error`、登出路由用 `replace` + `backBehavior:'exit'` 承载，不依赖物理清栈。
2. **版本迭代风险**：vue-lynx / @lynx-js/web-core 均为活跃迭代 Pre-Alpha；升级后需复验（探针保留在本分支可复跑——web-core 一键重演，原生重跑 build+sync+模拟器）。
3. **IFR（`enableIFR: true`，ADR-0134）与首帧时序**：模拟器首屏实测正常（RouterView 首个渲染帧即出内容），但迁移后首页骨架屏/首帧时序需按现有回归（`scripts/test-lynx-web.sh` 白屏回归 + 模拟器首屏检查）双端验证。
4. **工作量估计**：15 条路由 + 页面调用面（`goBack` 15 处 / `requestBack` 2 处 / `registerBackGuard` 1 处 / `ensureAuth` 1 处）——router.ts 改 shim（含自跟踪栈）、App.vue 改 3 行、页面零改动；主要工作量在 routerCore 单测适配与新 shim 单测、双端回归（含系统返回四场景）。

## 捕获

- 探针源码与结论：本分支 `prototype/lynx-vue-router`（与 main 无交集，main 仅保留「使用 vue-router 需 PascalCase RouterView」+「系统返回历史判定需自跟踪栈」两个决策，待正式迁移时落代码）。
- 复跑方式：web-core 秒级——`pnpm dev:app-lynx` 后打开 `http://127.0.0.1:<port>/__web_preview?casename=route-probe.web.bundle`；原生按上文 7-13 流程 build+sync+装包+模拟器。
- 系统返回四项验证命令即上表 10-13（logcat 取证关键字 `pictelioBack` / `routeProbe` / `exitApp()`）。

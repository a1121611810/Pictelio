# Spec: app-lynx 路由迁移到官方 vue-router（createMemoryHistory）

> 术语：见 `docs/glossary-vue-router-migration.md` 与 `packages/app-lynx/CONTEXT.md`「路由层（vue-router 迁移）」
> 决策：见 `docs/adr/ADR-0138-app-lynx-vue-router.md`
> 实证：`prototype/lynx-vue-router` 分支（五轮探针，双端全绿）

## Problem Statement

app-lynx 的路由层是自研内存路由（`_state` + `_history` 路径栈 + `matchRoute` + 系统返回裁决纯函数），与官方 vue-router 形态偏离：无集中式鉴权守卫（各页面自理登录态）、无路由 meta、无命名路由/query 演进空间。当初不迁移的根因是「vue-router 的 RouterView 在 vue-lynx 0.5.1 + web-core 0.23.1 渲染为空（已实测）」——该根因已被探针证伪（真实原因是模板 kebab-case `<router-view>` 被编译器当作原生标签；PascalCase `<RouterView />` 在当前版本组合双端全链路可用）。用户拍板全量迁移官方 vue-router + 全局守卫鉴权。

对用户而言，本次迁移是**行为等价迁移**：所有现路由、系统返回/侧滑/双击退出、KeepAlive 缓存、首帧内容化等行为必须保持不变——Q4 为验收硬约束。

## Solution

按 ADR-0138 落地：`router.ts` 变薄 shim（页面调用面零改动），内部换 vue-router 4.6.4（`createMemoryHistory`）；「能否返回」用纯官方 API（`hasBackEntry()`）；鉴权改为全局守卫（`beforeEach` + `meta.requiresAuth`，同步判断 + bootstrap 放行）；登出/会话失效的「清栈」语义由会话清除标记双层承载（forward 守卫拦截 + back `canBack` 判定）；`backBehavior:'exit'` 迁到路由 meta；首帧内容化由模块顶层 `router.replace('/recommended')` 定起点保持。

## User Stories

1. 作为用户，我希望启动后首帧直接渲染推荐页骨架屏（不等待登录态恢复、无空白闪烁），以便启动体验与现状一致
2. 作为用户，我希望未登录时启动落在登录页（initRouter 收敛 replace，不入历史栈），以便登录后不可返回到登录页
3. 作为用户，我希望未登录访问业务页被引导到登录页（全局守卫），以便鉴权兜底不再依赖页面自理
4. 作为用户，我希望登录后全部业务页可达（推荐/插画/小说/收藏/追更/用户主页/关注·粉丝列表等 15 条路由），以便功能无缺漏
5. 作为用户，我希望进入详情页后系统返回键/侧滑手势能回到上一页，以便返回行为与现状一致
6. 作为用户，我希望页面内返回按钮与系统返回行为一致（共用守卫链），以便任意返回路径行为统一
7. 作为用户，我希望在根路由（无历史）按返回键看到「再按一次退出应用」提示，以便明确退出方式
8. 作为用户，我希望 2 秒内再按返回键能退出应用，以便快速退出
9. 作为用户，我希望弹层打开时返回键优先关闭弹层（modalStack 后进先出），以便返回键语义不被页面抢走
10. 作为用户，我希望小说详情「追更询问」拦截返回仍然生效（back-guard），以便防误退出
11. 作为用户，我希望详情页返回列表时列表页实例缓存保留（KeepAlive 白名单），以便列表滚动位置/状态不丢
12. 作为用户，我希望小说详情页按 :id 加载不被 KeepAlive 缓存旧 id，以便多次进出不同小说内容正确
13. 作为用户，我希望强制更新页（/update）返回键直接退出应用（backBehavior: exit），以便不存在返回路径
14. 作为用户，我希望会话失效错误页（/error）返回键直接退出应用，以便不能再回到已失效会话的页面
15. 作为用户，我希望退出登录后返回键不可回到登录前的业务页（会话清除语义等价清栈），以便切换账号干净
16. 作为用户，我希望退出登录后通过任何导航手段（forward）都不可再进入业务页直到重新登录，以便前会话页面不可达
17. 作为用户，我希望登录成功后会话标记建立并可正常进入业务页，以便登录流程无阻塞
18. 作为开发者，我希望页面调用面（navigate/goBack/requestBack/ensureAuth/registerBackGuard/currentParams/exitHint 等）签名不变，以便 15 处 goBack、2 处 requestBack 等调用点零改动
19. 作为开发者，我希望路由表 path/name/params 语义不变（`/illust/:id` 段级参数），以便现有页面取参逻辑不动
20. 作为开发者，我希望路由匹配相关纯函数（matchRoute 及其单测）继续保留或等价重构，以便回归锚点不丢
21. 作为开发者，我希望返回裁决（modalStack/back-guard/meta/双击）保持纯函数可单测，以便退回逻辑有测试锚点
22. 作为开发者，我希望全局守卫规则（bootstrap 放行/未登录重定向/会话清除拦截）有 node 单测锚点，以便鉴权逻辑可验证
23. 作为开发者，我希望 hasBackEntry() 探测（go(-1,false)+location）有单测锚点（createMemoryHistory 纯内存可测），以便升级后复验
24. 作为开发者，我希望 benchNav 测试钩子（ADR-0136）迁移后仍然可用（debug 直达各页），以便真机测试通道不丢
25. 作为开发者，我希望 web-core 白屏回归（scripts/test-lynx-web.sh）迁移后继续通过，以便启动崩溃防线不断
26. 作为开发者，我希望系统返回四场景+登出后返回+meta-exit 可脚本化复现（模拟器），以便验收可重复
27. 作为开发者，我希望现有 lynx 单测/差分测试/android-e2e（switch-client 等）不回归，以便双引擎行为契约不受影响
28. 作为开发者，我希望 bundle 体积增量以构建报告记录（vue-router 引入量），以便体积变化可审计

## Implementation Decisions

（来自 ADR-0138；此处为可执行细目，不含具体文件路径与代码）

- **D1 依赖**：`vue-router@^4.5.0` 已在依赖（lockfile 解析 4.6.4）；不升级 vue-lynx/web-core（版本组合已被实证锁定）。
- **D2 shim API 面（页面零改动）**：`navigate(path, {replace?})`（push/replace 语义，ADR-0049：登录导航 replace 不入栈）、`goBack()`（栈空/无效回退推荐页）、`requestBack()`（先跑 back-guard）、`registerBackGuard()`、`ensureAuth()`（实现改为守卫+bootstrap 收敛，签名不变）、`resetHistory()`（置会话清除标记）、`routeState/currentParams`（= `router.currentRoute` 的兼容导出）、`exitHint`（不变）。
- **D3 路由表**：15 条 path/name/component 1:1 迁移；`/update`、`/error` 加 `meta.backBehavior:'exit'`（**不标 requiresAuth**——两者是"清栈后目的页"，标注会被守卫自身重定向回 /login，P0-1）；业务页加 `meta.requiresAuth:true`（`/recommended` 等；`/login` 除外）；`/illust/:id` 等段级参数语义不变。
- **D4 系统返回裁决链**（顺序不变）：① modalStack 弹层 → close；② back-guard → intercepted；③ `currentRoute.meta.backBehavior==='exit'` → exitApp；④ `canBack = 会话镜像栈非空 ∧ 队列探测（hasBackEntryIn）∧ !cleared` → `router.back()`；⑤ 否则「再按一次退出应用」提示（2s 窗口，对齐 webview `EXIT_DOUBLE_TAP_MS`）→ 窗口内二按 → exitApp。**「能否返回」= 会话镜像栈（决策主源，resetHistory/markSessionEstablished 物理清空演进「清栈」语义，P1-2）∧ 官方 API 队列探测（看门狗防镜像漂移）**（原型产出形态，来自 probe 第 16 行实证；code-review 修订为混合形态）：
  ```ts
  // 队列探测原语（routerCore.hasBackEntryIn；镜像栈为决策主源）
  function hasBackEntryIn(history: RouterHistory): boolean {
    const before = history.location
    history.go(-1, false)
    const moved = history.location !== before
    if (moved) history.go(1, false)
    return moved
  }
  ```
- **D5 全局守卫**：`beforeEach`：`to.meta.requiresAuth` 时——bootstrap 期放行（首帧先渲染；鉴权失败由 401 兜底 + initRouter 收敛）；bootstrap 后 `cleared` 或未登录 → `return { path: '/login', replace: true }`。同步判断，不 await 网络。
- **D6 会话清除**：`cleared` 标记置位点 = `resetHistory()`（登出/会话失效调用点）；清除点 = 登录成功（authStore 登录成功回调，beginSession 语义）。`canBack` 与 D4 联动。
- **D7 首帧/入口**：模块顶层 `router.replace('/recommended')`（app.mount 前，官方一样式）；`initRouter()` 恢复 token+设置后 `replace(ok ? '/recommended' : '/login')`（同路径 replace 为无害 no-op）。
- **D8 App 出口**：`<RouterView v-slot="{ Component }"><KeepAlive :include="['recommended','illusts','novels','me']"><component :is="Component" /></KeepAlive></RouterView>`——**PascalCase**（kebab-case 陷阱）；KeepAlive 白名单语义不变（组件 name = 路由 name，现状已满足）。
- **D9 系统返回桥**：原生侧（OnBackPressedDispatcher → `pictelioBack`）不动；benchNav 钩子不动。
- **D10 版本后置验证**：探针分支保留；vue-lynx/web-core 升级后按探针复验（spec 完成后作为遗留项）。

## Testing Decisions

测试哲学：只测外部行为；不 mock vue-router 内部（memory history 是纯内存实现，node 环境直接可视作真实对象）。断言 oracle：官方文档语义 + 探针双端实证（差分于"探针已验的真行为"），禁止从实现自洽推导。

- **Seam 1 — node 单测**（现有 seam，`tests/`）：
  - 路由表完整性（15 条 path/name/meta 映射、段级参数匹配、`/update`/`/error` meta 断言）；
  - shim 行为：navigate 入栈/出栈语义、replace 不入栈、goBack 栈空回退推荐页、`currentParams`/`routeState` 与 `router.currentRoute` 同步；
  - `hasBackEntry()`：真 `createMemoryHistory` 上 0 条目/1 条目/多条目 push/replace 后探测正确、探测无副作用（location 还原、无监听触发）；
  - 守卫规则：bootstrap 放行、未登录重定向（replace 语义）、cleared 拦截、登录清 cleared——用 `router.currentRoute`/`router.resolve` 或真实 navigate 驱动断言最终落点；
  - routerCore 裁决纯函数：保留现有单测（evaluateBackRoute/meta.exit 组合），新增 meta.backBehavior 与 canBack 组合用例。
- **Seam 2 — web-core 白屏回归**（现有 `scripts/test-lynx-web.sh`）：迁移后同脚本必须通过（无 TDZ/loadCard failed、截图非白屏）。
- **Seam 3 — 模拟器系统返回回归脚本**（新，探针脚本固化）：`packages/app-lynx/scripts/` 新增回归脚本（ADR-0137 采样姿势 + lint 证据链）：① 详情返回键→上一页；② 根路由返回键→提示条；③ 2s 内再按→退出（launcher 焦点）；④ 侧滑→上一页；⑤ 登出后返回键→提示（不可回业务页）；⑥ 可加 /update meta-exit（benchNav 直达或 dev 钩子）→返回键直接退出。产物：脚本 + 断言日志。
- **Seam 4 — 现有套件不回归**：`tests/` 全部单测、differential 差分、android-e2e（client-kind-contract/switch-client 等）手工/CI 跑通。
- **验收门禁**：① 单测全绿；② test-lynx-web 通过；③ 系统返回回归脚本全绿（用户 Q4 硬约束）；④ 现有套件不回归。

## Out of Scope

- vue-lynx / @lynx-js/web-core 版本升级（探针已锁定当前组合；升级另行评估）
- 命名路由 `push({ name })` 的页面级改造（shim 保持字符串路径；能力随框架存在但不启用）
- query 参数的路由级支撑（现状无 query 用例，搜索走全局弹层 ADR-0132）
- 深链接/URL 能力（benchNav 保持测试钩子形态，不产品化）
- webview 客户端任何改动
- 除守卫外的路由中间件（beforeEach 只管鉴权/会话，不做埋点等）
- bundle 体积优化（仅记录增量）

## Further Notes

- 迁移中 `resetHistory` 语义变化点（物理清栈 → 语义拦截）已定义，代码注释需标注（重构行为不变约束的例外，本 spec + ADR 已记录）。
- 探针分支 `prototype/lynx-vue-router` 保留为 primary source（web-core 复验秒级、原生复验流程见结论文档）。
- 验收时对比迁移前（main）与迁移后行为：用现有（unmodified）测试套件作为基准。

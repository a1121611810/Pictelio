# Spec: app-lynx 状态管理迁移到 Pinia（setup store）

> 术语：见 `docs/adr/glossary-app-lynx-pinia.md`
> 决策：见 `docs/adr/ADR-0139-app-lynx-pinia-migration.md`
> 前提：官方文档确认 vue-lynx 支持 Pinia（`app.use(createPinia())` + setup store）；本 spec 为本组合（vue-lynx 0.5.1 / web-core 0.23.1 / Pinia 4.0.3 / vue 3.5.40）的**首次实证**，首步为 spike（见 T0）。

## Problem Statement

app-lynx 全部全局共享状态运行在**手写模块级 store** 上（`src/stores/` 9 个模块：模块顶层私有 `ref` + `computed` 导出 getter + 函数导出 action）。该模式与 Pinia setup store 语义等价，但缺三样东西：

1. **物理封装**：私有性靠 `_` 前缀命名约定——任何模块都能 `import { _user }` 直接写内部（无编译期/运行期防线）。
2. **测试隔离**：模块级单例跨用例共享状态，每个 store 都要手写 `resetXxxForTest()` 清理；漏写即用例间串扰（项目已有真实教训：`resetWatchlistStoreForTest`/`resetSearchHistoryForTest` 专为此而生）。
3. **测试 mock 面**：单测 mock 一个 store 要 mock **全部具名导出**（如 `router-shim-integration.test.ts` 里 mock `isLoggedIn`/`restoreToken`/`registerUnauthorizedHandler`/`currentUser` 4 个名字；`settingsStore` 被 mock 时 `currentUser` 还要自建 `ref` 桥接）——mock 面 = interface 面，interface 大时 mock 维护成本高。

对用户而言：**本次是行为等价迁移**——登录态、内容设置、搜索弹层、搜索历史、返回键弹层拦截、引擎切换、更新检查的行为全部不变（ADR-0139 决策 7 纯重构硬门禁），用户可感知的唯一变化是「代码里面那个 store 换了个语法」。⚠️ 任何行为变化都视为失败。

## Solution

按 ADR-0139 落地：引入 `pinia@^4.0.3`，新建 `src/stores/pinia.ts` 单例 seam（`export const pinia = createPinia()`），`index.ts` 改为 `app.use(pinia)`；7 个「模块级 ref 单例」store 逐个迁移为 **setup store**（`defineStore(id, () => {...})`，现状态/动作原样搬进 setup 闭包，私有成员不 return）。消费方从「import 具名导出 + `.value`」改为「`useXStore()` + 属性访问」。测试从「模块 mock 具名导出 + 手写 reset」改为「`setActivePinia(createPinia())` + mock `useXStore` 单函数」。

顺序：**先 spike（searchHistoryStore 试点）验证 Pinia 在 vue-lynx 0.5.1 双端可用** → 通过后逐个迁移 7 个 store（每 store 独立 commit）→ code-review 双轴门禁 → 提交。authStore 是最高价值试点（8 消费方）但依赖时序契约敏感（router 模块加载期守卫），放 spike 之后。

## User Stories

1. 作为用户，我希望登录（输入 refresh_token）后登录态保持，以便业务页可达（行为不变）
2. 作为用户，我希望启动时自动恢复登录态（Keystore/IndexedDB 读 refresh_token → 刷新 access_token），以便重启不丢登录（行为不变）
3. 作为用户，我希望输错 token 时看到内联错误提示，以便知道登录失败原因（行为不变，含错误文案）
4. 作为用户，我希望 401 后自动刷新并重放原请求，以便无感续期（行为不变）
5. 作为用户，我希望 OAuth 400（凭证失效）后进入全屏错误页「会话失效」，以便明确需要重新登录（行为不变）
6. 作为用户，我希望登出后内存与持久化 token 全部清空，以便换账号干净（行为不变，含原生 Java 堆清理）
7. 作为用户，我希望个人中心显示当前用户头像/昵称/账号，以便确认身份（行为不变）
8. 作为用户，我希望评论只显示自己的删除按钮，以便权限判定正确（行为不变）
9. 作为用户，我希望详情页「是否本账号作者」判定正确，以便操作入口不串（行为不变）
10. 作为用户，我希望 R18/R18G 开关切换后列表/遮罩即时生效，以便内容过滤（行为不变）
11. 作为用户，我希望 R18/R18G 开关按账号持久化（`show_r18_${uid}`），以便多账号互不干扰（行为不变）
12. 作为用户，我希望登出后 R18/R18G 开关回默认值，以便上账号偏好不残留（行为不变）
13. 作为用户，我希望详情页画质/动图解码模式设置生效并持久化，以便阅读体验（行为不变）
14. 作为用户，我希望全局搜索弹层开合与预填词行为不变，以便各入口触发搜索体验一致（行为不变）
15. 作为用户，我希望搜索历史 10 条最新在前、去重、单删/全清,以便搜索效率（行为不变）
16. 作为用户，我希望弹层打开时系统返回键优先关弹层，以便返回语义正确（行为不变）
17. 作为用户，我希望引擎切换（webview/lynx）写 SharedPreferences + 重启，以便切换客户端（行为不变）
18. 作为用户，我希望启动更新检查时序（首帧 500ms 后）与强制更新页行为不变，以便不被锁死/不误发（行为不变）
19. 作为开发者，我希望 store 的私有 ref 在编译期就不可达（setup 闭包），以便替代 `_` 命名约定
20. 作为开发者，我希望每个测试用例天然隔离（`setActivePinia(createPinia())`），以便删除 `resetXxxForTest` 钩子、杜绝用例串扰
21. 作为开发者，我希望 mock 一个 store 只需 mock `useXStore` 单函数，以便测试维护成本下降（mock 面 = interface 面）
22. 作为开发者，我希望跨 store 依赖显式化（settingsStore 内 `useAuthStore()` 组合），以便依赖图可读
23. 作为开发者，我希望 store 语义测试走真实 store（不 mock），以便测试面 = interface 面
24. 作为开发者，我希望每个 store 迁移独立 commit，以便 review/回滚粒度可控
25. 作为开发者，我希望「行为不变」由测试矩阵保障，以便纯重构可信

## Implementation Decisions

- **D1 依赖**：新增 `pinia@^4.0.3` 到 app-lynx dependencies；不升级 vue-lynx/web-core（当前版本组合由 spike 实证锁定）。
- **D2 store 形态**：全部使用 **setup store**（`defineStore(id, () => { ... return {...} })`）；options store 不用（与现状代码形态差距大）。
- **D3 pinia 单例 seam**：`src/stores/pinia.ts` 导出 `pinia`；`index.ts` `app.use(pinia)`（**不再内联 createPinia()**）；非组件上下文（router 守卫、测试）用同一实例——双实例 = 双 store 空间，状态互不同步。
- **D4 模块加载期时序契约（P0）**：`router.ts` 模块顶层 `router.replace()` 触发首导航 → 守卫读登录态。守卫内调用 `useAuthStore()` 必须在 active pinia 就位后——**禁止模块顶层调用 `useXStore()`**；spike 验证「app.use(pinia) 前导航是否已发生」；若实测会早于安装，则守卫内延迟取实例 + 模块顶层 `setActivePinia(pinia)` 双保险（ADR-0139 决策 4）。
- **D5 消费方改写规则**：script 内 `import { isLoggedIn }` → `const auth = useAuthStore()` + `auth.isLoggedIn`（值，非 ref；禁止 `.value`）；模板属性直接访问（自动解包）；**禁止直接解构 store 实例**（丢响应性），需要解构必须 `storeToRefs`；`watch` 等响应源场景用 `() => auth.isLoggedIn` 或 `storeToRefs`。
- **D6 私有性**：迁移 store 的所有非公开 ref（如 `_refreshToken`）留在 setup 闭包内**不进入 return 对象**（物理私有）；原 `_` 前缀命名保留（内部引用处不改名，减少 diff）。
- **D7 测试策略**：`beforeEach` 中 `setActivePinia(createPinia())`；删除被迁移 store 的 `resetXxxForTest`/`setXxxForTest` 钩子；模块 mock（`vi.mock('../src/stores/authStore', () => ({...具名}))`）改为 mock 单导出 `{ useAuthStore: () => ({...}) }`；**语义测试（登录/失效/登出）保持真实 store + 真实 tokenStorage mock**，不 mock store 本体。
- **D8 纯重构硬门禁**：字段名、常量、默认值、错误文本、判定逻辑（永久失效分类）、持久化键、注册时机、原生桥契约全部零改动；不引入 Pinia 持久化 plugin；不借机重构任何逻辑。
- **D9 迁移顺序**：spike（searchHistoryStore 试点，仅 1 消费方、无跨 store watch、无模块加载期触碰）→ authStore → searchSheetStore/modalStack → clientSwitchStore/updateStore → settingsStore（最大面，最后）；每个独立 commit。
- **D10 范围**：9 个 store 中迁移 7 个；`watchlistStore`（非响应式 Set/Map）、`globalFab`（惰性工厂接线）不迁；实例级 primitives（`useSearch`/`createMixFeed` 等）不迁（语义相反：单例 vs 实例）。

## Testing Decisions

测试哲学：**只测外部行为**（迁移前后的行为契约），不测实现细节（不断言「用了 ref 还是 pinia state」「store 内部是否 return 了某私有成员」）；对 store 的直接断言走真实 store（`setActivePinia` 后调用 actions、读 getters），对页面/组件隔离走 `useXStore` mock。断言 oracle：迁移前的行为（现有测试断言就是 oracle——**迁移后断言不变**，只有取用方式变）+ ADR/glossary 记的行为契约清单。

- **Seam 1 — node 单测（现有 seam，`src/**/*.test.ts` / `tests/`）**：
  - `unit.test.ts` 5 处 authStore describe（安全不持久化/登录/原生模式登出/会话失效）：**断言保持原样**（含 `isLoggedIn.value` → `store.isLoggedIn` 的取用方式变换），加 `setActivePinia`；
  - `searchHistoryStore.test.ts` / `searchSheetStore.test.ts` / `settingsStore.test.ts`：迁移时同步改 setActivePinia + 删除测试钩子；
  - `router-shim-integration.test.ts`：mock 面收敛为 `useAuthStore` 单函数，断言语义不变；
  - 现有全量 lynx 单测（70+ 文件）不回归。
- **Seam 2 — 行为契约清单（迁移前后逐条 diff）**：store 公开 API 集的成员/取值语义、错误文本、判定分支、持久化键、注册时机逐一对照 ADR-0139「行为不变」清单——review 依据「重构行为不变约束」，字段/常量/错误文案任何差异 = 失败。
- **Seam 3 — web-core 预览**：登录 → 推荐页 / 401 刷新（mockFetch）→ 不弹错误页 / 登出 → 状态清空 + R18 登出重置 / 搜索弹层开合与预填词。
- **Seam 4 — 原生模拟器**：登录态恢复（Keystore 路径）、系统返回桥裁决（modalStack → 守卫 → exit 语义）、引擎切换重启后客户端正确。
- **Seam 5 — 差分测试**：`tests/differential/*` 不回归（urlRewrite/oauthErrorClassify/restrictionTruthTable/illustTypeBadgeTruthTable）。

## Out of Scope

- `watchlistStore`（非响应式 Set/Map 缓存）与 `globalFab`（惰性工厂接线）——非「模块级 ref 单例」，无迁移收益。
- 实例级 primitives（`useSearch`/`createMixFeed`/`useComments`/`useScrollIndicator`/`createWatchlistToggle`/`createBookmarkToggle`/`createFabMenu`/`createWatchlistPrompt`/`createGlobalFab`/`watchlistFeed`）——单例 vs 实例语义相反，迁移破坏「页面独有数据由组件管理生命周期」约束。
- `api/client.ts`（accessToken、setAccessToken/setOnUnauthorized/setAuthPermanentFailure seam）与 `tokenStorage.ts`（IO 边界）——保持「store → client setter seam」单向关系。
- 任何行为变更：`authError` 分类对象化、`registerUnauthorizedHandler` 内化、错误判定列表修订、持久化合并——均为**行为变更**，不在本迁移（纯重构）范围，若有价值单独 ticket。
- Pinia 持久化 plugin、devtools 集成、HMR 配置——本迁移不引入。
- webview 客户端（SolidJS）——无 Pinia 概念。
- 不升级 vue-lynx/web-core。

## Further Notes

- **前置风险**：Pinia 在本组合（vue-lynx 0.5.1 + web-core 0.23.1 + Pinia 4.0.3）双端可用性**未被项目实证**——官方文档支持不等于本组合已验。swanky：T0 spike 若失败，迁移整体搁置（此时仅积累了 `docs/` 文档与调研，代码改动为零），结论回记为「本组合不兼容」并解构根因。
- spec 与 ADR 均为纯重构语义；任何后续「借机优化」主张从本 spec 移出并单独成票。
- 版本兼容：Pinia 4.0.3 peer 要求 vue ^3.5.11（项目 3.5.40 ✓）、typescript >=5.6.0（项目 5.7 ✓）、@vue/devtools-api ^8.1.5（deps 自动带，若 ws 版本冲突以 lockfile 为准）。

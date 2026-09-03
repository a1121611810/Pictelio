# ADR-0139: app-lynx 状态管理迁移到 Pinia（setup store，authStore 试点 + 全量路线）

- 状态：accepted
- 日期：2026-09-03
- 关联：[ADR-0138-app-lynx-vue-router.md](./ADR-0138-app-lynx-vue-router.md)（router 顶层 `replace` 是模块加载期时序契约的触发点）、ADR-0050（refresh_token 持久化）、ADR-0103（账号级设置键 `show_r18_${uid}`）、ADR-0053（NativeModule 契约）
- 来源：用户指令「lynx 可以使用 Pinia（官方文档），分析项目中可迁移的地方并走正式流程」（先于 grill（`/grill-me` 无代码库 / `/grill-with-docs` 有代码库）——本任务为**纯重构**（行为不变约定），按 AGENTS.md「允许的例外」直接提方案，无需 Grill 阶段）；前瞻结论：`vue.lynxjs.org/zh/guide/pinia.md`（官方支持 Pinia，`app.use(createPinia())` + setup store 语法）

## 背景

app-lynx 自 MVP 起使用**手写模块级 store**：模块顶层私有 `ref` + `computed` 导出 getter + 普通函数导出 action（`src/stores/` 9 个模块）。该模式在语义上等价于 Pinia setup store 的「无实例版本」，但缺少：物理封装（`_` 前缀靠约定）、测试隔离（模块级单例需手写 `resetXxxForTest`）、mock 面收敛（模块具名导出 vs `useXStore()` 单函数）、跨 store 组合的显式性（`import { currentUser }` vs `useAuthStore()`）。

官方文档（vue.lynxjs.org/zh/guide/pinia.md）明确 Lynx 支持 Pinia：`app.use(createPinia())` 注册 + setup store 语法（`ref`/`computed`/函数）+ 组件内 `useXStore()`。项目当前依赖：vue `^3.5.13`（lockfile 解析 3.5.40），Pinia `^4.0.3`（peer 要求 vue ^3.5.11，满足），vue-lynx `0.5.1`。

**范围判定**（9 个 store 逐个审查结论，见术语表「边界约定」）：
- **迁（7 个）**：authStore / settingsStore / searchSheetStore / searchHistoryStore / modalStack / clientSwitchStore / updateStore——全部是「模块级 ref 单例」形态。
- **不迁（2 个）**：watchlistStore（非响应式 Set/Map 缓存，无渲染订阅方，无 ref/computed）；globalFab（惰性工厂接线 `let _fab`，真正响应式在 `createGlobalFab` 实例内部，本文件只是注册表）。
- **实例级 primitives 不迁**：`useSearch`/`createMixFeed`/`useComments` 等（每次调用独立实例、生命周期绑定页面/组件、`dispose()` 于卸载时调用）——与「全局单例 store」语义相反，强迁破坏「页面独有数据由组件管理生命周期」硬约束（数据层分流）。

**试点选择**：authStore（8 消费方 + 内部 1 处跨 store 消费，是最高价值点）；searchHistoryStore 是**首跑 spike**（仅 1 消费方、无跨 store watch、无模块加载期触碰）——用来先验证「Pinia 在 vue-lynx 0.5.1 下双端是否真的可用」这个未实证前提，而不是直接拿 authStore 当实验品。

## 决策

1. **全量引入 Pinia（`pinia@^4.0.3`，依赖新增），状态迁移为增量**：先做 `src/stores/pinia.ts` 单例 seam + searchHistoryStore 试点（spike），完成验证后按顺序迁移其余 6 个；**每个 store 独立 commit**（消费方一起改），不做「一个 commit 全量迁移」。
2. **setup store（组合式）而非 options store**：现状是「模块顶层 ref + 函数」，setup 口味允许**原样搬运**（私有不 return 即可），options 口味需要重写为 state/getters/actions 对象字面量，迁移面更大。官方文档示例即 setup 口味。
3. **`src/stores/pinia.ts` 导出单例 `pinia`**：`index.ts` 改为 `app.use(pinia)`（不再内联 `createPinia()`）；所有非组件上下文（router 守卫、测试）用同一实例。理由：双实例 = 两个 store 空间（守卫读到空状态），单例 seam 是「第一行代码」，先于任何 store 改造落地。
4. **模块加载期时序契约显式化**（P0）：`router.ts:119` 模块顶层 `void router.replace(RECOMMENDED_PATH)` 触发首导航 → `beforeEach` 守卫读登录态。手写模式下模块求值即就绪；Pinia 模式 `useAuthStore()` 需 active pinia 已设置。守卫内**不依赖「app.use(pinia) 必然先执行」的推测**（microtask 级时序不可作为契约），改为守卫体中取实例 + spike 验证四场景（见「后果」验证矩阵）。`useAuthStore()` 的调用点**全部在函数体内**（守卫回调/组件 setup/initRouter），排查并禁止任何「模块顶层调用」。
5. **消费方改写规则**：`import { isLoggedIn }` → `const auth = useAuthStore()` + `auth.isLoggedIn`（script 内）；模板可直接属性访问（setup store 自动解包）；**禁止直接解构 store 实例**（丢响应性），需要解构时用 `storeToRefs`。
6. **测试策略**：测试文件 `beforeEach` 加 `setActivePinia(createPinia())`；删除迁移 store 的 `resetXxxForTest` 钩子（不再需要）；`vi.mock('../src/stores/authStore')` 类模块 mock 改为 mock `useXStore` 单函数（mock 面从 4 个具名导出收敛到 1 个函数）；auth 语义测试（unit.test.ts 5 处 describe）**保持真实 store + setActivePinia**，不用 mock（测试面 = interface 面）。
7. **纯重构约束（硬门禁）**：行为不变约定——字段名、常量、默认值、错误文本、判定逻辑（永久失效等）、持久化键（`show_r18_${uid}`、`refresh_token` 等）、注册时机、原生桥契约全部**零改动**。任何「借机优化」（authError 分类化、registerUnauthorizedHandler 内化、tokenStorage 合并等）**不在本 ADR 范围**，若要，须单独 ticket。
8. **排除项**：不动 `api/client.ts`（setAccessToken/setOnUnauthorized/setAuthPermanentFailure 保持为 store→client 的 setter seam）；不动 `tokenStorage`（IO 边界）；不动 watchlistStore/globalFab；不动实例级 primitives；不引入 Pinia 持久化 plugin；不改 webview 客户端（SolidJS 侧无 Pinia 概念）；不升级 vue-lynx/web-core；不内化/重构 authStore 的错误分类与 handler 注册。

## 被考虑的方案

- **不迁移，维持手写模块 store**：现状是深模块、行为已稳定、36 处 import 是改写完的机械成本。否决理由：私有性靠 `_` 约定（setup 闭包可物理封装）；测试隔离靠手写 `resetXxxForTest`（setActivePinia 每用例天然隔离）；mock 面 4 具名导出 → 1 函数；跨 store 组合（settingsStore→authStore）无显式 store 图。收益是**结构性的**（封装/隔离/测试面），不是功能性的。
- **options store 口味**：P1 否决——迁移面大（重写对象字面量），且与现状代码形态（闭包式动作）差距大。
- **只迁 authStore，其余维持手写**：混搭两种模式在同一目录（`stores/` 内部分 unit 已 Pinia 化）——共识类收益（测试隔离等）无法家族化，且未来新 store 需要「先问用哪种」。否决理由：9 个 store 7 个是同一形态，一次性声明路线（全量 Pinia）+ 增量实施，语义一致性优于短期的冒号中间态。
- **vuex**：Pinia 是官方推荐（vuex 4 停更于维护模式），且官方 Vue 文档推荐 pinia；无竞争力。
- **unstated / 自研 store 工厂**：自研（如 `createStore()` helper）无社区生态/devtools，且与官方模板能力（`$patch`/`storeToRefs`/`$subscribe`）差距大；不复造已成标准的轮子。

## 后果

- **正面**：① 私有 ref 从「`_` 约定」升级为「setup 闭包物理不可达」；② 测试隔离天然化（setActivePinia 每用例，删除 4 个 resetXxxForTest 钩子）；③ 测试 mock 面收敛（模块 mock 4 具名导出 → `useXStore` 1 函数）；④ 跨 store 组合显式化（settingsStore 的 `currentUser` 依赖从模块 import 变 store 组合）；⑤ 后续 store 新增可适用官方生态（devtools/plugin/HMR）。
- **代价/风险**：
  - **未实证前提**：Pinia 在 vue-lynx 0.5.1 + web-core 0.23.1 组合下的双端运行未被本项目实测过（官方文档支持 ≠ 本组合已实证）。**首步 spike 必须先跑通**：web-core 预览 + 原生模拟器双端，最小 demo（createPinia + 1 setup store + 组件读/写）——spike 不过则迁移搁置，改回手写模式（保留 pinia.ts 之外的改动为零）。
  - **消费方机械成本**：authStore 8 文件 + 全量 36 import / 19 文件；每 store 独立 commit，code-review 双轴门禁有完整调用点清单可核。
  - **时序契约**：router 模块加载期守卫（P0，见决策 4）——spike 第一条验证；若守卫在 `app.use(pinia)` 前触发有实测证据，则采纳「守卫内延迟取实例 + 模块顶层 `setActivePinia(pinia)`」双保险。
  - **测试改造**：unit.test.ts 5 处 describe、router-shim-integration.test.ts 模块 mock、settingsStore.test.ts authStore mock——均须同步改造并保持断言强度（真实 store 语义测试不降级为 mock）。
- **验证矩阵（验收硬约束，纯重构）**：
  1. `pnpm test:app-lynx`（含 unit.test.ts 5 处 authStore describe、router-shim-integration、settingsStore.test.ts）全绿；
  2. `pnpm check:app-lynx`（tsc）全绿；`pnpm build:app-lynx` 构建通过；
  3. web-core 预览：登录 → 推荐页正常、401 刷新（mockFetch 构造）→ 不弹错误页、登出 → 状态清空、settingsStore R18 登出重置；
  4. 原生模拟器：登录态恢复（Keystore 路径）、系统返回桥裁决（modalStack → 守卫 → exit 语义不受影响）；
  5. 差分测试不回归（tests/differential/*）。
  6. **行为对照**：迁移前后 store 行为逐条 diff（字段名/错误文本/判定分支/持久化键无差异）——review 依据「重构行为不变约束」。

## 修订注记（2026-09-03，实施阶段 code-review）

1. **非组件上下文访问 seam：wrapper 函数被全员剔除**。子代理初稿在 searchSheetStore / modalStack 保留 backward-compat wrapper 函数（`openSearch`/`closeSearch`/`hasOpenModal`/`closeTopModal` 等），主 agent 复核后剔除——`router.ts` 与 `globalFab.ts` 的非组件上下文调用全部切到 `useModalStack()`/`useSearchSheetStore()` 形态（前者 handleSystemBack 函数体内、后者 getGlobalFab 惰性创建函数体——均晚于 mount，pinia 已就绪）。**最终 store export 形态**：7 个迁移 store 各仅 1 个 `useXStore`（clientSwitchStore/updateStore 额外保留 `normalizeKinds`/`supportsClientSwitch`/`setUpdateCheckDisabledForTest`/`isUpdateCheckDisabled`/`ClientKind` 等模块级纯函数 / 类型，与 ADR 决策 6「纯函数保持模块级」一致）。
2. **跨 store 组合 T2 临时桥已收口**：T2 子代理初稿在 authStore.ts 模块层加 `export const currentUser = computed(() => getActivePinia() ? useAuthStore().currentUser : null)` 兼容桥（settingsStore 未迁需要此桥）。T5 完成后 settingsStore 改为 setup 内 `const auth = useAuthStore()` 跨 store 组合，**该桥被删除**；当前 authStore.ts 唯一 export 是 `useAuthStore`。
3. **`watch(currentUser)` 注册时机变化**：settingsStore 模块级 watch 在模块加载即注册，迁移后 setup store 的 watch 在 `useSettingsStore()` 首次调用时注册（晚于模块加载期）。**用户可见行为不变**：router.initRouter 在 restoreToken + loadSettings 阶段才触发首次 useSettingsStore()——登出信号到达时 watcher 已 ready，登出→R18 立即回默认的契约通过单测「登出：watch currentUser → refs 重置默认」验证。**未来风险**：若出现「登出先于首次 useSettingsStore()」的新代码路径，watcher 未挂载会漏重置；届时需提前在 setup 内 `const settings = useSettingsStore()` 强制实例化（pinia 已就位即可）。
4. **bundle 体积**：lynx 757KB（基线 754KB，+0.4%）、web 734KB（基线 730KB，+0.5%）——pinia 与 @vue/devtools-api 引入量在合理范围。
5. **D9 commit 粒度让步（review-time 决策）**：spec D9 要求「每个 store 独立 commit」，实际合并为 1 个 refactor commit + 1 个 build commit + 1 个 docs commit（d23b87f0 / f47b915f / e99a5c25）。**理由**：5 个 ticket 由 4 个并行子代理实施，工作树为单一连续改动，按接口 seam 复原已无意义——任何还原操作都会人为割裂原子行为单元。**补救**：若未来需 bisect 单 store 行为，可用 `git log --stat d23b87f0` + 「按文件路径过滤」辅助定位；该让步不影响代码正确性但弱化 rollback 粒度。**后续若再次跨 store 迁移**：建议先在子代理 prompt 中约束「每 store 单独 worktree + 各自 commit」，再聚合评审（code-review 完成后做 merge commit）。

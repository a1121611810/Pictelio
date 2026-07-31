# vue-lynx 深入分析（Pictelio 视角）

> 评估日期：2026-07-31（基于 `github.com/Huxpro/vue-lynx` main 分支源码 + 官方文档源文件核实，vue.lynxjs.org 站点网络不可达，改从仓库源码验证）
> 前置阅读：`docs/research/lynx-migration-feasibility.md`（Lynx 总体评估，本报告是其 §4.2 的深化）
> 结论速览：**vue-lynx 不是独立框架，而是"Vue 3 custom renderer + 复用 ReactLynx runtime 基础设施"**（`@lynx-js/react` 是其硬依赖）。Vue 兼容度极高（reactivity 100%、Composition API、SFC、Suspense、Transition 全支持），生态有官方 example（vue-router/pinia/tailwindcss/Vue Query）。但对 Pictelio 的三个关键落点：**路由可平移到 vue-router（memory history）、状态管理可平移（Vue Query ≈ TanStack），但小说排版受"background thread 无 getBoundingClientRect"约束、图片 Referer 需自研 ILynxImageService**。版本 0.5.1、Pre-Alpha、每日提交——生产需 PoC 前置。

---

## 1. 核心架构：它到底是什么

**一句话**：vue-lynx 是 **Vue 3 官方 runtime-core 之上的 custom renderer**（`vue-lynx` package.json 自述 "Vue 3 framework for building Lynx apps"，README 自述 "Vue 3 custom renderer for building Lynx apps"）。

### 1.1 关键事实：它构建在 ReactLynx 之上，不是独立实现

`packages/vue-lynx/package.json` 依赖（源码核实）：

| 依赖 | 版本 | 含义 |
|------|------|------|
| **`@lynx-js/react`** | ^0.116.5 | **硬依赖**——vue-lynx 复用 ReactLynx 的 runtime 基础设施（ShadowElement 树、ops 通道） |
| `@vue/runtime-core` | ^3.5.0 | Vue 官方 runtime core，100% 复用 |
| `@vue/compiler-core` | ^3.5.0 | Vue 模板编译器 |
| `@lynx-js/template-webpack-plugin` 等 | — | Lynx 构建链（webpack 系） |
| peerDeps | `@rsbuild/core` + `@rsbuild/plugin-vue` | 构建时用 Rspeedy/Rsbuild（Rspack 系） |

**架构含义**：Vue 的响应式/组件系统跑在 Vue runtime 里，但**最终渲染目标是 ReactLynx 的 ShadowElement 树**——即"Vue 语法 → Vue vnode → vue-lynx renderer → Lynx ShadowElement（ReactLynx 的运行时对象）→ ops → 原生渲染"。这不是"Lynx 原生支持 Vue"，而是"一个 Vue 适配层盖在 ReactLynx runtime 上"。

### 1.2 双线程模型（官方文档原图）

```
┌────────────────────────────────────────────────────────────┐
│                     Background Thread                      │
│  Vue 3 runtime · reactivity · lifecycle · your code        │
└──────────────┬──────────────────────▲──────────────────────┘
          ops  │                      │  events
               ▼                      │
┌─────────────────────────────────────┴──────────────────────┐
│                        Main Thread                         │
│  Native elements · layout · rendering · Main Thread Script │
└────────────────────────────────────────────────────────────┘
```

- **Vue 永远跑在 background thread**——reconciliation 从不阻塞主线程（这是 Lynx 双线程架构对 Vue 的承诺，官方称"like Web Worker offloading"）。
- 变更批量打包为 **ops** 下发主线程；用户交互以 **events** 回流；一个完整周期 = 一个 tick，`nextTick` 在原生元素 materialized 后 resolve。
- 对延迟敏感的逻辑（拖动、滚动、手势）用 **Main Thread Script** 标注函数直接跑主线程（`useMainThreadRef()` 获取原生元素、`main-thread-bind*` 事件）。

### 1.3 包结构（`packages/vue-lynx/`）

| 子包 | 作用 |
|------|------|
| `internal/` | ops 定义（跨线程数据协议） |
| `runtime/` | custom renderer 主体（`runtime/dist/index.js`，rslib 构建） |
| `main-thread/` | 主线程入口（entry-main，Main Thread Script 运行时） |
| `plugin/` | 编译器插件（`pluginVueLynx`，处理 SFC/CSS） |
| `types/` | TS 类型 + Volar 插件（IDE 支持） |
| 仓库级 | `create-vue-lynx`（脚手架）、`testing-library`（@vue/test-utils 适配）、`upstream-tests`（跑 Vue 上游兼容测试）、`ifr-bench`（首帧基准） |

---

## 2. Vue 兼容性矩阵（源码核实，官方 vue-compatibility.mdx）

### 2.1 完全支持（与 Web 一致，无需适配）

| 能力 | 状态 |
|------|------|
| Reactivity（`@vue/reactivity`） | ✅ **100% 复用**，`reactive/toRefs/computed/watch` 等零差异 |
| Composition API + `<script setup>` | ✅ |
| SFC：`<style>` / 导入 css / `<style module>` / `<style scoped>` | ✅（scoped 有 caveat 见下） |
| v-model（含 defineModel、.lazy/.trim/.number） | ✅ 组件级 + `<input>/<textarea>` 原生级 |
| 事件修饰符 | ✅ `.once` / `.stop`（映射原生 catch）/ `.self`；`.prevent` 为兼容 no-op |
| Slots（默认/命名/scoped） | ✅ |
| provide/inject | ✅ |
| Suspense + 异步组件 | ✅（defineAsyncComponent 需 lazy-bundle runtime） |
| Transition | ✅ 完整（CSS transition/animation/appear/mode/JS hooks/持久 v-show 行为） |
| KeepAlive | ✅（include/exclude/max + onActivated/onDeactivated） |
| Options API | ✅（默认开，可 `optionsApi:false` tree-shake ~9kB） |
| v-once / v-memo | ✅（缓存命中跳过整个跨线程 ops batch——对长列表是明确优化点） |
| Teleport | ⚠️ 仅 `to="#id"`（idRegistry 查找）；`.class`/元素引用不支持 |

### 2.2 不支持 / 有 caveat（对 Pictelio 的关键约束）

| 特性 | 原因 | Pictelio 影响 |
|------|------|--------------|
| **TransitionGroup 的 move/FLIP 动画** | **background thread 无 `getBoundingClientRect()`** | 间接信号：**任何依赖同步布局测量的逻辑在 background thread 都拿不到 rect** → 小说虚拟布局的测量只能走 Main Thread Script 或原生 |
| `:deep()/:slotted()/:global()` | scoped 样式深度选择器未实现（issue #164/#165） | Fluent 组件库的样式穿透写法要改写 |
| scoped 样式不叠加 | Lynx 每元素单一 CSS scope（子组件根元素不带父 data-v-*） | 组件样式隔离语义与 Web 略不同 |
| **`v-bind()` 驱动布局属性（如 font-size）响应式更新不生效** | Lynx 引擎限制（初始渲染对，reactive 变更不更新） | 需改用 `:style` 绑定 |
| select / checkbox / radio 的 v-model | Lynx 无这些原生元素 | 用自定义组件替代 |
| withKeys 键盘修饰符 | 原生运行时键盘事件不填充 event.key | 用 `@confirm` 替代 |

### 2.3 与 ReactLynx 的成熟度差异（决定性）

| | ReactLynx | vue-lynx |
|---|-----------|----------|
| 官方地位 | lynx-family 生产级（TikTok 大规模） | **Huxpro 个人账号，Pre-Alpha** |
| 版本 | 4.0 稳定发布（2026-07） | 0.5.1（2026-07-31 活跃提交） |
| 文档 | lynxjs.org 主站完整 | vue.lynxjs.org 独立站（本次评估网络不可达，仅源码可核） |
| 测试 | 生产验证 | 有 upstream-tests（跑 Vue 上游兼容测试）+ testing-library，但自标 "Expect bugs and enjoy!" |

---

## 3. 生态能力（对 Pictelio 最重要的三个落点）

### 3.1 路由：vue-router ✅（memory history）

官方 `routing.mdx`：Lynx 无 `window.location`/History API → **必须 `createMemoryHistory()`**（同 TanStack Router 的 memory history 思路）。`<RouterView>`、动态参数 `useRoute()`、`router.push/back/replace` 全部可用；`<RouterLink>` 需 `custom` prop + scoped slot 渲染 `<text>`。

**对 Pictelio**：现有 `@solidjs/router`（20 路由）→ vue-router + memory history 是**结构平移**——路径、参数、嵌套布局心智一致，比 uni-app x 的 pages.json 体系更接近现状。

### 3.2 状态管理：Vue Query ✅（官方推荐，TanStack 同源）

官方 `data-fetching.mdx` **明确推荐 TanStack Query (Vue Query)**，示例完整（useQuery/useMutation/optimistic updates/响应式 queryKey）。**Vue Query = `@tanstack/vue-query`，与现有 `@tanstack/solid-query` 同源**（同一 TanStack 生态）：

| 现有（SolidJS） | vue-lynx 对应 | 可平移性 |
|----------------|--------------|---------|
| `@tanstack/solid-query` | `@tanstack/vue-query` | ✅ queryKeys 工厂、缓存语义、infinite query 几乎同构 |
| queryKey 工厂模式 | 响应式 computed key（Vue 特有优势） | ✅ 甚至更强（ref 驱动自动 refetch） |
| pinia | 官方 example 有 pinia | ✅ 状态层可平移 |

### 3.3 网络层：fetch + 自定义 header ⚠️

- `fetch()` 内置（走 Lynx Http Service），**支持自定义 headers/POST/body**（官方 networking.mdx）——API 层 Referer 注入**可在 fetch 层做**（这是 vs Taro 的明显优势：Taro request 明确不能设 Referer）。
- 但 `<image>` 元素**无 header 属性**（同 Lynx 总体结论）→ 图片 Referer 仍需自定义 `ILynxImageService` 或 data: URI 兜底。

---

## 4. Pictelio 落点评估（深入）

### 4.1 三大高危区在 vue-lynx 下的精确状态

| 模块 | 状态 | 深入分析 |
|------|------|---------|
| **小说正文排版** | 🔴 高危 | Lynx 无 canvas/measureText；`getBoundingClientRect` 在 background thread **不可用**（TransitionGroup FLIP 失败的同一根因）→ 逐行测量只能：(a) Main Thread Script 同步测量（`useMainThreadRef` + 主线程 API）；(b) 原生 `ILynxTextService.getTextInfo` 自定义模块；(c) 放弃行级精确测量用 `<text>` 富文本 + `text-maxline` 降级。pretext 算法**不可迁移**，需按双线程模型重写。 |
| **图片流水线** | 🔴 需自研 | `<image>` 无 header；官方 Fresco 实现不传 customParam 为 header → 自定义 `ILynxImageService`（OkHttp 带 Referer + 磁盘缓存，复用现有 `PixivApiPlugin` 逻辑）。API 层 fetch 可带 header（比 Taro 顺）。 |
| **虚拟滚动 / Feed** | 🟡 中 | 用 Lynx 原生 `list`/`scroll-view`（引擎复用）；**v-memo 可跳过整棵跨线程 ops batch**——比 WebView 场景更适合长列表；现有 SolidJS 虚拟滚动算法不迁移。 |

### 4.2 UI 重写成本（SolidJS → Vue SFC）

- 20 路由 + 47 组件 **100% 重写**为 Vue SFC。
- **心智迁移成本低于 React**：Solid 的 signal/memo（`createSignal`/`createMemo`）与 Vue 的 `ref`/`computed` 概念高度同构；模板写法与 SolidJSX 差异小于 React。
- Fluent 设计令牌：CSS 变量 + flex 布局可平移；但 `:deep()` 不可用、scoped 语义不同、`v-bind()` 布局属性更新 bug → tokens 落地方式需调整。
- **可用 Tailwind**（官方 example 存在）——如果保留 UnoCSS 思路，Tailwind 是最近替代。

### 4.3 工程链

- 构建：Rspeedy/Rsbuild（Rspack 系）+ `@rsbuild/plugin-vue`；依赖 webpack 系 Lynx 插件。
- IDE：Volar + `vue-lynx/types/volar-plugin`（官方预配置）。
- 测试：`testing-library`（Vue 版适配）+ `upstream-tests`（Vue 上游兼容回归）——测试体系需重建，但 Vue 生态测试工具成熟。
- 版本基线：建议 Lynx Engine 3.8.1+；vue-lynx 0.5.1 对 @lynx-js/react ^0.116（4.x 时代）。

---

## 5. 风险清单与结论

### 5.1 风险清单

| # | 风险 | 等级 | 缓解 |
|---|------|------|------|
| 1 | **Pre-Alpha 生产风险**（个人账号、0.5.1、"Expect bugs and enjoy!"） | 🔴 高 | 立项前必须 PoC + 关注是否并入 lynx-family/转正路线 |
| 2 | 小说排版测量受双线程约束（无 background-thread rect） | 🔴 高 | 先 PoC：Main Thread Script 测量可行性 |
| 3 | 图片 Referer 需自研 ILynxImageService | 🟡 中 | OkHttp 逻辑可复用（低技术风险，纯工作量） |
| 4 | 构建链绑定 Rspeedy/webpack 系 Lynx 插件（非纯 Vite） | 🟡 中 | 官方脚手架 create-vue-lynx 已封装 |
| 5 | scoped CSS / v-bind() 布局属性 caveat | 🟡 中 | 组件库改造时规避 |
| 6 | 生态小、文档站点不可达 | 🟡 中 | 依赖仓库源码与 issue 跟踪 |
| 7 | 与 ReactLynx 的 runtime 耦合（@lynx-js/react 硬依赖） | 🟢 低 | 上游 ReactLynx 由字节生产维护，反而稳 |

### 5.2 结论

1. **vue-lynx 是"Vue 3 custom renderer 盖在 ReactLynx runtime 上"**，不是 Lynx 的原生 Vue 支持——理解这一点是评估前提：**它的稳定性上限由 ReactLynx（生产级）决定，下限由 vue-lynx 自身（Pre-Alpha）决定**。
2. **Vue 兼容度超出预期**：reactivity 100%、SFC、Suspense、Transition、KeepAlive 全支持；vue-router（memory history）、Vue Query、pinia 官方 example 齐备——**数据层/路由层可从现有 TanStack 生态平移**，这是它相对 uni-app x（pages.json + 自研 store）和 Taro（RN 锁死）的独特优势。
3. **对 Pictelio 的两个硬约束不变**（继承自 Lynx 总体）：小说排版测量需按双线程模型重写、图片 Referer 需自研 image service。
4. **若团队是 Vue 栈、且愿意承担 Pre-Alpha 风险**：vue-lynx 是"原生渲染 + Vue + TanStack 生态"三者的交集，值得做一轮专项 PoC（尤其小说排版测量）；**若求稳，ReactLynx 是官方生产基线**。
5. **决策前置项**：确认 vue-lynx 是否有转正/并入 lynx-family 的路线图（GitHub discussions/roadmap），否则 Pre-Alpha 状态下将其作为 Pictelio 唯一 client 层风险不可接受。

---

## 附录 A：评估信息来源

- 仓库：`github.com/Huxpro/vue-lynx`（README、packages/vue-lynx/package.json、runtime 结构、website/docs/guide/*.mdx）
- 官方文档源文件：introduction.mdx（双线程模型图）、vue-compatibility.mdx（兼容矩阵）、data-fetching.mdx（Vue Query 推荐）、routing.mdx（memory history）、typescript.mdx
- 上游：`lynxjs.org`（Lynx 引擎能力边界：无 canvas、ILynxTextService、ILynxImageService——见 `docs/research/lynx-migration-feasibility.md`）
- 交叉参考：`docs/research/lynx-migration-feasibility.md`、`docs/research/uniapp-x-migration-feasibility.md`
- 注：vue.lynxjs.org 站点在评估期网络不可达，所有内容以仓库源码为准

## 附录 B：关键引用（源码/官方文档摘录）

- "Vue 3 custom renderer for building Lynx apps"（vue-lynx README / package.json description）
- "Vue Lynx reuses `@vue/runtime-core` directly, so the Vue API behaves the same as on the web"（introduction.mdx）
- "Vue runs on the background thread; the main thread handles native rendering… Vue reconciliation never blocks the main thread"（introduction.mdx 双线程模型）
- "TransitionGroup move (FLIP) animations are not supported — getBoundingClientRect() is unavailable from the background thread"（vue-compatibility.mdx）
- "we recommend TanStack Query (Vue Query) for managing server state"（data-fetching.mdx）
- "you must use createMemoryHistory() instead of createWebHistory()"（routing.mdx）
- dependencies 含 `"@lynx-js/react": "^0.116.5"`（package.json）

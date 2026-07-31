# "单纯 Lynx"深度分析：不经过 ReactLynx / vue-lynx，直接用引擎开发

> 评估日期：2026-07-31（基于 lynxjs.org 4.0 文档 + lynx-family/lynx 与 lynx-stack 源码核实）
> 前置阅读：`docs/research/lynx-migration-feasibility.md`（Lynx 总体评估）、`docs/research/vue-lynx-deep-dive.md`（Vue 适配层）
> 结论速览：**Lynx 引擎确实是 framework-agnostic 的（官方博客明言"Lynx isn't limited to React，其他框架占内部一半用量"），"纯 Lynx"的编程模型在架构上存在——主线程用 Element PAPI 构造元素树 + 后台线程跑业务 JS + 引擎加载 bundle。但官方把全部工程化能力（template 编译、调试、工具链）只交付给了 ReactLynx——没有任何官方支持的手写 template / 免框架路径。对 Pictelio："单纯 Lynx"现实上不可行，除非自研整套框架层。**

---

## 1. 结论摘要

| 维度 | 结论 |
|------|------|
| 引擎是否独立于框架 | ✅ **是**——官方博客原话："the core engine is framework-agnostic… other frameworks already represent roughly half of Lynx's overall usage"（字节内部） |
| "纯 Lynx"编程模型 | ✅ 架构上存在：**主线程 Element PAPI（`__CreateElement` 等）+ 后台线程业务 JS + 引擎加载 bundle/template.js** |
| 官方是否有手写 template 的规范/教程 | ❌ **没有**——"template"只是 bundle 的历史名称（官方 Glossary 原话），无任何 DSL 格式规范 |
| 官方是否有免框架工具链 | ❌ **没有**——template 编译逻辑只在 `plugin-react` 内，lynx-stack 无独立 template 编译包 |
| 字节内部"一半非 React 用量"是什么 | ⚠️ **私有框架**——开源后只公开了 ReactLynx 一个 flavor，其余"are yet to come" |
| 对 Pictelio 的现实结论 | 🔴 **"单纯 Lynx"不可行**——除非自研整套框架层（template 编译 + MTS 编译 + DevTool 集成），等于重造 vue-lynx |

**一句话**：Lynx 引擎是"框架无关的渲染引擎"，但**"框架无关"不等于"免框架可用"**——官方把 template 生成、MTS 编译、调试工具全部绑定在 ReactLynx 插件上，纯引擎路径没有交付任何工程化能力。字节内部的一半非 React 用量是**不公开的私有框架**，不是开源可用路径。

---

## 2. 关键事实澄清

### 2.1 "template"是什么——官方定义（最容易误解的点）

官方 Glossary 原文（[glossary.md](https://lynxjs.org/4.0/guide/glossary.md)）：

> "Template is the **historical name** of bundle of compiled code loaded by Lynx engine to power the execution of a Lynx page (or application). We may investigate a better name for it in the future."

**"template"只是"编译后的 bundle"的历史叫法**，不是可手写的 DSL。Lynx Living Spec 定义 Bundle = **style sheet + script + 序列化元素树**（[living-spec](https://lynxjs.org/4.0/living-spec/index.html) §2.2.1）。产物 `main.lynx.bundle` 是二进制（含 JS 字节码 + styles + 序列化元素树），宿主通过 `LynxTemplateProvider` 加载。

> 对比：微信小程序/uni-app 的 wxml/vue 模板是**可手写的源码格式**；Lynx 的 "template" 是**编译产物**，二者不是一回事。想"手写 Lynx template"约等于"手写二进制 bundle"——没有官方格式文档。

### 2.2 Element PAPI（`__CreateElement` 等）是什么——给谁的

`lynxjs.org/4.0/api/engine/element-api.md` 罗列了全部 `__` 前缀 API（`__CreateElement`、`__SetInlineStyles`、`__SetEvents`、`__InsertElementBefore` 等）。**官方文档原话**（[__CreateElement.md](https://lynxjs.org/4.0/api/engine/element-api/__CreateElement.md)）：

> "The **frontend framework** can process the corresponding frontend tags into render directives as follows… `// main-thread.js let element = __CreateElement('input', 0, {})`"

**受众是前端框架开发者**（在 Main Thread Script 中构造元素树），不是普通应用开发者。Main Thread Runtime 文档也明说："Since ReactLynx developers don't need to manipulate Element directly in most scenarios…"（[main-thread-runtime.md](https://lynxjs.org/4.0/guide/scripting-runtime/main-thread-runtime.md)）。

**技术含义**：这正是 vue-lynx 这类框架的"着陆点"——框架在后台线程算好 UI 树，用 Element PAPI 在主线程建原生元素。**"纯 Lynx"= 你自己当这个框架**。

### 2.3 custom renderer 的真相

博客说引擎"flexible enough to switch to a custom renderer"（像素级跨平台渲染），**但同篇明说 "the custom renderer… are yet to come"**（[博客](https://lynxjs.org/4.0/blog/lynx-unlock-native-for-more.html)）——渲染后端尚未开源。社区追问 custom platform 时维护者只回 C++ 编译层面的答案（[discussion #133](https://github.com/lynx-family/lynx/discussions/133)）。

---

## 3. 官方多框架支持的真实状态（子代理调研）

| 问题 | 事实 |
|------|------|
| lynx-stack 有无独立 template 编译包 | ❌ 无。packages 清单：background-only/genui/i18n/lynx/motion/react/react-umd/repl/rspeedy/tailwind-preset/testing-library/tools/web-platform/webpack（[lynx-stack/packages](https://github.com/lynx-family/lynx-stack/tree/main/packages)） |
| template 编译逻辑在哪 | 只在 **`plugin-react` 内**（`react-rsbuild-plugin.lynxtemplateplugin`，[API 文档](https://lynxjs.org/4.0/api/rspeedy/react-rsbuild-plugin.lynxtemplateplugin.md)）——"把框架渲染结果编译成 template"目前只有 React 插件实现 |
| rspeedy 核心是否框架无关 | ⚠️ `plugin-lynx`（`@lynx-js/rsbuild-plugin`）框架无关可单独用 `pluginLynx()`，但**无 template 生成、无 MTS 编译、无 sourcemap/UI source map 配套** |
| 官方对 Svelte/其他框架的响应 | ❌ issue #144 "[Feature]: svelte guide" 至今 open（label `framework:Svelte`）；讨论 #102 维护者只回 issue 链接（[issue #144](https://github.com/lynx-family/lynx/issues/144)、[discussion #102](https://github.com/lynx-family/lynx-stack/discussions/102)） |
| vue-lynx 归属 | Huxpro（Lynx 核心成员）**个人仓库**，非 lynx-family org（[vue-lynx](https://github.com/Huxpro/vue-lynx)） |
| 官方认可的非 React 应用层 | 只有 **App Framework**：Sparkling（TikTok 开源移动框架）+ Lynxtron（桌面，未发布）——但都是 React/前端栈封装（[build-with-app-framework](https://lynxjs.org/4.0/guide/start/build-with-app-framework.md)） |
| 字节内部"一半非 React 用量" | **私有框架**，未开源；开源交付的只有 ReactLynx（官方博客原话） |

---

## 4. "单纯 Lynx"对 Pictelio 的现实评估

### 4.1 三条"不用 React 用 Lynx"的路径对比

| 路径 | 工程化程度 | 生产可行性 | Pictelio 评估 |
|------|-----------|-----------|--------------|
| **A. 手写 template / 直接用 Element PAPI** | 无工具链（无编译/调试/sourcemap） | ❌ 官方无任何文档承诺；需自研框架层 | 🔴 不可行——等于自己造一个 vue-lynx，还缺官方支持 |
| **B. 用 `pluginLynx()` 框架无关打包 + 自研 renderer** | 只有基础 bundle 打包；template 编译缺失 | ⚠️ 技术上可能，工程量巨大 | 🔴 不可行——template 生成正是最难的部分 |
| **C. ReactLynx / vue-lynx / Sparkling** | ✅ 完整（React 系）或社区（Vue） | ✅ React 系官方生产级 | 🟢 唯一现实路径（回到前两篇报告结论） |

### 4.2 关键洞察：为什么"官方支持多框架"和"纯 Lynx 可用"是两回事

- **框架无关（framework-agnostic）**：引擎内部是开放的——`__CreateElement` 等 PAPI 文档化、bundle 格式有 Living Spec、`pluginLynx()` 可独立使用。这是**架构事实**。
- **免框架可用（framework-free）**：需要 template 编译器、MTS 编译器、调试器——这些**只在 ReactLynx 插件里**。这是**交付事实**。
- 字节内部"一半非 React"证明框架无关是真实的，但那是**他们自己维护的私有框架**——开源社区拿不到。

### 4.3 对 Pictelio 的结论

1. **"单纯 Lynx"不构成一个可选方案**——它没有交付物，只有引擎。用它的唯一方式是自研框架层（工程量≈重新实现 vue-lynx + 配套工具链）。
2. **如果不想用 React、也不信任 vue-lynx（Pre-Alpha）**，现实选择是：
   - 等 vue-lynx 转正（当前 0.5.1 Pre-Alpha、个人账号）→ 风险不可控；
   - 用 ReactLynx（官方唯一生产路径）→ 接受 React 重写；
   - 回到其他候选（uni-app x 等）。
3. **"引擎 framework-agnostic"是真实卖点，但当前对 Pictelio 无用**——除非团队愿意投入自研框架层，否则这句话只是"未来可能支持"的期权，不是当下可用的能力。

---

## 5. 与本系列其他报告的定位

| 报告 | 回答的问题 | 结论 |
|------|-----------|------|
| `lynx-migration-feasibility.md` | Lynx 整体能否替换 client | 嵌入最顺 + 原生渲染，但 UI 重写 + 引擎 12MB + 图片/测量自研 |
| `vue-lynx-deep-dive.md` | 用 Vue 写 Lynx 是否可行 | Vue 兼容度高、生态可平移，但 Pre-Alpha |
| **本报告** | **不用任何框架直接用 Lynx** | **架构上存在，工程上无交付——不可行** |

**最终定位**：Lynx 的"框架无关"是架构层的开放性，不是"开箱即用的免框架开发"。"单纯 Lynx"对 Pictelio 现实上不可行；要在 Lynx 上开发，现实选择只有 ReactLynx（官方生产）或 vue-lynx（Pre-Alpha 赌注）。

---

## 6. 开源完整性审计（追加：Lynx 是否 100% 开源）

> 追加背景：用户追问"Lynx 也没有完全 100% 开源？"。结论：**核心引擎完整开源（Apache-2.0），但确实不是 100%——有三类明确未开源/未交付的部分。**

### 6.1 已开源（Apache-2.0，可审计）

| 仓库 | 内容 | 许可 |
|------|------|------|
| `lynx-family/lynx`（15k stars，4922 commits） | **核心引擎**：`core/`（渲染/CSS/布局/template_bundle/lepus）、`platform/`（Android/iOS/Harmony 原生层）、`devtool/`、`explorer/`、`gfx/`、`service_impls/` | Apache-2.0（官方 README 原话 "Lynx is Apache licensed"） |
| `lynx-family/lynx-stack` | ReactLynx 全部工具链：rspeedy、plugin-react、web-platform、testing-library 等 | Apache-2.0 |
| `lynx-family/primjs` | 主线程 JS 引擎 PrimJS | 开源 |

**移动端原生渲染管线是完整开源的**（platform + core），Pictelio 评估所需的"嵌入 + 原生渲染 + ReactLynx"全部在开源范围内。

### 6.2 未开源 / 未交付（官方博客原话 "are yet to come"）

| # | 未开源项 | 证据 | 对 Pictelio 影响 |
|---|---------|------|-----------------|
| 1 | **custom renderer（自定义渲染器）** | 博客："the custom renderer… are yet to come"；README 宣传的 "pixel-perfect consistency across mobile and desktop via our custom renderer" 尚未交付；社区讨论 #133 维护者只回 C++ 编译层面 | 🟢 不影响——custom renderer 是"像素级跨端一致渲染"（类 Flutter 自绘），**移动端走已开源的 platform 原生渲染管线** |
| 2 | **字节内部占一半用量的非 React 框架** | 博客："other frameworks already represent roughly half of Lynx's overall usage"，但开源只交付 ReactLynx 一个 flavor | 🔴 影响——这是"纯 Lynx/多框架"不可行的根因：**官方没把其他框架的工程化能力开源** |
| 3 | **部分周边能力** | 博客："additional UI components, advanced built-in graphics capabilities… are yet to come" | 🟡 影响小——UI 组件（lynx-ui 已部分开源）与高级图形能力，非核心路径 |

### 6.3 精确结论

1. **"Lynx 没有 100% 开源"——判断正确**，但要精确：开源的是**核心引擎 + ReactLynx 工具链**（Apache-2.0、15k stars、4922 commits、可审计），未开源的是 **custom renderer + 字节内部私有框架 + 部分高级图形能力**。
2. **对评估最关键的事实**：Pictelio 需要的东西（原生渲染、嵌入 LynxView、ReactLynx）**全部在开源范围内**，不存在"用黑盒"的问题。
3. **未开源部分的影响落在"多框架生态"上**：官方只交付 ReactLynx，"纯 Lynx"和 vue-lynx 之外的框架都得不到官方工程化支持——这正是第 4 章"单纯 Lynx 不可行"结论的开源维度解释：**不是引擎不开放（架构是开放的），是官方没把其他框架的工程化能力开源出来**。

---

## 7. "用 Lynx 只有 ReactLynx 和 vue-lynx 吗"（追加：框架选择全景）

> 追加背景：用户追问"要用 Lynx 的话，只能是 ReactLynx 和 vue-lynx 吗？"。结论：**开源社区能直接写的 UI 框架层确实主要就是这两个，但完整答案是"3 层 5 条路径"——还需补充 Sparkling（官方 App Framework）与纯引擎自研。** 用户的理解对了一半。

### 7.1 完整框架选择全景（开源范围内）

| 层级 | 路径 | 前端层 | 状态 | 适用 |
|------|------|--------|------|------|
| **UI 框架层** | ReactLynx | React | ✅ 官方生产级（TikTok） | 想用 React |
| | vue-lynx | Vue 3 | ⚠️ Pre-Alpha（Huxpro 个人） | 想用 Vue，能承受风险 |
| | 纯引擎自研 | 无（自己写） | ❌ 无工程化交付 | 几乎不可行 |
| **App 框架层**（盖在 UI 框架上） | **Sparkling** | **仍基于 ReactLynx** | ✅ TikTok 官方（2.0.0） | 想开箱即用完整 App（路由/导航/CLI/bridge） |
| | Lynxtron | 桌面版（coming soon） | ⏳ 未发布 | 桌面端 |
| **字节内部** | 私有框架（占内部一半用量） | 未开源 | ❌ 拿不到 | — |

### 7.2 关键澄清：Sparkling 不是"第三个框架"，是 ReactLynx 之上的应用框架

官方文档（[build-with-app-framework.md](https://lynxjs.org/4.0/guide/start/build-with-app-framework.md)）与 Sparkling 文档核实：

- Sparkling = "TikTok's open-source mobile application framework built on Lynx"（[sparkling 官网](https://tiktok.github.io/sparkling/)），提供：scheme-driven 多页路由、type-safe JS↔Native bridge（codegen）、脚手架 CLI、原生壳工程、`sparkling-storage` 等模块化 API。
- **但默认模板是 "Lynx/React entry points"**（[create-new-app 文档](https://tiktok.github.io/sparkling/guide/get-started/create-new-app.html) 原话 "src/: Lynx/**React** entry points and assets"）——**前端层仍是 ReactLynx**。
- 类比：Sparkling ≈ "Lynx 版的 Next.js/Expo"（完整应用框架），ReactLynx ≈ "React"，vue-lynx ≈ 试图当"另一个 React 的替代渲染器"。
- 含义：**选 Sparkling 并不改变"前端必须 React（或 vue-lynx）"的约束**，只是多了开箱即用的应用层能力。

### 7.3 对 Pictelio 的落点

1. **"只能用 ReactLynx 和 vue-lynx"——基本正确**（对"想自己写 UI 框架层"而言），但需修正两点：
   - **Sparkling 是第三选择**，且是 TikTok 官方生产级——如果看重"官方完整应用框架 + Brownfield Ready（可增量集成现有工程）"，Sparkling 值得单独评估（尤其它的 scheme 多页路由 vs 现有 @solidjs/router 的结构差异）。
   - **它不改变前端语言约束**：Sparkling 底下还是 ReactLynx，不会让 SolidJS 代码可复用。
2. **修正后的决策树**（想在 Lynx 上开发）：
   - 想用 React + 要完整 App 能力 → **Sparkling**（官方生产，Brownfield Ready）
   - 想用 React + 只要渲染层 → **ReactLynx**
   - 想用 Vue + 能承受 Pre-Alpha → **vue-lynx**
   - 其他 → 没有第四条官方路径
3. **回到本系列主线**：对 Pictelio（SolidJS 现状），无论选 Sparkling / ReactLynx / vue-lynx，**UI 都是 100% 重写**（React 或 Vue）——Sparkling 的增量价值在"应用框架开箱即用"，不在"免重写 UI"。

---

## 附录 A：评估信息来源

- 官方文档：`lynxjs.org/4.0/`（glossary.md、living-spec、api/engine/element-api.md、__CreateElement.md、main-thread-runtime.md、build-with-app-framework.md、llms.txt、api/llms.txt）
- 官方博客：`lynx-unlock-native-for-more.html`（框架无关声明、custom renderer "yet to come"）
- 源码：`github.com/lynx-family/lynx`（core/template_bundle、core/runtime/lepus、lepusng）、`github.com/lynx-family/lynx-stack`（packages 清单、plugin-lynx、plugin-react、examples）
- 社区：discussion #102、#133、issue #144（官方维护者回复）
- 交叉参考：`docs/research/lynx-migration-feasibility.md`、`docs/research/vue-lynx-deep-dive.md`

## 附录 B：关键引用（官方文档/博客摘录）

- "We are open-sourcing ReactLynx as Lynx's initial frontend framework flavor. However, **Lynx isn't limited to React**. In fact, other frameworks already represent roughly half of Lynx's overall usage"（博客，框架无关声明）
- "Not only is the core engine of Lynx framework-agnostic, but it's also agnostic to host platforms and rendering backends"（博客）
- "Template is the **historical name** of bundle of compiled code loaded by Lynx engine"（Glossary）
- "The **frontend framework** can process the corresponding frontend tags into render directives as follows… `let element = __CreateElement('input', 0, {})`"（__CreateElement.md，PAPI 受众）
- "the custom renderer… **are yet to come**"（博客，渲染后端未开源）
- template 编译逻辑仅在 `react-rsbuild-plugin.lynxtemplateplugin`（API 文档）
- issue #144 "svelte guide" 至今 open；discussion #102 维护者无落地计划

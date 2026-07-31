# Pictelio 迁移到 Tauri 2 技术可行性评估

> 评估日期：2026-07（基于 Tauri v2 官方文档与源码）
> 前置阅读：`docs/research/uniapp-x-migration-feasibility.md`（uni-app x 方案对比基线）
> 结论速览：**Tauri 与 Capacitor 同类（系统 WebView 渲染 + 原生壳），与 uni-app x 相反。它能"重写整个 App"（且 UI 层不用重写），但官方不支持"嵌入现有原生工程只换 Client"——这一点反而比 uni-app x 更难。图片代理（shouldInterceptRequest）是最大改造点。**

---

## 1. 结论摘要

| 维度 | 结论 |
|------|------|
| 定位 | 🟦 **与 Capacitor 同类**：Rust Core 进程 + 系统 WebView（WRY）渲染；与 uni-app x（原生渲染）相反 |
| "保留平台层+Activity，只换 Client"（上轮同款问题） | 🔴 **官方不支持**——`gen/android` 是独立完整工程，`MainActivity` 固定继承 `TauriActivity`，无嵌入现有工程的官方途径 |
| 全量重写 App（UI 保留） | 🟢 **可行且成本远低于 uni-app x**：SolidJS 前端、pretext 小说排版、Web Worker 全部可保留 |
| UI 层 | 🟢 **保留现状**（WebView 渲染兼容任意前端框架）——这是与 uni-app x 的本质差异 |
| 图片流水线 | 🔴 `shouldInterceptRequest` 被 WRY 内部占用，只能拦自定义 scheme；需改前端 URL scheme 或自维护 `RustWebViewClient` |
| 包体积 | 🟢 官方宣称最小 <600KB（桌面）；Android 估算 ~3~6M 量级，**远小于 uni-app x 的 ~10M+** |
| 内存 | 🟨 与现状相当（同为系统 WebView + JS 引擎），无 uni-app x 的原生渲染省内存红利 |
| 安全性 | 🟢 Rust 内存安全 + capability/ACL IPC 白名单 + 官方安全审计；但仍是 WebView（JS 注入面、WebView 版本碎片化与现状相同） |
| 可维护性 | 🟨 UI/测试保留（巨大优势），但新增 Rust 技术栈 + gen/android 由 CLI 生成（改原生代码有被覆盖风险） |

**一句话**：Tauri 不是 uni-app x 的替代，而是 **Capacitor 的"Rust 版"**——它解决的是"WebView 壳 + 原生能力"这条路线的性能与安全升级，而不是"原生渲染"。对 Pictelio：**全量重写可行且 UI 不用动，但"只换 Client 保留原生壳"这条路在 Tauri 上走不通（官方不支持嵌入），图片代理是主要障碍。**

---

## 2. Tauri 架构定位（先厘清"像不像 uni-app"）

用户直觉"Tauri 跟 uni-app 很像"——**表面像（都有前端 + 原生壳），内核完全相反**：

| | uni-app x | Capacitor（现状） | Tauri |
|---|-----------|------------------|-------|
| 渲染层 | **原生渲染**（kotlin/swift，无 WebView） | 系统 WebView | **系统 WebView（WRY）** |
| 逻辑层 | uts（编译为原生语言） | JS（浏览器） | **Rust Core**（独立进程） |
| 前端框架 | vue（uvue 专属） | 任意（本项目 SolidJS） | 任意（SolidJS/Svelte/Vite 均可） |
| 进程模型 | 单进程原生 | WebView 进程 | **Core + WebView 多进程**（类似 Electron） |
| 嵌入现有原生工程 | ✅ 原生 SDK（VDOM 模式） | ✅ 天生如此 | ❌ 官方不支持 |

**Tauri 官方自述**（`v2.tauri.app/start/`）："Tauri apps take advantage of the web view already available on every user's system"（复用系统 WebView）+ "A minimal Tauri app can be less than 600KB"——**包体逻辑与 Capacitor 完全相同**：不打包浏览器引擎。

对 Pictelio 的直接含义：**Tauri 能跑现有 SolidJS SPA 原封不动**（DOM、canvas measureText、Web Worker、requestAnimationFrame 全部可用）——上一份报告里 uni-app x 的三大高危区（小说排版、虚拟滚动、Worker 测量）在 Tauri 下**全部不存在**。

---

## 3. 问题一："保留平台层+Activity，只换 Client"——❌ 官方不支持

用户上一轮对 uni-app x 问的是"底层（平台+Activity）保持，Client 换"。Tauri 对这个问题的答案是**不支持**，且比 uni-app x 更难：

| 能力 | Capacitor（现状） | uni-app x 原生 SDK | Tauri 2 |
|------|-------------------|--------------------|---------|
| 嵌入现有原生工程 | ✅ 官方就是"在现有工程加 Web 壳" | ✅ 官方原生 SDK 支持渐进式嵌入 | ❌ `gen/android` 是**独立完整工程** |
| MainActivity 形态 | `extends BridgeActivity`（可改） | 新增 `UniAppActivity`（保留原 MainActivity） | **固定 `extends TauriActivity()`**（模板硬编码） |
| webview 放局部 View | ✅ 可自定义布局 | ⚠️ 仅 VDOM 模式 | ❌ Android 无 `build_as_child`（WRY 明确仅桌面三平台支持） |
| Rust core 形态 | — | — | `libapp_lib.so` 经 JNI 启动（`mobile_entry_point`） |

**证据要点**（子代理调研，逐条可溯）：
- `gen/android` 模板是标准独立 Gradle 工程：根 `build.gradle.kts` + `include ':app'` + `buildSrc`（[tauri-cli/templates/mobile/android](https://github.com/tauri-apps/tauri/tree/dev/crates/tauri-cli/templates/mobile/android)）
- `MainActivity.kt` 模板：`class MainActivity : TauriActivity()`（[源码](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/templates/mobile/android/app/src/main/MainActivity.kt)）
- Rust core 以 cdylib（`libapp_lib.so`）+ JNI 启动（[移动插件开发文档](https://v2.tauri.app/develop/plugins/develop-mobile/)）
- WRY README："Child webviews（`build_as_child`）仅 macOS/Windows/Linux"——**Android 无嵌入容器 API**（[wry](https://github.com/tauri-apps/wry)）
- 官方文档里的 "Brownfield Pattern" 是**前端 JS 安全模式**，与"嵌入现有原生工程"毫无关系（[IPC brownfield](https://v2.tauri.app/concept/inter-process-communication/brownfield/)）

> **结论**：如果"相同的事情"= 保留现有 Java 平台层 + MainActivity、只把渲染层换成 Tauri——**做不到**。uni-app x 至少官方给了渐进式嵌入路径，Tauri 连这条路都没有。Tauri 的形态是"整个 App 就是 Tauri 工程"。

---

## 4. 问题二：全量重写（UI 保留）——🟢 可行，且是 Tauri 的强项

若接受"整个 App 用 Tauri 重做"（放弃现有 Android 原生工程，新建 Tauri 工程），Tauri 反而是**三个方案里迁移成本最低**的：

### 4.1 资产复用盘点（vs uni-app x 的对照）

| Pictelio 资产 | uni-app x 命运 | Tauri 命运 |
|--------------|---------------|-----------|
| **SolidJS UI（20 路由 + 47 组件）** | 🔴 100% 重写 | 🟢 **原样保留**（WebView 渲染任意前端框架，Vite 构建直接可用） |
| **pretext 小说排版**（canvas measureText） | 🔴 算法作废，最高风险 | 🟢 原样可用 |
| **虚拟滚动 / Web Worker / DOM API** | 🔴 全部失效 | 🟢 原样可用 |
| UnoCSS + Fluent tokens | 🔴 ucss 子集重写 | 🟢 原样可用（完整 CSS） |
| `api/*` 业务逻辑 | 🟡 传输层重写 | 🟢 保留（前端仍跑在浏览器环境） |
| TanStack Query/DB | 🟡 替换 | 🟢 保留 |
| Java 插件（网关/加密/缓存） | 🟡 剥离注解复用 | 🟡 **迁到 Rust**（或 Kotlin 插件，见 4.2） |
| `shouldInterceptRequest` 图片代理 | 🔴 失效，改下载器 | 🔴 失效，改 scheme 协议（见 5） |
| 测试（Vitest + E2E） | 🔴 重建 | 🟢 单测保留；E2E 需适配 Tauri WebDriver |

### 4.2 原生逻辑迁移路径（Java → Rust/Kotlin）

Tauri 移动端插件支持 **Kotlin/Java 原生代码**（`app.tauri.plugin.Plugin` 子类），Rust 侧经 JNI 调用（[develop-mobile](https://v2.tauri.app/develop/plugins/develop-mobile/)）。因此：

- **短期**：现有 `PixivApiPlugin` 的 OkHttp 网关、401 锁、Keystore 加密可整体搬进 Tauri 的 Kotlin 插件（`android/` 目录），改动最小；
- **长期**：逻辑迁入 Rust（网络用 reqwest、密钥用 stronghold 插件），获得内存安全 + 令牌不进 JS 堆也不进 dex（在 `.so` 内）——比现状（Java 堆隔离）更强。

---

## 5. 最大改造点：图片流水线（🟢→🔴 的转折）

现状依赖 `MainActivity.shouldInterceptRequest` 拦截 `/pixiv-img/` 请求 → OkHttp 带 Referer 下载 → 磁盘缓存 → 返回流。**Tauri 下这个钩子不可用**：

**调研结论**（子代理，逐条可溯）：
- WRY 的 Android `RustWebViewClient.kt` **确实重写了 `shouldInterceptRequest`**，但只把请求分发给 Rust 侧"自定义协议 handler"（[RustWebViewClient.kt](https://github.com/tauri-apps/wry/blob/dev/src/android/kotlin/RustWebViewClient.kt)）；未注册 scheme 一律返回 null 放行（[binding.rs](https://github.com/tauri-apps/wry/blob/dev/src/android/binding.rs)）
- **没有**"改写任意 http(s) 请求 / 注入自定义 Header / 替换字节流"的公开 API（[wry#905](https://github.com/tauri-apps/wry/issues/905)、[wry#1087](https://github.com/tauri-apps/wry/issues/1087)）
- Android `shouldInterceptRequest` 拿不到 POST body，进一步限制请求改写（[wry#1448](https://github.com/tauri-apps/wry/issues/1448)）
- 自定义协议 `register_uri_scheme_protocol` 是一等公民，跨平台可用（[docs.rs](https://docs.rs/tauri/latest/tauri/struct.Builder.html#method.register_uri_scheme_protocol)）

**两条可行路径**：

| 方案 | 做法 | 代价 |
|------|------|------|
| A. 前端改写 URL scheme（推荐，纯官方 API） | 前端把图片 URL 从 `https://i.pximg.net/...` 改为 `pixiv://img/<path>`；Rust `register_uri_scheme_protocol("pixiv")` 用 reqwest（带 Referer）下载 → 返回字节流；磁盘缓存逻辑迁 Rust | 改前端图片 URL 生成逻辑 + 新写 Rust 下载/缓存模块 |
| B. 自维护 `RustWebViewClient` | 改 gen/android 里 WRY 生成的 Kotlin 代码，恢复通用拦截 | 需维护 fork，**`tauri android init` 重新生成会被覆盖**，长期维护成本高 |

> **结论**：图片流水线必须重写，但**重写幅度小于 uni-app x**（uni-app x 要整个换成"下载到本地文件再显示"；Tauri 的 scheme 方案仍走"URL → 拦截 → 字节流"的轻量模型，且 L1/L2 缓存逻辑可保留）。

---

## 6. 六维评估（对照用户上轮问题框架）

### 6.1 性能

- **本质**：与现状同为系统 WebView 渲染——**性能表现与 Capacitor 相当**（不差也不超），没有 uni-app x 的原生渲染红利。
- **Rust Core 的收益**：CPU 密集型逻辑（JSON 解析、401 刷新队列、缓存管理）放 Rust 后**不进 JS 主线程**，可改善 Feed 滚动流畅度；IPC 走 `invoke`（序列化成本存在，但低频业务调用可忽略）。
- 官方无 "Tauri vs Capacitor" 性能 benchmark；性能提升主要来自"把热路径搬出 JS"这一工程手段，而非引擎本身。

### 6.2 内存

- **与现状同量级**：系统 WebView 渲染进程 + JS 引擎常驻，官方对 WebView 的"内存占用高"批评同样适用于 Tauri。
- **比 uni-app x 高的部分**：uni-app x 原生渲染无 WebView 进程；Tauri 与 Capacitor 一样有 WebView 进程。
- 官方 105MB（uni-app x VDOM 实测）不可直接对比；Tauri 移动端无官方内存数据，参考 Capacitor 同构。

### 6.3 安全性（Tauri 的强项）

| 面 | Tauri | 现状 Capacitor |
|----|-------|----------------|
| 核心内存安全 | ✅ Rust 所有权保证 | ❌ Java/JS |
| IPC 白名单 | ✅ **capability/ACL 模型**：前端能调的 Rust 命令需显式声明权限（`capabilities/default.json`） | ❌ 前端可调全部插件方法 |
| CSP | ✅ 内置 CSP 配置（`security.csp`） | ⚠️ 需自配 |
| 令牌隔离 | ✅ access_token 可放 Rust 堆（`.so` 内），JS/Java 都拿不到 | ✅ 已在 Java 堆（ADR-0037），但 Rust 更彻底 |
| 官方审计 | ✅ 每个 major/minor release 安全审计（含上游依赖） | ❌ 无 |
| WebView 攻击面 | ⚠️ 与现状相同：JS 注入面、系统 WebView 版本碎片化（仍需 85+ 检查/升级提示） | ⚠️ 相同 |
| 移动端成熟度 | ⚠️ 审计/生态以桌面为主，移动端 2024-2025 才稳定 | — |

**净评价**：安全**强于现状**（IPC 白名单 + Rust + CSP + 审计），但仍受 WebView 渲染模型的固有攻击面限制——**没有 uni-app x 那种"消灭 WebView"的根本性改善**。

### 6.4 可维护性

- **最大优势**：SolidJS UI、小说排版、虚拟滚动、测试体系**全部保留**——这是三方案中唯一"不用重写 UI"的（uni-app x 和混合方案都要 100% 重写）。
- **新增成本**：Rust 技术栈（团队学习曲线）；`gen/android` 由 CLI 生成（改原生代码需谨慎，重新生成会覆盖——需用插件机制而非直接改生成代码）；移动端插件生态较新（官方插件 ~30 个，社区移动端插件少于 Capacitor/uni-app x）。
- 前端生态：任意 npm 包可用（与现状相同）。

### 6.5 包体积

| 项 | WebView 版（现状，实测） | Tauri（估算） | uni-app x（估算） |
|----|--------------------------|--------------|-------------------|
| 渲染引擎 | 0（系统 WebView） | 0（系统 WebView） | +8.1M（引擎 aar） |
| 原生核心 | 0.97M（dex） | Rust `libapp_lib.so` + Kotlin 插件 ~1~3M | ~1M（保留壳） |
| 前端资源 | 1.1M | 1.1M（不变） | 0.5~1M（uvue 编译） |
| **release 合计** | **1.8M** | **≈ 2.5~5M** | **≈ 10~11M** |

- 官方桌面宣称最小 <600KB（纯 Rust + 空前端）；Android 因含 `.so`（多 ABI 会放大）和 Kotlin 桥，估算 2.5~5M，**接近现状量级，显著小于 uni-app x**。
- Tauri 的包体优势来自"复用系统 WebView"——与现状同一逻辑，所以**不会像 uni-app x 那样涨 8M**。

### 6.6 硬盘占用

- APK 本体：1.8M → ~2.5~5M（增量小于 uni-app x 的 +8M）。
- 运行时缓存：WebView 缓存 / 图片磁盘缓存逻辑与现状相当（L2 磁盘缓存迁 Rust 后路径一致）。
- Rust core 不产生额外数据目录。

---

## 7. 三方案横向对比（总表）

| 维度 | Capacitor（现状） | uni-app x（蒸汽/混合） | **Tauri 2** |
|------|------------------|----------------------|-------------|
| 渲染模型 | WebView | 原生渲染 | WebView（系统） |
| UI 层重写 | — | 100% | **0%（保留 SolidJS）** |
| 小说排版/Worker/虚拟滚动 | — | 全部重写 | **保留** |
| "保留原生壳只换 Client" | — | ✅（VDOM，原生 SDK） | ❌ 不支持嵌入 |
| 图片代理 | ✅ 开箱即用 | 🔴 重写为下载器 | 🔴 改 scheme 协议 |
| 包体积 | 1.8M（实测） | ~10M | ~2.5~5M |
| 内存 | 基准 | 更低（原生） | 同现状 |
| 安全 | 基准 | 攻击面小（无 WebView） | IPC 白名单 + Rust（仍 WebView） |
| 可维护性 | 基准 | UI 全重写 | UI 保留 + 学 Rust |
| 移动端成熟度 | 高 | 中（2026 蒸汽刚全端） | 中（2024-2025 移动端稳定） |
| 生态 | Capacitor 插件多 | uni_modules 数千 | 官方 ~30 插件 + Rust 生态 |

---

## 8. 结论与建议

### 8.1 结论

1. **Tauri 不是 uni-app x 的替代，而是 Capacitor 的升级版**（"WebView 壳 + Rust 核"）。评估框架完全不同：uni-app x 的问题是"UI 全重写换原生渲染"，Tauri 的问题是"UI 不动，但原生层要迁 Rust、图片代理要改、且不支持嵌入现有工程"。
2. **"保留平台层+Activity 只换 Client"在 Tauri 上做不到**（官方不支持嵌入，`MainActivity` 固定继承 `TauriActivity`）——这一条比 uni-app x 更差。
3. **全量重写反而最便宜**：UI/排版/滚动/测试全部保留，只有三层要动——(a) Capacitor 桥 → Tauri `invoke`/命令；(b) Java 插件 → Rust/Kotlin 插件；(c) 图片代理 → 自定义 scheme 协议。工作量估计是 uni-app x 方案的 **1/3~1/2**（主要集中在 Rust 侧新写 + 图片流水线）。
4. **包体是 Tauri 的招牌**：~2.5~5M，保住现状"1.8M 小包"的量级，**不会像 uni-app x 那样涨到 10M+**。
5. **安全升级真实**：IPC 白名单 + Rust 内存安全 + 官方审计 + 令牌进 `.so`，但 WebView 攻击面依旧（85+ 检查还得留着）。

### 8.2 若推进 Tauri，建议

1. 先确认可接受"整个 App 变 Tauri 工程"（放弃嵌入现有 Android 工程的想法）；
2. PoC 只需 2 个：(a) 自定义 scheme 图片代理（`pixiv://` + reqwest + Referer + 磁盘缓存）；(b) 现有 SolidJS SPA 原样跑进 Tauri Android WebView + `invoke` 调通 Rust；
3. Java 逻辑分两期迁：先 Kotlin 插件（快），后 Rust（深）。

### 8.3 三个方案的选择逻辑（技术角度）

- **要原生渲染性能 + 愿意重写 UI** → uni-app x（蒸汽模式全量）或混合（VDOM，性能打折）；
- **要保留现有 UI/测试资产、接受 WebView、要小包** → **Tauri**（或继续 Capacitor）；
- **什么都不想改** → 继续 Capacitor（现状 1.8M、图片代理可用、嵌入灵活）——**Tauri 相对现状的增量收益是安全模型 + Rust 性能 + 官方审计，代价是图片代理重写 + 原生层迁 Rust，这笔交易是否划算取决于对安全的优先级**。

---

## 附录 A：评估信息来源

- Tauri 官方文档：`v2.tauri.app`（start/process-model/size/project-structure/develop-mobile/asset-protocol/IPC brownfield/security）
- Tauri/WRY 源码与 issues：`github.com/tauri-apps/tauri`、`github.com/tauri-apps/wry`（templates/mobile/android、RustWebViewClient.kt、binding.rs、issue #905/#1087/#1448/#13554/#13858）
- Context7 Tauri 文档库（`/websites/v2_tauri_app`）
- 项目实测：`packages/app/android` release APK 构成、`MainActivity.java`、`PictelioApp.java`、dist 资源体积
- 交叉参考：`docs/research/uniapp-x-migration-feasibility.md`（uni-app x 各章）

## 附录 B：关键引用（官方文档/源码摘录）

- "Tauri apps take advantage of the web view already available on every user's system… A minimal Tauri app can be less than 600KB in size."（v2.tauri.app/start/）
- "The WebView libraries are not included in your final executable but dynamically linked at runtime… makes your application significantly smaller."（v2.tauri.app/concept/process-model/）
- MainActivity 模板：`class MainActivity : TauriActivity()`（tauri-cli templates/mobile/android）
- WRY README："Child webviews（build_as_child）仅 macOS/Windows/Linux 支持"
- "Mobile support in Tauri 2.0… allows developers to reuse existing native logic and expose it to Rust or the frontend, primarily through the plugin system."（tauri 2.0 blog）
- 自定义协议：`register_uri_scheme_protocol` 只处理注册 scheme；wry 的 `shouldInterceptRequest` 对未注册 scheme 返回 null 放行（wry binding.rs / issue #905）

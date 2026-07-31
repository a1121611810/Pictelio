# Pictelio 迁移到 UniApp X 技术可行性评估

> 评估日期：2026-07（基于 UniApp X 蒸汽模式 / HBuilderX 5.21+ 时代文档）
> 评估范围：纯技术可行性，不含商业收益/团队成本考量
> 结论速览：**技术可行，但这是一次"重写"而非"迁移"——UI 层 100% 重写，数据/原生层 40~60% 可复用。三大高危区：小说正文排版、图片流水线、虚拟滚动。**

---

## 1. 结论摘要

| 维度 | 结论 |
|------|------|
| 总体可行性 | ✅ **可行**，但性质是全新重写，不是渐进迁移 |
| UI 层（SolidJS → uvue） | 🔴 100% 重写（20 路由页 + 47 组件） |
| 样式层（UnoCSS → ucss 子集） | 🔴 100% 重写 + 设计令牌重新落地 |
| 数据层（API/状态） | 🟡 40~60% 可迁移（逻辑可移，运行环境全换） |
| 原生层（Java 19k 行） | 🟢 大部分可复用（uts 插件可混编 Kotlin） |
| 测试体系 | 🔴 组件测试/E2E 作废，需按 uni-app x 自动化框架重建 |
| 最大风险 | 小说正文排版（pretext 依赖 canvas measureText + DOM） |
| 最可能收益 | 原生渲染性能（官方声称超原生）、免 WebView、跨 Android/iOS/鸿蒙/小程序 |

**一句话**：从技术上看，Pictelio 的每个核心功能在 UniApp X 上都有对应实现路径，但当前架构深深绑定在"WebView 即浏览器"的假设上（DOM、canvas 测量、shouldInterceptRequest 代理、Web Worker），这些在 uni-app x 的 App 端原生渲染模型下全部失效，需要按原生思路重写。

---

## 2. 现状盘点（Pictelio 技术基线）

| 层 | 技术 | 规模 |
|----|------|------|
| UI | SolidJS 1.9 + TS strict + Vite 8 | 20 路由页 / 47 组件 / ~23.6k 行 TS |
| 样式 | UnoCSS 66 + Fluent Design 2 tokens | `tokens.css` + `uno.config.ts` shortcuts |
| 数据 | @tanstack/solid-query 5 + solid-db（IndexedDB） | stores/ + queryKeys 工厂 |
| 渲染 | Capacitor 8.4 WebView（Android target） | WebView ≥ 85 |
| 原生 | 4 个 Capacitor 插件（PixivApiPlugin 网关、AuthPlugin、ImageCachePlugin、OAuthPlugin） | ~19.4k 行 Java |
| 关键依赖 | @chenglou/pretext（canvas measureText 排版）、Web Worker（图片尺寸）、shouldInterceptRequest（CDN 代理注入 Referer）、requestAnimationFrame / document.* | 见 §5 高危区 |
| 测试 | Vitest 单测 + agent-browser E2E | ~40 文件 2 层 |

---

## 3. UniApp X 技术能力对照（调研依据）

UniApp X = uts 语言 + uvue 渲染引擎 + uni 组件/API + 扩展机制。

### 3.1 渲染模型：原生渲染（关键差异点）

- **uvue 引擎**：App 端是**原生渲染管线**（不是 WebView），Android 编译为 Kotlin、iOS 编译为 Swift。
- **蒸汽模式（Vapor，HBuilderX 5.21+ 全端支持）**：去掉虚拟 DOM，template/style 直接编译为 C 级机器码/字节码。官方 benchmark：4050 元素创建比原生 UIKit 快 2 倍、比 ArkUI 快 2.85 倍；死亡长列表不掉帧。
- **蒸汽模式下 uvue 页面可直接写 js/ts**（不再强制强类型 uts），uts 语言退化为"写原生插件"用。
- 最低版本：蒸汽模式 Android 6.0+（target 36）、iOS 15+。

> ⚠️ **对 Pictelio 的影响**：渲染模型从"浏览器"变成"原生"。**所有 DOM API、canvas 2D measureText、requestAnimationFrame 在 App 端不存在**（详见 §5.1）。同时意味着：不再受 WebView 85+ 版本约束、内存占用下降、列表滚动性能上限大幅提高。

### 3.2 CSS 子集（ucss）——样式层重写的最硬约束

App 端 ucss 是 Web CSS 的**子集**：

| ucss 限制 | Pictelio 现状 | 影响 |
|-----------|--------------|------|
| 仅支持 flex 布局 + 绝对定位 | 瀑布流（2/1/3 列）、虚拟滚动 | 🟡 waterflow 组件可覆盖瀑布流 |
| 选择器只能用 class（无 tag/#id/属性/关系选择器） | UnoCSS 原子类 + shortcuts | 🟡 原子类可用，但 `hover:`/`dark:` 变体、关系选择器不可用 |
| **样式不继承**（父样式不影响子） | Fluent token 依赖 CSS 变量继承 | 🟡 变量仍可用（支持 var()），但 color 等需逐组件写 |
| 无伪元素（::before/::after） | 仅 base.css 滚动条重置用到 | 🟢 影响小 |
| z-index 仅同层兄弟节点有效 | ImageViewer 全屏遮罩、弹层 | 🟡 需用原生层级方案（cover-view/page-container） |
| 蒸汽模式不支持复杂关系选择器、mixin | uno shortcuts 编译期展开 | 🟡 编译期方案（scss）仍可用 |
| 无 `inherit`/`unset`，默认值重置（flex 竖向、border-box） | — | 🟡 需要适配默认值 |

### 3.3 组件/API 能力对照

| Pictelio 功能 | uni-app x 对应 | 评价 |
|---------------|---------------|------|
| 瀑布流（masonry） | **waterflow + flow-item**（原生复用、回收，与 list-view 同机制） | 🟢 官方原生组件，性能优于自研 |
| 虚拟滚动 Feed | **list-view / waterflow**（list-item 复用、v-for :key 必须） | 🟢 原生自带复用，无需自研窗口计算 |
| 图片加载 | image 组件（支持 mode=widthFix 等） | 🟡 无 WebView 拦截，需自定义下载/缓存（§5.2） |
| 下拉刷新 | waterflow/list-view 内建 refresher + 自定义插槽 | 🟢 |
| 富文本/小说正文 | **rich-text**（蒸汽模式官方宣称 5 万字长文不掉帧） | 🟡 见 §5.1，排版测量仍是问题 |
| 全屏图片查看器 | swiper + movable-view + 原生层级 | 🟡 手势/缩放需重写 |
| 动图 ugoira | 无官方组件，需 uts 插件（MediaCodec + 帧序列） | 🔴 高风险 |
| web-view 兜底 | web-view 组件可承载 HTML 页面（postMessage 双向通信） | 🟢 逃生通道，但只适合局部 |
| IndexedDB（浏览历史） | uni.setStorage / sqlite 插件 | 🟡 需替换 |
| Web Worker（图片尺寸） | 无 Worker，uts 插件可开原生线程/协程 | 🟡 可重写为原生解码获取尺寸 |

### 3.4 原生能力：uts 插件

- **可调用所有原生 API**：Android 上 uts 编译为 Kotlin，可混编 kt/java 源码、引 gradle 依赖（OkHttp 等）。
- **蒸汽模式注意**：uvue 页面（js 写法）不能直接调原生 API，**原生调用必须封装进 uts 插件**。
- → Pictelio 的 19.4k 行 Java（PixivApiPlugin、ImageCachePlugin、AuthPlugin）**大部分可以移植为 uts 插件**：OkHttp 网关、401 同步锁、Keystore 加密、磁盘缓存逻辑均可复用，只需把 Capacitor 桥接层换成 uts 插件接口。

---

## 4. 逐模块迁移评估

| 模块 | 当前实现 | uni-app x 路径 | 迁移成本 | 风险 |
|------|---------|---------------|---------|------|
| **路由/页面框架** | @solidjs/router + 20 路由 | pages.json + navigator / 条件编译 | 🔴 重写（结构可参照，代码不可复用） | 中 |
| **UI 组件（47 个）** | SolidJS 函数组件 | Vue 组合式 API + uvue SFC | 🔴 100% 重写 | 中 |
| **设计系统** | UnoCSS + Fluent tokens | CSS 变量（var() 支持）+ ucss 子集 | 🔴 令牌保留、落地方式重写 | 中 |
| **API 层** | fetch/CapacitorHttp + 401 刷新 + 去重 | uni.request 或 uts 插件封装（OkHttp 复用） | 🟡 逻辑可迁，传输层重写 | 中 |
| **OAuth/凭证** | iOS 凭证、Android 已弃用；AuthPlugin | uts 插件（Keystore 逻辑可复用） | 🟢 低 | 低 |
| **状态管理** | TanStack Query/DB | Pinia（js 蒸汽模式）/ 手写 store + uni storage | 🟡 查询键、缓存策略逻辑可参考 | 中 |
| **Feed/瀑布流** | 自研 masonry + 虚拟滚动 + Worker 测量 | **waterflow 原生组件** | 🟡 布局逻辑大减，数据流重写 | 低 |
| **图片流水线** | 三层缓存 + shouldInterceptRequest 代理 | uts 插件下载/磁盘缓存 + 本地文件路径 | 🔴 高（见 §5.2） | **高** |
| **图片查看器** | ImageViewer（缩放/拖拽/翻页） | swiper + movable-view + pinch 手势 | 🔴 重写 | 高 |
| **小说阅读器** | pretext canvas 测量 + 虚拟布局 + 搜索高亮 | rich-text 或 text 组件 + 原生测量 | 🔴 高（见 §5.1） | **极高** |
| **Ugoira 动图** | JSZip + 帧序列 + 进度 | uts 插件（原生解码） | 🔴 高 | 高 |
| **历史/收藏/屏蔽** | IndexedDB + Preferences | uni storage / sqlite 插件 | 🟡 中 | 中 |
| **更新检查** | GitHub API + 版本比对 | 逻辑可复用 | 🟢 低 | 低 |
| **主题/暗黑** | documentElement class + MutationObserver | uni-app x 暗黑模式 API + theme-change | 🟡 中 | 中 |
| **测试** | Vitest + agent-browser E2E | uni-app x 自动化测试（js 脚本，运行在电脑端） | 🔴 单测逻辑可移，组件/E2E 重建 | 中 |

---

## 5. 三大高危区深度分析

### 5.1 小说正文排版（风险等级：极高）

**现状**：`NovelDetail.tsx` + `@chenglou/pretext` + `createNovelTextLayout.ts`。核心是**用 canvas 2D `measureText` 做逐字逐行测量**，得出精确换行/分页，再虚拟化渲染；`createNovelSearch.ts` 用 DOM `createTextNode`/`<mark>` 做搜索高亮。

**uni-app x 的冲突**：
- App 端原生渲染**没有 canvas 2D `measureText`**，也没有 DOM 节点操作。
- uvue 的 text 组件按 flex 布局自动换行，但**拿不到逐行测量结果**——精确排版（搜索高亮定位、虚拟化窗口、行级滚动定位）无法用现有算法实现。
- rich-text 组件支持富文本渲染，但**不含测量 API**，蒸汽模式虽宣称 5 万字性能好，仍是"黑盒排版"。

**可行替代路径**（均需从零开发，工作量 2~4 周）：
1. uts 插件封装 Android `StaticLayout` / `TextPaint.measureText`（Kotlin 侧逐行测量，返回行数组给前端）——**最接近现有效果**，但搜索高亮/虚拟窗口要配套重写。
2. 放弃逐行测量，改用 rich-text 整文渲染 + scroll-view 定位（功能降级：无行级进度、无精确高亮滚动）。
3. web-view 承载小说页（保住现有实现，但破坏统一渲染，且有跨层通信成本）。

> **结论**：这是全项目唯一"现有算法完全无法落地"的模块，必须先做 PoC（原型验证），再决定是否迁移。

### 5.2 图片流水线（风险等级：高）

**现状**：三层缓存（L1 JS LRU keys → L2 WebView/磁盘缓存 → L3 CDN），核心机制是 **MainActivity `shouldInterceptRequest` 拦截 `/pixiv-img/` 请求，注入 Referer/UA 代理到 `i.pximg.net`**；ImageCachePlugin 原生写盘；图片尺寸走 Web Worker。

**uni-app x 的冲突**：
- 原生渲染**没有 URL 拦截层**——不存在"任何 image 请求都过代理"的钩子。image 组件加载网络图时无法注入自定义 header。
- `/pixiv-img/` 代理路径机制失效（那是 WebView 层的东西）。

**可行替代路径**：
1. **所有图片改经 uts 插件下载**：插件内 OkHttp 请求（注入 Referer/UA）→ 写磁盘缓存 → 返回本地文件路径给 image 组件。这与现有 ImageCachePlugin 的"下载+写盘"部分完全复用，**只是把"JS 层 URL 重写 + WebView 拦截"换成"统一走原生下载器"**。
2. 磁盘缓存命中后直接显示本地文件；LRU/GC 策略复用现有逻辑。
3. 尺寸信息改为原生解码（BitmapFactory bounds）一次性获取，替代 Web Worker。

> **结论**：方案清晰、Java 侧可复用度高，但**图片链路是应用核心路径**，重写风险高，需灰度验证（列表滚动时大量并发下载的调度、内存水位）。

### 5.3 虚拟滚动 / Feed（风险等级：中，但工作量可观）

**现状**：`VirtualFeed.tsx` + `createFeedVirtualizer.ts` + `createImageSizeWorker`：自研视口窗口计算 + 手动 fetch + 按 Tab 缓存 + 滚动位置恢复。

**uni-app x**：`waterflow`（瀑布流）与 `list-view`（列表）均为原生复用组件，滚动窗口/回收由引擎处理——**现有窗口计算代码可整体删掉**，换为 `flow-item v-for :key` + 数据驱动。滚动位置恢复用 scroll-view/waterflow 的 `scroll-top` 属性即可。

**工作量主要落在**：数据层改造（TanStack Query → 手动/轻量状态）、卡片组件重写（SolidJS → Vue）、下拉刷新/加载更多改官方插槽。属"重写但技术确定性高"。

---

## 6. 可复用资产盘点（降低重写成本的部分）

1. **原生层（最大复用）**：`PixivApiPlugin.java`（OkHttp 网关、401 同步锁、token 隔离）、`ImageCachePlugin.java`（磁盘缓存/GC）、`AuthPlugin.java`（Keystore 加密）——封装为 uts 插件时**核心逻辑基本原样保留**，只换 Capacitor 桥接层。预估 19.4k 行 Java 中 60~70% 可直接搬移。
2. **API 层业务逻辑**：`api/illust.ts`、`novel.ts`、`comment.ts`、`queryKeys.ts` 的接口契约、分页参数、错误归一化——TypeScript 代码可移植（蒸汽模式 js/ts），仅传输层替换。
3. **数据模型与类型**：`api/types.ts` 全部 Pixiv 类型定义可复用。
4. **设计令牌语义**：Fluent tokens 的色板/间距/圆角值可平移为 ucss 变量，但落地语法重写。
5. **纯算法**：LRU 缓存、R18 过滤、novelBlocks 解析、搜索匹配索引（字符索引部分不依赖 DOM）。

---

## 7. 技术性结论与建议

### 7.1 结论

1. **能做**：UniApp X 蒸汽模式（js/ts 兼容 + 原生渲染 + uts 插件原生能力）对 Pictelio 的每个功能点都有可落地的技术路径，不存在"原理上做不到"的模块。
2. **但它是重写**：渲染模型从"浏览器"变为"原生"，导致 UI/样式/测试三层 100% 重建；复用集中在原生 Java 与纯业务逻辑上。按现有 ~23.6k 行 TS + 19.4k 行 Java 的规模，估算是**一次 3~6 人月量级的前端重写工程**（不含小说排版 PoC 风险）。
3. **唯一"现有算法作废"的模块是小说正文排版**（canvas measureText 依赖），它决定了迁移的技术下限——必须先做 PoC。
4. **技术收益真实存在**：官方 benchmark（4050 元素比原生快 2 倍、死亡长列表 97fps vs 原生 21fps）如果属实，Pictelio 最大的性能痛点（长列表滚动、大图浏览、小说长文）会得到质的改善；同时摆脱 WebView 版本约束（85+）与双渲染管线的内存开销。

### 7.2 若推进，建议的决策顺序

1. **先做 3 个 PoC**（1~2 周，结论先行）：
   - PoC-A：小说正文——uts 插件 StaticLayout 测量 + 虚拟渲染可行性
   - PoC-B：图片流水线——uts 插件下载/缓存/本地文件显示，长列表并发压力
   - PoC-C：waterflow 瀑布流——数据流 + 下拉刷新 + 滚动位置恢复
2. PoC 全部通过 → 制定完整迁移计划（ticket 化）。
3. 任一个 PoC 失败 → 评估该模块用 web-view 组件局部兜底（如小说页）。

### 7.3 不建议的点

- 不建议"全量一步切换"：蒸汽模式 2026 年才全端落地（Android 5.21+），生态/工具链（HBuilderX 绑定、CLI 受限）成熟度仍需观察。
- 不建议保留现有 SolidJS 代码任何 UI 部分——uvue 无法渲染 SolidJS 组件，混用只会增加维护面。
- 不建议把 `shouldInterceptRequest` 思路硬搬到原生——没有等价物，应拥抱"统一原生下载器"模式。

---

## 8. 混合架构深度分析：平台层/Activity 保持，只换 Client 层（追加分析）

> 追加背景：用户提出新架构设想——**保留现有 Android 原生壳（平台层 + Activity 层），只把 client 渲染层从"WebView 里的 SolidJS SPA"换成 uni-app x**。本章基于 uni-app x 官方「原生 SDK」文档深入分析该设想的可行性边界。

### 8.1 需求定义与官方对应物

| 用户设想 | uni-app x 官方对应 |
|---------|-------------------|
| 平台层（OkHttp 网关、Keystore、缓存）保持 | ✅ 原生工程保持，核心 Java/Kotlin 逻辑可复用 |
| Activity 层（MainActivity、插件注册）保持 | ⚠️ **部分成立**：原生工程可保持，但 MainActivity 基类与 Application 必须改造（见 8.3） |
| Client 层（WebView + SolidJS）换 uni-app x | ✅ 官方原生 SDK 明确支持"渐进式使用，把某些页面使用 uni-app x 来开发，嵌入之前的原生工程中" |

**官方原生 SDK 的存在本身就是为了这个场景**：原生开发者在自己的原生工程中引入 uni-app x 原生 SDK，把 uni-app x 开发的页面编译进原生工程整体联调——"类似于 react native/weex/flutter 的 SDK，但更像集成一个小程序 SDK"。

### 8.2 原生 SDK 集成的四个硬约束（官方文档确认）

1. **🚫 仅支持 VDOM 模式，蒸汽（Vapor）模式暂不支持**（`native/index.html` 原文）。这是混合架构最关键的约束：
   - 蒸汽模式的性能卖点（template/style 编译为机器码/字节码、比原生渲染快 2~3 倍）**在原生 SDK 集成下拿不到**。
   - VDOM 模式是 uni-app x 早期渲染管线（Android 3.99 起），仍是**原生渲染**（非 WebView），列表/滚动性能优于 WebView，但达不到蒸汽模式的红利。
   - ⚠️ **常见误区**：VDOM 模式常被误认为 WebView 渲染——那是**老 uni-app（js 版）**的架构。uni-app x 的 VDOM 与蒸汽均为原生渲染（uvue 是"原生渲染引擎"，两者区别仅是"有无虚拟 DOM 层 + 视图层编译深度"，见官方「视图层编译目标」一节）；唯一用系统 WebView 的是 `web-view` 组件本身。
2. **Application 类必须改为继承 `io.dcloud.uniapp.UniApplication`**，`android:name` 指向它（自定义 Application 需继承 UniApplication）。
3. **启动方式**：`startActivity(Intent(this, UniAppActivity::class.java))`——uni-app x 是**一个独立 Activity**，页面生命周期/路由由它接管，与原生页面之间是 Activity 级切换。
4. **需要 DCloud 平台注册的 `DCLOUD_UNI_APPID`**（应用标识，平台绑定）。

集成工程量本身不大：新建 `uniappx` Android Library 模块 + 引入 19 个基础 aar + `io.dcloud.uts.kotlin` gradle 插件 + 拷贝导出的资源/kt 文件 + 主模块 `implementation project(':uniappx')`。包体积增加约 8.1MB（arm64）。

### 8.3 对现有 Android 壳的逐项影响（对照真实代码）

现有原生壳（`packages/app/android/app/src/main/java/io/pictelio/app/`）：

| 现有文件/机制 | 换 Client 后的命运 | 说明 |
|--------------|-------------------|------|
| `MainActivity extends BridgeActivity` | 🔴 **必须改造** | `BridgeActivity` 是 Capacitor bridge 宿主，client 不再跑 WebView 后桥无意义。MainActivity 需降级为普通 Activity（或删掉，由 UniAppActivity 接管入口） |
| `registerPlugin(4 个插件)` | 🔴 拆除 | Capacitor 插件注册机制失效 |
| **`shouldInterceptRequest` 图片代理**（`/pixiv-img/` → OkHttp+Referer → 磁盘缓存） | 🔴 **彻底失效** | 这是 WebView 专属钩子，原生渲染下不存在 URL 拦截层。**图片流水线必须整体改为"统一原生下载器"模式**（见 8.4） |
| `PictelioApp extends Application`（WebView 预热） | 🟡 改造 | 必须改为 `extends UniApplication`；WebView 预热逻辑失去意义（可删） |
| `isWebViewVersionOk()`（WebView 85+ 检查） | 🟢 移除 | 原生渲染不依赖 WebView 版本——**反而解除了 85+ 约束** |
| `PixivApiPlugin` / `AuthPlugin` / `OAuthPlugin` / `ImageCachePlugin`（@CapacitorPlugin 类） | 🟡 **核心逻辑可复用** | 剥离 `@CapacitorPlugin`/`@PluginMethod` 注解外壳后，OkHttp 网关、401 同步锁、Keystore 加密、磁盘缓存/GC 全部保留，封装为普通 Java/Kotlin 库或 uts 插件 |

**关键洞察**：用户设想的"底层保持"是**大部分成立但有三个例外**——(1) `BridgeActivity` 基类必须换掉；(2) `shouldInterceptRequest` 无法平移；(3) Application 必须并入 `UniApplication`。除此之外，平台层的业务逻辑（网关/加密/缓存）确实可以原样保留。

### 8.4 通信机制：这是本方案最需要澄清的点

官方「启动与通信」文档给出的通信方式是 **Android 广播（BroadcastReceiver）**——uni-app x 页面注册 Receiver 收原生广播、`UTSAndroid.getUniActivity()?.sendBroadcast()` 发原生广播。

**但广播不足以支撑 Pictelio 的 API 网关**：`PixivApiPlugin` 是"JS 调用 request() → OkHttp → 返回 JSON 数据"的请求-响应模型，需要**同步/回调式返回值**；广播是异步、单向、无返回值的，只适合低频事件（登录成功通知、设置变更）。

正确的通信通道是 **uts 插件（函数级互操作）**：
- 原生 SDK 文档明确："uts 编译为了原生语言，所以原生工程和 uni-app x 工程可以良好的互操作，甚至可以整体断点 Debug"——uvue 页面的 uts 代码编译后与原生 Kotlin 同进程同语言，**可以直接调用原生 Java/Kotlin 类**（相当于同一语言不同函数的调用，不是桥接）。
- 落地方式：把平台层核心逻辑（网关/加密/缓存）打包为普通 Android Library（或 `android uts 插件`模块），uvue 页面通过 uts 插件 import 调用，Promise 回调返回。
- 广播保留为低频事件通道（可选）。

### 8.5 图片流水线的重写要求（最大工程量点）

| 现状（WebView 模式） | 换 uni-app x 后（原生渲染） |
|---------------------|---------------------------|
| `<img src="/pixiv-img/...">` → WebView 拦截 → OkHttp（注入 Referer/UA）→ 磁盘缓存 → 渲染 | **image 组件无法注入自定义 header**（pixiv 强制要求 Referer） |
| shouldInterceptRequest 统一走代理 | **必须改为**：uts 插件统一下载（OkHttp 注入 Referer）→ 写磁盘缓存 → image src 用本地文件路径；或自定义 image 加载器 |

磁盘缓存/LRU/GC 逻辑（`ImageCachePlugin`）可复用，但"URL 代理"这一层整个消失，替换为"下载器"。这与第 5.2 章结论一致，且在混合架构下同样不可避免。

### 8.6 混合架构 vs 全量迁移（第 7 章方案）对比

| 维度 | 混合架构（原生壳 + uni-app x Client） | 全量 uni-app x（蒸汽模式） |
|------|--------------------------------------|--------------------------|
| 渲染管线 | **VDOM 模式**（无蒸汽红利） | 蒸汽模式（性能卖点全拿） |
| 原生层复用 | ✅ 高（网关/加密/缓存核心逻辑原样保留） | 中（同样可复用，但要迁入 uni-app x 工程） |
| 工程主导权 | ✅ 保留现有 Gradle 工程、签名、CI | HBuilderX 主导，打包/构建流程重做 |
| UI 层 | 🔴 100% 重写（SolidJS → uvue，与全量相同） | 🔴 100% 重写（相同） |
| Activity/Application | 改造（BridgeActivity→普通/删除、Application→UniApplication） | 替换 |
| 图片流水线 | 重写为原生下载器（相同） | 重写为原生下载器（相同） |
| 小说排版 | 同第 5.1 章，极高风险 | 同 |
| 依赖 | DCloud appid + 19 个 aar + 8.1MB | DCloud 平台 + HBuilderX 生态 |

### 8.7 结论

1. **技术可行，且官方原生 SDK 就是为此场景设计的**（"渐进式嵌入既有原生工程"）。平台层/原生层的复用率比"全量迁移"更高，工程主导权保留。
2. **"Activity 保持"是伪命题的三个点**：`BridgeActivity` 基类、`shouldInterceptRequest` 图片代理、Application 的 `UniApplication` 继承——这三处无论如何都要动。
3. **最大代价是蒸汽模式不可用**（原生 SDK 仅 VDOM）：混合架构拿到的是"原生渲染优于 WebView"，而不是"性能超原生"。若蒸汽模式的性能红利是迁移动机，混合架构不满足，需退回全量方案。
4. **通信不是障碍**（uts 函数级互操作），但官方文档示例的广播方式不足以承载 API 网关，需自研 uts 插件封装平台层。
5. **UI 层重写量不因混合架构而减少**：20 路由 + 47 组件依然是 100% 重写；小说排版（第 5.1 章）、图片流水线（8.5）风险不变。

> 一句话：**"保留原生壳、只换 Client"在 uni-app x 上是官方支持的正规玩法，但它的技术上限是 VDOM 模式的原生渲染——不是蒸汽模式；且必须动三处原生代码（BridgeActivity、图片代理、Application）。**

---

## 9. 官方验证报告盘点：原生渲染（VDOM）vs WebView（性能/内存/安全/可维护性）

> 追加背景：用户询问"有没有验证报告说明 uni-app x（VDOM 原生渲染）相对 WebView 的优势"。本章先诚实盘点**官方到底有哪些验证数据、各自适用什么模式**，再给出四维对比。**关键前提：混合架构（原生 SDK）只能用 VDOM 模式，而官方唯一有量化 benchmark 的是蒸汽模式——两者必须严格区分，不可混用数据。**

### 9.1 官方验证材料清单（先回答"有没有"）

| 维度 | 官方材料 | 适用模式 | 类型 |
|------|---------|---------|------|
| 性能 | `vapor-benchmark.html`（4050 元素/死亡长列表） | **仅蒸汽模式** | 量化实测（可复现，附源码） |
| 性能 | `select.html`（跨平台框架比较） | **VDOM 模式**（页首明确声明） | 架构论证 + 定性，无直接 WebView 量化对比 |
| 内存/包体积 | `select.html` 实测表（flutter/ArkUI-X/uni-app x/compose ui） | **VDOM 模式** | 量化实测（含方法说明） |
| 安全性 | 无专门对比报告 | — | 仅原理推导（见 9.4） |
| 可维护性 | 无专门对比报告 | — | 仅原理推导（见 9.5） |

**结论**：官方没有"VDOM vs WebView"的直接 benchmark；最接近的官方材料是 `select.html`（VDOM 模式架构对比，称 WebView 差距为"业内常识"不再详述）+ `vapor-benchmark`（蒸汽模式，混合架构不可用）。下表为四维汇总。

### 9.2 性能

**官方定量数据（仅蒸汽模式，混合架构不适用，仅供了解上限）**：
- 4050 元素同屏创建：Android 224ms vs 原生 view 436ms / compose ui 673ms；iOS 185ms vs UIKit 339ms（各 5 次冷启动平均）
- 死亡长列表回滚平均帧率：Android 97.97fps vs arkUI 21.13fps；iOS 111fps vs SwiftUI 49fps

**官方对 VDOM 模式的定性（select.html，适用于混合架构）**：
- 架构类型表：`uni-app x`（逻辑层 kotlin / 渲染层 原生 / 强类型）与**原生应用同一行**；WebView 系（5+App、cordova = webview/webview；uni-app app-vue、小程序 = js/webview）单独分类
- 原话："**webview 与原生的差距已经是业内常识了，启动慢、渲染慢、内存占用高**。这块本文不再详述。"
- VDOM 的定位表述："它本身就是原生应用，它和原生应用的性能没差别"（逻辑层/渲染层都是 kotlin，无 js 引擎、无 webview、无跨语言通信折损）

**对 Pictelio 的落点**：混合架构下拿到的是"原生渲染、无 js 引擎、无桥通信折损"——即 VDOM 已消灭 WebView 三大性能短板（启动慢/渲染慢/内存高）与 RN/小程序式"逻辑↔UI 跨语言通信"开销；但**拿不到蒸汽模式的机器码红利**。

### 9.3 内存与包体积（官方实测，VDOM 模式）

`select.html` 用同一 slider-100 示例实测（华为 mate30 5G，含 3 个 CPU 架构，VmRSS 5 次平均）：

| 框架 | 包体积 | 内存占用（Kb） |
|------|--------|---------------|
| flutter | 18M | 141,324 |
| ArkUI-X | 45.7M | 133,091 |
| **uni-app x（VDOM）** | **8.5M** | **105,451** |
| compose ui | 4.4M | 98,575 |

- 官方解释：uni-app x 主业务在 kotlin 中（无 js/flutter 引擎按 CPU 翻倍）；实测含未裁剪模块（fresco so 库），实际业务差距更小。**注意 compose ui 包体积/内存仍略小**，官方数据并未宣称全面第一。
- 对混合架构的参考：原生 SDK 文档给出 Android 端包体积增量约 8.1MB（arm64），与上述量级一致。
- 对比 WebView：官方未给 WebView 组数据（列为"业内常识"）；本项目可自行佐证——当前 WebView 架构需同时承载 WebView 渲染进程 + JS 引擎 + DOM/CSS 引擎，双渲染管线内存开销正是官方反复批评的点。

### 9.4 安全性（无官方报告，原理推导，已标注）

**WebView 侧（当前架构）的安全负担，本项目代码可作实证**：
- 系统 WebView 版本不受应用控制 → 本项目不得不做 `isWebViewVersionOk()`（85+ 检查）+ `upgrade.html` 降级提示（`MainActivity.java`）；
- `shouldInterceptRequest` 代理层需维护 SSRF 白名单（ADR-0002）；
- WebView 攻击面：JS 注入、`addJavascriptInterface` 历史漏洞、旧版本 WebView 已知 CVE、XSS 面。
- access_token 已在 Java 堆隔离（ADR-0037），与渲染层无关——换 Client 后该机制保留。

**uni-app x VDOM 侧**：
- Android 编译产物为纯 kotlin：**无 WebView、无 JS 引擎** → 上述 JS 注入面、WebView 版本碎片化、URL 拦截层攻击面全部消失；
- 逻辑层直接编译为原生代码，无法通过动态注入 JS 篡改（对比 WebView 可 `evaluateJavascript`）；
- 官方亦提供验证手段（见 9.6），可确认包内无 js 引擎。
- 注意反向风险：uvue 页面可 import 原生 API（uts 直接调 Kotlin）→ 安全性取决于开发者自身；蒸汽模式未来开放 js/ts 写法会重新引入 JS 引擎（但混合架构用 VDOM，不涉及）。

### 9.5 可维护性（无官方报告，原理推导）

| 维度 | WebView（现状） | uni-app x VDOM（混合架构） |
|------|----------------|---------------------------|
| 渲染栈 | WebView + SolidJS + TanStack 全家桶 | 原生渲染 + vue 语法 + uts |
| 生态/招聘 | Web 生态大、前端人才多 | uni-app x 生态较新、HBuilderX 绑定 |
| 系统依赖 | 受系统 WebView 版本碎片化影响（需版本检查/升级提示） | 不依赖系统 WebView，消除碎片化维护 |
| 开发效率 | SolidJS 编译期细粒度响应式 | 官方称"换种写法写原生，单平台开发效率也更高" |
| 对本项目 | — | UI 100% 重写 + VDOM 无蒸汽红利（第 8 章结论不变） |

### 9.6 官方提供的自行验证方法（select.html）

1. 编译 uni-app x 项目后查看 `unpackage` 目录——产物是 **kt 文件**（而非 js）；
2. 解压打包后的 apk——检查**有没有 js 引擎或 flutter 引擎**；
3. 手机端"审查布局边界"——flutter 和 webview 均无法审查，原生渲染可审查。

> 一句话：**官方有蒸汽模式的全量 benchmark（不适用于混合架构）和 VDOM 模式的架构论证 + 内存/包体积实测；安全性与可维护性无官方对比报告，本章按原理推导并明确标注。** 混合架构（VDOM）相对 WebView 的优势是"原生渲染、无 js 引擎、无桥通信、无 WebView 攻击面/碎片化"，上限低于蒸汽模式。

### 9.7 真实产物对照：WebView 版（Pictelio 实测）vs uni-app x（官方数据）

> 追加背景：用户指出当前 WebView 版 release APK 仅 1.7~1.8MB，询问包体/内存/硬盘占用的真实差距。以下为**本项目实测产物**与**官方发布的 uni-app x 体积数据**的直接对照。

#### 9.7.1 当前 WebView 版 APK 实测（`packages/app/android/`，2026-07 构建）

| 产物 | 大小 | 构成 |
|------|------|------|
| `app-release.apk` | **1.8M** | classes.dex 966KB（Capacitor + 4 插件 + OkHttp + Kotlin stdlib）+ `assets/public` 1.1M（web 资源：JS/CSS/HTML）+ 资源文件；**无 native so 库** |
| `app-debug.apk` | 11M | debug 含未压缩/调试信息，不具参考性 |
| `dist/`（web 产物） | 1.1M | 全部业务代码 + 三方库 JS |

**为什么这么小（WebView 架构的本质）**：渲染引擎（Chromium/WebView）、JS 引擎（V8）、DOM/CSS 引擎**全部借用系统自带 WebView，不打包进 APK**——APK 里只有薄薄的 Capacitor 壳 + JS/CSS 资源。这就是 WebView 方案的"包体红利"，也是它在内存/启动/碎片化上付出的代价换来的。

#### 9.7.2 uni-app x 的官方体积增量

- **原生 SDK 集成**（`native/index.html`）：Android 端默认只含 arm64-v8a 时**安装包增加约 8.1M**；追加 armeabi-v7a 再 +679KB、x86 +965KB、x86_64 +970KB。
- **select.html 实测**（VDOM 模式，3 个 CPU 架构的 slider-100 示例）：uni-app x 整包 8.5M（其中含未裁剪的 fresco 图片 so 库；同表 compose ui 4.4M、flutter 18M、ArkUI-X 45.7M）。

#### 9.7.3 包体账目（估算）

| 项 | WebView 版（现状，实测） | uni-app x 混合架构（估算） |
|----|--------------------------|---------------------------|
| 渲染引擎 | 0（借用系统 WebView） | +8.1M（引擎 aar，arm64） |
| 业务代码 | 1.1M（JS/CSS 资源） | ~0.5~1M（uvue 编译为 kt，无独立 JS 引擎） |
| 原生壳（Java） | 0.97M（dex） | ~1M（保留的网关/加密/缓存逻辑） |
| **release APK 合计** | **1.8M** | **≈ 10~11M（单 arm64）** |

> 结论：**换 uni-app x 后 APK 从 1.8M 涨到约 10M+，主要增量是引擎（8.1M）。** 这是"自带渲染引擎"与"借用系统 WebView"两种路线的必然差异——uni-app x 把引擎打进包里，换来不依赖系统 WebView（无版本碎片化/升级提示页）与运行时可控。

#### 9.7.4 内存与硬盘占用（定性 + 官方数据）

- **内存（运行时）**：
  - uni-app x VDOM 官方实测（slider-100，VmRSS 5 次平均）：约 **105MB**（同表 flutter 141MB、compose ui 98MB）。
  - WebView 版无同口径实测；原理上 WebView 渲染进程 + V8 引擎 + DOM/CSS 引擎常驻，且受系统 WebView 版本影响——官方对 WebView 的评价是"启动慢、渲染慢、内存占用高"（业内共识）。**注意：105MB 是官方示例应用数据，Pictelio 的实际内存取决于自身图片缓存/列表策略，不能直接套用**。
- **硬盘（安装后）**：
  - APK 本体：1.8M（现状）→ ~10M（估算）。
  - 运行时缓存：两种方案都有图片磁盘缓存（当前项目 L2 磁盘缓存；uni-app x 走 Fresco/Glide 缓存目录），该项两者相当，不构成方案差异。
  - uni-app x 引擎不产生额外安装后数据目录（引擎随 APK 安装），增量集中在包体本身。

> 一句话：**WebView 版的 1.8M 包体是"借用系统 WebView"换来的，换 uni-app x 后约涨到 10M+（引擎 8.1M 为主）；内存官方实测 uni-app x VDOM 约 105MB（示例应用口径），硬盘增量集中在 APK 本体，运行时缓存两者相当。**

---

## 附录 A：评估信息来源

- UniApp X 官方文档：`doc.dcloud.net.cn/uni-app-x/`（概述 / 蒸汽模式 / uvue CSS / waterflow / web-view / 原生 SDK：`native/index.html`、`native/use/android.html`、`native/use/androidcomm.html`、`native/use/androiduts.html` / benchmark：`vapor-benchmark.html`、`select.html`）
- 项目内部文档：`openwiki/quickstart.md`、`AGENTS.md`（架构、ADR 摘要）
- 代码实测：`packages/app/src` DOM API 依赖扫描、`packages/app/android/app/src/main/java/io/pictelio/app/`（MainActivity/PictelioApp/4 个插件）、Java 规模统计

## 附录 B：关键引用（官方文档摘录）

- "uni-app x 在 app平台实现了 web css 的子集……仅支持 flex 布局和绝对定位；选择器只能用 class 选择器；样式不继承"
- "App平台的蒸汽模式下……把 template 和 style 直接编译为底层c代码对应的机器码/字节码"
- "蒸汽模式后，Android的uvue页面中，不能直接调用原生API，相关调用需挪到uts插件中"
- "waterflow……子组件滑动出屏幕会及时回收复用。性能优于 scroll-view"
- "蒸汽模式下，uvue页面可以写js/ts，不再强制约束强类型"

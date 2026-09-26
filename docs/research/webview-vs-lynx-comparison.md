# 调研：Pictelio 双客户端能力分化 vs 同类 Pixiv 第三方客户端

> 调研日期：2026-09-26
> 调研方式：两个客户端分别独立对比竞品；`pictelio-app` webview 客户端（SolidJS 2.0 + Capacitor 8.5 + Fluent 2，v5.5.0 已发布）+ `pictelio-app-lynx` lynx 客户端（vue-lynx + Material 3，pre-alpha）。每个客户端独立评估，**对比维度只采用已落地能力**（commit/源码可核验），未落地能力明确标"未做"。
> 关联文档：`openwiki/quickstart.md`、`openwiki/architecture/overview.md`、`openwiki/architecture/api-layer.md`、`openwiki/architecture/image-pipeline.md`、`openwiki/domain/feed-and-browsing.md`、`openwiki/domain/novel-reader.md`、`openwiki/integrations/android-native.md`、`docs/research/competitor-features-comparison.md`（总览基线）、`docs/specs/app-lynx-novel-translation.md` + `app-lynx-novel-series-watchlist.md` + `app-lynx-global-search.md`（lynx 专项）。

---

## 0. 阅读路径

- §1 — 客户端分化路线总览（一张表）
- §2 — webview 客户端独立对比（按竞品维度展开）
- §3 — lynx 客户端独立对比（按竞品维度展开）
- §4 — 两个客户端之间的能力差异矩阵
- §5 — 同类竞品各自对位的强项
- §6 — 综合评估 + 客户端路线建议

---

## 1. 客户端分化路线总览

> Pictelio 是**双客户端策略**：webview 客户端是深度功能旗舰（覆盖 90% 主流场景），lynx 客户端是移动原生体验旗舰（覆盖 60% 主流场景 + 几个独占特色）。两者共享 Java 后端（Keystore / OkHttp / 图像 / ugoira / WebDAV），登录态互通。

| 维度 | **Pictelio webview** | **Pictelio lynx** | **关键差异** |
|---|---|---|---|
| **技术栈** | SolidJS 2.0 RC + Capacitor 8.5 + vite-plus + UnoCSS | vue-lynx + pinia + Tailwind + M3 token | webview 用 Web 标准；lynx 用 Lynx 原生运行时 |
| **设计系统** | **Fluent Design 2**（严格 4 曲线 / 5 时长 / 状态 / tokens） | **Material Design 3**（Tailwind config 中 rpx / vw / M3 色板） | 两条独立设计轨道 |
| **形态** | v5.5.0 已发布，~900 个 src 文件 | pre-alpha（37 个 spec 文档，#60 差距清单持续收敛） | lynx 还在追赶阶段 |
| **路由** | `@solidjs/router`（无 loader/Suspense） | vue-router 迁移完成（spec `app-lynx-vue-router-migration.md`） | 同步路由策略一致 |
| **状态管理** | TanStack Query 6.0.0-rc.3 + Solid Stores + Zustand-like | TanStack Query 迁移完成（spec `app-lynx-vue-query-migration.md`） + pinia | 同步抽象层 |
| **API 客户端** | 双模式：web fetch + Vite 代理 / Native bridge → `PixivApiPlugin` | 双模式：web fetch / Native bridge → `PictelioApiModule` | 同源（共享 OkHttp pool + 401 刷新） |
| **登录态** | `@aparajita/capacitor-secure-storage` + 备份三层防御 | `PictelioSecureStorageModule`（LynxModule，复用 `SecureStorageCompat`） | **互通**（一份 Keystore） |
| **图像后端** | WebView `shouldInterceptRequest` + `PixivImageLoader` + 32MB 内存快路径 | `PictelioImageService`（`ILynxImageService` + Fresco 替代）+ 共享 `PixivImageLoader` | 共享磁盘 L3 + 同镜像选择 |
| **Ugoira 播放** | `streamUgoiraFrames` + `fflate` 流式（约 2% 下载即可播首帧） | Java `UgoiraStreamEngine` 批式拉取（约 4.5–8.6%） | 双轨流式 |
| **AI 翻译** | **DeepSeek BYOK**（S1–S7 + 双轨协议层 + R18 三段门控） | **OpenAI Responses API**（ADR-0169–0178 + AsyncIterator + 流式优先 + 整批回退） | **两套独立实现，零共享** |
| **i18n** | `@solid-primitives/i18n`（zh-CN 内联 + en 动态） | 自研 t(key) + `ref`（无 Intl） | 双 i18n 实现 |
| **图片 CDN 加速** | 4 模式（race / weighted / fastest-ip / single）+ 原生 resolve | 4 模式（race / weighted / fastest-ip / single）+ 原生 resolve | 共享 |
| **OTA 更新** | `OtaPlugin` + Ed25519 + WebBundle | `PictelioAppModule.httpGet` + `@pictelio/update-check` | 双 API 但共享逻辑 |
| **WebDAV 备份** | ✅ | ✅（spec ADR-0156 + `meWebdavTemplate.test.ts`） | 一致 |
| **WebView 拦截能力** | ✅（`shouldInterceptRequest` 全部生效） | ❌（LynxView 无此 hook） | webview 独有 |
| **iOS 端** | ❌（v3.19.1 移除） | ❌（lynx 仅 Android） | 都不支持 |

---

## 2. webview 客户端（pictelio-app v5.5.0）独立对比

### 2.1 webview 客户端速写

**定位**：Android 平台 SolidJS SPA + Capacitor 8.5 原生壳；**深度功能旗舰**。

**核心优势（业界领先）**：
- **AI 翻译**：DeepSeek BYOK 永久免费，**不过服务器**；S1–S7 完整链路（段落 chunked ≤2000 / 并发 worker pool ≤3 / first-screen 优先 / LRU 200 章缓存 / FNV-1a key + spark-md5 source hash 自动 miss / R18 三段门控 / 协议层 keep-alive 抗性 / 错误规范化）。
- **安全模型最强**：access_token 永不入 JS heap（Java `volatile` 字段）+ refresh_token Keystore + URL trusted boundary（ADR-0100）+ Pixiv 域白名单 + 备份三层防御（ADR-0003）。
- **图像管线最深**：3 层缓存（L1 LRU / L2 HTTP / L3 disk）+ 用户可调 3 独立开关 + 50–1000MB 磁盘上限 slider + 4 模式镜像选择 + native resolve（ADR-0143）+ `createProgressiveImage` thumb→full + 12s 超时 + 3 次重试。
- **小说阅读器**：Pretext + 虚拟化 + 章内搜索（高亮 + 跳转）+ 系列导航 `SeriesSheet` + `createFastScrollbar` + 9 种导出格式（TXT/EPUB/MD/PDF）。
- **设计系统严格执行**：Fluent 2 + A2 Cardization（8px radius + 1px border + 无 shadow）+ 4 缓动曲线 + 5 时长 + tokens 全约束。
- **更新 / 备份**：OTA WebBundle 自建（Ed25519 + WorkManager 预热 + 原子切换）+ WebDAV 跨设备同步（设置 / 收藏 / 历史）。
- **路由**：先渲染后加载（ADR 硬约束）+ 12 个 feed 面板 + 三次级布局（瀑布 / 单列 / 网格）+ 拉到底自动翻页 + 错误分两层（首屏 ErrorDisplay / 分页 InlineRetryBar）。
- **工程化最严**：113+ 篇 ADR + 双轴 code-review + StrykerJS 突变测试 + Robolectric + T0 门禁 + Oracle 溯源 + 3-flavor APK（full / webview / lynx）。

### 2.2 webview 客户端功能矩阵

| 功能 / 维度 | Pictelio webview v5.5.0 | Pixiv-Shaft | PixEz | PiPixiv | Pixiv-SwiftUI | 开源阅读 + 书源 | P站助手 | Pixeval | 官方 |
|---|---|---|---|---|---|---|---|---|---|
| **平台** | Android | Android | Android | 5 端 | Apple 3 端 | Android 书源 | iOS+Android | Win | iOS+Android |
| **国内直连** | ⬜ 需配置代理 | ✅ DoH+IP | ✅ | ✅ SNI | ✅ 手写 HTTP | ✅ 直连模式 | ✅ | ⬜ | ⬜ |
| **多镜像加速** | ✅ 4 模式 + native resolve | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ CDN 订阅 | ⬜ | ⬜ |
| **三层缓存 + 用户可调** | ✅ **最强**（ADR-0090） | ⬜ Glide 默认 | ⬜ | ✅ Coil | ✅ Kingfisher | ⬜ | ⬜ | ✅ | ⬜ |
| **ugoira 流式播放** | ✅ webview 双轨（ADR-0127） | ✅ RIFE 插帧 | ✅ | ✅ | ✅ | ⬜ | ✅ WebP/GIF | ✅ | ✅ |
| **插画详情 + 章节浏览** | ✅ LazyDetailImage + 6 页预取 | ✅ | ✅ | ✅ | ✅ | ⬜ | ✅ | ✅ | ✅ |
| **小说虚拟化 + 章内搜索** | ✅ Pretext + 虚拟化 | ✅ | ⬜ | ✅ | ✅ | ✅ **最强** | ✅ | ⬜ | ✅ 基础 |
| **小说书架 / 离线 / 进度 / 繁简** | ⬜（无书架） | ⬜ | ⬜ | ✅ 进度+Watchlist | ✅ 进度 | ✅ **最强** | ⬜ | ⬜ | ⬜ 进度仅系列 |
| **AI 翻译（BYOK 永久免费）** | ✅ DeepSeek | ✅ 服务端付费 | ⬜ | ✅ 多 provider | ✅ 主备 | ⬜ | ✅ 服务端**付费** | ⬜ | ⬜ |
| **AI 漫画圈选翻译** | ⬜ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ⬜ | ⬜ |
| **AI 超分 / cut-out** | ⬜ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ⬜ | ⬜ |
| **以图搜源** | ⬜ | ✅ | ✅ | ⬜ | ✅ | ⬜ | ✅ | ⬜ | ⬜ |
| **高级搜索筛选** | ✅（日期 / 收藏数 / 比例 / 分辨率 / AI 覆盖） | ✅ | ✅ 基础 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **排行榜** | ✅ 7 mode + 日期 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **收藏 + 标签** | ✅ | ✅ | ✅ **10+** | ✅ | ✅ | ⬜ | ⬜ | ✅ 10 | ✅ 10 Premium |
| **屏蔽作品 / 标签 / 作者** | ✅ 前 3 项 | ✅ | ✅ | ✅ + 长标签 | ✅ | ✅ **全 5 项** | ⬜ | ✅ | ✅ Premium |
| **多账号** | ⬜ | ✅ | ⬜ | ✅ | ⬜ | ⬜ | ✅ | ⬜ | ⬜ |
| **批量下载 + 续传 + 队列** | ✅ 9 优先级（ADR-0146） | ✅ **最强** + aria2 | ✅ | ✅ | ✅ | ⬜ | ✅ | ✅ | ⬜ Premium |
| **WebDAV 备份** | ✅（ADR-0156） | ⬜ | ⬜ | ✅ | ✅ pixez 格式 | ✅ | ⬜ | ⬜ | ⬜ |
| **OTA 自建更新** | ✅ Ed25519 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **access_token 不入 JS heap** | ✅ **唯一** | ✅ OkHttp 拦截器 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | — |
| **refresh_token Keystore** | ✅ + 三层防御 | ✅ EncryptedSharedPreferences | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | — |
| **网络自检** | ✅ `/network-check` | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **平板横屏两栏** | ⬜ | ✅ | ⬜ | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| **i18n** | ✅ zh-CN + en（ADR-0157） | ✅ 6 语 | ⬜ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 7 语 |
| **AI 作品三态过滤** | ✅ show/mask/only | ✅ 三档 | ⬜ | ✅ | ✅ 四态 | ⬜ | ⬜ | ✅ | ⬜ |
| **R18/R18G 三态** | ✅ account-scoped | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Premium |
| **客户端切换（多客户端）** | ✅ ClientSwitch（ADR-0062） | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **工程化（ADR / 测试）** | ✅ **业界最深** | ⬜ 公开少 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | — |

### 2.3 webview 客户端独有优势（lynx 没有）

1. **高级搜索筛选**：`@pictelio/search-core` 共享包 + 5 维筛选 + AI 覆盖；webview 用独立路由 `/search` + `SearchFilterSheet.tsx`，lynx 用 FAB 全局弹层 `SearchSheet.vue`，**两者规格完全一致（#476 拍板）**，差异仅在入口形态（独立路由 vs FAB 全局可达）。
2. **三层缓存 + 用户可调开关**：`/image-cache` 设置页 + 50–1000MB 磁盘上限 slider（lynx 端未做 ImageCacheSettings 路由）。
3. **镜像 host 设置**：`/image-host-settings` 路由 + 编辑权重 + DNS 探测（lynx 端未做 ImageHostSettings）。
4. **9 种小说导出格式**：`@pictelio/novel-export` 共享包（lynx 端未实现导出）。
5. **完整 Settings + PersonalCenter + About + DebugImage + ScrollRestorationConfirm + ClientSwitch**：webview 才有 6 个二级路由。
6. **侧栏 C-shell**：`SideNavShell` 56px 左导航 + 单列主区（lynx 用底栏 + FAB）。
7. **ImageViewer 全屏查看器 + PixivImage 主组件**：`LazyDetailImage` 双可见性检测 + `createProgressiveImage`（lynx 用 `CoverImage.vue` + Fresco 替代）。
8. **数字 ID 路由 + 用户作品页**：`/users/:id/illusts`（lynx 用 `UserHome.vue`）。
9. **AI 翻译 DeepSeek 实现**：S1–S7 完整链路 + LRU 缓存 + FNV-1a key（lynx 实现的是 OpenAI Responses API，零共享）。

### 2.4 webview 客户端缺位（lynx 有 / 竞品有）

| 缺位 | 影响 | 替代 |
|---|---|---|
| ❌ **小说追更（watchlist）** | 重度小说党 | lynx 已做（spec ADR-0166）；开源阅读 + 书源；PiPixiv |
| ❌ **小说书架 + 离线 + 繁简转换** | 重度小说党 | 开源阅读 + 书源（最强） |
| ❌ **AI 漫画翻译 / AI 超分** | 漫画党 + 老图党 | Shaft / P站助手 |
| ❌ **以图搜源** | 找图党 | Shaft / PixEz / P站助手 / SwiftUI |
| ❌ **多账号切换** | 多号党 | Shaft / PiPixiv / P站助手 |
| ❌ **平板横屏两栏** | iPad / 折叠屏 | Shaft / PiPixiv / SwiftUI |
| ❌ **官方 Pixiv 高人气排序（免费）** | 搜索结果不全 | Shaft / PiPixiv |
| ❌ **国内直连（DoH / SNI）** | 国内可达性 | Shaft / PixEz / PiPixiv / SwiftUI / 开源阅读书源 / P站助手 |
| ❌ **iOS 客户端** | Apple 生态 | PiPixiv / SwiftUI / P站助手 |
| ❌ **MCP / AI Agent 接入** | 桌面端差异化 | Pixeval（少见） |
| ❌ **永久收藏缓存** | 收藏党刚需 | SwiftUI（实验性） |
| ❌ **AI 作品卡片遮罩层** | 视觉硬隔离 | lynx 有 `AiOverlay.vue` + `AiRestrictedIllustCard.vue` + `AiRestrictedNovelCard.vue`；webview 用 store 过滤 |

---

## 3. lynx 客户端（pictelio-app-lynx pre-alpha）独立对比

### 3.1 lynx 客户端速写

**定位**：Android 平台 vue-lynx SPA + LynxView 原生壳；**移动原生体验旗舰**（Lynx 是字节开源的类 React Native 跨端框架，本项目用于弥补"webview 在低端机型发热"的痛点）。

**核心特色（区别于 webview）**：
- **底层是 LynxView（不是 WebView）**：没有 `shouldInterceptRequest`，没有浏览器 API；需要 Java LynxModule 桥接每项能力。
- **M3 设计语言 + Tailwind rpx / vw 单位**：mobile-first，与 webview 的 Fluent 2 完全独立轨道。
- **放射 FAB 双形态入口**（spec `app-lynx-fab-menu.md` / ADR-0120）：顶层 tab 页 = 放射 FAB 内环「搜索」项；非 tab 内容页 = 放射 FAB 本体为搜索按钮（直达模式）。
- **追更 / 系列管理**（spec `app-lynx-novel-series-watchlist.md` / ADR-0066）：D1 滚动进度 ≥70% 或到达底部 + 页面停留 ≥10s 触发弹层；D4 列表条目直达**最新一话**（不建系列章节页）。
- **全局搜索弹层**（spec `app-lynx-global-search.md` / ADR-0132）：从任何内容页经 FAB 唤起底部命令面板；输入即搜（300ms 防抖）；结果就地分页呈现；scope 全部 / 插画 / 小说 + 排序 最新 / 最早 / 热门。
- **毛玻璃（GlassCard）+ M3 Switch + BookmarkPanel 动画 + 主题色**（spec `app-lynx-frosted-glass.md` / `app-lynx-m3-switch.md` / `app-lynx-bookmark-animation.md` / `app-lynx-theme-color.md`）：典型 M3 风格。
- **AI 翻译（OpenAI Responses API）**：与 webview **完全独立实现**（spec `app-lynx-novel-translation.md` + ADR-0169–0178）：API key 不进 JS heap（独立 `PictelioTranslate` Java 模块，ADR-0037 原则）；章节粒度续翻 + 整段切换 UX；8 状态机；流式优先 + 整批回退；缓存粒度 = novel id + chapter id + targetLang + modelId + sourceHash + baseURLHash。
- **AI 作品卡片遮罩**：webview 用 store 过滤；lynx 用 `AiOverlay.vue` + `AiRestrictedIllustCard.vue` + `AiRestrictedNovelCard.vue`（视觉硬隔离，符合 M3）。
- **三大发现位差异化**：首页三段式（推荐 / 插画 / 小说 / 我的）+ 推荐 mix 4:1 + 轮播（`Recommended.vue` + `Recommended.vue` + 推荐 mix）。
- **登录态互通**：与 webview 共享一份 Android Keystore（`SecureStorageCompat`），登录一次两边可用（ADR-0050）。
- **NovelIntro 独立页**（spec `app-lynx-novel-intro`）：小说系列三段页（封面 / 简介 / 章节列表），webview 的 NovelDetail 把这些合在详情里。

### 3.2 lynx 客户端功能矩阵

| 功能 / 维度 | Pictelio lynx pre-alpha | Pixiv-Shaft | PixEz | PiPixiv | SwiftUI | 开源阅读 + 书源 | P站助手 |
|---|---|---|---|---|---|---|---|
| **平台** | Android | Android | Android | 5 端 | Apple 3 端 | Android 书源 | iOS+Android |
| **国内直连** | ⬜ 需配置代理 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **放射 FAB 入口** | ✅（业内少见） | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **全局搜索弹层** | ✅（业内少见） | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **小说追更 / Watchlist** | ✅（spec ADR-0166） | ⬜ | ⬜ | ✅ | ⬜ | ✅ | ⬜ |
| **小说系列三段页（NovelIntro）** | ✅（业内少见） | ⬜ | ⬜ | ✅ 部分 | ✅ | ✅ | ⬜ |
| **AI 翻译（OpenAI Responses API）** | ✅ BYOK **不过服务器** | ✅ 服务端付费 | ⬜ | ✅ 多 provider | ✅ 主备 | ⬜ | ✅ 服务端付费 |
| **AI 作品卡片遮罩层** | ✅（M3 视觉隔离） | ✅ store | ⬜ | ✅ | ✅ | ⬜ | ⬜ |
| **屏蔽标签独立页** | ✅ `MuteTags.vue` | ✅ | ✅ | ✅ | ✅ | ✅ | ⬜ |
| **R18/R18G overlay skeleton** | ✅（spec `app-lynx-r18-overlay-skeleton.md`） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **平台检查（启动门）** | ✅ `PlatformCheck.vue` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **更新页（独立）** | ✅ `UpdatePage.vue` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **客户端切换（回 webview）** | ⬜（待补；目前需要 restart 跳 Activity） | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **网络自检** | ✅ `NetworkCheck.vue` | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **毛玻璃 / M3 Switch / 主题色** | ✅（spec 4 篇） | ⬜ | ⬜ | ⬜ | ✅ Liquid Glass | ⬜ | ⬜ |
| **下拉刷新** | ✅（spec `app-lynx-pull-to-refresh.md`） | ✅ | ✅ | ✅ | ✅ | ⬜ | ✅ |
| **回到顶部 FAB + 分页 FAB** | ✅（spec `app-lynx-back-to-top.md` / `feed-pagination-buttons.md`） | ✅ | ⬜ | ✅ | ⬜ | ⬜ | ⬜ |
| **Pinia + TanStack Query** | ✅（双 store 已迁移） | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **i18n** | ✅ 自研 t() | ✅ | ⬜ | ✅ | ✅ | ✅ | ✅ |
| **WebDAV 备份** | ✅ | ⬜ | ⬜ | ✅ | ✅ pixez 格式 | ✅ | ⬜ |
| **下载管理** | ✅ `DownloadManager.vue` | ✅ **最强** | ✅ | ✅ | ✅ | ⬜ | ✅ |
| **缓存控制** | ⬜（未做 ImageCacheSettings） | ⬜ | ⬜ | ✅ | ✅ | ⬜ | ⬜ |
| **镜像设置** | ⬜（未做 ImageHostSettings） | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **高级筛选（搜索）** | ✅ 5 维（period / bookmark / ratio / minPixels / aiOverride，共享 `@pictelio/search-core`；webview 用 `/search` 独立路由 + `SearchFilterSheet.tsx`，lynx 用 FAB 全局弹层 `SearchSheet.vue`，**#476 拍板规格一致**） | ✅ | ✅ 基础 | ✅ | ✅ | ✅ | ✅ |
| **以图搜源** | ⬜ | ✅ | ✅ | ⬜ | ✅ | ⬜ | ✅ |
| **AI 漫画翻译** | ⬜ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ |
| **AI 超分** | ⬜ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ |
| **多账号** | ⬜ | ✅ | ⬜ | ✅ | ⬜ | ⬜ | ✅ |
| **平板两栏** | ⬜ | ✅ | ⬜ | ✅ | ✅ | ⬜ | ⬜ |
| **access_token 不入 JS heap** | ✅（`PictelioAuth` Java heap only） | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |

### 3.3 lynx 客户端独有优势（webview 没有）

1. **放射 FAB + 全局搜索弹层**（业内少见）：
   - 顶层 tab 页 = 放射 FAB 内环「搜索」项
   - 非 tab 内容页 = 放射 FAB 本体为搜索按钮（直达模式）
   - 与 feed 分页 FAB 同角竖排堆叠（spec `app-lynx-feed-pagination-convergence.md`）
   - 底部命令面板 + 输入即搜（300ms 防抖）+ scope + 排序 + 历史本地持久化

2. **小说追更（Watchlist）**：
   - D1 滚动 ≥70% + 停留 ≥10s 触发询问弹层（防秒进秒退误触）
   - D2「暂不」记忆 = 本会话级内存 Set
   - D3 已完结系列也弹
   - D4 列表条目直达**最新一话**（不建系列章节页）
   - D6 通知开关本期不做

3. **NovelIntro 独立页**：小说系列三段页（封面 / 简介 / 章节列表），与 webview 的 NovelDetail 内嵌三段分离。

4. **AI 翻译（OpenAI Responses API）独立实现**：
   - 协议 = OpenAI Responses API `POST /v1/responses`（不写死 chat/completions）
   - API key 用户自填（无 provider preset）
   - API key 走 Native bridge（独立 `PictelioTranslate` Java 模块，与 `PictelioAuth` 同级）
   - 章节粒度续翻 + 整段切换 UX（详情顶部「原文 / 译文」单选）
   - 缓存粒度 = novel id + chapter id + targetLang + modelId + sourceHash + baseURLHash
   - 8 状态机（idle / pending / translating / translating_queued / partial / failed / completed / aborted）
   - 流式优先 + 整批回退混合模式（provider 接口 `AsyncIterator<TranslationChunk>`）
   - R18 拦截 = 应用层（account-scoped R18 关 → 直接拒绝翻译该章节）
   - 不抽共享包；不复用 webview 翻译栈

5. **M3 设计语言 + 毛玻璃 + M3 Switch + 主题色**：与 webview 的 Fluent 2 完全独立轨道，给用户"M3 风格"选择。

6. **AI 作品卡片遮罩层**（业内少见）：webview 用 store 过滤；lynx 用 `AiOverlay.vue` + `AiRestrictedIllustCard.vue` + `AiRestrictedNovelCard.vue` 视觉硬隔离，符合 M3。

7. **平台检查（PlatformCheck）独立页**：启动门（与 webview 内嵌检查不同），用户启动即可看到兼容状态。

8. **更新页（UpdatePage）独立页**：OTA 自建更新流程的完整 UI（webview 内嵌于 Settings）。

9. **屏蔽标签（MuteTags）独立页**：webview 用 Settings/BlocklistSheet；lynx 独立路由。

10. **PictelioTranslate + PictelioAuth + PictelioApi + PictelioApp + PictelioSecureStorage**：5 个 LynxModule + 共用 `SecureStorageCompat`，**LynxView 与 WebView 视为同一不信任边界**（ADR-0037 一致原则）。

### 3.4 lynx 客户端缺位（webview 有 / 竞品有）

| 缺位 | 影响 | 替代 |
|---|---|---|
| ❌ ~~**高级搜索筛选**（5 维 + AI 覆盖）~~ | **已具备**（两个端都有，#476 规格一致） | — |
| ❌ **三层缓存 + 用户可调开关** | 性能 / 存储 | webview 完整支持（ADR-0090） |
| ❌ **镜像 host 设置 + DNS 探测** | 国内可达性 + 加速 | webview 完整支持（ADR-0143） |
| ❌ **9 种小说导出格式** | 重度小说党 | webview `@pictelio/novel-export` |
| ❌ **About / Settings / PersonalCenter / ImageCacheSettings / ImageHostSettings / DebugImage** | 调试 + 配置 | webview 6 个二级路由 |
| ❌ **ScrollRestorationConfirm + ClientSwitch** | 滚动恢复 + 客户端切换 | webview 完整支持 |
| ❌ **LazyDetailImage 双可见性检测 + createProgressiveImage** | 大图性能 | webview 完整支持 |
| ❌ **小说虚拟化（TanStack Virtual）+ 章内搜索** | 长篇阅读性能 | webview 完整支持 |
| ❌ **ImageViewer 全屏查看器** | 沉浸式浏览 | webview 完整支持 |
| ❌ **多账号切换** | 多号党 | webview 也缺 / Shaft / PiPixiv |
| ❌ **以图搜源** | 找图党 | webview 也缺 / Shaft / PixEz |
| ❌ **AI 漫画翻译 / AI 超分** | 漫画党 + 老图党 | webview 也缺 / Shaft / P站助手 |
| ❌ **平板横屏两栏** | iPad / 折叠屏 | webview 也缺 / Shaft / PiPixiv |
| ❌ **永久收藏缓存** | 收藏党刚需 | webview 也缺 / SwiftUI（实验性） |
| ❌ **MCP / AI Agent 接入** | 桌面端差异化 | Pixeval（少见） |

---

## 4. 两个客户端之间的能力差异矩阵

> ✅ = 具备；⬜ = 缺位；— = 不适用

| 维度 | webview | lynx | 备注 |
|---|---|---|---|
| **首页 SideNavShell + 单列 L5** | ✅ | ⬜（底栏 + FAB） | webview 用 C-shell；lynx 用 M3 底栏 |
| **三段式首页（推荐 / 插画 / 小说 / 我的）** | ✅ HomePage | ✅ Recommended + 底栏 | 双端都有；lyxn 是 4 段式 |
| **瀑布 / 单列 / 网格（三次级布局）** | ✅ | ⬜（仅单列） | webview 独有 |
| **插画详情 + 多页 LazyDetailImage** | ✅ | ✅ CoverImage.vue | webview 更精细 |
| **ugoira 流式播放** | ✅ 双轨 | ✅ 双轨 | 同等深度 |
| **小说阅读器** | ✅ 虚拟化 + Pretext + 章内搜索 | ✅ 虚拟化（spec `novel-detail-virtualization.md`）+ 文本选择菜单 | webview 略胜（有章内搜索） |
| **小说系列三段页** | ✅ NovelDetail 内嵌 | ✅ **NovelIntro 独立页** | lynx 独有独立页 |
| **小说追更 / Watchlist** | ⬜ | ✅（spec ADR-0166） | lynx 独有 |
| **小说导出（9 种格式）** | ✅ | ⬜ | webview 独有 |
| **AI 翻译（DeepSeek）** | ✅ S1–S7 | ⬜ | webview 独有 |
| **AI 翻译（OpenAI Responses API）** | ⬜ | ✅（spec ADR-0169–0178） | lynx 独有 |
| **AI 作品卡片遮罩层** | ⬜（store 过滤） | ✅ AiOverlay.vue | lynx 独有 |
| **R18/R18G overlay skeleton** | ✅（Card mask） | ✅ | 同等深度 |
| **搜索（关键词）** | ✅ Search.tsx + 即输即搜 | ✅ FAB 弹层 + 即输即搜 | 双端都有 |
| **搜索高级筛选** | ✅（日期 / 收藏数 / 比例 / 分辨率 / AI 覆盖，共享 `@pictelio/search-core`，#476 拍板规格一致） | ✅（同样 5 维，FAB 弹层可达） | 双端一致；差异仅入口形态（webview `/search` 独立路由 vs lynx FAB 全局弹层） |
| **排行榜（7 mode + 日期）** | ✅ | ✅ | 双端都有 |
| **关注 / 粉丝 / 收藏 / 历史** | ✅ FeedList | ✅ Following / Bookmarks / FollowList | 双端都有 |
| **收藏 + 标签** | ✅ | ✅ | 同 |
| **屏蔽作品 / 标签 / 作者** | ✅ | ✅ + MuteTags 独立页 | lynx 独立路由 |
| **平台检查** | ⬜（内嵌） | ✅ PlatformCheck.vue | lynx 独立页 |
| **更新页** | ⬜（Settings 内嵌） | ✅ UpdatePage.vue | lynx 独立页 |
| **下载管理** | ✅ DownloadManager.tsx | ✅ DownloadManager.vue | 双端都有 |
| **WebDAV 备份** | ✅ | ✅ | 同 |
| **OTA 自建更新** | ✅ OtaPlugin | ✅ `PictelioAppModule.httpGet` | 共享 `@pictelio/update-check` 逻辑 |
| **网络自检** | ✅ /network-check | ✅ /network-check | 双端都有 |
| **缓存设置（3 层 + 磁盘上限）** | ✅ ImageCacheSettings.tsx | ⬜ | webview 独有 |
| **镜像设置（4 模式 + DNS 探测）** | ✅ ImageHostSettings.tsx | ⬜ | webview 独有 |
| **客户端切换** | ✅ ClientSwitch.tsx | ⬜（需 restart） | webview 独有 |
| **About / 调试 / 滚动恢复确认** | ✅ 3 路由 | ⬜ | webview 独有 |
| **M3 Switch / 毛玻璃 / 主题色** | ⬜ | ✅（spec 4 篇） | lynx 独有 |
| **下拉刷新** | ⬜ | ✅ PullToRefresh | lynx 独有 |
| **回到顶部 FAB + 分页 FAB** | ⬜ | ✅ 双 FAB 竖排堆叠 | lynx 独有 |
| **放射 FAB（搜索 / 收藏 / 翻译）** | ⬜ | ✅ GlobalFab.vue | lynx 独有 |
| **access_token 不入 JS heap** | ✅ | ✅ | 同（共享原则） |
| **refresh_token Keystore 加密** | ✅ | ✅（复用 SecureStorageCompat） | 同（互通） |
| **i18n** | ✅ @solid-primitives/i18n | ✅ 自研 t() | 双 i18n 实现 |
| **工程化（ADR / 测试）** | ✅ 113+ ADR | ✅ 37 个 spec | webview 更深 |

---

## 5. 同类竞品各自对位的强项

| 竞品 | 对 webview 客户端 | 对 lynx 客户端 |
|---|---|---|
| **Pixiv-Shaft** | AI 套件（漫画翻译 + 超分 + cut-out + RIFE）/ aria2 NAS / 多账号 / 横屏两栏 / 以图搜源 / DoH 直连 / 平板优化 / 工程化（Kotlin + Room + Retrofit） | 国内直连；多账号；横屏两栏；漫画翻译 |
| **PixEz** | 轻量免代理直连；瀑布流 + 高清原图；长按心形 + 10+ 标签面板 | 轻量免代理；最小体积 |
| **Pixiv-MultiPlatform** | 跨平台 Flutter；DoH 直连；R18/R18G/AI 过滤 | （Flutter 是另一种跨端思路） |
| **PiPixiv** | iOS+Win+Mac+Linux 全端；多 provider AI 翻译（含 OpenAI/Claude/Gemini/DeepSeek + 流式 + 稍后读 + 缓存）；HarmonyOS 直连；图片预览 panpf/zoomimage | （同样全端，且 iOS+Win+Mac+Linux 覆盖） |
| **Pixiv-SwiftUI** | （Apple 生态，不直接对位） | **iOS+macOS 平台替代方案**；手写 HTTP+SNI 直连；SwiftUI 永久收藏缓存（实验性）；Apple Liquid Glass 风格 |
| **开源阅读 + Pixiv 书源** | **最好的小说阅读器**（书架 / 离线 / 繁简 / 进度 / 屏蔽全 5 项 / 直连模式） | 同样对位 lynx；可作 lynx 小说路线参考 |
| **P站助手** | 国内直连；服务端 AI 翻译（漫画 + 小说，付费）；本机 / 云端超分；CDN 加速订阅；批量下载 | 国内直连；服务端 AI 翻译付费；iOS+Android |
| **Pixeval** | 桌面端 + MCP server（AI Agent 接入，少见）；Watch Later；浏览历史；自定义过滤 | 桌面端差异化（仅 Win） |
| **官方 Pixiv** | Premium 解锁人气排序 / 屏蔽 / 180 天历史 | 同 |

---

## 6. 综合评估 + 客户端路线建议

### 6.1 两个客户端的总体定位

| 客户端 | 定位 | 主目标用户 | 评分（综合） |
|---|---|---|---|
| **webview** | **深度功能旗舰**：覆盖 90% 主流场景 + 几个独占特色（DeepSeek 翻译 / 9 格式导出 / 高级筛选 / 三层缓存 / 镜像设置 / 设计系统） | 重度用户 / 翻译党 / 漫画党 / 小说党 / 桌面党（Win 备用） | ⭐⭐⭐⭐⭐ |
| **lynx** | **移动原生体验旗舰**：覆盖 60% 主流场景 + 几个独占特色（追更 / NovelIntro / 放射 FAB / OpenAI 翻译 / M3 设计 / 卡片遮罩） | 移动党 / M3 设计党 / Lynx 性能党 / 系列追更党 | ⭐⭐⭐⭐ |

### 6.2 客户端路线建议（按 ROI 高低排序）

#### webview 客户端路线

| 优先级 | 方向 | 价值 | 难度 |
|---|---|---|---|
| **P0** | **国内直连方案**（DoH / SNI 镜像 + IP 选优） | webview 最大缺口；解锁 60%+ 用户基数 | 中 |
| **P1** | **小说追更（Watchlist）** | lynx 已做，可直接复用 OpenAPI 契约 + UI | 中 |
| **P1** | **小说书架 + 离线 + 进度 + 繁简** | 重度小说党留存 | 中 |
| **P1** | **AI 漫画圈选翻译 / AI 超分** | 漫画党壁垒 | 极高 |
| **P2** | **多账号切换** | 多号党刚需 | 中 |
| **P2** | **平板横屏两栏** | iPad / 折叠屏体验升级（SideNavShell 改造即可） | 低 |
| **P2** | **以图搜源** | 找图党刚需 | 低 |
| **P3** | **永久收藏缓存** | 收藏党刚需 | 中 |
| **P3** | **MCP / AI Agent 接入** | 桌面端差异化 | 低 |
| **P4** | **iOS 客户端**（独立 SwiftUI / Capacitor 移植） | 解锁 Apple 生态 | 高 |

#### lynx 客户端路线

| 优先级 | 方向 | 价值 | 难度 |
|---|---|---|---|
| **P0** | **缓存设置 + 镜像设置**（移植 webview 的 ImageCacheSettings + ImageHostSettings） | 性能 + 可达性 | 中 |
| **P0** | **国内直连方案** | lynx 最大缺口 | 中 |
| **P1** | ~~**高级搜索筛选**~~（已具备，无需移植） | — | — |
| **P1** | **小说虚拟化 + 章内搜索 + 9 格式导出**（移植 webview 的 `createNovelVirtualLayout` + `@pictelio/novel-export`） | 重度小说党 | 中 |
| **P1** | **客户端切换（跳回 webview）** | 双客户端互通必备 | 低 |
| **P2** | **ImageViewer 全屏查看器 + PixivImage 完整版** | 大图沉浸体验 | 中 |
| **P2** | **多账号切换** | 多号党刚需 | 中 |
| **P2** | **以图搜源** | 找图党刚需 | 低 |
| **P3** | **平板横屏两栏** | iPad / 折叠屏体验升级 | 低 |
| **P3** | **AI 漫画圈选翻译 / AI 超分** | 漫画党壁垒 | 极高 |
| **P4** | **iOS 端 Lynx 移植** | 解锁 iOS 生态（Lynx 4.x 已支持 iOS） | 高 |

### 6.3 一句话总结

> **webview 客户端是"功能深度旗舰"——DeepSeek 翻译 / 9 格式导出 / 高级筛选 / 三层缓存 / 镜像设置 / 设计系统业界最强梯队；最大缺口是国内可达性。**
>
> **lynx 客户端是"移动原生体验旗舰"——追更 / NovelIntro / 放射 FAB / OpenAI 翻译 / M3 设计 / AI 卡片遮罩 / FAB 全局搜索弹层业界少见；最大缺口是缓存/镜像设置 + 国内可达性 + 9 格式导出。**
>
> **建议 webview 优先补"国内直连 + 小说追更 + 书架"；lynx 优先补"缓存/镜像设置 + 国内直连 + 小说虚拟化导出"。两者同步推进可对齐到同一竞品水平，差异化保留各自独有特色。**

---

## 7. 调研未覆盖 / 待补

- iOS 客户端实际可行性（lynx 4.x 已支持 iOS，但 iOS Lynx 案例稀缺，需 spike 验证）。
- webview 与 lynx 性能基准对比（v5.5.0 已有 agent-browser 性能基准，但 lynx 端尚未建立可比基准）。
- lynx 端 #60 差距清单完整进度（37 个 spec 已落地 60%+，剩余 40% 待办）。
- 实际用户调研（建议下一轮挂 issue 做问卷）。
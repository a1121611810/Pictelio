# 调研：同类 Pixiv 第三方客户端功能对比（vs Pictelio）

> 调研日期：2026-09-26
> 调研方式：官方仓库 README / Release notes / 各项目 Wiki 浅读，结合 AGENTS.md + OpenWiki 中已记录的 Pictelio v5.5.0（pictelio-app 5.5.0 / pictelio-app-lynx pre-alpha）当前能力做矩阵对比。功能存在性以公开资料为准；未单独核验实现细节的标「未核验」。
> 关联文档：`openwiki/quickstart.md`、`openwiki/architecture/overview.md`、`openwiki/architecture/api-layer.md`、`openwiki/architecture/image-pipeline.md`、`openwiki/domain/feed-and-browsing.md`、`openwiki/domain/novel-reader.md`、`openwiki/integrations/android-native.md`、`docs/research/bookmark-tags-similar-clients.md`。

---

## 0. 一览表

| 项目 | 平台 / 技术栈 | 当前形态 | 插画 | 漫画 | 小说 | 排行榜 | 直连国内 | AI翻译 | 以图搜源 | 反向工程 / 评论 / 关注 | 收藏加标签 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Pictelio（本项目，webview 客户端）** | Android / SolidJS 2.0 + Capacitor 8.5 + Fluent Design 2 | 已发布 v5.5.0 | ✅ 单列 L5 / 瀑布 / 网格 三模式（次级 feed） | ✅ | ✅ 虚拟化布局 + Pretext + 章节搜索 + 系列导航 | ✅ 7 种 mode + 日期选择 + **5 维高级筛选**（`@pictelio/search-core`：`/search` 独立路由 + 即改即搜） | ❌ 走 `/pixiv-img/` + 代理 | ✅ DeepSeek BYOK（S1–S7）+ LRU 缓存 + 流式注入 + R18 三段式门控 | ❌ | ✅ | ✅ 标签库（`blockStore`/`reportStore` 同源） | 同时跑 vue-lynx MVP |
| **Pictelio app-lynx** | Android（lynx flavor）/ vue-lynx + M3 | pre-alpha | ✅ 三段式（推荐 / 插画 / 小说 / 我的）+ 推荐 mix 4:1 | ✅ | ✅ NovelIntro 三段页 + M3 文本选择 + 翻译 | ✅ + **5 维高级筛选**（同 `@pictelio/search-core`：FAB 弹层「SearchSheet」+ 即改即搜，#476 与 webview 同规格） | ❌ | ✅ OpenAI Responses BYOK（ADR-0169–0178） | ❌ | ✅ | ✅ | 与 webview 共享登录态（Keystore 互通） |
| **Pixiv-Shaft（PixShaft）** | Android / Kotlin（Java）+ MVVM + Retrofit/Room/Glide/M3 | v4.7.7，100k+ 下载 | ✅ | ✅ | ✅ 完整小说阅读器 + 系列 + R18 | ✅ 日/周/月 + 日期 | ✅ DoH + 内置 DNS | ✅ AI 翻译（整部作品）+ 漫画「圈选翻译」 | ✅ SauceNAO / TinEye / IQDB / Ascii2D | ✅ 多账号 | ✅ | 还做：AI 超分、cut-out、ugoira RIFE 插帧、Mp4 导出、aria2 NAS 远程下载、Tab 两栏 |
| **PixEz / Pixez-Flutter** | Android / Flutter | v0.9.102 | ✅ | ✅ | 弱（第三方调研评为「阅读体验明显不如 Pixiv」） | ✅ | ✅ 内置直连（Pixiv Viewer 系直连方案） | ❌ | ✅ 反向以图搜源 | ✅ 屏蔽作者/标签/作品 | ✅ 10 标签上限（前端不限） | 轻量、无广告、原图下载 |
| **Pixiv-MultiPlatform** | Android / Flutter（GPL-3.0） | 活跃 | ✅ | ✅ | ✅ | ✅ | ✅ DoH 直连 | ❌ | ❌ | ✅ 含 AI 过滤 | ❌ | 主打跨平台一致 |
| **PiPixiv** | Android+iOS+Win+Mac+Linux / Compose Multiplatform | v2.4.0 | ✅ | ✅ | ✅ 沉浸式阅读 + 翻译 + 进度 | ✅ 多榜单 | ✅ HarmonyOS / SNI 直连 | ✅ OpenAI / Claude / Gemini / DeepSeek 兼容 + 流式 + 稍后读 + 缓存 | ❌ | ✅ 屏蔽作品/用户/标签 + 长标签过滤 | 未公开标签上限 | 全平台最广：iOS / Win / macOS / Linux / Android 一次打包 |
| **PivisionM** | Android / Flutter | 轻量级 | ✅ | ✅ | 弱（未列专门章节） | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | 主打「体积小、免代理直连」 |
| **Pixiv-SwiftUI（Eslzzyl）** | iOS+iPadOS+macOS / SwiftUI + SwiftData | v0.16.0（实验性，README 自标 Vibe Coding） | ✅ | ✅ | ✅ 阅读器 + 进度 + 沉浸式翻译 + 双语对照 + 系列 | ✅ 多榜单 | ✅ 直连（手写 HTTP+SNI 绕过 + GzipSwift） | ✅ 多翻译服务（主/备）+ 标题/简介/评论全翻译 | ✅ | ✅ R-18/R-18G/剧透/AI 四态过滤 + 屏蔽 | ✅ | 主动声明 pixez-flutter 在 iOS 上发热，本项目为补位 |
| **Pixiv-SwiftUI 参考**：pixez-flutter iOS 端发热问题（Pixiv-SwiftUI README 痛点） | — | — | — | — | — | — | — | — | — | — | — | — |
| **P站助手（PixHelper / pivlite）** | iOS+Android / 原生 | 2026 持续更新 | ✅ | ✅ | ✅ | ✅ | ✅ 国内直连 | ✅ 漫画 AI 翻译 + 小说 AI 翻译（服务端，**付费**） | ✅ | ✅ | ❌ | 还有：本机 / 云端图片高清化、批量加速；商业化项目 |
| **Pixeval** | Win / .NET 10 + Avalonia C# | 2026-09 更新 | ✅ | ✅ | ✅ | ✅ | ❌（仅 Web API） | ❌ | ❌ | ✅ | ✅ 10 标签上限 + 正则 | 主打桌面 + MCP server（少见的 AI 接入） |
| **Pixiv Reader** | Android / 原生 + Material 3 | v0.1.2 | ✅ | ✅ | ✅ 本地 TXT/EPUB/Markdown 导入 + PDF/TXT 导出 | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | 兼顾线上+本地电子书 |
| **开源阅读 + Pixiv 书源（Legado）** | Android / Java | 活跃（书源 v284，2026-09） | ✅ | ❌ | ✅ **调研评为「最好的 Pixiv 小说阅读器」** | ✅ | ✅ 直连模式（仅 legado） | ❌ | ❌ | ✅ 屏蔽作者/标签/描述/喜欢/追更 | ❌ | 书架 + 离线 + 繁简通搜 + 繁简转换 + 隐藏追更 |
| **官方 Pixiv（iOS 基准）** | iOS+Android | v7.16.x（持续更新） | ✅ | ✅ | ✅ 但**无书架 / 进度仅限系列 / 屏蔽付费** | ✅ | ❌ | ❌ | ❌ | ❌ 屏蔽 = Premium | ✅ 10 标签上限（Premium） | Premium 4.99$/月 解锁：人气排序 / 隐藏广告 / 180 天历史 / Mute |

> 表格说明：✅ = 已具备 / 主打；❌ = 明确不具备 / 未公开。括号内为备注点。Pictelio 与官方直接对照可看出我们位于「爱好者重客户端 + AI 翻译特色」赛道。

---

## 1. 同类客户端速写（功能定位 + 平台 + 技术 + 主要优势）

### 1.1 Pixiv-Shaft（PixShaft，★11.9k）
- **平台 / 技术栈**：Android，Kotlin + MVVM + Repository + Retrofit + Room + Glide + Material Design；目标 SDK 36 / minSdk 23。
- **架构**：6 模块 Gradle 多模块（`:app` / `:models` / `:annotations` / `:processor` / `:progressmanager` / `:flowlayout-lib`）。
- **核心特色**：
  - **AI 套件**（PixShaft 命名）：AI 超分 / cut-out / 漫画 AI 翻译（带「圈选翻译」补翻）/ ugoira RIFE 插帧（2× / 4×，自适应上 50fps 上限；导出 H.264 MP4）。
  - **下载体系**：并发下载（优先级队列 + 暂停 / 续传 / 重试）+ 批量改名 + 命名模板 + 远程下载到 aria2 NAS + 「低下载」避免污染相册。
  - **多账号管理** + token refresh + SQLite 元数据缓存。
  - **反向以图搜源**：内嵌 SauceNAO / TinEye / IQDB / Ascii2D 客户端，跳转回 Pixiv。
  - **直接连接国内**：自带 DoH DNS + 镜像 pixiv.cat/re/nl，**首次登录后无需代理**。
  - **网络自检**：内置网络诊断页（DNS / App API / Web / 真图下载，IPv6 污染识别）。
  - **横屏两栏**：平板横屏左 1/3 feed + 右 2/3 详情，可关。
  - **2026 v4.7.7 新增**：热门标签库 97→202 个内置 + 300 张预览图、用户主页按标签筛选、AI 三档（含「只看 AI」）、保留状态栏、同义词搜索、长篇 AI 翻译。
- **短板**：UI 完全为原生 Android，缺乏跨平台能力；AI 套件订阅制（5×/20× 配额，免费版有上限）。

### 1.2 PixEz / Pixez-Flutter（★12.8k）
- **平台 / 技术栈**：Android / Flutter（已停止维护老 Pix-EzViewer，Flutter 版为升级）；GPL-3.0。
- **核心特色**：轻量、**免代理直连**、瀑布流、高清原图一键下载、多标签搜索、屏蔽作品/作者/标签。
- **收藏标签**：单击心形 = 快速收藏（可配置默认私密 + 自动附加作品标签）；长按心形 → `TagForIllustPage` 标签面板（详见 `docs/research/bookmark-tags-similar-clients.md` §1.1）；标签上限前端未限制。
- **短板**：小说阅读**调研评级「明显不如 Pixiv」**（缺少书架、不能存进度、首行缩进、付费屏蔽）。

### 1.3 Pixiv-MultiPlatform
- **平台 / 技术栈**：Android / Flutter（GPL-3.0）。
- **核心特色**：内置浏览器登录、推荐 / 排行榜 / 时间线、插画详情 + 原图下载 + 喜欢 + 评论、小说详情 + 阅读 + 导出、个人中心 + 多账号 / 收藏 / 关注 / 历史 / 下载管理器、R18/R18G/AI 过滤、DoH 直连。
- **定位**：跨平台（Android）一致体验的轻量替代。

### 1.4 PiPixiv（master-lzh / darriousliu，Compose Multiplatform）
- **平台 / 技术栈**：Compose Multiplatform 1.12，**Android + iOS + Windows + macOS + Linux** 五端同时发布（v2.4.0，2026-09-05）。Compose BOM 2026.03.00 + Kotlin 2.4 + Gradle Wrapper 9.6.1。
- **核心特色**（v2.3–v2.4）：
  - **AI 翻译套件最完整**：OpenAI / Claude / Gemini / DeepSeek 兼容 + 自定义 `extra_body` JSON + 推理模式预设 + 流式首个分片实时 + 后续并发按原文顺序合并 + 180s 超时可调 30–1800s。
  - **稍后阅读 + 预翻译队列**（v2.3）：Read Later 列表 + 自动预翻译 + 缓存 + 失败重试 + 下次启动恢复。
  - **追更与系列**（v2.3）：追更列表 + 系列详情 + 追更/取消追更。
  - **小说阅读书签**（v2.3）：独立于收藏的阅读位置书签，可保存/更新/删除/恢复。
  - **漫画内容增强**（v2.3）：创作者主页 + 漫画 Tab、Manga/Series 标识、首页漫画推荐。
  - **图片预览**（v2.3，panpf/zoomimage）：Medium / High / Original 三档 + 缩放/拖拽/多图横滑/共享元素/上下滑关闭。
  - **HarmonyOS / SNI 直连**（v2.3）：原站 DNS + 多 IP 回退 + 严格主机名校验。
  - **iOS / 桌面**：Swift Export 部署 iOS 18+；Win x86_64、macOS arm64、Linux x86_64 原生包。
  - **多语言**：默认 i18n 架构完善。
- **短板**：体量大（APK 8.93–11.6 MB）；功能多但部分 P0 功能（自定义提示词 / 术语表）尚未纳入。

### 1.5 Pixiv-SwiftUI（Eslzzyl，★106）
- **平台 / 技术栈**：iOS+iPadOS+macOS / SwiftUI + SwiftData + Kingfisher + GzipSwift + SwiftSoup。
- **核心特色**：
  - **Apple 平台统一**：iOS 26/27/18 + iPadOS 26 + macOS 26/27 同代码库。
  - **手写直连模式**：绕开 SNI 自实现 HTTP + GzipSwift 解压（README 明示「pixez-flutter 在 iOS 上发热是本项目诞生动机」）。
  - **沉浸式翻译 + 双语对照**：标题/简介/用户简介/评论全翻译；多翻译服务（主/备）；LLM 小说场景优化（多段上下文）。
  - **R-18/R-18G/剧透/AI 四态过滤**：正常 / 模糊 / 屏蔽 / 仅显示。
  - **实验性永久收藏缓存**：避免作者删图导致插画丢失。
- **短板**：README 自标**实验性 Vibe Coding**，所有代码由 LLM 生成；**依赖 Resources/tags.json** 才能编译；iOS 17 / macOS 14/15 仅理论支持未测；iOS 需 AltStore 侧载，macOS dmg 未签名。

### 1.6 P站助手（PixHelper / pivlite，子非鱼）
- **平台 / 技术栈**：iOS + Android，原生；商业化项目（部分功能付费）。
- **核心特色**：
  - **国内直连**（同 Shaft）—— 第一次登录后免代理。
  - **AI 漫画翻译**（服务端 DeepSeek）+ **AI 小说翻译**（流式输出 + 保留原文排版）。
  - **图片高清化双通道**：本机（设备算力）+ 云端（提交队列），批量提交 + 自动保存。
  - **下载体系**：单张/批量下载 + 通知栏进度 + 下载管理器 + 收藏批量入队 + 漫画批量 + ugoira 下载导出 WebP/GIF + 动态壁纸。
  - **可选订阅 CDN 代理**加速慢网络。
- **短板**：**翻译与云端高清化需付费**；商业化 vs 开源自由度的取舍。

### 1.7 Pixeval（Win）
- **平台 / 技术栈**：Windows / .NET 10 + Avalonia C#；2026-09-05 更新。
- **核心特色**：桌面端 + MCP server（少见的 AI Agent 接入入口）+ 排序按收藏数 / 自定义过滤 / 订阅下载 / 自动播放 / Watch Later / 浏览历史 / 图片缓存。
- **收藏标签**：硬编码 10 个上限；右键心形 → TagSelector Flyout；未收藏走 `user/bookmark-tags/illust`，已收藏走 `bookmark/detail`。
- **短板**：仅 Windows；无小说阅读器（主浏览向）。

### 1.8 开源阅读 + Pixiv 书源（Legado）
- **平台 / 技术栈**：Android / Java，开源阅读是「带规则的特殊浏览器」。
- **核心特色（小说向）**（调研评估为「最好的 Pixiv 第三方小说阅读器」）：
  - 书架、离线阅读、繁简通搜、繁简转换、阅读进度（单篇 + 系列）、阅读记录、纯净无广。
  - 屏蔽作者 / 标签 / 描述 / 隐藏喜欢 / 隐藏追更。
  - **直连模式**（仅开源阅读可开，登录后无需代理）。
- **短板**：不是 App，是书源（依赖阅读 3.0 / 阅读 Sigma / 轻悦时光）；UI 交互与 Pictelio 路线不同。

### 1.9 Pixiv Reader（0.1.2）
- **平台 / 技术栈**：Android + Material 3。
- **核心特色**：线上 + **本地 TXT/EPUB/Markdown 导入 + PDF/TXT 导出** + 跨板块搜索 + WorkManager 后台下载 + 中英双语 + 动态取色。
- **短板**：v0.1.2 早期；功能面较窄。

### 1.10 PivisionM
- **平台 / 技术栈**：Android / Flutter（轻量）。
- **核心特色**：体积小、免代理直连、插画 + 漫画。
- **短板**：小说功能弱（无专门章节）。

### 1.11 官方 Pixiv
- **平台**：iOS + Android。
- **核心特色**：官方第一手。
- **短板**：核心功能被**会员制**切断（人气排序 / 隐藏广告 / 180 天浏览历史 / 屏蔽作品或标签 = $4.99/月 Premium）；**小说无书架、阅读进度仅限系列、屏蔽 = Premium**；UI 移动端推荐流重广告。

---

## 2. Pictelio v5.5.0 当前已具备的能力（与 OpenWiki 对齐）

> 数据源：`openwiki/quickstart.md` + `openwiki/architecture/overview.md` + `openwiki/architecture/api-layer.md` + `openwiki/architecture/image-pipeline.md` + `openwiki/domain/feed-and-browsing.md` + `openwiki/domain/novel-reader.md` + `openwiki/integrations/android-native.md`。

### 2.1 浏览 & Feed
- **C-shell + L5 固定布局**（`SideNavShell` 56px 左导航 + 单列主区），六路 feed store × 插画/小说 = 12 个面板（`recommendedStore` / `followStore` / `bookmarkStore` × illust / novel + 内置 history）。
- **三种次级布局**：瀑布 / 单列 / 网格（仅次级 feed，主 feed 固定单列 L5，ADR-0075）。
- **统一 `FeedList` 容器**（ADR-0078）：刷新与加载更多拆分、骨架屏不闪、首次失败用 `ErrorDisplay`、分页失败用 `InlineRetryBar`。
- **首页 TanStack Query 持久化**（v4.32 T4）：冷启 4261→2124ms P50。
- **拉到底自动翻页**：sentinel，paginationError 时暂停防抖。
- **6 路独立 TabFeed + 插画/小说 ContentTypeToggle**。

### 2.2 搜索 & 排行榜 & 关注
- **搜索**：关键词 / 自动补全 / 热门预览（`/v1/search/popular-preview/*`）+ **高级筛选**（日期 / 收藏数 / 比例 / 分辨率 / AI 覆盖，shared `@pictelio/search-core`）+ 同参重入 guard。
- **排行榜**：7 种 mode（综合 / 插画 / 漫画 / 小说 / 收藏趋势 等）+ 日期选择 + 7-rank `mode`→API 映射（`@pictelio/ranking-core`）。
- **关注 / 粉丝 / 关注的新作品 / 跨账号多用户切换**。
- **相关作品注入** + 浏览历史（30 天 lazy 过期，`@tanstack/solid-db`，ADR-0094）。

### 2.3 详情 / ugoira / 小说
- **插画详情**：多页 + 全分辨率 + Ugoira 流式播放（ADR-0127/0128）：webview 走 `streamUgoiraFrames` + `fflate` 流式注入（约 2% 下载即可播首帧）；lynx 走 Java `UgoiraStreamEngine` 批式拉取（约 4.5–8.6%）。
- **多页 LazyDetailImage**：基于 `visiblePage + PRELOAD_WINDOW = 6` 提前预取 + 本地 IntersectionObserver 兜底 + 12s 超时 + 3 次 2s 重试 + URL 锁防并发写。
- **小说阅读器**：`createNovelVirtualLayout`（TanStack Virtual 包装）+ `@chenglou/pretext` 文本布局 + 章内搜索（高亮 + 跳转）+ 系列导航 `SeriesSheet` + `createFastScrollbar` 可拖滚动条 + 章内进度。
- **小说 AI 翻译**（S1–S7）：
  - BYOK DeepSeek + OpenAI Responses（lynx 用） → 第三方直连，**不过我们服务器**。
  - 段落 chunked ≤2000 字 / 并发 worker pool ≤3 / first-screen 优先排 / 原文-译文切换 / 翻译失败 retry / LRU 200 章缓存（IndexedDB）/ FNV-1a key + spark-md5 source hash 自动 miss。
  - **R18/R18G 三段门控**：先鉴权 → 风险确认 → 二次确认 + `r18Confirmed` 持久化。
  - 协议层双轨（fetch / CapacitorHttp）+ `sanitizeResponseBody` 抗 keep-alive blank + `classifyTranslateError` 错误规范化。
- **9 种小说导出格式**（`@pictelio/novel-export` ADR-0154）：TXT/EPUB/Markdown/PDF 等。

### 2.4 内容过滤
- **R18 / R18G 三态**（show / mask / hide）：account-scoped `show_r18_${uid}`（ADR-0103）+ 跨客户端同步 + 首次启动 age gate 已移除（避免白屏）。
- **AI 作品三态**（show / mask / only）：account-scoped `ai_filter_mode_${uid}`（ADR-0155），store 过滤 vs 卡片 mask overlay（lynx）。
- **屏蔽作品 / 标签 / 作者**：通过 `blockStore` / `reportStore` + IndexedDB KV。

### 2.5 账号 & 安全
- **OAuth PKCE 登录**（Pixiv）+ **access_token 永不在 JS heap**（`PixivApiPlugin` Java 侧 `volatile` 字段）。
- **401 自动刷新**：Java `synchronized` + `isRefreshing` flag + JS 侧 `refreshTokenRotated` listener 防 stale token。
- **refresh_token 加密存储**：`@aparajita/capacitor-secure-storage`（Android Keystore）+ 备份三层防御（`0003-backup-security`）。
- **URL rewrite trusted boundary**（ADR-0100）：严格 `=== base || startsWith(base+"/")`，防伪后缀域窃 token。
- **双引擎登录互通**：lynx `PictelioSecureStorageModule` 复用 Keystore，登录一次两边可用。

### 2.6 图像管线
- **三层缓存**：L1 in-memory LRU（context-aware 评分）+ L2 浏览器 HTTP cache + L3 Android 磁盘（`ImageCachePlugin` + 共享 `PixivImageLoader`）。
- **三层用户开关**（ADR-0090）：磁盘缓存 / 浏览器缓存头 / 后台预取 + 50–1000MB 磁盘上限 slider。
- **多镜像选择**（`race` / `weighted` / `fastest-ip` / `single`）：native 走 `ImageHostConfig.resolve()`（ADR-0143，缓存键恒为官方 URL，源可换）；Web 走 JS `imageHostService`。
- **`createProgressiveImage`**：thumb → full 平滑切换 + 预取命中跳过 thumb。
- **WebView `shouldInterceptRequest` + 32MB 内存快路径 + `Cache-Control: immutable`**。

### 2.7 下载 / 备份 / 系统
- **保存到相册 + ugoira 多格式导出**（ADR-0145）。
- **下载队列 + 暂停 / 续传 / 重试**（ADR-0146，9 优先级）。
- **WebDAV 备份**（ADR-0156）：设置/收藏/历史可上云。
- **网络自检**：`@pictelio/net-diagnostics` + 内置 `/network-check` 路由（DOH / DNS / Web API / 真图 / IPv6 污染）。
- **OTA WebBundle 自建更新**（ADR-0122）：`OtaPlugin` + Ed25519 校验 + WorkManager 预热。

### 2.8 双客户端
- **WebView 客户端**（Capacitor + SolidJS 2.0 RC + Fluent 2）：主客户端 v5.5.0。
- **app-lynx 客户端**（vue-lynx + M3）：pre-alpha；NovelIntro 三段页（ADR-0167）+ 文本选择菜单（ADR-0165）+ 长按 bookmark + FAB 菜单（ADR-0111）；与 webview **共享 Keystore 登录态**（ADR-0050）。
- **三 Flavor APK**（full / webview / lynx，ADR-0062）。

### 2.9 设计 & 工程
- **Fluent Design 2 严格执行**（tokens / 缓动 / 时长 / 状态全约束）。
- **Cardization A2**（Win11 风格：8px radius + 1px border + 无 shadow，ADR-0074）。
- **StrykerJS 突变测试**（`@pictelio/ugoira` / `@pictelio/update-check`）+ Robolectric Java 单测 + agent-browser AI E2E。
- **CI 门禁**：`check:all` + `lint:all` + `test:all`（ADR-0097 T0 门禁：`passWithNoTests: false`）。
- **ADR 体系**：113+ 篇（ADR-0001 → ADR-0183+，随技术进化同步）。

---

## 4. 优势 / 劣势对比矩阵（按功能维度）

> ✅ = Pictelio 具备；⬜ = 缺；— = 行业普遍

| 维度 | Pictelio | Pixiv-Shaft | PixEz | PiPixiv | Pixiv-SwiftUI | 开源阅读书源 | P站助手 | Pixeval | 官方 |
|---|---|---|---|---|---|---|---|---|---|
| **跨平台（Android+iOS+Win+Mac）** | ⬜ 仅 Android + lynx（lynx 同 Android APK） | ⬜ Android | ⬜ Android | ✅ 全 5 端 | ✅ iOS+iPadOS+macOS | ⬜ Android | ✅ iOS+Android | ⬜ Win | ✅ iOS+Android |
| **国内直连（免代理）** | ⬜ 需配置代理 | ✅ DoH+IP+免代理 | ✅ 直连 | ✅ SNI 直连 | ✅ 手写 HTTP 直连 | ✅ 直连模式 | ✅ 直连 | ⬜ | ⬜ |
| **多镜像加速（race/weighted/fastest）** | ✅ 4 模式 + 原生 resolve | ⬜（仅 DoH 选 IP） | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ CDN 订阅 | ⬜ | ⬜ |
| **三层缓存 + 用户可调开关** | ✅ 业界最细（ADR-0090） | ⬜ Glide 默认 | ⬜ Flutter cache | ✅ Coil | ✅ Kingfisher | ⬜ | ⬜ | ✅ | ⬜ |
| **ugoira 流式播放（不等全下载）** | ✅ webview + lynx 双轨 | ✅ RIFE 插帧（更激进） | ✅ GIF/WebP | ✅ 原始 | ✅ 原始 | ⬜（不涉及） | ✅ WebP/GIF | ✅ 原始 | ✅ |
| **小说虚拟化布局 + 章内搜索** | ✅ Pretext + 虚拟化 | ✅ 有阅读器 | ⬜ | ✅ | ✅ | ✅（最强） | ✅ | ⬜ | ✅（基础） |
| **小说书架 / 离线 / 进度 / 繁简** | ⬜（无书架） | ⬜ | ⬜ | ✅ 进度 + Watchlist | ✅ 进度 | ✅ **最强** | ⬜ | ⬜ | ⬜ 进度仅系列 |
| **AI 翻译小说（BYOK / 直连）** | ✅ DeepSeek + OpenAI Responses，**不过我们服务器** | ✅ 服务端（订阅） | ⬜ | ✅ OpenAI/Claude/Gemini/DeepSeek **最强** | ✅ 主备服务 | ⬜ | ✅ 服务端（**付费**） | ⬜ | ⬜ |
| **AI 漫画圈选翻译** | ⬜ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ | ⬜ | ⬜ |
| **AI 超分 / cut-out / 本地高清** | ⬜ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ 本机+云端 | ⬜ | ⬜ |
| **以图搜源（SauceNAO 等）** | ⬜ | ✅ | ✅ | ⬜ | ✅ | ⬜ | ✅ | ⬜ | ⬜ |
| **收藏 + 自定义标签 + 改标签** | ✅ | ✅ | ✅ **10+** | ✅ | ✅ | ⬜ | ⬜ | ✅ 10 | ✅ 10 Premium |
| **屏蔽作品 / 标签 / 作者 / 描述 / 追更** | ✅（前 3 项） | ✅ | ✅ | ✅ + 长标签过滤 | ✅ | ✅ **全 5 项** | ⬜ | ✅ | ✅ Premium |
| **多账号切换** | ⬜ | ✅ | ⬜ | ✅ | ⬜ | ⬜ | ✅ | ⬜ | ⬜ |
| **批量下载 + 续传 + 队列** | ✅ | ✅ **最强** + aria2 | ✅ 原图 | ✅ | ✅ | ⬜ | ✅ | ✅ | ⬜ Premium |
| **WebDAV 备份 / 跨设备同步** | ✅（ADR-0156） | ⬜ | ⬜ | ✅ 导入导出 v3 | ✅ pixez 格式 | ✅ | ⬜ | ⬜ | ⬜ |
| **OTA 自建更新** | ✅ Ed25519 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **安全：token 不入 JS heap** | ✅ **Java volatile** | ✅ OkHttp 拦截器 | ⬜ Flutter 内存 | ⬜ Compose 内存 | ⬜ Swift 内存 | ⬜ | ⬜ | ⬜ | — |
| **安全：refresh_token Keystore 加密** | ✅ + 三层备份防御 | ✅ EncryptedSharedPreferences | ⬜ | ✅ MMKV（待确认） | ⬜ | ⬜ | ⬜ | ⬜ | — |
| **网络自检页** | ✅ `/network-check` | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **平板横屏两栏** | ⬜ | ✅ | ⬜ | ✅ | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| **横版 / 桌面端快捷键** | ⬜ | ⬜ | ⬜ | ✅ R / ESC / 方向键 | ⬜ | ⬜ | ⬜ | ✅ | ⬜ |
| **i18n（多语种完整）** | ✅ zh-CN + en（ADR-0157） | ✅ 6 语 | ⬜ 中文为主 | ✅ 多语种 | ✅ i18n 完整 | ✅ | ✅ | ✅ 中文 | ✅ 7 语 |
| **Material 3 / Fluent 2 设计系统** | ✅ Fluent 2 + M3（双） | ✅ M3 | ⬜ Flutter Material | ✅ M3 | ✅ SwiftUI Liquid | ⬜ | ⬜ | ⬜ Avalonia | — |
| **动画 / 缓动严格规范** | ✅ Fluent 4 曲线 + 5 时长 | ✅ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **AI Agent 接入（MCP / API）** | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ✅ MCP server（少见） | ⬜ |
| **AI 作品三态过滤** | ✅ show/mask/only | ✅ 三档（含「只看 AI」） | ⬜ | ✅ | ✅ 四态（含剧透） | ⬜ | ⬜ | ✅ | ⬜ |
| **R18 / R18G 三态过滤** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Premium |
| **工程化：ADR / 双轴 code-review / 突变测试** | ✅ **业界最强梯队**（ADR-0001→0183+，StrykerJS，Robolectric） | ⬜ 公开 ADR 少 | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | — |
| **CI 内单测防线 + T0 门禁** | ✅ `passWithNoTests: false` | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | — |

---

## 5. 优势 / 劣势（按竞品视角归纳）

### 5.1 Pictelio 的**优势 / 差异化点**

1. **架构 + 工程化最深**
   - 双客户端（webview + lynx）共享 Java 模块（`PixivImageLoader` / `SecureStorageCompat` / `NovelExporter` / `WebDavClient`），三 flavor APK（full / webview / lynx）。
   - 113+ 篇 ADR（ADR-0001 → ADR-0183+），且每篇都对应一份 spec / glossary；CI 双轴 code-review + 突变测试 + Robolectric + T0 门禁 + Oracle check。
   - 设计系统**严格执行**（Fluent 2 + M3 双线，tokens / 曲线 / 时长 / 状态全约束）。

2. **安全模型最严**
   - access_token 永不入 JS heap（Java `volatile` 字段 + 401 自动刷新 + Promise 队列）。
   - refresh_token 走 Android Keystore + 备份三层防御（`0003-backup-security-three-layer-defense`）。
   - URL rewrite trusted boundary 防伪后缀域（ADR-0100）；Pixiv 域白名单 + `https:` 强制。

3. **AI 翻译**（核心卖点之一）
   - **BYOK 直连 DeepSeek / OpenAI Responses**，**不过服务器、零额外费用**。
   - 段落 chunked ≤2000 / 并发 worker pool ≤3 / first-screen 优先 / R18 三段门控 / LRU 200 章缓存 / FNV-1a key + spark-md5 source hash 自动 miss / 协议层 keep-alive 抗性。
   - 与 pixiv 翻译（P 站助手服务端付费）、Shaft AI 翻译（订阅）对比：**永久免费 + 用户数据不出设备**。

4. **图像管线**
   - **三层缓存 + 用户可调独立开关 + 50–1000MB 磁盘上限**（ADR-0090）。
   - **4 模式镜像选择**（race / weighted / fastest-ip / single）+ native resolve 透到 Java 下载层（ADR-0143）。
   - **`createProgressiveImage` thumb→full 平滑 + 预取命中跳过 thumb + 12s 超时 + 3 次重试 + URL 锁防并发写**。
   - `shouldInterceptRequest` + 32MB 内存快路径 + `Cache-Control: immutable`。

5. **小说阅读器**（对标「仅次于开源阅读 + Pixiv 书源」）
   - Pretext + 虚拟化 + 章内搜索（高亮 + 跳转）+ 系列导航 + FastScroller + 9 种格式导出。
   - lynx 端 M3 文本选择菜单（ADR-0165），补 pixez iOS 发热痛点。

6. **更新 / 备份**
   - **OTA WebBundle 自建**（Ed25519 + WorkManager 预热 + notifyReady 健康握手 + 原子切换）。
   - **WebDAV 跨设备同步**（设置 / 收藏 / 历史）。

7. **内容过滤**
   - AI 作品**三态**（show / mask / only）+ account-scoped 跨端同步（ADR-0155）。
   - R18/R18G account-scoped（ADR-0103），首启 age gate 已移除避免白屏。

### 5.2 Pictelio 的**劣势 / 缺位**

| 缺位 | 影响 | 行业替代 |
|---|---|---|
| ❌ **iOS / Win / macOS / Linux 客户端** | 国内 iOS 用户只能用 P 站助手 / PiPixiv / Pixiv-SwiftUI；桌面端只能用 Pixeval | PiPixiv 全 5 端、Pixiv-SwiftUI Apple 3 端、Pixeval Win |
| ❌ **国内直连** | 国内用户必须自配代理 | Pixiv-Shaft / PixEz / PiPixiv / Pixiv-SwiftUI / 开源阅读书源 / P站助手 均免代理 |
| ❌ **以图搜源** | 找图源只能去网页 | Shaft / PixEz / P站助手 / SwiftUI |
| ❌ **AI 漫画翻译**（圈选/整页） | 漫画党痛点 | Shaft / P站助手 |
| ❌ **AI 超分 / 本地高清化** | 老图/低清党痛点 | Shaft / P站助手 |
| ❌ **多账号切换** | 多号用户痛点 | Shaft / PiPixiv |
| ❌ **Manga 阅读器**（单独优化） | 漫画党体验 | Shaft（章节优化）、PivisionM（轻量）、官方 |
| ❌ **平板横屏两栏** | iPad / 折叠屏用户 | Shaft / PiPixiv / SwiftUI |
| ❌ **官方 Pixiv 高人气排序**（免费） | 搜索结果不够全 | Shaft 全免费 / PiPixiv 非 Premium 仅单页 |
| ❌ **小说书架 + 离线** | 重度小说党 | 开源阅读 + Pixiv 书源（**业界最强**） |
| ❌ **MCP / AI Agent 接入** | AI 工具链用户 | Pixeval（少见） |
| ❌ **付费 / 商业化路线** | 服务端 AI（漫画翻译、超分）的资本壁垒 | P站助手 / Shaft 走订阅 / 免费额度 |
| ❌ **永久收藏缓存** | 作者删图后无法查看 | Pixiv-SwiftUI（实验性） |

---

## 6. 最终评估与建议

### 6.1 综合评估

Pictelio 在 **爱好者重客户端 + AI 翻译特色** 赛道上占位明确，但 **平台广度 + 国内可达性** 是当前最大的两大缺口。

| 评价维度 | Pictelio 现状 | 评价 |
|---|---|---|
| **功能深度**（浏览 / 阅读 / 翻译 / 缓存 / 下载 / 备份） | 全栈最深梯队 | ⭐⭐⭐⭐⭐ |
| **AI 翻译能力** | BYOK 永久免费 + R18 三段门控 + 缓存智能 | ⭐⭐⭐⭐⭐ |
| **安全 / 工程化** | access_token 隔离 + Keystore + URL trusted boundary + ADR + 突变测试 | ⭐⭐⭐⭐⭐ |
| **设计 / 体验** | Fluent 2 严格执行 + A2 Cardization + 骨架屏 + 拉到底翻页 | ⭐⭐⭐⭐ |
| **平台广度** | Android-only | ⭐⭐ |
| **国内可达性** | 需自配代理 | ⭐⭐ |
| **AI 增值服务**（漫画翻译 / 超分 / 高清化） | 无 | ⭐ |
| **Manga 体验** | 仅图片浏览 | ⭐⭐ |
| **小说体验**（重度党） | 虚拟化好，但**无书架 / 离线 / 繁简转换** | ⭐⭐⭐ |
| **多账号 / 平板 / 桌面快捷键** | 无 | ⭐ |

### 6.2 战略方向（按 ROI 高低排序）

| 优先级 | 方向 | 价值 | 难度 | 风险 |
|---|---|---|---|---|
| **P0** | **iOS 客户端**（lynx 上 iOS 或独立 SwiftUI） | 解锁 Apple 生态 2B+ 用户；PiPixiv/SwiftUI 已证明可行 | 高 | iOS Lynx 不成熟 → 短期 SwiftUI 平行 / 中期 iOS Lynx |
| **P0** | **国内直连方案**（DoH / SNI 镜像 + IP 选优，参考 Shaft / PiPixiv / Pixiv-SwiftUI） | 国内可达性 = 用户基数 | 中 | 持续维护（IP 漂移 + 封锁） |
| **P1** | **以图搜源**（集成 SauceNAO / IQDB 客户端，跳回 Pixiv） | 找图党刚需；Shaft / SwiftUI 已有 | 低 | 第三方服务稳定 |
| **P1** | **小说书架 + 离线 + 进度 + 繁简转换**（参考开源阅读 + Pixiv 书源） | 重度小说党留存；UI 已有 `ReaderSettingsSheet`，扩展即可 | 中 | 书架交互设计需 grill |
| **P2** | **Manga 单独优化**（章节阅读 / 翻页模式 / 进度记忆） | Shaft / 官方 Manga 已证明有空间 | 中 | Manga 与 Illust 数据模型统一 |
| **P2** | **多账号切换** | 多号党刚需 | 中 | token 多实例存储 + UI |
| **P2** | **平板横屏两栏** | iPad / 折叠屏体验升级 | 低 | SideNavShell 已支持改造 |
| **P3** | **AI 漫画圈选翻译** | 漫画党壁垒级功能 | 极高 | 训练成本高 + Pixiv 版权 |
| **P3** | **AI 超分 / 本地高清化** | 老图党壁垒 | 高 | 模型分发 + 设备门槛 |
| **P3** | **官方人气排序（无需 Premium）** | 等同 Pixiv-Shaft 卖点 | 中 | 走 `/v1/search/popular-preview` 但单页限制 |
| **P4** | **MCP / AI Agent 接入** | 桌面端差异化 | 低 | Pixeval 已占位 |
| **P4** | **永久收藏缓存**（防作者删图） | 收藏党刚需 | 中 | SwiftUI 实验性，可参考 |
| **P4** | **商业化路径**（漫画翻译 / 超分 / 加速代理） | 资金回流支撑开发 | 极高 | 服务器成本 + 监管 |

### 6.3 一句话总结

> **Pictelio 在「工程化最严 + 安全模型最强 + BYOK AI 翻译永久免费」的纵深上业界领先，但「平台广度（无 iOS / 桌面）+ 国内可达性」是当前两大硬缺口；建议优先级 = iOS 客户端 > 国内直连 > 以图搜源 > 小说书架 > Manga 体验，并在「小说深度」上明确对标开源阅读 + Pixiv 书源而非重复造轮。**

---

## 7. 调研未覆盖 / 待补

- **iOS 应用商店排名与活跃用户数**（无付费数据，仅定性）。
- **用户调研**：未做实际问卷（建议在下一轮 issue 上挂一份用户调查）。
- **未核验项**：PixEz iOS 发热具体瓶颈（SwiftUI README 提到，但未深入读 pixez-flutter 源码）；开源阅读 + Pixiv 书源实际同步性能。
- **国际化深度**：Pixiv-SwiftUI 列出 i18n 完整（繁中 / 简中 / 日文），需对齐 ADR-0157。
# 核查：Pictelio 双客户端能力清单（一手代码证据）

> 核查日期：2026-09-27
> 核查方式：**不依赖** `docs/research/competitor-features-comparison.md` / `webview-vs-lynx-comparison.md`（2026-09-26 浅读版）的结论，直接读源码：路由表、页面组件、store 清单、Java 层模块、构建 flavor、i18n 词典。
> 证据路径：`packages/app/src/router.tsx`、`packages/app-lynx/src/router.ts`、`packages/app/src/{routes,stores,components}/`、`packages/app-lynx/src/{pages,stores,components,composables,primitives,utils}/`、`packages/app/android/app/src/{main,full,webview,lynx}/java/`、`packages/app/android/app/build.gradle`。
> 定位：本文件是 2026-09-27 竞品对比的**本项目侧事实底座**，供 `competitor-comparison-2026-09.md` 引用。

---

## 0. 两个客户端的客观体量

| 项 | webview（`pictelio-app`） | lynx（`pictelio-app-lynx`） |
|---|---|---|
| 版本 | **6.1.0**（`package.json`） | 0.1.0 |
| 路由数 | 21 条（`router.tsx`） | 24 条（`router.tsx`） |
| 页面组件 | 19 个（`routes/*.tsx`） | 23 个（`pages/*.vue`） |
| store | 31 个 | 17 个 + 2 个纯逻辑（`routerCore`/`globalFab`） |
| 单元测试文件 | 225 | 145 |
| 框架 | SolidJS 2.0 RC + Capacitor 8.5 | vue-lynx + vue-router 5.3 + pinia |
| 设计系统 | Fluent Design 2 | Material 3 |
| APK flavor | `webview` / `full` | `lynx` / `full` |

> 结论修正：`openwiki/quickstart.md` 与 `README.md` 仍写 "5.5.0"，实际 `packages/app/package.json` 已是 **6.1.0**。竞品对比里凡引用"v5.5.0"处应以 6.1.0 为准。
> 另一修正：`AGENTS.md` 写 agent-browser "6 个 spec"，实际 `packages/app/tests/agent-browser/specs/` 有 **13 个** `.test.ts`；android-e2e 20 个（AGENTS.md 写 19）。

---

## 1. 路由级能力差集（最硬的证据）

| 能力 | webview 路由 | lynx 路由 | 归属 |
|---|---|---|---|
| 登录 | `/login` | `/login` | 双 |
| 首页 feed | `/home` | `/recommended` + `/illusts` + `/novels` | 双（lynx 三段式） |
| 插画详情 | `/illust/:id` | `/illust/:id` | 双 |
| 小说详情 | `/novel/:id` | `/novel/:id` + `/novel/:id/intro` | 双（lynx 多一个三段式介绍页） |
| 用户主页 | `/user/:id` | `/user/:id` | 双 |
| 用户作品列表 | `/user/:id/illusts` | — | **webview 独有** |
| 关注/粉丝 | `/user/:id/following`、`/user/:id/followers`、`/my/followers` | `/user/:id/following`、`/user/:id/followers` | 双 |
| 搜索（独立页） | `/search` | —（FAB 弹层 `SearchSheet`） | webview 独立路由，lynx 弹层 |
| 排行榜 | `/ranking` | `/ranking` | 双 |
| 收藏 | —（`/home` 内 panel） | `/bookmarks` | **lynx 独有独立路由** |
| 我的/个人中心 | `/me` | `/me` | 双 |
| **追更（Watchlist）** | — | `/watchlist` | **lynx 独有** |
| **稍后看（Read Later）** | — | `/later` | **lynx 独有** |
| **通知中心** | `/notifications` | `/notifications` | 双 |
| **好P友（MyPixiv）** | — | `/mypixiv` | **lynx 独有** |
| 静音标签 | 内嵌（`MuteTagSheet`） | `/mute-tags` | 双（lynx 独立页） |
| 下载管理 | `/downloads` | `/downloads` | 双 |
| 网络自检 | `/network-check` | `/network-check` | 双 |
| **图片缓存设置** | `/image-cache` | — | **webview 独有** |
| **镜像源设置** | `/image-host` | — | **webview 独有** |
| **客户端切换** | `/client-switch` | — | **webview 独有** |
| About | `/about` | — | **webview 独有** |
| 调试图片 | `/debug` | — | **webview 独有** |
| 滚动恢复确认 | `/scroll-restoration-confirm` | — | **webview 独有** |
| 更新页 | 内嵌（`StartupUpdateDialog`） | `/update` | 双（lynx 独立页） |
| 错误页 | 内嵌 | `/error` | 双 |
| 平台一致性自检 | — | `/platform-check` | **lynx 独有** |

---

## 2. 组件 / 原语级能力差集

| 能力 | webview 证据 | lynx 证据 | 归属 |
|---|---|---|---|
| **小说文本选择菜单** | `textSelection` 匹配 **0 文件** | `createTextSelection.ts` / `useTextSelection.ts` / `lynxSelectionEngine.ts` / `selectionToolbarGeometry.ts`（13 文件） | **lynx 独有** |
| **小说导出（共享 `@pictelio/novel-export`）** | `ExportSheet.tsx` | `NovelExportSheet.vue`（同样 import `NOVEL_EXPORT_FORMATS`） | **双端都有**（修正旧文档"webview 独有"） |
| **用户屏蔽列表（blocklist）** | `blockStore.ts`（`blockUser`/`unblockUser`/`isBlocked`）+ `BlocklistSheet.tsx` + i18n `blocklist.*` | **源码明写"lynx 无屏蔽列表能力"**：`relatedInjection.ts:6`、`backupWiring.ts:53`「app-lynx 暂无屏蔽/举报 store」 | **webview 独有**（修正旧文档"双端都有"） |
| 三层缓存设置 UI | `ImageCacheSettings.tsx`（14 文件命中） | `imageCache` 匹配 **0 文件** | **webview 独有** |
| 镜像 4 模式设置 UI | `ImageHostSettings.tsx`（14 文件命中） | 4 文件命中（部分） | webview 完整 |
| 三次级布局（瀑布/单列/网格） | `GridCard` / `VirtualFeed` | 仅单列 | **webview 独有** |
| 小说虚拟化 + Pretext | `createNovelVirtualLayout.ts` + `createNovelTextLayout.ts` + `isPretextSupported.ts` | 章节分段渲染（无 Pretext） | webview 更深 |
| 章内搜索（高亮+跳转） | `NovelSearchBar.tsx` | — | **webview 独有** |
| 快速滚动条 | `createFastScrollbar` | `ScrollIndicator.vue` | 双（实现不同） |
| 评论 | `CommentList/Input/Overlay`（8 文件） | `useComments.ts` + `CommentOverlay/Item/InputBar`（32 文件） | 双（lynx 更重） |
| 相关作品注入 | `relatedInjectionStore.ts` | `relatedInjection.ts` | 双 |
| ugoira | `UgoiraViewer.tsx` + `streamUgoiraFrames`（27 文件） | `api/ugoira.ts` + `UgoiraStreamEngine.java` + `buildUgoiraTask`（40 文件） | 双（双轨流式） |
| 下拉刷新 | `PullIndicator.tsx` | `RefreshableList.vue` | 双 |
| FAB / 全局浮动操作 | — | `GlobalFab.vue` / `createGlobalFab` / `createFabMenu` | **lynx 独有** |
| 骨架屏 | `SkeletonCard` / `SkeletonShimmer` | `CarouselSkeleton` / `SkeletonCard` | 双 |
| 分享 | `downloadSharer.ts` | `lynxShare.ts` | 双 |

---

## 3. Java 原生层：共享 vs 各自

**共享（`src/main/java`）** — 双端共用同一批 deep module：
`PixivImageLoader`（图像加载/磁盘缓存/OkHttp 池/按 URL 加锁）、`ImageHostConfig`（镜像解析）、`ImageMemoryCache` + `LruCache`、`SecureStorageCompat`（Keystore）、`BackupCrypto`（备份加密）、`WebDavClient`、`PictelioDownloader`、`GallerySaver`、`UgoiraExporter` + `GifEncoder` + `WebpEncoder` + `Mp4Encoder`、`NovelExporter` + `Novel{Epub,Pdf,Docx}Encoder`、`TranslationSseParser`、`NetDiagProbe`、`OAuthUtils`、`ShareHelper`、`SplashController`、`EngineFallbackNotice`、`engine/*`（`EngineRouting`/`EngineProbe`/`EngineState`/`EnginePrefs`/`WebViewAvailability`）。

**webview flavor 独有（`src/webview/java`）**：
`PixivApiPlugin`、`AuthPlugin`、`OAuthPlugin`、`ImageCachePlugin`、`ImageIntercept`（WebView `shouldInterceptRequest`）、`ImageBytesMemoryCache`、`GallerySaverPlugin`、`PictelioDownloaderPlugin`、`PictelioSharePlugin`、`NetDiagPlugin`、`WebDavPlugin`、`ClientInfoPlugin`、**`OtaPlugin` + `OtaInstaller` + `OtaSignatureVerifier` + `OtaWorker`**（Ed25519 OTA 自建更新）。

**lynx flavor 独有（`src/lynx/java`）**：
`LynxActivity` + `LynxProbe` + `LynxRuntimeInitializer`、`PictelioApiModule` / `PictelioAuthModule` / `PictelioPrefsModule` / `PictelioSecureStorageModule` / `PictelioGalleryModule` / `PictelioDownloaderModule` / `PictelioShareModule` / `PictelioClipboardModule` / `PictelioTranslateModule` / `PictelioTranslateCacheModule` / `PictelioWebDavModule` / `PictelioImageService` / `PictelioAppModule` / `NetDiagModule`、**`UgoiraStreamEngine`**。

> 结构性结论：**LynxView 没有 `shouldInterceptRequest`**，所以 webview 的图片拦截快路径（32MB 内存直返 + `Cache-Control: immutable`）在 lynx 端不存在——lynx 走 `PictelioImageService`（`ILynxImageService` + 自有 loader），共享磁盘 L3 但丢失 WebView 拦截层。OTA 的 Ed25519 签名校验只实现在 webview flavor，lynx 端更新走 `@pictelio/update-check` 共享逻辑但无 Java 侧签名验证类。

---

## 4. 引擎决策（ADR-0164）——竞品普遍没有的一层

`EngineRouting.resolve()` 是**唯一**决策源（`PictelioApp` 预热与 `MainActivity` 路由共用），规则：

- 缺省引擎 = **Lynx**（`pictelio_client_kind` 缺省语义）
- WebView 门槛 = Chrome **85**（`OAuthConfig.MIN_WEBVIEW_VERSION`），探测不到版本号时 **fail-open 放行**
- Lynx 门槛 = `LynxRuntimeInitializer.isAvailable()`（含包能力 + 初始化不抛 + native lib 已加载）
- **双向降级**：首选 Lynx 预检失败 → 本次走 WebView（写生效快照，**不改首选**）；首选 WebView 但版本过低且 Lynx 可用 → 本次走 Lynx
- 运行时硬错误（bundle 加载失败 / 9902·990200 / InstantiationException）→ 自动回退 WebView 一次并写**失败记忆**（versionCode 精确匹配，升级自动遗忘）
- **10s 加载超时不自动跳**（转手动错误页）
- 无障碍服务启用 ∧ 双引擎可用 → 以 WebView 生效
- 双失败 → 静态 `res/raw/upgrade.html`（零外部资源，兼容 Chrome 30+）

> 竞品对照：Pixiv-Shaft / PixEz / Pixiv-MultiPlatform 都是**原生 Android 或 Flutter**，没有"渲染引擎"这一层，因此也没有引擎降级问题；但反过来说，**Pictelio 是本轮调研中唯一把"渲染引擎可用性"做成产品级显式能力**的。代价是双客户端功能不对齐（见 §1/§2）。

---

## 5. 工程化硬指标（2026-09-27 实测）

| 指标 | 数值 | 取数命令 |
|---|---|---|
| ADR | **175** 篇 | `ls docs/adr/ADR-*.md \| wc -l` |
| spec / 设计文档 | **93** 篇 | `ls docs/specs/*.md docs/spec/*.md \| wc -l` |
| webview 单测文件 | **225** | `find packages/app/tests -name '*.test.ts*'` |
| lynx 单测文件 | **145** | `find packages/app-lynx/src -name '*.test.ts'` |
| agent-browser E2E spec | **13** | `packages/app/tests/agent-browser/specs/*.test.ts` |
| android-e2e spec | **20** | `packages/app/tests/android-e2e/specs/` |
| APK flavor | **3**（full / webview / lynx） | `build.gradle` |
| Java 原生类 | 32（main）+ 1（full）+ 21（webview）+ 18（lynx） | `find app/src -name '*.java'` |
| CodeGraph 索引 | 1,262 文件 / 17,071 节点 / 55,573 边 | `codegraph status` |

---

## 6. 对既有文档的两处事实纠正

1. **旧文档称"小说导出 9 种格式 = webview 独有"** → **错**。`packages/app-lynx/src/components/NovelExportSheet.vue` 与 webview 的 `ExportSheet.tsx` **共用同一个 `@pictelio/novel-export` 包**，双端都支持 9 格式。
2. **旧文档称"屏蔽作品/标签/作者 双端都有"** → **错**。lynx 源码两处显式自述无此能力：
   - `packages/app-lynx/src/stores/relatedInjection.ts:6`：「…`isTagMuted`（静音标签，ADR-0187 / #732；**lynx 无屏蔽列表能力**）」
   - `packages/app-lynx/src/services/backupWiring.ts:53`：「**app-lynx 暂无屏蔽/举报 store**（spec §3.1 sets 为空对象）」
   实际形态：webview 有完整 `blockStore` + `BlocklistSheet` + `illustMenu.blockAuthor`；lynx 仅有**静音标签**（`MuteTags.vue` + `muteTagStore`），语义不同（静音 = feed 内隐藏标签，非屏蔽作者）。
3. 附带纠正：`AGENTS.md` 记 agent-browser "6 个 spec"、android-e2e "19 个 spec"，实测为 **13 / 20**。

---

## 7. 竞品对比时应重点对照的 6 个维度（基于本项目侧证据得出）

1. **可及性**：竞品普遍"国内直连免代理"，Pictelio 必配代理（`127.0.0.1:7897` 回退）——最大单项缺口。
2. **平台广度**：Pictelio 仅 Android（lynx 与 webview 是同一 APK 的两个 flavor，不是两个平台）。PiPixiv 五端、Pixiv-SwiftUI Apple 三端、Pixeval Win。
3. **多账号**：双端均无（`multiAccount|accountSwitch` 全库 0 命中）。Shaft / PiPixiv / P站助手 有。
4. **以图搜源**：双端均无。Shaft / PixEz / P站助手 / Pixiv-SwiftUI 有。
5. **AI 增值**：双端都只有**小说 AI 翻译**（webview→DeepSeek，lynx→OpenAI Responses，两套独立实现零共享）。Shaft 有超分 + cut-out + 漫画圈选翻译 + RIFE 插帧；P站助手有服务端高清化 + 漫画翻译；PiPixiv 翻译调度最完整。
6. **小说书架 / 离线 / 繁简**：双端均无书架。开源阅读 + Pixiv 书源在此维度是公认最强。

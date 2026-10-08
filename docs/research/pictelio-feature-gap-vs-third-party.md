# Pictelio 功能差距调研：对比主流第三方 Pixiv 客户端

> 调研日期：2026-09-09
> 调研对象：Pictelio（本仓库 `feat/solidjs-2-migration` 分支）vs 7 个活跃第三方 Pixiv 客户端 + Pixiv 官方 App（基线）
> 调研方式：Pictelio 侧以 OpenWiki（`openwiki/quickstart.md`、`openwiki/domain/feed-and-browsing.md`、`openwiki/domain/novel-reader.md`、`openwiki/architecture/overview.md`）+ 源码目录列举交叉核对；竞品侧全部落到一手来源（GitHub 仓库 README / FAQ / l10n 资源 / 源码目录结构，经 `gh api` 直读），不依赖二手文章
> 客户端清单来源：本仓库 2026-09-08 直连调研 `docs/research/pixiv-third-party-clients-direct-access.md`（该文件已被 revert 提交从工作区移除，经 `git show 883207c1:docs/research/pixiv-third-party-clients-direct-access.md` 取回），再用 GitHub `topic:pixiv` 搜索扩充
> 澄清：任务给定清单中的 `perded/pixez` 实际不存在（GitHub 404）；PixEz 的真实仓库为 **Notsfsssf/pixez-flutter**（作者 Perol_Notsfsssf），旧原生版为 Notsfsssf/Pix-EzViewer（已停维护，由 ultranity 续维护后亦转向 Flutter 版，见 [pixez FAQ](https://github.com/Notsfsssf/pixez-flutter/blob/master/.github/FAQ.md)）

---

## TL;DR：最重要的 8 个差距

1. **完全没有作品下载能力（P0）**——单图保存、多图选页、批量下载均缺失。这是全部 7 个竞品无一例外的标配，也是用户留在竞品的首要理由（pixez 长按下载、Shaft 批量+断点续传+aria2、Pixeval 下载管理器+宏命名、PBD 整个产品即下载器）。
2. **动图（ugoira）不能导出（P0）**——Pictelio 只能在线流式播放；竞品普遍支持导出 GIF/MP4/WebP/APNG 甚至原 ZIP（pixiv-viewer 支持 6 种格式）。
3. **没有排行榜（P0）**——日/周/月/男性/女性/新人/R18/AI 及按日期回看全部缺失。6/7 竞品有排行榜，Pixiv-Shaft 更是做成了"榜单中心"。
4. **搜索只有关键词+排序（P0）**——缺收藏数区间、投稿期间、宽高比/分辨率、AI 作品三态（显示/隐藏/仅看）等高级筛选；5/7 竞品具备其中两项以上。
5. **没有以图搜图（P1）**——SauceNAO/Ascii2D/IQDB/TinEye 一键反查，5/7 竞品内置。
6. **过滤体系只有"屏蔽用户 + R18"（P1）**——缺标签级屏蔽/静音、AI 作品过滤、单作品就地模糊；pixez（mute_store）、Shaft（按标签/作者分别静音）、pixiv-viewer（标签/用户黑名单）都有。
7. **收藏体系偏浅（P1）**——收藏时不能加标签、不能批量整理收藏夹；pixez 有 book_tag_store，PBD 支持"给未分类收藏补标签"。
8. **小说无导出（P1）**——正文已结构化（`parseNovelBlocks`）但导出 TXT/EPUB 缺失；Shaft 收藏即存整本 TXT，pixiv-viewer 支持 TXT/HTML/MD/DOC/PDF/EPUB。

次级差距：多账号切换、稍后看、相关作品、特辑/Spotlight/PixiVision、全站最新作品、多语言、平板双栏、私信（DM，仅 Shaft）、FANBOX/COMIC（仅 Shaft）。

---

## 一、竞品概览

| 竞品 | 仓库 | 技术栈 | 活跃度（2026-09 实测） | 定位 |
|------|------|--------|------------------------|------|
| **PixEz** | [Notsfsssf/pixez-flutter](https://github.com/Notsfsssf/pixez-flutter) | Flutter（Android/iOS/Windows） | ★12,800，最近提交 2026-09-07，未归档 | 最流行的全平台第三方客户端，免代理直连 |
| **PixShaft（Shaft）** | [CeuiLiSA/Pixiv-Shaft](https://github.com/CeuiLiSA/Pixiv-Shaft) | Kotlin（Android 原生，Material You） | ★7,791，最近提交 2026-09-08，Google Play 在架 | 功能最全的 Android 原生客户端（含 FANBOX/COMIC/私信） |
| **Pixeval** | [Pixeval/Pixeval](https://github.com/Pixeval/Pixeval) | C# / .NET Avalonia（Win/macOS/Linux/Android/iOS） | ★3,135，最近提交 2026-09-05，Homebrew/MS Store 分发 | 桌面级强力客户端，批量下载与宏命名见长 |
| **Powerful Pixiv Downloader（PBD）** | [xuejianxianzun/PixivBatchDownloader](https://github.com/xuejianxianzun/PixivBatchDownloader) | TypeScript 浏览器扩展 | ★5,589，最近提交 2026-09-07，Chrome/Firefox 商店在架 | 网页端批量下载/过滤/重命名增强器（下载维度标杆） |
| **Pixiv Viewer Kai** | [asadahimeka/pixiv-viewer-app](https://github.com/asadahimeka/pixiv-viewer-app)（Web 版 [pixiv-viewer](https://github.com/asadahimeka/pixiv-viewer) ★765，2026-09-05 仍在提交） | Vue + Capacitor/Tauri/Electron 多端 | ★533（app 版），最近提交 2026-05-01 | **与 Pictelio 技术路线最接近**（Web 技术栈 + Capacitor 打包 Android） |
| **Pix-EzViewer（续维护版）** | [ultranity/Pix-EzViewer](https://github.com/ultranity/Pix-EzViewer) | Kotlin + Jetpack | ★1,251，最近提交 2026-07-04 | 旧原生版 PixEz 的增强续维护 |
| **PixivBiu** | [txperl/PixivBiu](https://github.com/txperl/PixivBiu) | Go + Web UI（自托管/Docker） | ★1,447，最近提交 2026-09-09 | 浏览+筛选+下载的自托管辅助工具 |
| Pixiv 官方 App（基线） | [pixiv.net](https://www.pixiv.net/)（App Store/Google Play 在架） | 闭源 | 持续更新 | 排行榜、私信、推送通知、小说/漫画等全功能基线（能力项交叉自竞品 README 定位描述） |

活跃度数据来自 `gh api repos/<owner>/<repo>` 的 `stargazers_count` / `pushed_at` / `archived` 字段（2026-09-09 查询）。

---

## 二、Pictelio 现有功能盘点（主源=本仓库）

| 功能域 | 现状 | 出处 |
|--------|------|------|
| 首页 Feed：推荐（混合/插画/漫画子 tab）/关注（all/public/private）/收藏/历史 四 tab × 插画/小说 | ✅ | `openwiki/domain/feed-and-browsing.md`；`packages/app/src/components/home/SideNavShell.tsx`；六个 feed store（`recommendedStore`/`followStore`/`bookmarkStore`/`novelRecommendedStore`/`novelFollowStore`/`novelBookmarkStore`） |
| 下拉刷新、无限滚动分页、分页失败内联重试、Feed 冷启动持久化 | ✅ | ADR-0076/0078/0082；`api/feedQueryPersist.ts`（feed-and-browsing.md「Feed Query Persistence」节） |
| 虚拟滚动（TanStack solid-virtual）、三种次级布局（瀑布/单列/网格，仅用户作品页） | ✅ | ADR-0096；`primitives/createFeedVirtualizer.ts`、`components/VirtualFeed.tsx` |
| 搜索：作品/用户/小说，排序（最新/最旧/热门，热门走 popular-preview 免 Premium）、标签自动补全（`/v1/search/autocomplete`）、搜索历史（可清空）、热门排序路由 | ✅ | `packages/app/src/routes/Search.tsx`（第 58 行起 local state：search history/autocomplete/type filter；383-473 行历史子组件）；`packages/app/src/api/search.ts`（第 84 行 autocomplete 端点；第 23-57 行参数仅 `word/search_target/sort/filter`） |
| 作品详情：多页浏览、大图查看、ugoira 流式播放（首帧≈2% 下载量）、作品类型角标 | ✅ | `routes/IllustDetail.tsx`、`components/UgoiraViewer.tsx`；ADR-0127/0128；ADR-0113 |
| 评论：查看（含楼层回复 `/v2/*/comment/replies`）/发送/删除 | ✅ | `packages/app/src/api/comment.ts`（第 15-16 行 replies 端点）；`components/CommentOverlay.tsx`/`CommentList.tsx`/`CommentInput.tsx` |
| 收藏：插画收藏（public/private restrict 子 tab）、乐观更新、爱心动效；小说收藏 | ✅（但无收藏加标签） | `stores/bookmarkStore.ts`（第 9 行 restrict 信号）；`api/illust.ts`（第 323 行 `addBookmark(illustId, restrict)`——无 tags 参数）；`components/HeartBurstEffect.tsx` |
| 小说阅读器：虚拟化排版（pretext）、文内搜索高亮、阅读进度、阅读设置（字号/字重/字体/行高/自动字号）、FastScroller、系列 Sheet 导航（邻章预取）、小说评论、AI 翻译（BYOK DeepSeek 分块流水线+LRU 缓存+断点续翻+R18 分级门控） | ✅ | `openwiki/domain/novel-reader.md`（全篇）；`routes/NovelDetail.tsx`、`components/SeriesSheet.tsx`、`api/translate.ts`、`primitives/createNovelTranslator.ts` |
| 用户：主页/作品列表/关注取关（乐观回滚）/关注列表/粉丝列表 | ✅ | `routes/PersonalCenter.tsx`/`UserIllusts.tsx`/`FollowListPage.tsx`；feed-and-browsing.md「User Pages」节 |
| 浏览历史：TanStack DB 本地持久化、用户隔离复合键、30 天惰性过期、作者跳转 | ✅ | ADR-0094；`stores/historyStore.ts` |
| 屏蔽用户/举报作品（持久化）；R18/R18G 分级过滤（账号级） | ✅（无标签屏蔽） | `stores/blockStore.ts`/`reportStore.ts`；`components/BlocklistSheet.tsx`/`ReportSheet.tsx`/`IllustActionMenu.tsx`；`utils/r18Filter.ts` + ADR-0103 |
| 图片托管镜像（race/weighted/fastest-ip/single 四模式，下载源下沉 Java，缓存键恒官方） | ✅ | ADR-0143；`stores/imageHostStore.ts`（第 4 行 `ImageHostMode`）、`routes/ImageHostSettings.tsx` |
| 图片三层缓存控制（磁盘开关/浏览器缓存头/后台预取+磁盘上限滑条） | ✅ | ADR-0090；`routes/ImageCacheSettings.tsx` |
| 主题（亮/暗/跟随系统）；Fluent Design 2 设计系统 | ✅ | `stores/themeStore.ts`、`components/ThemeSelector.tsx`；`openwiki/architecture/overview.md`「Design System」 |
| 更新：启动检查软更新弹窗 + APK 更新 + L1 Web Bundle OTA（Ed25519 签名/回滚/minWebVersion 地板） | ✅ | ADR-0089/0122；`services/updateService.ts`、`services/otaService.ts` |
| 双渲染引擎（WebView SolidJS + Lynx vue-lynx 双客户端、引擎切换） | ✅ | `openwiki/architecture/overview.md`「app-lynx」；ADR-0062/0064；`routes/ClientSwitch.tsx` |
| 设置系统（8 卡片分组：账号/外观/内容/图片/翻译/引擎/更新与关于） | ✅ | ADR-0130；`routes/Settings.tsx`、`components/settings/*` |
| **下载（保存到相册/导出文件）** | ❌ | 全仓库无用户级下载功能：`grep download` 仅命中 `IllustDetail.tsx` 第 10 行内部 ugoira 帧获取（`downloadAndExtractUgoira` 为播放流水线，非保存） |
| **排行榜 / 特辑 Spotlight / PixiVision / 全站最新** | ❌ | `grep 排行\|ranking\|spotlight\|特辑` 在 `packages/app/src/` 无命中；路由表（`src/router.tsx` + AGENTS.md）无对应路由 |
| **相关作品** | ❌ | `grep related` 在 `api/`、`IllustDetail.tsx` 无命中 |
| **多账号 / 多语言 i18n / 小说导出 / 稍后看 / 以图搜图 / 好P友 / 标签屏蔽 / AI 作品过滤 / 平板双栏** | ❌ | 无 `locales/` 目录且 `package.json` 无 i18n 依赖；`api/search.ts` 无高级筛选参数；`api/illust.ts` 的 `addBookmark` 无 tags；`types.ts` 仅存 `total_mypixiv_users` 计数字段而无列表 API；`grep 多账号\|switchAccount` 无命中 |

---

## 三、功能对比矩阵

图例：✅ 完整具备｜⚠️ 部分/有限｜❌ 缺失｜➖ 未确认/不适用。**Pictelio 列的出处见第二节表格**；竞品列证据见「引用来源」节（行内简注）。

### 3.1 浏览 / Feed

| 能力 | Pictelio | pixez-flutter | PixShaft | Pixeval | pixiv-viewer | Pix-EzViewer | PixivBiu | PBD |
|------|----------|---------------|----------|---------|--------------|--------------|----------|-----|
| 推荐流 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ➖ |
| 关注新作品 | ✅ | ✅ | ✅ | ✅ WorkFollowingPage | ✅ | ✅ | ✅ | ✅ 可下载 |
| 排行榜（多种类+按日期回看） | ❌ | ✅ l10n「rank: 排行」 | ✅ 日期选择器+榜单中心 | ✅ WorkRankingPage | ✅ 含 R18/AI/历史榜 | ✅ | ✅ | ✅ 可下载 |
| 榜单中心（收藏榜/AI 榜/年代榜/壁纸榜等） | ❌ | ➖ | ✅ Discover 榜单 hub | ➖ | ➖ | ➖ | ➖ | ➖ |
| 全站最新作品（大家的新作品） | ❌ | ➖ | ✅ Discover newest uploads | ➖ | ✅ Latest site-wide uploads | ➖ | ➖ | ➖ |
| 特辑/Spotlight/PixiVision | ❌ | ✅ spotlight/vision 页 | ✅ PixiVision+专栏 | ✅ SpotlightPage | ✅ official specials | ✅ 特辑 | ❌ | ➖ |

### 3.2 搜索

| 能力 | Pictelio | pixez | Shaft | Pixeval | pixiv-viewer | Pix-EzViewer | PixivBiu | PBD |
|------|----------|-------|-------|---------|--------------|--------------|----------|-----|
| 关键词+分类（作品/用户/小说） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ➖ |
| 标签自动补全/翻译 | ✅ autocomplete API | ➖ | ✅ 高级标签搜索 | ✅ SearchCompletionItem | ✅ 热门词联想 | ➖ | ➖ | ➖ |
| 高级筛选（收藏数/期间/比例/分辨率） | ❌ 仅 word/target/sort | ➖ | ✅ 收藏数区间+期间+比例+分辨率 | ✅ Illustration/NovelSearchOptionsPage | ✅ 收藏数+时间 | ➖ | ✅ 收藏数/浏览量/标签/类型 | ✅ 多维过滤 |
| AI 作品三态过滤（显示/隐藏/仅看） | ❌ | ➖ | ✅ three-way AI switch | ➖ | ✅ AI 显示开关+AI 榜 | ➖ | ➖ | ➖ |
| 搜索历史 | ✅ Search.tsx | ✅ tag_history_store | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| 以图搜图 | ❌ | ✅ saucenao 页 | ✅ SauceNAO/TinEye/IQDB/Ascii2D | ✅ SauceNaoSearchPage | ✅ SauceNAO | ✅ sauceNAO | ❌ | ❌ |
| 热门排序免 Premium | ✅ popular-preview | ➖ | ✅ | ➖ | ✅ 前 30 预览 | ➖ | ➖ | ➖ |

### 3.3 作品详情

| 能力 | Pictelio | pixez | Shaft | Pixeval | pixiv-viewer | Pix-EzViewer | PixivBiu | PBD |
|------|----------|-------|-------|---------|--------------|--------------|----------|-----|
| 多页浏览 | ✅ | ✅ | ✅ 折叠+阅读器 | ✅ | ✅ | ✅ | ✅ | ✅ 内置查看器 |
| Ugoira 播放 | ✅ 流式（首帧≈2% 下载） | ✅ CustomPainter | ✅ 插值补帧 | ✅ | ✅ | ✅ | ✅ | ➖ 预览 |
| Ugoira 导出保存 | ❌ | ✅ 长按合成动图 | ✅ GIF/MP4 | ✅ UgoiraDownloadFormat 可选 | ✅ ZIP/GIF/WebM/APNG/MP4/AVIF | ✅ GIF 保存 | ✅ webp/gif | ✅ WebP/WebM/GIF/APNG |
| 相关作品推荐 | ❌ | ➖ | ⚠️ 小说阅读混入相关插画 | ✅ WorkRelatedPage | ➖ | ➖ | ➖ | ➖ |
| 评论查看/发送/删除（含回复） | ✅ | ✅ | ✅ 浮动胶囊 | ✅ Comment 页 | ✅ 查看 | ✅ 增删回复 | ➖ | ➖ |
| 收藏（公开/私密） | ✅ restrict 子 tab | ✅ | ✅ | ✅ | ✅ | ✅ 自动私密收藏 | ✅ | ✅ 批量收藏 |
| 收藏时加标签/收藏夹整理 | ❌ | ✅ book_tag_store | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ 未分类补标签 |

### 3.4 小说

| 能力 | Pictelio | pixez | Shaft | Pixeval | pixiv-viewer | Pix-EzViewer | PixivBiu | PBD |
|------|----------|-------|-------|---------|--------------|--------------|----------|-----|
| 阅读器（排版/进度/设置） | ✅ 虚拟化+pretext | ✅ | ✅ 进度百分比+夜间 | ✅ | ✅ 字体/颜色/方向 | ➖ | ✅ | ➖ |
| 系列连载导航 | ✅ SeriesSheet+预取 | ✅ series 页 | ✅ 漫画+小说系列 | ✅ SeriesPage | ✅ | ➖ | ✅ | ➖ |
| 小说评论 | ✅ | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| 小说导出 TXT/EPUB | ❌ | ➖ | ✅ 收藏即存整本 TXT | ✅ NovelDownloadFormat | ✅ TXT/HTML/MD/DOC/PDF/EPUB | ➖ | ➖ | ✅ TXT/EPUB |
| 本地 TXT 阅读 | ❌ | ➖ | ✅ 指向文件夹读本地 txt | ➖ | ➖ | ➖ | ➖ | ➖ |
| AI 翻译 | ✅ BYOK DeepSeek 分块+缓存+R18 门控 | ➖ | ✅ 漫画整系列翻译 | ➖ | ✅ 在线翻译+漫画 ONNX 本地翻译 | ✅ 谷歌翻译（需装 app） | ➖ | ➖ |

### 3.5 用户 / 个人数据

| 能力 | Pictelio | pixez | Shaft | Pixeval | pixiv-viewer | Pix-EzViewer | PixivBiu | PBD |
|------|----------|-------|-------|---------|--------------|--------------|----------|-----|
| 用户主页/作品列表 | ✅ | ✅ | ✅ 作品墙+高级标签搜索 | ✅ | ✅ | ✅ | ✅ | ➖ |
| 关注/取关 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 高亮已关注 |
| 关注/粉丝列表 | ✅ | ✅ | ✅ | ✅ UserFollowingPage | ✅ | ✅ | ✅ | ➖ |
| 好P友（mypixivists） | ❌ 仅计数字段 | ➖ | ✅ | ✅ WorkMyPixivPage | ➖ | ➖ | ➖ | ➖ |
| 我的收藏（公开/非公开） | ✅ | ✅ | ✅ | ✅ WorkBookmarksPage | ✅ | ✅ | ✅ | ✅ |
| 多账号切换 | ❌ | ✅ account_store | ✅ 快速切换 | ➖ | ➖ | ✅ 多用户 | ➖ | ➖ |
| 私信（DM） | ❌ | ➖ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |

### 3.6 下载（最大差距域）

| 能力 | Pictelio | pixez | Shaft | Pixeval | pixiv-viewer | Pix-EzViewer | PixivBiu | PBD |
|------|----------|-------|-------|---------|--------------|--------------|----------|-----|
| 单图保存 | ❌ | ✅ 长按下载 | ✅ | ✅ | ✅ 长按下载 | ✅ | ✅ 原图 | ✅ 一键 |
| 多图整组/选页下载 | ❌ | ✅ 长按全部 P/手动选 P | ✅ 整组入队 | ✅ | ✅ | ✅ | ✅ | ✅ 多选 |
| 批量下载（用户/收藏/搜索/榜单维度） | ❌ | ⚠️ 逐作品 | ✅ 批量+断点续传 | ✅ 下载管理器 | ⚠️ 逐作品 | ✅ 批量 | ✅ | ✅ 全维度批量+定时爬取 |
| 下载队列/进度/记录 | ❌ | ⚠️ | ✅ 队列管理页 | ✅ Download 页 | ➖ | ✅ 下载记录 | ➖ | ✅ 断点+历史去重 |
| 自定义命名模板/按作者建目录 | ❌ | ✅ 保存格式参数 | ✅ 命名模板+批量重命名 | ✅ DownloadPathMacro 宏 | ✅ 文件名模板+按作者整理 | ✅ 多种命名+本地 pid 重命名 | ➖ | ✅ 文件夹规则+重命名 |
| aria2/NAS 远程下载 | ❌ | ➖ | ✅ | ➖ | ➖ | ✅ aria2 加速 | ➖ | ➖ |
| 说明文字（caption）导出 | ❌ | ➖ | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |

### 3.7 本地 / 其他

| 能力 | Pictelio | pixez | Shaft | Pixeval | pixiv-viewer | Pix-EzViewer | PixivBiu | PBD |
|------|----------|-------|-------|---------|--------------|--------------|----------|-----|
| 浏览历史 | ✅ 30 天 TanStack DB | ✅ | ✅ | ✅ HistoryPage | ⚠️ 含在备份里 | ✅ | ➖ | ➖ |
| 稍后看（本地收藏队列） | ❌ | ✅ watchlist 页 | ✅ 长按稍后看 | ➖ | ➖ | ➖ | ➖ | ➖ |
| 离线/冷启动快照 | ⚠️ Feed 查询持久化+图片三层缓存 | ➖ | ✅ 本地快照秒开+离线操作队列 | ➖ | ➖ IndexedDB 缓存 | ➖ | ➖ | ➖ |
| 图片代理/镜像设置 | ✅ imageHost 四模式 | ✅ pictureSource | ✅ pixiv.cat/re/nl+自建反代 | ⚠️ 域前置+镜像 host | ✅ 镜像/后端实例切换 | ✅ bypass 规则 | ✅ 代理 env | ➖ |
| 亮暗主题/自定义主色 | ✅ 亮/暗/跟随 | ✅ | ✅ Material You+主色 | ✅ | ✅ 暗色+主题色 | ✅ M2/M3+自定义主题 | ✅ | ➖ |
| R18 分级过滤 | ✅ R18/R18G 账号级 | ✅ | ✅ | ➖ | ✅ | ➖ | ➖ | ➖ |
| 屏蔽用户 | ✅ blockStore | ✅ shield 页 | ✅ 按作者静音 | ✅ BlockedUsers 设置 | ✅ 黑名单 | ➖ | ➖ | ➖ |
| 标签屏蔽/静音 | ❌ | ✅ mute_store | ✅ 按标签静音+单作模糊 | ➖ | ✅ 标签黑名单 | ➖ | ➖ | ➖ |
| 应用内更新 | ✅ APK+Web Bundle OTA | ✅ 版本更新信息 | ✅ | ✅ | ⚠️ PWA | ✅ | ✅ | ✅ 扩展自动更新 |
| 多语言 | ❌ 仅中文 UI | ✅ 多语言 l10n | ✅ en/zh/ja | ✅ zh/en/fr/ru | ✅ 简繁/英/俄 | ➖ | ✅ 5 语言 | ✅ 6 语言 |
| 平板/横屏双栏 | ❌ | ➖ | ✅ 平板 two-pane | ✅ 桌面多窗 | ➖ | ✅ 横竖屏自适应+导航栏位置 | ➖ | ➖ |
| 网络自检工具 | ➖（有 `/debug` DebugImage） | ✅ 直连设置 | ✅ 网络自检页（DNS/API/图片逐项） | ✅ 域前置设置+IP 表 | ✅ 直连模式 | ✅ SNI bypass | ✅ 代理配置 | ➖ |
| AI 增强（超分/补帧/抠图） | ❌ | ➖ | ✅ 超分/漫画翻译/ugoira 补帧/抠图 | ➖ | ✅ 漫画翻译（ONNX WebGPU 本地推理） | ➖ | ➖ | ➖ |
| 注册账号（应用内） | ❌ | ✅「没有账号？」流程 | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| 备份/云同步（设置+历史） | ❌ | ➖ | ➖ | ➖ | ✅ 加密云同步+冲突合并 | ➖ | ➖ | ➖ |
| FANBOX / pixiv COMIC | ❌ | ➖ | ✅ 原生 FANBOX+COMIC | ➖ | ➖ | ➖ | ➖ | ➖（有 Fanbox 下载器姊妹项目） |

---

## 四、差距清单（按优先级）

> 分级标准：**P0** = 多数竞品都有且用户价值高；**P1** = 重要但非独有刚需；**P2** = 锦上添花；**P3** = 仅个别竞品有。
> 项目约束提醒：①Fluent Design 2 令牌/动效硬约束；②网络层已回归官方域基线（直连/反代路线已移除，图片镜像 `imageHostStore` 四模式仍保留）；③Capacitor + Lynx 双引擎——新功能须明确双端范围（参考 issue #60 搁置教训：设置分组扩展/举报/小说分段渲染已挂起待独立立项）；④「图片二进制零进 JS 堆」架构（ADR-0037）。

### P0

#### P0-1 作品下载（单图保存 + 多图选页 + 批量）
- **竞品证据**：7/7 全覆盖。pixez「长按插画自动下载所有分 P；详情页长按可手动选择分 P」（[FAQ.md 下载图片节](https://github.com/Notsfsssf/pixez-flutter/blob/master/.github/FAQ.md)）；Shaft「queue a whole set at once…batch-rename with naming templates」（README）；Pixeval `Models/Download/IllustrationDownloadTaskFactory.cs` + `DownloadPathMacroParser.cs`；PixivBiu「原图下载，包括单图、多图、动图」（README）；PBD 整个产品即批量下载器。
- **对 Pictelio 的落地考量**：下载管线应完全沉到 Java 侧——`PixivApiPlugin.prefetchImage()` 已具备「URL→磁盘」能力（ADR-0037），缺的只是：①用户可见的下载入口（详情页 BottomActionBar / 卡片长按菜单，Fluent 交互规范内）；②从缓存目录转存到 MediaStore/SAF 公共目录（相册 Pictures/Pictelio）；③命名模板（`{illust_id}_p{page}` 等，仿 pixez FAQ 的占位符约定）；④多图选页 dialog。动图 zip 走 `ugoiraExtract`（ADR-0125）已有的写盘路径。Lynx 端可先通过共享 Java 服务获得同能力，UI 后补（按 #60 模式先单端落地再对齐）。

#### P0-2 动图导出（GIF/MP4/WebP/APNG）
- **竞品证据**：pixez「动图的保存一样是长按，此时会提示是否合成动图…toast（encode success）」（FAQ.md 动图节）；Shaft README capabilities 明示 GIF/MP4；pixiv-viewer 支持 ZIP（原帧）/GIF/WebM/APNG/MP4/AVIF（docs/README.en.md Downloads 节）；Pixeval `UgoiraDownloadFormatToken.cs` 设置项；PBD「Convert Ugoira to WebP, WebM, GIF, APNG」；PixivBiu env `PIXIVBIU_DOWNLOAD_UGOIRA_FORMAT: webp/gif/none`。
- **对 Pictelio 的落地考量**：Pictelio 的独特优势是帧数据已可解包（`@pictelio/ugoira` fflate + Java `ugoiraExtract` 写盘帧序列）。GIF 合成可纯 Java（无新增依赖的 LZW 编码或引入 `android-gif-encoder` 类库）；MP4 需引入编码器（`ffmpeg-kit` 体积大，可用 `MediaCodec` + `mp4parser` 轻量方案）。首版建议只做 GIF（竞品最小公约数），在 `/settings` 图片卡加默认导出格式项（ADR-0130 的 8 卡片结构不动）。

#### P0-3 排行榜
- **竞品证据**：pixez l10n `intl_zh_CN.arb` 含 `"rank": "排行"`；Shaft「Daily / weekly / monthly rankings with a date picker…bookmark charts, AI charts, charts by era, wallpaper charts, tag zones and artist charts」（README）；Pixeval `Views/Capability/WorkRankingPage.axaml`；pixiv-viewer「Overall, illustrations, manga, animations, and novels; R18 and AI-generated works rankings; Historical rankings by date」（docs/README.en.md）；PixivBiu「作品、用户、排行」（README）；PBD 支持按榜单批量下载。
- **对 Pictelio 的落地考量**：AppAPI `/v1/ranking/illust`（type + date + mode）Pictelio 的认证/分页/图片流水线全部复用，是「新增 API 模块 + 一个路由 + GlassTabBar 切换种类」的标准扩展。建议放进 SideNavShell（现四 tab：推荐/关注/收藏/历史 → 可加第五入口或并入推荐页顶部）。R18 榜需复用 `r18Filter` 账号级开关；日期回看用 Fluent 日历选择器。双引擎：App 端先落，Lynx 列入后续 gap map。

#### P0-4 搜索高级筛选（收藏数/期间/比例/AI 三态）
- **竞品证据**：Shaft「bookmark-count range, aspect ratio and resolution, a three-way AI switch」；Pixeval `IllustrationSearchOptionsPage.axaml`/`NovelSearchOptionsPage.axaml`；pixiv-viewer「Filters by bookmark count and submission time」；PixivBiu「快速筛选，如收藏数、浏览量、标签、类型等」；PBD「Set various filtering conditions」。
- **对 Pictelio 的落地考量**：`api/search.ts` 现仅透传 `word/search_target/sort/filter`（第 23-57 行），AppAPI 本身支持 `search_target/sort/duration/start_date/end_date/bookmark_num_min.../ratio/width/height/searchAiType`——纯参数面扩展 + 搜索页一个「筛选」抽屉（Fluent `fluent-drawer`/BottomSheet 模式，对齐 `ReaderSettingsSheet` 的既有交互范式）。AI 三态（`searchAiType`）顺带补齐 AI 作品过滤缺口的一半（另一半是 Feed 侧过滤，见 P1-2）。

### P1

#### P1-1 以图搜图
- **竞品证据**：pixez `lib/page/saucenao/` 目录；Shaft「SauceNAO / TinEye / IQDB / Ascii2D, one tap to find the source」（README）；Pixeval `Views/Search/SauceNaoSearchPage.axaml`；pixiv-viewer「Search by image (via SauceNAO)」；Pix-EzViewer「图片搜索（sauceNAO）」。
- **对 Pictelio 的落地考量**：外部服务（非 Pixiv 域），网络层官方域基线约束下需在 Java 侧为 SauceNAO/Ascii2D 单独开白（不走 Pixiv 通道，无 Referer 特殊性）。最低成本版：复制图片链接/分享进系统浏览器打开 saucenao 查询页；进阶版应用内解析（Ascii2D 无需 key，SauceNAO 需用户填 API key——可复用 TranslateSheet 的 BYOK 交互模式）。

#### P1-2 过滤体系扩展（标签屏蔽 / 单作品静音 / Feed 侧 AI 过滤）
- **竞品证据**：pixez `lib/store/mute_store.dart` + `lib/page/shield/`；Shaft「Manage by tag and by artist separately, or mute a single work in place — cards get blurred and one tap reveals them」（README）；pixiv-viewer「Local blacklist for tags/users with individually removable entries」；Pix-EzViewer「内容过滤(隐藏已收藏/已保存图片)」。
- **对 Pictelio 的落地考量**：`createPersistedSet`（ADR-0092）工厂即为「持久化 ID/字符串集合」而生，标签黑名单是现成模式；过滤注入点在 `createTQFeedStore` 的 R18 过滤层旁（同一 `dedup/filter` 管道）；「单作品模糊」可复用 ImageCard 的 R18 模糊遮罩 UI。设置侧挂在「内容」卡片（`SettingsContent.tsx`）。

#### P1-3 收藏增强（收藏时加标签 / 收藏夹整理）
- **竞品证据**：pixez `lib/store/book_tag_store.dart`；PBD「Batch bookmark works; Add tags to unclassified works in bookmarks」；Pix-EzViewer「自动私密收藏」。
- **对 Pictelio 的落地考量**：`addBookmark`（`api/illust.ts` 第 323 行）现仅 `restrict` 参数——AppAPI `/v2/illust/bookmark/add` 原生支持 `tags` 数组，收藏 dialog（FluentDialog 已有成熟封装，ADR-0087）加标签多选即可；小说侧同理。收藏夹整理（批量加标签/转私密）可后置。

#### P1-4 小说导出（TXT 起步）
- **竞品证据**：Shaft「bookmarking saves the whole novel as TXT」（README）；pixiv-viewer「Export to TXT, HTML, Markdown, DOC, PDF, or EPUB」；PBD「Save novels in TXT, EPUB formats」；Pixeval `NovelDownloadFormatToken.cs`。
- **对 Pictelio 的落地考量**：正文已是结构化 blocks（`utils/novelBlocks.ts` 的 TextBlock/ImageBlock），TXT 导出是纯客户端字符串拼装 + `share`/`Filesystem` 写盘，成本极低；EPUB 需引库可后置。入口放 NovelFooterNav 或 IllustActionMenu 同级的小说操作菜单。翻译缓存（`translationCache`）里的译文也可顺带导出双语版——潜在差异化。

#### P1-5 多账号切换
- **竞品证据**：Shaft「Fast multi-account switching: Follows, DMs, bookmarks — hop freely between accounts」（README）；Pix-EzViewer「多用户切换」；pixez `lib/store/account_store.dart`。
- **对 Pictelio 的落地考量**：当前 `authStore` + Java 侧单 `access_token`（ADR-0037）是单账号模型。需 Java 侧多 token 槽位（账号列表 + active 指针）+ `secureStorage` 多 key；切换即重启式（对齐现有引擎切换 `clientSwitchStore` 的 restart 语义）。工程量中等，收益明确。

#### P1-6 稍后看（本地收藏队列）
- **竞品证据**：pixez `lib/page/watchlist/`；Shaft「Long-press a card to stash it. Purely local, never reported」（README）。
- **对 Pictelio 的落地考量**：纯本地功能，`historyStore` 的 TanStack DB 模式（ADR-0094）可直接复制为 watchlist collection（无 30 天过期）；卡片长按菜单挂入口。双引擎共用无网络依赖，适合先做。

#### P1-7 相关作品
- **竞品证据**：Pixeval `Views/Capability/WorkRelatedPage.axaml`（AppAPI `/v2/illust/related`）；Shaft 小说阅读器「related illustrations mixed in automatically」。
- **对 Pictelio 的落地考量**：`IllustDetail` 底部追加「相关作品」横向列表或分页列表，数据面一个 API 函数 + 复用 ImageCard。成本最低的 P1。

### P2

#### P2-1 多语言（i18n）
- **竞品证据**：全竞品支持 2 种以上语言（pixez l10n 目录含 en/id/zh 等；Pixeval `i18n/Language.cs` zh/en/fr/ru；PBD 6 语言）。
- **落地考量**：SolidJS 生态 `@solid-primitives/i18n`；工作量主要在 UI 文案抽取。当前用户群中文为主，优先级中低，但 UI 文案应先集中管理（为将来留口）。

#### P2-2 特辑 / Spotlight / PixiVision / 全站最新
- **竞品证据**：pixez `lib/page/spotlight/` + `lib/page/vision/`；Pixeval `SpotlightPage.axaml`；Shaft Discover「official PixiVision features…newest uploads」；pixiv-viewer「official curated specials」「Latest site-wide uploads」。
- **落地考量**：Spotlight（`/v1/spotlight/articles`）是 Webview 文章聚合，Pictelio 可用内嵌 WebView 打开原文（注意 ADR-0002 SSRF 白名单）；「全站最新」是 `/v1/illust/new` 一类端点，成本低。建议合并为推荐页的顶部入口。

#### P2-3 下载进阶（队列管理页 / aria2 / caption 导出）
- **竞品证据**：Shaft 下载页「downloading / waiting / done sections…resume…aria2 remote…export captions」；PBD「Save download progress and resume incomplete downloads」；Pix-EzViewer「aria下载加速」「下载记录」。
- **落地考量**：依赖 P0-1 的管线落地后再谈；WorkManager 已在 OTA（`OtaWorker`）中验证，可复用做下载队列。

#### P2-4 平板 / 横屏双栏
- **竞品证据**：Shaft「On a tablet in landscape you can turn on two-pane: list on the left, detail on the right」（README）；Pix-EzViewer「横/竖屏自适应，可切换顶部/底部导航栏」。
- **落地考量**：C shell（SideNavShell）天然适合扩展为「左列表 + 右详情」双栏；但 WebView 侧当前触达场景以手机竖屏为主，建议排在 Lynx 端成熟之后。

#### P2-5 AI 增强套件（AI 超分 / ugoira 补帧 / 漫画翻译）
- **竞品证据**：Shaft「AI on board…sharper images, manga you can read, characters cut out in a tap, smoother ugoira」（README）；pixiv-viewer 漫画翻译「local in-browser inference (detection, OCR, inpainting) via ONNX Runtime Web on WebGPU/WASM」。
- **落地考量**：工程量大、依赖模型分发；Pictelio 已有 AI 翻译基建（BYOK 模式 + 分块管线），若做漫画翻译可复用 BYOK + provider 抽象，但 OCR/嵌字是全新领域。仅作长期方向。

#### P2-6 备份/同步（设置+历史导出）
- **竞品证据**：pixiv-viewer「Settings and history backup/restore; Encrypted cloud sync (PBKDF2 + AES)」。
- **落地考量**：Pictelio 本地数据（设置/历史/翻译缓存/屏蔽列表）分散在 Preferences/localStorage/IndexedDB/Keystore，导出 JSON + 用户自选网盘即可，无需自建同步服务。

### P3（仅个别竞品有）

| 差距 | 竞品证据 | 落地考量 |
|------|----------|----------|
| 私信（DM） | Shaft「Follows, DMs, bookmarks」（README） | AppAPI 有 `/v1/chat` 系端点，但对话类 UI + 轮询/推送成本高，需求面窄 |
| FANBOX / pixiv COMIC | Shaft「Native FANBOX: post feed, recommended creators, full post bodies and plans」（README） | FANBOX 是独立 API 域（fanbox.cc），认证与支付墙复杂；Shaft 独有 |
| 本地 TXT 阅读 | Shaft「point it at a folder to read local txt files」 | 若做了 P1-4 导出，反向「导入阅读」可共享阅读器；锦上添花 |
| 应用内注册账号 | pixez FAQ「没有账号？」自动建号流程 | 依赖 Pixiv 注册 API 反自动化对抗，风险高收益低 |
| 好P友列表 | Pixeval `WorkMyPixivPage.axaml`（`/v1/user/mypixivs`） | 一个 API + 一个列表页，随手可做，但用户价值低 |
| 网络自检页 | Shaft「Built-in network test page: DNS, App API, web endpoints and a real image download」 | Pictelio 有 `/debug`（DebugImage）雏形，扩展为逐项探测即可；诊断价值中等 |

---

## 五、Pictelio 已有而多数竞品没有的差异化优势

1. **L1 Web Bundle OTA 热更新**（ADR-0122：Ed25519 签名 zip + 三指针原子切换 + notifyReady 健康握手回滚 + minWebVersion 地板自愈）——竞品全部依赖应用市场/Release 整包更新，网页修复分钟级送达是独有能力。
2. **流式 ugoira 播放**（ADR-0127/0128：首帧≈2% 下载量 vs 竞品普遍整包下载后播放；Shaft 的插值补帧是另一方向的差异化）。
3. **双渲染引擎**（WebView SolidJS + Lynx vue-lynx 同仓双客户端、账号/设置互通、引擎切换）——生态内独一份的架构实验。
4. **小说 AI 翻译的工程深度**（S1-S7：BYOK 分块并发+首屏优先+LRU 缓存+断点续翻+R18 分级门控+KV-cache 友好提示词）——Shaft/ pixiv-viewer 有翻译但未见同等粒度的缓存/续翻/内容分级设计。
5. **图片三层缓存 + 三档用户控制**（磁盘开关/缓存头/后台预取+磁盘上限，ADR-0090）与 **Feed 冷启动持久化**（`feedQueryPersist.ts`，首屏 P50 −50.2%）——Shaft 的「local first 快照」是同类思路，但细粒度缓存控制少见。
6. **图片托管镜像四模式**（race/weighted/fastest-ip/single，下载源下沉 Java、缓存键恒官方，ADR-0143）——镜像选路策略比多数竞品的单一镜像开关更系统。
7. **Fluent Design 2 全量令牌化 + A2 卡片体系**——视觉辨识度与竞品（Material/原生混搭）明显区隔。

---

## 六、引用来源

### 本仓库（Pictelio）
- `openwiki/quickstart.md`、`openwiki/architecture/overview.md`、`openwiki/domain/feed-and-browsing.md`、`openwiki/domain/novel-reader.md`（功能盘点主源）
- 源码：`packages/app/src/routes/`（Search.tsx / IllustDetail.tsx / NovelDetail.tsx / Settings.tsx / ImageHostSettings.tsx / ImageCacheSettings.tsx / FollowListPage.tsx / PersonalCenter.tsx / UserIllusts.tsx）、`packages/app/src/api/`（search.ts / illust.ts / comment.ts / translate.ts）、`packages/app/src/stores/`（bookmarkStore.ts / imageHostStore.ts / historyStore.ts / blockStore.ts / reportStore.ts）、`packages/app/src/components/`（CommentOverlay.tsx / BlocklistSheet.tsx / ReportSheet.tsx / UgoiraViewer.tsx / settings/）
- 需求源：`gh issue list --repo a1121611810/Pictelio`（开放 issue 均为内部 bug/spec，无竞品型功能请求）；issue #60「app-lynx 功能差距清单」（已关闭，搁置项：设置页分组扩展 / 举报 / 小说正文分段渲染）
- 竞品清单前作：`git show 883207c1:docs/research/pixiv-third-party-clients-direct-access.md`（2026-09-08 直连横向对比，本报告复用其客户端清单）
- ADR：0037（PixivApiPlugin 网关）、0090（缓存三档控制）、0092（createPersistedSet）、0094（浏览历史）、0103（账号级内容设置）、0122（OTA）、0125-0128（ugoira 管线）、0130（设置 8 卡片）、0143（图床下载源下沉 Java）

### 竞品（一手）
- PixEz：https://github.com/Notsfsssf/pixez-flutter — `README.md`、`.github/FAQ.md`（下载/动图合成/SAF/命名格式/以图搜图）、`lib/page/`（saucenao、spotlight、vision、watchlist、shield、series、theme 等）、`lib/store/`（account_store、mute_store、book_tag_store、tag_history_store、save_store）、`lib/l10n/intl_zh_CN.arb`（"rank": "排行"）、`lib/l10n/intl_en_US.arb`（new_version_update_information）
- PixShaft：https://github.com/CeuiLiSA/Pixiv-Shaft — `README.md`（排行榜+榜单中心、六排序+收藏数/比例/AI 三态、以图搜图四引擎、FANBOX/COMIC、批量下载+断点+aria2+命名模板+caption、静音体系、稍后看、网络自检、快照冷启、多账号+DM、AI 套件、平板 two-pane、小说本地 TXT+整本导出）
- Pixeval：https://github.com/Pixeval/Pixeval — `README.md`（平台矩阵）、`src/Pixeval/Views/Capability/`（WorkRankingPage、SpotlightPage、WorkMyPixivPage、WorkRelatedPage、SeriesPage、UserFollowingPage、WorkBookmarksPage）、`src/Pixeval/Views/Search/`（Illustration/NovelSearchOptionsPage、SauceNaoSearchPage、SearchCompletionItem）、`src/Pixeval/Models/Download/`（Ugoira/Novel/IllustrationDownloadFormatToken、DownloadPathMacroParser）、`src/Pixeval/Views/Settings/`（BlockedUsers、DomainFronting、DownloadMacro、Language、IPListInput）、https://pixeval.github.io/
- pixiv-viewer（Kai）：https://github.com/asadahimeka/pixiv-viewer-app — `README.md`；功能详单 https://github.com/asadahimeka/pixiv-viewer/blob/master/docs/README.en.md（榜单/联想/筛选/SauceNAO/ugoira 六格式导出/小说六格式导出/ONNX 漫画翻译/黑名单/备份云同步/PWA）；Web 版仓库 https://github.com/asadahimeka/pixiv-viewer
- Pix-EzViewer：https://github.com/ultranity/Pix-EzViewer — `README.md`（功能特性节：M2/M3、横竖屏、批量下载、多用户、aria2、命名、sauceNAO、GIF 保存、评论增删回复、特辑、自动私密收藏）
- PixivBiu：https://github.com/txperl/PixivBiu — `README.md`（浏览/筛选/下载三行定位、`PIXIVBIU_DOWNLOAD_UGOIRA_FORMAT`、多语言 env、Docker）
- PixivBatchDownloader：https://github.com/xuejianxianzun/PixivBatchDownloader — `README.md`（批量下载维度、ugoira 四格式、小说 TXT/EPUB、批量收藏+补标签、断点+历史、6 语言）
- 竞品 star/活跃度：GitHub REST API `repos/{owner}/{repo}`（2026-09-09 经 `gh api` 查询）
- 官方 App 基线：https://www.pixiv.net/ （排行榜/私信/推送/小说等能力项为公开常识，且与竞品 README 的定位描述交叉印证；App Store 页面无法从本环境抓取，特此注明）

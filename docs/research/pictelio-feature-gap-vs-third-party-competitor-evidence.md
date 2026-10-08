# 竞品复验证据：`docs/research/pictelio-feature-gap-vs-third-party.md`

日期：2026-09-11（三版 2026-09-12 增量复验见文末「2026-09-12 增补」；四版第二次增量复验见「2026-09-12 第二次增补」；六版增量复验见「2026-09-14 增补」）
方法：仅使用一手来源——经已认证的 `gh api` 访问 GitHub REST API（元数据/分支/README），并对每个仓库做浅克隆（`--depth 1`）后直接 grep/阅读（源码目录、l10n、strings、manifest）。官方基线：Google Play / Apple App Store 商店页与 `pixiv.net` 功能页（经 `web_fetch`）。未使用博客/二手文章。无法确认处标记为「未证实（UNVERIFIABLE）」。

## 统计（截至 2026-09-11）

| 仓库 | Stars | pushed_at | archived | 一手来源 |
|---|---|---|---|---|
| Notsfsssf/pixez-flutter | 12814 | 2026-09-07T02:25:37Z | false | https://github.com/Notsfsssf/pixez-flutter |
| CeuiLiSA/Pixiv-Shaft | 7810 | 2026-09-11T02:52:43Z | false | https://github.com/CeuiLiSA/Pixiv-Shaft（默认分支为 `classic`；`master` 亦存在） |
| Pixeval/Pixeval | 3138 | 2026-09-05T08:47:51Z | false | https://github.com/Pixeval/Pixeval |
| xuejianxianzun/PixivBatchDownloader | 5596 | 2026-09-07T19:33:34Z | false | https://github.com/xuejianxianzun/PixivBatchDownloader |
| asadahimeka/pixiv-viewer-app | 534 | 2026-05-01T11:38:39Z | false | https://github.com/asadahimeka/pixiv-viewer-app |
| asadahimeka/pixiv-viewer（Web 版） | 770 | 2026-09-09T13:37:08Z | false | https://github.com/asadahimeka/pixiv-viewer |
| ultranity/Pix-EzViewer | 1252 | 2026-07-04T11:40:47Z | false | https://github.com/ultranity/Pix-EzViewer |
| txperl/PixivBiu | 1451 | 2026-09-11T01:51:22Z | false | https://github.com/txperl/PixivBiu |
| Pixiv 官方 App（基线） | — | 2026（商店在架） | false | https://play.google.com/store/apps/details?id=jp.pxv.android · https://apps.apple.com/us/app/pixiv/id337248563 · https://www.pixiv.net/ranking.php · https://www.pixiv.net/novel/ |

八个仓库均存在、无一归档；star 数与旧报告的偏差在约 0.3% 以内（仅为元数据漂移）。

---

## 逐竞品已核实结论

### 1. Notsfsssf/pixez-flutter
- 排行榜模式众多（含 R18/AI）且有日期选择器：`lib/page/hello/ranking/rank_page.dart` 中 `modeList = [day, day_male, day_female, week_original, week_rookie, week, month, day_ai, day_r18_ai, day_r18, week_r18, week_r18g]` + `toRequestDate()`。
- 特辑 + PixiVision：`lib/page/spotlight/`、`lib/page/vision/`。
- 稍后看走 Pixiv **官方 watchlist API**（服务端），并非纯本地队列：`/v1/watchlist/manga`、`/v1/watchlist/manga/add|delete`、`/v1/watchlist/novel`（端点在 `lib/`），`lib/page/watchlist/`。
- 标签静音/用户屏蔽：`lib/store/mute_store.dart`、`lib/page/shield/`（+ `user_show_ai_setting.dart`）。
- 收藏加标签：`lib/store/book_tag_store.dart`；端点 `/v1/user/bookmark-tags/illust`。
- 以图搜图：`lib/page/saucenao/`（SauceNAO）。
- 应用内注册：端点 `/web/v1/provisional-accounts/create`；FAQ「没有账号？」流程。
- 下载：FAQ `.github/FAQ.md`——瀑布流长按下载全部分页；详情页长按可手动选页；ugoira 保存合成动图（GIF）并 toast 提示编码完成；文件名模板 `{illust_id}_p{part}`；SAF/传统存储。
- AI 过滤：仅有经 `/v1/user/ai-show-settings` 的全局显示/隐藏——**没有搜索侧三态 AI 过滤**；搜索端点限于 `/v1/search/{illust,novel,user}` + `/v1/search/popular-preview/illust` + `/v2/search/autocomplete`。无高级筛选参数，无全站最新端点。
- 批量下载：源码中无 `batch` 相关引用；仅逐作品（与旧报告「⚠️ 逐作品」一致）。
- 多语言：16 个 `.arb` 文件（de/en/es/fil/id/ja/ko/ru/tr/vi/zh_CN/zh_TW 及变体）。

### 2. CeuiLiSA/Pixiv-Shaft
- 排行榜 + 榜单中心 + 日期选择器 + AI/R18/年代/壁纸/标签/画师榜：README；`app/src/main/java/ceui/pixiv/ui/rank/`、`ui/discovery/`；strings `daily_rank/weekly_rank/monthly_rank/r_eighteen_ai_rank`、`artist_rank`。
- 全站最新：`app/src/main/java/ceui/pixiv/ui/newworks/`。
- PixiVision + 专栏：`ui/pivision/`、README。
- 搜索 v3 高级筛选：`ui/search/v3/SearchFilterV3.kt`、`DateRangePickerSheet.kt`、`DurationPickerSheet.kt`、`NumberRangeInputSheet.kt`、`OtherFilterSheet.kt`；strings 含收藏数下限/期间/比例/分辨率。
- AI 三态：`SearchFilterV3.kt` 的 `enum AiMode { All, ExcludeAi, OnlyAi }`（issue #909）；Exclude → `search_ai_type=1`，Only → 服务端全量 + 客户端过滤。
- 以图搜图：**仅实现 2 个引擎**——`app/src/main/java/ceui/lisa/utils/ReverseImage.java` 的 `enum ReverseProvider { SauceNao, Ascii2D }`；菜单 `app/src/main/res/menu/web_reverse_image_search.xml` 只有 saucenao + ascii2d。README 的「SauceNAO / TinEye / IQDB / Ascii2D」无源码支撑（代码注释指出 Cloudflare 使旧的多引擎上传路径不可用，#733）。
- Ugoira 插值补帧（RIFE）+ GIF/MP4 保存：`ui/interpolate/`；strings `setting_ugoira_save_format`（GIF/MP4）、`ugoira_rife_enable_desc`。
- 作品详情页相关作品：`ui/detail/ArtworkSectionLoader.kt`（「相关作品」），string `related_artworks`（旧报告只认可「小说混入相关插画」）。
- 评论浮动胶囊：strings `artwork_v3_comment_jump_desc`、`ui/comments/`。
- 收藏加标签：strings `string_238`「按标签收藏」，`bookmark_filter_*` 本地书签镜像/过滤（标签/作者/年份/全文），`ui/synonym/`（issue #904）。
- 小说阅读器 + 本地 TXT + 整本 TXT 导出：`ui/novel/reader/`、`ui/novel/local/`（LocalLibrary*）；strings `novel_txt_download_path`、`string_228/277/278`（导出 TXT）。
- 多账号 + 私信/聊天：`ui/account/AccountSwitchV3Fragment.kt`、`AccountActionsSheet.kt`；`ceui.pixiv.chat.*`、`websocket/` 模块、`docs/ws-chat-integration.md`；strings `chat_with_him`、`chat_room_global_title`（公屏闲聊全局房 + 1v1）。
- 下载：`ui/download/`（进行中/队列/完成列表）、aria2 设置（`fragment_aria2_settings.xml`，string #692）、caption 自动导出（`setting_auto_export_caption_title`）、命名模板 + 批量重命名、下载记录导出。
- 离线快照 + 持久化操作队列：`ceui/pixiv/snapshot/`（SnapshotManager/Batch export），strings `snapshot_*`；`actionqueue/` 模块 + `docs/action-queue.md`。
- 网络自检：strings `nav_network_test_entry`、`network_test_*`（DNS/API/图片/原始日志）。
- 平板双栏：string `tablet_split_screen` + `ui/embedding/SplitPlaceholderActivity.kt`（Activity Embedding）。
- AI：`ui/upscale/`（ESRGAN + `RembgModel.kt` 抠图）、`ui/translate/`（漫画 OCR+MT、整系列后台、自定义端点）。
- FANBOX + pixiv COMIC 原生：`ui/fanbox/`、`ui/comic/`。
- 配置云同步（moonAPI）+ 邮箱账号备份：`ui/settings/MoonSync.kt`、`api/MoonAPI.kt`、`ui/account/EmailBackupV3Fragment.kt`；strings `moon_upload_*`、`email_backup_*`。
- 多语言：base + `values-en/ja/ko/ru/tr/zh-rTW` = **7 种语言**。
- 应用内更新：`app/src/main/java/ceui/lisa/update/AppUpdateChecker.kt`。
- 免 Pixiv Premium 的热门排序是**配额受限/freemium**，并非免费无限：README Plans 表——免费基础额度用完后回退到热门预览；Pro 5×/Max 20×；仅 Pixiv Premium 无限。
- 无应用内注册流程；除 moonAPI 外未见应用内云同步（未发现通用备份/还原 UI）。其他备份细节未证实。

### 3. Pixeval/Pixeval
- 排行榜含日期 + 类型：`src/Pixeval/Views/Capability/WorkRankingPage.axaml`（CalendarDatePicker + RankOptionComboBox + SimpleWorkType）。
- 特辑、相关、好P友、系列、关注、收藏页：`Views/Capability/{SpotlightPage,WorkRelatedPage,WorkMyPixivPage,SeriesPage,UserFollowingPage,WorkBookmarksPage}.axaml`。
- 搜索选项含日期区间、AI 显示开关、宽高比、宽/高最小最大值、小说篇幅/语言：`Views/Search/IllustrationSearchOptionsPage.axaml`、`NovelSearchOptionsPage.axaml`、`ViewModels/Search/SearchArgumentsFormViewModelBase.cs`。**未发现收藏数筛选。**
- AI 过滤为**两态**（`AiType` 开关 = 显示/隐藏 AI）加过滤语言 `+ai`/`-ai`（`Models/Filters/WorkAiFilterSyntax.cs`）——非三态。
- 以图搜图：`Views/Search/SauceNaoSearchPage.axaml`。
- Ugoira 导出格式：`Models/Options/UgoiraDownloadFormat.cs` **只有 `Original`**；其他格式仅能经可选的 `extension:` 格式提供方（`Models/Download/UgoiraDownloadFormatToken.cs`）。旧报告暗示原生多格式，有误。
- 小说导出格式：`Models/Options/NovelDownloadFormat.cs` = `Html, Md, OriginalTxt`——**无 EPUB**。
- 下载宏：`Models/Download/DownloadPathMacroParser.cs`、`Macros/`、`Views/Settings/DownloadMacroSettingsExpander.axaml`。
- 多账号切换：`Views/Settings/SettingsMainView.axaml` 的 `SwitchAccountButton_OnClicked` → LoginPage；i18n `SwitchAccountEntry`、`SwitchAccountItem`。
- 设置备份（本地，非云）：`SettingsMainView.axaml` 的 BackupSettingsEntry → 打开设置文件夹 + `ExportSettingsPlaintext_OnClicked`。
- 屏蔽用户、域前置、IP 列表：`Views/Settings/BlockedUsersSettingsExpander.axaml`、`DomainFrontingSettingsExpander.axaml`、`IPListInput.axaml`。
- 热门排序需 Premium：`SearchArgumentsFormViewModelBase.TryValidate` 在 `!IsPremium` 时拒绝 `PopularityDescending`。
- 多语言：`src/Pixeval/i18n/{en-US,fr-FR,ru-RU,zh-Hans}` = 4 种。
- 未发现本地 TXT 阅读、私信/聊天、标签静音。
- 额外项：`Pixeval.Mcp`（向 MCP 客户端暴露 Pixeval 工具的 MCP server）、`Pixeval.Filters`（完整过滤查询语言/解析器）、`Pixeval.Browser`（Blazor 浏览器版）、扩展格式提供方体系。

### 4. xuejianxianzun/PixivBatchDownloader（PBD）
- 批量下载维度、过滤、文件夹/命名规则、定时、断点、历史去重、批量收藏 + 为未分类补标签：`README.md`；`src/ts/download/{Resume,DownloadRecord,DownloadControl}.ts`；`src/ts/filter/*`；`src/ts/crawlMixedPage/InitBookmarkPage.ts`、`src/ts/pageFunciton/BookmarksAddTag`。
- Ugoira → WebM/WebP/GIF/APNG：`src/ts/ConvertUgoira/{ToWebMUseMediabunny,ToWebMUseWhammy,ToWebP,ToGIF,ToAPNG}.ts`。
- 小说 → TXT 或 EPUB：`src/ts/download/MergeNovel.ts`（「生成 TXT 或 EPUB 文件」）。
- 多语言：`src/_locales/{en,zh_CN,zh_TW,ja,ko,ru}` = 6 种。
- 无反向图搜（`saucenao|ascii2d|tineye|iqdb` 在 `src/` 中均无命中）。PBD 本身无 aria2（README 某段仅描述其姊妹用户脚本 PUBD）。无评论 UI。
- 额外项：按用户屏蔽标签（`src/ts/filter/BlockTagsForSpecificUser.ts`）、黑白图过滤、CSV 结果导出、预览作品详情信息、定时爬取。

### 5. asadahimeka/pixiv-viewer（+ pixiv-viewer-app）
- 两仓库均存活；app 仓库包含同一套 `src/` 的完整副本加 Capacitor/Tauri/Electron 外壳（`package.json` scripts `build:and`、`build:ios`、`dev:tauri`），故 Web 版 README 的功能清单同样适用于 app。
- 排行榜含 R18/AI/历史日期选择器：`src/views/Rank/index.vue`（模式 `day/day_ai/day_r18/week_r18/day_r18_ai/day_male_r18/week_r18g/...`，`min-date`/`max-date`）。
- 全站最新：`src/views/Discovery/LatestIllustCard.vue`、`Home/components/{LatestMangaCard,LatestNovelCard}.vue`。
- 特辑：`src/views/Spotlights/`；Pixivision：`PixivisionStory.vue`。
- 搜索：热门词、自动补全（`api.getTagsAutocomplete`）、热门预览（前 30）、日期区间筛选（`SearchRes.vue` 的 `start_date/end_date`）。收藏数筛选：源码未证实（README 有此声明）。
- 以图搜图走 SauceNAO（README + SauceNAO 致谢）。
- Ugoira 导出菜单：`src/utils/ugoira.js`——**ZIP、GIF、WebM、APNG、MP4(浏览器)、MP4(服务端)、AVIF、Other**（8 个选项）。
- 小说导出：TXT、HTML、Markdown、DOC、PDF、EPUB + 系列 EPUB：`src/views/Artwork/Novel.vue`（`txt/html/md/doc/pdf/epub/epub_series`）、`src/utils/novel.js`（`convertHtmlToEpub`、`convertHtmlToPdf`、`convertHtmlToDoc`、`convertNovelToMarkdown`）。
- 漫画翻译（本地 ONNX 检测/OCR/嵌字 + 多供应商 LLM）：`src/views/Artwork/components/MangaTranslate*`、`src/utils/translate/shinobu/`；小说在线翻译 `NovelTranslateSettings.vue`。
- 本地黑名单标签/用户：`src/utils/filter/`、`src/utils/lock.js`。
- 云同步（PBKDF2 10 万次 + AES，冲突合并）：`src/utils/sync.js`、`src/views/Setting/SyncDialog.vue`。
- 多语言：`src/locales/` = **14 种语言**（de, el, en, es, fr, it, ja, ko, ms-MY, pt, ru, th-TH, zh-CN, zh-TW）。
- 额外项：「珍藏册」收藏集、画师 X/Twitter 媒体、File System Access API 下载、Tampermonkey 导出、PWA 快捷方式、历史备份。
- 未发现多账号切换、私信、应用内注册。

### 6. ultranity/Pix-EzViewer
- M2/M3 主题、横竖屏 + 导航位置、内容过滤、批量下载、历史/下载记录、一键三连（下载+收藏+关注）、自定义命名、本地 pid 检测+重命名、SNI bypass、SauceNAO、GIF 播放/保存、谷歌翻译、评论查看/发送/回复、Pixiv 特辑、R18 单独文件夹 + 自动私密收藏：`README.md`；`ui/`、`services/SaucenaoService.kt`、`view/AnimationView.kt`；strings `R18_private`、`create_R18_folder`。
- 多用户：`ui/account/{AccountChoiceAdapter,AccountFragment,NewUserActivity,LoginActivity}.kt`。
- 屏蔽标签**与**屏蔽用户：`ui/settings/BlockTagFragment.kt`、`BlockViewModel.kt`；strings `block_tag`、`block_user`、`add_to_block_tag_list`。
- MyPixiv（好P友）：`core/UserListViewModel.kt` 的 `getMyPixivFriend`，`core/UserListFragment.kt` 的「MyPixiv」。
- 小说阅读器 + 榜单 + 系列前后章：`ui/novel/{NovelActivity,NovelRankFragment,NovelViewModel,NovelMarkup}.kt`；strings `novel_font_larger/smaller`、`novel_series_prev/next`、阅读背景。未发现明确的小说导出 UI（仅一处注释提到纯文本导出场景）——导出标记为未证实。
- 下载管理页：`ui/manager/DownloadManagerActivity.kt` + `DownloadTaskAdapter.kt`。
- 多语言：base + `values-en/ja/zh-rTW` = **4 种语言**。
- 应用内更新：`services/AppUpdater.kt`。
- aria2：依赖在 `app/build.gradle.kts` 中**已被注释**（`//implementation(libs.aria.core)`）；当前源码中无 `aria2|Aria2|ARIA2`（仅历史 ReleaseNote/帮助文本）。旧报告「aria2 加速 ✅」已无代码支撑。
- 平板双栏：无双栏代码；仅按横竖屏的列数（string `span_num`「竖屏2 横屏4」）。旧报告的「双栏 ✅」有误。

### 7. txperl/PixivBiu
- 浏览作品/用户/排行 + 收藏/关注：`frontend/src/app/router.tsx`（`/search`、`/ranking`、`/user/:id`、`/me`、`/downloads`、`/settings`）；`api/paths/illusts.yaml` 的 `/illusts/ranking`（RankingMode + 日期）。
- 过滤：`frontend/src/features/filter/apply.ts`——AI **三态**（`f.ai === "exclude"` / `"only"`）、minBookmarks、minViews、宽高比、标签包含/排除、illustType、R18/R18G。
- 免 Premium 的榜序搜索：`internal/config/config.go` 的 Sample 配置对 `bookmarks_desc/views_desc` 在本地对按日期排序的分页做重排；`pages/search/results.tsx`「Most bookmarked default works for any account」。
- 下载：原图质量的单图/多图/ugoira（README）；`internal/download/{manager,worker,store,naming,ugoira}.go`；下载 UI `frontend/src/pages/downloads/index.tsx`。
- Ugoira 输出 `webp | gif | none`：`internal/config/config.go` 的 `Download.Ugoira.Format cfg:"enum=webp|gif|none"`；`internal/download/ugoira.go`。
- 自定义命名模板含实时预览：`internal/download/naming.go`（`NameContext`、模板函数）、`frontend/src/pages/settings/components/template-edit-dialog.tsx`。
- 应用内更新含更新通道：`internal/update/{checker,apply,github,verify}.go`。
- 系统代理配置、图片缓存、SSE 收件箱：`internal/sysproxy/`、`internal/imgcache/`、`internal/inbox/`。
- 多语言：`frontend/src/i18n/messages/{en,ja,zh-CN,zh-TW}.json` = **4 种语言**（env 的 `auto/en/zh-CN/zh-TW/ja` 中 `auto` 不是语言，算第 5 个伪值）。
- 设计上明确不做：`AGENTS.md`「Do not add these without a task...: aria2, partial-byte download resume, persistent unread inbox, SauceNAO/reverse search, backend search-result cache, quota middleware...」——证实无 aria2 / 无反向图搜 / 无分段续传。
- 无小说阅读器 UI（routes/pages 中无小说页；仅有 `Novel` schema 元数据），无评论 UI，无特辑，无私信，无平板双栏。

### 基线：Pixiv 官方 App/站点
- 官方 Android 包名 `jp.pxv.android`（Play 商店页），iOS `id337248563`；官方排行榜页 `https://www.pixiv.net/ranking.php`（200，「Overall Daily Rankings」），小说浏览 `https://www.pixiv.net/novel/`（200，「Novels」），特辑重定向到 `https://www.pixivision.net`。`https://www.pixiv.net/messages/` 在本环境返回 404，故私信无法从一手页面复核 → 未证实（无异议）。

---

## 旧报告未列出的竞品新功能

- **Shaft**：moonAPI 配置云同步（设置 + 静音记录 + 下载模板）与邮箱绑定的加密账号备份/还原（重装后恢复登录态）；本地书签镜像含标签/作者/年份/全文过滤；下载记录与静音记录导出；桌面日榜小组件；私信含基于 WebSocket 的服务端公屏闲聊房（「公屏闲聊」）。
- **Pixeval**：`Pixeval.Mcp`——向 MCP 客户端暴露 Pixeval 查询/写入的 MCP server；`Pixeval.Filters`——带解析器/补全/诊断的完整过滤查询语言；`Pixeval.Browser` Blazor 浏览器版；扩展提供的下载格式提供方。
- **pixiv-viewer**：14 语言 i18n；系列级 EPUB 导出；「珍藏册」收藏集；画师 X/Twitter 媒体；两条 MP4 导出路径（浏览器/服务端）；PWA 应用快捷方式。
- **PixivBiu**：带实时预览编辑器的自定义下载命名模板；下载页/队列/存储；本地榜序（收藏数/浏览量）与可配置时间窗；系统代理管理；SSE 收件箱；桌面外壳；更新通道。
- **PBD**：按用户屏蔽标签；黑白图过滤；CSV 结果导出；不打开作品即可预览作品详情（标题/标签/统计）。
- **Pix-EzViewer**：小说阅读器 + 小说榜 + 系列前后章；标签屏蔽与用户屏蔽列表；MyPixiv 列表；剪贴板识别画师/Twitter ID；本地 pid 检测 + 批量重命名。
- **pixez**：16 语言 i18n；稍后看由 Pixiv 官方 watchlist API 支撑（漫画/小说），并非仅本地队列；用户级 AI 显示设置 UI；临时账号创建。
- **官方**：Play 商店页确认 Android 包名 `jp.pxv.android`（旧报告未给出具体商店 URL）。

---

## 旧报告结论的核对状态（被推翻 / 已更正 / 未证实）

被推翻（旧报告称 X，一手源码显示非 X）：
1. Shaft 以图搜图「4 引擎（SauceNAO/TinEye/IQDB/Ascii2D）」→ 源码仅实现 SauceNAO + Ascii2D。
2. Pixeval「UgoiraDownloadFormat 可选」（多格式）→ 原生枚举只有 `Original`；转换需可选扩展。
3. Pixeval 被列入「小说导出 TXT/EPUB」→ 内置格式为 TXT/HTML/MD，无 EPUB。
4. Pix-EzViewer「aria2 加速」→ aria 依赖已注释；当前源码无 aria2。
5. Pix-EzViewer「平板双栏 ✅」→ 无双栏；仅按横竖屏的列数。
6. PixivBiu「AI 作品三态过滤 ❌」→ 实际**有**三态 AI 过滤（exclude/only），见 `features/filter/apply.ts`。
7. PixivBiu「小说阅读器 ✅」→ 无阅读器 UI/路由；API schema 中仅有小说元数据。
8. Shaft「多语言 en/zh/ja」→ 实为 7 种语言。
9. Pix-EzViewer「多语言 ➖」→ 4 种语言。
10. pixiv-viewer「多语言 简繁/英/俄」→ 14 种语言。
11. PixivBiu「5 语言」→ 4 个消息语言文件（`auto` 不是语言）。
12. Shaft「热门排序免 Premium ✅」→ freemium：免费额度用完后回退；Pro/Max 倍增额度；仅 Pixiv Premium 无限。
13. Shaft「收藏时加标签 ➖」→ 有「按标签收藏」+ 书签标签过滤。
14. Shaft「备份/云同步 ➖」→ 有 moonAPI 配置云同步 + 邮箱账号备份。
15. Pixeval「多账号 ➖」→ 有账号切换（Settings/i18n SwitchAccount）。
16. Pixeval「备份/云同步 ➖」→ 有本地设置备份/导出（非云）。
17. Pix-EzViewer「标签屏蔽 ❌ / 屏蔽用户 ❌」→ 两者均已实现（BlockTagFragment + strings）。
18. Pix-EzViewer「好P友 ➖」→ 已实现（`getMyPixivFriend` / MyPixiv）。
19. Pix-EzViewer「小说阅读器 ➖」→ 已实现小说阅读器 + 榜单 + 系列导航。
20. PixivBiu「自定义命名模板 ➖」→ 已实现（naming.go + 模板编辑器）。
21. PixivBiu「下载队列/进度/记录 ➖」→ 已实现（下载管理器 + 下载页）。
22. Shaft「相关作品 ⚠️ 仅小说混入」→ 作品详情页存在相关作品节。
23. pixiv-viewer「ugoira 6 格式」→ 8 个导出选项。

部分成立 / 需细分（不能简单判对或判错）：
- Pixeval「AI 三态 ➖」→ 有两态显示/隐藏 AI 开关 + `±ai` 过滤语法，但非三态。
- Pixeval「高级筛选（收藏数/期间/比例/分辨率）」→ 期间/比例/分辨率有；收藏数筛选未见。
- pixiv-viewer「按收藏数筛选」→ README 声称有，源码仅见投稿时间筛选（热门预览是另一功能）→ 未证实。
- pixiv-viewer 的 Ugoira 格式数被低估；该列总体仍正确。

更广的未证实项（在时限内未找到正面或负面的一手证据）：
- pixiv-viewer 的收藏数搜索筛选。
- Pix-EzViewer 的小说导出 UI。
- 官方 Pixiv App 的私信（官方 messages 页在本环境 404）；排行榜/小说/特辑已通过 pixiv.net 核实。

我核对的其余旧报告竞品结论均与一手来源一致（例如 pixez 的下载/ugoira/saucenao/静音/收藏加标签/注册；PBD 6 语言 + 4 种 ugoira 格式 + TXT/EPUB + 断点/历史/批量收藏；Shaft 的排行榜/搜索/三态 AI/aria2/caption/网络自检/双栏/FANBOX/COMIC；Pixeval 的排行榜/特辑/相关/好P友/SauceNAO；pixiv-viewer 的排行榜/R18+AI/日期、全站最新、特辑、筛选、小说 6 格式、云同步、ONNX 漫画翻译）。

---

# 2026-09-12 增补（三版增量复验）

范围：二版基线 `5e5a3d51` → 产品 HEAD `1039539f`（25 提交）+ 8 仓元数据复刷。Pictelio 侧由后台研究代理核实（承重断言经主会话抽查属实），竞品侧经 `gh api` 一手查询（2026-09-12 07:15 CST）。

## A. Pictelio 侧：两个新功能域（25 提交全部归属于此，无第三项功能变化）

### A1. 网络自检（net-diagnostics，5 提交：17a35063→91c7ae43）

- **共享核心**：新 workspace 包 `packages/net-diagnostics/`（`@pictelio/net-diagnostics` v0.1.0，`packages/net-diagnostics/package.json:3`），两端以 `workspace:*` 依赖。
- **检查计划**：`packages/net-diagnostics/src/plan.ts:21-38`（`CHECK_PLAN` 7 项：device（本地读，timeout 0）/ route（恒 skipped，`disabledReason: "网络直连功能已于 bf32620e 移除"`，plan.ts:23-30）/ dns 1500ms / tcp 2000ms（app-api:443）/ tls 2000ms（SNI）/ http 2500ms（带鉴权 API）/ edge 2000ms（图片边缘））；总预算 `TOTAL_BUDGET_MS = 10000`（plan.ts:19）。
- **判定/归因**：`packages/net-diagnostics/src/judge.ts:205`（`evaluate()`）；归因 device/auth/proxy/network/service，401→auth、429→warn-service（judge.ts:146-155）。
- **报告脱敏**：`formatReport` + `redactSecrets`（`packages/net-diagnostics/src/report.ts:12-14`，正则抹除 token/authorization/cookie）。
- **webview 端**：路由 `/network-check`（`packages/app/src/router.tsx:45`）；页面 `packages/app/src/routes/NetworkCheck.tsx:32-36`；入口 `SettingsNetDiag.tsx:13`（挂载于 `SettingsSections.tsx:67`）；未登录可访问（`__root.tsx:81` 白名单）。
- **lynx 端**：路由 `/network-check`（`packages/app-lynx/src/router.ts:84`）；页面 `packages/app-lynx/src/pages/NetworkCheck.vue:5`；入口 `Me.vue:385-392`（跳转 `Me.vue:274`）。
- **Android 原生**：`NetDiagProbe.java`（专用非路由 OkHttp client + `EventListener` 分阶段计时 dnsStart:88 / connectStart:102 / secureConnectStart:116，带鉴权请求注入 Referer:223，入口 `run()`:264）；双桥 `NetDiagPlugin.java`（`@CapacitorPlugin(name="NetDiag")`:20，注册 `MainActivityWebview.java:73`）与 `NetDiagModule.java`（`@LynxMethod diagnose`:33，注册 `LynxActivity.java:117`、`LynxRuntimeInitializer.java:81`）；权限 `ACCESS_NETWORK_STATE`（`AndroidManifest.xml:64`）。
- **TS 降级**：webview `packages/app/src/native/NetDiag.ts:49-63`（原生优先，dev/web 降级仅 http 子集 + `degraded: true`）；lynx `packages/app-lynx/src/utils/netDiagnostics.ts:29-57`。
- **E2E**：`packages/app/tests/android-e2e/specs/network-check.spec.ts`、`lynx-network-check.spec.ts`。
- **spec 偏差（未实现项）**：`docs/specs/network-self-check.md:70` 要求 ErrorDisplay 在 NETWORK/TIMEOUT/PROXY 时给「运行网络自检」CTA，`ErrorDisplay.tsx` 中零命中。

### A2. WebDAV 备份（20 提交：a1588d08→1039539f；ADR-0156，spec `docs/specs/webdav-backup.md`）

- **备份范围**：webview `collect()` = `settings.rawValues()` 全量 + sets `["blocked_user_ids","reported_ids"]`（`packages/app/src/services/backupWiring.ts:91-102`、`:34`；运行时键 `settings_webdav_last_backup` 排除 :43）；账号级键前缀 `["show_r18_","show_r18g_","ai_filter_mode_"]`（`packages/app/src/utils/backupCore.ts:81`），恢复按当前 uid 过滤（`planRestore`，backupCore.ts:274-298）。lynx `exportRawValues()` 双源 = idbKV + SharedPreferences（`packages/app-lynx/src/stores/settingsStore.ts:591-618`，`BACKUP_DEVICE_KEYS` 固定 16 键 :76-93）；**lynx sets 为空对象**（无屏蔽/举报 store，`packages/app-lynx/src/services/backupWiring.ts:56`）。
- **明确排除**（spec :21-24,39 + 代码印证）：浏览历史、搜索历史、下载队列记录、可重建缓存、一切凭证（refresh_token / 两个 WebDAV 密码）；稍后看/追更不在备份域。
- **恢复流程**：列档时间倒序（`selectBackupFiles`，`backupService.ts:125-146`）→ `prepareRestore`（下载→`isEncrypted`→解密→`parseSnapshot`→`planRestore`+`summarize`，零写回，:212-241）→ 摘要确认 → `applyPreparedRestore`（pre-restore 应急快照 → merge-by-keys 写回，:247-253）→ 「撤销上次恢复」（`backupWiring.ts:161-166`，快照键 `webdav_pre_restore_snapshot`:37）。拒绝边界 `SCHEMA_TOO_NEW`/`NOT_BACKUP`/`CORRUPT`（backupCore.ts:203-240）。
- **自动备份**：启动时（webview `__root.tsx:62` 调 `runStartupAutoBackup()`，`backupWiring.ts:182-207`）；判定 `maybeAutoBackup`（backupService.ts:289-306）：开关开且距上次 > N 天（1/3/7/30 可配，默认 7）；失败仅 warn 不阻塞启动。
- **凭证**：`capacitor-secure-storage`（Keystore），键 `webdav_password`/`webdav_backup_password`（app `webdavCredentials.ts:12-14`；lynx 同名键）；Web 平台不持久化并 warn（:34-37）。连接配置跨引擎同键 `settings_webdav_*` 8 键（app `settingsStore.ts:49-56` ↔ lynx `:62-69`）。
- **加密**：Java `BackupCrypto.java:33-39`——`PICTELIO-ENC1` magic(13B) + salt(16B) + iv(12B) + AES-256-GCM（tag 128b）；密钥 PBKDF2-HMAC-SHA256 600k 轮（:37,:41）；密码错/损坏统一 `CryptoException("密码错误或文件损坏")`（:93）。
- **双端 UI**：webview `SettingsWebdav.tsx`（601 行：连接测试:158 / 立即备份:170 / 恢复三段式:58,:233 / 撤销:252 / 敏感项排除:110,:355 / 自动备份:383；仅原生渲染 `isNativePlatform()`:261，挂载 `SettingsSections.tsx:63`）；lynx `Me.vue:49-98`（仅原生 `webdavAvailable = isNativeMode()`:50）。
- **三层架构**（ADR-0156 D1）：Java `WebDavClient.java`（MKCOL 幂等 409 视成功:111-120 / PUT:125 / 写后校验上传:140-151（VERIFY_MAX_ATTEMPTS=3:72）/ GET:176 / PROPFIND:191-200 / DELETE+KEEP_BACKUPS=10 轮换:75）；双薄桥 `WebDavPlugin.java`（注册 `MainActivityWebview.java:74`）与 `PictelioWebDavModule.java`（@LynxMethod ×9 :47-115，注册 `LynxRuntimeInitializer.java:82`）；TS 共享纯函数层 app `backupCore.ts`(335 行)+`backupService.ts`(306 行) 与 lynx 同名文件同源同语义（含 Lynx 无 TextEncoder 的纯 JS UTF-8，backupCore.ts:9-12，commit 3cb1a35d）。
- **工单状态**：tickets #462–#472 全 OPEN，但 T0–T10 代码均已于 `1039539f` 落地。

## B. Pictelio 侧：15 项「缺失」判定重 grep（2026-09-12，范围 `packages/{app,app-lynx,novel-export,ugoira}/src`，排除测试）

| # | pattern | 判定 | 证据 |
|---|---------|------|------|
| 1 | `saucenao\|ascii2d\|iqdb\|tineye` | 仍缺 | 0 命中 |
| 2 | `mypixiv` | 仍缺（仅类型字段） | `api/types.ts:223`、lynx `api/types.ts:175` 仅 `total_mypixiv_users` |
| 3 | `/v1/chat`、私信 | 仍缺 | 0 命中 |
| 4 | `fanbox`（-i） | 仍缺（仅外链注释） | `IllustDetail.tsx:520` |
| 5 | `aria2` | 仍缺 | 0 命中 |
| 6 | `twoPane\|双栏` | 仍缺 | 0 命中 |
| 7 | `/v2/illust/related` | 仍缺 | 端点 0；仅空态文案 `SearchResults.tsx:108` |
| 8 | `/v1/ranking` | 仍缺 | 0 命中 |
| 9 | `spotlight\|pixivision` | 仍缺 | 0 命中 |
| 10 | 标签屏蔽 | 仍缺（仅类型字段） | `is_muted`（`api/types.ts:205`、lynx `:189`） |
| 11 | 收藏加标签 | 仍缺 | app `addBookmark`（`api/illust.ts:323`）无 tags；lynx `api/illust.ts:65-69` body 仅 `{illust_id, restrict}` |
| 12 | 多账号 | 仍缺 | `切换账号\|多账号` 0 命中 |
| 13 | webview 稍后看 | 仍缺 | `packages/app/src` 0 命中（lynx `Watchlist.vue` 存在） |
| 14 | 跨作品批量下载 | 仍缺 | `PagePickerSheet.tsx:19`「批量下载 = 默认全选」= 作品级选页语义 |
| 15 | 搜索高级筛选 | 仍缺 | app `api/search.ts:20-36` 仅 `word/sort/search_target/filter`；lynx `api/search.ts:51-65` 同 |

结论：**无一旧「缺失」被这 25 提交填补**；新增的是两个全新功能域，原矩阵对应两行（网络自检、备份/云同步）改为「已具备」。

## C. 竞品侧：元数据复刷（2026-09-12 07:15 CST，`gh api repos/<owner>/<repo>`）

| 仓库 | 09-11 stars | 09-12 stars (Δ) | pushed_at | 最新 release |
|---|---|---|---|---|
| Notsfsssf/pixez-flutter | 12814 | 12822 (+8) | 2026-09-07T02:25:37Z | 0.9.109 @ 09-07 |
| CeuiLiSA/Pixiv-Shaft（默认分支 `classic`） | 7810 | 7815 (+5) | 2026-09-11T02:52:43Z | v4.9.3 @ 09-07 |
| Pixeval/Pixeval | 3138 | 3137 (−1) | 2026-09-05T08:47:51Z | 5.0.12 @ 08-21 |
| xuejianxianzun/PixivBatchDownloader | 5596 | 5597 (+1) | 2026-09-07T19:33:34Z | v19.4.1 @ 09-04 |
| asadahimeka/pixiv-viewer-app | 534 | 535 (+1) | 2026-05-01T11:38:39Z | v1.33.0 @ 04-12 |
| asadahimeka/pixiv-viewer | 770 | 771 (+1) | 2026-09-09T13:37:08Z | v1.33.0 @ 04-12 |
| ultranity/Pix-EzViewer | 1252 | 1253 (+1) | 2026-07-04T11:40:47Z | v2.2.5 @ 06-22 |
| txperl/PixivBiu | 1451 | 1452 (+1) | 2026-09-11T16:28:29Z | **v3.1.2 @ 09-11T16:09Z**（晚于二版快照） |

- **功能变化**：无。Shaft 09-11 的 3 个提交均为 bugfix（以图搜图兼容照片选择器 / 登录浏览器过滤 / 搜索页销毁回调防护）；PixivBiu v3.1.2 及其 9 个提交全部为 Windows 桌面壳窗口交互/拖拽/生命周期修复与样式。其余 6 仓 pushed_at 早于 09-11T00:00Z。
- **查漏**：`gh search repos pixiv --sort stars --limit 20`——无应纳入矩阵的新竞品（高 star 命中均为工具/库：RSSHub、gallery-dl、PixivUtil2、pixivpy 等）；边缘候补 DimensionDev/Flare（多平台社交客户端附带 Pixiv 浏览）与 DowneyRem/PixivSource（Legado 书源，非独立 App）不建议纳入。
- **竞品对比矩阵结论**：无需修订，仅元数据与 PixivBiu release 版本号更新。

---

# 2026-09-12 第二次增补（四版增量复验）

范围：三版基线 `1039539f` → 产品 HEAD `6f76bab1`（20 提交 = 搜索高级筛选域 11 + 相关作品注入域 9），无第三项功能变化。竞品侧沿用同日「2026-09-12 增补」§C（无功能推送）。取证：后台研究代理源码级核实 + `gh issue view` 工单实测；承重断言（`BOOKMARK_BANDS`、`loadRelated` 端点、`buildParams` search_target 规则、`related_injection` 键）经主会话抽查属实。

## A. 搜索高级筛选（11 提交 `7a8f41c9..efd842ab`）——P0-2 关闭

- **筛选维度**（`packages/search-core/src/filters.ts`）：
  - 期间：any / 五预设（`1d/1w/1m/6m/1y`，`PeriodPreset` filters.ts:9-14）/ 自定义起止（YYYY-MM-DD 闭区间）；日本时区换算（`period.ts:10`），1w=今天-6 天、1m/6m/1y=日历回退（`period.ts:43-58`）；custom 非法/`start>end`/`end>今天` 返回 null 不发参（`period.ts:46-51`）。**不使用 `duration` 参数**（换算成日期，`period.ts:1-7` 注释）。
  - 收藏数：**七档硬编码带宽** 10-29/30-49/50-99/100-299/300-499/500-999/1000-∞（`BOOKMARK_BANDS` filters.ts:49-57；oracle=官方 iOS 8.7.3 抓包 `/v1/search/options` bookmark_ranges，注释 filters.ts:44-48 与 `docs/research/pixiv-appapi-search-filter-params.md` §1.2 Shaft SearchFilterV3.kt L163-183）。
  - 宽高比：`landscape/portrait/square` → `ratio_pattern`（`buildParams.ts:101`，注释提醒非 Web 端参数名）；仅插画路。
  - 分辨率：最小边 px 下限 → `width_min`+`height_min` 同值（`buildParams.ts:102-105`）；UI 预设 1000/2000/3000（lynx `SearchSheet.vue:122`、webview `SearchFilterSheet.tsx` RES_OPTIONS）。
  - AI 三态覆盖：`follow/all/hide`（follow=听账号级设置）；**不注入 `search_ai_type`**（#479 裁决，`buildParams.ts:12` 注释），all→show、hide→mask 客户端处理（`ai.ts:10-14` `resolveAiMode`）。
- **参数集**（`buildParams.ts:47-107`，对照旧报告「裸四参」）：恒发 `word/filter=for_ios/merge_plain_keyword_results=true/include_translated_tag_results=true`（:48-55）+ `sort`（非热门）+ `search_target`（见下）+ `start_date/end_date` + `bookmark_num_min/max`（:80-89；**热门路径不携带** :86）+ `ratio_pattern` + `width_min/height_min`；明确不发 `duration`/`search_ai_type`/`include_potential_violation_works`（:11-12）。热门矩阵：popular-preview 无 sort、无分页、忽略收藏数，期间/比例/分辨率照常透传（:13-15）；小说路永不携带比例/分辨率（:118）。
- **search_target 行为修复**（`buildParams.ts:57-65`，对照旧行为=两端恒显式传 partial，`ce9594cf` diff 删除行）：插画端单词标签**不传**（不传 ≡ partial 且并入标题命中；显式传 partial 反而做严格 tag 匹配并忽略 merge 参数——Shaft #906）；含空格多标签传 `exact_match_for_tags`；小说端**恒显式传**（不传退化纯字面匹配、同义词不展开——#1038）。依据 `docs/research/pixiv-appapi-search-filter-params.md` §1.1/§2/§9.3、spec §6.1 表。
- **双端 UI**：webview 底部 Sheet（#477 变体 A，ReaderSettingsSheet 范式）`components/search/SearchFilterSheet.tsx:13,116`，入口=搜索栏筛选 icon+激活数徽标（`Search.tsx:271,339,375-379`），URL 六键 `fp/fd/fb/fr/fw/fa` 会话同步（`urlCodec.ts:9-40`；`fd` 优先于 `fp`、`fb`=带宽序号、follow 不落 `fa`；decode 回填支持浏览器前进/后退 `Search.tsx:158,194`），即改即搜 450ms debounce（`Search.tsx:247`）；lynx SearchSheet 折叠筛选区（`SearchSheet.vue:93-105`，scope=novel 时比例/分辨率置灰 `:100`、热门时收藏数置灰 `:101`，chips `:115-165`）。**lynx 一期无自定义日期 UI**（仅五预设）——spec §4 L102 拍板状态/参数层 custom 两端通用。
- **缓存与兜底**：缓存键 `buildCacheKey`（`cacheKey.ts:9-30`）= base + 筛选规范段，默认筛选返回裸 base，follow 不落键；webview 用作 LRU（容量 20）+ 防重入（`searchStore.ts:144,154`）。收藏数兜底 `filterByBookmarkBand`（`fallback.ts:10-20`，泛型注入 `getBookmarks` 取数器——29246f17）：区间参数对免费账号被服务端静默忽略、对 popular-preview 完全忽略（`fallback.ts:1-7` 注释），客户端按 `total_bookmarks` 本地过滤。
- **工单/验收**：#481–#484 全 CLOSED（gh 实测）；#485 CLOSED（门禁 check:all/test:all/lint:all 全绿 + webview CDP 冒烟 11/11 PASS `scripts/audit-real-interaction/search_filter_smoke.mjs` + lynx 可达性 + 引擎往返）；spec `docs/specs/search-advanced-filters.md:3` = implemented。**遗留**：agent-browser 筛选主流程 E2E 用例（spec 标注可选后续，CI 化时补）。
- **评审痕迹**：b605f946 复审修复（ADR-0155 增补 5 行、缓存与覆盖测试用例 +59/+42、触控目标、buildParams 2 行微调）；3b703cf6 oxlint 警告清零。

## B. 相关作品注入行（9 提交 `3f773575..6f76bab1`）——P1-6 关闭

- **端点**：`/v2/illust/related` 参数 `{illust_id, filter:"for_ios"}`（app `api/illust.ts:54-64`、lynx `api/illust.ts:50-56`）；`/v1/illust/related` 实测 404 端点不存在、v2 实测 200（模拟器 2026-09-12，111ee0fd 修正）；响应为标准 `PixivIllustListResponse`。
- **注入位置（webview）**：仅首页插画面板——`routes/HomePage.tsx` `IllustFeedPanel:300` 覆盖 recommended/follow/bookmarks 三 tab（`FeedTab = Exclude<HomeTab,"history">`:121），history 与小说面板不注入；交织=主列表锚点 id 卡片后 push `{relatedRow}`（`renderItems:317-328`），锚点记录于 `IllustSingleCard onClick:366-369`，消费于 `onSettled:307-314`；下拉刷新清空 `:340-342`；注入行条目跳过预取 `:353-355`。渲染组件 `components/home/RelatedStripRow.tsx`（标题+收起按钮 :47-59 + 横向滚动缩略图 :76-99 + loading shimmer :63-74）。
- **注入位置（lynx）**：recommend/follow 两 tab（`RelatedFeedTab`，`relatedInjection.ts:34`），`pages/IllustList.vue` 交织形态=**full-span list-item + 固定两行网格降级**（8 条=2 行×4 列，超出截断 :282-304；注释明言横滑容器在原生 waterfall list-item 内不可靠，spec §5.2 允许降级）；`recordAnchor:148`/`consumeAnchor:174`/`clearRows:114,136`。
- **状态机**（app `stores/relatedInjectionStore.ts`，两端同语义 `consumeRelatedAnchor:79-122`）：pendingAnchor 一次性消费、tab 不匹配保留；开关关/同锚点已有行/达 `MAX_RELATED_ANCHORS=3` 上限→不注入（:31）；**先占位 loading 骨架行**；成功→`filterFeedIllusts` 过滤（R18/R18G+屏蔽用户+AI 三态，`r18Filter.ts:37-39`）+ 排除主列表已展示 id 与锚点自身 + 截断 `RELATED_ROW_SIZE=20`（:33）；空→移除占位；失败→移除占位 + `console.warn`（:120）。缓存：webview TanStack Query staleTime 5min（:35,65-72）；lynx 模块级 Map TTL 5min + 容量 50 FIFO（`relatedInjection.ts:30-32,42-53`，d232e4c8 复审修复）。
- **开关**：`related_injection` 默认 true，双端逐字同键（app `settingsStore.ts:165-176` + UI `SettingsContent.tsx:88-109`；lynx `settingsStore.ts:56,216,297-298,475-480` + UI `Me.vue:313-314,602-611`）；关=渲染层隐藏、数据保留（`HomePage.tsx:318`/`IllustList.vue:160`）。
- **缩略图代理**（6f76bab1）：`RelatedStripRow.tsx:24-25` 注释——原生 WebView 只对 `/pixiv-img/` 代理路径注入 Referer，裸 pximg URL 403（模拟器实测）。
- **边界（非目标）**：详情页相关区、搜索/收藏/用户作品等其他列表页（spec §2）；**小说侧 Phase 2 挂账**（无官方 related 端点，同标签搜索降级语义稀释未拍板，spec §2/§7）；lynx 侧无屏蔽列表能力（`relatedInjection.ts:6` 注释声明）。
- **工单**：#487–#490 全 CLOSED（gh 实测）；**#486 spec issue 仍 OPEN**；spec L3 记录「模拟器/真机视觉批次挂账于 #490」而 #490 已 CLOSED——视觉批次证据未回写，标注为存疑。

## C. 其余 13 项缺失判定重 grep（2026-09-12，范围 `packages/{app,app-lynx,novel-export,ugoira,net-diagnostics}/src`，排除测试）

| # | pattern | 判定 | 证据 |
|---|---------|------|------|
| 1 | `saucenao\|ascii2d\|iqdb\|tineye` | 仍缺 | 0 命中 |
| 2 | `mypixiv`（非计数字段） | 仍缺 | 仅 `total_mypixiv_users` 类型字段（`api/types.ts:223`、lynx `:175`） |
| 3 | `/v1/chat\|私信\|聊天室` | 仍缺 | 0 命中 |
| 4 | `fanbox`（非外链注释） | 仍缺 | 仅 `IllustDetail.tsx:520` 外链注释 |
| 5 | `aria2` | 仍缺 | 0 命中 |
| 6 | `twoPane\|双栏` | 仍缺 | 0 命中 |
| 7 | `/v1/ranking\|ranking` | 仍缺 | 0 命中 |
| 8 | `spotlight\|pixivision` | 仍缺 | 0 命中 |
| 9 | 标签屏蔽（`blockTag\|block_tag\|标签屏蔽`；`mute` 排除 `is_muted`） | 仍缺 | 0 功能命中（现有仅用户级 blockStore） |
| 10 | 收藏加标签 | 仍缺 | app `addBookmark`（`api/illust.ts:336-341`）仅 `illust_id+restrict`；lynx（`:75-80`）同 |
| 11 | 多账号（`切换账号\|多账号`） | 仍缺 | 0 命中 |
| 12 | webview 稍后看（`watchlist\|稍后看\|追更`） | 仍缺 | `packages/app/src` 0 命中（lynx Watchlist.vue 存在） |
| 13 | `命名模板\|naming.*template` | 仍缺 | 0 命中 |

结论：**13 项全部维持**；四版关闭的两项（P0-2、P1-6）之外无任何缺失判定变化。

---

# 2026-09-14 增补（六版增量复验）

范围：四版基线 `6f76bab1` → 产品 HEAD `0d4bbe2d`（63 提交 = i18n 域 27 + 排行榜域 20 + 引擎切换线 E2E 恢复/ADR-0159 域 16，`git log --oneline 6f76bab1..HEAD | wc -l` = 63）+ 8 仓推送差分。取证：CodeGraph（`codegraph status`：1,005 文件 / 13,089 节点）定位符号与调用链 + grep 路由/端点/设置键（文件:行号）+ `gh api`（2026-09-14）。

## A. Pictelio 侧

### A1. 排行榜关闭核验（P0-1，对五版补记的独立代码取证——非转述自述）

| # | 断言 | 证据 |
|---|------|------|
| 1 | 共享包存在 | `packages/ranking-core/package.json:3` `@pictelio/ranking-core` v0.1.0；`src/` 六文件（`index/modes/buildRequest/cacheKey/date/query.ts`）；`index.ts` 导出后五模块，头注释「零 IO 纯函数单点……平台 UI、网络调用、内容过滤一律不进此包」 |
| 2 | webview `/ranking` 路由 | `packages/app/src/router.tsx:47` `{ path: "/ranking", component: Ranking }`（import `routes/Ranking` :21） |
| 3 | lynx `/ranking` 路由 | `packages/app-lynx/src/router.ts:81` `{ path: '/ranking', name: 'ranking', component: Ranking, meta: { requiresAuth: true } }`（import `pages/Ranking.vue` :57） |
| 4 | webview 推荐 Feed 横滑条入口 | `components/ranking/RankingStripEntry.tsx:151`（组件）+ `routes/HomePage.tsx:21`（import）+ `:338-341`（挂载于推荐×插画面板列表首卡之前，注释「开关由 RankingStripEntry 内部 gate（关闭时不建数据源）」） |
| 5 | lynx 推荐 tab 榜首大卡入口 | `components/RankingEntryCard.vue:1` + `pages/IllustList.vue:22`（import）+ `:254-256`（挂载于推荐 tab 内容链之前，`:256` `v-if="mode === 'recommend' && settings.rankingEntry"`） |
| 6 | 设置开关双端同键默认开 | app `stores/settingsStore.ts:32` `PREF_KEY_RANKING_ENTRY = "ranking_entry"`；lynx `stores/settingsStore.ts:58-59` `RANKING_ENTRY_KEY = "ranking_entry"`（注释「设备级开关，默认开；键与 app 逐字一致」）；设置 UI `SettingsContent.tsx:123-134`（`settings.content.rankingEntry` 开关行） |
| 7 | API 端点 | `packages/ranking-core/src/buildRequest.ts:11` `RANKING_PATH = "/v1/illust/ranking"`（头注释明确「**非** `/v1/ranking/illust`。单页 30 条」） |
| 8 | 名次保序（不走 searchMerger） | webview `stores/rankingStore.ts:4-9` 头注释：「展平页面时**严格保持页序 × 页内序**——**禁止**走 createTQFeedStore 的 merge 路径（它对 items 做 sortByDate + 去重……直接毁掉名次顺序）」「名次 = 全局下标 + 1（跨页累加，spec §5.5）」；`flattenIllusts:64-70` 实现；`RankEntry.rank:26-30`；受限条目过滤只移除不重编号（名次空洞=裁决 #7 预期）。lynx `pages/Ranking.vue:3`：「名次 = 渲染流下标 + 1，跨页保序」（数据层 `primitives/createRankingFeed.ts` 复用 createMixFeed 单源） |
| 9 | 7 档维度 + 日期纯函数 | `ranking-core/src/modes.ts:37-45` `RANK_MODES` 七档（`day/week/month/week_rookie/week_original/day_r18/week_r18g`）；`date.ts:1-11` 展示格式化不含 Intl、不经本地时区（Lynx 无 Intl） |

辅助：spec `docs/specs/ranking.md:3` 状态 `implemented`（2026-09-13）；ADR-0158 存在（`docs/adr/ADR-0158-ranking-information-architecture.md`）。工单备注：#512–#519 在 issue tracker 仍全 OPEN（`gh issue view` 2026-09-14 实测），代码已全落地——与 WebDAV #462–#472 同模式。

### A2. i18n 中英双语（本轮新关闭项，四版判定 ❌ → ✅）

- i18n 域 27 提交（`2b17c1db` 原型 → `9f9e890b`/`c8fd78e1` spec → `a9c2ae8d` 字典分域重构 → `3db09ad4`…`6e35f40f` B1–B11 批次，#500–#511）。
- 双端字典分域：app `packages/app/src/i18n/locales/{en,zh-CN}/`（每语言 8 文件：`core/error/routes/settings/time/components1/components2/index.ts`，实测 `ls`）；lynx `packages/app-lynx/src/i18n/locales/`（`find` 实测存在）。
- 语言键双端逐字同键：app `i18n/index.ts:19` `PREF_KEY_LANGUAGE = "settings_language"`；lynx `stores/settingsStore.ts` `LANGUAGE_KEY = "settings_language"`（注释「设备级共享键，与 app i18n PREF_KEY_LANGUAGE 逐字一致」）。
- 设置入口：app `components/settings/SettingsAppearance.tsx` 含语言项；E2E：`b0e6a702` agent-browser 语言切换（即时切换/重载持久化/还原）。
- ADR-0157 存在（`docs/adr/ADR-0157-i18n-selection-and-loading.md`）；spec `docs/specs/i18n.md` 存在。

### A3. 12 项缺失判定重 grep（2026-09-14，范围 `packages/{app,app-lynx}/src`，排除测试）

| # | 项 | pattern | 判定 | 证据 |
|---|---|---------|------|------|
| 1 | 以图搜图 | `saucenao\|ascii2d\|iqdb\|tineye`（-i） | 仍缺 | 0 命中 |
| 2 | 私信(消息) | `/v1/chat\|私信\|聊天室` | 仍缺 | 0 命中 |
| 3 | FANBOX | `fanbox`（-i） | 仍缺（仅外链注释） | `IllustDetail.tsx:525`「External links (fanbox, twitter, etc.)」（v4 记录 :520，i18n 抽取致行号漂移） |
| 4 | aria2/外部下载器 | `aria2`（-i） | 仍缺 | 0 命中 |
| 5 | 双栏(平板双列) | `twoPane\|two-pane\|双栏`（-i） | 仍缺 | 0 命中 |
| 6 | 特辑(专题/pinned) | `spotlight\|pixivision\|特辑`（-i） | 仍缺 | 0 命中 |
| 7 | 标签屏蔽 | `blockTag\|block_tag\|标签屏蔽\|屏蔽标签`（-i）；`mute` 排除 `is_muted` | 仍缺 | 0 功能命中（现有仅用户级 blockStore 与类型字段 `is_muted`） |
| 8 | 收藏加标签 | `addBookmark` 签名检查 | 仍缺 | app `api/illust.ts:336-341` body 仅 `{illust_id, restrict}`；lynx `api/illust.ts:75-80` body 仅 `{illust_id, restrict: "public"}`；两端均无 `tags` |
| 9 | 多账号切换 | `切换账号\|多账号\|switchAccount\|accountSwitch` | 仍缺 | 0 命中 |
| 10 | webview 稍后看 | `watchlist\|稍后看\|追更`（仅 `packages/app/src`） | 仍缺 | 0 命中（lynx `Watchlist.vue` 在，不属 webview） |
| 11 | 下载命名模板 | `命名模板\|naming.*template\|nameTemplate\|filenameTemplate`（-i） | 仍缺 | 0 命中 |
| 12 | 好P友 | `mypixiv`（-i） | 仍缺（仅类型字段） | app `api/types.ts:223`、lynx `api/types.ts:175` 仅 `total_mypixiv_users` |

结论：**12 项全部维持**；六版关闭的两项（排行榜、i18n）之外无任何缺失判定变化。

### A4. v3/v4 已关闭项回归抽查（8 项全在位）

| 项 | 证据 |
|---|---|
| 搜索高级筛选 | `packages/search-core/src/buildParams.ts:87` `params.bookmark_num_min = ...`（包六文件在位） |
| 相关作品注入 | `/v2/illust/related` app `api/illust.ts:62`、lynx `api/illust.ts:52` |
| 图片保存 | `components/illust/PagePickerSheet.tsx`、`utils/galleryDownload.ts` 在位 |
| Ugoira 导出 | `UGOIRA_FORMATS`（`SettingsDownload.tsx:4,53`）+ `UgoiraExporter.java:43` |
| 小说导出 | `packages/novel-export/src/index.ts` 在位（`formats.ts` 含 epub/docx/pdf） |
| WebDAV 备份 | `WebDavClient.java`、`SettingsWebdav.tsx` 在位 |
| 网络自检 | `CHECK_PLAN`（`packages/net-diagnostics/src/plan.ts:21`） |
| i18n（本轮新增关闭项） | 见 §A2 |

### A5. 新功能面变化盘点（`git diff --name-only --diff-filter=A 6f76bab1..HEAD`）

- 新增源码文件仅三类：①排行榜域 22 个（ranking-core 六文件 + 双端路由/页面/store/api/组件 + `createRankingFeed`/`rankingDate`/`rankingEntryState`/`rankingNotice`/`createDeferredMount`/`fetchDirection` 支撑件）；②i18n 域（双端 `i18n/index.ts` + `locales/`）；③零散支撑工具（`api/urlGuard.ts`、`utils/dateFormat.ts` 双端、`utils/nativeUrl.ts`、`ui/FilterChip.tsx`）。
- 原生侧：`git diff --stat 6f76bab1..HEAD -- packages/app/android/` 仅 5 文件——`PluginNetworkDispatcher.java`（新增 +63，ADR-0159 插件桥线程卸载）+ 其测试 + `PixivApiCore.java`/`PixivApiPlugin.java`/`ClientInfoPlugin.java` 改动（同属 #521/#522 复审修复）。**性能修复，非新用户功能；无新 Capacitor/Lynx 插件注册**。
- 路由 diff 仅 `/ranking`（双端）；设置键 diff 仅 `ranking_entry` + `settings_language`。无第四项用户可感知功能变化。

## B. 竞品侧：推送差分（2026-09-12T00:00:00Z 起，`gh api repos/<owner>/<repo>/commits?since=2026-09-12T00:00:00Z`，2026-09-14 执行）

| 仓库 | 09-12 后提交 | 功能级变化 | 元数据（2026-09-14） |
|---|---|---|---|
| Notsfsssf/pixez-flutter | 4（09-12） | **无新功能**：#1341 评论页视觉层级美化（PR 标题 feat(comment_page) 但内容=布局微调）、#1343 作品卡角标样式调整、#1342 关于页贡献者卡对齐修复、`7f89bc86` iOS 版本号（仅 pubspec.yaml+pbxproj，7 行） | ★12,837，pushed 09-12，最新 release 仍 0.9.109 @ 09-07 |
| CeuiLiSA/Pixiv-Shaft | 0 | 无推送（检查命令返回空） | ★7,827，pushed 09-11 |
| Pixeval/Pixeval | 0 | 无推送 | ★3,136，pushed 09-05 |
| xuejianxianzun/PixivBatchDownloader | 3（09-12/13） | **既有功能增强，无新增能力域**：`c2798516` 批量关注用户功能优化（+716/−246，`API.ts`/`BG.ts`/`InitFollowingPage.ts`；CHANGELOG 增量：跳过不存在用户、新增一种可导入数据格式、每日关注上限 1000→500）；`9ec1b2d6` 收藏列表导出保存更多数据（+107/−26，`ExportBookmarkListAction.ts`）；`3ec0426f` 提示文案优化（非功能） | ★5,606，pushed 09-13，最新 release 仍 v19.4.1 @ 09-04 |
| asadahimeka/pixiv-viewer-app | 5（09-13） | **无新功能**：3× bugfix（`8cf0f4e9` polyfill+locales 重建、`42637258` 主题初始化+聊天室框 5 行、`324d62f3` SAF 插件+清缓存页）、`ba23b532` 翻译更新、`f086323d` web 版同步（同步源 = web 仓 style fixes） | ★537，pushed 09-13，最新 release 仍 v1.33.0 @ 04-12 |
| asadahimeka/pixiv-viewer（Web 版） | 1（09-13） | 无：`708c20aa` `fix: style fixes`（72+/30−，styl 样式 + Artwork 视图） | ★775，pushed 09-13 |
| ultranity/Pix-EzViewer | 0 | 无推送 | ★1,252，pushed 07-04 |
| txperl/PixivBiu | 0 | 无推送 | ★1,452，pushed 09-11 |

- **Release 侧**：7 仓（除官方基线外）`gh api repos/<repo>/releases?per_page=1` 实测均无 09-12 后新发布（最新分别为 0.9.109@09-07 / v4.9.3@09-07 / 5.0.12@08-21 / v19.4.1@09-04 / v1.33.0@04-12 / v2.2.5@06-22 / v3.1.2@09-11）。
- **对矩阵的影响**：无。pixez 四笔为视觉微调（其评论/卡片能力矩阵本就 ✅）；PBD 两笔增强其既有批量关注与收藏导出（PBD 在「关注/取关」列本就 ✅、批量维度本就 ✅ 全维度、导出本就有 CSV）；viewer 双仓为修复。**第三节矩阵无需修订**。
- **查漏**：`gh search repos pixiv --sort stars --limit 15`——高星命中均为工具/库（RSSHub ★46k、gallery-dl、work_crawler、PixivUtil2、pixivpy、Pixiv-Nginx、webextension-pixiv-toolkit、cq-picsearcher-bot、Flare 等），与「2026-09-12 增补」§C 结论一致；`Notsfsssf/Pix-EzViewer`（★2,612）为已停维护旧版（矩阵跟踪的是 ultranity 续维护版）。**无应纳入矩阵的新竞品**。

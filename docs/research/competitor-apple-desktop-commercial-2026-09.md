# 竞品调研：Apple 平台 / 桌面 / 商业闭源 / 官方 App 侧（2026-09）

> 取数时间：**2026-09-27 14:09–14:20 CST**
> 取数工具：`gh` CLI（GitHub REST API v3 / code search / git tree）、Apple iTunes Search & Lookup API（官方）、Google Play 官方详情页、pixiv 官方站点与帮助中心（Zendesk HC API v2）、各项目官网与其自有 API。
> 本文件为**并行调研 worker 的独立产出**，只覆盖「我们没有的平台」这一侧（Apple / 桌面 / 商业闭源 / 官方 App）。

---

## 0. 可信度体系声明

闭源商业 App 拿不到源码，只能依据**官方文案 + 版本更新记录 + 用户可见行为**。本文对每条结论标注可信度：

| 等级 | 含义 | 取证方式 |
|------|------|----------|
| **高** | 一手可验证的机器可读事实 | GitHub API 返回值、release notes 原文、iTunes Lookup JSON 字段、Google Play 官方详情页字段、官方 API 返回值、官方条款原文 |
| **中** | 一手来源但属「自述」性质，未经运行时验证 | 官方 README / 官网文案 / 商店描述 / 隐私政策（含厂商自我声明，措辞可能美化） |
| **低** | 依据现象推断、来源不完整、或来源已失效 | 商店下架推断、无法定位一手页面的历史项目、闭源 App 的间接行为推断 |

**本文件中所有「版本号 / 日期 / 星数」均为 2026-09-27 当日实测值**，不引用任何未重新核实的记忆。

---

## 1. Pixiv-SwiftUI（Apple 多端新势力）

| 项 | 值 | 可信度 |
|---|---|---|
| URL | https://github.com/Eslzzyl/Pixiv-SwiftUI | 高 |
| 平台 | iOS / iPadOS / macOS（**无 Android、无 Windows/Linux**） | 高 |
| 技术栈 | SwiftUI + SwiftData + Kingfisher + GzipSwift + Kanna | 高 |
| 许可证 | **AGPL-3.0** | 高 |
| 最新版本 | **v0.16.1（2026-09-26，预发布 prerelease=true）**；最新稳定版 v0.16.0（2026-09-16） | 高 |
| 最近提交 | 2026-09-26（`fbbb1b02 chore: 更新版本号到 0.16.1`） | 高 |
| 星数 / 未关 issue | 107 stars / 9 forks / 2 open issues；仓库创建于 **2026-01-04**（不到一年） | 高 |
| 分发渠道 | GitHub Release **ipa + dmg 侧载**；`brew tap eslzzyl/tap && brew install --cask pixiv-swiftui`；**未上架 App Store** | 高 |
| 最低系统 | 工程值 `IPHONEOS_DEPLOYMENT_TARGET = 17.0`、`MACOSX_DEPLOYMENT_TARGET = 14.0`；README 自述 iOS 26/27、iOS 18 已测，iOS 17 与 macOS 14/15「理论上支持但没测」；**因 SwiftData 兼容性不支持更旧系统** | 高（工程文件）/ 中（实测矩阵） |

### 1.1 README 自述的关键声明（务必照抄其措辞）

- **Vibe Coding**（可信度：高，README 原文）：

  > 这是一个实验性的 Vibe Coding 项目：项目的**所有**代码均由大语言模型生成。开发者会尽力进行测试，但不能保证项目的可靠性。

- **免责声明**：「本项目仅供学习研究使用，与 Pixiv 官方无任何关联。」

### 1.2 编译依赖（易踩坑点）

README「编译指南」明确：`Resources/tags.json` **缺失则编译报错**。准备方式二选一：跑 `pixiv-tags/export_tags.py` 自动生成，或手建 `{"timestamp": "2026-01-01T00:00:00", "tags": {}}`。README 称「Release 中发布的文件包含了完整的优化翻译数据」（可信度：高）。

macOS 包**未签名**，官方给出的绕过方式是 `sudo xattr -rd com.apple.quarantine /Applications/Pixiv-SwiftUI.app`（可信度：高）。

### 1.3 功能清单（README 原文条目，可信度：高）

**插画与漫画**：推荐流（推荐/热门）、排行榜（日/周/月 + 性别分类）、ugoira 动图（自动播放 + 手动播放）、收藏管理（公开/私密）、评论系统（查看 + 回复）、用户主页（插画/漫画/小说/关注列表/用户信息）。

**小说**：推荐与排行榜、阅读器（流畅阅读 + 进度记录）、**沉浸式翻译（可配置翻译服务 + 双语对照）**、系列管理。

**搜索**：综合搜索（插画/小说/用户）、亮点（Pixivision 特辑）、趋势标签、搜索历史。

**翻译**：插画标题/简介、小说标题/简介、用户简介、**所有评论**；多翻译服务（主/备）；智能语言检测；双语对照阅读；**针对 LLM 在小说场景的特别优化——提交多段结合上下文翻译**。

**网络**：README 写「HTTP/3 直连模式：优先使用 HTTP/3 直连访问 Pixiv」。

**下载与本地**：批量下载插画至相册、浏览历史、**数据导入/导出（兼容 pixez 格式）**、**实验性的插画收藏永久缓存（避免作者删图导致插画丢失）**。

**过滤**：**R-18 / R-18G / 剧透 / AI 四类过滤，每类四态：正常显示、模糊显示、屏蔽、仅显示**。

### 1.4 差异化子系统与实现方式（源码路径核实，可信度：高）

| 子系统 | 实现方式 | 证据 |
|---|---|---|
| **直连网络栈（历史包袱 → 已重构）** | v0.16.1 引入 **HTTP/3 (QUIC)** 直连，**替代原有 SNI 直连**，以解决 Pixiv 调整策略导致的 403；另有独立 DNS 解析器、连接池、HTTP/3 响应解析器 | `Pixiv-SwiftUI/Core/Network/PixivHTTP3ConnectionPool.cs`… 具体为 `PixivHTTP3ConnectionPool.swift` / `PixivHTTP3ResponseParser.swift` / `PixivDirectConnection.swift` / `PixivDirectDNSResolver.swift`（git tree 核实）；release v0.16.1 notes |
| **图片域名切换** | 支持在「Pixiv 官方源」与「镜像站」之间切换，官方措辞「也许可以提升插画加载速度」 | v0.16.1 release notes |
| **图片内文字翻译** | **Apple Vision OCR** 识别图片内文字，显示原文 + 译文 | v0.15.0 release notes |
| **VLM 图片解释** | 视觉语言模型分析插画内容；设置中可配模型 / 温度 / 图像细节并测试服务 | v0.15.0 release notes |
| **小说上下文批量翻译** | `NovelBatchTranslator.swift` + 三层翻译缓存（`TranslationCache` / `TranslationCacheStore` / `NovelTranslationCacheStore` / `CachedTranslation`）+ `TagTranslationService.swift` | git tree 核实 |
| **四态内容过滤** | 首次启动向导中含独立 `OnboardingFilterStepView` 步骤 | git tree 核实 + README |
| **实验性永久收藏缓存** | README 自述为「实验性」，动机是防作者删图 | README |
| **多账号** | `AccountStore.swift` + `AccountCommands.swift`；v0.15.0 修了「切换账号时收藏、关注、下载和阅读等异步状态串用或显示旧数据」 | git tree + v0.15.0 notes |
| **macOS 网页登录凭据导出面板** | v0.16.0 新增（配合 web 登录流程） | v0.16.0 notes |

### 1.5 已知短板 / 限制（自述 + issue 主题，可信度：高）

1. **发热问题，且官方主动劝退**：v0.16.1 release 正文第一句即「此版本有较严重的发热问题，请暂时不要升级。已升级的用户请考虑降级到 0.16.0」。
2. **直连方案是持续对抗性工程**：v0.16.1 直连层做了「底层重构」；issue #31（2026-09-24 开，2026-09-26 关）「无法登录」正文：「现在登录会报 403 错误，主页也无法浏览。重置登录信息也无法登录」（iOS 27 / v0.16.0 / iPhone 13 Pro）。同类 issue #26「自动退出登陆」。
3. **安装门槛**：必须侧载（AltStore），macOS 包未签名需手动 `xattr`。
4. **最低系统偏高**：因 SwiftData 兼容性无法向下支持（README 自述）。
5. **能力缺口自认**：open issue #35「[Feature]: 支持 Web 端插画与漫画发现（Discovery）」、#28「[Feature]: 更多贴合官方 App 的阅读优化体验」。
6. **Vibe Coding 免责声明**：作者自述无法保证可靠性。
7. **迭代节奏是破坏性的**：v0.16.0 详情页交互与导航大重构、v0.16.1 网络层底层重构，均标注「如有网络连接相关问题可通过 issue 反馈」。
8. **本地化依赖 LLM**：v0.16.0 新增繁体中文与日文，译文「由 GPT-5.6-Luna 起草并由 GPT-5.6-Terra 润色」。
9. **性能定位是「近三年设备」**：v0.14.4 优化瀑布流性能时称「在 iPhone 17 真机上实测已经基本不会掉帧」。

### 1.6 商业模式

**完全免费开源（AGPL-3.0），零内购、零订阅**（可信度：高 — LICENSE + 无任何商业化描述）。获客路径为 GitHub + Homebrew tap + 微博式社区。

---

## 2. P站助手 / PixHelper（子非语）— 唯一真正对标的商业闭源双端 App

| 项 | 值 | 可信度 |
|---|---|---|
| 官网 | https://www.pivlite.com （canonical 自述 `P站助手（PixHelper）`） | 高 |
| 主体 | 杭州子非语网络科技有限公司；App Store 开发者 **泽勇 周**；Google Play 开发者 **周泽勇**（zzycami@foxmail.com，杭州市余杭区） | 高 |
| 平台 | **iOS + Android 双端**（官网 features 页原文「支持 iOS 与 Android」） | 高 |
| iOS | `com.bravedefault.ehreader.VIP`，**¥28.00 买断**，v3.8.9（2026-08-23），首次发布 2016-10-04，最低 iOS 13.0，包体 ~140 MB | 高 |
| iOS 预览版 | `com.bravedefault.ehreader.china`，**免费**，v3.8.10（2026-08-30） | 高 |
| Android | `com.bravedefault.pixivlite_android`，Google Play 评分 **3.8**（12 条评价）、**100+ 次下载**，页面标注更新日期 **2026-09-18** | 高 |
| Android 直装包 | 官网自有 API `https://api.pivlite.com/version/latest` 返回 v2.3.21.201（2026-09-26），APK 托管在 `https://pivlite-img.work/`；另有腾讯应用宝渠道 | 高 |
| 技术栈 | **不可知**（闭源，无公开证据） | — |

> ⚠️ **名称校正**：本次调研未找到任何证据表明「P站助手」的开发者叫「PixHelper」。「PixHelper」是官网自己在同一句里给出的**英文别称**（`alternateName: "PixHelper"`，schema.org JSON-LD）。App Store / Google Play 上的开发者主体是**泽勇 周 / 周泽勇**，公司主体是**杭州子非语网络科技有限公司**。「子非鱼」应为「子非语」的记误。可信度：高（三处独立一手来源互证）。

### 2.1 功能清单（官网 `/features` 页文案，逐条原文，可信度：中（厂商自述））

- **浏览与发现**：国内直连 Pixiv（无需额外网络工具）；插画/漫画/小说分区浏览，排行榜、推荐、最新更新；关键词 + 标签搜索作品与画师，关注画师动态，管理收藏与书签。
- **下载与管理**：单张/批量下载原图，**下载任务可在通知栏查看进度**；动图（Ugoira）可下载并**本地导出为 WebP 或 GIF**，也可**设为循环播放的动态壁纸**；多页漫画批量建任务（下载完可用「极简漫画」打开阅读，需另装）；**收藏列表勾选批量入队，可调同时下载任务数**；下载管理器（速度/进度/文件大小、移除任务、删本地文件）。
- **以图搜图**：上传或选择本地图片，**在 Pixiv 内搜索视觉相似作品**（找图源）。
- **AI 翻译**：漫画翻译（**智能识别漫画图中文字区域，在原位替换为译文**）；小说翻译（支持 Pixiv 小说与杂谈，**保留原文排版**、**流式输出进度**、不满意可重新翻译）；**「翻译能力由服务端 AI 提供（DeepSeek 等大模型）；部分功能按字数或次数计费，会员用户享折扣」**。
- **图片高清化**：**本机高清化**（用设备算力本地即时处理，大图自动缩放保稳定，适合快速预览）；**云端高清化**（提交服务器队列处理，适合高分辨率大图，完成后下载到本机，可与原图对比）；**批量高清**（多张批量提交，本机结果可自动存到相册指定目录）。
- **其他**：**图片代理加速（可选订阅图片代理服务，通过 CDN 网络加速 Pixiv 图片加载）**；多语言与主题；Android 需 7.0 (API 24) 及以上。

官网 features 页自带免责声明：「部分 AI 翻译、云端高清化、图片代理加速等功能**可能需要登录账号或开通会员/充值后使用**，具体以应用内说明为准。」

### 2.2 商业模式与付费点（可信度：中高混合）

| 付费点 | 证据 | 等级 |
|---|---|---|
| iOS **买断 ¥28** | iTunes Lookup `formattedPrice` | 高 |
| AI 翻译**按字数/次数计费** + 会员折扣 | 官网 features 原文 | 中 |
| **云端高清化**（本机高清化免费） | 官网 features 原文 + release 2.3.7.178/180（2026-06-28/29「根据用户反馈增加**基于服务器的高清化图片服务**」） | 中高 |
| **图片代理加速订阅**（CDN） | 官网 features 原文 | 中 |
| 广告变现 | 隐私政策列出集成广告 SDK：鲸鸿动能、天目Ads、快手联盟、Suyi 聚合广告、优量汇，收集 OAID/MAC/IMEI/ANDROID ID | 中高 |

> 具体会员价格档位**在公开渠道未找到**（应用内才可见）→ **未找到证据**。

### 2.3 直连方案（可信度：高，release notes 原文）

- Google Play「新变化」栏：「**API 默认走加密通道，失败时改走中继，不再使用域名前置**」。
- release 2.3.21.201（2026-09-26）：「优化**未开启图片代理时的**图片加载速度」「**自动选用更快的图片节点**，并减少列表缩略图流量」「启动时预热图片连接」。
- release 2.3.8.183（2026-07-03）：「修复下载卡在 99% 无法完成的问题（**部分图片代理返回长度异常**）」→ 印证图片代理是默认路径之一。
- 维护强度：官网版本历史 API 暴露 **20 条 Android 版本记录，2026-05-10 → 2026-09-26**（4.5 个月），其中 4 个版本是「紧急修复 app 崩溃问题……大概必须更新了，不然旧 app 无法使用」（2026-09-16 / 09-17 前后）。
- 隐私政策还提到「浏览器扩展」形态（可信度：中，官网文案与实际提供渠道对不上，见短板）。

### 2.4 已知短板 / 限制（可信度：中高）

1. **发热**（release 2.3.13.193 / 2.3.12.192「紧急修复 app 崩溃问题」）。
2. **HarmonyOS 明确未修**：release 2.3.7.180 原文「鸿蒙 4.2 保存不了问题还未解决，该系统的同学别更新！」
3. **下载体系长期是 bug 温床**：SAF 保存速度、60 秒超时、后台恢复、gif 导出色偏、下载卡 99%（多个版本反复修）。release 2.3.9.185 承认「多图默认已改为统一文件夹」是破坏性默认变更。
4. **小说系列分页**曾只能加载一页（2.3.10.190 修复，每页约 30 章）；追更列表翻页稳定性（同期修复）。
5. **内容审核强度低**：App Store 分级含「偶尔/轻微的色情内容或裸露」「成人或性暗示题材」「卡通或幻想暴力」「惊悚或恐怖」；Google Play「12 岁以上 / 性影射」。
6. **评分极低**：Google Play 3.8 / 12 条评价 / 100+ 次下载；官网 JSON-LD 自报 `aggregateRating 3.6 / 4723 条`（**注意：自报聚合评分与 Play 实际 12 条评价严重不符，可信度低，仅作参考**）。
7. **隐私面宽**：官方隐私政策自述收集 MAC/IMEI/ANDROID ID/ICCID/陀螺仪/加速度/重力 + 5 个广告 SDK + Bugly。
8. **形态声称不一致**：官网隐私政策提到「浏览器扩展」，但 App Store / Play / 应用宝 / 官网四个渠道都**没有浏览器扩展的下载入口** → **未找到证据（低）**。
9. **无上架 Google Play 之外的开源/可审计路径**：Android 包只能侧载或走 Play。

### 2.5 旧评价里的结构性抱怨（Google Play 公开评价，可信度：高，但时间久远）

- 2019-10-18（21 人觉得有用）：「界面简洁，就是**不能下载原图，或者下载的原图没有 P 站官方客户端的原图大**，iOS 就没有这样的情况」→ 反映**代理/直连下的原图完整性**是老问题。
- 2021-03-19：「阔以，有待改进，**天下没有免费的午餐，付费版还是比免费的好**」→ 佐证存在付费档。
- 2022-09-02：「内部网页登录加载不出，外部网页只有 pixiv 和 p站助手 lite 登录跳转」→ 登录链路是长期痛点。

---

## 3. Pixeval（Windows 桌面 + 跨平台 + MCP）

| 项 | 值 | 可信度 |
|---|---|---|
| URL | https://github.com/Pixeval/Pixeval ／ 官网 https://pixeval.github.io | 高 |
| 平台 | **Windows / macOS / Linux / Android 16 (API 36)+ / iOS 13+**（README「支持平台」） | 高 |
| 技术栈 | **.NET 10（`global.json` sdk `10.0.302`）+ Avalonia `12.1.3`** + FluentIcons | 高 |
| 许可证 | **GPL-3.0** | 高 |
| 最新版本 | **5.0.12（2026-08-21）** | 高 |
| 最近提交 | **2026-09-27**（仓库 `pushed_at`）— 仍在活跃开发，比最新 tag 晚约 5 周 | 高 |
| 星数 / 未关 issue | **3156 stars**（本轮调研中星数最高）/ 10 open issues；仓库创建于 2019-12-02 | 高 |
| 分发渠道 | **Microsoft Store**（`9p1rzl9z8454`）+ GitHub Release（Windows `.exe`/`.zip`、macOS `.pkg`/`.zip`、Linux `.AppImage`、Android `.apk`）+ **自托管 Homebrew tap**（`Pixeval/homebrew-tap`，`pivlite` 无关） | 高 |
| 迁移历史 | README 明确：「基于 Avalonia 的 Pixeval 正在开发中，而**旧的 WPF/WinUI3 版本不再进行大量维护**」 | 高 |

> ⚠️ 官网 pixeval.github.io 内容**已过期**：仍写「基于 .NET 8 和 WinUI 3」「仅支持 Windows 10」。以仓库 README + `global.json` 为准。

### 3.1 功能清单（5.0.x release notes 原文，可信度：高）

**较 WinUI3 版本更新内容（5.0.12 原文）**：

- 更流畅、立即响应的 UI，更少崩溃错误
- **更完整的 Pixiv API（例如系列作品、高级搜索参数等）**
- **内存泄露修复**（关闭页面后一段时间，或强制回收后内存可以回到打开页面前水平）
- **稍后再看（Watch Later）**：不用点开或收藏图片，下次也能方便找到之前想看的作品
- **订阅下载**：每次打开 Pixeval，**自动例行获取最新指定列表作品，并下载**
- **自动播放**：指定每 N 秒自动切换到下一张图
- **连续看图**：将图集所有图片同时显示在屏幕中（免翻页）
- **跨会话缓存**：**关闭软件后图片缓存依旧保留在磁盘上**，不用下载也能快速回看图片
- **卡片式主页**：自定义最关注的列表并在主页突出显示
- **开启 MCP 服务器**：让 AI 调用 Pixeval 功能帮你收集分析作品
- 更多下载宏，下载宏支持格式化符号，更高度自定义下载路径
- 筛选语句提示（不用再打开帮助页对照）
- 自定义导航栏（关闭/折叠不需要的功能）
- 更模块化的功能：**WebP、PDF 格式下载移到扩展功能**
- **开发自己的扩展**：不一定需要 C#，会用 C++/Python 也可以开发

### 3.2 差异化子系统与实现方式

| 子系统 | 实现方式 | 证据 | 等级 |
|---|---|---|---|
| **MCP server（进程内 Streamable HTTP）** | Pixeval 桌面进程内用 ASP.NET Core **Kestrel 只监听 `127.0.0.1:{port}/mcp`**，默认端口 **52163**，`WithHttpTransport(Stateless = true)`；`src/Pixeval.Mcp` 只放协议层（**不得引用主项目**），主项目在 `src/Pixeval/Models/McpServer` 实现 `IPixevalMcpRuntime`；**仅 Desktop 启动**，Android/iOS/Browser 不启动 | `src/Pixeval.Mcp/PixevalMcpHttpServer.cs`（`DefaultPort = 52163`、`DefaultPath = "/mcp"`）、`src/Pixeval/i18n/zh-Hans/McpHelp.md`、`.agents/skills/pixeval-mcp/SKILL.md` | 高 |
| **MCP 工具集（47 个）** | 只读 `PixevalMcpReadTools.cs` 33 个：`status` `capabilities` `help` `more`(cursor 续读) `download_macro` `analyze_download_macro` `analyze_work_filter` `history` `extensions` `settings_summary` `novel_content` `saucenao_search` `search_illustrations` `search_novels` `recommended_works` `new_works` `following_works` `posts` `my_pixiv_works` `related_works` `series_watchlist` `works` `users` `related_users` `thumbnails` `ranking` `bookmarks` `bookmark_tags` `trending_tags` `search_users` `recommended_users` `following_users` `followers` `my_pixiv_users` `spotlight` `comments` `comment_replies` `download_tasks`；写入 `PixevalMcpWriteTools.cs` 11 个：`set_download_macro` `add_comment` `delete_comment` `set_bookmark` `set_watch_later` `follow_user` `queue_download` `control_download` `add_subscription` `remove_subscription` `sync_subscriptions` | 源码 grep（`[McpServerTool(Name = ...]`） | 高 |
| **MCP 资源（7 个）** | `pixeval://me`、`pixeval://illust/{id}`、`pixeval://illust/{id}/thumbnail/{size}`、`pixeval://novel/{id}`、`pixeval://novel/{id}/thumbnail/{size}`、`pixeval://user/{id}`；缩略图二进制受设置中的大小上限约束 | `src/Pixeval.Mcp/PixevalMcpResources.cs` | 高 |
| **MCP 安全设计** | **写工具默认关闭**，需设置里显式开启并经 `EnsureWriteToolsEnabled`；只读工具可读本地状态但**不暴露登录 token、cookie、代理地址、SauceNAO key、扩展设置值或不必要绝对路径**；`settings_summary` 只返回脱敏摘要；只监听回环，局域网/公网不可访问；**不提供独立 stdio exe** | `SKILL.md` 架构边界 + `McpHelp.md` | 高 |
| **MCP 游标分页** | 自造游标 `pixeval:{kind}:{engineGuid:N}`（明确「不要使用 Pixiv 官方分页语义」），`count` 默认 20、钳制在 `1..100`（不用 `limit`）；列表返回 `hasMore`/`nextCursor`，续读统一走 `more(cursor, count)` | `SKILL.md`「工具设计」 | 高 |
| **筛选语句引擎** | 独立程序集 `src/Pixeval.Filters`：`FilterLanguage` + `Nodes/FilterNode` / `FilterGroupNode` / `FilterLogicalOperator`，配 `Analysis/`（`FilterDiagnostic`、`FilterCompletionItem`、`FilterValueCompletionProvider`）实现**语句诊断与补全**；MCP 也暴露 `analyze_work_filter` | git tree 核实 | 高 |
| **插件 / 扩展系统** | AOT 插件：`Pixeval.Extensions`（跨语言扩展框架）、`.Formats`（WebP/PDF 下载格式）、`.ImageTransformers`（**AI 提升画质**）、`.Translators`（百度 / DeepL / DeepLX / **Ollama 本地大模型翻译**）、`.Downloaders`（**Aria2 转发**） | 各 Extensions 仓库 + 4.3.18 release notes | 高 |
| **跨会话缓存** | 独立 `src/Pixeval.Caching` 程序集（仓库描述：「探索统一、快速、低内存占用的缓存可能性」）+ `cache优化，防止频繁调用 EnumerateCacheFiles`（PR #914） | 5.0.12 notes + PR #914 + `Pixeval/Pixeval.Caching` 仓库描述 | 高 |
| **桌面快捷键** | `src/Pixeval/Utilities/KeyboardShortcut.cs` + `src/Pixeval.Tests/KeyboardShortcutTest.cs`；`CreatePlatformCommandGesture` 抽象跨平台 ⌘/Ctrl，源码可见 Cmd+C / Cmd+V 分支 | 源码核实（**具体全量键位未在 README 公开 → 未找到证据**） | 高（存在）/ 低（键位表） |

### 3.3 已知短板 / 限制（issue 主题，可信度：高）

1. **Android 平台被自己降级**：5.0.12 notes 原文「由于界面按照宽屏设计，**Android 仅建议在宽屏的 Android Pad 上使用**」→ 桌面宽屏设计与移动端冲突。
2. **订阅下载不稳**：open issue **#935（2026-09-18）「无法同步下载收藏订阅内容」**——而「订阅下载」正是其主推差异化功能。
3. **稳定性**：open issue **#933（2026-09-13）「浏览图片时卡顿后崩溃」**；**#932（2026-09-13→09-10 关闭）「在「关注新作」页面中，打开图片的新标签页进行预览时，可以稳定触发崩溃」**。
4. **性能投诉**：#918（2026-08-14）「客户端交互极其卡顿」。
5. **直连慢**：#925（2026-08-23）「收藏时自动下载功能没有了；**直连下图片加载/下载速度慢**」；#928（2026-09-01）「代理」。
6. **UWP 版功能回退**：#919（2026-08-15）「UWP 最近两个版本只能关键字搜索」。
7. **小说细节持续欠债**：#930「小说封面问题，至少在一部分小说里没有效果」；#926「小说阅读页面浅色模式下，默认白色字体看不清」；#923「增加小说封面图的下载」。
8. **广告 / 数据自证**：#920「能把 powerful pixiv downloader 作为插件加入软件吗？」→ 用户主动要求**广告下载器**。
9. **flatpak 需求未被官方满足**：#927（2026-08-30→09-05 关闭）「flatpak 软件包」；同期 PR #924「deprecate homebrew formula support for linux hosts」→ **Linux 分发在收缩**。
10. **历史包袱**：4.3.23（2026-04-30）「临时修复了域前置失效的问题」——5.0.0（2026-08）前仍是 WinUI3 时代方案。

### 3.4 商业模式

**完全免费 + GPL-3.0 开源**（可信度：高）。**无内购、无订阅、无广告**证据。变现路径是捐赠 / 社区 / Microsoft Store 露出。扩展（AI 画质、翻译、Aria2）全部免费但**需用户自备 API Key 或本地服务**（DeepL/Baidu 需申请 Key，DeepLX 免 Key，Ollama 需自装）。

---

## 4. PiPixiv（Compose Multiplatform — 本轮跨平台最完整的开源方案）

| 项 | 值 | 可信度 |
|---|---|---|
| URL | https://github.com/darriousliu/PiPixiv | 高 |
| 平台 | Android 8.0+ / **iOS 18+** / Windows x86_64 / **macOS arm64 (Apple Silicon)** / Linux x86_64 | 高 |
| 技术栈 | **Kotlin 2.4.20 + Compose Multiplatform 1.12.1 + AGP 9.4.1**；Gradle 9.6.1 / JDK 25；Android compile/target SDK **37**、min SDK **26**；**iOS 用 Swift Export，部署目标 iOS 18.0** | 高 |
| 许可证 | **Apache-2.0** | 高 |
| 最新版本 | **v2.5.1（2026-09-25）** | 高 |
| 最近提交 | 2026-09-25 | 高 |
| 星数 | 252 stars / 10 open issues；创建于 2023-06-20 | 高 |
| 分发渠道 | GitHub Release **6 平台齐发**：`android-default.apk` / `android-foss.apk` / **`ios.ipa`** / `windows-x86_64.msi` / **`macos-arm64.dmg`** / `linux-x86_64.tar.gz`；另有 **F-Droid**（`com.mrl.pixiv`，v2.2.1 于 2026-05-23 加入，Apache-2.0） | 高 |
| iOS 分发方式 | README/release notes 原文：「**iOS IPA 需自行签名安装，可使用 AltStore、Sideloadly 等工具**」→ **未上架 App Store** | 高 |

### 4.1 Apple / 桌面侧核实（任务指定项，逐条）

- **iOS 18+ 部署方式**：Swift Export + `iosApp/Configuration/Config.xcconfig`，**部署目标 iOS 18.0**；分发仅 IPA 侧载（AltStore / Sideloadly 自签）。→ 首次 release 有 iOS 产物是 **v2.0.0（2026-03-05）**。
- **Win/macOS/Linux 产物**：`windows-x86_64.msi` / `macos-arm64.dmg`（**仅 Apple Silicon，无 Intel**）/ `linux-x86_64.tar.gz`，自 v2.0.0 起每次 release 均齐发。
- **快捷键**（README 原文，仅 3 条）：「滚动列表支持 `R` 快捷键返回顶部或刷新，⬆️⬇️ 方向键滚动」「`ESC` 键返回上一页」。实现参考 `magic-cucumber/Pixiv-MultiPlatform`。
- **桌面主题**：v2.5.1 修了「修复 Windows、macOS 跟随系统主题时识别错误或更新不及时的问题，保留手动主题选择」（#148）。
- **跨端一致性**：v2.5.1 同一批修复同时覆盖 iOS 与桌面（#149「iOS 代理与下载：修复直连模式仍继承系统代理，以及后台下载未遵循应用代理设置的问题；**系统代理、直连、HTTP 和 SOCKS 模式已完成模拟器实际下载回归**」）。
- **登录**：OAuth + **网页端 Cookie（PHPSESSID）登录，无需手动填写 Token**。
- **网络模式**：默认系统代理，可切直连或手动 HTTP / SOCKS 代理；**Android 和桌面端另提供 SNI 模式**（注意：**SNI 不含 iOS**）。切换网络模式后需重启应用。
- **i18n**：v2.5.0 修了「继续阅读入口布局及**全部语言**的百分号文案」→ 多语言已成型（具体语言清单 README 未列，**未找到证据**）。

### 4.2 功能清单（README 原文，可信度：高）

认证登录 / 内容浏览（首页推荐瀑布流、动态【发现/收藏/关注分类】、排行榜【日周月 + 男性/女性向 + **AI 生成**等】、插画与小说**本地浏览历史，支持搜索/清空/自动清理**；**Pixiv 高级会员可启用云端历史**）/ 插图（多图、UGOIRA、相关作品、按原图比例查看、画质选择、缩放、下载原图或 GIF、自定义命名、下载队列）/ 小说（**插画↔小说视图一键切换且偏好持久化**、沉浸式阅读、字体行距可调、拖动滚动条定位、回到顶部与章节切换按钮纵向排列且调排版时保持阅读位置、简介/标签/系列跳转、**系列目录续读入口显示上次章节标题 + 进度百分比**、**AI 翻译支持 OpenAI/Claude/Gemini 与兼容接口（可配局域网服务/模型/超时/请求参数、可拉模型列表、限全局并发、正文+标题+简介）**、**译文流式显示 + 本地缓存 + 原文/译文切换**、**稍后阅读翻译队列（任务状态/重试/重新生成）**、**自动保存与恢复阅读进度 + Pixiv 小说书签 + TXT 导出**）/ 搜索（插画/小说/用户，按人气/最新排序，默认匹配方式与 AI 内容筛选可配，搜索页临时调整不覆盖全局，连续滚动或分页，方图/原图比例瀑布流，长按 Tag 收藏或复制）/ 用户社交（简介/工作环境/插画/漫画/小说投稿/公开收藏/关注列表含公开私密分类/评论）/ 收藏互动（收藏插画小说、关注取关、按标签筛选收藏）/ 设置系统（语言、图片来源、网格列数、私密收藏、代理模式、隐私【R-18 显示、进入搜索页读剪贴板】、屏蔽作品/用户/标签、**可按长度与分段数量过滤小说长标签**、深度链接、缓存清理、数据导出导入、**Markdown 展示发布说明的更新弹窗**）。

### 4.3 已知短板 / 限制（可信度：高）

1. **SNI 模式不可用/未修**：v2.5.1 明确「🟡 尚未确认解决 | #146 | **SNI 模式的网络可用性问题不列为本版已修复项**」；且 SNI **仅 Android + 桌面，iOS 无**。
2. **网络模式切换需重启应用**（README 自述）。
3. **macOS 仅 arm64**（release 资产清单），Intel Mac 无产物。
4. **iOS 部署目标高**（18.0），且**只能侧载**、无 App Store/TestFlight 通道。
5. **历史功能丢失**（issue #913/#925「找不到/没有了收藏时自动下载功能」）→ 功能集合在版本间不稳定。
6. **AI 翻译与阅读进度是最近才补齐的高风险区**：v2.5.1 仍在修「长篇小说滚动条位置不稳定、难以拖动定位」「评论与举报页面进入后台时序列化字段冲突导致崩溃」。

---

## 5. 老牌第三方 App：iFier / Vveer / Pixiv Mate —— **均已从 App Store 消失**

这是本轮调研中**最硬的负面结论**，直接回答「iOS 侧竞争格局是否已被新一代填满」。

**取证方法**：Apple 官方 iTunes Search API，`entity=software&country={cn|us|jp}`。

| 检索词 | cn | us | jp |
|---|---|---|---|
| `iFier` | 0 命中（2 条结果均无关） | 0 命中（4 条均无关） | — |
| `Vveer` | **0 命中** | 9 条命中**全部无关**（VV K歌 / VG / 挪威旅游局等） | — |
| `Pixiv Mate` | 0 命中 | 6 条命中**全部无关**（PixVerse / PixiLearn 等） | — |
| `pixiv`（limit=200 全量） | 51 条，**唯一第三方客户端 = `Decent Demon - Pixiv风插画壁纸采集工具`（Shenzhen Packetflow，v1.0.4，**2023-07-08**）** | 79 条，第三方仅 `PixEz`（培荣 张）、`Pivlite`、`Pivlite Preview` | 122 条，**除官方三款（pixiv / pixivコミック / pixiv Sketch）外零第三方** |

**结论（可信度：高）**：

1. iFier / Vveer / Pixiv Mate **在 2026-09-27 的 cn / us / jp 三大区 App Store 均检索不到**。结合它们历史上是 App Store 第三方客户端，判定为**已下架**。
2. 唯一残留的 cn 区第三方「Decent Demon」**最后更新 2023-07-08，已停更多于 3 年**。
3. jp 区**零第三方**（日本是 pixiv 本土市场，反而没有第三方上架空间）。

**因此：iOS 侧竞争格局 = 「新一代（Pixiv-SwiftUI / PiPixiv / Pivlite）+ 官方」的寡头结构，2015–2020 年代那批老牌第三方已经清空。** 这对 Pictelio 是**好消息**——iOS 是块几乎没人做的空地（但也是没人愿意付开发者成本做的空地，信号需两面读）。

**⚠️ 未能核实（低）**：三家**下架的具体日期、下架原因（主动下架 / Apple 审核 / 开发者停更）**。iTunes Search API 不提供下架记录，需 App Store Connect 或 Wayback Machine 才能确认 → 本次未做，记为未找到证据。

### 5.1 补充：`PixEz`（pixez-flutter 作者的商业化 App Store 版，仍在更新）

- App Store `id 1494435126`，开发者**培荣 张**，**免费**，v1.9.87（**2026-09-08**），iOS 15.0+，43 MB，首次发布 2020-01-22。
- 商店描述极简：最新作品 / 排行作品 / 关键词·作品名·角色名搜索 / 作品 ID·角色 ID·链接搜索 / **「支持特定作者，标签或作品的屏蔽」**（可信度：高）。
- **这是 Pixiv-SwiftUI README 里的鸣谢对象**，且 Pixiv-SwiftUI 的数据导入/导出格式**兼容 pixez 格式**（可信度：高）——**老一代 iOS 客户端的数据资产仍被新一代继承**。

---

## 6. 官方 Pixiv App（iOS + Android + pixivコミック + pixiv Sketch）

| 项 | 值 | 可信度 |
|---|---|---|
| iOS 主应用 | `net.pxv.iphone`，**Pixiv Inc.**，v**8.9.1（2026-09-15）**，首次发布 **2009-12-09**，最低 **iOS 16.0**，99 MB，免费 | 高 |
| iOS 中国区 | 爱笔思画X（`id 450722833`，ibis inc.，v14.1.1，2026-09-11） | 高 |
| iOS 漫画 | pixivコミック `id 975414811`，v**5.23.0（2026-09-14）** | 高 |
| iOS Sketch | pixiv Sketch `id 991334925`，v7.17.3（2026-07-13） | 高 |
| Android 主应用 | `jp.pxv.android`，Google Play **4.2 分 / 18.6 万条评价**，页面更新日期 **2026-09-11** | 高 |

### 6.1 功能面（官方商店文案逐条，可信度：高）

插画（浏览 + 投稿）、漫画（浏览 + 投稿）、小说（浏览 + 投稿）、**推荐作品**（按热门作品/评价/收藏/「喜欢！」）、**排行榜**（日/周/月；男子人気/女子人気/オリジナル/新人）、**最新作品**（关注更新 + 全站）、**搜索**（插画按标签/标题、小说按标签/**正文**、用户搜索、搜索历史、「热门标签」）、**收藏 / 关注 / 点赞 / 评论**。

**商店文案未提及的能力（≠ 不存在，仅「未在公开文案中出现」）**：AI 生成作品过滤、**Mute / 屏蔽功能**、**小说追更（imeq）**、**通知 / push**、**作品浏览历史**。其中 Mute 与浏览历史**在 Premium 对比表中被明确列出**（见下），可反证它们是产品功能但未进商店简介。

> AI 过滤与 AI 作品标识**确实存在**且**有独立帮助页且仍在高频修订**：`AI生成作品の表示オプションとはなんですか？`，`updated_at = 2026-09-27`；`AI生成作品とはなんですか？` `updated_at = 2026-25`（2026-09-25）。可信度：高（Zendesk HC API v2）。

### 6.2 Premium / 会员边界（**本轮最关键的官方一手事实**，可信度：高）

来源：`https://www.pixiv.net/premium`（服务端渲染，2026-09-27 抓取）全量文案 + `https://www.pixiv.help/hc/ja/articles/235583728`。

**价格**：

- 帮助中心（日文，updated 2026-09-25）：**月額 590 円（税込）**；长期折扣；**6 个月 3,240 円 / 12 个月 5,880 円**（门票课金）。
- 英文 premium 页：**4.15 USD / Month**（12 个月，**16% Discount**）；3 个月 3% off；6 个月 8% off；宣传语「only 0.12 USD/day」。
- 支付方式：信用卡 / 电信代收 / PayPal / Google Play / App Store / 门票课金（电子货币・便利店）。

**免费 vs Premium 逐条对比（官方原文对照表）**：

| 能力 | Free | Premium |
|---|---|---|
| 搜索 | **Search work by post time only**（仅按发布时间） | **Search by popularity**（按收藏数排序）+ **Filter by Bookmarks**（收藏数区间过滤） |
| 小说搜索 | — | **Search novels by word count**（按字数检索小说） |
| 广告 | 有 | **Hide ads**（pixiv / pixiv 百科事典 / pixiv COMIC 全站不再显示） |
| 浏览历史 | **5 works limit** | **180 天**（含注册前的历史，最多 **10,000 条**） |
| **Mute / 屏蔽** | **Mute only 1 item** | **Mute up to 500 items** |
| 关注用户文件夹整理 | ✅（两档都有） | ✅ |
| 作品访问报告 | ✅（两档都有） | ✅ |
| 重发替换作品 | ✅ | ✅ |
| 预约投稿 | ✅（ugoira 不可用） | ✅ |
| 小说 → PDF | ✅ | ✅（英文版不可用） |
| 小说封面模板 | **Only some** | **All** |
| 收藏标签搜索（Beta） | ✅ | ✅ |
| Clip Studio Paint DEBUT | ✅ | ✅ |
| sensei 绘画课程 | ✅ | ✅ |
| Pastela 付费功能 | ❌ | ✅ |
| CLIP STUDIO PAINT PRO/EX 折扣 / 印刷 5% off / 印刷礼品 | ❌ | ✅ |

**关键推论**：

1. **排序（人气/收藏数）是 Premium 独占**——免费档只能按时间排。这正是所有第三方客户端都直接调 API 拿 `total_bookmarks` 排序的**合规灰区所在**。
2. **Mute（按 tag / 用户屏蔽）免费只有 1 条，Premium 500 条**。这解释了为什么**所有第三方客户端都自己实现本地四态过滤**——官方能力被刻意限流到 1 条。
3. **浏览历史免费 5 条 / Premium 180 天**。同理，第三方客户端的本地浏览历史功能在官方侧被刻意压缩。
4. **隐藏广告、字数检索、封面模板、PDF 导出**是付费墙。

### 6.3 官方是否提供面向第三方的**正式 API** —— **明确结论：不存在公开的通用第三方 API；唯一成文的官方 API 计划是 VRoid Hub 的认证合作方 API**

这是本文档对 Pictelio 合规叙事影响最大的一条，逐层给证：

**证据 1（正面：官方明确允许第三方客户端开发）**
pixiv 官方《サービス利用規約》中有一节专名为 **「アプリケーション、各種サービス等への使用について」**（https://www.pixiv.net/terms/ ，2026-09-27 抓取），原文：

> pixivの利用をより便利にするアプリケーションやサービスについて、開発を行われる方は以下の内容をお守りください。
> - 使用に関しては各自が責任を負うものとし、当社は一切の責任を負いません。
> - pixivを利用して投稿された画像等の情報の著作権その他一切の権利は、当該画像等を創作したユーザーに帰属します。
> - pixivおよび、関連サービスは、予告なしにその機能や掲載内容の改訂、変更、提供停止を行う場合がございます。
> - **クローラーなどのプログラムを使って作品を収集する行為、サーバに極端な負荷をかける行為は禁止します。また、それらに違反しない場合でも、当社はその停止を要求する場合がございます。**
> - **『pixiv プラットフォームを利用して開発したアプリケーションである』という主旨の説明を表記した場合の利用は通常問題ありません。『pixivが作成、配布しているアプリケーションではない』という旨を併記してください。** また、当社サービスと混同を招きかねない名称は避けてください。

条款末尾修订记录含 **2025-01-28**（pixiv logo 更新相关）。可信度：高。

**这段话给出了第三方客户端的「合法操作手册」：**
1. ✅ 第三方客户端是**被明确认可的合法形态**（不是灰色地带）。
2. ⚠️ 边界一：**不得用「クローラーなどのプログラム」收集作品**、不得给服务器造成极端负载；即使不违规，pixiv **保留要求你停服的权利**。
3. ⚠️ 边界二：**必须声明「基于 pixiv 平台开发」+「非 pixiv 出品/发行」**，名称不得引起混淆。
4. ⚠️ 风险自担条款：功能/内容可能**无预告地变更或停供**——直连方案被 403 是**契约内预期**。

**证据 2（负面：全量条款中唯一成文的 API 只属于 VRoid Hub）**
对同一份 2842 行条款全文检索 `API`，**唯一**的 API 个别规约是 **「VRoid Hub API 規約」**，其机制是：
- 面向「VRoid Hub と連携するアプリの開発者」，需 **「当社所定の方法で、契約者登録」**（合作方登记）；
- 有 **「公認アプリ」/「非公認アプリ」** 两级，由 pixiv 逐个认定；
- **「開発アプリ porridge 制作した場合は、原則として当社に届け出るものとします」**（开发完须向 pixiv 报备）；
- **「本APIを利用して取得した画像・テキストを本APIを用いて作成した開発アプリ以外で利用すること」被禁止**；
- pixiv 可随时中断 API 提供。

即：**pixiv 体系内唯一有正式 API 条款的服务是 VRoid Hub（3D 模型），面向 3D 创作者生态，与插画/小说/用户数据完全无关。**（https://www.pixiv.net/terms/ 检索 `API`，可信度：高）

**证据 3（开发者门户不存在）**
- `https://www.pixiv.net/developers/` → **404**（可信度：高）
- `https://developer.pixiv.net/` → **连接失败（000）**（可信度：高）
- `https://www.pixiv.help/api/v2/help_center/articles/search.json?query=API`（官方帮助中心 API）→ 仅 2 条结果，均为「連携サービス」（FANBOX/BOOTH 等创作者服务对接）与「X にリプライツリー形式で投稿」，**无开发者 API 条目**（可信度：高）
- 帮助中心搜「開発者」81 条，无一条是面向第三方的 API 申请入口（可信度：中，搜索 API 召回可能不全）

**结论（可信度：高）**：

> **Pixiv 没有面向插画/小说业务的公开第三方 API。** 唯一成文的官方 API 是 VRoid Hub 的认证合作方 API（需签约登记 + 报备 + 只限 3D 模型）。所有第三方客户端（含 Pixeval、PiPixiv、Pixiv-SwiftUI、P站助手）走的都是**用户自己的 OAuth/cookie 凭据 + 逆向/内部 Web API**。
>
> 但 pixiv **在服务条款中明文允许**此类第三方客户端存在，条件是：不 crawler、不压服、声明非官方、不误导。
>
> **对 Pictelio 的直接含义**：不存在「转向官方 API」的合规替代路径。可行的合规叙事只能是 **① 遵守上述四条边界条款**，且 **② 承认直连层随时可能因 pixiv 单方面变更而失效**（条款已预告）。这也意味着 Pictelio 在功能上主动提供用户价值（本地历史、四态过滤、翻译、进度）比在网络上做文章更安全，也更能对冲条款里那句「当社はその停止を要求する場合がある」。

---

## 7. 补充：2025–2026 新出现且仍在维护的客户端（3 个）

### 7.1 Pixiv-MultiPlatform（`magic-cucumber`）— 六平台齐发，2025-11 起

| 项 | 值 | 可信度 |
|---|---|---|
| URL | https://github.com/magic-cucumber/Pixiv-MultiPlatform ／ 主页 https://pmf.kagg886.top | 高 |
| 平台 | Windows / Linux / macOS / Android / iOS | 高 |
| 技术栈 | Kotlin / Compose Multiplatform | 高 |
| 许可证 | **GPL-3.0 only**（F-Droid 元数据） | 高 |
| 最新版本 | **v1.8.7（2026-07-24）**；最近提交 2026-09-16 | 高 |
| 星数 | 191 stars | 高 |
| 分发 | GitHub Release **6 资产**：`android.apk` / **`ios.ipa`** / `linux.tar.gz` / **`macos.dmg`** / `windows.msi` / `windows.zip`；**F-Droid** `top.kagg886.pmf` v1.8.7（2026-07-28 加入） | 高 |

**差异化（README 原文）**：
- **PC 端快捷键（自 v1.6.0）**：`↑` 向上滚 / `↓` 向下滚 / `PgDn` 向下翻页 / `R` 顶部刷新否则回顶 / `←` `→` Tab 页左右切换（推荐页）—— **本轮调研中桌面键位表最完整的开源项目**。
- **用 DoH 实现直连**（README「使用DoH实现直连」）—— 路线与 Pixiv-SwiftUI 的 SNI→HTTP/3、PiPixiv 的 SNI 都不同，是**第三条直连技术路线**。
- **导出小说为 epub 格式**（本轮唯一做 epub 的开源项目）。
- **过滤**：无效插画/小说过滤（删除插画、无权限查看插画）+ 手动过滤（R18 / R18G / AI）+ **屏蔽 TAG 过长小说** + **屏蔽正文过短小说**。
- 小说阅读器：页数跳转、链接支持、内联图片。
- 国际化、自定义 TAG 过滤。
- **未完成项**（README 勾选框诚实标注）：修改资料 ❌、查看关注 ❌、小说系列搜索 ❌。

### 7.2 KeiPix（`hosizoraru`）— macOS 原生 AppKit/UIKit

- https://github.com/hosizoraru/KeiPix ，创建 2026-05-23，最近提交 2026-06-22，**7 stars，无许可证**。
- 仓库自述：「**Native AppKit/UIKit-first Pixiv client for macOS, with SwiftUI glue and visual QA**」——即 macOS 优先、不走 SwiftUI 纯路线的实验。
- **可信度：低**。7 stars、创建不到 4 个月、无 LICENSE、无 release，功能面无一手证据 → **仅作为「2026 年新入场者」信号记录，不作竞品级结论**。

### 7.3 kpixiv（`alphonse927`）— Linux 桌面集成

- https://github.com/alphonse927/kpixiv ，创建 2026-05-12，最近提交 2026-09-23，**1 star，无许可证**。
- 自述：「Unofficial Pixiv client for Linux with **automatic wallpapers, multi-monitor support, filtering, and desktop integration**」——**Linux 壁纸自动化 + 多显示器**是差异化点。
- **可信度：低**。理由同上：1 star、无 release、无 LICENSE。

> 说明：这两个项目 star 数极低，列在此处的价值是**方向信号**（macOS 原生路线、Linux 桌面集成路线在 2026 年都有人在做），而非竞争威胁。

---

## 8. 横向对比大表

图例：`✅` 明确具备（有一手证据） / `◐` 部分或受限 / `❌` 明确不具备 / `?` 未找到证据 / `—` 该维度对该形态不适用。

| 能力维度 | Pixiv-SwiftUI | P站助手 / PixHelper | Pixeval | PiPixiv | Pixiv-MultiPlatform | 官方 pixiv App | Pictelio-webview（待主线核对） | Pictelio-lynx（待主线核对） |
|---|---|---|---|---|---|---|---|---|
| **插画 / 漫画浏览** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 待核对 | 待核对 |
| **小说阅读** | ✅ 沉浸式 + 进度记录 + 系列 | ✅ 书签/浏览记录/系列（系列分页曾有 bug） | ✅ 阅读器 + TXT/epub 导出（epub 为 PMF） | ✅ 沉浸式 + 进度恢复 + 系列续读 + **TXT 导出** | ✅ 页码跳转 + **epub 导出** | ✅ | 待核对 | 待核对 |
| **书架与阅读进度** | ◐ 阅读器进度记录 | ◐ 书签 + 浏览记录 | ◐ 历史 + 稍后再看（Watch Later） | ✅ 自动保存/恢复 + 系列续读百分比 | ◐ 历史 | ◐ 官方浏览历史（免费 5 条 / Premium 180 天） | 待核对 | 待核对 |
| **AI 翻译（文本）** | ✅ 标题/简介/**全部评论** + 双语对照 + 上下文批量 + 多服务主备 | ✅ 小说翻译（**服务端 DeepSeek 等**，流式，可重译） | ✅ 插件式：百度 / DeepL / DeepLX / **Ollama 本地** | ✅ OpenAI/Claude/Gemini/兼容接口 + 流式 + 本地缓存 + 翻译队列 | ❌ 未见 | ◐ 官方有自动翻译（条款第22条の2 明文） | 待核对 | 待核对 |
| **AI 增值（图像）** | ✅ **Vision OCR 图内文字翻译** + **VLM 图片解释** | ✅ 漫画 OCR 原位替换译文 + **本机高清化** + **云端高清化**（2026-06-28 上线） | ◐ **AI 提升画质扩展** | ❌ | ❌ | ❌ | 待核对 | 待核对 |
| **直连方案** | ✅ **HTTP/3 (QUIC)** 替代 SNI（2026-09-26）+ 图片域名切换/镜像站 | ✅ **加密通道 → 失败改中继（放弃域名前置）** + 图片节点优选 + 可选 CDN 代理 | ◐ 有直连/代理，但 issue #925 反馈直连慢 | ✅ 系统代理 / 直连 / HTTP / SOCKS + **SNI（仅 Android+桌面）** | ✅ **DoH** | — 官方自有 | 待核对 | 待核对 |
| **以图搜源** | ◐ Kanna HTML 解析（README 鸣谢），v0.16.0 修了系统相册选图 | ✅ Pixiv 内以图搜图（找图源） | ✅ **SauceNAO**（MCP `saucenao_search`，需自备 key） | ❌ 未见 | ❌ | ◐ 有搜索但非以图搜源 | 待核对 | 待核对 |
| **过滤四态（R18/R18G/剧透/AI）** | ✅ **正常显示 / 模糊 / 屏蔽 / 仅显示** 四态 × 四类，含首次启动向导 | ◐ R-18 显示控制 + 屏蔽作品/用户/标签（状态数未知） | ◐ 有 `Pixeval.Filters` 语句引擎（语法/状态数未在 README 公开） | ◐ R-18 显示 + AI 内容筛选 + 屏蔽作品/用户/标签 | ◐ R18/R18G/AI 手动过滤 + 无效作品过滤 | ◐ AI 作品表示选项（Mute 1 条 vs 500 条） | 待核对 | 待核对 |
| **多账号** | ✅ `AccountStore`（曾有串号 bug 已修） | ❌ 未见 | ? 未见 | ◐ 有账号恢复逻辑（PR #20） | ❌ | ◌ 单账号 | 待核对 | 待核对 |
| **平板适配** | ✅ iPadOS 独立截图页；⚠️ **仅 iPadOS 26 经模拟器测试** | ? 未见 | ❌ Android 侧**仅建议宽屏 Pad** | ◐ iPad 计入 iOS 目标，未单列 | ◐ 宽窄屏双配色 | ✅ iPad 版 | 待核对 | 待核对 |
| **i18n** | ✅ 简中/繁中/英/**日**（LLM 起草 + 润色） | ✅ 多语言 + 主题 | ✅ 简/英/**俄**（Crowdin） | ✅ 多语言（v2.5.0 修「全部语言」） | ✅ 国际化 | ✅ | 待核对 | 待核对 |
| **备份 / 同步** | ✅ **数据导入/导出（兼容 pixez 格式）** | ◐ 数据导出/导入 + 卸载重装后系统备份可恢复登录（Play 新变化） | ✅ `settings_summary` + 缓存持久化 + 扩展生态 | ✅ 数据导出/导入 + 自动恢复阅读进度 | ? 未见 | ✅ 云端 | 待核对 | 待核对 |
| **离线** | ◐ 浏览历史 + 标签翻译库 + 图片缓存上限 + **实验性永久收藏缓存** | ◐ 本地高清化 + 下载管理 + 小说阅读记忆 | ✅ **跨会话缓存（关软件后图片仍在磁盘）** | ◐ 本地历史 + 下载队列 + 翻译缓存 | ◐ 下载管理 | ❌ | 待核对 | 待核对 |
| **桌面快捷键** | ✅ macOS（Esc 关登录窗）+ 侧边栏 | ❌ 移动端为主 | ✅ `KeyboardShortcut.cs` + 单测（全量键位未公开） | ◐ `R` 回顶/刷新、方向键、ESC | ✅ **最完整**：↑↓PgDnR←→ | — | 待核对 | 待核对 |
| **MCP / AI Agent 接入** | ❌ | ❌ | ✅ **本轮唯一**：47 工具 + 7 资源 + 游标分页 + 写工具开关 + AOT 插件 | ❌ | ❌ | ❌ | 待核对 | 待核对 |
| **永久缓存（防删图）** | ✅ **实验性收藏永久缓存**（防作者删图） | ❌ | ◐ 跨会话磁盘缓存（但依赖服务端仍在） | ❌ | ❌ | ❌ | 待核对 | 待核对 |
| **正式 API** | ❌ | ❌ | ❌ | ❌ | ❌ | — | — | — |
| **分发** | 侧载 ipa/dmg + Homebrew cask | App Store 买断 ¥28 + 预览版 + Play + 应用宝 | MS Store + GitHub + Homebrew tap | GitHub 6 平台 + F-Droid + 侧载 ipa | GitHub 6 平台 + F-Droid | App Store + Play | — | — |
| **最后活动** | 2026-09-26 | 2026-09-26（Android） / 2026-09-18（Play 页） | 2026-09-27 | 2026-09-25 | 2026-09-16 | 2026-09-15 | — | — |

> **Pictelio-webview / Pictelio-lynx 两列标注为「待主线核对」**：本 worker 未打开 Pictelio 仓库代码核实（避免与其他并行 worker 的写冲突），由主线在交叉比对阶段填入。

---

## 9. 对 Pictelio 的启示

### 9.1 跨平台缺口按 ROI 排序

| 优先级 | 缺口 | 依据 | ROI 理由 |
|---|---|---|---|
| **P0** | **不做跨平台** | PiPixiv 一个 Compose Multiplatform 项目要同时背 Android 8 / iOS 18 / Windows x64 / macOS arm64 / Linux x64 五套产物，且 v2.5.1 仍在修「桌面跟随系统主题识别错误」「macOS/iOS 代理与后台下载」 | 跨平台是**成本中心不是增长中心**。Pictelio 的 Android 深度（水印、缓存、更新检查、OAuth Keystore）无法低成本迁到 iPadOS |
| **P0** | **把「直连」当可失效基础设施来经营** | 四个项目三种直连路线全都在被 pixiv 单方面打断：Pixiv-SwiftUI SNI→403→HTTP/3 重写（v0.16.1 还发热劝退）；P站助手放弃域名前置改中继；PiPixiv #146 SNI 未确认可用；Pixeval 4.3.23「域前置失效临时修复」 | 唯一有价值的不是「能连上」，而是**失效时用户看得懂发生了什么**。对应 Pictelio：`EngineRouting` 式降级 + 明确错误态 + 一键切代理 |
| **P1** | **AI 翻译做「本机/自备 key」而非「自建服务端」** | Pixeval 走插件（百度/DeepL/DeepLX/Ollama，用户自备 key）；PiPixiv 走用户自配 OpenAI/Claude/Gemini/LAN 端点；只有闭源的 P站助手走自家 DeepSeek 服务端并**按字数计费** | Pictelio 已有 `DEEPSEEK_API_KEY` 模式，方向正确。**不要**学 P站助手开翻译收费——那会把「学习研究性质」变成「与官方竞争的付费服务」，直接触碰条款风险面 |
| **P1** | **MCP / AI Agent 接入是零竞争蓝海** | 47 工具 + 7 资源的 Pixeval MCP 是**本轮所有调研对象中唯一的 AI Agent 接入面**（可信度：高）。Pixiv-SwiftUI / P站助手 / PiPixiv / Pixiv-MultiPlatform / 官方全为 0 | Pictelio 已有大量结构化本地状态（书架、进度、过滤规则、翻译缓存），天然适合做只读 MCP。**先做只读 + 显式写开关**（照抄 Pixeval 的安全模型：`EnsureWriteToolsEnabled` + 不暴露 token/cookie + 只监听 127.0.0.1 + 不提供 stdio exe） |
| **P2** | **平板 / 大屏适配** | 官方有 iPad 版；Pixeval 自己承认宽屏设计让 Android 只适合 Pad；Pixiv-SwiftUI 仅 iPadOS 26 测过 | Android 平板是 Pictelio **零新增代码成本**能吃到的一块（横屏双栏 + 虚拟滚动复用），比做 iPadOS 划算得多 |
| **P2** | **epub 导出** | Pixiv-MultiPlatform 和 Pixeval 都做，TXT 只有 PiPixiv 做 | 小功能、高感知，可排在小说导出迭代里 |
| **P3** | **桌面快捷键 / 跨平台客户端** | 键位表最全的是 Pixiv-MultiPlatform（↑↓PgDnR←→） | 只有在真的做桌面端时才有意义。**现在做 = 零价值** |

### 9.2 官方 API 这条路是否存在 —— 明确结论

**不存在。**（详见 §6.3，证据链：一手条款原文 + 官方帮助中心 API 检索 + 开发者门户 404/连接失败）

**但也不需要存在。** pixiv 官方《サービス利用規約》「アプリケーション、各種サービス等への使用について」一节**明文允许**第三方客户端开发，条件四条：

1. 风险自担，pixiv 不承担责任；
2. **不得用「クローラーなどのプログラム」收集作品、不得给服务器造成极端负载**——且即使不违规，pixiv **保留要求停止的权利**；
3. **必须标注「基于 pixiv 平台开发」+「非 pixiv 出品/发行」**；
4. 名称不得引起与 pixiv 服务的混淆。

**对 Pictelio 合规叙事的具体动作项**：

- README / 应用内 / 隐私政策三处都要有 **「本应用基于 pixiv 平台开发，与 pixiv / Pixiv Inc. 无任何关联，非 pixiv 出品」** 的明示声明。Pixiv-SwiftUI 已有此声明（README 末行），Pictelio 应有同等措辞。
- 名称不得暗示与 pixiv 官方有隶属。Pictelio / pixivizer 命名**安全**（不含 pixiv 前缀伪装成官方）。
- **不要做全站爬取 / 批量抓取 / 高并发回源**。Pictelio 的图片走 `/pixiv-img/` 代理按需加载 + 三层缓存（ADR-0090）恰好是低负载形态，与条款精神一致——应把「按需 + 缓存 + 不预抓全站」写成显式设计原则，而不是偶然。
- **不要把「直连成功率」写进任何 SLA 式承诺**。条款已预告功能可无预告变更/停供。Pixiv-SwiftUI 的 SNI→HTTP/3 三周重构是常态。
- **付费墙能力（人气排序 / 屏蔽条数 / 历史长度 / 去广告 / 字数检索）不要用「我们免费提供」当卖点**。这些是官方 Premium 的收入项；把它包装成核心付费点会直接与官方订阅正面对撞。安全姿势是**只做官方完全没有的能力**（AI 翻译、AI 图像增值、AI Agent 接入、跨端同步、离线永久缓存）。

### 9.3 值得直接抄的三个设计

1. **Pixeval 的 MCP 安全模型**（写工具默认关 + 脱敏 settings_summary + 回环监听 + 不暴露 token/cookie/代理/key + 游标避免 AI 重复回源）→ 可作为 Pictelio 若做 MCP 的验收清单。
2. **Pixiv-SwiftUI 的「首次启动常用设置向导」**（v0.16.1 新增，含独立的过滤设置步骤）→ 对应 Pictelio 首启体验，可显著降低「四态过滤」这类高认知成本功能的漏配率。
3. **PiPixiv 的网络模式切换需重启应用**这一自述反面教材 → Pictelio 若做多网络模式，**必须做到切换即生效**（Kotlin/Compose 侧已验证可做，见 PiPixiv #149 的模拟器回归）。

---

## 10. 未能核实 / 低可信度清单

| 断言 | 状态 | 原因 |
|---|---|---|
| iFier / Vveer / Pixiv Mate 的**下架日期与下架原因** | **未找到证据（低）** | iTunes Search API 不提供下架记录；需 App Store Connect 或 Wayback Machine（本次未做）。仅能确认「2026-09-27 在 cn/us/jp 三区检索不到」 |
| P站助手「子非鱼」这个开发者名 | **已证伪** | 三处一手来源（App Store sellerName「泽勇 周」、Google Play「周泽勇」、官网 JSON-LD author「杭州子非语网络科技有限公司」）均无「子非鱼」 |
| P站助手的**会员/充值具体价格档位** | **未找到证据** | 官网未披露；应用内才可见 |
| P站助手的**浏览器扩展**是否真实存在 | **未找到证据（低）** | 官网隐私政策提及「ソフトウェアまたはブラウザ拡張」，但四个分发渠道均无扩展入口 |
| 官网 JSON-LD 的 `aggregateRating 3.6 / 4723 条` | **低（自报，不可信）** | 与 Google Play 实际「3.8 / 12 条评价 / 100+ 下载」严重矛盾 |
| P站助手**技术栈** | **不可知** | 闭源，无公开证据。仅能从隐私政策推出 Android 侧用 SAF、Bugly、5 个广告 SDK |
| Pixeval **全量桌面快捷键表** | **未找到证据（低）** | 仅源码确认存在 `KeyboardShortcut.cs` + Cmd/Ctrl 抽象与 Cmd+C/Cmd+V 分支；具体键位未在 README/官网公开 |
| Pixeval 的**内容过滤状态数**（是否四态） | **未找到证据** | 确认存在 `Pixeval.Filters` 语句引擎，但状态枚举未公开 |
| Pixiv-SwiftUI 的 **SwiftData 「兼容性」具体所指** | **中** | README 只说「由于 SwiftData 的兼容性问题，App 不支持更旧的系统版本」，未展开 |
| Pixiv-MultiPlatform 的 **iOS 最低版本** | **未找到证据** | README 未列 iOS 部署目标（PiPixiv 明确 iOS 18.0） |
| KeiPix / kpixiv 的**功能面** | **低** | 7 stars / 1 star，无 release、无 LICENSE，仅仓库描述一句话 |
| 「官方 API 不存在」的**穷尽性** | **高但非绝对** | 依据：全量 2842 行条款检索 `API` 仅命中 VRoid Hub；help center API 检索 `API` 仅 2 条无关结果；`pixiv.net/developers/` 404；`developer.pixiv.net` 连接失败。**不排除**存在未公开的定向合作/OAuth 通道（如 Pro-Boost 内部集成） |
| 官方 Pixiv App **是否在 App 内提供 Mute/AI 过滤/追更** | **中** | 商店文案未提，但 Premium 对比表明确列出 Mute、浏览历史 → 产品存在性可证；**具体 App 端交互未在商店文案核实** |
| Pixiv-SwiftUI 提到的「GPT-5.6-Luna / GPT-5.6-Terra」 | **中** | 来自项目自身 release notes 原文，未做独立核实 |
| 官方 pixiv 英文 premium 页的 **4.15 USD/月** | **高（页面实测）** | 但 12 个月套餐含 16% 折扣，单月价可能不同；日文帮助中心口径为 ¥590/月 |

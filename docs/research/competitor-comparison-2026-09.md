# Pictelio vs 同类 Pixiv 第三方客户端：深度对比（webview / lynx 双列）

> 调研日期：**2026-09-27**
> 覆盖范围：Android 原生 7 个 + Apple/桌面/商业/官方 6 类 + Mihon/Legado 插件生态 + Pixiv API 逆向生态
> 一手信源：GitHub 仓库源码与 README（raw）、GitHub API / Releases、issues、iTunes Search API、pixiv.net 官方条款页
> 详细底稿（本文件是汇总层，证据在子文档）：
> - `docs/research/competitor-android-native-2026-09.md`（585 行）Android 原生 7 款
> - `docs/research/competitor-apple-desktop-commercial-2026-09.md`（537 行）Apple / 桌面 / 商业 / 官方
> - `docs/research/competitor-ecosystem-and-api-2026-09.md`（571 行）Mihon / Legado / API 风险
> - `docs/research/competitor-direct-connect-and-ai-2026-09.md`（822 行）直连方案 + AI 增值拆解
> - `docs/research/pictelio-client-capability-audit-2026-09.md`（本项目侧一手代码审计）
> **图例**：✅ 有且成熟 ｜ 🟡 有但受限/简陋 ｜ ❌ 无 ｜ ⚠️ 架构上不可能 ｜ — 未找到证据（≠ 没有）

---

## 0. 本轮调研推翻的 6 条既有结论

调研前 `docs/research/competitor-features-comparison.md`（2026-09-26 浅读版）是基线，本轮一手核实后有 **6 处必须纠正**，其中 2 条直接影响战略判断：

| # | 旧结论 | 核实结果 | 影响 |
|---|---|---|---|
| **1** | 「开源阅读 Legado **活跃**（书源 v284，2026-09）」 | **主仓库已于 2026-05-27 被清空**（commit `9bb05692`「公告」，仓库仅剩 README + 一张图，52 KB），公告指**侵权**并外链阅文 IP 维权。继承者为 `Luoyacheng/legado-E`（阅读Sigma）；Pixiv 书源本体 `DowneyRem/PixivSource` ★1046 仍活跃（push 2026-09-22） | 「最好 Pixiv 小说阅读器」这条**赛道基准已动摇**——载体消失，但书源本体的阅读器能力（书架/离线/繁简/进度）仍是真实标杆 |
| **2** | 「Pictelio **小说导出 9 格式 = webview 独有**」 | **错**。`app-lynx/src/components/NovelExportSheet.vue` 与 webview `ExportSheet.tsx` **共用同一个 `@pictelio/novel-export` 包** | 双端对等，不是 lynx 缺口 |
| **3** | 「**屏蔽作品/作者 双端都有**」 | **错**。lynx 源码两处显式自述无此能力：`relatedInjection.ts:6`「lynx 无屏蔽列表能力」、`backupWiring.ts:53`「app-lynx 暂无屏蔽/举报 store」。lynx 只有**静音标签**（语义不同） | lynx 缺口，须补 |
| **4** | 「Pixiv-MultiPlatform = `Natsena/…`」 | **是另一个项目**。真实活跃项目是 `magic-cucumber/Pixiv-MultiPlatform`（GPL-3.0，v1.8.7 / 2026-07-24，Win/Linux/macOS/Android/iOS 五端） | 竞品池换人，且**过滤能力是全场最完整** |
| **5** | 「Pixiv-Shaft = `h83939/Pixiv-Shaft`」 | 真实 owner 是 **`CeuiLiSA/Pixiv-Shaft`**，且直连方案比旧文档描述激进得多：**Cronet QUIC + No-SNI TLS 双通道**，并公开了完整的「试过但不行」清单 | 直连可行性判断整体改写 |
| **6** | 「AGENTS.md：agent-browser 6 spec / android-e2e 19 spec」 | 实测 **13 / 20**；`package.json` 已是 **v6.1.0**（README 与 openwiki 仍写 5.5.0） | 文档滞后，非功能问题 |

---

## 1. 竞品全景速写（2026-09-27 快照）

| 项目 | 平台 | 技术栈 | 最新版 / 日期 | 许可证 | 一句话定位 |
|---|---|---|---|---|---|
| **Pixiv-Shaft** | Android | Kotlin + MVVM + Room/Retrofit/Glide | v4.5.1+ / 2026 | — | **功能天花板**：端侧 AI 全家桶 + 直连双通道 + aria2 NAS |
| **pixez-flutter** | Android / iOS | Flutter + rhttp | App Store v1.9.87 / 2026-09-08 | — | 轻量 + 三档直连（含 ECH）；iOS 已商业化上架 |
| **Pixiv-MultiPlatform** | Win/Linux/macOS/Android/iOS | Kotlin Compose MP | v1.8.7 / 2026-07-24 | GPL-3.0 | **五端一致 + 过滤最完整** |
| **PiPixiv** | 五端 | Compose MP 1.12 | v2.4.0 / 2026-09-05 | — | **AI 翻译调度最完整**；SNI 直连 2026-09 已失效 |
| **Pixiv-SwiftUI** | iOS/iPadOS/macOS | SwiftUI + SwiftData | v0.16.0 | — | Apple 生态唯一活跃开源替代；手写 HTTP/3 |
| **Pivlite（P站助手）** | iOS + Android | 原生闭源 | 持续更新 | 闭源 | 唯一真正对标的商业双端；服务端 AI（付费） |
| **Pixeval** | Windows | .NET 10 + Avalonia | 5.0.x / 2026-09 | — | 桌面端 + **MCP server**（全场唯一 AI Agent 接入） |
| **Mihon Pixiv 源** | Android | Kotlin（阅读器插件） | versionCode 12 | — | **零登录零凭据**，抗风控最强，功能维度最窄 |
| **Pixiv 书源** | Android | 阅读器 JS 规则引擎 | v284 / 2026-09-22 | — | 小说体验标杆（书架/离线/繁简）；**载体已下架** |
| **官方 Pixiv** | iOS + Android | 原生 | 持续 | 闭源 | 会员墙：人气排序 / 屏蔽 / 长历史 / 隐藏广告 |
| ~~iFier / Vveer / Pixiv Mate~~ | iOS | 原生 | **均已从 App Store 下架**（cn/us/jp 三区检索 0 命中） | — | 2015–2020 老牌已清空 |

---

## 2. 核心表 A — 对等功能矩阵（**webview 与 lynx 分列**）

> 「对等」= 与竞品打平或更好；「🟡」= 有但不如竞品；「❌」= 缺失

| 能力维度 | **Pictelio webview** | **Pictelio lynx** | Shaft | pixez-fl | PMF | PiPixiv | SwiftUI | Pivlite | Pixeval | Mihon源 | Pixiv书源 | 官方 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **插画浏览** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| **漫画**（按章/双向翻页） | 🟡 仅多页浏览 | ❌ | ✅ 独立体系 | 🟡 | 🟡 | 🟡 无独立 Tab | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **小说阅读** | ✅ 虚拟化+章内搜索 | ✅ 分段渲染 | ✅ | 🟡 搜索有 bug | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ 最强 | ✅ 基础 |
| **小说书架 / 离线** | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 进度 | 🟡 | ❌ | ❌ | ❌ | ✅ | ❌ |
| **ugoira 播放** | ✅ 流式（2% 即播） | ✅ 流式（Java 引擎） | ✅ RIFE 补帧 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| **AI 翻译（小说）** | ✅ DeepSeek BYOK | ✅ OpenAI Responses BYOK | 🟡 性能不可用 | ❌ | ❌ | ✅ 三 provider 最强 | ✅ 主备 | ✅ 服务端付费 | ❌ | ❌ | ❌ | ❌ | ❌ |
| **AI 图像增值** | ❌ | ❌ | ✅ **四合一本地** | ❌ | ❌ | ❌ | ❌ | ✅ 云端付费 | ❌ | ❌ | ❌ | ❌ | ❌ |
| **漫画 OCR 翻译** | ❌ | ❌ | ✅ 本地 Manga-OCR | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **以图搜源** | ❌ | ❌ | ✅ 四引擎 | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **国内直连（免代理）** | ❌ **必配代理** | ❌ **必配代理** | ✅ QUIC+No-SNI | ✅ 含 ECH | ✅ | 🟡 **已失效** | ✅ 手写 HTTP/3 | ✅ | ❌ | ✅ 零凭据 | ❌ | ❌ | ❌ |
| **多镜像加速** | ✅ 4 模式 | ✅ | 🟡 4 模式 | — | — | — | ✅ | ✅ 订阅 CDN | — | — | — | — | — |
| **三层缓存 + 用户可调** | ✅ **最细** | ❌ 无设置页 | ❌ Glide 默认 | — | — | — | — | — | — | — | — | — | — |
| **多账号** | ❌ | ❌ | ✅ | 🟡 | ❌ | ❌ #128 | ❌ | ✅ | ❌ | — | 🟡 切换非并存 | ❌ | ❌ |
| **用户屏蔽（作品/作者）** | ✅ 完整 | ❌ **无** | ✅ | 🟡 #1327 标签失效 | ✅ **全维度** | ✅ | ✅ | ❌ | ✅ | — | ✅ | ❌ | Premium |
| **AI/R18 三态过滤** | ✅ | ✅ 遮罩层 | ✅ 三档 | 🟡 | ✅ **最完整** | ✅ | ✅ 四态 | ✅ | ✅ | — | ✅ | — | Premium |
| **平板横屏两栏** | ❌ | ❌ | ✅ **仅此一家** | 🟡 列数配置 | — | — | ✅ | — | — | — | — | — | — |
| **下载体系** | ✅ 9 优先级队列 | ✅ | ✅ **最强+aria2** | 🟡 #1361 | 🟡 | 🟡 | ✅ | ✅ | ✅ | — | — | ❌ | Premium |
| **收藏 + 自定义标签** | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ | ❌ | ✅ 10 上限 | — | — | — | Premium |
| **通知中心** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — | — | — | ✅ |
| **追更 / 稍后看** | ❌ | ✅ **独有** | ✅ 跟读 | — | — | ✅ | — | — | ✅ | — | ✅ | — | ❌ |
| **文本选择菜单** | ❌ | ✅ **独有** | — | — | — | — | ✅ 双语对照 | — | — | — | — | — | — |
| **备份 / 同步** | ✅ WebDAV | ✅ WebDAV | 🟡 云端历史 | — | — | ✅ 导入导出 | — | ❌ | — | — | — | — | — |
| **i18n** | 🟡 zh/en | 🟡 zh/en | ✅ 7 语 | 🟡 | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ | 7 语 |
| **网络自检** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | — | — | — | — |
| **token 不入 JS heap** | ✅ Java volatile | ✅ Java heap | 🟡 OkHttp | ❌ | ❌ | ❌ | ❌ | ❌ | — | — | — | — | — |
| **限流退避** | ❌ | ❌ | — | ❌ | — | ✅ 全局并发限流 | — | — | — | ❌ **0** | ❌ **0** | — |

**读表要点**：
1. **「对等或更好」格**集中在：网络自检、token 隔离、缓存可调粒度、多镜像、ugoira 流式、通知中心、文本选择、追更（lynx）。
2. **最大空白格**（全场只有 1 家做到，我们为零）：**AI 图像增值**（Shaft 四合一）、**平板两栏**（Shaft）、**漫画独立体系**（Shaft）。
3. **唯一全线落后格**：**国内直连** —— Shaft/PixEz/PMF/SwiftUI/Pivlite 都有，PiPixiv 失效，Mihon 源靠零凭据绕开。
4. webview 与 lynx **不是包含关系**：webview 独有屏蔽/缓存设置/镜像设置/三布局/章内搜索；lynx 独有追更/稍后看/好P友/文本选择/小说介绍页。

---

## 3. 核心表 B — webview vs lynx 逐项对位

| 维度 | webview 独有 | lynx 独有 | 双端共有（不对位） |
|---|---|---|---|
| **浏览** | 三次级布局（瀑布/单列/网格）、`/user/:id/illusts` 作品页、`/search` 独立路由 | 三段式首页 + 全局 FAB（搜索/收藏/翻译放射菜单）、下拉刷新、`/platform-check` | 首页 feed、插画详情、排行榜、关注/粉丝、收藏、通知、下载管理 |
| **阅读** | Pretext 虚拟化 + **章内搜索（高亮+跳转）**、FastScroller | **文本选择菜单**、`/novel/:id/intro` 三段式介绍页 + 开关 | 小说详情、系列导航、9 格式导出（共享 `@pictelio/novel-export`） |
| **组织** | — | **追更 `/watchlist`**、**稍后看 `/later`**、**好P友 `/mypixiv`**、`/mute-tags` 独立页 | 静音标签、屏蔽（仅 webview 生效） |
| **设置** | `/image-cache` 三层缓存 + 磁盘上限、`/image-host` 镜像 4 模式、`/client-switch` 引擎切换、About/Debug | `/update` 独立页、主题色 + 毛玻璃 | 网络自检、WebDAV 备份 |
| **翻译** | DeepSeek BYOK + S1–S7（LRU 200 章 / 章节搜索 / R18 三段门控） | OpenAI Responses BYOK + 跨流污染防护 + 恶意时序守卫 | R18 门控、流式优先 |
| **图像** | WebView `shouldInterceptRequest` 拦截快路径（32MB 内存 + `Cache-Control: immutable`） | LynxView 无此钩子，走 `PictelioImageService` | 共享 `PixivImageLoader`（磁盘 L3 + OkHttp 池 + 按 URL 锁） |
| **更新** | Ed25519 签名校验（`OtaSignatureVerifier`） | 无 Java 侧签名验证类 | 共用 `@pictelio/update-check` |
| **设计** | Fluent Design 2（4 曲线 / 5 时长 / A2 Cardization） | Material 3（rpx/vw + M3 色板） | — |

---

## 4. 核心表 C — 优点（客观，不自夸）

### 4.1 webview 客户端

| 优点 | 证据 | 竞品对照 |
|---|---|---|
| **access_token 永不入 JS heap** | `PixivApiCore` Java `volatile` 字段 + 401 自动刷新 + Promise 队列 | Shaft 是 OkHttp 拦截器（等价但机制不同）；pixez/PMF/PiPixiv/SwiftUI 均为客户端内存持有 |
| **refresh_token Keystore + 备份三层防御** | `SecureStorageCompat` + `BackupCrypto` | 仅 Shaft（EncryptedSharedPreferences）同级 |
| **三层缓存 + 三个独立开关 + 50–1000MB 上限** | ADR-0090 | **全场最细**（其余靠 Glide/Coil/Kingfisher 默认） |
| **多镜像 4 模式 + 原生 resolve** | `ImageHostConfig.resolve()`（ADR-0143） | 仅 Shaft 有 4 模式镜像；其余无 |
| **ugoira 约 2% 下载即播首帧** | `streamUgoiraFrames` + fflate 流式注入 | lynx 端为 4.5–8.6%（Java 批式）；Shaft 是补帧而非流式 |
| **章内小说搜索（高亮+跳转）** | `NovelSearchBar.tsx` | 全场仅此项，Pivlite/Pixeval 无 |
| **OTA WebBundle + Ed25519 验签** | `OtaPlugin` + `OtaSignatureVerifier` | 竞品均为应用商店 / GitHub Release / F-Droid；**自建带签名 OTA 无人做** |
| **9 格式小说导出** | `@pictelio/novel-export`（双端共享） | 仅 Pixiv-Reader-MD3（PDF/TXT）与 PMF（EPUB）部分覆盖 |
| **引擎可用性做成产品级显式能力** | `EngineRouting.resolve` 单一决策源 + 双向降级 + 失败记忆 | **全场唯一**（竞品无「渲染引擎」这一层） |

### 4.2 lynx 客户端

| 优点 | 证据 | 竞品对照 |
|---|---|---|
| **WebView < 85 的老设备可运行** | ADR-0164 缺省 Lynx，WebView 仅为降级目标 | 原生/Flutter 竞品无此约束；**对 WebView 路线竞品是结构性优势** |
| **文本选择菜单** | `createTextSelection` + `lynxSelectionEngine` | 仅 SwiftUI（但它是双语对照，非选词菜单） |
| **追更 / 稍后看 / 好P友** | `/watchlist` `/later` `/mypixiv` | **webview 缺**；竞品 Shaft 跟读、PiPixiv 追更 |
| **M3 文本选择 + 遮罩式内容过滤** | `AiOverlay` / `RestrictOverlay` | 遮罩优于过滤（全受限时不白屏，ADR-0051 记录了过滤方案的失败） |
| **三段式小说介绍页可关闭** | `novel_intro_first` 设备级开关 + `openNovel()` 单一 seam | 竞品无此粒度 |
| **平台一致性自检页** | `/platform-check`（仅 benchNav 深链可达） | 竞品无对标物 |

### 4.3 双端共有

| 优点 | 证据 |
|---|---|
| **共享登录态** | `PictelioSecureStorageModule` 复用同一份 Keystore，登录一次两边可用 |
| **共享 Java deep module** | 32 个 main 类（图像/缓存/Keystore/备份/下载/导出/翻译 SSE/引擎决策）双端同源 |
| **AI 翻译不过我们的服务器** | 两端均 BYOK 直连 DeepSeek / OpenAI |
| **工程化密度** | 175 ADR + 93 spec + 225（webview）+145（lynx）单测 + 13 agent-browser E2E + 20 android-e2e + Robolectric + 突变测试 |
| **CodeGraph 索引** | 1,262 文件 / 17,071 节点 / 55,573 边 |

---

## 5. 核心表 D — 缺点（诚实清单）

### 5.1 双端共有

| 缺点 | 严重度 | 说明 |
|---|---|---|
| **必配代理** | 🔴 最高 | 唯一「全场主流都有而我们没有」的可及性能力。README 承认回退 `127.0.0.1:7897` |
| **单平台** | 🔴 高 | 仅 Android。PiPixiv/PMF 五端、SwiftUI Apple 三端、Pixeval Win |
| **无多账号** | 🟡 中 | 双端均无；Shaft / Pivlite 有，PiPixiv 也还没有（#128） |
| **无以图搜源** | 🟡 中 | 双端均无；Shaft 的 `ReverseImage.java` 约 200 行，四引擎枚举 |
| **无平板两栏** | 🟡 中 | 双端均无；5 个活跃 Android 项目里只有 Shaft 做 |
| **AI 能力只有翻译一格** | 🟡 中 | Shaft 有超分/抠图/补帧/OCR 四合一；Pivlite 有云端高清化 |
| **依赖非官方 App API** | 🟠 中高 | 结构性风险，见 §7 |
| **小说无书架 / 离线 / 繁简转换** | 🟡 中 | Pixiv 书源在此维度仍是标杆（虽然载体下架） |
| **无漫画独立体系** | 🟡 中 | 仅多页浏览，无按章/跟读/双向翻页 |
| **零商业化路径** | ⚪ 中性 | 与 BYOK 定位一致，但也意味着无收入支撑 |

### 5.2 webview 独有缺点

| 缺点 | 说明 |
|---|---|
| **缺追更 / 稍后看 / 好P友** | lynx 已有，webview 没有 —— **同产品双端反向缺口，最刺眼** |
| **缺文本选择** | 小说正文无法选词/复制片段 |
| **无平台自检页** | 对 lynx 有 `/platform-check`，webview 无对应物 |
| **章节搜索外的阅读辅助较弱** | 无阅读位置书签（PiPixiv v2.3 有独立于收藏的阅读位置书签） |

### 5.3 lynx 独有缺点

| 缺点 | 说明 |
|---|---|
| **无用户屏蔽能力** | 源码两处自述缺失（`relatedInjection.ts:6` / `backupWiring.ts:53`）；只有静音标签 |
| **无图片缓存设置** | `imageCache` 在 lynx 全库 0 命中，用户无法调磁盘上限/开关 |
| **无镜像源设置 UI** | 仅部分命中，无完整 4 模式配置入口 |
| **无三次级布局** | 仅单列，webview 有瀑布/网格 |
| **无章内小说搜索** | webview 有 |
| **无 WebView 拦截快路径** | LynxView 无 `shouldInterceptRequest`，丢 32MB 内存直返 + immutable 缓存头 |
| **无 OTA 验签** | Java 侧无 `OtaSignatureVerifier` 对应实现 |
| **无客户端切换页** | 切引擎需重启 |
| **小说布局弱于 webview** | 无 Pretext 虚拟化，长文本性能与排版保真度较弱 |

---

## 6. 核心表 E — 缺失功能（按 ROI 排序）

| 优先级 | 缺失项 | 现状 | 竞品对位 | 难度 | 建议归属 |
|---|---|---|---|---|---|
| **P0** | **国内直连** | 必配代理 | Shaft(Cronet QUIC+No-SNI) / PixEz(ECH) / PMF / SwiftUI | 中（分档） | 双端（Java 层） |
| **P0** | **webview 补追更/稍后看/好P友** | lynx 已有 | PiPixiv 追更 | 低（照搬 lynx） | webview |
| **P0** | **可切换 API 实例 / 代理降级** | 无 | `pixiv-viewer` 把它做成正式功能 | 低-中 | 双端 |
| **P0** | **限流退避作为一等公民** | 无 | PiPixiv 有全局并发限流；Mihon 源与 Pixiv 书源**都是 0** | 低 | 双端 |
| **P0** | **小说正文解析韧性** | 两端均用 `/webview/v2/novel` + HTML 正则提取 | pixivpy 2025-05~07 正是踩这个坑（结构变更致正则失配，#408/#411/#413） | 低（加契约测试 + 降级通道） | 双端 |
| **P1** | **以图搜源** | 无 | Shaft 四引擎 / PixEz / SwiftUI / Pivlite | 低（约 200 行） | 双端 |
| **P1** | **平板横屏两栏** | 无 | **仅 Shaft** | 低 | webview 优先 |
| **P1** | **多账号** | 无 | Shaft / Pivlite | 中 | 双端 |
| **P1** | **多镜像域名模式** | 已有回退骨架，域名未扩 | Shaft 5 模式；注意 `pixiv.cat` **已被墙** | 小 | 双端 |
| **P1** | **翻译调度三件套** | 部分具备（流式有；并发按序合并 / 队列重试 / 缓存指纹未见） | PiPixiv 三项齐全且有单测 | 低（纯逻辑） | 双端 |
| **P2** | **小说书架 / 离线 / 繁简** | 无 | Pixiv 书源（载体已下架但能力仍是标杆） | 中 | webview 优先 |
| **P2** | **本机超分（Real-CUGAN Pro）** | 无 | **仅 Shaft**（且它推荐 CUGAN over ESRGAN for 动漫） | 中（NCNN + 模型分发是真问题） | 双端 |
| **P2** | **ugoira RIFE 补帧** | 无 | 仅 Shaft（11 MB flownet） | 中（复用超分链路，边际成本最低） | 双端 |
| **P2** | **ugoira H.264 MP4 导出** | 无 | Shaft（`MediaCodec`+`MediaMuxer`，APK 增量 0） | 中 | 双端 |
| **P2** | **漫画独立体系** | 无 | Shaft（系列按章/跟读/双向翻页） | 中 | webview 优先 |
| **P3** | **lynx 补屏蔽 / 缓存设置 / 镜像设置** | 缺 | — | 低 | lynx |
| **P3** | **cut-out 抠图** | 无 | Shaft（u2netp 4MB 内置 / isnet-anime 84MB） | 中（ToS 暴露面高于超分） | 双端 |
| **P3** | **标题/简介/评论翻译** | 无 | SwiftUI（标题/简介/用户简介/全评论） | 低（复用 BYOK 通道） | 双端 |
| **P4** | **MCP / AI Agent 接入** | 无 | **仅 Pixeval** | 低 | 需先有桌面端 |
| **P4** | **永久收藏缓存（防作者删图）** | 无 | SwiftUI（实验性） | 中 | 双端 |
| ❌ **不建议** | **ECH** | — | 仅 pixez-flutter | OkHttp/Cronet 均不暴露 ECH 接口，Java 侧需自实现客户端（人月级） | — |
| ❌ **不建议** | **SNI 替换（pixiv.me）** | — | PiPixiv | 零冗余赌 Cloudflare 宽容度，PiPixiv 2026-09 已因此失效 | — |
| ❌ **不建议** | **云端高清化 / 服务端 AI 翻译** | — | Pivlite / Shaft 云端 | 必须有 GPU 成本 = 必须有服务器 = 与 BYOK 定位直接冲突 | — |
| ❌ **不建议** | **漫画全链路（CTD+Manga-OCR+像素回填）** | — | Shaft | 四维评分 14/20（满分 20，越低越值得做），单项即 5 星工程门槛 | — |
| ❌ **不建议** | **API 走 QUIC/Cronet** | — | Shaft | Shaft 自认「赌 GFW 暂未管 QUIC」；且引入 cronet-embedded 会造成 WebView 内置栈 + Cronet 双栈并存（Shaft 从未面对的新风险） | — |

---

## 7. 结构性风险（本轮最重要的非功能发现）

### 7.1 依赖非官方 App API 的风险清单

| # | 风险 | 发生日期 | 证据 |
|---|---|---|---|
| 1 | 密码登录撤销（`invalid_grant` code 1508），refresh_token 成唯一凭据 | 2021-02-09 起 | pixivpy #158 |
| 2 | App 端 `X-Client-Hash` 绑定客户端版本，**App 发版可致静默 401** | 2019-09-03 引入 | pixivpy #83 |
| 3 | **小说正文端点 `novel_text` 被删**，pixivpy 迁移到 `webview_novel()` | 2024-02-29 | pixivpy #337 |
| 4 | 小说正文**网页结构变更致正则失配**（表现：同作者全量失败、手动重试又好了） | 2025-05-22 首发 / 07-31 修 | pixivpy #408 #411 #413 |
| 5 | 错误不可诊断（`message`/`reason` 空串、`user_message_details` 空对象） | 2026-04-11 | pixivpy #415 |
| 6 | 风控/人机验证按账号触发第三方客户端 | 2025-10-31 / 2026-07-14 | PixivSource #56 #84 |
| 7 | 官方条款明文「**予告なしに**…改訂、変更、提供停止」+ 禁 crawler 式收集与极端负载，**且不违规也可要求停止** | 条款现行版（末次修订 2026-08-17） | pixiv.net/terms |
| 8 | 非商用约束 + 禁「情報解析（含 AI 训练）」损害投稿人利益 | 条款禁止事项 | pixiv.net/terms |

> **Pictelio 现状核实结果**：小说正文走 `/webview/v2/novel`（**已是 pixivpy 迁移后的通道**，非已删除的 `novel_text`），但两端都用 `extractNovelDataFromHtml` / `extractNovelTextFromHtml` **正则提取 HTML** —— 正是风险 #4 的形态。这是当前最该加防线的一处。

### 7.2 可监控的「信号灯」（零成本，建议纳入 CI 或 cron）

| 信号 | 含义 |
|---|---|
| PixivPy 突然有新提交 | 上次触发 = 小说正文通道变更 |
| PixivBiu（Go，★1459，push 2026-09-23）出现 auth/签名相关提交 | App 签名机制变更 |
| pixiv3-rs 复活 | API schema 变动 |
| `DowneyRem/PixivSource` 出现「无法获取正文 / 无法验证我是人类」issue | **网页通道也开始加风控**（最坏信号） |

### 7.3 合规

- 官方条款**明文允许**第三方客户端，条件四条：① 风险自担 ② 版权归创作者 ③ 可无预告变更/停供 ④ **不 crawler、不压服，但即使不违规 pixiv 也可要求停止**；且须标注「基于 pixiv 平台开发」+「非 pixiv 出品」，名称不得混淆。
- **不存在「转向官方 API」的合规替代路径**：全量条款中唯一成文的 API 是 **VRoid Hub 认证合作方 API**（需签约登记 + 报备 + 仅 3D 模型）；`pixiv.net/developers/` 返回 404，`developer.pixiv.net` 连接失败。

---

## 8. 结论

**一句话**：Pictelio 在**工程深度、安全模型、缓存可调粒度、阅读器细节**上是全场第一梯队；但在**可及性（直连）、平台广度、AI 能力广度**三项上是空档，且**双客户端之间存在反向功能缺口**（webview 缺追更/稍后看/好P友，lynx 缺屏蔽/缓存设置/镜像设置）——这个内部不一致比任何外部竞品差距都更该先修。

**三条判断**：

1. **最快见效的是「内部对齐」而非「对外追赶」**：把 lynx 已有的追更/稍后看/好P友/文本选择回填到 webview，把 webview 已有的屏蔽/缓存设置/镜像设置/三布局回填到 lynx —— 这是**零外部依赖、纯搬运**的工作，且直接消除用户在同一产品两个引擎间的功能落差。

2. **直连要分档做、且按「可随时失效」设计**：P0 是 DoH 查 CNAME 源站名 + DoH/硬编码 IP 兜底（增量，不推翻 `/pixiv-img/` 代理与 `PixivApiCore` 架构）；P1 是图片通道 No-SNI + 镜像域名扩模式（`.cat` 已知被墙）；**QUIC/Cronet 与 SNI 替换都不建议**（前者是 Shaft 自认的赌注且引入双 Chromium 网络栈，后者零冗余且已有 PiPixiv 失效先例）。

3. **BYOK 定位需要修正，不能继续当卖点**：本轮最诚实的评估是——**BYOK 的隐私优势是真的，但 Shaft 的端侧 AI（超分/抠图/补帧/OCR）同样「nothing uploaded」，隐私水位是平的**；BYOK 的成本优势省的是一笔我们本来就没有的成本，同时**结构性地放弃了「有服务才有钱赚」的变现路径**；且 BYOK **只能解决纯文本任务**，竞品的超分/抠图/补帧/OCR 没有一项能靠「让用户填个 API key」实现。建议把 BYOK 重新定位为**「翻译这一格的护城河：隐私 + R18 门控 + 章内搜索 + 流式注入」**（这部分我们确实领先 PiPixiv 的翻译调度），而不是「AI 能力的差异化」。

---

## 附：本轮未能核实的断言（重要）

- **下架/失效的具体日期与原因**：iFier / Vveer / Pixiv Mate 的 App Store 下架日期与原因（iTunes API 不提供下架记录）。
- **Pivlite 直连与 AI 的实现细节**：闭源，仅一方文案 + release notes，无源码。
- **Palleria / Pixiv-Reader-MD3 的直连**：README 无任何表述，未找到证据。
- **Danbooru/gelbooru 标签翻译**在 Mihon 生态的具体实现：未查证。
- **「2024–2026 批量失效」的集中事件**：未找到新闻/官方级信源，现有证据均为逐仓 issue 级端点变更。
- **Mihon Pixiv 源总数**：`index.pb` protobuf 解析失败，「恰好 2 个 Pixiv 源」基于 code search 路径穷举。
- **Pixiv 条款中文版**：`/terms_zh` 返回 404，引用均为日文原文。
- **pixiv-viewer 的「AppAPI 代理/多 API 实例」**：仅 README 自述，未运行验证。

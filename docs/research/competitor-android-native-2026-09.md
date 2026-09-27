# Android 原生 Pixiv 第三方客户端竞品调研（2026-09 快照）

> 调研范围：Android 平台（及紧邻的多端 KMP）Pixiv 第三方客户端
> 取数时间：**2026-09-27 06:13 UTC**（下文所有 star / issue / release 日期均为该时点快照）
> 工具：`gh` CLI（`gh api repos/...`、`gh api repos/.../releases`、`git/trees?recursive=1`、issues API）、`raw.githubusercontent` / GitHub API raw、`f-droid.org/repo/index-v2.json`、`curl`
> 授权状态：`gh auth status` → 已登录 `a1121611810`（scopes: gist, read:org, repo, workflow）

## 0. 免责声明与取数口径

- **star 数 / open issue 数会随时间变化**，本文所有数字是 2026-09-27 的快照，不是"现在"。
- **许可证一栏以 GitHub API 的 `license.spdx_id` 为准**；`NOASSERTION` / `null` 表示仓库没有可识别的 SPDX 声明，本文不会替它推断。
- **"最近一次 release"指 GitHub Releases 里 `published_at` 最新的那个 tag**，不等于该 tag 指向的 commit 日期，也不等于作者实际构建 APK 的日期（Shaft 两者就差了 5 天，见 §1.3）。
- **所有结论后面都跟一个 URL**。没有 URL 的句子是作者自己的读后感，不是事实断言，已在文中用"判断"二字标出。
- 本文只覆盖 Android 生态；Pixiv 生态全景、macOS/Windows 商业客户端、直连/AI 专题由另外三份研究负责，本文不重复。
- **"Pixiv Reader"未能锁定单一权威仓库**——见 §2.7。

## 1. Pixiv-Shaft（对外名 PixShaft）

### 1.1 速写

| 项 | 值 | 取数时间 |
| --- | --- | --- |
| 仓库 | `CeuiLiSA/Pixiv-Shaft`（默认分支 `classic`，注意不是 `master`） | 2026-09-27 |
| 官方站 | https://pixshaft.com ｜ Google Play: `ceui.pixiv.pshaft` | 2026-09-27 |
| 许可证 | **GPL-2.0** | 2026-09-27 |
| 语言 / 栈 | Kotlin；MVVM；Retrofit 2；Room；Glide；自研 feeds 框架；**Cronet**；**ONNX Runtime**；**ncnn**（原生 .so） | 2026-09-27 |
| minSdk / targetSdk / compileSdk | **24 / 36 / 36**（Android 7.0+ → Android 16） | 2026-09-27 |
| 最近 release | **v4.9.4**，GitHub 发布 2026-09-18；**但 release body 写明 APK 于 2026-09-23 才更新**（重构建修小说横翻 bug） | 2026-09-27 |
| 最近 commit | `3c09692` **2026-09-27**（`feat(download)`: 剩余空间不足 100MB 时整体暂停下载） | 2026-09-27 |
| Star / Fork / Open issues | **7927 / 254 / 6** | 2026-09-27 |
| i18n | `values`（简）+ `-en` `-ja` `-ko` `-ru` `-tr` `-zh-rTW` = **7 个 locale** | 2026-09-27 |
| F-Droid | **不在** f-droid 官方索引（`index-v2.json` 无 `ceui.*` 任何包） | 2026-09-27 |

信源：
- 仓库元数据 https://api.github.com/repos/CeuiLiSA/Pixiv-Shaft
- README 原文 https://raw.githubusercontent.com/CeuiLiSA/Pixiv-Shaft/classic/README.md
- SDK/依赖 https://raw.githubusercontent.com/CeuiLiSA/Pixiv-Shaft/classic/app/build.gradle
- release v4.9.4 https://api.github.com/repos/CeuiLiSA/Pixiv-Shaft/releases/tags/v4.9.4
- F-Droid 索引 https://f-droid.org/repo/index-v2.json

### 1.2 功能清单（README 逐条摘录，中译 + 英文原词）

来自 https://raw.githubusercontent.com/CeuiLiSA/Pixiv-Shaft/classic/README.md 与 https://raw.githubusercontent.com/CeuiLiSA/Pixiv-Shaft/classic/FAQ.md ：

- 个性化插画 / 漫画 / 小说推荐 + 实时刷新的热门标签（"trending tags"）
- 排行榜与图表中心：日 / 周 / 月榜 + 日期选择器回看任意一天；Discover 页有**收藏榜、AI 榜、年代榜、壁纸榜、标签专区、作者榜**（"bookmark charts, AI charts, charts by era, wallpaper charts, tag zones and artist charts"）
- 搜索：6 种排序、上传时间区间、**收藏数区间**、长宽比、分辨率、三档 AI 开关；**"按人气排序不需要 Pixiv Premium"**
- 以图搜源：**SauceNAO / TinEye / IQDB / Ascii2D**，一键找出处（"Reverse image search"）
- 原生 FANBOX（动态流、推荐作者、完整正文与方案）+ 内嵌 pixiv COMIC 首页
- 小说阅读器 + 本地库：系列、章节、书签、进度百分比、自动混入关联插画；**指向一个文件夹读本地 txt**；收藏时把整本存成 TXT
- 多账号快速切换（关注、私信、收藏可跨账号）
- 批量下载 · 可续传：整批入队、网络断了从断点续、**命名模板批量重命名**、导出 caption、**把任务交给 NAS 上的 aria2**
- 屏蔽设置：按 tag / 按作者分别管理，或就地屏蔽单个作品（卡片模糊 + 一键揭示）
- **Watch later（稍后再看）**：长按卡片收藏，**纯本地、不上报**
- **网络自检页**：DNS、App API、web 端点、真实图片下载逐项检查，当场点出 **IPv6 污染**
- 冷启动秒开 / 本地优先：首页推荐、榜单、最新作品从上次快照秒开，后台静默刷新；**收藏与关注进持久队列，离线点的操作不丢**
- 竖屏/横屏两栏：平板横屏开启后左 1/3 列表 + 右 2/3 详情（"two-pane"）
- 漫画：系列按章展示、关注作者不错过更新、整章阅读、批量下载/收藏、"**整本系列翻译**"离开阅读器后仍在后台跑
- 发现页：漫画/小说栏目、PixiVision 特辑、实时热门标签、最新投稿

### 1.3 值得注意的差异化子系统（**怎么做**，不是"有这功能"）

#### (1) 直连方案：QUIC/HTTP3 + No-SNI TLS **双通道**（架构级差异化）

信源：https://raw.githubusercontent.com/CeuiLiSA/Pixiv-Shaft/classic/docs/direct-connect.md

这是全部调研对象里**唯一公开写清楚"为什么放弃了老路、换成什么路"的技术文档**：

```
API 请求: Retrofit → OkHttp → CronetInterceptor → Cronet Engine → QUIC/UDP → Cloudflare (104.18.*)
图片加载: Glide → OkHttp → RubySSLSocketFactory(无SNI) → HttpDns(自定义IP) → TLS/TCP → 210.140.*
```

- **通道一（API）用 Cronet QUIC**：`org.chromium.net:cronet-embedded`，`HostResolverRules` 把 Pixiv 域名硬映射到 Cloudflare IP 绕开污染 DNS，Retrofit 层代码零改动（靠 `CronetInterceptor` 桥接）。
- **通道二（图片）用 No-SNI TLS**：自定义 `SSLSocketFactory` 传 `null` 主机名让 ClientHello 不带 SNI；`HttpDns` 硬编码 `210.140.139.134/133/131`；**强制 HTTP/1.1** 以免多请求复用同一条被干扰的连接。
- 文档自己承认这条路的**脆弱性**：`pixiv.net` 目前不在 GFW 的 QUIC SNI 黑名单里，"这不是一条 GFW 管不了的路，而是一条 GFW 暂时还没来管的路"（引 https://gfw.report/publications/usenixsecurity25/zh/ 与 https://dnshistory.org/dns-records/app-api.pixiv.net ）。
- 文档还列了**为什么不用其他方案**的对照表（DoH 单独不够、改 TLS 指纹没用、域前置在 Cloudflare 上失效、**Pixiv 的 Cloudflare 未启用 ECH**、换端口无效、依赖中继不可控）。
- 触发这次架构迁移的直接原因写得很具体：**2026 年 4 月前后老方案在 API 侧退化，部分账户开始 403 / 握手异常**，而图片侧（`i.pximg.net` 仍在 Pixiv 自有基础设施）不受影响。

#### (2) AI 套件：ONNX Runtime + ncnn 双推理栈，**模型按需下载而非打包**

信源：源码树 https://api.github.com/repos/CeuiLiSA/Pixiv-Shaft/git/trees/classic?recursive=1 与 https://raw.githubusercontent.com/CeuiLiSA/Pixiv-Shaft/classic/app/build.gradle

| 能力 | 实际实现（文件名即证据） | 推理栈 |
| --- | --- | --- |
| AI 超分 | `upscale/RealESRGANUpscaler.kt` + `UpscaleModel.kt` + `UpscaleTaskPool.kt` + `BoundedBitmapDecode.kt` + 前后对比页 `UpscaleCompareFragment.kt` | **ONNX Runtime**（Real-ESRGAN） |
| 智能抠图 | `upscale/BackgroundRemover.kt` + `RembgModel.kt` + `SubjectHighlightView.kt`（**可框选主体的交互控件**）+ `RembgPreviewFragment.kt` | ONNX Runtime（rembg 系） |
| 漫画翻译 | `translate/ComicTextDetector.kt`（气泡检测）+ `MangaOcrRecognizer.kt`（识别）+ `TextEraser.kt`（擦字）+ `TextRenderer.kt`（回填）+ `BubbleAreaFinder.kt` + `SelectionBoxView.kt`（圈选）+ `MangaPageTranslatePipeline.kt` + `MangaBatchTranslateCenter.kt` | ONNX Runtime |
| ugoira 补帧 | `interpolate/RifeInterpolator.kt` + `RifeModelManager.kt` + `RifeDownloadFragment.kt` | **ncnn**（`app/libs/arm64-v8a/librife_ncnn.so`，仓库内唯一的预编译原生 .so） |
| 小说 / 标签翻译 | `AiTranslator.kt`（可接 OpenAI 兼容端点）、`CloudTranslator.kt`（Shaft 自家云，`shaftapi/CloudTranslationStream.kt`）、`GoogleWebTranslator.kt`（Google 翻译网页） | 服务端 |

**关键的架构选择**：`RembgModelDownloadFragment.kt` / `RifeModelManager.kt` / `MangaOcrModelManager.kt` / `TranslationModelManager.kt` 四个 `*ModelManager` + 对应 `*ModelDownloadFragment` 说明**模型是首次使用时按需下载**，不是塞进 APK。对一台 minSdk 24 的设备来说这是唯一可行的做法。

#### (3) 下载体系：模板化落盘 + aria2 JSON-RPC 远端派发

信源：https://raw.githubusercontent.com/CeuiLiSA/Pixiv-Shaft/classic/DOWNLOAD.md 与 `app/src/main/java/ceui/pixiv/download/aria2/Aria2Client.kt`

- **落盘是可配置模板语法**，默认模板原文：
  ```
  Shaft/Illusts/[?R18:R18/][?AI:AI/]{author} ({author_id})/{title} {id}[?p>1: p{page}].{ext}
  ```
  语法只有 4 条规则：普通文字原样、`{变量}` 替换、`[?条件:内容]` 条件成立才出现、`/` 是子目录。变量含 `{id} {title} {page} {pages} {ext} {author} {author_id} {w} {h} {created:yyyyMMdd_HHmmss} {series} {series_order:00} {chapters}`。
- 4 张**预设卡片**（Shaft 经典 / 扁平 / 按日期分组 / 按作者分组），每张卡直接预览"一张插画会存成什么样"。
- aria2 远端：自己实现了 `Aria2Client.kt`，调 **`aria2.addUri` JSON-RPC**（`http://host:6800/jsonrpc`，带 `token:<secret>`），短超时、失败尽快反馈。`Aria2Dispatcher.kt` 做派发策略。
- 2026-09-27 的最新 commit `3c09692` 明确说"对标 pixez#1361"，新增 `StorageSpaceGuard`：**剩余空间 < 100MB 时整体暂停下载**，避免往快满的盘写 0B 空文件；aria2 远端下载不查。

#### (4) 自研 `actionqueue` 模块：把写操作变成持久化限流队列

信源：https://raw.githubusercontent.com/CeuiLiSA/Pixiv-Shaft/classic/docs/action-queue.md

这是**整个调研里工程成熟度最高的一块**，值得单独看：

- 独立 Android library `ceui.pixiv.actionqueue`，**对 pixiv 零依赖**（不引 retrofit/okhttp/gson），只认识"带 type 的不透明 payload 字符串"。用自己的库 `pixiv_action_queue.db`，避免给主库 v41（19 条手写 migration、24 张表）加表。
- 语义：**入队即返回 → 后台串行按最小间隔发 → 撞 429 整队冷却并自动重试 → 进程被杀后下次启动继续发**。
- 关键决策（文档逐条论证）：
  - **`delay` = 执行间隔，不是入队后延迟**（429 限的是单位时间请求数，节流点必须在消费侧）；冷启动第一条立即执行。
  - **入队按 `dedupeKey` 替换式合并**（连点爱心 收藏→取消→收藏 最终只发一个请求）。
  - **429 → 整队冷却而非单条退避**（429 是账号级的）；退避 30s→60s→120s→300s 封顶 + ±20% 抖动。
  - **冷却值落库**（`queue_meta` 表），因为"后台待几分钟被系统回收"恰好发生在冷却窗口里。
  - **钳墙钟错乱**：落库的是绝对时刻 + `Clock.SYSTEM` 是墙钟，RTC 失效设备开机带偏前时间 → 429 写下的截止时刻在 NTP 校回来后 `now < cooldownUntilMs` 恒真 → 队列静默停摆到重装。`start()` 按 `QueuePolicy.maxPossibleCooldownMs` 钳一刀**并写回库**。
  - **有 `owner` 字段**：库跨登录态持久，不分归属的话 A 没发完的收藏会用 B 的 token 发出去。
  - 唤醒用 `Channel<Unit>(CONFLATED)`，**不用 Room 的 `Flow` 驱动 consumer**（`DownloadQueueDao` 注释记过这个坑：高频 UPDATE 下 InvalidationTracker 首次 emit 后静默不再触发）。
  - 有意偏离仓库惯例：用 KSP 不用 kapt、可注入 class 不用 `object` 单例、不开 `allowMainThreadQueries()`、不用 `fallbackToDestructiveMigration`（队列里躺的是用户点过但还没生效的收藏，销毁式迁移会静默吃掉）。

#### (5) 自研 `feeds` 模块 + 翻页预算：`maxAutoPages = 30`

信源：https://raw.githubusercontent.com/CeuiLiSA/Pixiv-Shaft/classic/docs/feeds-module.md

- 全 app 上百个列表页共用 `FeedSource` / `FeedRenderer` / `FeedViewModel` / `FeedFragment` 骨架，拆成独立 library `ceui.pixiv.feeds`，**108 个消费方一行 import 都没改**。
- 文档点名了一个**真实线上事故**："一次搜索 48 秒翻 89 页、一直翻到 pixiv 的 5000 条 offset 上限，全是这个形态，没有一个是人在看。"根因是触底预取零间隔 + 本地过滤（屏蔽/R-18）把一页滤成"薄页"，于是零间隔连翻。
- 解法：首屏之后的每次翻页过两道闸 —— `minPageIntervalMs`（默认 1s）+ **连翻预算 `maxAutoPages`（默认 30 页）**；两页之间隔了 `burstIdleResetMs`（默认 5s）以上预算归零。判据写得很实："人类重度翻页 12–20 s/页，跑飞 ≤ 2.4 s/页"。
- 另有 `FeedCacheBackend` 抽象做首屏本地优先（但 Room 实现留在 `:app`，"不该为一个可选能力把 Room 拖进框架"）。

#### (6) 画像源抽象：一个抽象类撬动 85+ 调用点

信源：https://raw.githubusercontent.com/CeuiLiSA/Pixiv-Shaft/classic/docs/image-host.md

- `ImageHostManager.kt`（~95 行）抽象 `enum Mode { PIXIV, PIXIV_CAT, CUSTOM }` + `rewrite(url)` + `requiresStandardClient()`。
- **杠杆点选得很准**：`GlideUrlChild` 构造函数里调 `rewrite(url)`，一处覆盖 **~85 个 `.load()` callsite**，只需直接改 6 个文件的代码。
- 两个反直觉但正确的设计决策：
  - **rewrite 在 load 时应用，不在 store 时**——data model 存原始 pximg URL，分享/复制 URL 走原值（发给别人也能打开）；13 处分享点明确列为"设计上不接线"。
  - **暴露 `requiresStandardClient()` 探针**处理与直连的互斥：直连的 No-SNI + 硬编码 IP + `TrustAllCertManager` 三件套只对 `i.pximg.net` 有效，切到 pixiv.cat/自建反代必须全部失活。
- ⚠️ 文档自己标注 **"地基已落库 + 26 个 unit test 全过；未接线"**（写作时状态）。是否已接线未核实。

### 1.4 商业模式

- **免费 + 广告-free + 全功能解锁**（含 AI 超分 / 抠图 / 漫画翻译 / ugoira 补帧）。
- **唯一有配额的是"任意关键词按人气排序"**（因为用共享搜索资源）：Free 1× / Pro 5× / Max 20×；用完后降级到"人气预览"。**订阅不解锁独占功能，只加配额**。到期自动回落 Free，无自动续费。
- 已经是 pixiv Premium 会员的走官方 API，无限、不需订阅。
- 变现：爱发电 https://afdian.com/a/pixshaft + pixshaft.com/#pricing ；应用内 Usage 页可直接下单，Afdian 下单可用 "Restore purchase" 领取。
- 有 App 推介计划（邀请好友 / 推荐帖 / 教程换 7 天 PRO/MAX 体验卡，v4.9.4 release body）。
- **无 F-Droid**，只走 Google Play + GitHub Releases + 官网。

### 1.5 已知短板 / 限制（带链接）

| 短板 | 证据 |
| --- | --- |
| **小说 AI 翻译极慢**：8 Gen 3 上 55 行花 4 分钟，用户判断"即使加流式也基本不可流畅阅读" | issue https://github.com/CeuiLiSA/Pixiv-Shaft/issues/864（2026-05-07 开，至今 open） |
| **直连并非稳**：FAQ 自述中国移动 / 广电 / 长城 / 校园网不保证直连效果；登录过程仍需外部代理（reCAPTCHA） | https://raw.githubusercontent.com/CeuiLiSA/Pixiv-Shaft/classic/FAQ.md |
| **QUIC 路径是"暂时可用"**：文档自认 `pixiv.net` 一旦进 QUIC SNI 黑名单即失效 | https://raw.githubusercontent.com/CeuiLiSA/Pixiv-Shaft/classic/docs/direct-connect.md |
| **仅保证邮箱/pixivid+密码登录**，Google 登录"由于兼容性问题不保证支持" | FAQ.md |
| **非 Premium 无法翻页**：默认"热度排序（非会员仅显示部分）"下，官方限制只能看有限条热度作品，FAQ 给的解法是"加其他过滤条件联合限制" | FAQ.md |
| 图片源抽象**文档标注未接线**（写作时） | docs/image-host.md |
| 无 F-Droid 分发 | f-droid index-v2.json |
| 5 个 locale 缺 `values-es` 等，且 `values-tr` 曾缺 `string_331` | docs/image-host.md 接线 checklist #11 |

---

## 2. PixEz（Flutter 版为主，附原生版）

### 2.1 pixez-flutter 速写

| 项 | 值 |
| --- | --- |
| 仓库 | `Notsfsssf/pixez-flutter`（默认分支 `master`） |
| 许可证 | **GPL-3.0** |
| 语言 / 栈 | **Dart / Flutter**；状态管理 `mobx` + `flutter_bloc`（逐步弃用）+ `provider`；`custompainter` 播 ugoira；`intl` 做 i18n；**Rust 插件 `rhttp`**；`dio` 5.10.0 + `dio_compatibility_layer` + `dio_cache_interceptor` |
| compileSdk / targetSdk | **37 / 37**（minSdk 跟随 `flutter.minSdkVersion`） |
| 最近 release | **0.9.109，2026-09-07**（versionName 写的是 `"0.9.109 repeat"`） |
| 最近 commit | `c27a45e` **2026-09-26**（PR #1366 merge） |
| Star / Fork / **Open issues** | **12942 / 487 / 516**（star 数为全部调研对象最高；issue 积压也最高） |
| 平台 | Android（Google Play `com.perol.play.pixez`）/ iOS（App Store，美区+中国区）/ Windows（Nightly MSIX） |
| F-Droid | **不在**官方索引（`com.perol.play.pixez` 查无；`com.perol.asdpl.play.pixivez.libre` 是旧原生版） |

信源：https://api.github.com/repos/Notsfsssf/pixez-flutter ｜ https://raw.githubusercontent.com/Notsfsssf/pixez-flutter/master/README.md ｜ https://raw.githubusercontent.com/Notsfsssf/pixez-flutter/master/android/app/build.gradle.kts ｜ https://raw.githubusercontent.com/Notsfsssf/pixez-flutter/master/pubspec.yaml

### 2.2 Pix-EzViewer（旧原生版）速写

| 项 | 值 |
| --- | --- |
| 仓库 | `ultranity/Pix-EzViewer`（默认分支 `master`） |
| 许可证 | **MIT** |
| 语言 | Kotlin + Jetpack |
| 最近 release | **v2.2.5，2026-06-22**（前一个 v2.2.4 是 2026-06-21，一天内两发） |
| 最近 push | **2026-07-04** |
| Star / Fork / Open issues | **1263 / 41 / 20** |
| F-Droid | **在**（`com.perol.asdpl.play.pixivez.libre`，注意与 GitHub Release 包名不同） |
| 状态 | **上游 FAQ 明确宣布"已经停止维护"** |

信源：https://api.github.com/repos/ultranity/Pix-EzViewer ｜ https://raw.githubusercontent.com/ultranity/Pix-EzViewer/master/README.md ｜ pixez-flutter FAQ 原文 `https://raw.githubusercontent.com/Notsfsssf/pixez-flutter/master/.github/FAQ.md`

### 2.3 值得注意的差异化子系统

#### (1) **三档网络模式**：`standard` / `compat` / `ech`

信源：https://raw.githubusercontent.com/Notsfsssf/pixez-flutter/master/lib/network/network_mode.dart

```dart
enum NetworkMode { compat('compat'), ech('ech'), standard('standard'); }
static const List<NetworkMode> selectableValues = [NetworkMode.ech, NetworkMode.compat, NetworkMode.standard];
bool get usesCompatibleConnection => this != NetworkMode.standard;
```

**ECH（Encrypted ClientHello）是本次调研里唯一一个明确实现了 ECH 的 Android Pixiv 客户端。** Shaft 的 direct-connect.md 明确写了 "ECH（加密 ClientHello）| Pixiv 的 Cloudflare 配置未启用 ECH"——两家结论相反，而 pixez 的 `ech` 模式在 2026-09-26 的 HEAD 上仍然 selectable。这个矛盾我没能核实到底（见 §5）。

- DoH 走 `https://doh.dns.sb`（`onezero_client.dart`），并且**对证书全放行**（`badCertificateCallback = (cert, host, port) => true`）。
- HTTP 层是自建的 **Rust `rhttp` 插件**（`plugins/rhttp/rhttp/rust/src/api/client.rs`），Dart 侧套 `dio_compatibility_layer`。
- 用户可见开关叫"**不要绕过 SNI 嗅探**"，打开 = 不绕过（= 需要科学上网，关掉内置魔法，还能"小小加快启动速度"）。FAQ 自述"受限于运营商等因素，直连的速度可能会比较慢"。

#### (2) SAF + 传统模式双存储路径（应对国产魔改系统）

信源：pixez FAQ

Android 11 分区存储后改用 SAF（Storage Access Framework），但 FAQ 直言"**部分魔改过度的系统阉割了这个功能**"（典型症状：点"确认"后不来 `com.android.documentsui`），所以新版同时支持 SAF 模式与传统模式（需存储权限）由用户选。FAQ 甚至给出了曲线救国方案（装一个 DocumentsUI.apk 小工具）。这是一个**只有在国产 Android 真实环境里才会踩到、踩到才会做**的设计。

#### (3) 内建 Pixiv 账号注册流程

FAQ 原文：没有账号可以点"没有账号？"，按流程走完 app 会帮你建一个全新 pixiv 账号，注册后到"设置 → 账户信息"查看用户名密码备用。**全部调研对象里只有它把注册做进了客户端。**

### 2.4 已知短板 / 限制（带链接）

| 短板 | 证据 |
| --- | --- |
| **收藏标签功能"始终处于不可用"**，用户用了很多年、点遍控件无变化 | issue https://github.com/Notsfsssf/pixez-flutter/issues/1327（2026-09-02 开，open） |
| **小说搜索在 AI 刷文环境下会搜不到任何内容**（屏蔽 AI 作者后叠加日期区间才能搜到） | issue #1354（2026-09-15 开，open）＋ #1346 Novel Tags in Bookmarks（2026-09-08）＋ #1345 novel search screen bug ＋ #1358 novel search function |
| **存储空间不足会写出 0B 空文件**（Shaft 的 `3c09692` 明确写"对标 pixez#1361"） | issue #1361（2026-09-24 开，open）＋ #1336 下载列表重复"仍然存在" |
| **作者主页看不到"小说"板块**、无关注列表搜索 | issue #1339、#1347（均 2026-09 开，open） |
| **没有自动更新** | issue #1349（2026-09-10 开，open） |
| **直连慢**、需手动关；SNI 绕过依赖"墙娘暂时没来管" | FAQ 自述 |
| **登录错误码 103** 在密码正确时也可能是 pixiv 服务端拒绝弱密码，官方"恕 Pixez 无能为力" | FAQ |
| 旧原生版**已停止维护**，签名变化需卸载重装 | FAQ 明示 |
| **Play 下架历史**：原生版下架 → Flutter 版上架 → Flutter 版又被下架 → 历经波折才恢复 | FAQ「上架又下架是怎么一回事儿？」 |
| **516 个 open issue**（积累型维护：release note 里大量 "感谢 @xxx 的 PR"） | https://api.github.com/repos/Notsfsssf/pixez-flutter |

### 2.5 商业模式

- **完全免费开源，无内购、无订阅、无广告**（FAQ 里的 donation 只在旧原生版仓库 `ultranity/Pix-EzViewer` 有：国内爱发电 / 国外 Ko-fi `ko-fi.com/W7W5YU4B`）。
- 变现：Google Play 曝光 + 蓝奏云分发（README 标注"临时，不推荐"）+ Telegram / Discord / 企鹅群。
- 第三方数据合规：WebView bypass 规则 `assets/bypass/cealing-host.json` 来自 SpaceTimee/Cealing-Host，以 **BSL-1.0** 分发，周边源码仍 MIT；明确"不打包任何站点 favicon"。

---

## 3. Pixiv-MultiPlatform（magic-cucumber）

> 注意：**这个项目名下有两个仓库**。`kagg886/Pixiv-MultiPlatform-Legacy`（★276，GPL-3.0，Kotlin，push 2025-10-22）是旧版；当前活跃的是 `magic-cucumber/Pixiv-MultiPlatform`（★191）。另 `kagg886/pmf-website` 是官网仓库。本文只写活跃的那个。
> 调研任务给的 owner `Natsena/Pixiv-MultiPlatform` **不存在**（404）。

### 3.1 速写

| 项 | 值 |
| --- | --- |
| 仓库 | `magic-cucumber/Pixiv-MultiPlatform`（默认分支 `master`）；官网 https://pmf.kagg886.top |
| 许可证 | **GPL-3.0** |
| 语言 / 栈 | Kotlin **多平台（Compose Multiplatform 1.12.0-beta01）**；Ktor 3.5.1；Coil 3.5.0；**Room 3.0.0（KMP 版）**+ `androidx.sqlite-bundled` 2.6.2；Koin 4.2.2；kotlinx-serialization 1.11.0；Arrow；ksoup；telephoto；**`pixko = "2.11"`（kagg886 的 Pixiv API 库）**；AGP 9.2.1；含 `rust-toolchain.toml` |
| 最近 release | **v1.8.7，2026-07-24** |
| 最近 commit | `8fe93bc` **2026-09-15**（"we can restore when application launched (#99)"） |
| Star / Fork / Open issues | **191 / 9 / 3**（issue 数极少=维护极健康） |
| 平台 | Android / iOS / **Windows / Linux / macOS**（源码树有 `composeApp` + `iosApp`，KMP target 见 `composeApp/build.gradle.kts`） |
| F-Droid | **在**（`top.kagg886.pmf`，F-Droid 页显示 1.8.7，与 GitHub 最新一致） |

信源：https://api.github.com/repos/magic-cucumber/Pixiv-MultiPlatform ｜ https://raw.githubusercontent.com/magic-cucumber/Pixiv-MultiPlatform/master/README.md ｜ `.../gradle/libs.versions.toml` ｜ https://f-droid.org/packages/top.kagg886.pmf/

### 3.2 功能清单（README 逐条，含未实现项）

README 用 `- [x]` / `- [ ]` 自标实现状态，**未实现项也照抄**：

- 已实现：内置浏览器登录；首页（推荐插画/小说、排行 8 类：日/周/月/男/女/原创/新人、动态含关注者与全站最新）；搜索（热门 tag、搜索建议、标题匹配、3 种排序、结果分插画/小说/**作者**、按 id 猜测搜索）；插画详情（原图、下载、按 TAG 分类收藏、**指定私有收藏**、点赞、评论/回复/楼中楼）；小说详情（阅读器含**页数跳转 / 链接支持 / 内联图片**、**导出 EPUB**、系列、评论）；个人中心（资料、公开/私有收藏、**按 TAG 筛选收藏**、历史、下载管理、退出登录）；**PC 端快捷键**（↑↓ PgDn R ←→）；**无效作品过滤**（删除/无权限）；**手动过滤 R18 / R18G / AI**；**屏蔽 TAG 过长小说**；**屏蔽正文过短小说**；**使用 DoH 实现直连**；**自定义 TAG 过滤**；国际化。
- **未实现（README 自己打的 ❌）**：搜索结果里的**小说系列**、**修改资料**、**查看关注**。
- 另有 `magic-cucumber/wvbridge` 自研 WebView 桥（v1.8.7 换掉了原生 WebView 实现）。

### 3.3 值得注意的差异化子系统

#### (1) **唯一把"小说质量门槛"做成可配置过滤的项目**

README 列出两条别人都没写的过滤：**"屏蔽 TAG 过长小说"** 和 **"屏蔽正文过短小说"**。这两条直指 AI 刷文污染（对照 pixez issue #1354 的用户痛点）。配合 R18/R18G/AI 三档过滤 + 无效作品过滤 + 自定义 TAG 过滤，构成本次调研里最完整的**内容质量过滤矩阵**。

#### (2) 直连：`DoH` + 可开关的 SNI bypass，走公共 API 库

README 只写"使用 DoH 实现直连"。v1.8.7 release body 有一条 **"Fixed SNI bypass functionality"（PR #81）**——说明 SNI bypass 曾经坏过。API 层不自研，用 **`pixko`**（同一作者 kagg886 的 Pixiv API 库，另一仓库 `kagg886/Pixko` ★16，"适用于 pixiv-app 的 api，爱来自 Shaft"）。

#### (3) KMP 全平台 + F-Droid 双端同步

KMP 覆盖 5 端，且 F-Droid 上的版本（1.8.7）与 GitHub 最新 release **完全同步**——在本次调研的 9 个仓库里是唯一做到 F-Droid 不掉队的。

### 3.4 已知短板 / 限制

| 短板 | 证据 |
| --- | --- |
| **SNI bypass 曾整体失效**（2026-07 才修） | v1.8.7 release body https://api.github.com/repos/magic-cucumber/Pixiv-MultiPlatform/releases/tags/v1.8.7 → PR #81 |
| **打开大漫画会 OOM**（2026-07 才修） | 同上 → PR #84 |
| **功能缺口**：小说系列搜索、改资料、查看关注均未实现 | README 的 `- [ ]` 项 |
| 最近 release（2026-07-24）距取数日已 **2 个月**，commit 停在 2026-09-15 | release / commit API |
| 依赖 `pixko`（外部单维护者库） | `gradle/libs.versions.toml` |

### 3.5 商业模式

**完全免费开源，无订阅无广告**，F-Droid + GitHub Releases + 官网分发。

---

## 4. PiPixiv（Compose Multiplatform）

### 4.1 速写

| 项 | 值 |
| --- | --- |
| 仓库 | `darriousliu/PiPixiv`（默认分支 `master`） |
| 许可证 | **Apache-2.0**（本次调研里唯一的宽松许可） |
| 语言 / 栈 | Kotlin **2.4.20** + **Compose Multiplatform 1.12.1** + AGP 9.4.1 + Gradle 9.6.1 + **JDK 25**；Coil、Koin、multiplatform-markdown-renderer |
| minSdk / compileSdk / targetSdk | **26 / 37 / 37**（Android 8.0+）；iOS 部署目标 **18.0**（Swift Export） |
| 最近 release | **v2.5.1，2026-09-25**（v2.4.0 是 2026-09-05） |
| 最近 commit | `0605fba` **2026-09-25**（chore(release): 发布 v2.5.1） |
| Star / Fork / Open issues | **252 / 7 / 10** |
| 平台 | **Android 8.0+ / iOS 18+ / Windows x86_64 / macOS arm64 / Linux x86_64 = 5 端** |
| F-Droid | **在**（`com.mrl.pixiv`），但**版本落后**：F-Droid 页最新 **2.2.1**，GitHub 已 2.5.1 |
| 登录方式 | OAuth，**或网页端 Cookie（PHPSESSID）登录，无需手填 Token**；README 明说参考了 pixez-flutter 的登录实现 |

信源：https://api.github.com/repos/darriousliu/PiPixiv ｜ https://raw.githubusercontent.com/darriousliu/PiPixiv/master/README.md ｜ https://f-droid.org/packages/com.mrl.pixiv/

### 4.2 功能清单（README 逐条摘录）

- **认证**：Pixiv 账号登录（OAuth）；通过网页端 Cookie（PHPSESSID）登录，无需手动填写 Token。
- **浏览**：首页瀑布流；最新动态（发现 / 收藏 / 关注分类）；排行榜（日/周/月/男/女/AI 生成等）；**插画和小说本地浏览历史，支持搜索、清空和自动清理；Pixiv 高级会员可启用云端历史**。
- **插图**：详情（多图 / UGOIRA / 推荐插图）；**图片预览支持选择画质、缩放，以及按原图比例查看相关作品**；下载原图或 GIF，自定义文件命名，管理下载队列。
- **小说**：**插画/小说视图一键切换**（首页/动态/收藏/排行/搜索页均支持，偏好持久化）；沉浸式阅读（字号/行距/拖动滚动条定位；**调整排版时保持阅读位置**）；阅读时看简介/标签/系列信息、跳作者主页或系列目录；**系列目录提供继续阅读入口，分别显示上次阅读的章节标题与进度百分比**；AI 翻译；译文流式显示 + 本地缓存 + 原文/译文切换；**稍后阅读翻译队列（查看任务状态、重试失败、重新生成译文）**；自动保存/恢复进度 + Pixiv 小说书签 + TXT 导出。
- **搜索**：插画/小说/用户；人气/最新排序；**默认匹配方式/排序/AI 筛选可配全局默认，搜索页临时调整不覆盖全局**；连续滚动或分页（可前后翻页 + 跳页）；插画搜索可选方图或原图比例瀑布流，**小说搜索使用更宽的列表和紧凑标题**；长按 Tag 可收藏标签或复制。
- **用户与社交**：作者简介/资料/工作环境；插画/漫画/小说投稿/公开收藏（**小说预览可直接打开阅读**）；关注列表（自己的关注支持公开/私密分类）；评论与发表评论。
- **收藏互动**：收藏插图/小说、关注取关；收藏管理按标签筛选。
- **设置与系统**：语言、图片来源、网格列数、私密收藏；**默认系统代理，可切换直连或手动 HTTP/SOCKS 代理；Android 和桌面端另提供 SNI 模式**（改网络模式后需重启）；隐私设置（R-18 显示、进入搜索页时读剪贴板）；**屏蔽作品/用户/标签，可按长度与分段数量过滤小说长标签**；深度链接；**数据管理（缓存清理、数据导出/导入）**；**更新弹窗以 Markdown 展示发布说明，支持点击正文链接**。
- **桌面**：跟随系统浅/深色 + 手动；`R` 快捷键回顶/刷新、⬆️⬇️ 滚动、ESC 返回。

### 4.3 值得注意的差异化子系统（**怎么做**）

信源：源码树 https://api.github.com/repos/darriousliu/PiPixiv/git/trees/master?recursive=1

#### (1) AI 翻译：三 Provider 抽象 + Room 持久化 + 并发限流器

```
common/ai/src/commonMain/kotlin/com/mrl/pixiv/common/ai/
  model/OpenAiModel.kt
  provider/OpenAiTextClient.kt   provider/ClaudeTextClient.kt   provider/GeminiTextClient.kt
common/data/.../setting/AiTranslationConfig.kt          ← 可序列化的翻译配置
common/datasource-local/.../dao/NovelTranslationDao.kt
common/datasource-local/.../entity/NovelTranslationEntity.kt
common/repository/.../NovelAiTranslationService.kt     ← 编排
common/repository/.../NovelTranslationLimiter.kt        ← 全局并发限流
common/repository/.../NovelTranslationRepository.kt
feature/setting/.../ai/AiTranslationSettingScreen.kt
```

- **三个 provider 各自一个 `*TextClient`**，配置收敛到 `AiTranslationConfig`，UI 在 `AiTranslationSettingScreen` —— 分层干净，是本次调研里 AI 架构最清晰的一个。
- **有测试**：`OpenAiStreamParserTest`、`NovelTranslationLimiterTest`、`NovelTranslationStreamingTest`、`AiTranslationConfigSerializationTest`。
- README 明确能力边界：可配**局域网服务、模型、超时及请求参数**；**支持获取可用模型列表**；**限制全局并发**；翻译**正文、标题和简介**三项。
- 缺口：issue #121（2026-07-29）仍在请求"模型，并发数限制，标题简介翻译等"——但 v2.5.x README 已声称实现，**issue 可能未及时关闭**。

#### (2) Read Later = 独立实体 + 独立 DAO + **有队列策略测试**

```
common/datasource-local/.../dao/NovelReadLaterDao.kt
common/datasource-local/.../entity/NovelReadLaterEntity.kt
common/repository/.../NovelReadLaterRepository.kt
common/repository/.../NovelReadLaterSource.kt
common/ui/.../novel/NovelReadLaterButton.kt
common/.../NovelReadLaterDatabaseTest.kt            ← 真实 DB 测试
common/.../NovelReadLaterQueuePolicyTest.kt         ← 队列策略测试
```

**"稍后阅读"与"翻译队列"是一等公民实体，不是 UI 层的临时状态**——这与 Shaft 把 Watch Later 定位成"纯本地、不上报"的轻量收藏是不同的产品判断：PiPixiv 把它做成"待翻译任务队列"（可查看状态 / 重试失败 / 重新生成译文）。

#### (3) 网络层：SNI 替换做成了可测的纯 JVM 组件

```
common/network/src/androidJvmMain/kotlin/com/mrl/pixiv/common/network/
  DirectSocketFactory.kt   NetworkProxy.kt   OkHttpSni.kt
common/network/src/jvmTest/kotlin/com/mrl/pixiv/common/network/
  NetworkProxyTest.kt   SniReplaceDnsTest.kt
  SniReplacingSslSocketFactoryTest.kt   SniTlsIntegrationTest.kt   ← 含 TLS 集成测试
```

分层清晰：SNI 替换 DNS / SSLSocketFactory / 代理选择三件事分开，且**有 TLS 集成测试**（`SniTlsIntegrationTest`）——这点比 Shaft（无 SNI 侧的单测证据）更严。

#### (4) 模块化纪律（写在自己的 README 里作为硬约束）

`app → feature/* → core/ui → core/network → core/database · datastore · model → core/common`，**`feature` 之间禁止互相依赖，共享逻辑下沉 core**。且有 baseline profile 模块。

### 4.4 已知短板 / 限制（带链接）

| 短板 | 证据 |
| --- | --- |
| **SNI 直连模式已失效**（2026-09-18 报，v2.5.1 发布于 2026-09-25 但 issue 仍 open，**未能确认是否修复**） | issue https://github.com/darriousliu/PiPixiv/issues/146 |
| **没有多账号管理**，用户 2026-08-04 提交了完整的切换页 + 数据隔离 + 秒刷设计稿，**至今 open** | issue #128 |
| **没有自动缓存**（请求中） | issue #132（2026-08-18） |
| **没有应用内检查更新功能** | issue #142（2026-09-10）——与 README 的"更新弹窗"是 GitHub Release 检查，不是应用内更新 |
| F-Droid **构建失败** | issue #123（2026-07-31） |
| F-Droid 版本**落后 3 个 minor**（2.2.1 vs 2.5.1） | F-Droid 页 vs GitHub release |
| 改网络模式**需要重启应用** | README 明示 |
| 举报功能缺失 / M3E 实现被质疑 | issue #113（2026-06-12） |
| minSdk 26（Android 8.0），比 Shaft（24）高 | README |

### 4.5 商业模式

**Apache-2.0 开源免费**，F-Droid + GitHub Releases 分发，README 无任何内购 / 赞助 / 订阅描述。

---

## 5. Palleria（2026 年新项目，值得单列）

| 项 | 值 |
| --- | --- |
| 仓库 | `yunfie-twitter/Palleria`（创建 **2026-06-17**，不到 4 个月） |
| 许可证 | GPL-3.0-only |
| 语言 / 栈 | **Kotlin 2.x + Jetpack Compose + Miuix KMP（miuix-kotlin-multiplatform）+ Rust**（topics 里带 `rust`）；F-Droid 仓库托管在自建 `https://yunfi.f5.si/Palleria/repo/` |
| 要求 | **Android 13+** |
| 最近 release | **v6.2.1，2026-09-26**（同一天还有 `v6.2.1-pre.3` / `pre.4` 两个预发布） |
| 最近 push | **2026-09-27** |
| Star / Open issues | **8 / 1** |
| i18n | **只有日语和英语**（README 明示） |

信源：https://api.github.com/repos/yunfie-twitter/Palleria ｜ https://raw.githubusercontent.com/yunfie-twitter/Palleria/main/README.md

**判断**：star 极少、无中文、无直连（README 完全没提）、Android 13+ 门槛，**不是 Pictelio 的直接竞品**。但它有两处值得看：一是 **Miuix KMP 做设计系统**（小米系 M3 变体，与 Pictelio 的 Fluent 路线是不同取向）；二是**版本号策略**（6.2.1 而仓库只活了 3.5 个月 → 继承了上游或另一项目的版本序列）。

---

## 6. Pixiv-Reader-MD3（2026-08 新项目，架构范本）

| 项 | 值 |
| --- | --- |
| 仓库 | `nichijoux/Pixiv-Reader-MD3`（创建 **2026-08-23**） |
| 许可证 | GPL-2.0 |
| 语言 / 栈 | **Kotlin 2.4 + Jetpack Compose (M3)**；单 Activity + Compose Navigation + MVVM；**Hilt**；**Room + DataStore + MMKV（会话 token）**；Retrofit/OkHttp/Gson（`lib:pixivapi` 为 vendor 的 pixiv API 封装模块）；WorkManager（下载/导出）；**jsoup / PDFBox / Android-OpenCC（简繁转换）**；Coil（自动 Referer） |
| 要求 | Android 8.0 (API 26)+；JDK 21；Gradle 9.7.1 |
| 最近 release | **v0.3.1，2026-09-19** |
| 最近 push | 2026-09-19 |
| Star / Open issues | **2 / 0** |
| 在线发布页 | https://nichijoux.github.io/Pixiv-Reader-MD3/ |

信源：https://api.github.com/repos/nichijoux/Pixiv-Reader-MD3 ｜ https://raw.githubusercontent.com/nichijoux/Pixiv-Reader-MD3/main/README.md

**判断**：star 2、v0.3.1，**不是竞品，是范本**。它在 README 里写死了模块依赖硬约束（`app → feature/* → core/ui → core/network → core/database · datastore · model → core/common`，**`feature` 之间禁止互相依赖**），并给出版本化的在线发布页（GitHub Pages）。功能覆盖 ugoira 导出（MP4 / ZIP 帧包）、小说本地 TXT/EPUB/Markdown 导入 + PDF/TXT 导出、**追更**（小说/漫画系列分段追更 + 管理）、首页信息流快照（冷启动秒开、断网可离线浏览）、应用内更新检查（GitHub Releases + changelog 渲染）、`pixiv://` 深链。

**其声明的模块纪律与 PiPixiv 几乎逐字相同**（`feature` 之间禁止互相依赖）——这说明该约束已经是 2026 年 Compose Pixiv 客户端的事实共识。

---

## 7. PivisionM（已归档，作为历史参照）

| 项 | 值 |
| --- | --- |
| 仓库 | `mouyase/pivisionM` |
| 许可证 | **null（GitHub API `license.spdx_id` = null，无可识别 SPDX 声明）** |
| 语言 | Java |
| 最近 release | **v4.5.2，2022-04-22** |
| 最近 push | **2022-04-22** |
| Star / Open issues | **187 / 7** |
| 状态 | **`archived: true`** |

信源：https://api.github.com/repos/mouyase/pivisionM

**判断**：2022-04-22 后完全停更并归档，**4 年 5 个月零提交**，对 2026 年的 Android 客户端已无工程参考价值。保留在表里只作为"Java + 无明确许可"的历史坐标。

---

## 8. "Pixiv Reader"——未能锁定权威仓库

调研任务要求覆盖 "Pixiv Reader"，**未找到证据表明存在一个叫这个名字的、2025–2026 仍活跃的 Android Pixiv 客户端**。检索到的两个近似对象：

| 候选 | 判定 | 依据 |
| --- | --- | --- |
| `nichijoux/Pixiv-Reader-MD3`（app 名 "PixivReader"） | **最可能是所指**，但 2026-08-23 才建、★2、v0.3.1，**样本量不足以当竞品**，已在 §6 单列为"架构范本" | https://api.github.com/repos/nichijoux/Pixiv-Reader-MD3 |
| Pixiv for Muzei 3（`@Antony`） | **是 Muzei 壁纸插件，不是客户端** | https://raw.githubusercontent.com/ultranity/Pix-EzViewer/master/README.md 的"Ref links" |

**明确说明：本条为"未找到"，不是"不存在"。** GitHub 仓库名搜索（`q=pixiv reader android` / `q=Pixiv-Reader`）在本次会话中两次挂起超时（见 §5），未能穷尽。

---

## 9. 横向对比大表

图例：✅ 有且成熟 ｜ 🟡 有但简陋/已知问题 ｜ ❌ 无 ｜ — 未在该项目一手材料中找到证据（**≠ 没有**）

| 能力维度 | Pixiv-Shaft | PixEz (Flutter) | Pixiv-MultiPlatform | PiPixiv | Palleria | Pixiv-Reader-MD3 | PivisionM(归档) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **插画浏览** | ✅ 瀑布流 + 榜单 + 6 排序 + 发现页 | ✅ | ✅ 排行 8 类 | ✅ 瀑布流 + 预览 | ✅ | ✅ | ✅ |
| **漫画** | ✅ 系列按章 + 跟读 + 双向翻页 + 整本翻译 | 🟡 搜索功能有多个未修 bug（#1354/#1345/#1358） | 🟡 大漫画曾 OOM（2026-07 修） | 🟡 无独立漫画 Tab（走插画视图） | ✅ | ✅ 追更分段 | ✅ |
| **小说阅读** | ✅ 系列/章节/书签/进度/混入插画/**本地 txt**/**收藏存 TXT** | 🟡 搜索有 bug，#1327 收藏标签失效 | ✅ 页数跳转/链接/内联图/**导出 EPUB** | ✅ 一键切视图/**调排版保持位置**/**系列目录继续阅读**/**AI 翻译** | ✅ | ✅ **TXT/EPUB/MD 导入 + PDF/TXT 导出** | 🟡 |
| **下载体系** | ✅ **模板语法 + 4 预设 + aria2 JSON-RPC 远端 + 空间守卫** | 🟡 批量下载，有 0B 空文件/列表重复问题（#1361/#1336） | 🟡 下载管理 | 🟡 下载队列 + 自定义命名 | ✅ 内建下载管理器 | ✅ **WorkManager 后台 + 排队 + 重试 + 通知** | 🟡 |
| **直连** | ✅ **Cronet QUIC + No-SNI 双通道**（有完整技术文档） | ✅ **三档：standard / compat(SNI) / ECH** | 🟡 DoH + SNI bypass（2026-07 修过） | 🟡 直连 / HTTP / SOCKS / SNI（**SNI 2026-09 失效 #146**） | — README 未提 | — README 未提 | — |
| **AI 翻译（小说）** | 🟡 内置 + 可接 OpenAI 兼容端点，**但 8Gen3 上 55 行 4 分钟（#864）** | — README 未提 | — 未提 | ✅ **OpenAI/Claude/Gemini 三 provider + 全局并发限流 + 流式 + 本地缓存 + 标题简介** | — 未提 | — 未提 | — |
| **AI 增值（图像）** | ✅ **超分 Real-ESRGAN / 抠图 rembg / 漫画 OCR 翻译 / RIFE 补帧，全 ONNX+ncnn 本地推理** | — | — | — | — | — | — |
| **以图搜源** | ✅ **SauceNAO / TinEye / IQDB / Ascii2D** | ✅ | — | — | — | — | ✅ SauceNAO |
| **过滤 / 屏蔽** | ✅ 按 tag/作者/单作品 + 屏蔽记录 | 🟡 收藏标签功能失效（#1327） | ✅ **AI/R18/R18G/无效作品 + 小说 TAG 过长 + 正文过短 + 自定义 TAG**（最完整） | ✅ 屏蔽作品/用户/标签 + 小说长标签按长度与分段过滤 | 🟡 隐私控制 | ✅ 作品屏蔽（模糊遮罩 + 管理页） | 🟡 |
| **多账号** | ✅ 关注/私信/收藏跨账号 | ✅ | ❌ | ❌ **无**（#128 open） | ❌ | — | 🟡 |
| **平板 / 两栏** | ✅ 横屏左 1/3 + 右 2/3 | 🟡 横竖屏列数分别配置（0.9.109 刚修互相干扰） | — | — | — | — | 🟡 |
| **i18n** | ✅ **7 locale**（简/繁/英/日/韩/俄/土） | ✅ 贡献者维护 en_US/zh_TW/ja/id_ID | ✅ | ✅ | 🟡 **仅日/英** | 🟡 简/繁/英 | — |
| **备份 / 同步** | 🟡 云端浏览历史（上限 1000→3000/类）+ "Restore purchase" | — | — | ✅ **数据导出/导入 + Premium 云端历史** | — | — | — |
| **更新机制** | ✅ Google Play + GitHub Release + 应用内 Usage 页 | ❌ **无自动更新**（#1349） | ✅ F-Droid **1.8.7 与 GitHub 同步** | 🟡 更新弹窗（Markdown changelog）+ 检查更新在请求中（#142）；**F-Droid 落后 3 个版本** | ✅ 自建 F-Droid 仓库 | ✅ **应用内更新检查 + changelog 渲染** | — |
| **离线缓存** | ✅ **首屏快照秒开 + 持久写操作队列** | 🟡 | 🟡 Room KMP 落库 | 🟡 本地浏览历史（可搜索/清空/自动清理） | 🟡 浏览与搜索历史 | ✅ **首页信息流快照，冷启动秒开 + 断网可浏览** | — |
| **F-Droid** | ❌ | ❌ | ✅（同步） | ✅（滞后） | ✅（自建源） | — | — |
| **商业模式** | **免费全功能 + 订阅只加"人气排序"配额（1×/5×/20×）** | 免费，无内购 | 免费 | 免费 | 免费 | 免费 | — |

### 表中最关键的 5 行（含数据）

1. **直连** —— Shaft（QUIC+No-SNI 双通道，有技术文档）> PixEz（三档含 **ECH**）> PMF（DoH+SNI）> PiPixiv（SNI **已失效**）> Palleria / Pixiv-Reader-MD3（README 无任何直连表述）。**5 个活跃项目里没有一个是"什么都没做"，但没有一个是稳定的。**
2. **AI 增值（图像）** —— **只有 Shaft 一家有**，且是四合一（超分 / 抠图 / 漫画 OCR 翻译 / RIFE 补帧）全本地推理。其余 6 家**全为空**。这是当前 Android Pixiv 客户端最大的一块空白。
3. **AI 翻译（小说）** —— 只有 **PiPixiv** 达到"三 provider + 并发限流 + 流式 + 本地缓存"的水准；Shaft 有但**性能不可用**（#864）；其余 5 家为空。
4. **多账号** —— Shaft ✅ / PixEz ✅ / PMF ❌ / PiPixiv ❌（#128）/ Palleria ❌ / PivisionM 🟡。**多账号不是行业标配**，这一点对 Pictelio 是好消息也是坏消息：好的是差异化空间大，坏的是 Shaft 已占位。
5. **平板两栏** —— **只有 Shaft 一家做**（横屏左 1/3 + 右 2/3），PixEz 只是列数配置。Pictelio 也没有（§10）。

---

## 10. 对 Pictelio 的启示

差距性质标注：**【功能缺失】** = 我们没有 ｜ **【我们更差】** = 我们有但不如 ｜ **【我们更好】** = 反向优势

| # | 差距 | 性质 | 证据 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | **以图搜源**（SauceNAO/TinEye/IQDB/Ascii2D 四引擎） | **【功能缺失】** | Shaft README "Reverse image search" + `utils/ReverseImage.java`（枚举含 `SauceNao`/`Ascii2D`，`IMAGE_MAX_SIZE = 15MB` 因 SauceNao 上限） | Pictelio 全仓 `grep -riE "saucenao\|ascii2d\|tineye\|iqdb" packages/` → **0 命中**。这是本次调研里成本最低、差异感最强的一块（Shaft 的 `ReverseImage.java` 只有约 200 行） |
| 2 | **平板横屏两栏** | **【功能缺失】** | Shaft README "On a tablet in landscape you can turn on two-pane: list on the left, detail on the right" | Pictelio `grep -rilE "tablet\|平板\|two-pane"` → **0 命中**。Android 上平板是真实增量市场，**5 家里只有 1 家做**，抢位成本低 |
| 3 | **多账号切换** | **【功能缺失】** | Shaft "Fast multi-account switching: Follows, DMs, bookmarks" | Pictelio 仅在 `watchLaterStore.test.ts` 出现 multiAccount 字样，无独立实现。**注意 PiPixiv 的 #128 设计稿可以直接抄**（切换页 + 数据隔离 + 秒刷三段式） |
| 4 | **AI 图像增值套件**（超分 / 抠图 / RIFE 补帧） | **【功能缺失】** | Shaft `upscale/RealESRGANUpscaler.kt`、`upscale/BackgroundRemover.kt`、`interpolate/RifeInterpolator.kt` + `librife_ncnn.so` | **6 个在跑的项目里只有 Shaft 有，且是端侧本地推理**（"nothing uploaded"）。Pictelio 已有 DeepSeek 翻译，接 ONNX Runtime 的边际成本不高；**模型按需下载**（Shaft 的 4 个 `*ModelManager`）是 minSdk 24 设备的唯一可行路径 |
| 5 | **漫画独立体系**（系列按章 / 跟读 / 双向翻页 / 整本翻译） | **【功能缺失】** | Shaft README Manga + Manga reader 两节 | Pictelio 仅 `packages/app/src/routes/UserIllusts.tsx` 出现 manga 相关命中，**app-lynx 无漫画 Tab**。Pixiv-Reader-MD3 的"追更分段管理"和 Shaft 的"关注作者不错过更新"是两个可抄的最小形态 |
| 6 | **下载落盘模板 + aria2 NAS 远端** | **【功能缺失】**（模板）/ **【我们更差】**（队列健壮性） | Shaft `DOWNLOAD.md` 模板语法 + `aria2/Aria2Client.kt`（`aria2.addUri` JSON-RPC） | Pictelio 有 `DownloadManager`（双端都有），但无命名模板、无远端派发、无空间守卫。**0B 空文件这个坑 PixEz 踩了、Shaft 刚补**（`3c09692`），我们应先补 `StorageSpaceGuard` 再谈模板 |
| 7 | **i18n 语种数** | **【我们更差】** | Shaft 7 locale vs Pictelio **2**（`packages/app-lynx/src/i18n/locales` 只有 `en` + `zh-CN`） | Shaft 的 7 locale 里含 **ru / tr / ko**——这三个是 Pixiv 用户密度高的市场 |
| 8 | **持久化限流写操作队列** | **【我们更差】** | Shaft `docs/action-queue.md`（`:actionqueue` 独立 module，dedupeKey 合并、429 整队冷却、冷却落库、墙钟钳制） | Pixiv 对第三方客户端有 429 风控（这是**结构性**约束，不是 Shaft 的个别问题）。Pictelio 的「先渲染后加载 + 竞态防护」硬约束解决不了"连点爱心打 429"——**Shaft 的 `dedupeKey` 替换式入队是现成解** |
| 9 | **翻页预算 / 防跑飞** | **【我们更差】** | Shaft `docs/feeds-module.md`（`minPageIntervalMs=1s` + `maxAutoPages=30` + `burstIdleResetMs=5s`，判据"人类 12–20 s/页 vs 跑飞 ≤2.4 s/页"） | 文档点名了线上事故："一次搜索 48 秒翻 89 页"——**这是刷收藏数/刷推荐数据的副作用**，对账号有风控风险 |
| 10 | **小说质量门槛过滤**（TAG 过长 / 正文过短 / AI 刷文） | **【功能缺失】** | PMF README 明列"屏蔽 TAG 过长小说""屏蔽正文过短小说" | PixEz 用户 2026-09-15 因 AI 刷文导致小说搜索搜不到任何内容（#1354）——**这是 2026 年的新问题**，PMF 是唯一给出可配置解的 |
| 11 | **应用内更新检查** | **【功能缺失】** | Pixiv-Reader-MD3（"应用内更新检查（GitHub Releases + changelog 渲染）"）、PiPixiv（Markdown changelog 弹窗） | Pictelio 有独立的 `@pictelio/update-check` 包，但**客户端是否已接、是否有 changelog 渲染未核实** |
| 12 | **SAF + 传统模式双存储路径** | **【我们更差】**（待核） | PixEz FAQ（国产魔改系统阉割 `com.android.documentsui`） | Pictelio 走 Capacitor 原生下载，**是否已在国产 ROM 上被 SAF 阉割问题咬过未核实**——这是一个 Pictelio 特有的高风险点（Capacitor + 双引擎） |
| — | **【我们更好】** 阅读器排版能力 | — | `openwiki/domain/novel-reader.md` + `@chenglou/pretext` 虚拟布局 | Shaft 的小说阅读器被用户报"横翻页内容显示不全、段间距设置不生效"（v4.9.4 才修），PiPixiv 的痛点是"调整排版时保持阅读位置"（已在 v2.5.x 修）。**Pictelio 的 pretext 虚拟布局在候选集里是唯一有专门架构文档的** |
| — | **【我们更好】** 双引擎架构 | — | ADR-0164 + `EngineRouting.resolve` | 9 个竞品全部是单引擎。这是架构级差异，不在功能表维度上 |

---

## 11. 本次未能核实的断言（**这比结论本身更重要**）

| # | 未核实项 | 原因 | 影响 |
| --- | --- | --- | --- |
| 1 | **ECH 的真伪与实际效果** | pixez 的 `NetworkMode.ech` 枚举确实存在于 2026-09-26 的 HEAD；Shaft 的 `direct-connect.md` 则断言"Pixiv 的 Cloudflare 配置未启用 ECH"。两者直接矛盾，我**没有验证 pixez 的 ech 模式是走真 ECH 还是仅仅是个占位/降级分支** | 影响"ECH 是不是可行路线"这个结论。若 pixez 的 ech 只是名义上的，§1.3 与 §2.3 的对比需要重写 |
| 2 | **Pixiv-Shaft 的 `ImageHostManager` 是否已接线** | `docs/image-host.md` 写作时自标"地基已落库 + 26 个 unit test 全过；**未接线**"。文档与代码之间可能已有时间差，我**没有去查 `GlideUrlChild` 构造函数当前是否真的调了 `rewrite`** | 影响"Shaft 的图片源切换是否算已交付能力" |
| 3 | **PiPixiv 的 SNI 失效（#146）是否已在 v2.5.1 修复** | issue 于 2026-09-18 开，v2.5.1 发于 2026-09-25，但 issue 在我取数时仍为 open。**我没有读 v2.5.1 的 release body** | 影响"PiPixiv 直连是否可用" |
| 4 | **Pixiv-Shaft 的小说翻译是否在 v4.9.4 之后有性能改进** | #864（2026-05-07）报"8 Gen 3 上 55 行 4 分钟"仍 open，**但我没有验证近期 commit 是否有性能相关改动** | 影响"Shaft AI 翻译不可用"这个判断的时效性 |
| 5 | **Pixiv-MultiPlatform 的 minSdk / targetSdk 数值** | 走 `prop("MIN_SDK")` / `prop("TARGET_SDK")` 间接引用，值在某个我没找到的 properties 文件里，**只确认了 `APP_VERSION_NAME=v1.8.7`** | 影响 §3.1 表格的完整性 |
| 6 | **PivisionM 的许可证** | GitHub API 返回 `license.spdx_id = null`。**没有去读仓库 LICENSE 文件**，因此本文只说"无可识别 SPDX 声明"，未推断任何许可 | 若被误读为"无许可=无限制"会有法律风险 |
| 7 | **Shaft 的 7 个 locale 里 `values-tr` 缺 `string_331` 是否已补** | 来自 `docs/image-host.md` 的接线 checklist，是**计划中待办**，不是当前状态 | 影响 i18n 完整度判断 |
| 8 | **PixEz Flutter 的 516 个 open issue 里有多少是重复/无效的** | 只看了最新 25 条。**没有做去重或分类统计** | 影响"PixEz 维护质量差"的判断强度——它同时也有 487 forks 和大量外部 PR |
| 9 | **"Pixiv Reader" 是否真的存在另一个活跃仓库** | 两次 GitHub 仓库名搜索挂起超时（`q=pixiv reader android` / `q=Pixiv-Reader`），**搜索未穷尽** | §8 的"未找到"是**检索不足**，不等于不存在 |
| 10 | **Palleria 是否完全没有直连能力** | 只读了 README，**没有翻它的源码树**。README 未提不等于没有 | 影响 §9 表中 Palleria 的两个 `—` |
| 11 | **Shaft 的 aria2 派发是否支持进度回传** | 只读到 `Aria2Client.kt` 的 `addUri` / `getVersion` 两个方法，**没有确认是否还有 `tellStatus` 轮询** | 影响"远端下载"能力的完整度描述 |
| 12 | **各项目的实际下载量** | 只拿到 F-Droid 版本号与 GitHub release 日期，**未拉取 Google Play 的安装量**（需要非官方 API） | 无法做市场份额比较 |

---

## 12. 完整信源清单

### GitHub API（`https://api.github.com/...`，2026-09-27 取数）
- `repos/CeuiLiSA/Pixiv-Shaft` ｜ `repos/CeuiLiSA/Pixiv-Shaft/releases/tags/v4.9.4` ｜ `repos/CeuiLiSA/Pixiv-Shaft/commits` ｜ `repos/CeuiLiSA/Pixiv-Shaft/git/trees/classic?recursive=1` ｜ `repos/CeuiLiSA/Pixiv-Shaft/issues/864` ｜ `.../issues/1165`
- `repos/Notsfsssf/pixez-flutter` ｜ `.../releases/tags/0.9.109` ｜ `.../issues/1327` `1354` `1361`
- `repos/ultranity/Pix-EzViewer` ｜ `.../releases`
- `repos/magic-cucumber/Pixiv-MultiPlatform` ｜ `.../releases/tags/v1.8.7` ｜ `.../contents/gradle/libs.versions.toml`
- `repos/darriousliu/PiPixiv` ｜ `.../issues/128` `146` `132` `142` `123` `113` `121` ｜ `.../git/trees/master?recursive=1`
- `repos/yunfie-twitter/Palleria` ｜ `repos/nichijoux/Pixiv-Reader-MD3` ｜ `repos/mouyase/pivisionM` ｜ `repos/kagg886/Pixiv-MultiPlatform-Legacy`

### 原始文件（`raw.githubusercontent.com`）
- Shaft：`README.md`、`FAQ.md`、`DOWNLOAD.md`、`docs/direct-connect.md`、`docs/image-host.md`、`docs/action-queue.md`、`docs/feeds-module.md`、`app/build.gradle`、`app/src/main/java/ceui/pixiv/download/aria2/Aria2Client.kt`、`app/src/main/java/ceui/lisa/utils/ReverseImage.java`
- PixEz：`README.md`、`.github/FAQ.md`、`lib/network/network_mode.dart`、`lib/network/onezero_client.dart`、`lib/network/api_client.dart`、`pubspec.yaml`、`android/app/build.gradle.kts`
- Pix-EzViewer：`README.md`
- PMF：`README.md`、`README_EN.md`
- PiPixiv：`README.md`
- Palleria / Pixiv-Reader-MD3：`README.md`

### 外部
- F-Droid 官方索引 https://f-droid.org/repo/index-v2.json
- F-Droid 包页 https://f-droid.org/packages/top.kagg886.pmf/ ｜ https://f-droid.org/packages/com.mrl.pixiv/ ｜ https://f-droid.org/packages/com.perol.asdpl.play.pixivez.libre/
- Shaft 直连文档引用的 GFW 研究 https://gfw.report/publications/usenixsecurity25/zh/ ｜ https://dnshistory.org/dns-records/app-api.pixiv.net
- Shaft 商业页 https://pixshaft.com/#pricing ｜ https://afdian.com/a/pixshaft

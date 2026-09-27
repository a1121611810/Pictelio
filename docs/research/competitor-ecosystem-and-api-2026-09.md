# 调研：Pixiv 轻量 / 插件化生态 与 API 生态（vs Pictelio）

> **调研日期**：2026-09-27（取数窗口 2026-09-27T06:09Z ~ 06:20Z UTC）
> **工具**：`gh` CLI（`gh api` / `gh search`，已认证账号 `a1121611810`），辅以 `curl` 抓取 `www.pixiv.net/terms` 官方条款页
> **信源口径**：仅一手信源 —— GitHub 仓库源码（raw contents API）、commits / issues API、Releases API、官方条款页。**未使用训练记忆下任何结论**；抓不到的项目一律写「未找到证据」。
> **本文档分工**：只覆盖「轻量 / 插件化生态」与「API 生态及维护风险」。一体化原生客户端（Pixiv-Shaft / PiPixiv / PixEz 等）的功能面由 `docs/research/competitor-features-comparison.md` 与其余并行 worker 覆盖，本文不重复。
> **关联文档**：`docs/research/competitor-features-comparison.md`（**注意其 §0 表中「Legado 活跃（书源 v284，2026-09）」一行已过期，见本文 B 节更正**）。

---

## 1. 元信息与三条最重要的结论（TL;DR）

1. **「阅读器 + 书源插件」路线在 Pixiv 上只剩一条腿：小说。** Mihon/Tachiyomi 系仅有 2 个 Pixiv 源，且**没有任何小说源**（code search `novel` in:path 零命中）；Legado 系的 Pixiv 书源则把 100% 精力押在小说上（3 个书源：小说 / 小说备用 / 漫画）。插画-漫画侧是 Mihon 源的地盘，小说侧是 Legado 书源的地盘，中间没有一体化客户端的容身之处 —— **这正是 Pictelio 同时做两端的结构性理由**。

2. **Mihon Pixiv 源完全不需要登录。** 源码通篇走 `https://www.pixiv.net/touch/ajax/*` 公开移动端 AJAX 端点，无 Cookie、无 token、无 OAuth，唯一偏好设置是图片质量。这是「低 API 风险 = 低功能天花板」的最纯粹样本。

3. **Pictelio 依赖的非官方 App API 是**整条生态里**最不稳定的一层**。生态内已发生三次可查证的破坏性变更（2021-02 撤密码登录、2024-02 撤 `novel_text` 端点、2025-07 改小说正文页结构），每一次都让某个参考实现停摆；Pixiv 官方条款明文写「**予告なしに**（无需预告）其功能或内容会改版、变更、停止提供」。

---

## 2. A 节：Mihon / Tachiyomi 系的 Pixiv 源

### 2.1 生态定位速写

| 项目 | 状态（2026-09-27 实测） | 关键数据 | 一手信源 |
|---|---|---|---|
| `mihonapp/mihon` | 活跃，非归档 | ★23,841；最后 push **2026-09-26** | https://api.github.com/repos/mihonapp/mihon |
| `tachiyomiorgs/tachiyomi-extensions` | **仓库已删除（HTTP 404）** | API 直接返回 `{"message":"Not Found","status":"404"}` | https://api.github.com/repos/tachiyomiorgs/tachiyomi-extensions |
| `tachiyomiorg/extensions` | **已归档** | ★549；最后 push **2024-01-08** | https://api.github.com/repos/tachiyomiorg/extensions |
| `timschneeb/tachiyomi-extensions-archive` | 已归档（**被移除源的墓园**） | ★1,807；最后 push **2026-03-23** | https://api.github.com/repos/timschneeb/tachiyomi-extensions-archive |
| `keiyoushi/extensions-source`（源码）/ `keiyoushi/extensions`（APK 仓库） | 活跃，事实上的主力源仓库 | ★4,735 / ★15,071；push **2026-09-27** / **2026-09-26** | https://api.github.com/repos/keiyoushi/extensions-source |
| `yuzono/tachiyomi-extensions` | 活跃（Komikku / Mihon & forks 镜像源码） | ★906；push **2026-09-27** | https://api.github.com/repos/yuzono/tachiyomi-extensions |
| `Suwayomi/Suwayomi-Server` | 活跃（桌面/服务器端 Tachiyomi 重写） | ★7,759；push **2026-09-23** | https://api.github.com/repos/Suwayomi/Suwayomi-Server （2026-09-27 单独复核，200 OK） |

> **结论（生态层面）**：Tachiyomi 官方源仓库在 2024-01 前后被删除/归档，此后生态完全依赖社区志愿仓库。`keiyoushi/extensions-source` README 原文自述：「creating an issue does not mean that the source will be added or fixed in a timely fashion, because the work is volunteer-based. **Some sources may also be impossible to do or prohibitively difficult to maintain.**」（https://raw.githubusercontent.com/keiyoushi/extensions-source/master/README.md ）—— 这句话是本节所有「限流 / 抓取节流 / 长期维护」判断的前提。

### 2.2 Pixiv 相关源清单（穷举结果：恰好 2 个）

以 GitHub code search `repo:keiyoushi/extensions-source pixiv in:path` 穷举（2026-09-27），命中 12 个文件，归为 2 个源：

**① `all/pixiv` —— 源名 "Pixiv"，versionCode = 12，libVersion 1.4**

`src/all/pixiv/build.gradle.kts`（raw: https://raw.githubusercontent.com/keiyoushi/extensions-source/master/src/all/pixiv/build.gradle.kts ）：
- `baseUrl = "https://www.pixiv.net"`
- 语言：`listOf("en", "ja", "zh", "zh-tw", "ko").forEach { source { lang = it ... } }` —— 同一份代码产出 5 个语言版本
- `contentWarning = ContentWarning.MIXED`
- 支持 deeplink：host `pixiv.net` / `www.pixiv.net`，path `/artworks/..*`、`/users/..*`、`/user/..*/series/..*`（deeplink 为 2025-07-02 提交 `922139c2 Feat/pixiv deeplink (#9457)` 新增）

**② `ja/pixivcomic` —— 源名 "Pixiv Comic"，versionCode = 4，libVersion 1.6**

`src/ja/pixivcomic/build.gradle.kts`：`baseUrl = "https://comic.pixiv.net"`，仅 `lang = "ja"`，依赖 `project(":lib:publus")`。

> **「Pixiv-CN」未找到证据**：上述 2 个源之外，code search 无其它 Pixiv 源。`zh` / `zh-tw` 只是 Pixiv 源的**语言目录变体**（同一 baseUrl `www.pixiv.net`），**不是独立源、也不代表国内特供接口**。所谓「Pixiv-CN 源」在 keiyoushi 生态中不存在。

### 2.3 逐项事实：`all/pixiv`（Pixiv 插画源）

源码：`https://raw.githubusercontent.com/keiyoushi/extensions-source/master/src/all/pixiv/src/eu/kanade/tachiyomi/extension/all/pixiv/Pixiv.kt`

| 维度 | 事实 | 证据（源码位置 / 提交） |
|---|---|---|
| **登录方式** | **无登录。零认证。** 全部请求只加 `Referer` + `Accept: application/json` | `headersBuilder()` 仅 `.add("Referer", "$baseUrl/")`；`ApiCall` 仅追加 `lang` 与 `Accept`。全文件无 cookie / token / OAuth / login 符号 |
| **端点面** | 移动端公开 AJAX：`/touch/ajax/ranking/illust`、`/touch/ajax/illust/details/many`、`/touch/ajax/illust/details`、`/touch/ajax/illust/series/{id}`、`/touch/ajax/illust/series_content/{id}`、`/touch/ajax/search/illusts`、`/touch/ajax/user/illusts`、`/touch/ajax/latest`、`/ajax/user/{id}?full=1`、`/ajax/illust/{id}/pages` | 见 `fetchPopularManga` / `makeIllustSearchSequence` / `fetchPageList` 等 |
| **支持内容类型** | 插画 ✅ / 漫画 ✅ / 动图（ugoira）⚠️未见处理 / **小说 ❌ 显式排除** | `makeIllustSearchSequence` 内 `if (illust.type == "2") continue`（`type=="2"` 即小说，被丢弃）；`if (illust.is_ad_container == 1) continue` |
| **限流 / 抓取节流** | **无退避、无重试、无并发上限、无 429 处理**。分页靠 `countUp` + `p` 参数线性推进；常量 `RESULTS_PER_PAGE=36`、`TARGET_RESULTS=50`、`MAX_WINDOW_SIZE=1000`（源码注释「roughly 25 pages」）。强过滤时用 `fetchWithAdaptiveWindow` 估算窗口，最坏**一次搜索连续拉 25 页** | `companion object` 常量块；`fetchWithAdaptiveWindow()` 全函数 |
| **API 失败处理** | 仅 `PixivApiException`（`resp.error` 为真时抛出）→ `getOrThrow()` 直接向上冒泡，**无静默降级** | `ApiCall.executeApi()` |
| **本地缓存** | 三组 LRU，各 25 条：illust 详情、user 详情、series 列表 | `lruCached<String, ...>(25)`：`getIllustCached` / `getUserCached` / `getSeriesIllustsCached` |
| **标签翻译** | **❌ 无。** 标签原样 `illust.tags.joinToString()` 塞进 `manga.genre` | `fetchMangaDetails()` 中 `PixivTarget.Illustration` 分支 |
| **收藏 / 历史 / 关注同步** | **❌ 全无。** Tachiyomi 架构下书架/历史/章节进度是**本地**的，书签是本地收藏 | 源码无相关方法；架构性缺失 |
| **多账号** | **❌ 无** | 同上 |
| **用户搜索** | 走**桌面版页面 `__NEXT_DATA__` 解析**（需伪装 desktop UA），注释明写「mobile version is SPA without embedded data」 | `makeUserSearchSequence()`：`request.header("User-Agent", "...Chrome/131.0.0.0...")`、`doc.select("script#__NEXT_DATA__")` |
| **偏好设置** | **仅 1 项**：图片质量 `thumb_mini / small / regular / original`（默认 original） | `setupPreferenceScreen()` / `PREF_IMAGE_QUALITY` |
| **系列（Series）** | ✅ 原生建模：系列 → 章节列表 → 单话分页 | `fetchChapterList()` 中 `PixivTarget.Series` 分支 |
| **近期功能提交** | 2026-02-23 `81534b24`（按作者聚合插画）、2026-01-10 `9f10bc9b`（修用户搜索 + 过滤器 + 加图片质量）、2025-07-02 `922139c2`（deeplink）、2024-09-22 `f3dccf3e`（修搜索重复翻页） | `commits?path=.../Pixiv.kt` |

### 2.4 逐项事实：`ja/pixivcomic`（Pixiv Comic 源）

源码：`https://raw.githubusercontent.com/keiyoushi/extensions-source/master/src/ja/pixivcomic/src/eu/kanade/tachiyomi/extension/ja/pixivcomic/PixivComic.kt`

| 维度 | 事实 | 证据 |
|---|---|---|
| **登录方式** | **无登录**（全文件无 login / cookie / token 符号） | grep `login\|cookie\|Token` 零命中 |
| **端点面** | 与插画源**完全不同的生态**：`https://comic.pixiv.net/api/app/*`（`/rankings/popularity`、`/works/recent_updates/v2`、`/works/search/v2`、`/store/search/v2`、`/works/{id}/episodes/v2`、`/episodes/{id}/read_v4`） | `private val apiUrl = "$baseUrl/api/app"` |
| **内容平台** | **Publus 商业漫画分发平台**（Pixiv 官方漫画商店）：`https://comic-store-viewer.pixiv.net/api`，解析 `PublusContent`，并从 302 重定向链中提取 `cid` / `u1` / `u2` 做内容鉴权 | `private val viewerUrl`、`generateSequence(chapterResponse) { it.priorResponse }` → `parseAs<PublusContent>()` |
| **限流** | 未见专门节流逻辑 | grep |
| **近期提交** | 2026-07-17 `58d214a4 PixivComic: refactor, support volumes, preference (#17629)`、2026-07-19 `cbea93aa Update KeiSource based on some feedback (#17720)`、2026-08-31 `9b78a358 core: add Jsoup helper (#18741)` | `commits?path=.../PixivComic.kt` |

### 2.5 「小说源是否存在」的明确结论

> **不存在。** 2026-09-27 执行 GitHub code search `repo:keiyoushi/extensions-source novel in:path filename:*.kt` → **零结果**。且 `all/pixiv` 源码中 `illust.type == "2"` 被显式 `continue` 丢弃。
> **结论：Mihon / Tachiyomi 系读者把 Pixiv 小说完全排除在体系之外。**

### 2.6 「标签翻译」的明确结论

> **不存在（无证据）。** 源码中标签处理仅 `manga.genre = it.joinToString()` 与系列场景 `tags.joinToString()`，**无任何 Danbooru / gelbooru / 英文标签映射表**。Mihon 生态中确有独立的「Danbooru / gelbooru 系标签翻译」实践，但那是**另一批源**（booru 系），与 Pixiv 源无代码关系 —— 本次 code search 范围内未取得该批源的具体实现证据，故不作断言。

### 2.7 「路线 vs 一体化 App」结构性优劣（回答任务问题）

**结构性优势**
1. **零认证 = 零封号风险**。无 token、无 cookie、无账号态，请求全部落在 Pixiv 公开移动端 AJAX 上。风控打击第三方客户端时，**这个源不在打击面内**（打击面集中在带 `X-Client-Time` / `X-Client-Hash` 签名的 App API，见 C 节）。
2. **失效面极小**。整个源只有约 10 个端点、全部是「读公开数据」，Pixiv 没有动机也没有产品压力去改这些端点。实证：Pixiv 源自 2024-09 到 2026-09 的功能提交只有 4 次，且其中 2 次是修 bug（搜索重复翻页、用户搜索失效）而非应对 API 变更。
3. **架构解耦**。源是独立进程，崩了不影响 App；App 也不需要为源做适配。
4. **可被 Suwayomi 等服务端复用**，一次部署多端消费。

**结构性劣势**
1. **功能天花板被「无登录」锁死**。收藏 / 关注 / 追更 / 阅读历史 / 书架 / 多账号**一项都做不到** —— 不是没做，是**架构上不可能**，因为没有任何身份。
2. **小说 0 支持**。`type == "2"` 显式丢弃。
3. **无内容所有权**。书架、进度、书签全是本地数据，**换 App / 重装即丢**。
4. **单作品即长条不分页的笨模型**。一个多图插画被当作「一个作品 = 若干页」，但 Pixiv 生态里「作品 / 系列 / 收藏册 / 章节」是四层实体，源只能把 series 强行映射成「一个 manga + 多个 chapter」。
5. **维护是志愿的**（README 明说），单点依赖极少数人。
6. **书源规则不可编程**。Tachiyomi 的 `HttpSource` 是 Kotlin 抽象类，只能改代码重编译；而 Legado 的书源是**运行时 JS**，见 B 节 —— 这是两条插件路线的根本分野。

---

## 3. B 节：开源阅读（Legado）系 + Pixiv 书源

### 3.1 ⚠️ 重大更正：Legado 主仓库已于 2026-05-27 被清空

**这是本节最关键的事实，且直接推翻 `competitor-features-comparison.md` 现有的一行结论。**

| 证据 | 内容 |
|---|---|
| 仓库根目录内容 | 仅剩 **`README.md`** 与 **`公告链接.png`** 两个文件（`gh api repos/gedoor/legado/contents` 返回 `[{"name":"README.md"},{"name":"公告链接.png"}]`） |
| 仓库体积 | `size = 52` KB（对照：活跃 fork `huajideshutiao/legado` 为 67,577 KB ≈ 66 MB） |
| 历史 | `main` 分支**仅剩 1 个 commit**：`9bb05692`（2026-05-27，message = 「公告」）—— 代码历史已被重写/清除 |
| 公告全文（README.md 原文） | 「本项目涉及**侵权行为**的违法，也为此承担了相应的法律责任，在此郑重发布公告，**删除项目内容**并规劝所有人：请立刻停止一切侵权相关行为……法律底线不可逾越，违法违规必将付出代价」 |
| 公告指向 | 阅文知识产权保护公告 `https://mp.weixin.qq.com/s/bcTbqBQA1T0YoRwq76xcWQ?scene=1&click_id=8`（README 内以图片形式外链） |

一手信源：
- https://api.github.com/repos/gedoor/legado （`archived=false`，`open_issues_count=18`，`forks_count=5570`，`pushed_at=2026-05-27T08:41:54Z`）
- https://raw.githubusercontent.com/gedoor/legado/main/README.md
- https://github.com/gedoor/legado/commits/9bb05692

> **对 Pictelio 的直接含义**：`gedoor/legado` 已**不能再作为「活跃竞品」引用**。任何对外材料若称「开源阅读活跃维护」均为过期信息。`docs/research/competitor-features-comparison.md` §0 表该行需更正（本 worker 不修改他人所有文件，在此登记）。

### 3.2 继承者：阅读 Sigma（`Luoyacheng/legado-E`）

| 维度 | 事实 | 信源 |
|---|---|---|
| 仓库 | `Luoyacheng/legado-E`，★2,762，**非 fork**（`fork=false`），创建于 **2025-07-25** | https://api.github.com/repos/Luoyacheng/legado-E |
| 自述 | 「**阅读Sigma是legado的继承**，保持开源免费，延续开源精神。」 | 仓库 description |
| 最后 push | **2026-08-01**（`8b87c5ab 优化工作流文件`；此前 2026-07-24、2026-07-15 有实质修复） | https://api.github.com/repos/Luoyacheng/legado-E/commits |
| 关系 | 创建于 2025-07，**早于** 2026-05 的下架公告 → 是**预防性分叉**，不是事后接管 | 同上 |

> ⚠️ 注意时间线：阅读Sigma 分叉于 2025-07，而 gedoor/legado 清空于 2026-05。**清空的原因从公告看指向「侵权」与阅文 IP 维权，但两者的直接因果关系未找到证据** —— 只能确认：① 法律风险确实落到「阅读类聚合工具」头上；② 分叉先行一步。可能存在其他时间线，本文档不臆测。

### 3.3 Pixiv 书源本体：`DowneyRem/PixivSource`（仍在活跃维护）

| 维度 | 事实 | 信源 |
|---|---|---|
| 仓库 | `DowneyRem/PixivSource`，★1,046，forks 47，open issues 10，创建 2021-04-03 | https://api.github.com/repos/DowneyRem/PixivSource |
| 最后 push | **2026-09-22**（`0af4c62c Linpx JS：删除 this`；9-21/9-22 连续 8 次提交均为 Linpx 书源 JS 调优） | `commits?per_page=8` |
| 自述 | 「**臻享阅读：最好的 Pixiv 第三方小说阅读器——开源阅读 + Pixiv 书源**」 | https://raw.githubusercontent.com/DowneyRem/PixivSource/main/README.md |
| 文档站 | https://pixivsource.pages.dev （README 中的「书源官网」） | 同上 |
| 宿主要求 | 书源 `bookSourceComment` 内写明「**使用说明：📌阅读 Sigma 3.26.0216 版本可用**」 | `pixiv.json` 字段 |
| 活跃度信号 | 8 天内（2026-09-15~22）连续 8 次提交；open issue 最新 **2026-09-23 #98** | 见上 |

**书源数量：3 个**（`pixiv.json` 解析结果，2026-09-27 拉取，文件 421,225 字节）

| 书源名 | 分组 | 类型 | 版本 | 宿主要求 | 更新 |
|---|---|---|---|---|---|
| 🅿️ Pixiv 小说 | 🔞 Pixiv | — | 284 | 阅读 Sigma 3.26.0216 | 2026/09/21 |
| 🅿️ Pixiv 小说**备用** | 🔞 Pixiv | — | 284 | 阅读 **正式版** 3.25 | 2026/09/21 |
| 🅿️ Pixiv 漫画 | 🔞 Pixiv 漫画 | `bookSourceType=2`（漫画） | 284 | 阅读 Sigma 3.26.0216 | 2026/09/21 |

> **「备用书源」本身就是一个 API 风险应答机制** —— 同一能力提供两份实现，宿主可切换。GitHub 上还存在 open issue **#71（2026-05-10）「[BUG] Pixiv 备用书源无法添加喜欢标签」**，证明该机制真实在用（也是真实会坏的）。

### 3.4 逐项核实：书架 / 离线 / 进度 / 繁简 / 过滤 / 直连 / 规则引擎

来源：`DowneyRem/PixivSource` README「🆚 功能对比」表（与 Pixiv 官方 App 对照）+ 文档站 + 书源 JSON

| 能力 | 书源侧 | 官方 App 侧（README 对照列） | 证据 |
|---|---|---|---|
| **书架** | ✅ 支持 | ❌ 无 | README「📚 小说书架」行，链接 `pixivsource.pages.dev/BetterExperience#ShelfPage` |
| **离线缓存** | ✅ 支持 | ❌ 无 | README「💾 离线阅读」行 |
| **阅读进度** | ✅ **单篇和系列都有** | ☑️ **仅限系列** | README「🔢 阅读进度」行 |
| **阅读记录** | ✅ 支持 | 💰 会员功能 | README「📜 阅读记录」行 |
| **纯净无广告** | ✅ | 💰 会员功能 | README「🍃 纯净无广」行 |
| **繁简通搜** | ✅ | ❌ 无 | README「🀄️ 繁简通搜」行，链接 `#ConvertChinese` |
| **繁简转换** | ✅ | ❌ 无 | 同上 |
| **屏蔽作者** | 🆓 免费 | 💰 会员功能 | README「🚫 小说过滤 / 👤 屏蔽作者」行 |
| **屏蔽标签** | 🆓 免费 | 💰 会员功能 | 同上 |
| **屏蔽描述** | ✅ 免费 | ❌ 无 | README「📝 屏蔽描述」行 |
| **隐藏喜欢** | ✅ 免费 | ❌ 无 | README「❤️ 隐藏喜欢」行 |
| **隐藏追更** | ✅ 免费 | ❌ 无 | README「📜 隐藏追更」行 |
| **直连模式** | ✅ 支持 | ❌ 无 | README 书源功能表「直连 ✅」列 |
| **评论互动** | ✅ 发评论 / 删评论（书源内 `https://www.pixiv.net/ajax/novels/...` 调用 + 文本框交互） | — | `pixiv.json` → `ruleContent` 含 `https://www.pixiv.net/ajax/novels/bookmarks/add` / `.../delete`、`/ajax/novel/series/${novel.seriesId}/watch`；README 书源说明「💬 发送评论」 |

**能力边界：JS 规则引擎到底能做什么**

从 `pixiv.json` 源码可直接读出边界（2026-09-27 解析，3 个书源，全部规则均为 `@js:` 前缀）：

| 能力 | 证据 |
|---|---|
| 完整 JS 运行时（`java.*` 桥、`eval`、`JSON.parse` reviver） | 规则体中出现 `java.put("key", key)` / `java.ajax` / `java.startBrowserAwait` / `java.get("util")` / `java.startBrowser(...)`；`objParse` 用 `JSON.parse(obj, (n,v)=> eval(...))` 把字符串化的函数还原执行 |
| 打开浏览器窗口做人工登录 | `loginUrl` 中 `java.startBrowserAwait("https://accounts.pixiv.net/login", {"headers":{...}}, '登录账号', ...)` |
| 自定义发现（发现页）分类树 | `exploreUrl` 为 JS，产出 `⭐️ 关注 / 📃 追更 / 💯 推荐 / 🔍 发现 / …` 等 |
| 智能搜索语法 | `searchUrl` JS 解析：`标签空格分隔`、`#标签1 -标签2` 排除、`@作者` 作者专搜、`字数` 后缀筛选（`limitedTextCount`） |
| Emoji 自定义渲染 | `ruleContent` 内含完整 emoji 码点映射表（`normal=101, surprise=102, series=103, heaven=104, …, angry=2xx`） |
| 缓存层 | `getFromCacheObject("pixivSettings")` + `setDefaultSettings()`（设置项缓存化，暴露成 UI 按钮） |

**限流 / 重试：明确缺失（重要负面事实）**

对 421 KB 书源全文做模式扫描，结果：

| 模式 | 命中 |
|---|---|
| `限流` | **0** |
| `delay` | **0** |
| `重试` | **0** |
| `retry` | **0** |
| `频率` / `频率过快` / `太快` | **0** |
| `等待` | **0** |
| `sleep(` | 16 —— 全部是 UI 层的 `sleepToast()`（弹提示）与一个 `function sleep(seconds){ … Thread.sleep(1000*seconds) }` 通用工具，**非请求节流** |

> **结论：书源没有任何请求级限流、退避或重试。** 面对 Pixiv 改版，韧性完全来自「人工换备用书源」。

**书源实际使用的 API 面（2026-09-27 从 JSON 抽取）**

| 类别 | 端点 | 数量 |
|---|---|---|
| 登录 | `https://accounts.pixiv.net/login`、`https://accounts.pixiv.net/password/change`（Cookie 态） | — |
| 小说发现 | `/ajax/follow_latest/novel`、`/ajax/watch_list/novel`、`/ajax/top/novel`、`/ajax/genre/novel/*`（16 个题材 × `mode=safe/r18`）、`/ajax/commission/page/request/complete/novels` | **21** |
| 小说详情/目录/正文 | `/ajax/novel/{id}`、`/ajax/novel/{id}/bookmarkData`、`/ajax/novel/series/{seriesId}`、`/ajax/novel/series/{id}/watch`、`/ajax/novels/bookmarks/add`、`/ajax/novels/bookmarks/remove` | — |
| 兜底正文路径 | `https://www.pixiv.net/novel/show.php?id=${novelId}`（调试区说明中作为「正文」输入样例） | 1 |
| **App API（`app-api.pixiv.net` / `/v1/`）** | **0 命中** | **0** |

> **这是本次调研对 Pictelio 最有价值的一条对比事实**：**Legado Pixiv 书源完全不走非官方 App API，走的是 `www.pixiv.net/ajax/*` 网页端 AJAX + Cookie 登录。** 这与 A 节的 Mihon Pixiv 源是**同一个 API 面**（`www.pixiv.net`），而 Pictelio 走的是**另一个 API 面**（App API）。**两条生态路线在 API 风险上处于完全不同的风险层。**

### 3.5 「凭什么被称为 Pixiv 小说阅读体验最强」——具体机制

不是营销词，对应到 4 个具体机制：

1. **阅读进度粒度更细**：官方 App 进度**仅限系列**，书源**单篇和系列都能记进度**（README 对照表）。对 Pixiv 上大量「一次性单篇」小说，这是实打实的体验差。
2. **记录本地化 + 离线**：「阅读记录」在官方是**付费会员**功能，在书源侧是**免费本地**。加上离线缓存 + 书架，构成一个**完整不依赖会员的本地阅读闭环**。
3. **过滤能力从「付费墙」降级为「免费本地规则」**：屏蔽作者 / 屏蔽标签 / 屏蔽描述 / 隐藏喜欢 / 隐藏追更 —— 官方把这 5 项全部放在 Premium 后面（README 对照列 4 项标 💰），书源侧全部 🆓。这直接命中 Pixiv 用户最大痛点之一。
4. **JS 规则引擎 = 运行时可编程 + 官方 API 变更的快速止血**。同一份能力可以改 JS 重新导入，不需要等 App 发版。见下节证据。

### 3.6 书源的实际失效记录（2025-10 ~ 2026-09，逐条带日期）

一手信源：`https://api.github.com/repos/DowneyRem/PixivSource/issues`

| 日期 | Issue | 标题 | 性质 |
|---|---|---|---|
| 2025-10-31 | **#56** | 「[Question] **登录试了各种办法无法绕过验证码**」 | **风控 / 人机验证** |
| 2026-02-06 | #64 | [Features] 发现页面添加字数筛选 | 功能 |
| 2026-04-01 | **#67** | 「[BUG] **部分 Pixiv 账号无法使用直连模式**」 | 直连/风控，按账号差异 |
| 2026-05-10 | #71 | [BUG] Pixiv **备用**书源无法添加喜欢标签 | 备用机制自身失效 |
| 2026-05-25 | **#76** | 「[BUG] **获取正文失败**」 | **正文端点失效** |
| 2026-06-14 | #79 | Sync and sanitize Pixiv cookies for WebView; add cookie helpers | 维护者主动修 cookie 同步 |
| 2026-06-28 | **#81** | 「[BUG] **274、275 版本 无法获取小说内容**」 | **正文端点失效** |
| 2026-07-14 | **#84** | 「[BUG] **无法验证我是人类** 轻悦时光ios」 | **风控 / 人机验证** |
| 2026-07-28 | #90 | [BUG] **直连模式下，不能进入发现** | 直连失效 |
| 2026-07-28 | #89 | [BUG] 搜索处登录检测：始终强制要求登录账号；获取环境信息失败 | 登录态 |
| 2026-08-13 | #91 | [Question] 轻悦时光IOS端无法加载任何书本 | 宿主兼容 |
| 2026-09-22 | #97 | [BUG] 无法使用直连且看已在书架上的书时 `saveRead` 出错 | 直连 + 离线冲突 |
| 2026-09-23 | #98 | [BUG] 模糊搜索作者出错 | 搜索 |

> **14 个月内，10 个 open issue 里有 5 个是「取不到数据 / 过不了验证」类。** 其中「无法绕过验证码」「无法验证我是人类」是**直接的风控对抗失败证据**。

---

## 4. C 节：Pixiv 非官方 API 生态与维护风险（对 Pictelio 最关键）

### 4.1 PixivAppAPI 逆向生态存活状况（2026-09-27 实测）

| 项目 | 语言 | ★ | 最后 push | 判定 | 信源 |
|---|---|---|---|---|---|
| `upbit/pixivpy`（PixivPy3） | Python | 2,059 | **2025-07-31** | **事实标准，但已停更 14 个月** | https://api.github.com/repos/upbit/pixivpy |
| `txperl/PixivBiu` | Go | 1,459 | **2026-09-23** | **生态里最活跃的 App API 消费者**；最近 release `v3.1.3`（2026-09-23），`v3.1.0-alpha.2`（2026-09-09）起高频发版 | https://api.github.com/repos/txperl/PixivBiu |
| `txperl/pixivgo` | Go | 3 | **2026-07-22** | 活跃但极小众（2026-04-15 创建）；README 注明「见 PixivBiu 用法」 | https://api.github.com/repos/txperl/pixivgo |
| `GeminiLab/pixiv3-rs` | Rust | 1 | **2026-02-24** | pixivpy 的 Rust 移植；**创建日 = 最后更新日**（一次性快照） | https://api.github.com/repos/GeminiLab/pixiv3-rs |
| `akameco/pixiv-app-api` | TypeScript | 227 | **2023-01-05** | **已死**（最后实质提交 2020-04-15 `v1.2.1`） | https://api.github.com/repos/akameco/pixiv-app-api |

**「谁还活着」的答案**：整个 App API 逆向生态**只剩 Go 一条线还在高频动**（`txperl/PixivBiu` 及其同作者的 `pixivgo`），Python 参考实现停更，TS 参考实现已死，Rust 是快照。**Go 侧不是生态自然选择的结果，而是「唯一有人持续踩坑并修复的人」** —— 这本身就是「App API 长期需要人工维护」的间接证据。

### 4.2 PixivPy3 的变更年表（官方 README 自述，一手信源）

来源：https://raw.githubusercontent.com/upbit/pixivpy/master/README.md

| 日期 | 事件 | 与 Pictelio 的关系 |
|---|---|---|
| 2014-10-07 | 支持 SAPI / Public-API | — |
| **2015-05-16** | 「As Pixiv **deprecated** SAPI in recent days」→ 切 `ranking_all` | **第一次大范围失效** |
| 2015-08-11 | 发布 v3.0（pixivpy3） | — |
| 2016-07-20 | 引入 **App-API**（Experimental, for PixivIOSApp/6.0.9） | Pictelio 依赖的这一层的起点 |
| **2016-07-27** | App API 可**无 auth 调用** | 早期的匿名可用期 |
| **2019-09-03** | 支持新 auth() 校验 **`X-Client-Time` / `X-Client-Hash`**，见 issue #83 | **签名机制引入**；此后每次 App 更新都可能要求重算 |
| **2022-02-04** | 「**Remove Public-API support as it's deprecated by Pixiv**」见 commit `74e114e` | **第二次大范围失效**：Web API 通道被官方废弃 |
| 2023-09-18 | v3.7.3 加 `novel_follow()`，修 `ByPassSniApi()` host BUG | — |
| **2024-03-03** | v3.7.5 **修 `novel_text()` BUG，新增 `webview_novel()`**，见 issue **#337** | **第三次：小说正文通道被换掉**（详见 4.3） |
| 2025-02-09 | 为 App-API 加 `pydantic` 模型 | — |
| — | 「Due to #158 reason, **password login no longer exist**. Please use `api.auth(refresh_token=REFRESH_TOKEN)`」 | **第四次：认证通道被换掉**（详见 4.3） |

### 4.3 API 维护风险清单（按时间顺序，每条带日期与信源）

> **这是本文档最重要的产出。** 每条都是可复核的一手证据。

---

**风险 1｜认证通道：密码登录被撤销（2021-02-09 起至今）**
- **日期**：2021-02-09（issue 创建）；PixivPy README 至今仍置顶警告
- **现象**：OAuth `password` grant 被服务端拒绝，返回
  `{"has_error":true,"errors":{"system":{"message":"The grant type is unauthorized for this client_id","code":1508}},"error":"invalid_grant"}`
- **信源**：https://github.com/upbit/pixivpy/issues/158 ；https://raw.githubusercontent.com/upbit/pixivpy/master/README.md
- **对 Pictelio 的含义**：**refresh_token 是唯一可用凭据**，而 refresh_token 的获取依赖逆向 OAuth 流程（README 指向第三方 `gppt` / selenium 方案）。这条链路的每一环（Pixiv 端、第三方 token 工具、我们的实现）都可能单独失效。**这也解释了 Pictelio 为什么把 refresh_token 放进 Android Keystore 并做首启迁移**（`openwiki/integrations/android-native.md`）—— 凭据不可再生，必须当机密资产保管。

---

**风险 2｜请求签名：App 端 `X-Client-Hash` 绑定客户端版本（2019-09-03 引入，持续）**
- **日期**：2019-09-03（issue #83）
- **现象**：App API 的 auth 需要计算 `X-Client-Hash`（基于 `X-Client-Time` + secret + 客户端版本号）。**Pixiv 官方 App 一旦发版，服务端可随时改校验规则而无需公告。**
- **信源**：https://github.com/upbit/pixivpy/issues/83 ；https://raw.githubusercontent.com/upbit/pixivpy/master/README.md
- **对 Pictelio 的含义**：**这是最隐蔽的一条**。我们的 API 客户端必然硬编码了某个客户端版本号 / secret。**当官方 App 发版时，可能出现「昨天还好好的今天全 401」的静默失效**，且没有任何错误码语义可依赖（`invalid_grant` / code 1508 / 空 `reason` 都出现过，见风险 5）。
- **预警信号（可操作）**：`txperl/PixivBiu` 出现「update client version / fix auth / signature」类提交，或 `GeminiLab/pixiv3-rs` 被重新激活。

---

**风险 3｜内容通道：小说正文端点 `novel_text` 被删除（2024-02-29 发现）**
- **日期**：2024-02-29（issue #337 报告）；**2024-03-03** pixivpy v3.7.5 加 `webview_novel()` 替代
- **现象**：`AppPixivAPI.novel_text(21269184)` 返回
  `{'error': {'user_message': "Specified end-point doesn't exist", 'message': '', 'reason': '', 'user_message_details': {}}}`
  issue 原文： 「**This method has been affected since the latest update of Pixiv APP.**」
- **信源**：https://github.com/upbit/pixivpy/issues/337 ；https://raw.githubusercontent.com/upbit/pixivpy/master/README.md （2024/03/03 条目）
- **对 Pictelio 的含义**：**「Pixiv 发版 → 端点消失」已被官方 issue 确认过一次。** 我们的小说正文若走 `novel_text`，**同一次事件会同时打掉我们的核心功能**（小说是 Pictelio 的差异化能力）。Pictelio 必须回答：我们现在用的是 `novel_text` 还是 `webview` 通道？——（本次不核实，标记为待主线核对项，见 §7）

---

**风险 4｜网页结构：小说正文页结构变更导致正则失配（2025-05-22 起，2025-07-30 确认）**
- **日期**：
  - **2025-05-22**（issue #408）首次报告 `Extract novel content error: 'NoneType' object has no attribute 'groups'`，用户描述「**偶尔**出现，一旦出现就是同一个作者的全部作品都失败」，且**手动重试又能成功** —— 典型的灰度/分批改版
  - **2025-07-30**（issue #411）确认为**页面结构变更**：`re.search(r"novel:\s({.+}),\s+isOwnWork", r.text)` 返回 `None`；报告者推测「**Pixiv 可能更新了网页结构，JavaScript 中的数据格式发生了变化**」
  - **2025-07-31**（issue #413）修复方式：**放弃正则刮内联 JS，改直调 AJAX** `url = f"{base_url}/ajax/novel/{novel_id}"`
- **信源**：https://github.com/upbit/pixivpy/issues/408 ；https://github.com/upbit/pixivpy/issues/411 ；https://github.com/upbit/pixivpy/issues/413
- **对 Pictelio 的含义**：**「灰度改版 → 同一作者全量失败 → 过几天/重试又好了」**这个故障形态，是最难在 CI 里防住的：**测试环境不必然复现**。这直接指向 AGENTS.md「IO 边界测试强制覆盖」的必要性 —— 我们需要「上游返回畸形/缺失字段」的 fixture 单测，而不只是 happy path。
- **交叉印证**：B 节的 Legado Pixiv 书源，正文也走 `https://www.pixiv.net/ajax/novel/${novelId}` —— **两条独立技术路线在 2025 年后收敛到同一个端点**。若该端点再变，两条路线会**同时**失效。

---

**风险 5｜错误可观测性：Pixiv 的错误响应不带可诊断信息**
- **日期**：2026-04-11（issue #415 最新一条）
- **现象**：`{'user_message': '不正确的请求。', 'message': '', 'reason': '', 'user_message_details': {}}` —— `message` 与 `reason` 均为空串，`user_message_details` 为空对象。报告者称「修了很久都修复失败」
- **信源**：https://github.com/upbit/pixivpy/issues/415
- **对 Pictelio 的含义**：**Pixiv 不给你可诊断的失败原因。** 我们的 401 刷新逻辑若只按错误码分支，遇到「空 reason」时会走进死循环或误判。这条应作为我们 API 层容错设计的硬约束（对应 AGENTS.md「401 自动刷新 + 防死循环」）。

---

**风险 6｜风控 / 人机验证：第三方客户端被直接拦在门外**
- **日期**：2025-10-31（PixivSource #56「登录试了各种办法无法绕过验证码」）、2026-07-14（#84「无法验证我是人类」）
- **信源**：https://github.com/DowneyRem/PixivSource/issues/56 ；https://github.com/DowneyRem/PixivSource/issues/84
- **对 Pictelio 的含义**：风控是**按账号**触发的（#67「部分 Pixiv 账号无法使用直连模式」），不是按客户端。这意味着一批用户会**注册得了、登不进、或登进后取不到数据**，而我们无法通过日志区分「用户账号被风控」和「我们代码坏了」。**需要显式的错误分类与用户可读提示**（AGENTS.md「禁止静默降级」）。

---

**风险 7｜官方明文授权「无需预告即可变更」**
- **日期**：Pixiv 個別規約现行版本（该页可见最新修订日为 **2026-08-17**；pixiv ロゴ章为 2025-01-28 修订）
- **官方原文（日文）**：
  > 「pixiv および、関連サービスは、**予告なしに**その機能や掲載内容の改訂、変更、**提供停止**を行う場合がございます。」
  > 「**クローラーなどのプログラムを使って作品を収集する行為、サーバに極端な負荷をかける行為は禁止します。また、それらに違反しない場合でも、当社はその停止を要求する場合がございます。**」
- **同时官方给出的第三方 App 免责条件**：
  > 「『pixiv プラットフォームを利用して開発したアプリケーションである』という主旨の説明を表記した場合の利用は通常問題ありません。『**pixiv が作成、配布しているアプリケーションではない**』という旨を併記してください。また、当社サービスと混同を招きかねない名称は避けてください。」
  > 「使用に関しては各自が責任を負うものとし、当社は一切の責任を負いません。」
- **信源**：https://www.pixiv.net/terms （2026-09-27 抓取，正文为日文；可用 `https://www.pixiv.net/terms?lang=zh` 尝试中文版，本次未验证存在）
- **对 Pictelio 的含义（三点，全部可执行）**：
  1. **官方立场是「默许存在，但不提供任何稳定性承诺」** —— 上面那句「予告なし」是我们所有 API 风险清单的**法理依据**：任何时刻的静默失效都在条款允许范围内。
  2. **合规义务是可落地的**：应用内/商店页需有「非 pixiv 官方应用」声明；命名需避免与 pixiv 混淆（当前项目名 Pictelio 符合）。
  3. **「禁止爬虫式收集 + 极端负载」+「即使不违规也可要求停止」= 我们的限流策略不是性能优化，是合规要求。** 目前 A 节 Mihon 源（无退避、最坏 25 页连拉）与 B 节书源（`限流`/`重试` 命中 0）都不满足；**Pictelio 应当在限流上明确优于它们**。

---

**风险 8｜非商用约束：内容不得用于服务外的商用目的**
- **日期**：现行 サービス共通利用規約 禁止事項
- **官方原文（日文）**：
  > 「本サービスもしくは本サービスの一部（コンテンツ・情報・機能・システム・プログラム等）を**本サービス外での商用・営利を目的とした活動**およびその準備のために利用する行為」
  > 以及信息解析条款：「本サービス…投稿情報を**情報解析（人工知能を開発するための学習行為を含みます）**した結果を用いた行為であって、当該投稿情報を投稿等したユーザーの**利益を害する**と当社が判断する行為」
- **信源**：https://www.pixiv.net/terms
- **对 Pictelio 的含义**：**(a)** Pictelio 若未来收费 / 广告 / 赞助接入，需评估此条；**(b)** AI 翻译功能处于「情報解析」条款的射程内 —— 我们的 AI 翻译是**用户侧本地/自备 Key 的转换**，不构成「用解析结果损害投稿人利益」的行为（不改写、不再发布），但**若未来提供「AI 一键生图/风格化」等衍生功能，风险等级会上升**。建议在 AGENTS.md 或 release checklist 里留一条显式记录。

---

**风险 9｜本生态无任何官方 API 可用**
- **日期**：现行条款（2026-08-17 最后修订）
- **事实**：Pixiv 全部条款页面中，**唯一有「API 开示」条款的是 `VRoid Hub 開発者利用規約`**，其原文限定为「当社が本サイト上で提供するサービス『VRoid Hub』と連携する**アプリ開発**のために必要な**API の開示**にあたり、その利用条件を定めるもの」。**pixiv 本体服务没有任何官方 API 条款** —— 也就是说，走 App API 的第三方客户端在官方文件里**连授权主体都不存在**。
- **信源**：https://www.pixiv.net/terms （条款导航树含「pixiv」「pixivFANBOX」…「VRoid Hub 開発者」等；仅 VRoid 系有 API 条款）
- **对 Pictelio 的含义**：**我们不是「API 的一个有条件使用者」，而是「一个无授权约定的使用者」。** 这决定了：官方**没有义务**通知我们任何变更（对应风险 7），也**没有义务**为我们留出迁移期。

---

### 4.4 「信号灯」定义：某项目大范围失效通常预示什么

本次调研归纳出 4 个**可观测、低成本**的先行指标（全部可自动化监控）：

| # | 信号灯 | 观测方式 | 预示什么 | 证据支撑 |
|---|---|---|---|---|
| **1** | `upbit/pixivpy` 出现 novel / auth 相关新提交（**已停更 14 个月，突然动了**） | GitHub watch `upbit/pixivpy` | **上一次触发即 #413（2025-07-31）= 小说正文通道变更**。PixivPy 是最敏感的探针 | 4.3 风险 4 |
| **2** | `txperl/PixivBiu` 出现 `update client version` / `fix auth` / `signature` / `X-Client-Hash` 类提交 | watch `txperl/PixivBiu` commits | **App 端签名规则变更**（风险 2）。它 2026-09 仍在高频发版，是当前唯一活着的 App API 消费者 | 4.1 |
| **3** | `GeminiLab/pixiv3-rs` 重新活跃（当前是**一次性快照**，2026-02-24 创建=最后更新） | watch commits | 有人发现 Rust 移植跟不上、需追新字段/新端点 → 上游 schema 变动 | 4.1 |
| **4** | `DowneyRem/PixivSource` 出现「无法获取小说内容」「无法验证我是人类」类 issue | watch `DowneyRem/PixivSource` issues | **Pixiv 对网页端 `/ajax/novel/*` 也开始加风控或改结构**（风险 4 / 风险 6）。该 issue 流是网页通道的实时代理指标 | 4.3 风险 4、B.3.6 |

> **使用方式建议**：把上述 4 个仓库加入 CI 定时任务（或简单的人工周检）：仅检查「上次检查后是否有新提交 / 新 issue」。**任一信号灯亮起，即触发一次 API 层回归验证**（不必然要改代码，但必须知道）。这条建议的成本极低、价值极高。

---

## 5. D 节：网页版 / 扩展类 Pixiv 浏览方案

### 5.1 候选筛选与存活判定（2026-09-27 实测）

GitHub search `q=pixiv`（limit 30）后按「是否仍在维护 + 是否属于浏览方案」筛选：

| 项目 | 形态 | ★ | 最后 push | 判定 |
|---|---|---|---|---|
| `asadahimeka/pixiv-viewer` | **Vue 3 PWA**（部署于 Cloudflare Pages `pixiv.pictures`） | 827 | **2026-09-26** | ✅ **首选**。最近 release `v1.37.5`（**2026-09-24**）；上游为 `journey-ad/pixiv-viewer`（★356，最后 push **2024-10-31**，已停滞） |
| `Ocrosoft/PixivPreviewer` | **油猴脚本**（Greasy Fork #30766） | 200 | **2026-05-13** | ✅ 维护中（更新频率低，半年级） |
| `leoding86/webextension-pixiv-toolkit` | **浏览器扩展** | 1,773 | **2024-09-24** | ⚠️ **★最高但已停滞约 2 年**（本节「高星 ≠ 活跃」的样本） |
| `kokororin/pixiv.moe` | Pinterest 风格 web 站 | 371 | **2023-03-08** | ❌ 已死 |
| `xuejianxianzun/PixivBatchDownloader` | 批量下载器 | 5,645 | 2026-09-25 | ⛔ 非浏览方案（下载工具），仅作生态活跃度旁证 |
| `xuejianxianzun/PixivFanboxDownloader` | FANBOX 下载扩展 | 1,090 | 2026-09-10 | ⛔ 同上 |

信源：`https://api.github.com/search/repositories?q=pixiv&per_page=30` + 各仓库 `api.github.com/repos/{owner}/{repo}`

### 5.2 逐项事实：`asadahimeka/pixiv-viewer`（本节主力样本）

信源：https://raw.githubusercontent.com/asadahimeka/pixiv-viewer/main/README.md （2026-09-27 抓取）+ https://api.github.com/repos/asadahimeka/pixiv-viewer

| 维度 | 事实 |
|---|---|
| **定位** | 「又一个 Pixiv 阅览工具，提供 pixiv 的**插画、动图、漫画和小说**等作品的在线浏览，适配多端样式，提供多种浏览布局选择，支持 PWA 安装，支持自定义 API 与图床，支持 RefreshToken/OAuth/Cookie 方式登录」 |
| **技术栈** | Vue 3 + Stylus + PWA + Cloudflare Pages；AGPL-3.0 |
| **登录方式** | **三选一**：RefreshToken 登录 / OAuth 登录 / Cookie 登录（README 明确标注 Cookie「不推荐」） |
| **API 韧性设计（★最值得抄的一点）** | **「多 API 实例选择：切换多个后端 API 实例」** + **「AppAPI 代理模式：直连 Pixiv App API（需自建代理）」** + **「多图床选择：切换多个图片反代服务」** + **「pximg 图片直连」** |
| **内容覆盖** | 插画 / 漫画 / **小说** / 动图（Ugoira 播放）/ 珍藏册 |
| **搜索** | 全方位搜索（插画·漫画 / 小说 / 用户 / 珍藏册）+ 搜索热词 + 智能补全 + **按收藏数/投稿时间筛选** + **以图搜图** + **数字 ID 直达** |
| **排行榜** | 综合 / 插画 / 漫画 / 动图 / 小说；**R18 / AI 生成作品排行**；历史排行按日期 |
| **小说阅读** | 下载 TXT/HTML/Markdown/DOC/PDF/EPUB；自定义字体/颜色/阅读方向；富文本渲染；**阅读进度记忆**；**原生 WebView 沉浸式阅读**；**小说翻译** |
| **漫画翻译** | 内置翻译引擎；**ONNX Runtime Web 本地推理做检测/OCR/修复**；**横排/竖排自动匹配气泡与阅读顺序**；多模型提供商；原图/译文切换 |
| **动图** | Ugoira 播放；下载 ZIP / GIF / WebM / APNG / MP4 / AVIF |
| **内容控制** | R18 开关 / AI 作品开关 / 本地黑名单（屏蔽标签+用户，标签化 UI） |
| **浏览体验** | 多语言（简/繁/英/俄）、深色模式、主题色自定义、**瀑布流/网格/虚拟列表**、图片画质 Medium/Large/Large(WebP)、**左右滑动切换**、页面过渡动画 |
| **其它** | IndexedDB 缓存 / 浏览历史 / 备份还原 / Tampermonkey 支持 / 文件名模板 |

> **「多 API 实例 + 自建 AppAPI 代理 + 多图床」= 生态对 API 风险的最成熟答案。** 它把「API 会挂」当作**一等公民假设**，用**运行时可切换的后端**兜底，而不是靠发版修复。这与 C 节 4.4 的「信号灯」是同一问题的两端：**事前可观测 + 事中可切换**。

### 5.3 逐项事实：其余 web 方案定位

| 项目 | 定位 | 关键事实 |
|---|---|---|
| `Ocrosoft/PixivPreviewer` | 油猴脚本，给官方 pixiv.net 页面加增强 | Greasy Fork `https://greasyfork.org/zh-CN/scripts/30766`；最后 push 2026-05-13 |
| `leoding86/webextension-pixiv-toolkit` | 独立浏览器扩展（★1,773，历史最流行） | 最后 push 2024-09-24，**已停滞约 2 年** |

### 5.4 Web 路线在「多图浏览体验」上的天然优势 / 劣势

**天然优势**
1. **桌面级输入设备**：鼠标滚轮 / 拖拽 / 多点触控板手势 / 物理键盘快捷键。**手机 App 做不到，也不需要做** —— 这是 Web 路线最不可替代的一点。
2. **零安装、零应用商店审核**：改一次即全量生效 —— 对「上游 API 天天变」的环境，**部署速度就是竞争力**（对照 C 节风险 3~4 的响应时间尺度）。
3. **布局自由**：瀑布流 / 网格 / 虚拟列表可按窗口宽度自由切换（README 明确列出三种）；`pixiv-viewer` 的自适应多端样式在平板/桌面上的信息密度明显高于移动端单列。
4. **文件出口天然强**：File System Access API + Tampermonkey 批量下载，是移动端难以复现的。
5. **PWA 折中**：`pixiv-viewer` 用 PWA 拿到了「可安装 + Web 能力」，是 Web 路线对移动端短板的现实解法。

**天然劣势**
1. **拿不到系统级能力**：Android 后台/相册/通知/分享面板、OAuth 原生回调、SNI 直连（Web 受浏览器限制）—— **这正是 Pictelio 走 Capacitor / 原生路线的立足点**。
2. **必须依赖外部服务**：PWA 要 Cloudflare Pages，AppAPI 直连要**自建代理**（README 明写「需自建代理」）→ 部署门槛从「装个 App」变成「有台服务器」，且代理本身成为新的单点。
3. **跨端不一致**：手机浏览器上 Web 版体验劣于原生 App（无原生手势、无离线漫画、无后台播放）。
4. **同源 / 扩展 API 权限受限**：油猴脚本与扩展受浏览器权限模型约束，无法像原生 App 那样自由持有 refresh_token。
5. **Cookie 路径被降级**：`pixiv-viewer` 自己把 Cookie 登录标注为「不推荐」，说明 Web 路线在凭据强度上先天弱一档。

> **结论**：Web 路线**不是** Pixiv 客户端的形态终点，而是**「上游 API 变更时的最快止血通道」**。`pixiv-viewer` 的「多 API 实例 + 自建代理」值得 Pictelio 借鉴为**降级路径**（而非主路径）。

---

## 6. 横向对比大表

> 图例：✅ 具备 / 主打　⚠️ 部分或受限　❌ 不具备 / 架构上不可能　—　未找到证据
> **Pictelio 两列按任务要求标记「待主线核对」，本 worker 不核实。**

| 能力维度 | **Mihon Pixiv 源**（`all/pixiv`） | **Legado Pixiv 书源**（`DowneyRem/PixivSource`） | **一体化 App**（Pixiv-Shaft / PiPixiv 代表） | **Pictelio-webview** | **Pictelio-lynx** |
|---|---|---|---|---|---|
| **登录方式** | ❌ **无需登录**（公开 AJAX 端点） | ⚠️ **Cookie 登录**（`java.startBrowserAwait` 开 `accounts.pixiv.net/login` 人工登录） | ✅ OAuth + refresh_token（多账号） | 待主线核对 | 待主线核对 |
| **凭据强度** | 无凭据 | Cookie（长期有效、可被风控） | refresh_token（Pixiv 已撤密码登录） | 待主线核对 | 待主线核对 |
| **插画** | ✅ | ❌（书源专注小说；仅 3 个书源中 1 个是漫画） | ✅ | 待主线核对 | 待主线核对 |
| **漫画** | ✅（Pixiv 站漫画；`pixivcomic` 源另覆盖官方商店） | ✅（`🅿️ Pixiv 漫画` 书源，`bookSourceType=2`） | ✅ | 待主线核对 | 待主线核对 |
| **小说** | ❌ **架构上排除**（`type=="2"` 显式丢弃；全生态无小说源） | ✅ **绝对强项** | ✅ | 待主线核对 | 待主线核对 |
| **书架** | ❌ 架构不可能（仅本地库） | ✅ 小说明书架（官方 App 无） | ✅ | 待主线核对 | 待主线核对 |
| **离线** | ⚠️ 仅 Tachiyomi 缓存，非完整离线阅读 | ✅ 离线阅读（官方无） | ✅ | 待主线核对 | 待主线核对 |
| **阅读进度** | ⚠️ 仅章节级（本地） | ✅ **单篇 + 系列**（官方仅系列） | ✅ | 待主线核对 | 待主线核对 |
| **繁简转换 / 繁简通搜** | ❌ | ✅ 双支持 | ⚠️ 取决于实现 | 待主线核对 | 待主线核对 |
| **阅读记录** | ❌ | ✅ 免费（官方为付费会员功能） | ⚠️ 官方为会员功能 | 待主线核对 | 待主线核对 |
| **标签翻译** | ❌ 无映射表，原样输出 | ❌ 未找到证据 | ❌ 未找到证据 | 待主线核对 | 待主线核对 |
| **限流 / 节流** | ❌ **无退避无重试**；最坏一次搜索连拉 25 页 | ❌ **无退避无重试**（`限流`/`重试`/`delay` 全文 0 命中） | — 未逐一核实 | 待主线核对 | 待主线核对 |
| **API 韧性设计** | ❌ 无 | ⚠️ **人工备用书源**（2 份实现可切换） | ⚠️ 部分实现有 API 实例切换 | 待主线核对 | 待主线核对 |
| **收藏 / 关注同步** | ❌ 架构不可能 | ✅（`/ajax/novels/bookmarks/add`、`/ajax/novel/series/{id}/watch`） | ✅ | 待主线核对 | 待主线核对 |
| **多账号** | ❌ | ⚠️ 登录态可切换（`logout.php` + `password/change`），非多账号并存 | ✅ | 待主线核对 | 待主线核对 |
| **风控耐受** | ✅ **最高**（无凭据 = 不在打击面） | ❌ 低（2025-10-31 / 2026-07-14 两次「无法验证我是人类 / 无法绕过验证码」） | — 未逐一核实 | 待主线核对 | 待主线核对 |
| **扩展性** | ❌ Kotlin 抽象类，改动需重编译 | ✅✅ **运行时 JS 规则引擎**（`@js:` + `java.*` 桥 + `eval`），可编程/可热换 | ❌ 闭源 App | 待主线核对 | 待主线核对 |
| **依赖的 API 面** | `www.pixiv.net/touch/ajax/*` | `www.pixiv.net/ajax/*` + `accounts.pixiv.net` | **App API（`app-api.pixiv.net`）** | **App API** | **App API** |
| **失效历史** | 偶发（2024-09 修搜索重复、2026-01 修用户搜索） | 密集（14 个月 5 个取数/验证类 issue） | — 未逐一核实 | 待主线核对 | 待主线核对 |

> **读表要点**：前两列**都不依赖 App API**，因而都不在 4.3 风险清单的打击面内 —— 但代价是功能维度大面积 ❌。**一体化 App 拿到了全部功能维度，也就继承了 App API 的全部风险。** 这不是「谁做得更好」，而是**风险与能力的对价关系**。Pictelio 两端都走 App API，因此**必须自行补上「限流」「API 韧性」「可观测性」三块**，否则就是生态里的短板项。

---

## 7. 「对 Pictelio 的启示」

### 7.1 生态验证有价值、而我们尚未做 / 尚未确认的能力

| # | 能力 | 生态证据（谁在用、怎么用） | 对 Pictelio 的建议 | 优先级 |
|---|---|---|---|---|
| **1** | **运行时可切换的 API 实例 / 降级后端** | `pixiv-viewer`：「多 API 实例选择」+「AppAPI 代理模式（需自建代理）」+「多图床选择」（README「网络与数据」节） | 引入**后端/代理可配置**（哪怕只是设置项里一个 URL），官方挂了有路可走。**这是对 4.3 风险 2/3 最直接的对冲** | 🔴 高 |
| **2** | **限流与退避作为一等公民策略** | 生态最弱环节：A 节 `fetchWithAdaptiveWindow` 最坏连拉 25 页无退避；B 节 `限流`/`重试` 命中 0 | 我们**应当在限流上明确优于两者**，且理由不是性能而是**合规**（4.3 风险 7：官方禁止「服务器极端负载」，且不违规也可要求停止）。把「令牌桶 + 指数退避 + 429/空 reason 识别」写进 API 层并单测 | 🔴 高 |
| **3** | **API 失效的先行指标监控** | 4.4 的 4 个信号灯（PixivPy / PixivBiu / pixiv3-rs / PixivSource issues） | 极低成本：定时检查这 4 个仓库有无新提交/新 issue。**任一亮起 → 触发 API 层回归验证**。建议作为一个轻量 CI job 或人工周检清单项 | 🔴 高 |
| **4** | **畸形响应的契约测试（oracle 来自真实故障）** | pixivpy #408/#411/#415 的真实失败样本：`{'user_message': '不正确的请求。', 'message': '', 'reason': '', 'user_message_details': {}}`、`Specified end-point doesn't exist` | 对应 AGENTS.md「IO 边界测试强制覆盖」+「契约测试必须使用真实样例」+「期望值出处可追溯」：**把 Pixiv 真实错误响应存成 fixture**，覆盖「空 reason」「端点消失」「正文页结构变化」三类。对应 4.3 风险 3/4/5 | 🔴 高 |
| **5** | **「端点消失」是一等故障类型** | pixivpy #337（2024-02-29）官方原文 `Specified end-point doesn't exist`，**「affected since the latest update of Pixiv APP」** | 我们的小说正文通道必须**当前可见地**是 `novel_text` 还是 `webview`/`/ajax/novel/{id}`。若为前者，**这是一个已知的、已发生过的失效点**。→ 列为待主线核对 P0 | 🔴 高 |
| **6** | **多账号** | Pixiv-Shaft（`competitor-features-comparison.md` 已记）、`pixiv-viewer` 单一登录态、书源为「切换」非「并存」 | 生态共识：多账号是**一体化 App 的分水岭能力**，插件路线给不了。**我们应保持领先并做成差异化** | 🟡 中 |
| **7** | **本地阅读记录 / 书架不依赖会员** | 书源侧把官方付费项（阅读记录、屏蔽作者/标签）做成免费本地 | 我们的小说阅读器已有进度能力；**建议核查**：阅读记录是否本地持久化、屏蔽能力是否需要 Premium 逻辑 | 🟡 中 |
| **8** | **书源式规则引擎（可编程性）** | Legado 的 `@js:` + `java.*` + `eval`；维护者 8 天 8 次提交纯 JS 调优 | **不建议直接照搬**（安全沙箱成本高、我们的用户不是「书源作者」）。**建议以「可配置筛选器」的形式取其精神** —— 我们已有 5 维高级筛选，可考虑再开放一层用户自定义谓词 | 🟢 低（战略决策） |
| **9** | **按账号分级的风控容错** | PixivSource #67（2026-04-01）「**部分** Pixiv 账号无法使用直连模式」 | 我们的错误分类必须能区分「账号被风控」vs「服务端故障」vs「代码 bug」，否则用户报障时我们无法定位。**这条直接对应 AGENTS.md「禁止静默降级」** | 🟡 中 |
| **10** | **合规声明与非混淆命名** | 4.3 风险 7 官方明文：需声明「非 pixiv 官方应用」，避免混淆命名 | 核查：应用内 / 商店页 / About 页是否有该声明。当前项目名 `Pictelio` 本身安全 | 🟢 低（一行文案） |
| **11** | **AI 衍生功能的条款边界** | 4.3 风险 8：条款禁止「信息解析结果损害投稿人利益」的行为 | 当前「AI 翻译」（用户侧、BYOK、不改写不发布）风险低。**但若未来做 AI 生图 / 风格化 / 批量再发布，风险等级跃升**，建议现在就写进 release checklist 的检查项 | 🟢 低（文档） |

### 7.2 本次调研发现的、需要更正既有材料的结论

| 位置 | 现存结论 | 应更正为 | 依据 |
|---|---|---|---|
| `docs/research/competitor-features-comparison.md` §0 表 | 「开源阅读 + Pixiv 书源（Legado）｜ 活跃（书源 v284，2026-09）」 | **`gedoor/legado` 已于 2026-05-27 清空并发布侵权公告**；继承者为 `Luoyacheng/legado-E`（阅读Sigma，最后 push 2026-08-01）；Pixiv 书源本体 `DowneyRem/PixivSource` 仍活跃（2026-09-22） | 本文 §3.1 / §3.2 / §3.3 |
| 同表 | 「Legado 支持直连模式（仅 legado）」 | 应补：**直连模式在 2026 年已多次失效**（#67 / #90 / #97） | 本文 §3.6 |

> 本 worker **不修改**他人所有文件，仅登记。是否更正由主线决定。

### 7.3 未能核实 / 未找到证据的断言（诚实清单）

1. **「Pixiv-CN 源」是否存在** —— 在 `keiyoushi/extensions-source` 中**未找到**独立 Pixiv-CN 源。`zh` / `zh-tw` 只是 `all/pixiv` 同一 baseUrl（`www.pixiv.net`）的语言目录变体。**若任务前提中的「Pixiv-CN 源」指别处的第三方源，本次未找到证据。**
2. **Danbooru / gelbooru 标签翻译在 Mihon 生态的具体实现** —— 未查（code search 仅限 pixiv 路径）；**该生态存在 booru 系标签翻译实践的说法本次未取得一手证据，不作断言。**
3. **`keiyoushi/extensions` 源总数** —— 尝试解析 `https://github.com/keiyoushi/extensions/raw/repo/index.pb`（107,791 bytes）失败（protobuf 内容非明文，正则与 `grep -a "Pixiv"` 均零命中），**未取得源总数**。Pixiv 源为 2 个这一结论基于 code search 路径穷举，可信但非索引级穷举。
4. **`Suwayomi/Suwayomi-Server` 的规范 API 路径** —— 初次取数时误拼 owner（`Suwayimi/…`）返回 404，**已于 2026-09-27 单独复核**：`https://api.github.com/repos/Suwayomi/Suwayomi-Server` 返回 200（★7,759，push 2026-09-23），表中数据以复核结果为准。
5. **「2024–2026 年 Pixiv 客户端 API 变更导致第三方客户端批量失效」的成规模新闻事件** —— **未找到可查证的新闻/公告级证据**。本文风险清单中可查证的是**逐个仓库 issue 级的端点变更**（风险 1/3/4/5/6），**没有找到「某日批量失效」这类集中事件的官方或新闻信源**。任何「大范围批量失效」表述目前**无一手信源支撑**。
6. **GitHub issue 全文搜索 `pixiv API 失效` / `pixiv invalid_grant refresh_token`** —— 两次 `gh search issues` 均返回空（查询过窄或索引限制）。**风险 5 的 `invalid_grant` 证据来自 pixivpy #158 的 issue 正文，不是全网搜索结果。**
7. **`a1121611810` 账号的 search/code_search 配额** —— 中途触发过一次 403（code search 限流），已恢复；**极少量搜索结果可能因此不完整**。
8. **Pixiv 中文版服务条款 URL** —— `https://www.pixiv.net/terms_zh` 返回 **404**（已实测）。本文所有条款引用均为**日文原文**，未经官方中文版交叉验证。
9. **`asadahimeka/pixiv-viewer` 的「AppAPI 代理模式」实际可用性** —— 仅取自其 README 自述，**未运行、未验证**。同理「多 API 实例」的实例来源未核实。
10. **Pictelio 自身的小说正文走哪条通道、是否有 refresh_token 降级路径** —— 按任务分工**未核实**，已列为 §7.1 第 5 项的 P0 待核对项。

---

## 8. 信源索引（全部一手）

**GitHub API / 仓库**
- https://api.github.com/repos/mihonapp/mihon
- https://api.github.com/repos/tachiyomiorgs/tachiyomi-extensions （**404：仓库已删除**）
- https://api.github.com/repos/tachiyomiorg/extensions （已归档，push 2024-01-08）
- https://api.github.com/repos/timschneeb/tachiyomi-extensions-archive （已归档，push 2026-03-23）
- https://api.github.com/repos/keiyoushi/extensions-source ／ https://api.github.com/repos/keiyoushi/extensions
- https://raw.githubusercontent.com/keiyoushi/extensions-source/master/README.md
- https://raw.githubusercontent.com/keiyoushi/extensions-source/master/src/all/pixiv/build.gradle.kts
- https://raw.githubusercontent.com/keiyoushi/extensions-source/master/src/all/pixiv/src/eu/kanade/tachiyomi/extension/all/pixiv/Pixiv.kt
- https://raw.githubusercontent.com/keiyoushi/extensions-source/master/src/all/pixiv/src/eu/kanade/tachiyomi/extension/all/pixiv/PixivConstants.kt
- https://raw.githubusercontent.com/keiyoushi/extensions-source/master/src/ja/pixivcomic/build.gradle.kts
- https://raw.githubusercontent.com/keiyoushi/extensions-source/master/src/ja/pixivcomic/src/eu/kanade/tachiyomi/extension/ja/pixivcomic/PixivComic.kt
- https://api.github.com/repos/gedoor/legado ／ https://raw.githubusercontent.com/gedoor/legado/main/README.md ／ https://github.com/gedoor/legado/commits/9bb05692
- https://api.github.com/repos/Luoyacheng/legado-E
- https://api.github.com/repos/DowneyRem/PixivSource ／ https://raw.githubusercontent.com/DowneyRem/PixivSource/main/README.md ／ https://raw.githubusercontent.com/DowneyRem/PixivSource/main/pixiv.json
- https://api.github.com/repos/DowneyRem/PixivSource/issues （#56 #64 #67 #71 #76 #79 #81 #84 #89 #90 #91 #97 #98）
- https://api.github.com/repos/upbit/pixivpy ／ https://raw.githubusercontent.com/upbit/pixivpy/master/README.md
- https://github.com/upbit/pixivpy/issues/158 #337 #408 #411 #413 #415
- https://api.github.com/repos/txperl/PixivBiu ／ https://api.github.com/repos/txperl/pixivgo
- https://api.github.com/repos/GeminiLab/pixiv3-rs ／ https://api.github.com/repos/akameco/pixiv-app-api
- https://api.github.com/repos/asadahimeka/pixiv-viewer ／ https://raw.githubusercontent.com/asadahimeka/pixiv-viewer/main/README.md
- https://api.github.com/repos/leoding86/webextension-pixiv-toolkit ／ https://api.github.com/repos/Ocrosoft/PixivPreviewer ／ https://api.github.com/repos/journey-ad/pixiv-viewer ／ https://api.github.com/repos/kokororin/pixiv.moe
- https://api.github.com/search/repositories?q=pixiv&per_page=30 （D 节候选筛选）

**官方条款**
- https://www.pixiv.net/terms （日文全文，2026-09-27 抓取；`/terms_zh` 为 404）
- https://mp.weixin.qq.com/s/bcTbqBQA1T0YoRwq76xcWQ （gedoor/legado 公告指向的阅文知识产权保护公告）
- https://greasyfork.org/zh-CN/scripts/30766 （PixivPreviewer）

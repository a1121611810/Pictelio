# Pictelio SPA→MPA 拆分 + GitHub Pages 远程壳可行性调研

> 评估日期：2026-08-29。第一手来源实抓：capacitorjs.com 官方文档（config / security guides）、github/docs 仓库 raw 文档（Pages limits / HTTPS）、Google Play 政策页、GitHub API（capacitor#4080 讨论、#2373 issue、npm registry）、本项目 GitHub Pages 站点响应头实测、作者网络环境 DNS/直连探测；本地壳实测数据复用 `docs/research/nuxt-service-worker-prototype.md`（下称「原型报告」）。
> 用户提案原文：「目前 app 项目是 SPA，我打算拆成多页面（MPA）；另外打算页面上云，不放本地了，放在 GitHub（Pages），壳（Capacitor）直接访问链接（远程 URL）。」
> 前置阅读：`docs/research/nuxt-ssr-android-paths.md`（下称「SSR 路径报告」——远程 origin 桥接不可靠的既有论证，本文 §C 复核并扩充）。

---

## 0. 结论摘要（对提案逐条 verdict）

| 提案 | Verdict | 一句话 |
|---|---|---|
| SPA → MPA 拆分 | 🔴 **不推荐** | 每次导航从「客户端路由 ≈0ms」变成整页文档加载（本地最优情形 80-150ms，真实网络更糟），推翻「即时导航」体验；`stores/` 下 23 个顶层模块的跨页状态（尤其 TanStack Query 缓存与 auth 内存态）每次导航全灭，「每页自举」改造约等于重写状态层；MPA 的真实收益（分包/隔离）SPA 用 `lazy()` 就能拿到，SEO 在壳内为零 |
| 页面上 GitHub Pages + 壳访问远程 URL | 🔴 **不推荐（生产形态不成立）** | `server.url` / `allowNavigation` 官方逐字标注 "not intended for use in production"；远程 origin 下插件桥接为 2021 年开至今的无契约区（#4080 讨论实抓：多人报告 platform 判为 web、插件失效，也有人「运气好」在生产跑）；远程页面的一个 XSS ≈ 原生桥接全权调用权（含 secure storage 读 token）；github.io 中国可达性历史上间歇性故障（本次实测可达，但无法定论、无 SLA），断网即白屏 |
| 提案背后的真实诉求：「不重发 APK 就能更新页面」 | 🟢 **有正路** | 保持本地 `webDir` 不变 + web bundle OTA（自研 GitHub Releases 分发，或 `@capgo/capacitor-updater` 自托管；Ionic AppFlow 已官方宣布停售，新项目不可选）；与现有 APK 整包更新（updateService + release.mjs）形成分层更新，离线/首屏/桥接/安全全部不变 |

**最大风险（如果照提案做）**：App 可用性从「离线可用、本地磁盘秒开」变成「强依赖 github.io 跨境可达性 + Fastly 600s 边缘缓存」——把中国用户群的首屏命门交给一个官方 best-effort、无 SLA、明确标注 dev 用途的加载方式；同时把「远程资产被投毒/XSS = 原生桥接全权访问」引入现有「access_token 仅 Java 堆、纯客户端」的安全模型。

---

## 1. 提案拆解与动机审查

提案是两个独立变更 + 一个隐含诉求，应分开裁决：

1. **SPA → MPA**：渲染/路由模型变更（影响 26 条路由、23 个 store 模块、页面过渡与返回栈语义）。
2. **产物从本地 `webDir`（`packages/app/capacitor.config.ts` 中 `webDir: "dist"`）迁到 GitHub Pages，壳以 `server.url` 远程加载**：托管与信任边界变更。
3. **隐含诉求（推测，但高置信）**：「页面上云」想买的通常是不重发 APK 就能更新页面——这正是 §D 用正路回答的部分。

逐项先问「想买什么」：

| 声称收益 | 壳内成色 |
|---|---|
| MPA：SEO / 可索引 HTML | 🔴 为零——WebView 不是搜索引擎流量入口（SSR 路径报告 §2 已论证）；若想吃 github.io 上的 SEO，先过 §B.2 中国可达性 |
| MPA：每页 bundle 更小、天然代码分割 | 🟡 真实但可用 SPA 路由级 `lazy()` 等价获得（原型报告 §7 T6：Nuxt 默认按页分 chunk，主 app Solid Router 需显式 `lazy()`），无需改路由模型 |
| MPA：页面隔离（崩溃不跨页传播） | 🟡 壳内 SPA 崩溃即整 WebView 重载，用户可感知差异很小（推测） |
| 云端托管：更新不绑 APK | 🟢 真实诉求——但它与「远程加载」是两件事，§D 证明可以只拿收益不付代价 |
| 云端托管：发布快 | 🟡 现状 GitHub Releases 侧载已达成分钟级发布（`scripts/release.mjs` 一键发布）；收益边际有限 |

---

## A. SPA → MPA 拆分（Capacitor 壳语境）

### A.1 导航语义变化：从 ≈0ms 到每次整页文档加载

- **本地实测基线**（原型报告 §4.1/§5/§7，第一手数据）：本地磁盘直读的整页导航 80-150ms（`/about` 玩具页 80/81/83ms）；原型报告明确指出 SW-SSR/整页文档形态下「每次导航都是整页 document reload，而普通 SPA 可以走客户端路由（≈0ms 换页）——真实差距比表中数字更大」。这还是**零网络、零真实数据、玩具页面**的最优情形；Pictelio 级别页面在 MPA 下每次导航还要重复 JS 解析执行、TanStack Query 冷启动、数据请求。
- **与项目硬约束的关系**：AGENTS.md「先渲染、后加载」在 MPA 下技术上仍可遵守（每页骨架屏），但「即时导航」的换页体验（客户端路由 0ms）是 MPA 结构性丢掉的——文档加载是导航本身的固定成本，骨架屏救不了。
- **重度导航场景全中**：Feed → 详情 → 返回（滚动位置恢复）、详情内楼梯式浏览、小说系列连读，全部从「内存内状态切换」变成「文档往返」。
- **Android BACK 与 WebView 历史栈**（原型报告 §7 T5 实测）：Capacitor 默认 BACK 直接退出应用、不回退 WebView 历史，BFCache 被壳语义否决——主 app 正因如此自管返回栈（`backGestureStore` + `backButton` 监听）。MPA 会把问题放大：每次导航都向 WebView history 压栈，而 BACK 却不可用，返回只能靠应用自管机制逐页重建状态（比 SPA 下重建一页重得多）。
- **页面过渡动画**：现有 `PageTransition.tsx` 是同文档 DOM 过渡；MPA 跨文档过渡唯一现代标准解是 View Transitions API 的 `@view-transition` at-rule——MDN BCD 实抓：Chrome/WebView **126**+（2024-06-11）才支持，Firefox 全系未支持。本项目 WebView 基线 ≥85（AGENTS.md，Android 9 起步），大量用户的 WebView 低于 126（原型模拟器即 113）→ MPA 下过渡动画要么降级为白屏硬切、要么放弃。

### A.2 致命伤：跨页状态死亡与「每页自举」改造量

对 `packages/app/src/stores/`（23 个 `.ts` 模块 + `shared/` 工厂）按持久化机制逐文件分类（2026-08-29 代码实读）：

| 类别 | Store | 持久化机制 | MPA 下的命运 |
|---|---|---|---|
| settings registry（Preferences/localStorage） | settingsStore、themeStore、readerSettingsStore、imageHostStore、translationStore、uiStore（contentType/滚动恢复开关） | `settings` registry 持久化 | 每页重新 hydrate 即可，改造小 |
| 持久化 Set | blockStore、reportStore | `createPersistedSetSetting` → registry | 同上，改造小 |
| TanStack Query 缓存 | bookmarkStore、followStore、recommendedStore、novelFollowStore、novelRecommendedStore、novelBookmarkStore、followListStore（`createTQFeedStore`）、userIllustsStore（`createInfiniteQuery`） | **纯内存（TQ 缓存）** | **每次导航全灭**：Feed 数据、无限加载分页游标、收藏乐观更新全部重来 |
| TanStack DB | historyStore | `localStorageCollectionOptions` | 数据可恢复，UI 态需重建 |
| 纯内存单例 | authStore（`user`/`isLoggedIn`/`accessTokenSig`/`refreshTokenSig` 全是内存 signal）、searchStore、userStore、backGestureStore、novelCache（小说正文 LRU）、db.ts | refresh_token 在 secure storage，其余内存 | auth 每页重跑 `initializeAuth`（secure storage 读取 + token barrier；native 模式下 Java 侧持 token 可优化，**需实测**）；搜索状态、小说正文缓存每页丢失 |

关键点：

1. **queryClient 是每文档一份**。现状 Feed → 详情页能直接复用 Feed 缓存里的作品数据；MPA 下缓存随文档死亡，详情页必须重新请求。而原型报告 §7 的最大实测结论恰好是：**「把慢数据在用户到达之前取好」是本地壳里唯一大赢家（墙钟 -77%）**——MPA 把跨页内存预取通道拆掉，只剩 sessionStorage 手写慢通道，等于主动放弃项目已被实证的最大性能杠杆。
2. **乐观更新跨页断裂**：收藏一个作品后 Feed 卡片、详情按钮、收藏列表三方状态一致靠同一内存 store；MPA 下要靠 storage 事件/URL 参数/每页重拉同步，事件模型整体重写。
3. **改造量级**：约等于把「模块顶层单例 store」这一层整体重写为「每页自举 + 跨页通信」架构，涉及全部 23 个模块与 `tests/unit/stores/`（24 个测试文件）的假设重写——参照 ADR-0022「complete store migration to TQ factory」的先例，这类迁移是周级工程、回归面覆盖全 App。
4. **MPA 在本地壳里解决不了它想解决的问题**：即便每页 bundle 更小，导航时却要重新引导（settings hydrate + auth + 空缓存 + 首屏数据），每页净成本为正。

### A.3 MPA 真实收益项的诚实清单与裁决

| 收益 | 成色 | 裁决 |
|---|---|---|
| 每页 bundle 更小 / 天然代码分割 | 🟢 真实 | SPA 用路由级 `lazy()` 等价获得，无需 MPA |
| 隔离性（单页崩溃不扩散） | 🟡 理论真实 | 壳内可感知差异小（推测）；且 Pictelio 已有 ErrorDisplay/InlineRetryBar 的错误边界实践 |
| SEO | 🔴 壳内为零 | WebView 不是流量入口 |
| 部署粒度（单页独立回滚） | 🟡 | 属于远程托管能力，与 MPA 正交；§D 的 bundle OTA 同样按版本粒度回滚 |
| 多团队/多页面独立迭代 | 🟡 | 单维护者项目不适用 |

**裁决：在本地壳里，MPA 的收益被「导航固定成本 + 23 个 store 的状态重建成本」吃掉还有找零。**（对比：SSR 路径报告 §5 对 C2 预渲染的判定逻辑同构——收益化妆性，成本结构性。）

### A.4 框架配套

- **Nuxt 对 MPA/generate 天然友好**：`nuxt generate` 按路由产出目录化 HTML（`packages/app-nuxt` 原型已验证构建链）。若未来 web-core 引擎切到 Nuxt，MPA 选项的成本会低于 SolidJS 侧。
- **SolidJS 当前 SPA 改 MPA** = 路由模型重写（`src/router.tsx` 26 条路由 → 多入口 Vite 配置）+ §A.2 状态层重写，两项都是全量工程。
- 与 ADR-0064（双引擎 experience fix，文件 `ADR-0064-engine-switch-experience-fix.md` 存在性已核实）/ADR-0098 双引擎路线无协同：app-lynx 是「原生渲染」另一极，MPA 是「web 路由」另一极，互不搭桥。

---

## B. GitHub Pages 托管（第一手核实）

### B.1 官方硬限制（github/docs 仓库 raw 文档，2026-08-29 实抓）

`github-pages-limits.md` 逐字要点：

- 「not intended for or allowed to be used as a free web-hosting service to run your online business, e-commerce site, or any other website that is primarily directed at either facilitating commercial transactions or providing commercial software as a service (SaaS)」——Pictelio 为免费开源客户端（非商业/SaaS），托管自家 App 静态 UI 资源**不触碰该条款**；但这是「未被禁止的边缘用法」，GitHub 对「App 资源分发」无任何官方支持面。
- 发布站点 ≤ 1GB；源仓库推荐 ≤ 1GB——静态 UI 产物数 MB，无压力。
- 部署超时 10 分钟。
- 「_soft_ bandwidth limit of 100 GB per month」；超限「we may not be able to serve your site，or you may receive a polite email from GitHub Support… including putting a third-party CDN in front of your site… or moving to a different hosting service」——**官方自己建议超限者搬家**。
- 「_soft_ limit of 10 builds per hour. This limit does not apply if you build and publish your site with a custom GitHub Actions workflow」——本项目 `.github/workflows/deploy.yml` 已是 custom Actions workflow，**构建频次限制对本项目不适用**（对本项目最友好的一条）。
- 限流：「rate limits may apply… If your request triggers rate limiting, you will receive… HTTP 429」。
- 无 SLA / 无可用性承诺（文档全文无 uptime 表述；这是 best-effort 免费服务）。
- HTTPS：全站支持且可 enforce（「All GitHub Pages sites, including sites that are correctly configured with a custom domain, support HTTPS and HTTPS enforcement」——`securing-your-github-pages-site-with-https.md` 实抓）；自定义域名支持（逃生门：可挂第三方 CDN，但引入证书/回源运维面）。
- **缓存头实测**（2026-08-29 curl 本项目站点 `a1121611810.github.io/Pictelio/`）：`cache-control: max-age=600` + `x-fastly-request-id`（Fastly 边缘）+ 响应头出现 `x-github-edge-region: southeastasia`（东南亚边缘节点）。两点推论：**发版后最长 10 分钟才全网生效且无法主动失效**；中国大陆无 Fastly 节点，跨境链路质量直接决定首屏（见 B.2）。
- **无 SPA fallback**：`/illust/123` 等客户端路由路径直接 404。社区做法是 404.html hack（复制 index.html + query string 传真实路径；社区标准方案 `rafgraph/spa-github-pages`，4035 stars，最后 push 2022-11——**社区 hack，非官方特性**）。远程壳 + 现有 26 路由 SPA 必须配这个 hack 或改 hash 路由（又一处隐性改造）；若 MPA 则每路由真 HTML，无此问题（但 A 节已否 MPA）。

### B.2 中国可访问性（单独成节——中国用户群的可用性命门）

诚实口径：**无法定论。给出本次实测快照 + 历史记录 + 拓扑事实，结论必须靠目标用户网络持续自测。**

本次一手实测（2026-08-29，作者中国大陆网络环境）：

| 探测 | 结果 |
|---|---|
| DNS（默认解析） | `*.github.io` → 185.199.108-111.153（GitHub Pages 官方 Fastly IP），未见污染 |
| DNS（114.114.114.114） | 同上，解析正常 |
| DNS（223.5.5.5 阿里） | 同上，解析正常 |
| 直连（`--noproxy` 绕过代理）`https://a1121611810.github.io/Pictelio/` | HTTP 200，0.57s |
| 直连 `https://api.github.com` | HTTP 200，0.28s（IP 20.205.243.168） |

→ **仅代表此刻该网络**：单时点、单网络、单样本，不构成可达性保证。

历史与第三方记录（口径与时效如实标注）：

- 2020-08 曾发生 github.io 大规模无法访问事件（知乎分析文 p/168760260：修改 hosts / 换 DNS / 代理三种绕法）。
- 2022 年技术博客分析（leonis.cc）：「并非被完全屏蔽，而是部分运营商 DNS（电信、联通）不解析」，换 DNS 可解——即**间歇性、按运营商分化的解析故障**，而非持续性硬封锁。
- AppInChina（商业测评站，二手来源）：GitHub Pages 在中国属「部分可访问」，经常加载缓慢或不稳定。
- 2024-2025 的专门测量报告检索未命中（部分搜索词被过滤），**近年系统性数据缺失**——这就是「无法定论」的直接原因。

拓扑事实（与测量无关、长期成立）：

- github.io 走 Fastly，中国大陆无节点，延迟与丢包取决于跨境链路瞬时状态（本次实测边缘区域为东南亚）。
- 远程壳形态下，App 首屏 = 必须先从 github.io 拉回 HTML+JS 才能渲染任何东西（骨架屏也要先有壳）；现状本地 `webDir` = 零网络依赖。
- 对「用户普遍已有代理」的群体：多数用户能打开，但把「跨境 CDN 往返」变成**每个用户每天可感知的首屏延迟**（推测：跨境 RTT 数百 ms 起步 × HTML→JS→数据串行链），且故障日（解析污染/链路抖动）从「网页打不开」升级为「App 打不开」。

**判定：这是整个提案最脆弱的一环。** 技术上行得通的一天 ≠ 产品上可接受；若真要评估远程托管，必须先拿到目标用户网络的 P95 首屏耗时与一周以上的失败率数据。

### B.3 带宽约束的量级估算（推测）

100GB/月 soft limit 对「App 静态资源分发」是真实瓶颈。假设 web 产物 gzip 后 ~2-5MB、无中间缓存命中：100GB ÷ 3MB ≈ **3.3 万次全量下载/月**。对当前用户规模大概率够用，但增长后（或加入 bundle OTA 后的重复拉取）会先于其他限制触顶——届时官方建议就是「上第三方 CDN 或搬家」。

---

## C. Capacitor 远程 URL 生产化

### C.1 官方定性：三个相关配置全部「not intended for use in production」（2026-08-29 capacitorjs.com/docs/config 实抓复核）

- `server.url`：「Load an external URL in the Web View.」＋「This is intended for use with **live-reload servers**.」＋「**This is not intended for use in production.**」
- `server.cleartext`：同句式标注（API 28 起 Android 默认禁 cleartext）。
- `server.allowNavigation`：「Set additional URLs the Web View can navigate to.」＋「By default, all external URLs are opened in the external browser (not the Web View).」＋「**This is not intended for use in production.**」

官方对「远程托管生产 App」没有支持承诺——这是与 §B.1「Pages 无 SLA」叠加的**双重无承诺**。另注意：本仓 `packages/app/capacitor.config.ts` 现有 `allowNavigation: ["app-api.pixiv.net", "i.pximg.net"]` 是「**本地**产物 + 白名单额外导航域」的用法；远程壳是整个应用 origin 换掉，性质完全不同。

### C.2 远程 origin 下的桥接现实：#4080 与 #2373（GitHub API 实抓，2026-08-29）

- **discussion #4080「Who is using server.url in production?」**：2021-01-18 开启，**至今 open**（`closedAt: null`），12 条顶层评论。评论实录要点（逐条实抓）：
  - 多人报告 `capacitor.getPlatform()` 判为 **"web"**、原生插件不执行（scottwilson312；KoenLav 提问「Why not first class citizen?」）；
  - 也有人在生产上架双店「没出问题」（jayenashar：Play Store + App Store 的交通地图应用；scottwilson312：需 fork capacitor 去掉 "using server url" 提示 toast）——说明这是「**版本相关、无契约、赌运气**」，不是全坏；
  - **服务端更新语义异常**：server.url 下 PWA/SW 检测不到更新（berkayyildiz、goforu）——远程壳连「热更新」这个动机本身都可能落空；
  - **离线打开无法恢复**（27pchrisl）——远程壳的离线死穴，正中 B.2；
  - Capgo 作者 riderx 在该讨论中明确「server-url is not meant for production」，引 Apple 4.7/4.2 与 Google 政策；
  - hhimanshu 尝试失败另开 discussion #6546。
- **issue #2373**（2020-01-24，closed，7 评论）逐字原文：「When using `server.url` to fetch my app from a public web server, the current native platform is not detected and `Capacitor.platform` always outputs `web`. **That makes android plugins not execute.**」——与 #4080 的报告相互印证。
- 对 Pictelio 的杀伤面：`src/native/` 全部 6 个桥接（PixivApi 网关、AuthPlugin、OAuthPlugin、ImageCache、ClientInfo、splashBridge）+ `capacitor-secure-storage-plugin` 全部押在桥接注入可用上。SSR 路径报告 B6 的「原生桥接层零改动」结论**只在本地产物形态下成立**（该报告 §3.2 已给出同一判定，本文以今日实抓复核并补全评论证据）。

### C.3 安全模型变化：远程页面的一个 XSS = 原生桥接全权访问

- **本地形态**：WebView 内代码 = 构建期打进 APK 的产物，可信边界 = APK 签名 + 构建链；Pixiv API 响应中的用户内容（标题/HTML）注入风险被限制在「网页层」。
- **远程形态**：WebView 内代码 = 网络上的一份资产（600s Fastly 缓存窗口、GitHub 账号安全、供应链都在攻击面内）。资产被投毒或页面存在 XSS 时，攻击代码天然处于 Capacitor 桥接可达 origin：**等价拿到全部已注册插件的调用权**——secure storage 读 refresh_token、`PixivApi` 任意请求（用户身份）、ImageCache 等。
- 现有防线方向相反：ADR-0100（app-url-boundary-token-guard）在**收紧** URL 边界；AGENTS.md 关键决策「access_token 仅 Java 堆中，JS 零知」的前提是「JS 代码本身可信」——远程化后这个前提从「APK 签名保证」退化为「github.io 的 HTTPS + GitHub 账号安全保证」。
- 诚实标注：官方 config/security 文档（今日两页实抓）**没有一句**「allowNavigation/远程 origin 会授予桥接访问」的明文——桥接注入随远程 origin 的具体行为属于**无文档区**：没有保证、没有禁止、任何 Capacitor 升级都可能改变行为。这个「无契约」本身就是风险（无法给出注入机制稳定性承诺，属事实陈述而非推测）。

### C.4 Google Play 政策（若未来上架；现状侧载不适用）

`Device and Network Abuse` 政策原文（support.google.com/googleplay/android-developer/answer/9888379 实抓）：

- 「An app distributed via Google Play **may not modify, replace, or update itself** using any method other than Google Play's update mechanism.」
- 「…may not download executable code (such as dex, JAR, .so files) from a source other than Google Play.」
- 豁免：「This restriction does not apply to code that runs in a virtual machine or an interpreter… such as **JavaScript in a webview or browser**.」

即：**远程加载 JS/HTML 在 Play 政策下有明文豁免**（webview JS 不算 executable code），远程壳的 Play 政策风险低；但这不解决 C.1-C.3 的工程与安全问题。Pictelio 现状为 GitHub Releases 侧载分发，该政策是「将来上架时的约束」而非「现在的约束」——如实定位。

---

## D. 「要云端/动态更新」的正路对比

若提案的真实诉求是「**不重发 APK 就能更新页面**」，这是一个成立的需求，且有不必支付 §A/§B/§C 任何代价的正路。

### D.1 现状盘点

- 现有更新链路（`packages/update-check/src/index.ts` 实读）：`raw.githubusercontent.com` 拉 `packages/website/version.json` → `isNewer()` 版本比较 → 指引到 GitHub Release 下载 APK（失败路径显式 `console.warn`，无静默降级）。即 **APK 整包 OTA 已经存在**，缺的只是更细粒度。
- 发布流水线（`scripts/release.mjs` + ADR-0065 per-asset release upload）已支持按变体上传 Release 资产——web bundle OTA 复用同一通道是顺手的事。

### D.2 选项对比

| | **自研 OTA**（GitHub Releases 分发 web zip） | **@capgo/capacitor-updater**（自托管 endpoint） | Ionic AppFlow Live Update | 远程壳（提案） |
|---|---|---|---|---|
| 机制 | 启动检查 version.json → 下载 Release 上的 web zip → 校验哈希/签名 → 解压到私有目录 → 原生层切换 WebView 加载路径 | 插件内建：下载 zip → 校验 → session/next → reload → **崩溃自动回滚**；delta 更新；加密签名；channel 分发 | 商业 SaaS：bundle 上传 → channel → 设备拉取 → 回滚 | WebView 直连 github.io |
| 离线可用 | 🟢 仍走本地磁盘 | 🟢 | 🟢 | 🔴 断网白屏（#4080 离线评论印证） |
| 首屏 | 🟢 本地磁盘速度不变（保住原型报告 §7 的数据预取结论） | 🟢 | 🟢 | 🔴 跨境网络往返 |
| 桥接可靠性 | 🟢 origin 不变 | 🟢 | 🟢 | 🔴 §C.2 无契约区 |
| 安全 | 🟡 自实现校验（至少 SHA-256，可加签名） | 🟢 内建端到端加密与签名（npm README 原文） | 🟢 商业 | 🔴 §C.3 XSS=桥接全权 |
| 商店合规 | 🟢（webview JS 豁免） | 🟢 | 🟢 | 🟢（同为 webview JS） |
| 中国可达性 | 🟡 分发走 github.com（本次实测可达，同 B.2 口径）；可换国内可达对象存储 🟢 | 🟡 默认 Capgo 云（海外）；**自托管可指向国内可达存储** 🟢 | 🔴 海外云无保证 | 🔴 github.io |
| 维护状态 | 全自研（估计 1-2 周闭环 + 持续维护） | 🟢 **极活跃**：npm 实抓 latest **8.51.15 发布于 2026-08-28**（前一天），2022-04 首发至今 913 个版本，MPL-2.0，自述「3000+ production apps」；Capacitor 4-8 全支持（v8 对应本项目 Capacitor 8）；自托管 backend 开源 | 🔴 **已宣布停售**：Ionic 官方博客《The Future of Ionic's Commercial Products》实抓——已停止全部商业产品新售，现有用户服务至 **2027-12-31**，Live Updates 能力迁往 OutSystems Developer Cloud。**新项目不可选** | —（无官方支持形态） |

Capgo README 关键原文（npm registry 实抓）：「Cloud / Self hosted Support」「Delta Updates: Make instant updates by only downloading changed files」「Rollback: Reset the app to last working bundle if an incompatible bundle has been set」「Security: Encrypt and sign each updates」。机制细节（Android 侧加载路径切换的内部实现）未逐行核实其源码——落地前需读其 Android 实现确认与本项目 `shouldInterceptRequest` 图片代理的兼容性（标注待核）。

### D.3 分层更新策略（与现状的关系，推荐形态）

- **L1 web bundle OTA**（高频：UI/逻辑修复，分钟级到达）：自研或 capgo-updater；分发走 GitHub Releases（现通道）或国内可达对象存储；本地磁盘加载 → 离线/桥接/首屏/安全全不变。
- **L2 APK 整包**（低频：原生插件/壳变更）：现有 `updateService` + `release.mjs` 原样保留。
- **兼容规则**：bundle 需声明最低 APK 版本（原生协议变更时 L1 必须拒绝安装/回滚），可扩展 ADR-0089 update-check 架构承载。
- 该形态拿全提案诉求（页面随时更新），不支付提案任何代价——是「页面上云」诉求的正确解耦：**更新通道上云 ≠ 运行时加载上云**。

---

## E. 决策树与建议

```
你的真实诉求是什么？
├─ 「页面更新不想重发 APK」
│   ├─ 接受引入一个活跃插件 → @capgo/capacitor-updater（自托管 endpoint）
│   ├─ 想完全自主 → 自研 OTA：updateService 扩展（下载 web zip → 校验 → 本地热替换）
│   └─ 零新依赖的最小步 → 先把「提示下载 APK」升级为「静默下载 bundle + 下次启动生效」
├─ 「想要每页更小的 bundle」 → 路由级 lazy() 分包，SPA 不动
├─ 「想要 SSR/SEO」 → 壳内为零收益（SSR 路径报告已钉死）；github.io 吃 SEO 先过 B.2
└─ 「想把页面放到云端」（纯粹诉求）
    └─ 不要用 Capacitor server.url 生产形态（C 节三重否定：官方明文 dev 定位、
       桥接四年悬案、安全边界恶化 + B.2 可达性命门）
       若要验证 github.io：作为浏览器直开的 Web 版/试用版（壳仍本地），零风险试验场
```

**建议（按优先级）**：

1. **不做 MPA 拆分**；bundle 诉求用路由级 `lazy()` 解决。
2. **不做远程壳**；`webDir` 本地形态不动。
3. 若「不重发 APK 更新页面」确认立项：走 §D.3 分层更新，先 spike 自研 OTA 最小闭环（复用 updateService + Release 通道），再评估是否引入 capgo。
4. 若想验证 github.io 上的 Web 版：把 `packages/website` 部署流水线扩一个浏览器可开的 Web 导出——与远程壳解耦，作为决策前的真实数据来源（顺带持续采集 B.2 需要的可达性数据）。

---

## 附：引用来源

| 论断 | 来源（抓取/实抓日期 2026-08-29） |
|---|---|
| `server.url`/`cleartext`/`allowNavigation` 逐字标注 "intended for live-reload / not intended for use in production"；allowNavigation 默认外部 URL 走外部浏览器 | https://capacitorjs.com/docs/config （本次调研实抓复核；与 SSR 路径报告 §3.1 的 2026-08-29 抓取一致） |
| #4080 讨论：2021-01-18 开、仍 open、12 条顶层评论；platform=web/插件失效、生产成功案例、SW 更新拿不到、离线不可恢复、riderx 劝退引言 | GitHub GraphQL API 实抓 https://github.com/ionic-team/capacitor/discussions/4080 |
| #2373 原文：「Capacitor.platform always outputs web. That makes android plugins not execute.」 | gh API https://github.com/ionic-team/capacitor/issues/2373 （2020-01-24，closed，7 comments） |
| 官方安全指南无 allowNavigation/远程内容安全章节（无契约区的事实依据） | https://capacitorjs.com/docs/guides/security （实抓） |
| Pages 限制：1GB、100GB/月 soft、10 builds/hour（custom Actions workflow 豁免）、10 分钟部署超时、429、free web-hosting/SaaS 禁用条款、超限建议搬家 | github/docs 仓库 raw：content/pages/getting-started-with-github-pages/github-pages-limits.md |
| Pages HTTPS 全站支持与 enforce | github/docs 仓库 raw：…/securing-your-github-pages-site-with-https.md |
| 本项目 Pages 站点 `cache-control: max-age=600`、Fastly 边缘、边缘区域 southeastasia | curl 实测 `https://a1121611810.github.io/Pictelio/` 响应头（404 响应含 `x-github-edge-region: southeastasia`） |
| SPA fallback 为社区 hack（404.html + query string） | https://github.com/rafgraph/spa-github-pages （4035 stars，最后 push 2022-11） |
| 中国可达性本次实测（三路 DNS 解析正常、直连 200/0.57s） | 作者网络环境 dig/curl 一次性探测（单时点单网络，不构成保证） |
| 2020-08 github.io 大规模无法访问事件；2022 分析「运营商 DNS 不解析、换 DNS 可解」；AppInChina「部分可访问」 | https://zhuanlan.zhihu.com/p/168760260 ；https://leonis.cc/sui-sui-nian/2022-09-06-dns-forbidden-of-github-pages.html ；https://appinchina.co/does-github-pages-work-in-china/ （均为二手来源，时效口径见 §B.2） |
| Play 政策：禁止自更新/下载 executable code；webview JS 明文豁免 | https://support.google.com/googleplay/android-developer/answer/9888379 （实抓） |
| capgo npm 活跃度（8.51.15 @ 2026-08-28；913 版本；MPL-2.0；Capacitor 4-8；delta/rollback/签名加密/自托管特性原文） | npm registry `@capgo/capacitor-updater` metadata + README 实抓；https://capgo.app/docs/ |
| AppFlow 停售（商业产品新售终止、服务至 2027-12-31、Live Updates 迁往 OutSystems DC） | https://ionic.io/blog/important-announcement-the-future-of-ionics-commercial-products + https://ionic.io/appflow （实抓） |
| `@view-transition`（跨文档视图过渡）：Chrome/WebView 126+（2024-06-11），Firefox 未支持 | MDN BCD `css.at-rules.view-transition`；https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@view-transition |
| 本地整页导航 80-150ms vs SPA ≈0ms；BACK 直接退出应用、BFCache 被壳否决；数据预取 -77%；按路由分 chunk | `docs/research/nuxt-service-worker-prototype.md` §4.1/§5/§7（本仓第一手实测） |
| 远程 origin 桥接不可靠的前置论证、SSR/预渲染在壳内的判定 | `docs/research/nuxt-ssr-android-paths.md` §3/§5 |
| store 分类（23 模块 + shared；settings registry/TQ 缓存/TanStack DB/纯内存四类） | `packages/app/src/stores/` 逐文件代码实读（authStore/uiStore/settingsStore/shared/* 等，见 §A.2 表） |
| 现有更新链路（version.json → isNewer → GitHub Release）与发布流水线 | `packages/update-check/src/index.ts`、`packages/app/scripts/release.mjs` 实读 |
| 「即时导航硬约束」「先渲染后加载」、WebView ≥85 基线、access_token 仅 Java 堆、26 路由 | `AGENTS.md`；ADR-0100（URL 边界）、ADR-0037（插件网关）、ADR-0064/0098（双引擎，文件名核实）、ADR-0065（per-asset upload）、ADR-0089（update-check 架构） |
| 跨境 RTT 量级、用户级首屏延迟感知、带宽估算 3.3 万次全量下载/月、MPA 隔离性用户可感知度、auth 自举 native 侧可优化幅度 | **推测**（无公开来源，基于架构事实外推，落地前需实测/自测） |

# 云端托管 web client 可行性复核（GitHub Pages / 云端部署）

> 评估日期：2026-09-06。问题原文：「当前 app client 是在本地的，若改为部署到云端（例如 GitHub）可行吗？」
> 性质：**复核 + 现状更新**，非从零调研。本问题在 2026-08-29 已有一手调研
> [`docs/research/mpa-remote-githubpages-feasibility.md`](./mpa-remote-githubpages-feasibility.md)（下称「8-29 报告」），
> 其 Capacitor / GitHub Pages / 中国可达性一手实抓距今仅一周，本文直接引用不重复抓取；
> 本文新增：① OTA L1 上线后的现状盘点（8-29 报告 §D 的「正路」现已落地）；
> ② 纯网页版（浏览器直开）的 CORS 实测；③ 直连 effort 之后「GitHub 依赖」的架构口径。

---

## 0. 结论摘要

| 形态 | Verdict | 一句话 |
|---|---|---|
| ① 远程壳：APK 壳 + `server.url` 运行时加载 github.io | 🔴 **不可行（生产形态不成立）** | 与 8-29 报告结论一致且更甚：官方逐字 "not intended for use in production"、远程 origin 桥接四年无契约区、XSS=原生桥全权、github.io 中国间歇不可达 + 断网白屏；且与直连 effort 的架构方向背道而驰 |
| ② 纯网页版：SPA 直接部署 GitHub Pages 浏览器直开 | 🔴 **不可行（无 API 通道）** | 本次实测 `app-api.pixiv.net` 无 `Access-Control-Allow-Origin`（CORS 封死）；web 模式 `/pixiv-api`、`/pixiv-img` 代理重写仅在 Vite dev server 存在；图片 Referer 注入在 Java 侧。成立需自建服务端反代 = 另一个项目 |
| ③ OTA 分发上云：本地运行 + GitHub Releases 云端分发 | 🟢 **已落地，就是现状** | ADR-0122（v4.22.0+）：web zip + Ed25519 签名 + GitHub Releases 三件套 + 本地原子切换 + lastGood 回滚；当前 version.json `webBundle.url` 即 Releases 下载地址。「不重发 APK 更新页面」的云端诉求已满足 |

**一句话回答**：把 client「部署到 GitHub」当作运行时托管（形态①②）不可行；但 client 的**分发**早已上云（形态③）——「更新通道上云 ≠ 运行时加载上云」，这条分界线是全部结论的锚点。

---

## 1. 现状盘点：client 现在怎么交付（2026-09-06 代码实证）

当前 web client 的生命周期已经是「本地运行 + 云端分发」双轨：

| 环节 | 现状 | 证据 |
|---|---|---|
| 构建 | `webDir: "dist"` 打进 APK `assets/public`（gitignore，构建期复制） | `packages/app/capacitor.config.ts:11`；`android/.gitignore:95-96` |
| 加载 | WebView 从本地 `https://localhost`（androidScheme）加载，零网络依赖 | `capacitor.config.ts:23` |
| 更新检查 | 启动时从 `raw.githubusercontent.com/.../main/packages/website/version.json` 拉版本坐标 | `packages/update-check/src/index.ts:116-117` |
| web 包 OTA | `webBundle.url` = **GitHub Releases 下载资产**（`.../releases/download/v4.35.0/pictelio-4.35.0`），Java 侧拼三件套 `-manifest.json` / `-manifest.json.sig` / `-web-bundle.zip` | `packages/website/version.json:5-8`；`release-bundle-core.mjs` `bundleAssetUrlBase()` |
| 安装流水线 | manifest 拉取 → **Ed25519 验签** → `minApkVersion` 拒装（G2）→ zip 下载 → size/sha256 校验 → 解压版本目录 → 写 `pending` 指针，下次启动原子切换 | `OtaInstaller.java:56-111` |
| 健康与回滚 | `notifyReady` 版本握手 10s 超时回滚 `lastGood`；`minWebVersion` floor 自愈快通道 + WorkManager 预热慢通道 | `OtaPlugin.java`；`otaService.ts:85-250` |
| 快速发布 | `pnpm release --web-only`：分钟级 web 热修，不构建 APK | `openwiki/architecture/overview.md` §OTA |

也就是说，**8-29 报告 §D.3 推荐的「分层更新」已经完整实现并在生产运行**（openwiki ADR-0122/spec/docs/specs/ota-web-bundle.md）。「client 上云」能买到的核心收益——不重发 APK 就能更新页面——已经买到。

## 2. 形态①：远程壳（`server.url` → github.io）——🔴 维持不可行判定

8-29 报告 §C 的三重否定全部仍成立（一手实抓 2026-08-29，一周前）：

1. **官方定性**：`server.url` / `allowNavigation` 在 capacitorjs.com/docs/config 逐字标注 "not intended for use in production"（定位 live-reload 用途）。
2. **桥接无契约区**：capacitor discussion #4080（2021 开至今 open）多人报告远程 origin 下 `getPlatform()` 判为 web、原生插件不执行；也有生产成功案例——版本相关、赌运气。本项目 6 个 Capacitor 插件 + secure-storage 全部押在桥接注入上。
3. **安全模型恶化**：远程页面一个 XSS = 已注册插件全调用权（secure storage 读 refresh_token、PixivApi 以用户身份任意请求）。现有「access_token 仅 Java 堆」防线的隐含前提是「JS 代码可信」，该前提在本地形态由 APK 签名保证，远程形态退化为 github.io 的 HTTPS + GitHub 账号安全。

本次新增/强化的证据：

- **与直连 effort 的方向冲突**（2026-09 刚完成 #385-#388）：项目的最新架构投入是把「绕过 GFW 访问 Pixiv」做成不依赖代理的直连能力（IP 表 + 无 SNI 边缘直连）。与此同时把 client 运行时挂到 github.io，等于**新引入一个比「Pixiv 可达」更脆弱的跨境强依赖**——github.io 历史上有大规模不可达事件（2020-08）、按运营商分化的 DNS 解析故障（2022），8-29 报告 §B.2 判定「无法定论、间歇性」。刚拆掉一堵墙又砌一堵。
- **违反仓库已固化的 GitHub 依赖纪律**：项目现有三处 GitHub 运行时依赖（update-check 拉 version.json、直连 IP 表拉取、OTA bundle 下载）全部遵循同一模式——**远端只是分发渠道，失败必须显式 warn 并落到本地兜底**（检查失败走缓存 floor 或 fail-open、IP 表失败用内置表 `DirectIpTableDefaults` + 熔断器、OTA 失败保留 `lastGood`/内置 bundle）。远程壳是唯一违反该纪律的形态：github.io 拉不到 = **App 白屏**，没有任何本地兜底层。
- **离线死穴**：首启动、飞行模式、断网场景全灭（8-29 报告 #4080 离线评论印证）；现状本地形态离线全功能可用。
- **技术细节上「看起来可行」的部分确实可行**，一并记录避免误判：`/pixiv-img/` 图片拦截是 URL 子串匹配、与页面 origin 无关（`ImageIntercept.java:61` `url.contains("/pixiv-img/")`），远程页面的图片请求照样被代理；`OtaInstaller` 的 `minApkVersion` 门禁解决了 JS/native 版本偏斜。但这两点救不了 §C 三重否定。

## 3. 形态②：纯网页版（浏览器直开 GitHub Pages）——🔴 本次新增实测

「干脆做成网页版挂 GitHub Pages，浏览器直接访问」是另一条路，本次实测判定不可行：

| 实测（2026-09-06） | 结果 |
|---|---|
| `curl -sI https://app-api.pixiv.net/`（经代理，HTTP/2 404 是根路径正常行为） | 响应头**无 `Access-Control-Allow-Origin`**——浏览器跨域 fetch 直接被 CORS 拦截；app-api 是给原生 App 用的，从不发 CORS 头 |
| web 模式 API 通道（`src/api/client.ts:224-240`） | `/pixiv-api`、`/pixiv-img` 前缀重写是 **Vite dev proxy 专用**；生产 web 构建下这些相对路径会打到托管站自身（GitHub Pages）→ 404，且 Pages 无法配置反向代理 |
| 图片 `Referer` 校验 | `i.pximg.net` 防盗链要求 Referer 注入，本项目在 Java 侧完成（`PixivImageLoader`）；浏览器网页无法伪造该头 |
| 登录 | PKCE/refresh_token 流程依赖原生桥（secure storage + Java 侧 token 交换），纯网页无从安置 |

结论：纯网页版成立的前提是**自建服务端反代**（补 CORS + Referer + token 代理）——那是完全不同量级的工程（服务器、运维、滥用面），与本问题「托管到 GitHub」的零运维预期不符。GitHub Pages 上的 `packages/website` 落地页能工作，恰因为它不含任何 Pixiv API 调用。

## 4. 形态③：OTA 分发上云——🟢 现状即答案

见 §1 现状盘点。补充两点边界认知：

- **GitHub Pages 对 OTA 没有必要**：bundle 走 Releases 资产，不受 Pages 100GB/月 soft 带宽与 `max-age=600` 缓存延迟约束（Releases 单文件上限 2GB，web zip 数 MB 绰绰有余）。
- **可达性兜底已经做对**：GitHub（raw/releases）在大陆间歇不可达时，update-check fail-open 不设门槛、IP 表回退内置表、OTA 回退 lastGood——App 功能不受影响，只影响「更新到达速度」。这正是「分发上云」与「运行时上云」的本质差别：前者故障 = 更新延迟，后者故障 = App 不可用。

## 5. 建议

1. **维持现状**：本地 `webDir` + OTA L1/G1/L2 分层更新。web 层修复走 `pnpm release --web-only` 分钟级到达，不需要动托管形态。
2. 若诉求是「国内可达性更好的分发」：把 `webBundle.url` / `UPDATE_URL` / IP 表 URL 换成国内可达对象存储（已有 `otaLastKnownFloor`、内置 IP 表等兜底，切换成本低）——换的是**分发渠道**，不是运行时形态。
3. 不做远程壳、不做纯网页版；若未来要「浏览器可开的试用版」，前提是先立项自建 Pixiv 反代服务（独立评估）。
4. 试验性验证 github.io 可达性无需改 app：现有落地页站点 `a1121611810.github.io/Pictelio/` 即持续的真实数据源（本次实测 200 / edge japaneast / `max-age=600`）。

---

## 附：引用来源

| 论断 | 来源 |
|---|---|
| Capacitor `server.url`/`allowNavigation` "not intended for use in production"、#4080/#2373 桥接无契约区、Pages 限制（1GB/100GB/600s 缓存/无 SPA fallback）、中国可达性历史事件、AppFlow 停售、XSS=桥接全权论证 | 8-29 报告 §B/§C/§D（`docs/research/mpa-remote-githubpages-feasibility.md`，一手实抓 2026-08-29） |
| OTA 机制全链（三件套 URL、Ed25519、minApkVersion、pending/lastGood、快慢通道、notifyReady 回滚） | `OtaInstaller.java:56-111`、`OtaPlugin.java`、`otaService.ts:85-250`、`openwiki/architecture/overview.md` §OTA（2026-09-06 codegraph/Read 实证） |
| `webBundle.url` = GitHub Releases 资产 | `packages/website/version.json:5-8`、`release-bundle-core.mjs` `bundleAssetUrlBase()` |
| update-check / IP 表的 raw.githubusercontent 依赖与本地兜底 | `update-check/src/index.ts:116-117`；`directaccess/IpTableFetcher.java`（javadoc：与 version.json 同目录同机制）、`DirectIpTableDefaults.java`、`DirectAccessConfig.java` |
| `/pixiv-img/` 拦截与 origin 无关 | `ImageIntercept.java:61` |
| web 模式代理重写仅 dev 存在 | `src/api/client.ts:224-240` |
| app-api.pixiv.net 无 CORS 头；GitHub Pages 站点 200/japaneast/max-age=600；直连 app-api 无代理超时 | 本次 curl 实测（2026-09-06，命令与输出见 git 历史/会话记录；直连超时与直连调研 SNI 封锁结论一致：`prototype/pixiv-bypass-feasibility` 68fbd826 `docs/research/pixiv-direct-access-feasibility.md` §3.1） |
| 直连 effort 现状（#385-#388 已实施） | `DirectIpTableDefaults.java` javadoc 溯源、项目 memory（pixiv-direct-access-effort） |

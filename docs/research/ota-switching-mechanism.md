# OTA 运行时指向机制选型：下载后的 bundle 目录如何让 WebView 加载

> 评估日期：2026-08-29。回答 issue #241（Map: #240，前置结论见 `docs/research/mpa-remote-githubpages-feasibility.md` §D——本地 webDir + web bundle OTA 路线，远程 URL 壳已否决）。
> 第一手来源实抓：`@capgo/capacitor-updater` 8.51.15 Android 源码逐行实读（CapacitorUpdaterPlugin.java 5860 行 / CapgoUpdater.java 3395 行 / BundleInfo / DownloadService 等直接自 GitHub `Cap-go/capacitor-updater` main 下载）；Capacitor 8.5.0 Android 源码实读（Bridge.java / WebViewLocalServer.java / WebView.java 插件 / CapConfig.java / UriMatcher.java，tag `8.5.0`）；npm registry metadata；capacitorjs.com/docs/config；ionic-team/capacitor issues #1228 / #4598；GitHub API 仓库/发布数据；本仓 `packages/app/android/.../MainActivity.java` 代码实读。
> 注：`docs/research/nuxt-service-worker-prototype.md`（app-nuxt 原型报告）在仓内实际不存在（未被提交，`packages/app-nuxt` 整体无 git 跟踪记录），本文对 v3 拦截实验的引用只能转述 mpa 报告的二手结论；仓内**已提交、生产在跑**的拦截先例是主 app MainActivity 的 `/pixiv-img/` 代理（本文 §B 直接实读该源码）。

---

## 0. 结论摘要（对 issue 三问逐条 verdict）

| 问题 | Verdict | 一句话 |
|---|---|---|
| Q1 capgo 切换机制 | 🟢 **机制源码核实通过，且不依赖 server.url** | 切换 = `bridge.getLocalServer().hostFiles(绝对路径)`（Capacitor 内置本地服务器换根目录）+ `loadUrl(appUrl)` 整页重载；origin 保持 `https://localhost` 不变，桥接注入/安全模型零变化；与 Capacitor 8 兼容（peerDep `^8.0.0`，devDep 8.5.0，与本项目版本一致） |
| Q2 shouldInterceptRequest 全站代理到 filesDir | 🟡 **可行但不推荐作为主方案** | Capacitor 的 `WebViewLocalServer` 本身就是「shouldInterceptRequest 代理到本地目录」的工业实现（`hostFiles()` 只改两个字段）；自研全站代理要重做 mime（ES module 必须 `application/javascript`）、Range 206、HTML5-mode SPA fallback、JSInjector 注入（WebView <119 的桥接引导）、Cache-Control 五件事——全部是已知的坑面；`/pixiv-img/` 先例证明拦截与本地服务器可共存（包装 WebViewClient + 委托），保留即可 |
| Q3 Capacitor 官方支持面 | 🟢 **原语官方支持，管理层官方没有** | 官方原语：Java `Bridge.setServerBasePath()` / `WebViewLocalServer.hostFiles()` + 内置 `WebView` 插件 JS 方法（`setServerBasePath`/`getServerBasePath`/`persistServerBasePath`，默认注册，官方 issue #1228 明确背书这是正道）；启动恢复 `CapWebViewSettings/serverBasePath`（`DisableDeploy` 默认 false 放行，APK 版本变更自动清指针）；**多版本管理/回滚/分发/防呆全部没有**——这正是 capgo 这类插件的增量 |

**推荐机制**：采用 `@capgo/capacitor-updater`，其切换原语与 Capacitor 8.5.0 官方 `hostFiles` 原语同源；**手动模式**接入（`download()` + `set()` + `notifyAppReady()` 由本仓 ADR-0089 update-check 驱动，分发走现有 GitHub Releases 通道），暂不依赖 capgo 云或自建 update endpoint（后续可平滑切到 auto-update + 自托管端点）。

**原子切换语义**：**版本目录不可变（`filesDir/versions/<id>/` 各含完整 index.html+assets）+ 单指针（SharedPreferences `serverBasePath`，`commit()` 同步落盘）+ 整页 `loadUrl` 重载**——磁盘上永远不存在半新半旧的文件混合；`notifyAppReady()` 超时（默认 10s）未调用 → 自动回滚到上一个成功版本 → 仍失败回滚到 APK 内置 bundle。残留的半新半旧风险只剩 localStorage schema 跨版本漂移与「换根到 loadUrl 之间毫秒级窗口内旧文档发起子资源请求」两处（工程上可收敛，见 §A.4）。

**最大风险**：capgo 插件体量大（Android 侧 ~5860 行主文件，含摇一摇菜单/预览会话/统计批量上报等本项目用不到的面），MPL-2.0 为文件级 copyleft（依赖引入不传染自有代码，但插件补丁需开源），且其 auto-update 端点契约是事实标准而非 RFC——若走自托管端点需用契约测试锁住请求/响应形状（源码字段已提取，见 §A.3）；回滚依赖 JS 侧正确调用 `notifyAppReady()`，调用过早（splash 未收就报 ready）会使回滚形同虚设。

---

## A. Q1：`@capgo/capacitor-updater` 源码机制（Android 侧逐行核实）

### A.1 切换机制：不依赖 server.url，走 Capacitor 内置本地服务器换根

核心代码（`CapacitorUpdaterPlugin.java` `applyCurrentBundleToBridge()`，main 分支实抓）：

```java
// path = implementation.getCurrentBundlePath()  → 绝对路径，如 /data/user/0/<pkg>/files/versions/<id>
// usingBuiltin = implementation.isUsingBuiltin() → 指针等于 "public" 时为内置 bundle
if (usingBuiltin) {
    this.bridge.getLocalServer().hostAssets(path);   // 内置：从 APK assets 服务
} else {
    this.bridge.getLocalServer().hostFiles(path);    // OTA：从 filesDir 目录服务
}
// 随后（keepUrlPathAfterReload 时还保留当前路由 path）：
this.bridge.getWebView().post(() -> {
    this.bridge.getWebView().loadUrl(finalUrl1.toString());
    this.bridge.getWebView().clearHistory();          // 可配置不保留旧历史
});
// 兜底路径（URL 构造失败时）：bridge.setServerAssetPath(path) / bridge.setServerBasePath(path)
```

要点：

1. **origin 不变**：`hostFiles()` 只是换掉 `WebViewLocalServer` 的服务根目录，WebView 仍加载 `https://localhost/`（scheme/hostname 由 Capacitor 配置决定）。`server.url` 全程未涉及——mpa 报告 §C 的「远程 origin 桥接无契约区」整套论证对它不适用，桥接注入（PixivApi 等全部原生插件）行为与 APK 内置 bundle 完全一致。
2. **`hostFiles()` 的实现轻到极点**（Capacitor 8.5.0 `WebViewLocalServer.java` 实读）：

   ```java
   public void hostFiles(final String basePath) {
       this.isAsset = false;
       this.basePath = basePath;
       createHostingDetails();   // 重建 URI handler：openFile(basePath + url.getPath())
   }
   ```

   对每个请求 `AndroidProtocolHandler.openFile(basePath + path)` 直接 `FileInputStream` 读私有目录文件——性能量级与读 APK assets 相当（均为本地 I/O，无网络）。
3. **handler 绑定是「每次 hostFiles 调用」粒度**：`createHostingDetails()` 把调用时的 `basePath` 捕获进匿名 PathHandler（`final String assetPath = this.basePath`），UriMatcher 终端节点 `mCode` 直接覆盖（`UriMatcher.addURI` 语义核实）。因此换根后**在途旧文档**继续由旧 handler 服务，直到 `loadUrl` 完成才切到新根——为原子性提供了结构性保障（§A.4）。
4. **「内置/OTA」由路径值区分**：指针等于字面量 `"public"` → `hostAssets("public")` 走 APK assets；否则走 `hostFiles(绝对路径)`。回滚到内置 = 指针写回 `"public"`。

### A.2 原子性：版本目录 + 单指针 + 整页重载 + 三层回滚

**磁盘布局**（`CapgoUpdater.java` 实抓）：

- 每个 bundle = `getFilesDir()/versions/<随机 10 字符 id>/`，目录内含完整 `index.html` + assets（`bundleDirectory = "versions"`，`bundleExists()` 要求 `index.html` 存在且状态非 deleted/deleting 才允许 set）。
- 安装流程：zip 下载到 `filesDir/<随机 dest>` → **SHA-256 校验**（`CryptoCipher.calcChecksum`，若配置了 publicKey 则强制要求 checksum 且先端到端解密）→ 解压到临时目录（前缀 `capgo_unzip_`）→ `flattenAssets` 移入 `versions/<id>` → 注册 BundleInfo(PENDING)。失败路径（校验失败/解压失败）当场 `safeDelete` + `delete(id)` 清理，孤儿临时目录在下次启动统一清扫。
- **指针**：`setCurrentBundle(File)` → `SharedPreferences editor.putString(CAP_SERVER_PATH, path).commit()`（同步 commit，kill-safe）；`pastVersion`（上一个成功版本）与 `nextVersion` 两个指针独立存键。

**切换时序**（三条路径）：

1. **立即切换**（JS `set` / `reload`）：`set(id)` 校验 bundleExists → 指针 commit + 状态置 PENDING → `_reload()` → `applyCurrentBundleToBridge()`（换根 + loadUrl）→ 启动 `checkAppReady(appReadyTimeout)` 等待 JS `notifyAppReady()`；`semaphoreWait` 超时返回 false → 调用方 `restoreResetState`（指针回滚）+ `restoreLiveBundleStateAfterFailedReload`（换回旧根）。
2. **下次启动生效**（JS `next`）：仅写 `nextVersion` 指针；下次启动 `installNext()` 消费 → `set(next)` + `_reload()`。
3. **auto-update**（默认开）：启动/回前台时 `getLatest()` 查询 → 下载 → 按 `autoUpdate` 模式（onLaunch/always）走上述两路径之一；directUpdate 模式下载完立即重载。

**三层回滚**（`checkRevert()` + `performReset(true,...)` 实抓）：

```
notifyAppReady 未在 appReadyTimeout（默认 10000ms，配置最小 1s）内到达
  → updateFailed 事件 + "update_fail" 统计 + 当前 bundle 标记 ERROR
  → performReset(toLastSuccessful=true)：优先 set(fallback=pastVersion 上一个成功版本)
      ↳ fallback 不可安装/重载失败 → "Resetting to native"：指针写回 "public"（APK 内置 bundle）
  → autoDeleteFailed（默认 true）时延迟删除失败 bundle（异步队列 + 75ms 节流，绝不删当前/fallback）
```

另有 `resetWhenUpdate`（默认 true）：APK 整包升级后（native build version 变化）自动清理全部 OTA bundle 回到内置，防止原生协议漂移——与本仓「bundle 声明最低 APK 版本」的分层更新设想（mpa 报告 §D.3）天然同构。

### A.3 自托管：三条路，最短一条不需要任何后端

源码证据（`CapacitorUpdaterPlugin.java` 行 98-100、865；`CapgoUpdater.java` `getLatest`/`createInfoObject`/`makeJsonRequest` 实抓）：

- 三个端点全部可配：`updateUrl`（默认 `https://plugin.capgo.app/updates`）、`statsUrl`（默认 `.../stats`，可设 `""` 关闭）、`channelUrl`（`.../channel_self`）。README 明文：「Open source - Self-host or use Capgo Cloud」「Open Source Backend: Self install our backend（github.com/Cap-go/capgo）in your infra」；CLI 侧另有 `localS3/localHost/localWebHost/localSupa` 自托管/联调配置。
- **auto-update 端点契约**（自托管时需实现的最小形状）：
  - 请求体（`createInfoObject`，POST JSON）：`platform:"android"`、`device_id`、`app_id`、`custom_id`、`version_build`、`version_code`、`version_os`、`version_name`（当前 bundle）、`plugin_version`、`is_emulator`、`is_prod`、`install_source`、`defaultChannel`（启用加密时另有 `key_id`）。
  - 响应：JSON 透传（`makeJsonRequest` 遍历所有 key 原样回传，`session_key` → `sessionKey` 改名）；无更新时约定不返回 `version`；有更新时 `version` + `url`（zip 地址）+ `checksum`（可选，配 publicKey 时强制）+ `major`（破坏性更新标记）等。429 有 Retry-After 尊重逻辑（上限 24h 客户端封锁）。
  - stats 端点为批量 JSON 队列（每秒 flush 一次，最多 200 条 pending 落盘 `capgo_pending_stats.json`），纯遥测，自托管可直接丢弃或置空 URL。
- **零后端路线（对本仓最有吸引力）**：插件手动 API 完全开放——`download({url, version, checksum?})` 接任意 URL（zip），`set()`/`next()`/`reload()`/`reset()`/`delete()`/`list()` 与回滚/原子性全部照常工作。即：**用本仓现有 update-check（ADR-0089，`raw.githubusercontent.com` 拉 version.json）+ GitHub Releases 直链 zip 驱动手动模式，一个自建后端都不需要**，同时白拿版本目录/指针/回滚/清理全套工程。mpa 报告 §D.2 对 capgo「极活跃、MPL-2.0、Capacitor 4-8 全支持」的判定与本次源码核实一致。

### A.4 残留的半新半旧风险（issue 显式追问项）

| 风险点 | 成色 | 收敛手段 |
|---|---|---|
| 磁盘文件混合 | 🟢 结构性不存在 | 版本目录不可变 + 指针原子 commit；set 前强制 bundleExists（index.html 在）+ checksum 前置校验；旧 bundle 删除是延迟队列且永不触碰当前/fallback |
| 换根到 loadUrl 之间的毫秒级窗口 | 🟡 真实但极窄 | `hostFiles()` 换根后、`loadUrl()` 前若旧文档恰好发起子资源请求，会拿到新目录文件。窗口 = 主线程一个 post 的间隔（毫秒级）；旧文档早已加载完 JS，能发的多是图片懒加载——错位结果只是个别图片 404/新旧版资源，且整页重载随即冲掉。强收敛：把 hostFiles+loadUrl 收进同一个 UI 线程 runnable（DIY 时可做；capgo 当前 hostFiles 在插件线程、loadUrl post 到 WebView 线程，顺序仍由提交方保证） |
| WebView HTTP 缓存跨版本串味 | 🟢 已被框架处理 | Capacitor `PathHandler` 构造强制注入 `Cache-Control: no-cache`（WebViewLocalServer.java 行 105 实抓）；无 ETag/304 机制 → 每次实取，本地磁盘 I/O 可忽略 |
| localStorage/Preferences schema 跨版本漂移 | 🟡 唯一真实的「半新半旧」 | JS 代码换了、存储还是旧的。settings registry 已有默认值兜底，但 bundle 版本间 schema 变更需显式迁移逻辑；TQ 内存缓存在 reload 时全灭（反而干净）；建议 bundle 元数据里带最低可迁移版本（复用 mpa §D.3 的最低 APK 版本机制扩展到「最低可迁移 bundle 版本」） |
| notifyAppReady 调用过早 | 🟡 工程纪律项 | splash 收起前就调 ready → 坏 bundle 被判成功，回滚失效。需要把它纳入 Pictelio 启动编排（main.tsx 在首屏数据真正挂载后调用），并让 mpa 报告 §D.1 的失败显式化原则覆盖此点 |
| 多 bundle 共存时与 `keepUrlPathAfterReload` | 🟢 | capgo 支持重载后保留路由 path（默认配置 `keepUrlPath`），Pictelio 26 条路由的深链重载语义可保 |

### A.5 活跃度与 License（GitHub API + npm registry 实抓，2026-08-29）

- **npm**：latest `8.51.15`（2026-08-28 发布，调研前一天）；共 913 个版本，首发 2022-04-16；`peerDependencies: @capacitor/core ^8.0.0`，devDep `@capacitor/android@^8.5.0`（与本项目 `packages/app` 的 `@capacitor/android ^8.5.0` 对齐）；v4-v7 各有 LTS dist-tag 同步维护。
- **GitHub**：`Cap-go/capacitor-updater`，834 stars / 156 forks / Java 主语言 / 未归档；最近 release 8.51.15（2026-08-27），近两周连发 3 版（08-16、08-20、08-27）。
- **License**：MPL-2.0（repo licenseInfo 实抓）。文件级 copyleft：作为依赖引入不传染宿主代码；若 fork/补丁修改插件源文件，改动文件需以 MPL 开源。对本仓影响小（Pictelio 本身开源），但若需要定制补丁要考虑上游 PR 优先。

---

## B. Q2：Java `shouldInterceptRequest` 全站代理到 filesDir 任意目录

### B.1 先例盘点（仓内实读）

- **主 app（生产在跑）**：`packages/app/android/app/src/full/java/io/pictelio/app/MainActivity.java` 的 `onStart()` 把 `bridge.getWebView().getWebViewClient()` 包一层，`shouldInterceptRequest` 命中 `/pixiv-img/` 时走 `PixivImageLoader`（URL 重写 + OkHttp 下载 + 磁盘缓存 + 注入 Referer/UA），未命中**委托回原始 client**。实测教训（源码注释）：WebView 拦截线程是并发的（per-URL 锁防同 URL 双写缓存）；弃用重载 `shouldInterceptRequest(WebView, String)` 拿不到请求头，必须一并覆写。
- **app-nuxt v3 实验**：mpa 报告转述「该拦截模式可行」；原型报告与源码均未入库（§前言已注明），无法逐行复核——按二手证据处理。
- **Capacitor 自己（8.5.0 源码实读）**：`Bridge.loadWebView()` 里 `webViewClient` 的 `shouldInterceptRequest` 就一行 `return getLocalServer().shouldInterceptRequest(request)`——Capacitor 的 `https://localhost/` 服务**本身就是 shouldInterceptRequest 代理到本地目录**。即 Q2 的「自研全站代理」= 重写一个 `WebViewLocalServer`。

### B.2 自研全站代理必须重做的五件事（每件都是已知坑）

| # | 坑 | WebViewLocalServer 的现成答案（8.5.0 源码） | 自研缺它的后果 |
|---|---|---|---|
| 1 | **MIME**：`URLConnection.guessContentTypeFromName` 不认 `.js/.mjs`，`.wasm` 同理 | `getMimeType()` 显式特判 `.js/.mjs → application/javascript`、`.wasm → application/wasm`，否则按文件名/流嗅探 | Vite 产物是 `<script type="module">`，MIME 错 = WebView 拒执行，白屏级故障 |
| 2 | **HTML5-mode SPA fallback** | `html5mode`（默认 true）：无扩展名路径回退 `basePath/index.html` | 26 条客户端路由直接 404 |
| 3 | **JSInjector 注入**：WebView < 119 不支持 `addDocumentStartJavaScript`，桥接引导 JS 要**改写 HTML 流**注入 | `jsInjector.getInjectedStream()` 挂在 index.html 响应上 | 本仓 WebView 基线 ≥85（AGENTS.md），大量用户走这条路径 → **桥接初始化失败，全部原生插件失效**（这是最隐蔽也最致命的一个） |
| 4 | **Range 请求**（206/Content-Range） | `handleLocalRequest` 处理 Range 头 + `LollipopLazyInputStream` | 音视频/断点场景异常（Pictelio 静态资产用不到，但要做对不便宜） |
| 5 | **缓存头与线程安全** | 强制 `Cache-Control: no-cache`；`uriMatcher` 全程 `synchronized` | 跨版本资源串味 / 并发拦截竞态（主 app 已吃过并发双写的亏） |

结论：**自研全站代理 = 用更差的实现重写 Capacitor 核心组件**，且第 3 项（JSInjector）决定它必须随 Capacitor 版本联动维护——与「全站代理」的初衷（自主可控）相悖。

### B.3 但拦截模式对 OTA 的正确用法：共存而非接管

- 采用 capgo/`hostFiles` 路线时，App 静态资产仍由 Capacitor 本地服务器服务，`/pixiv-img/` 拦截**原样保留**：MainActivity 的包装 client 先判 `/pixiv-img/`、再委托原始 client（→ 本地服务器）。两条链路互不感知、零冲突（capgo 不触碰 WebViewClient，包装在每次 `onStart()` 重建）。
- 若自研 OTA（不用 capgo），切目录也**不必**自研拦截：直接 Java 调 `bridge.getLocalServer().hostFiles(path)` + `loadUrl`（capgo 同款），或 JS 调内置 `WebView` 插件（§C）——Q2 的答案因此是「模式已被证明可行，但用它服务静态资产这件事本身不需要自研」。

---

## C. Q3：Capacitor 8 官方对运行时切换 webDir / 多目录的支持面

### C.1 官方原语（8.5.0 源码实抓，全部默认可用）

| 层 | API | 语义 |
|---|---|---|
| Java | `Bridge.setServerBasePath(String)` | `localServer.hostFiles(path)` + `loadUrl(appUrl)`；**要求绝对文件路径**（`AndroidProtocolHandler.openFile`） |
| Java | `Bridge.setServerAssetPath(String)` / `getServerBasePath()` | assets 侧对称 API |
| Java | `Bridge.getLocalServer()` → `WebViewLocalServer.hostFiles/hostAssets` | 不带自动 reload 的裸原语（capgo 用的就是它，自己控制 loadUrl 时机） |
| JS | 内置 `WebView` 插件（`com.getcapacitor.plugin.WebView`，`registerAllPlugins()` 默认注册） | `setServerBasePath({path})` / `getServerBasePath()` / `persistServerBasePath()` |
| 持久化 | `CapWebViewSettings` prefs 的 `serverBasePath` 键 | 启动时 `loadWebView()` 读取，存在且 `new File(path).exists()` 则恢复；`DisableDeploy`（默认 false）可关闭；`isNewBinary()` 检测 APK versionCode/versionName 变化自动清指针回内置 |
| 配置 | `server.appStartPath`（@since 7.3.0，官方文档有） | 仅给 appUrl 追加起始**路径**（深链用），不换目录；`Bridge.Builder.setServerPath(ServerPath)` 存在但默认装配不接 config——不是 webDir 切换入口 |

### C.2 官方口径与文档现状

- **issue #1228「Switch between multiple app bundles?」**（官方成员 jcesarmobile 答复，实抓）：「You can do it with the webview plugin methods, **setServerBasePath, persistServerBasePath**, that will tell the app which folder contains the files it should use… **It has to be done with those methods**, most Cordova plugins will just redirect to a file path and that's not supported nor will be.」——官方明确：这就是正道，且仅此一条。
- **文档缺口**：capacitorjs.com/docs/config 实抓无 `serverPath`/`DisableDeploy`/`setServerBasePath` 任何条目（`webDir` 仅描述为构建期设置；`server.url` 照旧标注 "not intended for use in production"）。#1228 评论原话「didn't find much documentation on it… should I go read the code?」——**官方原语、官方背书、零文档**，与 mpa 报告 §C 对 server.url「无契约」的批评不同：这里是「行为有源码契约、无文档承诺」，属于要自己锁测试的灰区。
- **历史 bug**：#4598（2021，Capacitor 2.x 时代）——`setServerBasePath({path:'public'})` 传**相对路径**报 `FileNotFoundException`。教训仍有效：必须传绝对路径（capgo 存的指针就是 `File.getPath()` 绝对值）。
- **官方没有的**：多版本目录管理、下载校验解压、set/next 语义、notifyAppReady 回滚、失败清理、channel 分发、delta 更新——全部留给生态（capgo 是其中最活跃者，Ionic AppFlow 已停售，见 mpa 报告 §D.2）。

---

## D. 推荐（按 issue 产出要求）

### D.1 推荐机制

**采用 `@capgo/capacitor-updater` 8.5x，手动模式接入**：

```
ADR-0089 update-check（现有 version.json 检查，扩展为 web bundle 版本）
  → GitHub Releases 下载 web zip（现 release.mjs 通道加一个资产，或直链对象存储）
  → CapacitorUpdater.download({url, version, checksum})   // SHA-256 校验 + 版本目录安装，失败自动清理
  → CapacitorUpdater.set({id})                             // 指针原子切换 + 整页重载
  → main.tsx 启动编排末尾（首屏就绪后）CapacitorUpdater.notifyAppReady()  // 超时自动回滚
  → L2 APK 整包更新（updateService + release.mjs）原样保留；原生协议变更时 bundle 拒装（capgo resetWhenUpdate 已兜底 APK 升级场景）
```

理由：切换原语与 Capacitor 8.5.0 官方 `hostFiles` 同源（§A.1）；原子性/回滚/清理是全套现成工程（§A.2）；零后端起步、后续可平滑升级为 auto-update + 自托管端点（契约形状已提取，§A.3）；活跃度/License 兼容（§A.5）；origin 与桥接零变化，mpa 报告 §C 的全部否决理由不适用。

### D.2 落地注意清单（写进后续 ticket 的素材）

1. `notifyAppReady()` 调用点放启动编排**最末**（骨架屏→首屏数据挂载→ready），避免过早调用使回滚失效；超时配置用默认 10s 起步。
2. bundle schema 迁移：settings registry 值需带版本号迁移；`resetWhenUpdate` 保持默认 true。
3. `keepUrlPath` 开启以保留 26 条路由的重载深链语义。
4. MainActivity 的 `/pixiv-img/` 拦截保持现状（已验证与本地服务器共存）；切目录不引入任何新的自研 shouldInterceptRequest。
5. 契约测试：zip 资产结构（`index.html` 必须在 zip 根或可 flatten）、checksum 字段、version.json ↔ bundle 版本对应关系——按本仓「契约测试必须使用真实样例」硬约束落。
6. 若未来切 auto-update 自托管端点：请求/响应形状按 §A.3 提取的字段写契约测试锁住（真实样例 = capgo 源码常量提取模式，参照 `backupRulesConsistency.test.ts` 先例）。
7. 评估期可先做 spike：`@capgo/capacitor-updater` 装进主 app debug 构建，手造一个坏 bundle（JS 抛错）验证 10s 回滚链路 + 一个好 bundle 验证切换/深链保留——E2E 走 agent-browser（参考 §测试硬约束 5：依赖外部状态的路径用 mock 构造）。

### D.3 备选（若不想引入依赖）

自研最小闭环 = 复刻 capgo 核心五件套（版本目录 + 指针 prefs + `bridge.getLocalServer().hostFiles()` + `loadUrl` + ready 超时回滚），跳过下载器/加密/统计/channel。估计为 capgo 手动模式 2-3 倍的工程量换零依赖，且要自己养 JSInjector 兼容、清理队列等长尾——mpa 报告 §E 建议「先 spike 自研最小闭环再评估引入 capgo」，本报告源码核实后结论反转：**capgo 的核心增量恰好全是难啃的部分，直接采用手动模式更省**。

---

## 附：引用来源

| 论断 | 来源（抓取日期 2026-08-29） |
|---|---|
| capgo 切换 = `bridge.getLocalServer().hostFiles(path)` + `loadUrl(appUrl)` + `clearHistory()`；兜底 `setServerBasePath`；`keepUrlPathAfterReload` 保留路由 | `Cap-go/capacitor-updater` main 分支 `android/src/main/java/ee/forgr/capacitor_updater/CapacitorUpdaterPlugin.java` `applyCurrentBundleToBridge()`（GitHub contents API 下载实读） |
| `hostFiles()` 实现（isAsset=false + basePath + createHostingDetails → `openFile(basePath+path)`）；PathHandler 强制 `Cache-Control: no-cache`；Range/206；html5mode SPA fallback；MIME 特判 `.js/.mjs/.wasm`；JSInjector 注入条件（`addDocumentStartJavaScript` 失败/不支持时改流）；handler 绑定粒度 | `ionic-team/capacitor` tag `8.5.0` `android/capacitor/src/main/java/com/getcapacitor/WebViewLocalServer.java`（773 行全文实读） |
| `Bridge.loadWebView()` 启动恢复 `CapWebViewSettings/serverBasePath`（`DisableDeploy` gate + `new File(path).exists()`）；`isNewBinary()` APK 版本变更清指针；`setServerBasePath/setServerAssetPath/getServerBasePath` Java API；`registerAllPlugins()` 默认注册 `com.getcapacitor.plugin.WebView`；`server.appStartPath` 仅追加起始路径；UriMatcher `addURI` 覆盖语义 | `ionic-team/capacitor` tag `8.5.0` `Bridge.java`、`plugin/WebView.java`、`CapConfig.java`、`UriMatcher.java`（GitHub contents API 实读） |
| 内置 WebView 插件 JS 方法面：`setServerBasePath`/`getServerBasePath`/`persistServerBasePath` | `ionic-team/capacitor` tag `8.5.0` `android/.../plugin/WebView.java`（48 行全文实读） |
| 官方背书：多 bundle 切换「must be done with」WebView 插件方法；无官方文档需读源码 | `ionic-team/capacitor` issue #1228（gh CLI 实抓，jcesarmobile 答复） |
| `setServerBasePath` 必须绝对路径（相对路径 FileNotFound 历史 bug） | `ionic-team/capacitor` issue #4598（gh CLI 实抓，Capacitor 2.4.7 时代） |
| capgo 版本目录 `filesDir/versions/<id>` + index.html 存在性校验；指针 `CAP_SERVER_PATH` `commit()`；`pastVersion`/`nextVersion` 双指针；zip→校验→临时目录→flatten；孤儿清理；删除节流 75ms 且不触当前/fallback | `CapacitorUpdaterPlugin.java` / `CapgoUpdater.java`（`bundleDirectory="versions"`、`getBundleDirectory`、`bundleExists`、`setCurrentBundle`、`finishDownload`、`enqueuePendingDelete` 等逐段实读） |
| 回滚：`appReadyTimeout` 默认 10000ms（最小 1s）；`checkRevert` → `performReset(toLastSuccessful=true)` → fallback → "Resetting to native"；`autoDeleteFailed` 默认 true；`resetWhenUpdate` 默认 true（APK 升级清 OTA）；reload 失败 `restoreResetState` + `restoreLiveBundleStateAfterFailedReload` | `CapacitorUpdaterPlugin.java`（行 160/876/5141-5186/4263-4328）、`CapgoUpdater.java`（`captureResetState`/`restoreResetState`）实读 |
| 自托管：`updateUrl`/`statsUrl`/`channelUrl` 可配（默认 plugin.capgo.app 三端点，stats 可置空关闭）；update 请求体字段（platform/device_id/app_id/custom_id/version_*/plugin_version/is_emulator/is_prod/install_source/defaultChannel/key_id）；响应 JSON 透传（session_key→sessionKey）；429 Retry-After（≤24h）；CLI `localS3/localHost/localWebHost/localSupa`；README「Self-host or use Capgo Cloud」「Open Source Backend: github.com/Cap-go/capgo」 | `CapacitorUpdaterPlugin.java` 行 98-100/865、`CapgoUpdater.java` `createInfoObject`/`makeJsonRequest`/`getLatest`；`Cap-go/capacitor-updater` README.md（gh contents API 实抓） |
| 手动 API 面与任意 URL 下载（checksum 可选） | `CapgoUpdater.java` `download(url, version, sessionKey, checksum)`、`finishDownload`（publicKey 空时 checksum 可缺省）实读 |
| 活跃度：npm latest 8.51.15 @ 2026-08-28、913 版本、首发 2022-04-16、peerDep `@capacitor/core ^8.0.0`、devDep capacitor 8.5.0、v4-v7 LTS dist-tags；GitHub 834 stars/156 forks/Java/未归档、近两周 3 个 release | npm registry `@capacitor-updater` metadata + GitHub API（gh CLI 实抓） |
| License MPL-2.0（文件级 copyleft 口径为通行解释，非官方法律意见） | GitHub API repo licenseInfo `mpl-2.0`；MPL-2.0 文本（插件源文件头 `mozilla.org/MPL/2.0/` 实抓） |
| 官方 config 文档无 `serverPath`/`DisableDeploy`/`setServerBasePath` 条目；`server.url` 仍标注 "not intended for use in production"；`server.appStartPath` @since 7.3.0 | https://capacitorjs.com/docs/config （WebFetch 实抓） |
| 仓内拦截先例：MainActivity 包装 WebViewClient、`/pixiv-img/` 命中走 PixivImageLoader、未命中委托原 client、并发拦截线程教训、弃用重载无请求头 | `packages/app/android/app/src/full/java/io/pictelio/app/MainActivity.java` 源码实读（含 openwiki/integrations/android-native.md 交叉印证） |
| app-nuxt v3 拦截实验「模式可行」为二手转述；原型报告未入库 | `docs/research/mpa-remote-githubpages-feasibility.md` 引用 + 本仓 git（`packages/app-nuxt` 无跟踪文件、`nuxt-service-worker-prototype.md` 不存在，git log 全史无记录） |
| 更新分层（L1 bundle OTA + L2 APK 整包）、最低版本声明、AppFlow 停售、远程壳否决理由 | `docs/research/mpa-remote-githubpages-feasibility.md` §C/§D（2026-08-29 实抓，本文不重复举证） |
| 「毫秒级窗口错位只影响个别子资源」「localStorage schema 漂移是唯一真实半新半旧」「notifyAppReady 过早调用使回滚失效」「自研最小闭环工程量倍数」 | **推测**（无公开来源，基于 §A/§B 源码事实与架构外推，落地前需 spike 实测） |

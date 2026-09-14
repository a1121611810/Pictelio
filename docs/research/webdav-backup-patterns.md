---
type: Research
title: WebDAV 备份/同步模式调研：非同类应用（笔记、密码管理、RSS、电子书、漫画、相册同步）如何做得好
status: 调研事实卡 · 供 WebDAV 备份功能设计引用
date: 2026-08
tags: [webdav, backup, sync, capacitor, android, research]
---

# WebDAV 备份模式调研

> 调研日期：2026-08
> 用途：支撑 Pictelio "WebDAV 备份"功能的设计决策（备份本地应用设置/状态）。
> 方法：关键论断尽量来自一手来源（官方文档、源码、官方 spec）；浏览器 CORS 约束部分引 MDN 与一线项目的 issue/commit。
> 调研问题：**与 Pictelio 不同类型的应用**（笔记、书签、密码、RSS、电子书、漫画、相册同步）如何把 WebDAV 备份/同步做好。

---

## 1. TL;DR（可执行结论）

1. **对"备份本地设置/状态"这个用例，业界主流且最省心的模式是「单文件快照 + 时间戳轮换 + 原子替换」，而不是双向增量同步。** Mihon（漫画）用 protobuf 序列化 + gzip 压缩成单个 `.proto.gz` 快照文件，自动备份按文件名排序只保留最近 N 份（[BackupCreator.kt](https://raw.githubusercontent.com/mihonapp/mihon/main/app/src/main/java/eu/kanade/tachiyomi/data/backup/create/BackupCreator.kt)）。备份场景几乎不需要解决"冲突合并"这个世界级难题。
2. **WebDAV 协议面只需要一个很小的子集：MKCOL（幂等建目录）+ PUT + GET + PROPFIND（Depth: 0/1）+ DELETE，外加可选的 If-Match/ETag。** 所有被调研应用的 WebDAV 实现都没有用 LOCK 方法（WebDAV 原生锁），而是用**锁文件**（Floccus 的 `bookmarks.xbel.lock`，2 分钟续约、15 分钟超时强制接管）来防并发写（[WebDav.ts](https://raw.githubusercontent.com/floccusaddon/floccus/develop/src/lib/adapters/WebDav.ts)）。
3. **原子性靠「临时文件 + MOVE/重命名」或「临时文件 + 校验后覆盖」**：Floccus 先 PUT 到 `.temp`，校验远端文件大小与本地一致后才提交正式文件，失败重试 2 次（同文件）。
4. **CORS 是纯 Web 端无法绕过的一等约束**：PROPFIND/MKCOL/REPORT 等非简单方法 + `Authorization` 头必然触发 CORS 预检，而自托管 WebDAV 服务器绝大多数不发 CORS 头。Web 应用的对策只有三条：a) 服务器侧配置 `Access-Control-Allow-Origin`（Remotely Save 提供了 Apache/S3 配置示例，要求允许 `capacitor://localhost` 等 origin）；b) 宿主提供原生 HTTP 桥（Obsidian 的 `requestUrl` API 就是为绕 CORS 而生；super-productivity 把 PROPFIND/REPORT 路由到原生 OkHttp executor）；c) 反向代理同源转发。**Pictelio 是 Capacitor 应用，应走 b)——自定义原生插件，与现有 PixivApiPlugin 网关同构。**
5. **Capacitor 生态有一个已证实的坑：`@capacitor/core` 的 `CapacitorHttp` 对非 GET/HEAD/OPTIONS/TRACE 方法会退到 Java `HttpURLConnection`，对 PROPFIND/REPORT 直接抛 `ProtocolException`**（[super-productivity commit 280c2c1](https://github.com/super-productivity/super-productivity/commit/280c2c1c52b08ead291ab92562e60f349f09595c)）。**不要指望 CapacitorHttp 跑 WebDAV 动词；需要自建原生插件（OkHttp 接受任意 method 字符串）。** 注意 Floccus 用 `CapacitorHttp` 做 WebDAV 是因为它的移动端只用到 GET/PUT/DELETE 这一组标准动词。
6. **ETag 是把双刃剑**：KOReader 用 `If-Match: <ETag>` 做乐观并发控制，踩过"弱 ETag（`W/"..."`）永远不满足 If-Match 强比较导致 412 死循环"的坑（RFC 7232 §3.1），修复方式是去掉 `W/` 前缀并给重试加上限（5 次）（[koreader#15715](https://github.com/koreader/koreader/pull/15715)）。如果备份用「时间戳文件名 + 只写不覆盖」策略，可以完全避开 ETag。
7. **加密作为可选项**：Remotely Save 用 openssl/rclone crypt 格式在发送前加密（用户设密码才启用）；Floccus 支持 AES 加密 XBEL 内容。对"应用设置备份"，建议提供密码加密选项（设置里常含 token 类敏感信息——Pictelio 备份内容若含 imageHost 配置等，值得加密）。
8. **WebDAV 服务器实现差异是第一大错误来源**：Joplin 的驱动里有大量逐服务器的兼容注释（有的服务器不给 `getlastmodified`、有的返回非标准 multistatus），并内置 **请求重试 3 次**（[file-api-driver-webdav.js](https://raw.githubusercontent.com/laurent22/joplin/dev/packages/lib/file-api-driver-webdav.js)）。错误处理要按"401 认证失败 / 403/404 路径问题 / 507 配额 / 412 冲突 / 网络中断"分类映射为用户可读文案，并在 PUT 后做读回校验。
9. **JS 客户端库首选 `webdav`（perry-mitchell），它明确"不为 RFC 严格性负责、只为好用负责"**，支持 Node 和浏览器（浏览器入口 `webdav/web`，无流式），提供目录列表/stat/配额等高层 API（[README](https://raw.githubusercontent.com/n-peugnet/webdav-client/refs/heads/master/README.md)）。`tsdav` 偏 CalDAV/CardDAV 场景。Android 端 Sardine（Apache HttpClient）稳定但偏老；dav4jvm 现基于 Ktor。
10. **UX 约定高度一致**：设置页里一个"备份"区块（服务器 URL/账号/密码/目录 + "立即备份"按钮 + "上次备份时间" + 自动备份开关/频率 + "恢复"入口）；恢复前必须有确认对话框（恢复会覆盖当前数据）；备份进行中显示进度；失败给出可操作的错误分类。Mihon 会记录 `lastAutoBackupTimestamp`；KOReader 静默同步 + 失败时提示。

---

## 2. 逐应用调研

### 2.1 Joplin（笔记，WebDAV 作为主要同步目标之一）

- **数据**：每条笔记/笔记本/标签/资源是独立对象（.md 文件 + 资源文件），不是单文件备份；SQLite 是本地缓存，**WebDAV 上就是对象文件树**。
- **架构**：通用的 `Synchronizer` + 可插拔 `FileApi` 驱动（`file-api-driver-webdav` 是其中之一），sync 状态存本地 `sync_items` 表（`sync_time` 决定增量），[官方 sync spec](https://joplinapp.org/help/dev/spec/sync/)。
- **WebDAV 用法**：`stat` = PROPFIND Depth 0 取 `getlastmodified` + `resourcetype`；`basicDelta` 列目录做增量；请求自动重试 3 次。
- **冲突**：笔记级冲突产生 `conflict notebook`（保留两份，不丢数据）；`info.json` 记录 sync target 全局状态（含 E2EE 开关、主密钥），同属性并发修改按 `updatedTime` 启发式取舍。
- **E2EE**：内容用主密钥加密后上传，加密状态记录在 sync target 的 `info.json`。
- **可借鉴**：驱动层与应用层分离（FileApi 抽象）、逐服务器兼容注释、重试。Joplin Server 另有 delta sync spec（changes API），但**那是私有协议，WebDAV 目标用不上**——WebDAV 只能"列目录 diff"。

### 2.2 Obsidian "Remotely Save" 插件（笔记文件夹同步）

- **数据**：直接同步 vault 文件树（单文件 ↔ 单文件），支持 WebDAV/S3/Dropbox/OneDrive 等。
- **算法**：v3 同步算法文档公开——冲突策略已实现"保留较新 / 保留较大"，删除用"真删除状态计算"，支持增量 push-only / pull-only 单向模式（[sync_algorithm/v3](https://raw.githubusercontent.com/AbysmalBiscuit/remotely-save/master/docs/sync_algorithm/v3/intro.md)）。
- **加密**：用户设密码后，文件以 openssl/rclone crypt 格式加密再上传（[README](https://raw.githubusercontent.com/AbysmalBiscuit/remotely-save/master/README.md)）。
- **浏览器环境限制文档**（对 Pictelio 直接相关，[browser_env.md](https://raw.githubusercontent.com/AbysmalBiscuit/remotely-save/master/docs/browser_env.md) + [browser_env_cors.md](https://raw.githubusercontent.com/AbysmalBiscuit/remotely-save/master/docs/browser_env_cors.md)）：
  1. **CORS**：Obsidian 0.13.25+ 提供 `requestUrl` API 让插件完全绕过 CORS（桌面+移动）；旧版本必须服务器侧返回 `Access-Control-Allow-Origin` 且允许 `app://obsidian.md`、`capacitor://localhost`、`http://localhost` 三个 origin。
  2. **无 Node.js 环境**（Capacitor/Electron 的 JS 环境限制）。
  3. **关闭后不后台运行**——定时同步只在应用打开时生效。
- **可借鉴**：CORS 的"宿主原生桥"解法（= Pictelio 应采用的方案）；"不后台运行"这一限制同样适用于 Pictelio（WebView 被挂起）。

### 2.3 Floccus（浏览器书签同步 → WebDAV 单文件）

- **数据**：单个 `bookmarks.xbel`（XBEL 1.0 XML，DTD 标准格式）或 HTML 文件；双向 sync 算法（diff 合并树），支持单向模式、定时同步、多 profile。
- **并发控制**：**锁文件协议**而非 WebDAV LOCK——`bookmarks.xbel.lock`：sync 前检查锁，锁内时间戳未超 15 分钟则报 `ResourceLockedError`，否则强制接管；sync 期间每 2 分钟续约；解锁 DELETE 最多重试 10 次直到 200/204/404（[WebDav.ts](https://raw.githubusercontent.com/floccusaddon/floccus/develop/src/lib/adapters/WebDav.ts)）。
- **原子写入**：先 PUT `.temp` 文件 → `getFileSize` 校验远端大小 == 本地字节数 → 才提交正式文件；大小不符抛 `FileSizeMismatch` 重试（`PUT_FILE_SIZE_RETRIES = 2`）。
- **变更检测**：上传前对整树做 hash 与初始 hash 比较，无变化不写。
- **传输层**：Web 用 fetch，Capacitor 原生端用 `CapacitorHttp`（只用标准动词）。
- **加密**：可选 AES（passphrase → ciphertext + salt 的 JSON）。
- **可借鉴**：锁文件协议、temp+校验+提交、整树 hash 避免无谓写入——这四件套对"单文件备份"几乎可以直接照搬。

### 2.4 KOReader（电子书阅读器 → WebDAV 云同步）

- **数据**：设备间同步整份设置/书库数据库文件（如 settings/统计），Lua + LuaSocket http。
- **并发控制**：PUT 带 `If-Match: <ETag>`，412 时重取 ETag 重试。
- **著名坑（必看）**：弱 ETag（nginx gzip/Cloudflare/Traefik 压缩会返回 `W/"..."`）按 RFC 7232 §3.1 永远通不过 If-Match 强比较 → 无限 412 循环卡死 app。修复：strip `W/` 前缀 + 重试上限 5 次（[koreader#15715 patch](https://github.com/koreader/koreader/pull/15715)）。
- **可借鉴**：If-Match 用不好不如不用；用时间戳文件名天然免冲突。若用 ETag，必须先处理 weak validator。

### 2.5 Mihon / Tachiyomi（漫画阅读器 → 备份，最贴近"应用状态备份"）

- **数据**：收藏漫画 + 分类 + 阅读历史 + 应用偏好 + 图源偏好，**单文件快照**。
- **格式**：kotlinx.serialization protobuf → **gzip 压缩**（`.proto.gz`）；写完立即用 `BackupFileValidator` 读回验证（[BackupCreator.kt](https://raw.githubusercontent.com/mihonapp/mihon/main/app/src/main/java/eu/kanade/tachiyomi/data/backup/create/BackupCreator.kt)）。
- **轮换**：自动备份时按 `FILENAME_REGEX` 列目录，文件名倒序，删掉超过 `MAX_AUTO_BACKUPS` 的旧文件。
- **恢复**：选择备份文件 → 解析 proto → 逐项合并/覆盖，恢复前确认。
- **可借鉴**：protobuf 可换成 JSON（可读性/可移植性更好，备份文件小，JSON 完全够）；**"写后读回验证 + 自动轮换 N 份 + 记录 lastBackupTimestamp"**是备份功能的标准动作。

### 2.6 KeePass2Android（密码库 → WebDAV/HTTP）

- **数据**：单个 `.kdbx` 密码数据库文件，"打开即同步"——把远端文件当文件系统上的文件读写。
- **栈**：Java 侧 OkHttp（其 issue tracker 显示 HTTP/2 与 nginx `:status` 头兼容问题依赖 OkHttp 升级解决，[#747](https://github.com/PhilippC/keepass2android/issues/747)、[#44](https://github.com/PhilippC/keepass2android/issues/44)）。
- **冲突**：保存时若远端被改，弹出"合并/覆盖/另存"选择（KeePass 格式自带合并能力）。
- **可借鉴**：OkHttp 作为 Android WebDAV 客户端完全够用；密码学强度加密由文件格式本身承担（kdbx 自带 AES）。Pictelio 若加密备份文件，可选择"文件级加密"而非协议级。

### 2.7 FolderSync / PhotoSync（文件/相册同步）

- **FolderSync**（[官网](https://www.tacit.dk/foldersync/)）：通用文件同步器，支持 WebDAV 在内的 30+ 协议；支持双向/单向、定时计划、即时同步（文件观察器）；把 WebDAV 当远端文件系统，PROPFIND 列目录 + 本地数据库记录每个文件的 etag/mtime/size 做 delta。
- **PhotoSync**（[Play 商店](https://play.google.com/store/apps/details?id=com.touchbyte.photosync)）：相册 → WebDAV/NAS/SMB…；选择相册/日期范围 → 传输队列 → 进度条 + 逐文件成功/失败标记 + 自动转码/去重选项。
- **可借鉴**：相册场景才需要"队列 + 逐文件进度 + 断点续传"；**应用设置备份单文件场景不需要这么重**。

### 2.8 Nextcloud Android app & DAVx5 生态

- Nextcloud 官方 Android 客户端走自家 OCS/WebDAV 混合 API；DAV 领域 Android 端事实标准是 **dav4jvm**（[bitfireAT/dav4jvm](https://raw.githubusercontent.com/bitfireAT/dav4jvm/master/README.md)）：WebDAV/CalDAV/CardDAV，**Ktor HTTP 客户端**（早期 OkHttp），PROPFIND 返回 Kotlin Flow，MPL-2.0；用户包括 DAVx5、Seedvault。
- **可借鉴**：若 Pictelio 未来在原生侧（Java）需要完整 WebDAV 客户端，dav4jvm 是首选；但"备份单文件"场景用 OkHttp 裸写 MKCOL/PUT/PROPFIND 也就 200 行。

### 2.9 RSS 读者的 WebDAV 支持

- **Agr Reader**（Android，Material You RSS 阅读器）明确支持 **"WebDAV Sync: securely back up and restore your subscriptions"**（[README](https://raw.githubusercontent.com/Agr-Reader/Agr-Reader/main/README.md)）——印证"RSS 订阅列表 = 轻量数据 → 单文件备份到 WebDAV"是被接受的模式。
- 多数 RSS 读者（FeedMe 等）走 Fever/Google Reader API 与 FreshRSS/Miniflux 等服务端同步，WebDAV 备份是本地优先应用的补充选项。

---

## 3. 技术事实

### 3.1 浏览器 CORS 约束（为什么纯 Web 端做不了自托管 WebDAV）

- PROPFIND/MKCOL/REPORT/MOVE 等非简单方法、以及任何带 `Authorization` 头的请求都会触发 **CORS 预检（OPTIONS preflight）**；自托管 WebDAV 服务器（nginx/apache 模块、Nextcloud 默认、群晖、坚果云）通常**不返回** `Access-Control-Allow-Origin`，浏览器直接拦截，客户端无解。基础概念见 [MDN Preflight request](https://developer.mozilla.org/en-US/docs/Glossary/Preflight_request)。
- 一线项目佐证：
  - super-productivity 明确记录："WebDAV sync and calendar integration are likely to fail in the browser due to CORS. The desktop and mobile apps issue these requests through a native HTTP layer and are not subject to browser CORS; the web app cannot."（[commit 280c2c1 中的 wiki 文档](https://github.com/super-productivity/super-productivity/commit/280c2c1c52b08ead291ab92562e60f349f09595c)）
  - copyparty issue "http403: rejected by cors-check"（[#838](https://github.com/9001/copyparty/issues/838)）展示真实用户踩坑现场。
- Web 应用的三种 cope 方式：
  1. **服务器侧开 CORS**（允许 `Access-Control-Allow-Origin` + 方法/头白名单）——Remotely Save 维护 Apache/S3/Nginx 配置示例，且要求允许 `capacitor://localhost` origin。
  2. **宿主原生桥**——Obsidian `requestUrl`；Capacitor 自定义插件；Electron net 模块。**Pictelio 的对策。**
  3. **同源反向代理**——用户自建 proxy（门槛高，不建议作为主路径）。

### 3.2 JS WebDAV 客户端库

| 库 | 场景 | 状态/特点 |
|---|---|---|
| [webdav](https://www.npmjs.com/package/webdav)（perry-mitchell） | Node + 浏览器通用 WebDAV | 活跃；高层 API（readdir/stat/配额/锁探测），浏览器入口 `webdav/web`（无流式）；README 明说"不为严格遵循 RFC，只为好用" |
| [tsdav](https://github.com/natelindev/tsDAV) | CalDAV/CardDAV/WebDAV | 活跃；内置 OAuth2/basic/Bearer；JSON API；偏日历/联系人 |
| 裸 fetch/XHR | 只需 PUT/GET/DELETE 时 | 在 Capacitor WebView 内走原生插件后可完全自控 |

### 3.3 Android 原生

- **Sardine**（[lookfirst/sardine](https://github.com/lookfirst/sardine)）：经典 Java WebDAV 库，Apache HttpClient + JAXB 解析 multistatus；"fully stable, used in production on a very high traffic site"；API 简洁（`list/put/get/delete/move`），但栈偏老（HttpClient）。
- **dav4jvm**（[bitfireAT/dav4jvm](https://github.com/bitfireAT/dav4jvm)）：DAVx5 出品，MPL-2.0；现基于 Ktor client；PROPFIND → Flow；Android 首选现代方案。
- **OkHttp 裸写**：OkHttp `Request.Builder().method("PROPFIND", null)` 接受任意方法字符串，配合 SimpleXML 或手写 multistatus 解析即可；KeePass2Android 与 super-productivity 的 WebDavHttp 插件都是这条路。**与 Pictelio 现有 PixivApiPlugin（Java 侧 OkHttp 网关）同构，推荐。**

### 3.4 Capacitor 生态的关键坑

- `@capacitor/core` 的 `CapacitorHttp`（[官方文档](https://capacitorjs.com/docs/apis/http)）默认 patch fetch/XHR 关；显式 `CapacitorHttp.request({method})` 支持任意 method 字符串，但 Android 实现**对非 GET/HEAD/OPTIONS/TRACE 方法退到 Java `HttpURLConnection`，它对 PROPFIND/REPORT 等动词抛 `ProtocolException`**（super-productivity [#8558](https://github.com/super-productivity/super-productivity/commit/280c2c1c52b08ead291ab92562e60f349f09595c) 的根因）。
- 结论：**Pictelio 若需要 PROPFIND/MKCOL，必须自建 Capacitor 插件（Java 侧 OkHttp），不能依赖 CapacitorHttp。** 若备份协议只用 PUT/GET/DELETE/MKCOL——注意 MKCOL 也是非标准动词，同样会炸——所以自建插件几乎不可避免。
- 原生 HTTP 插件天然绕过 CORS（不受 WebView 限制），顺带解决 3.1 的 web 端问题；Web 端（浏览器/PWA）功能降级为"仅当服务器配置好 CORS 时可用"或直接不支持。

---

## 4. WebDAV 协议特性在各应用中的实际使用矩阵

| 特性 | Joplin | Remotely Save | Floccus | KOReader | Mihon | KeePass2Android |
|---|---|---|---|---|---|---|
| MKCOL | ✓ | ✓ | ✓ | ✓ | —(本地文件) | ✓ |
| PROPFIND | ✓ Depth 0 列目录 | ✓ | ✓（取文件大小等） | ✓ | — | ✓ |
| ETag / If-Match | 冲突启发式 | — | 树 hash 代替 | ✓（踩 weak ETag 坑） | — | kdbx 合并 |
| LOCK 方法 | — | — | —（用锁文件） | — | — | — |
| 锁文件 | — | — | ✓ .lock 2min/15min | — | — | — |
| 临时文件+校验 | — | — | ✓ .temp+size 校验 | — | 写后读回验证 | — |
| 版本轮换 | — | — | — | — | ✓ N 份 | — |
| 加密 | ✓ E2EE | ✓ openssl/rclone | ✓ AES | — | — | kdbx 自带 |
| 增量 | ✓ sync_time 表 | ✓ mtime 对比 | 整树 hash | 整文件 | 全量快照 | 整文件 |

**观察**：没有一家用 WebDAV LOCK 方法；ETag 用得最少的恰恰是最稳的（单文件快照）。

---

## 5. 对 Pictelio "设置/状态备份"的落地建议（Top recommendations）

1. **格式：单个版本化 JSON 快照**（`pictelio-backup-<ISO8601>.json`，内含 `version` 字段 + app version + 时间戳 + 数据体）。可读、可调试、跨端可恢复；数据量小不需要 protobuf/gzip（要压也可压成 `.json.gz`）。参考 Mihon 快照 + Agr Reader 订阅备份。
2. **传输：自建 Capacitor 插件（Java 侧 OkHttp，仿 PixivApiPlugin 网关）**，实现最小动词集 `MKCOL / PUT / GET / PROPFIND(Depth 0/1) / DELETE`；Web 端走同一接口、底层降级为 fetch（仅 CORS 友好的服务器可用）。**不要走 CapacitorHttp。**
3. **目录协议**：远端固定目录（如 `/Pictelio/`），首次 PUT 前幂等 MKCOL（409 Already Exists 视为成功）；PROPFIND Depth 1 列出已有备份做轮换。
4. **写入协议**：PUT 到 `pictelio-backup-<ts>.json`（新文件名，天然无冲突）；PUT 后 PROPFIND Depth 0 读回 `getcontentlength` 校验（Floccus 模式）。再维护一个 `latest.json` 指针文件，恢复时先读指针。
5. **轮换**：保留最近 N 份（默认 5，可配），按文件名时间戳排序删旧（Mihon 模式）。
6. **冲突**：备份场景定义为先到者胜（新备份就是新文件）；恢复时若检测到"恢复的目标数据比备份更新"（本地 lastModified > 备份时间），弹确认框（参考 KeePass2Android 的合并/覆盖选择，但简化为确认覆盖）。
7. **加密（可选但推荐）**：密码派生 key（PBKDF2/WebCrypto AES-GCM）加密 JSON 后再 PUT；加密状态与轮换文件名兼容（扩展名不变）。
8. **触发**：手动"立即备份" + 可选"自动备份"（每周/每次启动时若距上次超过 N 天）。注意 WebView 不保证后台运行（Remotely Save 同款限制），自动备份只能挂在应用生命周期内。
9. **UX**：设置页一个区块（服务器/账号/密码/目录/自动备份频率/上次备份时间/立即备份/恢复）；备份中进度（步骤条：连接→上传→校验）；失败按错误分类给文案（认证失败/路径不存在/配额不足/网络错误/服务器不支持）；恢复前二次确认 + 恢复后重启提示。
10. **错误处理**：401 → 提示检查账号密码；404 → 提示检查目录路径；507 → 配额；412/423 → 服务器锁冲突稍后重试；网络层统一重试 3 次（Joplin 模式）+ 写后读回校验兜底。

---

## 6. 来源清单

- Joplin sync spec: <https://joplinapp.org/help/dev/spec/sync/>
- Joplin WebDAV driver 源码: <https://raw.githubusercontent.com/laurent22/joplin/dev/packages/lib/file-api-driver-webdav.js>
- Remotely Save README / sync algorithm / browser env docs: <https://raw.githubusercontent.com/AbysmalBiscuit/remotely-save/master/README.md>, <https://raw.githubusercontent.com/AbysmalBiscuit/remotely-save/master/docs/sync_algorithm/v3/intro.md>, <https://raw.githubusercontent.com/AbysmalBiscuit/remotely-save/master/docs/browser_env_cors.md>
- Floccus README / adapter API / WebDav adapter 源码: <https://raw.githubusercontent.com/floccusaddon/floccus/develop/README.md>, <https://raw.githubusercontent.com/floccusaddon/floccus/develop/doc/Adapters.md>, <https://raw.githubusercontent.com/floccusaddon/floccus/develop/src/lib/adapters/WebDav.ts>
- KOReader weak ETag 修复: <https://github.com/koreader/koreader/pull/15715>
- Mihon BackupCreator 源码: <https://raw.githubusercontent.com/mihonapp/mihon/main/app/src/main/java/eu/kanade/tachiyomi/data/backup/create/BackupCreator.kt>
- KeePass2Android issues: <https://github.com/PhilippC/keepass2android/issues/747>, <https://github.com/PhilippC/keepass2android/issues/44>
- FolderSync 官网: <https://www.tacit.dk/foldersync/>
- PhotoSync Play 商店: <https://play.google.com/store/apps/details?id=com.touchbyte.photosync>
- dav4jvm README: <https://raw.githubusercontent.com/bitfireAT/dav4jvm/master/README.md>
- Sardine README: <https://raw.githubusercontent.com/lookfirst/sardine/master/README.md>
- Agr Reader README: <https://raw.githubusercontent.com/Agr-Reader/Agr-Reader/main/README.md>
- super-productivity CapacitorHttp/WebDAV 修复: <https://github.com/super-productivity/super-productivity/commit/280c2c1c52b08ead291ab92562e60f349f09595c>
- webdav (npm) README: <https://raw.githubusercontent.com/n-peugnet/webdav-client/refs/heads/master/README.md>
- tsdav README: <https://raw.githubusercontent.com/natelindev/tsDAV/master/README.md>
- Capacitor Http 插件文档: <https://capacitorjs.com/docs/apis/http>
- MDN Preflight request: <https://developer.mozilla.org/en-US/docs/Glossary/Preflight_request>
- copyparty CORS issue（用户踩坑现场）: <https://github.com/9001/copyparty/issues/838>

# ADR-0156: WebDAV 备份架构（三层同构：Java 单一核心 + 双薄桥 + TS 共享纯函数层）

- 状态：accepted
- 日期：2026-09
- 关联：spec docs/specs/webdav-backup.md、wayfinder #455（地图）/ #456~#461（决策票）、docs/research/webdav-backup-patterns.md、ADR-0037（PixivApiPlugin 网关先例）、ADR-0103（跨引擎设置键契约）

## 背景

双端本地设置与列表数据（屏蔽/举报）只存在于设备上，换机/重装即丢失，无任何导出通道。目标：把备份域数据快照到用户自托管 WebDAV 服务器，支持恢复与版本旋转，app（webview）与 app-lynx 双端一致。

三个硬约束决定了架构形态：

1. **浏览器 CORS 无解**：自托管 WebDAV 服务器绝大多数不发 CORS 头，PROPFIND/MKCOL 等非简单方法 + `Authorization` 头必然预检失败。纯 Web 端无法直连任意 WebDAV 服务器。
2. **CapacitorHttp 不支持 WebDAV 动词**：`@capacitor/core` 的 `CapacitorHttp` 对非 GET/HEAD/OPTIONS/TRACE 方法在 Android 上退到 `HttpURLConnection`，对 PROPFIND/REPORT 直接抛 `ProtocolException`（super-productivity commit 280c2c1 实证）。
3. **双引擎桥接面不同**：webview 走 Capacitor 插件（`registerPlugin()`，已有 9 插件先例）；lynx 走 `LynxModule` + `@LynxMethod` + Callback（`PictelioPrefsModule` 先例，Callback 对 null 参数崩的真机坑）。

## 决策

**D1. 三层同构（backup transport layering）**：

1. **Java 单一核心 `WebDavClient`**：OkHttp 4.12.0（已在依赖）裸写 WebDAV 协议子集——MKCOL（幂等，409 视为成功）/ PUT / GET / PROPFIND Depth 0&1 / DELETE，约 200 行。双引擎共用同一份实现，协议行为单一事实源。
2. **双薄桥**：webview 新增 `WebDavPlugin`（Capacitor，`MainActivity.java` `registerPlugin()` 注册，照 PixivApiPlugin 模式）；lynx 新增 `PictelioWebDavModule`（LynxModule，Callback 契约对齐 PictelioPrefsModule）。薄桥只做参数/回调形态转换，不含协议逻辑。
3. **TS 共享纯函数层**：备份域收集（settings registry 枚举 + persisted sets）、快照序列化/解析、恢复计划（merge-by-keys + 账号级键按当前 uid 过滤）。延续 downloadManager「同源同语义差分对齐」约定，双端差分测试。

**D2. 快照模式（不做双向同步）**：单文件时间戳快照 + 固定保留最近 10 份轮换 + 写后读回校验（PUT → PROPFIND Depth 0 校验 `getcontentlength`，不等重试 ×3）。时间戳文件名天然免冲突 → v1 不加锁文件、不碰 ETag/If-Match（KOReader 弱 ETag 412 死循环坑）。

**D3. 加密 Java 侧实现**：`PICTELIO-ENC1` magic(8B) + salt(16B) + iv(12B) + AES-256-GCM；PBKDF2-HMAC-SHA256（600k 轮，OWASP 2023）从用户密码派生。理由：`SecureStorageCompat` 有 AES/GCM 先例；Lynx JS runtime 的 `crypto.subtle` 可用性不做假设；单一实现双引擎行为必然一致。TS 层只传明文字节 + 密码，不感知加密细节。

**D4. 凭据分级**：WebDAV 登录密码与备份加密密码存 `capacitor-secure-storage-plugin`（Android Keystore，与 refresh_token 同级）；连接配置（服务器/用户名/目录/自动备份开关）走跨引擎共享键 `settings_webdav_*`，进备份域——恢复后重输一次密码即闭环；**任何密码绝不进备份文件**。

**D5. 环境边界**：仅 Android 原生暴露入口；Web dev 端不渲染设置区块。

## 被考虑的方案

- **TS 全包 + 原生只透传字节**：JS 侧用 `webdav`(perry-mitchell) 库构造请求，原生只发字节。被否：协议逻辑随双端 JS runtime 漂移，违背差分对齐约定；且 lynx 的 fetch/XHR 面未验证。
- **CapacitorHttp + 服务器侧配 CORS**：零原生代码。被否：约束 2 的 ProtocolException 是已证实的坑；要求用户配服务器 CORS  unacceptable。
- **纯 Java 插件 + TS 只做 UI**：序列化/加密也在 Java。被否：备份域收集与恢复语义属应用层知识，下沉 Java 会割裂 settings registry 单一事实源，双端语义对齐靠人工。
- **Sardine/dav4jvm 库**：Sardine（Apache HttpClient）稳定但偏老、引入第二套 HTTP 栈；dav4jvm 基于 Ktor 同理。本场景协议子集约 200 行，OkHttp 裸写 + MockWebServer 单测性价比最高。
- **双向增量同步（Joplin 式）**：备份场景不需要解决冲突合并；调研报告结论 1 明确「单文件快照 + 轮换」是业界主流最省心模式。

## 后果

- Java 侧新增 `WebDavClient` / `BackupCrypto` / `WebDavPlugin` / `PictelioWebDavModule` 四个类；mockwebserver 4.12.0 已在 testImplementation，协议级单测可写。
- 自动备份只能挂应用生命周期（WebView 无后台执行）：启动时距上次备份超过 N 天触发。
- 新增跨端存储键 `settings_webdav_*`，需契约测试防键名漂移（照 `novelExportSettingsConsistency.test.ts` 模式）。
- 词汇入 `packages/app/CONTEXT.md`「WebDAV 备份」节（备份域 / 排除域 / 账号级键过滤恢复 / 备份传输三层 / 备份快照格式 v1 / 恢复语义 v1 / 连接配置进备份）。

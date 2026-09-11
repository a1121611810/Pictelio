# Spec: WebDAV 备份（双端：app webview + app-lynx）

- 状态：ready-for-implementation（2026-09；决策经 wayfinder 地图 #455 收敛，#456~#460 全闭）
- 日期：2026-09
- 关联：wayfinder #455（地图）/ research `docs/research/webdav-backup-patterns.md` / glossary（packages/app/CONTEXT.md「WebDAV 备份」节）/ ADR-0103（跨引擎设置键）/ ADR-0037（网关架构先例）
- 工单：docs/specs/webdav-backup-tickets.md

## 1. 背景与目标

双端本地设置与列表数据（屏蔽/举报）目前只存在于设备上，换机/重装即丢失，无任何导出通道（feature-gap 调研已记录）。本 spec 交付**WebDAV 备份**：把备份域数据快照到用户自托管的 WebDAV 服务器（Nextcloud / 坚果云等），支持恢复与版本旋转，双端一致。

1. **备份域**：全部设置类键（双端共享契约键 + app registry + 阅读器/主题/图片托管 + app-lynx 设备级）+ 屏蔽列表 + 举报记录。
2. **形态**：手动导出/导入为主 + 可选「启动时自动备份」开关；**不做双向同步**。
3. **环境**：仅 Android 原生暴露入口（浏览器 CORS 无法对任意 WebDAV 服务器发 PROPFIND/MKCOL；Web dev 端不显示入口）。
4. **加密**：一期即带可选密码加密（PBKDF2-HMAC-SHA256 600k + AES-256-GCM，Java 侧实现）。
5. **场景**：换机/重装迁移 与 日常版本归档并重 → 时间戳快照 + 固定保留最近 10 份。

## 2. 非目标（Out of Scope）

- **双向/增量同步、多设备冲突合并**（Joplin 级工程量，备份场景不需要）。
- **浏览历史 / 搜索历史 / 下载队列记录备份**（体积/隐私/时效性，二期或永久不做）。
- **任何凭证备份**（`refresh_token`、WebDAV 密码绝不进备份文件）。
- **Web 浏览器端 WebDAV**（CORS 无解；dev 预览不显示入口）。
- **WebDAV 之外的目标**（S3 / SMB / 本地文件导出）。
- **后台定时任务**（WebView 无后台执行；自动备份仅挂应用生命周期，启动时触发）。
- **备份内容加密之外的传输层安全**（依赖用户服务器 HTTPS；客户端强制/警告仅 HTTPS + Basic Auth）。

## 3. 领域模型

### 3.1 备份域（backup scope）与排除域

**进备份**：
- 双端共享契约键（SharedPreferences `CapacitorStorage` 同键）：账号级 `show_r18_${uid}` / `show_r18g_${uid}` / `ai_filter_mode_${uid}`；设备级 `settings_ugoira_mode` / `settings_ugoira_download_format` / `settings_detail_quality` / `settings_theme_color` / `settings_novel_export_*`（4 键）
- app 独有：settings registry 全部键、阅读器设置（readerSettingsStore）、主题亮暗（themeStore）、图片托管配置（imageHostStore）
- app-lynx 独有：设备级设置键（settingsStore 中 idbKV/SharedPreferences 设备级部分）
- 屏蔽列表（blockStore persisted set）、举报记录（reportStore persisted set）
- WebDAV 连接配置（服务器地址/用户名/目录/自动备份开关，跨引擎共享键 `settings_webdav_*`）——**密码除外**

**排除域**：凭证（refresh_token / WebDAV 密码）、浏览/搜索历史、下载队列记录、可重建缓存（小说/翻译/布局）、feed 内存态。

### 3.2 备份快照格式 v1

```json
{
  "format": "pictelio-backup",
  "schemaVersion": 1,
  "appVersion": "1.2.3",
  "engine": "webview",
  "createdAt": "2026-09-11T17:30:00+08:00",
  "excludedKeys": ["show_r18_12345"],
  "deviceKeys": { "settings_ugoira_mode": "fflate" },
  "accountKeys": { "show_r18g_12345": "true", "ai_filter_mode_12345": "show" },
  "sets": { "blocked_users": [], "report_records": [] }
}
```

引擎无关单文件；恢复端按自身已知键过滤（app/lynx 各自不认识的键跳过）。

### 3.3 加密封装 v1

`PICTELIO-ENC1` magic(13B，格式版本内嵌) + salt(16B) + iv(12B) + AES-256-GCM 密文；密钥 = PBKDF2-HMAC-SHA256（600k 轮，OWASP 2023）从用户密码派生。**Java 侧实现**（SecureStorageCompat 先例；Lynx runtime `crypto.subtle` 可用性不做假设）；TS 层只传明文快照字节 + 密码，不感知加密细节。解密失败（AEADBadTag）归类「密码错误或文件损坏」。

### 3.4 远程目录与命名

- 目录：`<用户配置根>/Pictelio/backup/`（连接配置「目录」项默认 `Pictelio/backup`）
- 文件名：`pictelio-backup-<yyyyMMdd-HHmmss>.json` / 同基名 `.json.enc`
- 时间戳命名天然免冲突 → **v1 不加锁文件**

## 4. 架构：备份传输三层（backup transport layering）

1. **Java 单一核心 `WebDavClient`**：OkHttp 4.12.0（已在依赖）裸写协议子集——MKCOL（幂等，409 视为成功）/ PUT / GET / PROPFIND Depth 0&1 / DELETE。约 200 行；mockwebserver 4.12.0 已在 testImplementation，可写协议级单测。
2. **双薄桥**：
   - webview：`WebDavPlugin`（Capacitor），`MainActivity.java` `registerPlugin()` 注册（照现有 9 插件模式）
   - lynx：`PictelioWebDavModule`（LynxModule + @LynxMethod + Callback），照 `PictelioPrefsModule` 契约（**Callback 对 null 参数崩**，成功/失败回调形态对齐既有注释）
3. **TS 共享纯函数层**：备份域收集（settings registry 枚举 + persisted sets 读取）、快照序列化/解析、恢复写回计划。延续 downloadManager「同源同语义差分对齐」约定（双端差分测试）。

## 5. 备份流程

1. 收集备份域 → 序列化为快照 JSON（按导出界面勾选的敏感项排除清单剔除 `excludedKeys`）
2. 若启用加密：TS 层把明文字节 + 密码交给 Java 加密封装
3. MKCOL 确保目录存在（409 视为成功）
4. PUT 上传
5. **写后校验**：PROPFIND Depth 0 取 `getcontentlength`，不等本地字节数则重试 ×3（`VERIFY_MAX_ATTEMPTS`，不可配）；仍失败 → 本次备份失败，旧档保留。服务器缺 `getcontentlength` 字段时（自托管差异，调研结论 8）降级为 GET 字节比对。服务器缺 `getcontentlength` 字段时（自托管差异，调研结论 8）降级为 GET 字节比对
6. 旋转：PROPFIND Depth 1 列目录，按文件名时间戳排序，DELETE 超额旧档（固定保留最近 10 份，不可配）；删除失败仅 warn 不阻塞
7. 记录「上次备份时间」到连接配置域

**错误分类映射**（用户可读文案）：401 认证失败（检查账号密码）/ 403 拒绝（检查目录权限）/ 404 路径不存在 / 507 配额不足 / 网络中断（重试 ×3 后报失败）/ 其他（含原始状态码）。

## 6. 恢复流程（恢复语义 v1）

1. 选档：PROPFIND Depth 1 列目录，时间倒序（加密档显示锁形标识）
2. 摘要确认：时间 / 来源引擎 / appVersion / deviceKeys·accountKeys·sets 数量 / 当前登录 uid 命中的账号级键数；加密档先输密码解密再出摘要
3. 二次确认执行
4. **pre-restore 应急快照**：先把当前全部设置键 + sets 存本地单 Preferences 键（保留到下次成功备份为止）
5. 写回（merge-by-keys）：备份中存在的键覆盖本地值；**备份中没有的键不触碰**（新版新增键保留本地值，不做全量重置）
6. 账号级键：仅应用与当前登录 uid 匹配者；未登录 → 全部跳过并在结果中说明
7. `excludedKeys` 中的键：不触碰本地对应键
8. 写回后热生效（settings registry hydrate）；结果反馈已写/跳过数量；提供「撤销上次恢复」（从 pre-restore 快照回滚）
9. 恢复不动远端任何档

**拒绝边界**：`schemaVersion` > 应用支持 → 拒绝「备份来自更新版本的应用，请升级后恢复」；格式字段不符 → 拒绝「不是有效的 Pictelio 备份」；写回中途失败 → 停止并报告已写/未写数量，可回滚。

## 7. 设置区块（双端各一）

**WebDAV** 区块（app：Fluent 设置页；app-lynx：M3 Me 页）：
- 开关（启用后才展开）：主开关
- 服务器地址（URL 输入，非 HTTPS 警告）、用户名、密码（secure storage，输入框不可逆显）、目录（默认 `Pictelio/backup`）
- 备份密码（可选加密，独立于登录密码）
- 敏感项排除勾选（R18/R18G/AI 过滤等账号级敏感键列表）
- 自动备份开关（启动时：距上次备份超过 N 天则执行；N 默认 7，可配 1/3/7/30）
- 上次备份时间（只读）/ 立即备份 / 恢复（选档入口）
- 连接测试按钮（MKCOL + PROPFIND 探活）

Web dev 端：不渲染本区块。

## 8. 凭据存储

- WebDAV 密码 → `capacitor-secure-storage-plugin`（与 refresh_token 同级，Android Keystore；键如 `webdav_password`）
- 连接配置 → 设置域共享键 `settings_webdav_*`（进备份域；恢复后重输一次密码即闭环）
- 备份密码（加密用）→ secure storage（键如 `webdav_backup_password`）；**两个密码都不进备份文件、不进普通 Preferences**

## 9. 测试要求（对齐仓库测试硬约束）

- **IO 边界双路径**：WebDavClient 每个动词 MockWebServer 成功/失败单测（409 MKCOL、401/507 映射、读回校验、旋转删除）
- **契约测试**：快照 schema 常量（magic/format 字段/键前缀）从源码提取比对，禁手写自洽 mock
- **差分测试**：TS 共享层 app/app-lynx 同语义（收集/序列化/恢复计划）
- **静默降级**：所有 `??` / catch 兜底打 `console.warn`（模块前缀）
- **E2E**：设置区块渲染/交互路径（agent-browser）；真实 WebDAV 链路用 MockWebServer 级单测兜底，不接外部服务

## 10. 参考决策来源

- wayfinder #456（调研）：docs/research/webdav-backup-patterns.md（Mihon 快照轮换 / Floccus 锁与原子写 / Joplin 重试与错误分类 / KOReader ETag 坑 / CapacitorHttp ProtocolException 坑）
- wayfinder #457（备份域）、#458（三层架构 + 凭据）、#459（格式 + 旋转）、#460（恢复语义）
- glossary：packages/app/CONTEXT.md「WebDAV 备份」节（备份域 / 排除域 / 账号级键过滤恢复 / 备份传输三层 / 备份快照格式 v1 / 恢复语义 v1 / 连接配置进备份）

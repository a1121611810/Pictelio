# Tickets: WebDAV 备份（spec: docs/specs/webdav-backup.md）

规则：每个 ticket 声明前置依赖；blocker 未完成不得开工。状态：`todo` / `doing` / `done`。

| # | 标题 | 依赖 | 交付物 | 验收 | 状态 |
|---|------|------|--------|------|------|
| T0 | ADR：WebDAV 备份架构决策 | — | `docs/adr/ADR-XXXX-webdav-backup-architecture.md` | 记录三层同构 / 原生插件绕 CORS+CapacitorHttp 坑 / 加密 Java 侧 / 快照模式选型的决策与权衡 | todo |
| T1 | Java WebDavClient 核心 | T0 | main `WebDavClient.java`（OkHttp：MKCOL/PUT/GET/PROPFIND Depth 0&1/DELETE）+ MockWebServer 单测 | 409 MKCOL 视为成功；401/403/404/507 错误分类映射；读回校验 + 重试 ×3；旋转删除；Java 单测绿 | done |
| T2 | Java 加密封装 | T0 | `BackupCrypto.java`（PICTELIO-ENC1 + PBKDF2-HMAC-SHA256 600k + AES-256-GCM）+ 单测 | 加解密往返；错误密码 AEADBadTag 归类「密码错误或文件损坏」；KDF 参数常量可测 | done |
| T3 | 双薄桥 + TS bridge seam | T1,T2 | webview `WebDavPlugin.java` + lynx `PictelioWebDavModule.java` + 两端 TS 桥接口（统一 `WebDavBridge` 类型） | MainActivity registerPlugin；LynxModule Callback 契约对齐 PictelioPrefsModule（null 参数坑）；两端桥可测 seam | done |
| T4 | TS 共享备份核心（双端同源） | T3 | app + app-lynx `utils/backupCore.ts`（收集/序列化/解析/恢复计划纯函数）+ 两侧单测 + 差分对齐 | 快照 schema v1 字段全；excludedKeys 剔除；恢复计划 merge-by-keys + uid 过滤；`test:app` `test:app-lynx` 绿 | done |
| T5 | 凭据与连接配置存储 | T0 | secure storage `webdav_password` / `webdav_backup_password`；`settings_webdav_*` 共享键注册（双端） | 密码不入普通 Preferences；连接配置跨引擎读写一致；单测 | done |
| T6 | app 设置区块 + 备份/恢复接线 | T3,T4,T5 | app Settings「WebDAV」区块（Fluent）+ 备份/恢复流程 UI | 摘要确认/二次确认/进度/错误分类文案/pre-restore 快照与撤销入口；组件单测 | done |
| T7 | app-lynx 设置区块 + 接线 | T3,T4,T5 | app-lynx Me 页「WebDAV」区块（M3）+ 同语义流程 | 同 T6 语义；web-core 显式不渲染；组件单测 | done |
| T8 | 启动时自动备份 | T6,T7 | 启动钩子（距上次备份超过 N 天触发，N∈{1,3,7,30} 默认 7） | 生命周期内触发；失败静默下次再试 + warn；单测 | done |
| T9 | pre-restore 快照与回滚 | T6,T7 | 本地应急快照（单 Preferences 键，保留到下次成功备份）+ 「撤销上次恢复」 | 恢复前必存；回滚完整；单测 | done |
| T10 | 契约测试 + E2E 收口 | T4,T6,T7,T8,T9 | 快照格式契约测试（magic/字段/键前缀从源码提取比对）；agent-browser spec | 契约测试绿；E2E 覆盖设置区块交互路径 | done |

## 关键路径

`T0 → T1 → T3 → T4 → {T6,T7} → {T8,T9} → T10`
`T2` 与 T1 并行（仅 T3 依赖）；`T5` 与 T1/T2 并行；T8/T9 互相独立、均挂在 T6/T7 之后。

## 备注

- T10 收口：契约测试（spec ↔ 代码格式契约、跨语言桥契约、双端同源差分）已绿；
  E2E 覆盖 Web 端边界（`webdav-backup-web-boundary.test.ts`：设置页不渲染区块，spec §2）。
  WebDAV 区块为原生专属入口，原生交互路径由组件测试覆盖，真机链路列入
  android-e2e 设备批次（repo 先例）。
- 审稿闭环记录：T1/T2（3 Major + 11 Minor/Nit）、T3（1 Blocker + 3 Major）、
  T5（1 Blocker + 1 Major）、T6（1 Blocker + 4 Major）均修复后通过。

- T1/T2 无 JS 框架依赖，先落地加锁语义（协议行为 + 加密格式），后续 ticket 复用。
- T4 遵循「同源同语义差分对齐」约定（downloadManager 先例），双端单测 + 差分。
- 每 ticket 完成后走 `code-review` → `tdd` 修复闭环（AGENTS.md 工作流硬约束）。
- 真实 WebDAV 链路不接外部服务：T1 MockWebServer 级单测兜底。
## 设备验证结论（2026-09-11，pictelio_ui / Android 14 / WebView 113）

- **webview 引擎（full flavor）**：`specs/webdav-backup.spec.ts` 通过——真实登录、UI 启用与配置、
  连接测试、立即备份、恢复（选档→摘要前置→确认）。服务器侧完整走过 MKCOL(409 幂等) → PUT →
  写后校验 PROPFIND → 旋转 PROPFIND → 恢复 GET；落盘快照 `engine=webview`、`appVersion=4.37.0`、
  含 `settings_webdav_url` 且无任何 password 键（§8 红线）。
- **lynx 引擎**：`specs/webdav-backup-lynx.spec.ts` 通过——经 `PictelioWebDavModule` 真实上传，
  落盘快照 `engine=lynx`、`appVersion=4.37.0`，`settings_webdav_last_backup` 回写真实
  SharedPreferences（完整回路）。两 spec 默认跳过（`WEBDAV_E2E_ENABLED=1` 才跑）。
- **真机发现并修复**：Lynx JS runtime 无 `TextEncoder`/`TextDecoder` → 快照序列化抛错，
  lynx 自动备份在调用原生桥之前即失败（node/jsdom 单测覆盖不到）；改用纯 JS UTF-8
  （`backupCore.utf8Encode/utf8Decode`，附字节序列对照测试）。

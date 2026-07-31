# ADR-0003: 备份安全 — 三层防护策略

`android:allowBackup="true"` 允许 `adb backup` 和云备份导出应用私有数据。refresh_token 经 `@aparajita/capacitor-secure-storage` 存入 Android Keystore 加密存储，备份时加密数据可能被导出。OEM 厂商可能忽略 `dataExtractionRules` 中的排除项。

## 决定

不粗暴关闭备份（保留非敏感数据恢复能力），用三层密码防线：

**层①** `res/xml/data_extraction_rules.xml` 排除 `WSSecureStorageSharedPreferences.xml` 与 `PictelioPrefs.xml`（Android 12+ 标准路径，cloud-backup 与 device-transfer 双段）
**层②** `res/xml/backup_rules.xml` 同步排除，由 `AndroidManifest` 的 `android:fullBackupContent` 引用（覆盖 Android 12 以下）
**层③** `secureStorage.ts` 的 `restoreRefreshToken()` 在启动恢复时执行完整性检查（`__pictelio_backup_marker`）：marker 读取异常（Keystore 密钥不可用）或 token 解密抛错（密钥失效重建后旧密文 GCM 认证失败）→ 清除 token 与 Native 内存 → 返回 null → 强制重新登录。由 `authStore.initializeAuth()` 接线调用。

## 实现核实（docs/research/android-token-storage.md，2026-07）

- `@aparajita/capacitor-secure-storage` 8.x 为**自研 AES/GCM + AndroidKeyStore 直连**实现（每 key 一个 AES-GCM 密钥，alias=带前缀的 key 名），**不依赖 androidx security-crypto（EncryptedSharedPreferences）**。密文落盘文件名：`WSSecureStorageSharedPreferences.xml`（`SecureStorage.java` 常量）。
- **Native 层不持久化 refresh_token**：`PixivApiPlugin.syncToken({ token })` 仅维护 Java 堆内存值（供 401 静默刷新），token 为 null 时清除内存与 `PictelioPrefs.xml` 历史明文残留（旧版本 `setRefreshToken` 曾明文写入，为已废弃路径）。
- 备份排除文件名必须与插件实际落盘文件名精确一致（官方语法不支持通配符），由 `tests/unit/utils/backupRulesConsistency.test.ts` 从插件源码提取常量强制校验，防止漂移。
- `initializeAuth()` 内 token 恢复序列（完整性检查 → 读取 → 旧 Preferences 一次性迁移 → Native 注入）收敛在 `restoreRefreshToken()` 一个接口内，任何存储异常统一处理为「清 token → 返回 null」。

## 额外的安全关注

- Android 7+ 上密钥材料由硬件 KeyStore（TEE/StrongBox）保护，备份导出后无法在另一设备解密；但 OEM 备份实现差异可能导致排除项被忽略，层③提供 defence-in-depth。
- refresh_token 仅允许存在于 Java 堆内存与 Keystore 加密存储，磁盘零明文（`PictelioPrefs.xml` 残留由 `syncToken` 幂等清理）。
- 已知边界：Java 401 静默刷新获得的新 refresh_token 仅更新 Java 内存，不同步 JS 加密存储（Pixiv 不轮换 refresh_token，与旧行为一致）。

## 考虑到但拒绝的选项

- **直接 `android:allowBackup="false"`**——用户在换机或重装后丢失所有数据（token、设置、收藏缓存、阅读进度），体验劣化过大。`backup_marker` 自检已提供等效安全性。
- **Native 层改用 Keystore 加密存储**——与 JS 侧 secure-storage 插件重复实现加密逻辑，且 `syncToken` 内存注入 + tokenReady barrier（ADR-0041）已保证 401 刷新时序，无需持久化。

## 影响

- 2 个备份 XML 文件：排除 `WSSecureStorageSharedPreferences.xml` + `PictelioPrefs.xml`
- `secureStorage.ts`：三接口深模块（restore/save/clear），启动自检开销约 1ms（单次 Keystore 读）
- `PixivApiPlugin.java`：`setRefreshToken` → `syncToken`，删除写盘路径
- AndroidManifest 改动 2 行：`android:dataExtractionRules`、`android:fullBackupContent`
- 配置一致性测试：`tests/unit/utils/backupRulesConsistency.test.ts`

# Android 应用中 token（access_token / refresh_token）的主流存储方式

> 调研日期：2026-07（第一轮）→ 2026-07（第二轮：本地源码逐行核实 + 官方文档联网深挖）
>
> 一句话结论：业界主流做法高度一致——**把密钥材料放在 Android Keystore（硬件安全时落 TEE/StrongBox，应用进程无法读出密钥明文），用该密钥加密 token 后把密文落盘（SharedPreferences / DataStore / 文件），并在备份场景下把加密数据排除出 Auto Backup 或检测密钥失效后强制重新登录**。本轮用本地源码核实了 Pictelio 正在用的 `@aparajita/capacitor-secure-storage` 插件、备份排除 XML 与 token 存储现状，发现**三处此前未暴露的偏差**：①备份排除规则里的文件名（`_capacitor_secure_storage.xml`）与插件实际落盘文件名（`WSSecureStorageSharedPreferences.xml`）**不匹配，排除规则实际未生效**；②Native 层 `PixivApiPlugin` 把 refresh_token **明文**写入 `PictelioPrefs`（SharedPreferences），该文件未被任何规则排除，会随 Auto Backup 备份；③`checkBackupIntegrity()` 自检**没有任何生产调用点**（仅有定义与单元测试）。另外确认 ADR-0003 中「插件底层使用 EncryptedSharedPreferences」的说法**不属实**（源码无任何 AndroidX security-crypto 依赖）。

---

## a. Android Keystore 体系：密钥在哪、谁读得到、操作怎么走

### 结论

- **密钥存在系统级 KeyStore 服务（`AndroidKeyStore`）中**：硬件支持时，密钥材料生成并保存在 **TEE（Trusted Execution Environment）或 Secure Element（SE）** 内，Android 操作系统和应用进程都无法直接访问密钥材料，只能通过 alias（别名）引用密钥执行加解密操作；**即使 root 设备也无法轻易取出密钥**。Android 9（API 28）起还可用 **StrongBox**——一颗独立的硬件安全芯片（自带 CPU、安全存储、真随机数发生器 TRNG），密钥操作全部在芯片内完成。
- **软件实现（无硬件安全模块的设备）**：密钥用 per-user 的 master key 加密后存放在 `/data/misc/keystore/`，root 用户可读取——这是 Keystore 的降级形态，安全等级低于硬件实现。MASTG-KNOW-0043 还特别提醒：**部分设备上 secret/HMAC 密钥并未正确放进安全硬件（尽管私钥是正确的）**，验证硬件承载需用 `KeyInfo.isInsideSecureHardware` + Key Attestation。
- **应用进程拿到的是「密钥引用」而非密钥材料**：所有实现（AndroidX Security、react-native-keychain、flutter_secure_storage、capacitor-secure-storage）都以 alias 向 KeyStore 请求密钥句柄，再用 `Cipher` 完成加解密，密钥字节本身不出 KeyStore。
- **对称密钥支持自 Android 6.0（API 23）起**（此前只有 RSA/EC 公私钥对）。
- 可通过 `KeyInfo.isInsideSecureHardware` 验证密钥是否落在安全硬件中；生成时用 `setIsStrongBoxBacked(true)` 请求 StrongBox（无 StrongBox 时抛 `StrongBoxUnavailableException`）。
- 可对密钥附加使用门禁：`setUserAuthenticationRequired`（需用户认证）、`setUnlockedDeviceRequired`（设备解锁后才能用，Android 9+）、`setInvalidatedByBiometricEnrollment(false)`（新增生物识别注册后保持密钥有效，官方文档明示**默认新增生物识别会使密钥失效**）。
- **密钥失效场景**（详见「密钥失效场景全景」一节）：禁用安全锁屏、备份还原到新设备、恢复出厂设置、设备管理策略擦除、StrongBox 密钥数量/性能限制等都会让「密文在、密钥不在/不可用」。

### 来源

- 官方《Android Keystore system》：https://developer.android.com/privacy-and-security/keystore （本轮通过 Google 官方中国镜像 https://developer.android.google.cn/privacy-and-security/keystore 核实原文，含 setUnlockedDeviceRequired、setInvalidatedByBiometricEnrollment、密钥安全导入（API 28 / Keymaster 4）等章节）
- OWASP MASTG-KNOW-0043《Android KeyStore》（全文核实）：https://github.com/OWASP/mastg/blob/master/knowledge/android/MASVS-STORAGE/MASTG-KNOW-0043.md （网页版：https://mas.owasp.org/MASTG/knowledge/android/MASTG-KNOW-0043/ 已 404，新版站点知识库路径为 /MASTG/knowledge/…，仓库原文为准）
- OWASP MASTG-KNOW-0044《Key Attestation》：https://github.com/OWASP/mastg/blob/master/knowledge/android/MASVS-STORAGE/MASTG-KNOW-0044.md
- AOSP《由硬件支持的密钥库》（Keymaster HAL 架构、Keystore 2.0 域/SELinux 访问控制，本轮核实）：https://source.android.google.cn/docs/security/features/keystore （官方原版：https://source.android.com/docs/security/features/keystore）
- react-native-keychain 官方文档《Platform value storage》：https://oblador.github.io/react-native-keychain/docs/platform-value-storage

## b. 明文存储（SharedPreferences XML / 普通文件 / DataStore 明文）为什么不安全

### 结论

- SharedPreferences / 内部文件在非 root 设备上仅本应用可读（应用沙箱），但：
  - **root 设备**上，任何有 root 权限的应用/工具都能读取其他应用的 SharedPreferences 文件与内部文件；MASTG 明确指出这不是 Keystore 的情况——Keystore 的访问由内核级（Keymaster/Keymint）管控。
  - **备份通道**：`adb backup`（Android 12 起受限）、Android Auto Backup / 云备份会把 app 私有数据（含明文 SharedPreferences XML、DataStore 文件、普通文件）导出；MASTG 明确把 "Android Backups" 列为需要测试的数据存储渠道，且 MASWE-0003（Backup Unencrypted）、MASWE-0004（Sensitive Data Not Excluded From Backup）就是对应的弱点条目。明文 token 被备份出来后，攻击者拿到备份文件即可离线提取。
  - 设备丢失、取证工具（通过备份或 root）可直接读取。
- OWASP 对密钥/敏感数据存储方式的排序（从最安全到最不安全）中，「全部密钥存 SharedPreferences」「硬编码密钥」「可预测混淆/KDF」均被列为 not recommended（排序全文见 MASTG-KNOW-0047，本轮已核实）。
- 因此 token 绝不应明文写入 SharedPreferences / DataStore / 文件——**Pictelio 当前 Native 层正是这么做的（见「本地源码核实结果」一节，属违反本条的红旗）**。

### 来源

- OWASP MASTG-KNOW-0047《Cryptographic Key Storage》（全文核实，含「Storing a Key - from most secure to least secure」排序）：https://github.com/OWASP/mastg/blob/master/knowledge/android/MASVS-STORAGE/MASTG-KNOW-0047.md （网页版：https://mas.owasp.org/MASTG/knowledge/android/MASTG-KNOW-0047/）
- OWASP MASTG《Android Data Storage》Overview（数据存储方式与备份列为测试点，全文核实）：https://mas.owasp.org/MASTG/0x05d-Testing-Data-Storage/ （仓库原文：https://github.com/OWASP/mastg/blob/master/Document/0x05d-Testing-Data-Storage.md）
- OWASP MASWE-0003《Backup Unencrypted》、MASWE-0004《Sensitive Data Not Excluded From Backup》：https://mas.owasp.org/MASWE/MASVS-STORAGE/MASWE-0003/ 、https://mas.owasp.org/MASWE/MASVS-STORAGE/MASWE-0004/ （页面可访问，小节结构已确认：MASWE-0003 含 Initial Description / Relevant Topics / References；MASWE-0004 含 Overview / Impact / Modes of Introduction / Mitigations / Tests / Best Practices；本轮未能提取正文全文，链接页面为准）

## c. EncryptedSharedPreferences（AndroidX Security Crypto 库）

### 结论

- **实现方式**（androidx 官方源码全文核实）：
  - 一个 **MasterKey**（AES256-GCM、256 位，默认 alias `_androidx_security_master_key_`）生成并存放在 Android Keystore 中；
  - 用 Tink（google/tink）的 `AndroidKeysetManager` 管理两个 keyset：pref **key 用 AES256-SIV（确定性加密，便于查键）**，pref **value 用 AES256-GCM**（AAD 为加密后的 key 名）；
  - keyset 与密文都落在同一个普通 SharedPreferences 文件里（keyset 项名为 `__androidx_security_crypto_encrypted_prefs_key_keyset__` / `__androidx_security_crypto_encrypted_prefs_value_keyset__`），真正的根密钥只有 Keystore 里那把 MasterKey。
- **已知局限 / 维护状态**：该类**已被官方标记 `@Deprecated`**（源码注释：`Use android.content.SharedPreferences instead.`；MasterKey 的注释为 `Use javax.crypto.KeyGenerator with AndroidKeyStore instance instead.`）；官方《Cryptography》页面**明确声明「Jetpack 安全加密库已被废弃」**（本轮经中国镜像核实原文），但官方替代品尚未发布——MASTG-KNOW-0047 建议在替代品可用前继续使用。
- **备份警告（源码 Javadoc 原文，本轮核实）**：*"The preference file should not be backed up with Auto Backup. When restoring the file it is likely the key used to encrypt it will no longer be present. You should exclude all EncryptedSharedPreferences from backup using backup rules."* —— 这正是「备份还原后 Keystore 密钥失效」这一坑的官方确认，官方给出的对策就是**把加密文件排除出 Auto Backup**。
- flutter_secure_storage v10 已弃用 encryptedSharedPreferences，改用自研 cipher（见 d 节），是这一维护状态的行业反应。

### 来源

- AndroidX Security Crypto 源码（本轮全文核实）：`EncryptedSharedPreferences.java` https://github.com/androidx/androidx/blob/androidx-main/security/security-crypto/src/main/java/androidx/security/crypto/EncryptedSharedPreferences.java 、`MasterKey.java` https://github.com/androidx/androidx/blob/androidx-main/security/security-crypto/src/main/java/androidx/security/crypto/MasterKey.java
- 官方《Cryptography》页面 deprecated 声明（本轮经镜像核实：`developer.android.google.cn/privacy-and-security/cryptography` 的「已废弃的功能 → Jetpack 安全加密库」小节）：https://developer.android.com/privacy-and-security/cryptography （原 security-crypto 页面 https://developer.android.com/privacy-and-security/security-crypto 已不存在，镜像返回 404，应为并入 cryptography 页）
- OWASP MASTG-KNOW-0047（引用 EncryptedSharedPreferences 与官方 deprecated 链接）：https://github.com/OWASP/mastg/blob/master/knowledge/android/MASVS-STORAGE/MASTG-KNOW-0047.md
- flutter_secure_storage README（v10 弃用 encryptedSharedPreferences 的声明）：https://github.com/juliansteenbakker/flutter_secure_storage

## d. 跨平台框架的封装方式（React Native / Flutter / Capacitor）

### 结论

三家主流跨平台库在 Android 上的模式完全同构：**Keystore 管密钥 + 密文落盘**，只是密钥粒度和落盘容器不同。本轮已逐文件核实三方源码：

| 库 | 密钥（Android Keystore 内） | 密文落盘 | 备注 |
|---|---|---|---|
| **react-native-keychain** | AES-GCM（可选绑定 biometric）、RSA（可选绑定 biometric）、AES-CBC（legacy，不推荐）；alias 取自 service 名；**优先尝试 StrongBox，失败回退常规生成**（注意：StrongBox 尝试仅限 API 31+ 且 `FEATURE_STRONGBOX_KEYSTORE` 特性存在时，见 `DeviceAvailability.isStrongboxAvailable`）；失败路径捕获 `StrongBoxUnavailableException` / `ProviderException` | Jetpack DataStore 的 Preferences（文件名 `RN_KEYCHAIN`，旧版为同名 SharedPreferences，通过 `SharedPreferencesMigration` 自动迁移），Base64 密文 + 所用 cipher 名 | 提供 SecurityLevel（SECURE_HARDWARE/SECURE_SOFTWARE）检查（`KeyInfo.isInsideSecureHardware`）；`extractKey` 捕获 `UnrecoverableKeyException` 时删除 alias 并重试生成（有限次重试）；`decryptBytes` 对 `AEADBadTagException` 抛「data was modified, corrupted, or is being decrypted with the wrong key」专门提示；`extractGeneratedKey` 对「算法不兼容的旧密钥」自动删除重建 |
| **flutter_secure_storage**（v10+/v11） | 默认 **RSA-OAEP key cipher**：RSA 公私钥对存 Keystore（alias = `packageName + ".FlutterSecureStoragePluginKeyOAEP" + 后缀`），用公钥 `Cipher.WRAP_MODE` 包裹 AES 数据密钥、私钥 `unwrap`；OAEP 参数 SHA-256 主摘要 + MGF1-SHA1（与官方文档「Android KeyStore 中 OAEP 的 MGF1 用 SHA-1」一致）；biometric 模式为 **AES-GCM 密钥直存 Keystore**（支持 `setUserAuthenticationRequired`），RSA 密钥有效期 25 年 | SharedPreferences（`storageNamespace` 可隔离所有 artifacts；README 建议 `allowBackup=false` 或从自动备份中 exclude 这些 prefs） | 选项语义（源码核实）：`resetOnError`（默认 true，出错即**永久清空**全部数据）、`migrateOnAlgorithmChange`（默认 true，算法变更自动迁移旧数据）、`migrateWithBackup`（迁移前备份副本，防迁移崩溃）、`enforceBiometrics`（默认 false 优雅降级；true 时设备无 PIN/生物识别直接抛异常，密钥 `setUserAuthenticationRequired(true)`）、`AndroidBiometricType.strongBiometricOnly / biometricOrDeviceCredential`、`requireBiometricConfirmation`（API 29+） |
| **@aparajita/capacitor-secure-storage**（Pictelio 在用，8.0.0，本地源码逐行核实） | **每个 key 一个 AES-GCM 密钥**：`KeyGenerator.getInstance("AES", "AndroidKeyStore")` + `KeyGenParameterSpec`（alias = prefixedKey，PURPOSE_ENCRYPT\|DECRYPT，BLOCK_MODE_GCM，ENCRYPTION_PADDING_NONE）；alias 由 JS 端 `capacitor-storage_` 前缀 + key 名拼成（`prefixedKey(key) = prefix + key`），**Keystore alias 与 SharedPreferences 的 key 完全相同**；无 user-authentication 门禁、无 StrongBox 请求、未设置 `setRandomizedEncryptionRequired`（默认 true） | SharedPreferences 文件 `WSSecureStorageSharedPreferences`（落盘为 `WSSecureStorageSharedPreferences.xml`），值为 `Base64(ciphertext) + '\u0010'(0x10 分隔符) + Base64(IV)`，Base64 为 NO_PADDING+NO_WRAP | 密钥失效语义：`getSecretKey()` 捕获 `UnrecoverableKeyException` 后**静默重建密钥**（注释「还没生成就生成一个」）；`decryptString()` 中 `keyStore.getEntry(alias,null)==null` 时**返回 null 而非抛错**；旧密文用新密钥解密失败（`AEADBadTagException` 等 GeneralSecurityException）在 `tryStorageOp` 被包装为 `KeyStoreException(ErrorKind.osError)` reject（code=`osError`，message 形如 `An OS error occurred (AEADBadTagException)`）。**无任何 AndroidX security-crypto 依赖**（build.gradle 仅 capacitor-android + appcompat）。iOS 走 Keychain；**Web 端是 localStorage 明文**（dist/esm/web.js，README 明确「仅供调试，生产勿用」） |

react-native-keychain 细节（源码级，本轮核实）：`CipherStorageBase.kt` 中 `extractKey` 捕获 `UnrecoverableKeyException` 后删除 alias 重试；`decryptBytes` 对 `UserNotAuthenticatedException` 与 GCM 认证失败（`AEADBadTagException`）有专门分支——**「密钥丢失/不匹配」在解密期表现为认证标签校验失败**。这与 capacitor 插件的行为（osError reject / null 返回）形成对照：**不同插件对同一「密钥失效」事件的表象不同，应用层自检必须同时覆盖「抛错」与「返回 null」两条路径**。

### 来源

- capacitor-secure-storage 本地源码（本轮核实）：`node_modules/.pnpm/@aparajita+capacitor-secure-storage@8.0.0/node_modules/@aparajita/capacitor-secure-storage/android/src/main/java/com/aparajita/capacitor/securestorage/SecureStorage.java`、`KeyStoreException.java`、`android/build.gradle`、`dist/esm/base.js`、`dist/esm/web.js`、`README.md`（Web 端警告）
- capacitor-secure-storage GitHub：https://github.com/aparajita/capacitor-secure-storage （`android/src/main/java/com/aparajita/capacitor/securestorage/SecureStorage.java`）
- react-native-keychain 源码（本轮核实）：`CipherStorageBase.kt` / `DeviceAvailability.kt` / `DataStorePrefsStorage.kt`：https://github.com/oblador/react-native-keychain/blob/master/android/src/main/java/com/oblador/keychain/cipherStorage/CipherStorageBase.kt 、https://github.com/oblador/react-native-keychain/blob/master/android/src/main/java/com/oblador/keychain/DeviceAvailability.kt 、https://github.com/oblador/react-native-keychain/blob/master/android/src/main/java/com/oblador/keychain/DataStorePrefsStorage.kt
- flutter_secure_storage 源码（本轮核实）：`lib/options/android_options.dart`、`android/src/main/java/com/it_nomads/fluttersecurestorage/ciphers/KeyCipherImplementationRSAOAEP.java`（仓库 develop 分支）：https://github.com/juliansteenbakker/flutter_secure_storage
- 官方《Cryptography》OAEP MGF1 说明（本轮核实：Android KeyStore 中 OAEP 的 MGF1 摘要为 SHA-1）：https://developer.android.com/privacy-and-security/cryptography

## e. OWASP / IETF 对 token 存储的建议（access vs refresh、内存、登出、轮换）

### 结论

- **access token：尽量只放内存（transient memory）**，不持久化；必须短 scope、短有效期，走 HTTPS（0x04e Tokens 最佳实践原文，本轮核实）。
- **refresh token：属于长期凭证，必须存「安全的本地存储」**（iOS Keychain / Android Keystore 加密存储），并与 access token 区分对待。
- MASTG 明确要求验证「token 以 KeyChain（iOS）或 KeyStore（Android）方式安全存储在手机上」（0x04e Stateless Authentication 最佳实践，本轮核实）。
- **登出**时必须删除本地所有 token，并让服务端撤销 refresh token；残留 token 可能经设备备份泄漏（0x04e 原文：未清除的信息可能在备份时泄漏，本轮核实）。
- **refresh token rotation**：RFC 6819《OAuth 2.0 Threat Model and Security Considerations》§5.2.2.3 明确将 **Refresh Token Rotation** 列为授权服务器端的缓解措施（对 refresh token 盗窃的回应：每次刷新换发新 refresh token 并吊销旧 token；RFC 6819 还含 §5.3.3 Store Secrets in Secure Storage、§4.1.2 Threat: Obtaining Refresh Tokens）。对客户端而言，轮换意味着**每次刷新后都要把新 refresh token 写回安全存储**——这是与「token 存储」直接相关的一条要求。
- **BiometricPrompt / 用户认证门禁的使用场景**（MASTG 0x05f + MASTG-KNOW-0043，本轮核实）：
  - 两种模式：① 解锁后限时授权（`setUserAuthenticationValidityDurationSeconds`，默认 5 分钟见 MasterKey 源码；若用户**禁用锁屏，密钥永久失效**——官方文档原文，需注意）；② 单次操作授权（biometric 认证后仅本次可用）。
  - 业界库的做法：flutter_secure_storage 的 `enforceBiometrics`（true 时强约束、false 优雅降级）、react-native-keychain 的 AES_GCM/RSA with biometric。
  - 适用判断：对 token 这类「换新成本低」的凭证，biometric 门禁是**可选增强**而非必须；对高价值密钥/交易签名才是强烈建议。MASVS-STORAGE 控制项要求敏感数据使用平台安全存储，并未强制 biometric（MASVS-STORAGE-1/2 全文本轮核实）。

### 来源

- OWASP MASTG《Mobile App Authentication Architectures》（0x04e，全文核实，含 Tokens 最佳实践与登出小节）：https://mas.owasp.org/MASTG/0x04e-Testing-Authentication-and-Session-Management/ （仓库原文：https://github.com/OWASP/mastg/blob/master/Document/0x04e-Testing-Authentication-and-Session-Management.md）
- RFC 6819《OAuth 2.0 Threat Model and Security Considerations》（本轮核实全文目录与 5.3 节；§5.2.2.3 Refresh Token Rotation）：https://www.rfc-editor.org/rfc/rfc6819
- OWASP MASTG《Android Local Authentication》：https://mas.owasp.org/MASTG/0x05f-Testing-Local-Authentication/ （仓库原文：https://github.com/OWASP/mastg/blob/master/Document/0x05f-Testing-Local-Authentication.md）
- OWASP MASTG-KNOW-0043（密钥认证门禁两种模式、禁用锁屏导致密钥失效、生物识别新增注册使密钥失效）：https://github.com/OWASP/mastg/blob/master/knowledge/android/MASVS-STORAGE/MASTG-KNOW-0043.md
- OWASP MASVS 控制项（全文核实）：MASVS-STORAGE-1「The app securely stores sensitive data」 https://mas.owasp.org/MASVS/controls/MASVS-STORAGE-1/ （源文件：https://github.com/OWASP/masvs/blob/master/controls/MASVS-STORAGE-1.md ）；MASVS-STORAGE-2「The app prevents leakage of sensitive data」（含备份/日志等非故意泄露） https://mas.owasp.org/MASVS/controls/MASVS-STORAGE-2/

## f. 备份 / 迁移陷阱（Auto Backup 与 Keystore 密钥）

### 结论

- Android Auto Backup / 云备份（Google Drive）会备份 app 的私有数据（SharedPreferences、DataStore、文件），但 **Keystore 密钥不随备份迁移到新设备**（密钥绑定设备安全硬件）。于是：**备份还原到新设备后，出现「密文在、密钥不在」的坏状态**——这是 Pictelio 踩过的坑，也是 AndroidX 官方在 EncryptedSharedPreferences Javadoc 里明确警告并建议排除备份的场景。
- **dataExtractionRules 语法（官方文档原文，本轮核实）**：`<exclude domain="sharedpref" path="xxx.xml"/>` 中 `domain` 可取 `root / file / database / sharedpref / external / device_root / device_file / device_database / device_sharedpref`；`path` **不支持通配符或正则**，指向文件或目录（目录则递归匹配）；若配置了 `<include>` 则默认「只备份 include 项」，`<exclude>` 优先级高于 `<include>`；`getCacheDir()/getCodeCacheDir()/getNoBackupFilesDir()` 永远排除。**`path` 必须与 SharedPreferences 的实际文件名（含 `.xml` 后缀）精确一致，否则排除不生效**——Pictelio 的配置正是栽在这里（见「本地源码核实结果」）。
- **业界处理方式（按优先级）**：
  1. **预防**：把加密存储文件从备份中排除——Android 官方 backup rules（`dataExtractionRules` / `fullBackupContent`），或直接 `android:allowBackup="false"`（flutter_secure_storage README 两种都教）。
  2. **兜底**：运行时检测「密钥失效 / 数据解不开」，清除 token 强制重新登录（Pictelio 的 backup_marker + 完整性检查正是这一类；这是官方文档之外常见的 defence-in-depth 做法，但**前提是它真的在启动流程中被调用**）。
  3. 注意 `adb backup` 自 Android 12 起受限（需 debuggable，MASTG-TECH-0128 原文），但 OEM 云备份/换机迁移（如小米、华为等厂商的换机助手）仍可能还原数据——这也是 ADR-0003 里「OEM 可能忽略排除项」担忧的现实依据（该点为推理性表述：厂商换机助手的行为官方无统一文档，见「国内安卓生态」一节）。
- **官方新建议（2025-2026 文档，本轮核实）**：Auto Backup 文档新增提示——「如需备份用户凭据和身份验证令牌，请不要将其存储在共享偏好设置或文件中，而是改用 **Block Store API** 来存储和管理凭据」；这代表了官方对「token 落 SharedPreferences（哪怕加密）+ 备份排除」方案的演进方向（Block Store 可随其它应用数据一起安全备份恢复）。
- MASTG 提供可操作的备份数据检查方法（本轮核实全文）：`adb shell bmgr`（Android 12+ 无 adb backup 限制的设备）、本地 transport 下从 `/data/data/com.android.localtransport/files/` 拉取 `.ab` 后用 `tar xvf` 解包、android-backup-extractor 提取，然后用 MASTG-TECH-0127 检查备份内容（目录结构 `apps/pkgname/sp/` = SharedPreferences、`f/` = files、`db/` = databases、`r/` = root）。

### 来源

- AndroidX `EncryptedSharedPreferences.java` Javadoc（备份警告原文，本轮核实）：https://github.com/androidx/androidx/blob/androidx-main/security/security-crypto/src/main/java/androidx/security/crypto/EncryptedSharedPreferences.java
- 官方《Back up user data with Auto Backup》（本轮经镜像核实 dataExtractionRules 语法、Block Store 建议、cross-platform transfer（API 36.1））：https://developer.android.com/guide/topics/data/autobackup （镜像：https://developer.android.google.cn/guide/topics/data/autobackup ，最后更新 2026-02-26）
- flutter_secure_storage README（allowBackup=false / exclude sharedprefs 建议）：https://github.com/juliansteenbakker/flutter_secure_storage
- OWASP MASTG-TECH-0128《Performing a Backup and Restore of App Data》（bmgr / adb backup / backup-extractor 步骤，全文核实）：https://mas.owasp.org/MASTG/techniques/android/MASTG-TECH-0128/ （仓库原文：https://github.com/OWASP/mastg/blob/master/techniques/android/MASTG-TECH-0128.md）
- OWASP MASTG-TECH-0127《Inspecting an App's Backup Data》（备份目录结构，全文核实）：https://github.com/OWASP/mastg/blob/master/techniques/android/MASTG-TECH-0127.md
- OWASP MASWE-0003 / MASWE-0004（备份相关弱点）：https://mas.owasp.org/MASWE/MASVS-STORAGE/MASWE-0003/ 、https://mas.owasp.org/MASWE/MASVS-STORAGE/MASWE-0004/

## g. 知名应用 / 系统级做法（可引用资料）

### 结论

- **知名应用**：react-native-keychain 官方 README 列出的使用者包括 **MetaMask Mobile、Rainbow Wallet、BlueWallet**——头部加密钱包普遍采用「Keystore/Keychain + 加密存储」模式存储密钥与凭证（钱包场景还叠加 biometric）。
- **Google 官方示例**：Google 的 key-attestation 示例（`google/android-key-attestation`）是官方演示如何验证 Keystore 密钥确在安全硬件中的样例；官方《Security Tips》文档（`developer.android.com/training/articles/security-tips`）有"Storing Data"一节，被 MASTG 0x05d 引用为权威参考（本轮经镜像确认页面存在（2024-01-06 更新），但「Storing Data」小节正文未能在本轮完整提取，链接为准）。
- **系统级**：Android 系统自身的凭据体系（Wifi 密码、App 密码等）走 Keystore / KeyChain API（`KeyChain` 底层即 KeyStore 系统），MASTG 0x05e 明确说明 KeyChain 背后是 KeyStore——即系统级做法与本文结论一致：密钥进 Keystore，应用只持引用。
- **AOSP 实现细节（本轮核实）**：Keystore 2.0（Android 11+）引入域 + SELinux 命名空间（`keystore2_key`）访问控制，系统组件（Wi-Fi `wifi_key` 命名空间等）也通过命名空间共享密钥——印证「Keystore 由内核级管控」的论断。

### 来源

- react-native-keychain README（Used By: Rainbow Wallet / MetaMask Mobile / BlueWallet）：https://github.com/oblador/react-native-keychain
- Google Key Attestation 官方示例：https://github.com/google/android-key-attestation （MASTG-KNOW-0044 引用）
- MASTG《Android Cryptographic APIs》（KeyChain 底层使用 KeyStore 系统）：https://github.com/OWASP/mastg/blob/master/Document/0x05e-Testing-Cryptography.md
- 官方《Security Tips》：https://developer.android.com/training/articles/security-tips （镜像可访问：https://developer.android.google.cn/training/articles/security-tips ）
- AOSP《由硬件支持的密钥库》（Keystore 2.0 域/SELinux，本轮核实）：https://source.android.google.cn/docs/security/features/keystore

---

## h. 本地源码核实结果（Pictelio 专项，本轮新增）

> 本节全部结论均来自本机一手资料：插件源码（`node_modules/.../@aparajita/capacitor-secure-storage@8.0.0/`）、项目源码（`packages/app/`）、ADR 文档（`docs/adr/`）。

### h1. 插件实现核实（@aparajita/capacitor-secure-storage 8.0.0）

- 加密方案：**每 key 一个 AES-GCM 密钥**（`AES/GCM/NoPadding`），`KeyGenerator.getInstance("AES", "AndroidKeyStore")` + `KeyGenParameterSpec`（alias = prefixedKey；PURPOSE_ENCRYPT|DECRYPT；BLOCK_MODE_GCM；ENCRYPTION_PADDING_NONE）。alias = JS 端默认前缀 `capacitor-storage_` + key 名（如 refresh_token 的 alias 是 `capacitor-storage_refresh_token`），与 SharedPreferences 的存储 key 完全同名。
- 密文落盘：SharedPreferences 文件名 **`WSSecureStorageSharedPreferences`**（→ 落盘文件 `WSSecureStorageSharedPreferences.xml`）；值格式 **`Base64(密文) + '\u0010' + Base64(IV)`**（NO_PADDING|NO_WRAP）。
- 密钥失效处理：
  - `getSecretKey()` 捕获 **`UnrecoverableKeyException` 后静默重建密钥**（注释：视为尚未生成）；
  - `decryptString()` 中 `keyStore.getEntry(alias, null)` 返回 **null 时直接返回 null**（不抛错，JS 收到 `data: null`）；
  - 旧密文解密失败（`AEADBadTagException` 等 GeneralSecurityException）在 `tryStorageOp` 中被包装成 **`KeyStoreException`（ErrorKind.osError）reject**，code = `"osError"`，message 含异常类名（如 `An OS error occurred (AEADBadTagException)`）。
- **依赖核实：build.gradle 的 dependencies 只有 `capacitor-android` 与 `androidx.appcompat`，package.json 的 dependencies 只有 @capacitor/* 系列——没有任何 `androidx.security:security-crypto`（EncryptedSharedPreferences）依赖**。插件是「自研 AES/GCM + AndroidKeyStore 直连」实现。
- README 核实：Android 端「AES-GCM with Android KeyStore key → SharedPreferences」；iOS 端 Keychain；**Web 端 localStorage 明文，仅调试用**（dist/esm/web.js 证实）。

### h2. 备份排除文件名对照结论：**不匹配（排除规则未生效）** ⚠️

| 项 | 文件名 | 出处 |
|---|---|---|
| 插件实际落盘的 SharedPreferences 文件 | `WSSecureStorageSharedPreferences.xml` | `SecureStorage.java` 常量 `SHARED_PREFERENCES = "WSSecureStorageSharedPreferences"` |
| `data_extraction_rules.xml` 排除项（Android 12+） | `_capacitor_secure_storage.xml` | `packages/app/android/app/src/main/res/xml/data_extraction_rules.xml` |
| `backup_rules.xml` 排除项（Android 11-） | `_capacitor_secure_storage.xml` | `packages/app/android/app/src/main/res/xml/backup_rules.xml` |
| ADR-0003 文档声称的排除项 | `SecurePrefs.xml` | `docs/adr/0003-backup-security-three-layer-defense.md` |

**结论：排除规则里写的文件名与实际落盘文件不一致，`<exclude domain="sharedpref">` 按官方语法做精确路径匹配（不支持通配符），因此规则实际匹配不到任何文件——层①/层② 形同虚设，`WSSecureStorageSharedPreferences.xml`（含 refresh_token 密文）与 `PictelioPrefs.xml`（含明文 refresh_token，见 h3）都会随 Auto Backup 备份**。三个名字（ADR 文档、XML 配置、插件实际）互不一致，说明该防护从设计到落地层层失真。附带说明：XML 注释还写着「使用 EncryptedSharedPreferences 存储在 _capacitor_secure_storage.xml 中」——文件名的错误与 EncryptedSharedPreferences 的误解同源（都来自 ADR-0003 的错误认知）。

### h3. access token 与 refresh token 的存储现状

- **access token：仅存内存，符合 OWASP「transient memory」建议** ✅
  - Native 层：`PixivApiPlugin.setAccessToken()` 只写 `static String accessToken`（`PixivApiPlugin.java`），不落盘；
  - JS 层：`client.ts` 的 `devAccessToken` 内存变量（仅 DEV 分支使用）；`authStore.ts` 的 `accessTokenSig` 为内存 signal。
- **refresh token：双轨存储，Native 轨为明文** ⚠️
  - JS 轨：`secureStorage.ts` → `@aparajita/capacitor-secure-storage`（Keystore 加密，密文在 `WSSecureStorageSharedPreferences.xml`）✅；
  - **Native 轨：`PixivApiPlugin.setRefreshToken()` 把 refresh_token 明文 `putString` 进 `PictelioPrefs`（SharedPreferences），`refreshAccessToken()` 也从该文件读取、并在服务端换发新 refresh_token 时明文更新（`PixivApiPlugin.java` 第 180-183、274-276、331-335 行）** —— 该文件**不在任何备份排除规则内**，明文随 Auto Backup 导出，直接命中 MASWE-0003（Backup Unencrypted）。auth.ts 的 `refreshToken()` 每次刷新都会调用 `PixivApi.setRefreshToken(...)`（生产 Native 路径），所以 `PictelioPrefs.xml` 长期存在明文 refresh_token。
  - 历史遗留：`migrateRefreshTokenFromPreferences()` 表明 refresh_token 曾明文存在于 @capacitor/preferences（`Preferences`），该函数负责一次性迁移到 SecureStorage——说明「明文落盘」是历史包袱，但 Native 轨至今仍保留明文副本。

### h4. checkBackupIntegrity 自检：无生产调用点 ⚠️

- `secureStorage.ts` 定义了 `checkBackupIntegrity()`：`SecureStorage.get(marker)` 抛错 → 清除 refresh_token → 返回 false；marker 为 null/undefined → 写入 marker → 返回 true（**只检查 marker 的存在性**）。
- **全仓库 grep（含 packages/app 全部源码与原生目录）无任何生产调用点**——只有定义、单元测试（`tests/unit/utils/secureStorage.test.ts`）与 `data_extraction_rules.xml` 注释提到它。即 **ADR-0003 的层③ 实际未接入启动流程**，备份还原后的「密文解不开」场景目前没有任何运行时兜底。
- 即便接上，其逻辑也有两个盲点（对照 h1 的插件行为）：①「marker 解密失败」路径确实会走 err 分支清除 token（覆盖同设备密钥失效）；②但「新设备还原后 marker 密文在、Keystore 无 alias」时插件返回 null 而非抛错，函数会**误判为首次启动**并重写 marker 返回 true——此时 refresh_token 读取同样返回 null，正常流程会触发重新登录（结果上安全），但 marker 自检本身没有区分「新设备还原」与「首次安装」，测试清单需显式覆盖。

### h5. ADR-0003 描述核实

| ADR-0003 声称 | 核实结果 |
|---|---|
| 插件底层使用 EncryptedSharedPreferences + Android KeyStore | ❌ **不属实**：插件为自研 AES/GCM + AndroidKeyStore 直连，无 security-crypto 依赖（h1） |
| 层① 排除 `SecurePrefs.xml`（Android 12+ 标准路径） | ❌ 与 XML 实际内容不符（XML 里是 `_capacitor_secure_storage.xml`），且两者都与插件实际文件名不匹配（h2） |
| 层③ backup_marker 每次启动检查、失效则 wipe token + 强制重新登录 | ⚠️ 函数已实现（含 err 路径清 token）但**无生产调用点**（h4） |
| Android 15 已标记 allowBackup 为 deprecated | ⚠️ 未核实到：官方 Android 15 deprecations 页（2026-07-15 更新）不含 allowBackup；Auto Backup 文档（2026-02-26 更新）未检索到该声明。该论断需谨慎对待（详见「备份机制版本差异」节） |

---

## i. 密钥失效场景全景（本轮新增）

Keystore 密钥的「生命周期」比密文更脆弱，以下场景都会导致「密文在、密钥不可用」，业界各库与官方文档均有对应描述：

1. **禁用/修改安全锁屏**：`setUserAuthenticationRequired` 密钥在用户禁用锁屏（或重置锁屏凭据）后**永久失效**（官方 Keystore 文档 + MASTG-KNOW-0043 原文，本轮核实）。症状：`getEntry`/`getKey` 抛 `UnrecoverableKeyException`（多数库）或解密时 `AEADBadTagException`（若密钥被静默重建）。
2. **备份还原 / 换机**：Keystore 密钥不跨设备迁移（绑定设备安全硬件）。**新设备**：alias 不存在 → `getEntry` 返回 null（capacitor 插件返回 null；react-native-keychain 抛「Empty key extracted!」）；**同设备恢复出厂设置后再还原**：Keystore 被清空或 keyblob 失效 → 同上。这是 EncryptedSharedPreferences Javadoc 官方警告的场景。
3. **恢复出厂设置 / 设备管理（Device Owner）擦除**：`wipeData` 或 factory reset 会清除 Keystore 与 /data；若备份随后被还原（云备份或厂商换机助手），即出现「密文在、密钥不在」。AOSP 文档确认 Keystore 提供 `reset`（将密钥库重置为出厂默认设置）能力，供系统调用。
4. **系统更新 / Keymaster 版本跃迁**：Keymaster HAL 版本不向后兼容（Keymaster 1 与 0.2/0.3 完全不兼容，AOSP 原文）；OTA 升级时系统会迁移 keyblob，极少数厂商实现缺陷会导致迁移后旧密钥不可用（无官方统一资料，谨慎表述；业界以「解密失败 → 重建/重登」兜底）。
5. **StrongBox 限制**：StrongBox 是独立安全芯片，**密钥数量有限、单次操作更慢**（官方文档对 StrongBox 的描述：受限的片上资源，适合少量高价值密钥；MASTG-KNOW-0043 亦提示 `StrongBoxUnavailableException` 兜底）。react-native-keychain 因而只在 API 31+ 且设备声明 `FEATURE_STRONGBOX_KEYSTORE` 时才尝试 StrongBox（源码核实）。Pictelio 插件未请求 StrongBox，不受此限。
6. **新增生物识别注册**：`setUserAuthenticationRequired` + 仅生物识别授权的密钥，在**新增指纹/人脸注册后默认失效**（官方文档，本轮核实），除非显式 `setInvalidatedByBiometricEnrollment(false)`。
7. **插件自身行为差异（本轮核实）**：capacitor 插件对「密钥失效」不透明——`getSecretKey` 静默重建，导致旧密文解密必抛 `AEADBadTagException`（包装为 `osError` reject）；react-native-keychain 会删除旧 alias 重建并给明确错误；flutter_secure_storage `resetOnError` 默认直接清空全部数据（**永久删除**，需注意该默认值对用户数据的杀伤力）。

**共同结论**：任何「Keystore 加密 + 密文落盘」方案都必须假设「某天密钥会失效」，并在应用层设计「读不到/解不开 → 清除 token → 重新登录」的统一兜底，且测试清单覆盖上述 1-6 各场景。

## j. 备份机制版本差异（本轮新增）

- **Android 12（API 31）起**：`dataExtractionRules` 取代 `fullBackupContent` 成为目标 SDK 31+ 应用的备份规则来源（`<cloud-backup>` 云备份 / `<device-transfer>` 设备间迁移分开配置）；Android 12 行为变更还**限制 `adb backup` 为非 debuggable 应用不可用**（MASTG-TECH-0128 原文，本轮核实）。Android 11- 仍用 `fullBackupContent`（`<full-backup-content>` 语法）。
- **Android 15（API 35）**：官方 Android 15 deprecations 页（2026-07-15 更新）**没有** allowBackup 条目；「Android 15 已标记 allowBackup 为 deprecated」的说法在本轮官方页面中**未核实到**（ADR-0003 有该论断，建议以官方 manifest 参考页 `application-element#allowBackup` 的最新标注为准复核——该页本轮未抓取成功）。无论如何，`dataExtractionRules` 已是官方钦定的现代机制。
- **Android 16 QPR2（API 36.1）**：新增 `<cross-platform-transfer>`（iOS 数据迁移，含 bundleId/teamId/contentVersion 校验），未来跨平台换机也会把 app 数据带走——token 类数据同样面临「被迁移」问题。
- **OEM 云备份 / 换机助手**：小米、华为、OPPO/vivo 等厂商的云备份与换机迁移工具对 `dataExtractionRules` 的遵从程度无公开统一文档（本轮未能找到可引用的厂商文档或权威讨论）；基于已知信息可以谨慎表述：**厂商迁移工具走系统 backup 通道的会遵循规则，但换机助手类工具存在绕过系统备份框架直接拷贝 app 私有目录的实现可能**——这正是 ADR-0003 层③（运行时完整性检查）存在的理由，但层③必须真的被调用（见 h4）。
- **官方新方向**：Auto Backup 文档（2026-02 更新，本轮核实）明确建议凭据/认证 token 改用 **Block Store API** 存储，可随应用数据一起「安全备份和恢复」——这是官方对「token 该不该排除出备份」问题的最终答案：token 应存在一个备份感知的安全容器里，而不是 SharedPreferences + 排除规则。

## k. Keystore 演进时间线（本轮新增）

| Android 版本 | API | 里程碑 |
|---|---|---|
| 4.3 | 18 | `AndroidKeyStore` provider 引入（此前只有系统内部 keystore） |
| 6.0 | 23 | 对称密钥（AES/HMAC）支持；Keymaster HAL 1 引入 |
| 7.0 | 24 | 硬件背书 Keystore 普及（TEE/SE），`isInsideSecureHardware` 可用 |
| 8.0 | 26 | Keymaster 3（HIDL 化） |
| 9 | 28 | **StrongBox**（独立安全芯片）、`setUnlockedDeviceRequired`、`setIsStrongBoxBacked`、密钥安全导入（Keymaster 4） |
| 10 | 29 | `setUserAuthenticationParameters` 前身（AUTH_BIOMETRIC_STRONG 等类型） |
| 11 | 30 | `setUserAuthenticationParameters(timeout, type)` 正式 API |
| 11+ | 30+ | **Keystore 2.0 / Keymint**（域 + SELinux 命名空间，AOSP 文档本轮核实） |
| 12 | 31 | react-native-keychain 等库开始尝试 StrongBox（`FEATURE_STRONGBOX_KEYSTORE` 判定，源码核实） |

（时间线依据：MASTG-KNOW-0043、官方 Keystore 文档、AOSP 文档、各库源码，均已核实。）

## l. token 轮换（refresh token rotation）与存储的关系（本轮新增）

- RFC 6819 §5.2.2.3 把 **Refresh Token Rotation** 列为授权服务器缓解 refresh token 窃取的措施（每次使用后轮换、旧 token 立即失效，可检测 replay）。OAuth 2.1 草案沿用该建议。
- 对客户端的直接影响：**每次刷新后必须把「新 refresh token」写回安全存储**；若服务端吊销旧 token 而本地未更新，用户会「被登出」。Pixiv 服务端在 refresh 响应中会返回新 refresh_token（PixivApiPlugin.refreshAccessToken 处理了 `optString("refresh_token")` 并写回——本地代码核实），因此 Pictelio 已具备轮换落地的服务端配合，问题只在于写回的存储是否安全（见 h3：Native 轨明文写回）。
- 轮换 + 备份的另一面：若旧 token 的明文曾被备份走，轮换可让泄露的旧 token 快速失效——**轮换是对「备份泄露」类风险的补偿性控制**（推论，基于 RFC 6819 思路；无直接权威资料，谨慎表述）。

## m. 国内安卓生态特殊点（本轮新增，如实说明证据情况）

- **未能找到可引用的权威公开资料**：关于微信/支付宝等国内头部 App 的 token 存储方式（是否用 Keystore、是否排除备份），没有官方或可核实的公开文档；厂商 ROM 的云备份/换机助手对备份规则的遵从度同样无公开文档。以下为**基于已知事实的谨慎表述**，不作为定论：
  - 国内 Android 设备普遍无 Google 云备份，但厂商云备份（小米云服务、华为云空间等）与「换机助手/手机搬家」类工具会迁移 app 数据；其实现是否尊重 `dataExtractionRules` 无法统一确认——**对 token 类应用，正确姿势是「不依赖排除规则生效，默认假设数据可能被带走」**（这正是 backup_marker 自检的初衷）。
  - 微信/支付宝等超级 App 通常把 token 与密钥放在自研安全方案（如 TEE 直连、厂商 TEE/SE SDK、自研防护壳）中，且大量使用厂商安全芯片能力——这与公开论文/大会分享（如厂商安全白皮书）相关，但本轮未能抓取到可直接引用的公开文档，故不展开。
- 结论：对 Pictelio 这类独立 App，**可执行的标准动作仍是：密钥进 Keystore、密文排除备份、运行时自检兜底、access token 不落盘**——这与国内生态无关，是跨厂商一致的基线。

---

## 对 Pictelio 的启示（对照当前方案，按本轮证据修订）

当前方案：`@aparajita/capacitor-secure-storage` 存 refresh_token（Android: Keystore AES-GCM 密钥 + `WSSecureStorageSharedPreferences.xml` 密文）+ ADR-0003 三层备份防护（data_extraction_rules 排除 + backup_rules 排除 + backup_marker 完整性检查）+ Native 层 `PixivApiPlugin`（`PictelioPrefs` 明文 refresh_token + 内存 access_token）。

### 做得对的地方（有据可依）

1. **存储模式与业界主流完全一致**：Keystore 管密钥、密文落盘，与 react-native-keychain / flutter_secure_storage / AndroidX Security 同构；且未依赖已 deprecated 的 EncryptedSharedPreferences（flutter_secure_storage v10 也弃用了它），选型本身没有问题。（证据：本地插件源码 / 各库源码）
2. **「排除备份 + 运行时完整性检查」的思路正是官方推荐组合**：EncryptedSharedPreferences 官方 Javadoc 明确要求把加密文件排除出 Auto Backup（对应层①/层②），Pictelio 还设计了层③兜底 OEM 忽略排除项的情况——思路是 defence-in-depth 的正确姿势，**问题在落地**（见下方 1-3 条）。（证据：AndroidX 源码 Javadoc 原文 / MASTG-TECH-0127/0128）
3. **access token 仅存内存**，符合 MASTG「access token 保持 transient memory」的要求。（证据：PixivApiPlugin.java / client.ts / authStore.ts 本地源码）

### 可改进点（按严重程度排序，每条标注证据来源）

1. **[P0] 修正备份排除文件名**：把 `data_extraction_rules.xml` 与 `backup_rules.xml` 中的 `path="_capacitor_secure_storage.xml"` 改为 **`path="WSSecureStorageSharedPreferences.xml"`**（插件实际文件名，含 `.xml` 后缀，官方语法为精确匹配、不支持通配符）。同时考虑排除 `PictelioPrefs.xml`——但更好的做法是直接消除该明文文件（见 2）。修完后用 MASTG-TECH-0128/0127 的 bmgr/backup-extractor 方法做一次回归验证，确认备份包里不再出现这两个文件。（证据：本地 `SecureStorage.java` 常量 + `data_extraction_rules.xml` + 官方 autobackup 语法原文）
2. **[P0] 消除 refresh_token 明文副本**：`PixivApiPlugin.setRefreshToken` 把 refresh_token 明文写进 `PictelioPrefs`（SharedPreferences），且 `refreshAccessToken` 依赖它——该文件随 Auto Backup 备份，直接命中 MASWE-0003（Backup Unencrypted）。建议：Native 层不再持久化 refresh_token，改为由 JS 层在每次刷新后把新 refresh_token 写入 SecureStorage（auth.ts 已把结果存 SecureStorage，Native 轨冗余且不安全）；或 Native 层改用 Keystore 加密（至少不明文落盘）。若因 401 静默刷新需要 Native 侧快速取 token，可改为 Native 每次刷新前向 JS 请求/由 JS 注入，避免明文副本。（证据：PixivApiPlugin.java 本地源码 / MASTG-KNOW-0047 / MASWE-0003）
3. **[P1] 把 checkBackupIntegrity() 接入启动流程**：全仓库无生产调用点，层③目前未生效。建议在 `initializeAuth()`（authStore.ts）读取 refresh_token 之前调用，失败则走「清除 token + 重新登录」；同时补一个「解密抛错」的测试用例（现测试已覆盖 get 抛错分支，但未覆盖「插件返回 null（新设备无 alias）」与「osError reject（AEADBadTagException）」两种真实表象）。（证据：secureStorage.ts / authStore.ts / secureStorage.test.ts 本地源码；h1 插件行为）
4. **[P1] 修正 ADR-0003 的事实错误**（本轮不动 ADR 文件，仅记录）：①「底层使用 EncryptedSharedPreferences」不属实（无 security-crypto 依赖）；②「排除 SecurePrefs.xml」与实际 XML（`_capacitor_secure_storage.xml`）和插件实际文件名都不一致；③「Android 15 已标记 allowBackup 为 deprecated」未能在官方页面核实，建议复核后再引用；④ 层③ 声称已生效但实际未接线。建议在后续单独决策中修订 ADR。（证据：h5 对照表）
5. **[P2] 测试清单覆盖「换机迁移」与「同设备恢复」两条路径**：新设备还原 → 插件返回 null（密文在、alias 无）；同设备恢复 → 可能 osError reject（密钥被静默重建后 AEADBadTagException）。两层都应由启动自检兜住，并在回归测试中用 bmgr/backup-extractor 验证排除规则真实生效（修完 1 之后）。（证据：MASTG-TECH-0128/0127 / 插件源码）
6. **[P2] 评估官方 Block Store 方向**：官方 Auto Backup 文档（2026-02）建议凭据/token 用 Block Store API 存储（可随应用数据安全备份恢复）。Pictelio 可将「换机后自动恢复登录态」列为产品目标时，把 Block Store 作为替代 secure-storage 的候选（当前 secure-storage + 排除规则方案仍是合规基线）。（证据：官方 autobackup 文档）
7. **[P3] 清理历史明文迁移逻辑**：`migrateRefreshTokenFromPreferences()` 依赖旧版 @capacitor/preferences 里的明文 refresh_token；确认存量用户已全部迁移后可移除该函数，避免明文历史数据长期存在。（证据：secureStorage.ts 本地源码）
8. **[P3] Web 端注意**：该插件 Web 端是 localStorage 明文（README 明示仅调试用）。Pictelio 若存在 Web 构建，应确认生产环境不会走这条路径。（证据：插件 README + dist/esm/web.js）

### 备注：本轮网络与核实状态

- `developer.android.com`、`source.android.com`、`raw.githubusercontent.com` 仍不可达（超时）；**官方文档改用 Google 中国官方镜像 `developer.android.google.cn` / `source.android.google.cn` 成功核实原文**（Keystore 系统、Cryptography（含 security-crypto deprecated 声明）、Auto Backup、Security Tips、Android 15 deprecations、AOSP Keystore），镜像为官方同步站点，内容与主站一致，文内保留主站链接并注明镜像核实。
- GitHub 源码经 `cdn.jsdelivr.net` CDN 与 `api.github.com` 核实（EncryptedSharedPreferences/MasterKey、react-native-keychain 三文件、flutter_secure_storage 两文件）。
- MASTG 仓库原文经 jsDelivr 核实（KNOW-0043/0047、TECH-0127/0128、0x04e、0x05d）；MASWE-0003/0004 正文仅确认页面结构与标题（mas.owasp.org 页面导航过大，正文未完整提取）；MASVS-STORAGE-1/2 经 masvs 仓库核实。
- 「未能核实原文」项（如实保留）：官方 Security Tips 的 Storing Data 小节正文；`application-element#allowBackup` 属性页原文；MASWE-0003/0004 正文；厂商（小米/华为等）备份工具对 dataExtractionRules 的遵从度；Android 15 对 allowBackup 的 deprecation 声明（未检索到，需人工复核）。

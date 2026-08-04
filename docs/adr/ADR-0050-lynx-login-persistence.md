# ADR 0050: app-lynx 登录态持久化（web-core IndexedDB + 原生适配主项目 Keystore 存储）

## 状态

已采纳（web-core 部分实施；原生部分待 #41）

## 分类

技术决策 / 安全

## 日期

2026-08-01

## 背景

app-lynx 的 `refresh_token` **仅存内存**（`authStore.ts`，`restoreToken` 恒 false），重启即登出，需重新粘贴 token。原注释的理由是"Web 模式不写入 localStorage——防 XSS 窃取"。

调查发现 localStorage 方案**根本不可行**：

1. lynx 采用双线程架构（main thread + background thread），app-lynx 的 JS（vue-lynx 组件、api client、authStore）运行在 **Web Worker**（web-core 用 `new Worker({ name: 'lynx-bg' })` 创建）。
2. **Worker 环境无 `window`/`document`/`localStorage`**（标准 WorkerGlobalScope）；有 `fetch`/`indexedDB`。
3. 现有 `clientSwitchStore` 用 `globalThis.localStorage?.` 是 **no-op**（可选链兜住 undefined，设置从未持久化）。

## 决策

### 1. web-core（Worker）：IndexedDB 持久化 refresh_token

`authStore` 增加 IndexedDB 封装（objectStore `tokens`，key `refresh_token`）：

- `restoreToken()`：读 IndexedDB → 有 token 则 `performRefresh(token)` 恢复登录态（不再恒 false）
- `loginWithToken()` 成功 → 写入 IndexedDB
- `logout()` → 清除 IndexedDB

**安全权衡修订**：IndexedDB 与 localStorage 同级（同 origin 可被 XSS 读取），不是防 XSS 方案——**接受该风险换取重启不登出的体验**（MVP 阶段，token 为个人 refresh_token，泄露影响限于本人账号；生产加固方向见风险节）。

### 2. 原生 LynxView（#41）：Lynx Native Module 对齐主项目存储

Lynx Native Module 实现 `getItem/setItem/removeItem`，**逐字段对齐**主项目 `@aparajita/capacitor-secure-storage`（`packages/app/node_modules/.../SecureStorage.java`）的实现，保证两个 client（webview / lynx）**登录态共享**：

| 项 | 规格（对齐值） |
|---|---|
| 算法 | `AES/GCM/NoPadding`（GCM 128-bit tag） |
| 密钥 | AndroidKeyStore，alias = prefixedKey（每 key 独立 AES 密钥，PURPOSE_ENCRYPT\|DECRYPT） |
| SharedPreferences 文件 | `"WSSecureStorageSharedPreferences"`（MODE_PRIVATE） |
| 存储 key | `"capacitor-storage_" + key`（JS 端默认前缀）→ 本项目 `"capacitor-storage_refresh_token"` |
| 密文格式 | `Base64(ciphertext) + "\u0010" + Base64(iv)`（NO_PADDING + NO_WRAP） |
| 备份完整性 marker | `"__pictelio_backup_marker"`（前缀后 `"capacitor-storage___pictelio_backup_marker"`） |

Lynx 原生集成（#41）时按此实现 LynxModule（`@LynxMethod`），即可读写主项目已存的 token——`restoreToken()` 原生路径从该存储恢复。

## 权衡

| 方案 | 结论 |
|------|------|
| localStorage | **不可行**——Worker 环境无 localStorage（已实测源码 + 浏览器规范） |
| **IndexedDB（web-core）** | **采纳**。Worker 标准支持，重启恢复登录；XSS 风险与 localStorage 同级（接受） |
| 原生 Keystore（#41 适配主项目） | **采纳（原生路径）**。对齐 `@aparajita` 规格，登录态与主项目共享；不另起炉灶 |
| 维持内存 token | 体验差（每次重启重登），仅作回退 |

## 风险

- **IndexedDB XSS 风险**：refresh_token 落浏览器可被同 origin XSS 读取。缓解：token 有效期短（Pixiv refresh_token 长期有效）→ 泄露影响有限；未来可加二次校验/指纹；原生端（生产）走 Keystore 无此风险。
- **web-core worker 的 IndexedDB 可用性**：标准 Web Worker 支持 IndexedDB（浏览器规范），但 lynx web-core 组合未实测——若不可用降级为不持久化（回退现状），并记录。
- **原生对齐依赖主项目插件实现**：`@aparajita` 升级若改存储格式，Lynx Native Module 需同步；ADR 规格表作为契约，升级时比对。
- **备份 marker 语义**：主项目用 marker 检测备份还原/密钥失效；Lynx 原生读取同样检查。

### 正面

- web-core 重启不登出（体验对齐主项目）
- 原生登录态与主项目共享（client 切换无缝）
- 双环境职责清晰：web-core = 开发预览便利，原生 = 生产安全

### 反面

- web-core 的 IndexedDB 非防 XSS（生产需原生）
- 原生适配依赖主项目存储格式契约

## 相关

- `authStore.ts`（修订"防 XSS 不入库"注释）
- 主项目 `SecureStorage.java`（对齐规格来源）
- `CONTEXT.md` 浏览导航（登录态概念）
- 实施提交：`039f9e2`（web-core 部分）；原生部分待 #41

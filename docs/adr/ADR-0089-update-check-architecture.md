# ADR 0089: 检查更新双端共用——共享检查层 + 客户端各自更新策略

## 状态

已采纳（2026-08-07 落地）

## 分类

功能架构 / 双端共用 / 更新策略

## 日期

2026-08-07

## 背景

app-lynx（Lynx 客户端）此前没有任何更新检查能力；主 app（webview 客户端）已有完整链路（启动自动检查 + 设置页手动检查 + 更新弹窗）。为 lynx 补齐该能力时面临三重差异：

1. **检查逻辑可共用，但必须单一事实源**：版本比较、清单 URL、超时策略、失败兜底如果双端各写一份，升级（如 semver 完整支持）需改两处，必然漂移。
2. **原生 lynx 运行时无 fetch**（web-core 才注入；模拟器 E2E 实测）：检查更新的网络层在原生环境无法复用 webview 的全局 fetch，需要原生网络能力。
3. **交互范式差异大**：webview 是弹窗（可关闭、可忽略记忆、有手动入口）；lynx 用户要求**强制更新**（无法返回，只能下载或退出），且只做自动检查、不做手动入口。

## 决策

### 1. 更新检查共享层 `@pictelio/update-check`（单一事实源）

从主 app 既有 `updateService` 提取为 monorepo 共享包，双端共用，导出面 3 个符号：

- `CheckResult`：`hasUpdate / latestVersion / latestReleaseUrl / latestChangelog / error?`——`error` 字段区分「检查失败」与「无更新」（禁止静默降级）
- `isNewer(local, remote)`：纯函数三段数值版本比较
- `checkForUpdate(localVersion, fetchImpl?)`：拉取版本清单 + 比较 + 10s 超时 + 失败兜底（warn + 安全默认值）

主 app 保留薄 re-export（`@/services/updateService`），避免既有 import 面大改。

### 2. 版本号同源：app 包 version 注入

参与比较的本地版本号**不各自维护**：双端构建期都从 `packages/app/package.json` 的 version 注入（webview `APP_VERSION` / lynx `__APP_VERSION__`）——与 APK versionCode/versionName（`sync-android-version.mjs` 同步）单一事实源一致。lynx 包自身版本（0.1.0）不参与比较。

### 3. 网络 seam：`fetchImpl` 注入 + 原生网络桥

`checkForUpdate` 的 `fetchImpl` 参数是检查逻辑与网络环境解耦的 seam：

- **webview**：缺省用全局 fetch（webview 环境可用）
- **lynx 原生**：`createUpdateFetchImpl()` → `PictelioAppModule.httpGet` 原生桥（OkHttp 共享 client、scheme 白名单 http/https、callTimeout 10s、响应体 1MB 上限、`cb(status, body)` 契约）
- **lynx web-core 预览**：`requestFetch`（环境适配层）

### 4. 更新策略分离：强制更新（lynx）/ 温和更新（webview）

引入**更新策略（update policy）**领域概念，双端各自实现，检查逻辑不感知：

| 维度 | lynx（强制更新） | webview（温和更新） |
|------|------------------|---------------------|
| 展示 | 强制更新页（无返回） | 更新弹窗（可关闭） |
| 返回路径 | 无（返回键 = 退出） | 可关闭继续使用 |
| 忽略记忆 | 无 | `lastDismissedVersion` |
| 手动入口 | 无 | 设置页有 |
| 打开 release | `openUrl` 系统浏览器（独立 task 无法返回） | `window.open` |

### 5. 强制更新页语义（lynx）

- 路由 `/update` 声明 `backBehavior: 'exit'`：系统返回键 = 退出应用（跳过历史栈与双击窗口逻辑，routerCore 纯函数裁决）
- 进入方式：启动检查命中后 `replace` 导航 + 清空历史栈（无处可回）
- 页面无返回按钮；顶部原"返回"位置为「退出应用」（`exitApp`）；唯一主动作「下载新版本」（`openUrl` 系统浏览器）
- 原生桥 Callback 必传（lynx NativeModule 约定，模拟器实测）

### 6. 版本清单契约（既有，固化）

`packages/website/version.json`：`version`（远端版本号）/ `url`（release 页）/ `changelog`（更新内容）。`scripts/release.mjs` 随发布生成；raw.githubusercontent.com 直连（不走 Pixiv 代理）。

## 备选方案（被否）

- **lynx 独立实现检查逻辑**：双份 `isNewer`/`checkForUpdate`，版本比较升级需改两处——放弃单一事实源，否决。
- **编排层全量共用**（把启动检查→导航决策也抽共享）：webview 用 TanStack Router + SolidJS signal、lynx 用内存路由 + Vue ref，导航与状态范式根本不同；编排差异正是更新策略差异的载体——强行共用收益低、耦合高，否决。
- **原生环境用 Java 侧通用 fetch 桥替代 httpGet**：为单一用途引入通用网络抽象，违反"一个 adapter 即假 seam"原则，否决。

## 后果

- 版本比较 / 清单契约 / 超时策略一处改，双端生效（Leverage）；检查逻辑的 bug 修一次（Locality）
- 更新策略各自演进：webview 可加弹窗增强，lynx 可加忽略记忆（二期），互不影响
- 新客户端（如未来 iOS / 桌面）接入成本：实现网络 seam（fetch 或原生桥）+ 自有展示/编排即可复用共享层
- 模拟器 E2E 实测驱动的三处修正（原生无 fetch → httpGet 桥、Android 11+ 包可见性 → `<queries>`、NativeModule Callback 必传）已固化在本 ADR 对应的实现与测试中

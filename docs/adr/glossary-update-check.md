# 检查更新（版本检查）— 术语表

> 范围：`pictelio-app`（webview 客户端）与 `app-lynx`（Lynx 客户端）双端共有的检查更新机制、共享检查层、版本清单契约、更新策略与原生网络适配概念。配套 ADR：[ADR-0065-update-check-architecture.md](./ADR-0065-update-check-architecture.md)。

## 核心术语

| 术语 | 定义 |
|------|------|
| **检查更新（Update check）** | 拉取**版本清单**并与**本地版本号**比较，判定"是否有新版本"的过程。动作本身与展示策略无关，双端共用同一套检查逻辑。 |
| **更新检查共享层（Update-check shared module）** | 双端共用的检查实现 `@pictelio/update-check`（monorepo 包）：导出 `isNewer`（版本比较）、`checkForUpdate(localVersion, fetchImpl?)`（拉取清单 + 比较 + 超时兜底）、`CheckResult`（含 `error` 字段）。是版本比较、清单 URL、超时策略、失败兜底的**单一事实来源**。 |
| **版本清单（Version manifest）** | 机器可读的远端版本信息契约：`packages/website/version.json`，字段 `version`（远端版本号）/ `url`（GitHub release 页）/ `changelog`（更新内容，多行文本）。由 `scripts/release.mjs` 随发布生成，经 raw.githubusercontent.com 直连拉取（不走 Pixiv 代理）。 |
| **本地版本号（Local version）** | 当前安装的 APK 版本，单一事实来源为 **app 包（pictelio-app）的 version**。双端构建期注入为同名编译期常量：webview 侧 `APP_VERSION`（Vite define）、lynx 侧 `__APP_VERSION__`（rspeedy define）。**lynx 包自身版本（0.1.0）不参与比较**——APK 版本号由 `sync-android-version.mjs` 从 app 包同步，用 lynx 包版本会导致"永远提示有更新"。 |
| **更新策略（Update policy）** | 检测到新版本后对用户的**处置策略**，双端各自实现：**强制更新**（无法返回，只能下载或退出）与**温和更新**（可关闭弹窗 + 可忽略版本记忆）。同属"检查更新"能力，策略不同不改变检查逻辑本身。 |
| **强制更新（Forced update）** | lynx 采用的更新策略：进入**强制更新页**后无任何返回路径（页面无返回按钮、系统返回键 = 退出、历史栈清空、下载经系统浏览器打开后也无法返回 app 内），用户只能下载新版本或退出应用。 |
| **温和更新（Soft update）** | webview 采用的更新策略：启动自动检查发现新版本后弹**更新弹窗**（可关闭），设置页另有手动检查入口；用户可忽略（`lastDismissedVersion` 记忆）继续使用旧版本。 |
| **强制更新页（Forced update page）** | lynx 的更新展示页（路由 `/update`，声明 `backBehavior: 'exit'`）：展示新版本号 / 当前版本 / 更新内容，唯一主动作**下载新版本**（经 `openUrl` 打开系统浏览器），顶部原"返回"位置为**退出应用**（`exitApp`）。数据来自启动检查缓存的检查结果，不发新请求。 |
| **更新弹窗（Update dialog）** | webview 的更新展示（`StartupUpdateDialog`）：启动自动检查命中后延迟弹出，含更新内容与"查看更新"动作，可关闭。 |
| **更新检查编排（Update-check orchestration）** | 双端各自的启动时序与状态管理：webview 侧 `__root.tsx` 启动延迟检查 + `settingsStore` 持有检查状态；lynx 侧 `updateStore`（启动延迟检查 → 命中即 replace 导航强制更新页 + 清历史栈 + 下载/退出分发）。**不共用**——双端导航机制（TanStack Router vs 内存路由）与状态范式（SolidJS signal vs Vue ref）不同，强行共用收益低。 |
| **网络 seam（fetchImpl）** | 检查更新的网络层注入点：`checkForUpdate(localVersion, fetchImpl?)` 的第二参。主 app 缺省用全局 fetch（webview 环境）；lynx 传 `createUpdateFetchImpl()`（原生模式走 **原生网络桥**，web-core 预览走 `requestFetch`）。是"检查逻辑与网络环境解耦"的关键 seam。 |
| **原生网络桥（Native HTTP bridge / `httpGet`）** | `PictelioAppModule.httpGet(url, cb)`：lynx 原生 JS 运行时**无 fetch**（web-core 才注入），检查更新在原生环境必须经此桥走 OkHttp 真实网络。契约 `cb(status, body)`——2xx 成功 body 为响应文本，`status=0` 表示网络错误（body 为错误消息）。含 scheme 白名单（http/https）、callTimeout 10s、响应体 1MB 上限（防 OOM）。 |
| **强制打开外部页（`openUrl`）** | `PictelioAppModule.openUrl(url, cb)`：用系统浏览器（`ACTION_VIEW` + `NEW_TASK`）打开 GitHub release 页。外部浏览器为**独立 task**，用户无法从浏览器"返回" app 内（强制更新语义的一部分）。scheme 白名单 http/https，`resolveActivity` 为空（无浏览器/包不可见）时回调错误。 |
| **版本比较（`isNewer`）** | 纯函数三段数值版本比较（major/minor/patch），兼容 `v` 前缀、空白、build metadata、缺段、脏输入。远端大于本地返回 true。 |
| **检查失败降级（Fail-safe）** | 检查失败（网络异常 / 超时 / HTTP 非 2xx / 清单非 JSON / 缺 version 字段）时：`console.warn` + 返回安全默认值（`hasUpdate: false` + `error` 字段携带原因），**不导航、不打扰**，用户正常进入 app。"检查失败"与"无更新"经 `CheckResult.error` 区分（禁止静默降级）。 |

## 双端对称契约速查

| 能力 | webview 侧（pictelio-app） | lynx 侧（app-lynx） |
|------|---------------------------|---------------------|
| 检查逻辑 | `@pictelio/update-check.checkForUpdate`（同） | 同左（共享层） |
| 本地版本号 | `APP_VERSION`（Vite define，读 app 包） | `__APP_VERSION__`（rspeedy define，读 app 包） |
| 网络层 | 全局 fetch（缺省 fetchImpl） | `createUpdateFetchImpl()`：原生 `PictelioApp.httpGet` / web-core `requestFetch` |
| 展示 | 更新弹窗（可关闭 + `lastDismissedVersion` 忽略记忆） | 强制更新页（无返回，退出/下载两出口） |
| 编排 | `__root.tsx` 启动延迟检查 + `settingsStore` 状态 | `updateStore`：启动延迟检查 → replace 导航 `/update` + 清历史栈 |
| 入口 | 启动自动 + 设置页手动 | 仅启动自动（无手动入口） |
| 打开 release 页 | `window.open`（webview 环境） | `PictelioApp.openUrl`（系统浏览器，无法返回） |
| 退出 | 弹窗"知道了"关闭 | `PictelioApp.exitApp`（顶部按钮 + 系统返回键兜底） |

## 易混淆概念辨析

- **"检查更新"（动作）≠ "更新策略"（处置）**：检查是双端共用的能力（共享层完成"是否有新版本"）；策略是检测到更新后"怎么处置用户"的决策（强制 / 温和），由客户端各自实现。检查逻辑不感知策略。
- **强制更新 ≠ 温和更新**：同一"检查更新"能力的两种策略，不是两套检查。lynx 强制（无返回）与 webview 温和（可关）的差异只在**展示与编排**，不在检查逻辑。
- **版本清单 ≠ release 页**：清单（`version.json`）是检查用的机器契约（版本号/URL/changelog）；release 页是用户下载安装包的目标页（`url` 字段指向）。检查比较的是清单 `version`，下载打开的是 `url`。
- **本地版本号 ≠ lynx 包版本**：参与比较的是 APK 版本（app 包 version 注入），lynx 包自身 `0.1.0` 只是包版本，不代表 APK 版本——混用会导致永远提示有更新。
- **检查失败 ≠ 无更新**：失败（网络/超时/解析）带 `error` 字段并 warn；无更新是检查成功但远端不新。两者 `hasUpdate` 均为 false（都不打扰用户），但失败可诊断、可重试，语义必须可区分。
- **原生网络桥 ≠ fetch 替代品**：`httpGet` 是 lynx 原生环境的网络能力补充（原生 JS 无 fetch），不是通用 fetch 实现——仅检查更新等轻量 GET 场景使用（响应体 1MB 上限、10s 超时）。

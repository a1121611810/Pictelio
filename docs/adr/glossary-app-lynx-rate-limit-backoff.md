# app-lynx 限流退避 — 术语表

> 范围：`packages/app-lynx` Pixiv API 客户端限流退避（429 backoff）涉及的域术语。配套 ADR：[ADR-0199](./ADR-0199-app-lynx-rate-limit-backoff.md)。仅 app-lynx；webview（`packages/app`）明确不在域内。
> 输入材料：业界退避配方调研（AWS Exponential Backoff and Jitter、gallery-dl / pixez 等第三方客户端实践，2026-09-28）。

## 限流与退避

| 术语 | 定义 | 别名（避免使用） |
|------|------|------------------|
| **限流（rate limit）** | Pixiv 服务端对请求频率的节制，以 HTTP 429 表达；lynx 客户端分类为 `ApiErrorType.RATE_LIMIT` | throttling；封禁（那是 403/账号处罚，会恢复与否语义不同） |
| **退避（backoff）** | 收到 429 后等待一段时间再重试同一请求的客户端策略；本域默认「指数退避 + 全抖动」整体配方 | 自动重试（裸词，不含等待语义） |
| **指数退避（exponential backoff）** | 第 n 次重试的**名义等待** = `baseDelayMs × 2^n`；倍率恒为 2，不作为配置暴露 | 线性退避（不同物） |
| **全抖动（full jitter）** | 实际等待 = `random(0, min(名义等待, maxDelayMs))`——AWS 配方，把重试时点均匀打散，防多请求齐步撞限流 | 等抖动（equal jitter，不同物）；裸「随机延迟」 |
| **最大延迟（maxDelayMs）** | 名义等待的天花板，指数增长在此时封顶 | cap、上限（裸词） |
| **重试上限（maxRetries）** | 单请求在首次失败后**最多追加**的重试次数；总尝试次数 = maxRetries + 1；耗尽后抛 `RATE_LIMIT` 终态 | 重试次数（歧义：未说明含不含首次） |
| **初始延迟（baseDelayMs）** | 名义等待的基数（n=0 时的名义值），离散档位配置 | 首延迟 |
| **退避参数（backoff params）** | `enabled + maxRetries + baseDelayMs + maxDelayMs` 四元组；设备级设置，Me 页「网络」组可调 | — |

## 宿主与边界

| 术语 | 定义 | 别名（避免使用） |
|------|------|------------------|
| **Pixiv API 客户端（apiClient）** | `packages/app-lynx/src/api/client.ts` 的 `PixivApiClient` 单例；双通道传输（web fetch 代理 / 原生 `PictelioApi` 转发）。**退避唯一挂载点**，双通道行为一致 | HTTP 客户端（裸词） |
| **退避配置 seam（`setRateLimitBackoffConfig`）** | client 模块级注册口（镜像 `setOnUnauthorized` / `setAuthReadyProvider` 既有范式）；settingsStore 装载与用户改参时注入，client 不反向依赖 Pinia | 直接读 store（禁止） |
| **翻译通道 429** | `api/translate.ts` / `api/nativeTranslate.ts` 第三方 LLM 端点的限流，**独立服务独立处理，不在本域** | — |
| **OAuth 刷新限频** | Pixiv token 端点约 30s 限频（401 刷新路径），**本域 v1 不动**（原生侧刷新在 Java，行为另议） | — |
| **重试单点（single retry point）** | 重试语义只存在于 apiClient 一层；vue-query `retry` 恒 false，禁止两层重试叠乘 | 双层重试（禁止） |

## 行为语义

- 退避**只由 429 触发**。NETWORK（无响应）/ SERVER（5xx）不自动重试（维持既有「用户感知错误、手动重试」口径）；UNAUTHORIZED 走既有 401 刷新单飞（`execWithAuthRetry`），与本域正交组合（先鉴权重放、后限流退避由内向外各自生效）。
- 退避等待期间 `AbortSignal` 取消 → 立即中止，不再重试；无 signal 的请求等待到底。GET 去重共享同一 promise = 共享同一次退避过程（不会 N 个调用方各退各的）。
- 退避耗尽后抛出的仍是 `RATE_LIMIT` 终态 `ApiError`（附加实际重试次数），UI 文案与现状同源，仅日志可见重试轨迹（`console.warn`，模块前缀 `[client]`）。
- 参数持久化为设备级键 `settings_rate_limit_*`（native SharedPreferences "CapacitorStorage" / dev IndexedDB，经 `prefs()` seam），进 WebDAV 备份域；装载遇非法值 `console.warn` + 维持默认（禁静默降级，测试硬约束 #3）。

## Flagged ambiguities

- **「重试 N 次」**：本域一律写「重试上限 maxRetries（不含首次请求）」；「重试 3 次」= 最多发出 4 个请求。
- **「限流」≠「封禁」**：429 是频率节制（等待后恢复，客户端可退避重试）；403 FORBIDDEN 是权限问题（重试无意义，本域不重试）。
- **「指数退避」在本域含抖动**：文档/代码注释写「指数退避」时默认指「指数 + 全抖动」配方；谈无抖动变体必须写明「等抖动 / 无抖动」。
- **`enabled=false` 的语义**：关掉的是「自动退避重试」，不是「限流检测」——429 仍照常分类为 `RATE_LIMIT` 并即刻抛出（行为与现状完全一致）。

## Example dialogue

> **Dev:** 设置里「重试上限 = 3」的时候，一次 429 最多发几个请求？
> **Domain:** 4 个——**重试上限**不含首次；第 1 次请求 + 最多 3 次**退避**重试，每次等待 = **全抖动**打散后的名义值，封顶**最大延迟**。
> **Dev:** 等待的时候用户下拉刷新了，旧请求还在等吗？
> **Domain:** 不等了。带 `AbortSignal` 的请求在**退避**等待中被取消就立即中止；下拉刷新发起新请求是另一条生命周期，与旧 promise 无关。
> **Dev:** webview 端也要做吗？
> **Domain:** 不做。本域仅 app-lynx，webview 侧 429 维持现状（直接报错），双端不对称是本 ADR 拍板的结构边界。

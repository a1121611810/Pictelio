# ADR-0199：app-lynx Pixiv API 限流退避——429 指数退避 + 全抖动，参数设置可调

- 状态：Accepted（已采纳）
- 日期：2026-09-28
- 关联：[glossary-app-lynx-rate-limit-backoff.md](./glossary-app-lynx-rate-limit-backoff.md)（术语表）、ADR-0141（app-lynx QueryClient：`retry: false` 既定决策，本 ADR 保持不动）、ADR-0103（设备级设置键 / `prefs()` seam）、spec `docs/specs/lynx-rate-limit-backoff.md`
- 输入材料：业界限流退避调研（2026-09-28，联网查证）：[AWS Exponential Backoff and Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)、[Azure Retry pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/retry)、[GitHub REST 最佳实践](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)、[Octokit plugin-retry](https://github.com/octokit/plugin-retry.js)（默认 3 次）、[gallery-dl configuration.rst](https://github.com/mikf/gallery-dl/blob/master/docs/configuration.rst)（`sleep-429` 默认 60s + `sleep-request` 0.5–1.5s 主动限速）、[pixez-flutter RefreshTokenInterceptor](https://github.com/Notsfsssf/pixez-flutter/blob/master/lib/network/refresh_token_interceptor.dart)（刷新节流防死循环，无全局 429 退避）、[MDN Retry-After](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Retry-After)

## 背景

app-lynx 的 Pixiv API 客户端（`packages/app-lynx/src/api/client.ts`）已把 HTTP 429 分类为 `ApiErrorType.RATE_LIMIT`，但**直接抛给上层**：vue-query `retry: false`（ADR-0141），用户看到「请求过于频繁，请稍后重试」红字后手动重试。Feed/搜索等高频请求窗口下，一次 429 会让整页失败；而 Pixiv 的限流是频率节制（等待后恢复），等待重试恰是正确姿势。

业界调研结论（决定方案形态）：

1. **标准配方收敛**：capped exponential backoff + **full jitter**（AWS）；默认参数高度一致——初始 ~1s、倍率 2、封顶 20–60s、最多 3 次（Octokit / Azure / AWS SDK）。
2. **Pixiv 第三方客户端无现成全局方案可抄**：gallery-dl 是 CLI 工具（429 固定等 60s + 请求间主动限速）；pixez-flutter 只做了 token 刷新节流（200s 门 + "Limit" 即停防死循环），未做全局 429 退避；Pixeval / PixivPy 未找到公开实现。
3. **设置页只该暴露「效果类」参数**（启用/重试次数/等待档位），算法类参数（jitter 策略、倍率、错误码分类表）误配会直接导致重试风暴或加剧限流——gallery-dl 全暴露是因为它是极客 CLI。
4. **Retry-After 惯例**是「有则优先」，但 lynx **原生通道回调契约是 `(status, data, rotatedRefreshToken)`，没有响应头**——web 模式能拿到、原生模式拿不到。

## 决策

**D1 挂载点 = apiClient 传输层，双通道行为一致；重试单点。**
退避包装在 `client.ts` 的 execute 内层（`execWithAuthRetry` 之外、transport 之内），`get`/`post`/`requestRaw` 全覆盖，web fetch 与原生 `PictelioApi` 两通道走同一包装。vue-query `retry` **恒为 false 不变**（ADR-0141）——重试语义单点归 apiClient，禁止两层重试叠乘。

**D2 触发条件 = 仅 429（`ApiErrorType.RATE_LIMIT`）；v1 不处理 Retry-After。**
只对限流退避——这是本次命题，也是「实施范围不扩散」约束：5xx / 网络错误自动重试改变弱网体验语义（失败要快、用户手动重试），留独立立项。Retry-After v1 不做：原生回调无响应头，单侧（web）支持会造成双通道行为分叉，跨通道一致性优先；Pixiv app-api 限流响应实测亦不依赖它。两者都记入 Future work。
401 与退避**正交组合**：`execWithAuthRetry`（外层，鉴权重放一次）包着退避（内层），互不干扰——既有 POST 401 重放先例证明重放安全。

**D3 算法 = capped exponential + full jitter，倍率与 jitter 不暴露配置。**
`delay = random(0, min(maxDelayMs, baseDelayMs × 2^attempt))`（AWS full jitter）。倍率恒 2、jitter 恒 full——调研 §5：算法类参数不进设置页。默认值：`baseDelayMs = 1000` / `maxDelayMs = 30000` / `maxRetries = 3`（Octokit/Azure 惯例；gallery-dl 的 60s 对移动端交互过保守，30s 取其半）。耗尽后抛 `RATE_LIMIT` 终态 `ApiError`（`params.attempts` 记录实际重试次数），UI 文案与现状同源。

**D4 设置暴露 = 四个效果类参数，设备级键，经 seam 注入。**
键（lynx 设备级，native SharedPreferences "CapacitorStorage" / dev IndexedDB，经 `prefs()` seam，进 WebDAV 备份域 `BACKUP_DEVICE_KEYS`）：

| 键 | 默认 | 允许值 |
|---|---|---|
| `settings_rate_limit_backoff_enabled` | `true` | `true` / `false` |
| `settings_rate_limit_max_retries` | `3` | 整数 0–5（空串/纯空白视为非法——`Number("") === 0` 恰是合法档位，须显式排除） |
| `settings_rate_limit_base_delay_ms` | `1000` | `500` / `1000` / `2000` / `5000` |
| `settings_rate_limit_max_delay_ms` | `30000` | `10000` / `30000` / `60000`（档位恒 ≥ base 档位，无倒挂） |

装载校验失败（缺键除外）`console.warn` + 维持默认（禁静默降级，测试硬约束 #3）。client 侧新增模块级注册口 `setRateLimitBackoffConfig()`（镜像 `setOnUnauthorized` / `setAuthReadyProvider` 既有范式），settingsStore 装载与改参时注入——client 不反向依赖 Pinia。`enabled = false` = 回到现状（429 立即抛出，零重试）。UI = Me 页新增「网络」组（开关 + 三个离散档位选择行）。

**D5 交互语义。**
退避等待期间 `AbortSignal` 取消 → 立即中止不重试；GET 去重共享同一 promise = 共享同一次退避（不放大请求量）；每次退避重试 `console.warn`（`[client]` 前缀）留痕。POST 一并退避：429 = 请求被限流器拒绝、未达业务层，重放安全（业界口径与 401 重放同侧）。

**D6 范围边界。**
仅 app-lynx；webview（`packages/app`）不动，双端不对称是拍板的结构边界。翻译通道 429（第三方 LLM 端点，`api/translate.ts`）与 OAuth 刷新端点限频（pixez 式刷新节流）**不在本域**，留独立立项。主动限速（gallery-dl `sleep-request` 式请求间隔）不做——移动端单用户低并发，被动退避够用（调研 §4）。

**D7 测试防线。**
纯函数模块 `api/rateLimitBackoff.ts`（延迟计算：随机注入、封顶、档位归一）独立单测；`client.test.ts` 增双通道重试行为（fake timers：重试序列、耗尽终态、开关关闭零重试、abort 中止、401+429 组合）；`settingsStore.test.ts` 增装载/持久化/非法值 warn/备份域键清单断言；Me 页模板测试 + `ME_A11Y_LABELS` 注册表严格配平（既有不变量自动接管）。

## 风险与边界

| # | 风险 | 处置 |
|---|------|------|
| R1 | 退避重试加剧限流（重试风暴） | full jitter 打散 + maxRetries 上限（最坏单请求 4 次尝试）+ maxDelay 封顶三重防；GET 去重让**无 signal 的**并发调用方共享同一退避（带 signal 的调用不参与去重——共享 promise 会让一方 abort 取消所有人，属既有取舍；此类调用各自独立退避） |
| R2 | 弱网/被限流时请求「变慢」的感知 | 等待只发生在 429（服务端明确要求等待）；`enabled` 开关一键回现状；耗尽后错误信息带实际重试次数，UI 可解释 |
| R3 | POST 重放的副作用疑虑 | 429 意味着请求未达业务层，无副作用可言；401 对 POST 重放（`execWithAuthRetry`）已是既有先例 |
| R4 | 设置误配（如 0 次重试） | 全部为离散档位选择（无自由输入），装载校验 warn + 维持默认；`maxDelay` 档位集恒 ≥ `baseDelay` 档位集，无倒挂配置 |
| R5 | 原生通道 Java 侧行为漂移 | 本 effort 零 Java 改动（原生回调契约不动）；429 在 Java 侧按现状透传 status |
| R6 | `AbortSignal.reason`（退避等待取消拒因）为 lynx 运行时平台面，无设备取证 | 已用 `?? new Error("aborted")` 兜底（最坏退化为通用拒因，行为不破）；`addEventListener("abort")` 有在仓先例（updateStore / nativeTranslate）。下次设备 spike 补一句取证，或删 `.reason` 直用兜底 |

## Future work（不在本 ADR 承诺）

- Retry-After 支持（需原生回调契约扩展 headers，双通道同步）
- 5xx / 网络错误的退避重试（独立立项，需重估弱网体验语义）
- OAuth 刷新端点限频节流（pixez 式刷新门）
- 主动请求间隔（gallery-dl `sleep-request` 式）

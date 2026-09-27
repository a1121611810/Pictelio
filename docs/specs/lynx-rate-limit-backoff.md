# Spec：app-lynx 限流退避（429 Backoff）

> 状态：implemented ｜ 日期：2026-09-28 ｜ 依据：[ADR-0199](../adr/ADR-0199-app-lynx-rate-limit-backoff.md) + [术语表](../adr/glossary-app-lynx-rate-limit-backoff.md) ｜ issue：#777
> 范围：仅 app-lynx（packages/app-lynx）；webview 不动。零 Java 改动。

## Problem Statement

用户连续浏览（Feed/搜索/排行榜高频请求）触发 Pixiv 限流（HTTP 429）时，lynx 客户端把「请求过于频繁」直接抛成整页红字，需要用户手动重试。限流是频率节制（等待后即可恢复），自动等待重试才是正确姿势；且退避参数（重试几次、等多久）应交由用户按自己的网络与使用习惯调整。

## Solution

在 lynx 的 Pixiv API 客户端传输层加「429 限流退避」：收到 429 后按「指数退避 + 全抖动」配方自动等待并重试（默认最多 3 次，初始等待 1s、封顶 30s）；Me 页新增「网络」组暴露效果类参数（开关、最大重试次数、初始等待档位、最长等待档位），设备级持久化并进 WebDAV 备份域。非限流错误行为不变；webview 客户端不受影响。

## User Stories

1. 作为 lynx 用户，我连续浏览触发 Pixiv 限流（429）时，希望 app 自动等待后重试，这样页面不直接报红字。
2. 作为 lynx 用户，我希望自动重试有次数上限（默认 3 次），这样不会无限等待或转圈。
3. 作为 lynx 用户，我希望在 Me 页「网络」组看到限流退避开关，并能一键关闭回到「429 立即报错」的旧行为。
4. 作为 lynx 用户，我希望调整最大重试次数（0–5），按我对等待的容忍度权衡。
5. 作为 lynx 用户，我希望选择初始等待档位（0.5s/1s/2s/5s），保守或激进由我定。
6. 作为 lynx 用户，我希望选择最长等待档位（10s/30s/60s），避免极端情况等太久。
7. 作为 lynx 用户，我希望这些参数重启 app 后保留。
8. 作为 lynx 用户，我希望参数随 WebDAV 备份/恢复迁移到新设备。
9. 作为 lynx 用户，我在退避等待期间离开页面（请求被 abort），希望旧请求立即中止、不再重试，不浪费流量。
10. 作为 lynx 用户，429 重试耗尽后，我希望仍看到清晰的限流错误提示（而不是笼统的失败）。
11. 作为 lynx 用户，我希望网络断开 / 服务器错误等非限流错误保持现状（立即报错、手动重试），不被自动重试掩盖而拖长等待。
12. 作为 lynx 用户，我希望登录过期（401）行为完全不变（自动刷新后重放一次）。
13. 作为 lynx 用户，我希望真机（原生通道）与开发预览（web 通道）的退避行为一致。
14. 作为 lynx 用户，我希望设置里只有效果类参数（开关/次数/两档等待），不出现抖动策略、增长倍率等算法术语，简单可控。
15. 作为 webview 客户端用户，我希望 lynx 的这一改动不影响 webview 的任何行为。
16. 作为使用翻译（LLM）功能的用户，我希望翻译通道的限流行为不受本功能影响。
17. 作为 lynx 用户，我希望同一请求的并发调用共享一次退避过程，而不是每个调用方各自重试放大请求量。
18. 作为 lynx 用户，我改完参数后希望立即生效，不需要重启 app。

## Implementation Decisions

- **重试单点**：退避包装在 API 客户端传输层内层（401 鉴权重放的外层之下），GET/POST/原始文本请求全覆盖；两条传输通道（web fetch 代理 / 原生转发）走同一包装。vue-query 的 retry 恒为 false 不变（ADR-0141），禁止两层重试叠乘。
- **触发条件**：仅限流错误（HTTP 429）。网络错误 / 5xx / 403 / 404 等维持现状直接抛出。
- **算法**：capped exponential + full jitter——`delay = random(0, min(maxDelayMs, baseDelayMs × 2^attempt))`（AWS 配方）；倍率恒 2、jitter 恒 full，不暴露配置。默认 baseDelayMs=1000 / maxDelayMs=30000 / maxRetries=3（总尝试 = maxRetries + 1）。
- **纯函数模块**：延迟计算独立为纯函数模块（入参：尝试序数 + 参数 + 随机源注入），client 消费其产出；便于边界单测。
- **配置 seam**：client 模块级注册口（镜像既有 setOnUnauthorized / setAuthReadyProvider 范式），settingsStore 装载与改参时注入；client 不反向依赖 Pinia。默认配置在纯函数模块内定义，未注入时 client 行为 = 默认参数退避。
- **设置四键**（设备级，prefs seam，进备份域设备键清单）：`settings_rate_limit_backoff_enabled`（默认 true）/ `settings_rate_limit_max_retries`（默认 3，0–5 整数）/ `settings_rate_limit_base_delay_ms`（默认 1000，档位 500/1000/2000/5000）/ `settings_rate_limit_max_delay_ms`（默认 30000，档位 10000/30000/60000；档位集恒 ≥ base 档位集）。装载遇非法值 console.warn + 维持默认（禁静默降级）。
- **Me 页「网络」组**：开关行（M3Switch）+ 三个离散档位选择行（chip 形态，镜像自动备份周期行范式）；新增 i18n 域键（zh/en 双份）与 a11y 标签注册表条目（严格配平不变量自动接管）。分组卡位置：客户端组之后、外观组之前。
- **交互语义**：退避等待期 AbortSignal 取消 → 立即中止；GET 去重（无 signal 的调用）共享同一 promise（共享退避）；每次退避重试 console.warn（模块前缀）留痕；耗尽后抛限流终态 ApiError，params 记录实际重试次数。参数变更即时生效（store 注入，无需重启）。
- **零 Java 改动**：原生回调契约（status/data/rotated）不动。

## Testing Decisions

- 好测试 = 只测外部行为：从 client 公共 API 观测「429 → 等待 → 重试 → 成功/终态」的时序与次数，不窥探内部调用细节。
- **纯函数单测**：延迟计算（随机注入）——上界封顶、随尝试序数指数增长、random=0 下界、档位归一；先例：包内既有纯函数测试。
- **client 行为单测**（fake timers）：重试序列与次数、耗尽终态（含 attempts 参数）、开关关闭零重试、abort 中止、非 429 不重试、401→刷新→429 组合、双通道各一遍；先例：client 既有测试的 stubGlobal fetch / NativeModules 模式。
- **settingsStore 单测**：装载成功 / 非法值 warn 维持默认 / 写入持久化 + seam 注入调用、备份导出导入键清单断言（先例：既有设备键清单断言）；IO 边界硬约束——prefs 读写成功+失败双路径。
- **Me 页模板测试**：网络组渲染 + 开关/档位行存在 + a11y 标签配平（先例：既有 Me 页模板测试族）。
- 期望值溯源：退避公式与默认值以 ADR-0199 D3/D4 表为 oracle，不做自洽反推。

## Out of Scope

- webview（packages/app）同能力（双端不对称为本 ADR 拍板边界）
- Retry-After 响应头（原生回调无 headers；需契约扩展，Future work）
- 5xx / 网络错误自动重试（独立立项，需重估弱网体验语义）
- OAuth 刷新端点限频节流（pixez 式刷新门）
- 主动请求限速（请求间隔）
- 翻译（LLM）通道的限流处理
- 任何 Java/原生侧改动

## Further Notes

- 429 重放的副作用安全论据：限流器在业务层之前拒绝请求，无副作用；401 对 POST 重放已是既有先例。
- 退避等待发生在「服务端明确要求等待」的场景，弱网感知风险有限；开关一键回现状是最终兜底。
- 模拟器验收口径：Me 页网络组可见可调、重启持久化、默认开启下 Feed 正常浏览、logcat 无异常 warn。
- abort 中止路径已直测（code-review 闭环补）：client 级 signal 透传 + fake timers（等待期 abort → 立即中止、不再重试、无定时器残留）+ 退避等待实现三态（先验已 abort / 等待中取消 / 定时自然到期）；档位集不变量（maxDelay 最小档 ≥ base 最大档）有机器断言。
- 已知既有行为（非本 effort 引入，未改）：abort 发生在 **fetch 飞行中**（非退避等待期）时，执行层把 DOMException 归为 `UNKNOWN`；属 signal 透传的既有处理，留独立立项。

# spec: 图床 http:// 镜像 native 校验拦截 + 存量 migrate 停用

> 2026-09-06 · follow-up（ADR-0143 review P3 #5）· 决策记录：Q1 native 校验拦截 / Q2 存量 migrate 置停用 + warn / manifest 不放行 cleartext

## Problem Statement

图床设置页允许输入 `http://` 镜像地址，但 Android 9+（本项目 minSdk 28、targetSdk 36、manifest 未开 `usesCleartextTraffic`）系统默认拒绝一切明文 HTTP 请求——用户保存的 `http://` 镜像在原生端**永远无法生效**，且无任何 UI 感知（仅日志可见），属于「保存成功但永不生效」的死配置。

## Solution

在配置产生前拦截：native 环境下图床校验强制 `https://`（错误文案引导改用 https）；Web/dev 模式保留 `http://`（浏览器无此限制）；存量已保存的 `http://` 配置在启动时自动置为未启用并输出可见告警；不放行 manifest cleartext（全局明文放行是安全倒退，明确否决）。

## User Stories

1. As 一个原生用户，我输入 `http://` 镜像地址保存时被明确告知「Android 禁止明文 HTTP，请使用 https:// 镜像」，所以不会再保存一个永远无效的配置。
2. As 一个原生用户，我升级后曾配置过的 `http://` 镜像被自动停用并有日志说明，所以死配置不再默默参与下载决策。
3. As 一个原生用户，我把该镜像的 URL 改成 `https://` 后可以重新启用，所以修正路径通畅。
4. As 一个 Web/开发模式用户，我本机的 `http://` 镜像场景不受影响，所以开发体验零回归。
5. As 一个维护者，校验与迁移规则有单测钉住平台差异，所以未来不会悄悄回退。

## Implementation Decisions

- **校验拦截（单点）**：图床 URL 校验纯函数增加平台参数（默认取运行时平台判定）：native 且协议为 `http:` → 返回错误「Android 禁止明文 HTTP，请使用 https:// 镜像」；Web 透传。既有调用方（设置页新增/编辑保存口）签名不变。
- **存量 migrate**：图床 store 的持久化 migrate 钩子内，native 环境将 `baseUrl` 为 `http://` 的 host `enabled` 置 false 并 `console.warn`（带模块前缀，仅在实际发生停用时告警）；幂等（已停用的重复 hydrate 不重复告警语义）。Web/dev 不迁移。
- **不改 manifest**：`usesCleartextTraffic` 保持缺省（拒绝明文）。
- **下载层零改动**：镜像失败回退官方的兜底（ADR-0143 D4）继续作为最后防线。

## Testing Decisions

- 校验纯函数：native=`http://` 拒绝 / native=`https://` 通过 / Web=`http://` 通过 / 既有规则（空名、非法 URL、官方域）零回归——平台判定注入，不触全局单例。
- migrate：native 下 `http://` host 被置停用 + warn、`https://` host 不动；Web 下全部不动；幂等（二次 hydrate 不再告警）。fixture 对齐图床 store 真实持久化形状（先例 ImageHostConfigTest）。
- 先例：`tests/unit/services/imageHostService.test.ts`、`tests/unit/stores/imageHostStore.test.ts`。

## Out of Scope

- manifest cleartext 放行；设置页对「探测不可达」的 UI 增强；lynx 侧图床 UI（不存在）。

## Further Notes

- 改动约 30 行 + 单测；单 ticket 不拆分。

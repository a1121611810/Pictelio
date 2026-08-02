# ADR 0053: Lynx NativeModule 契约与原生双模式适配（access_token 隔离）

## 状态

已采纳（真机验证通过）

## 分类

技术决策 / 安全 / 架构

## 日期

2026-08-02

## 背景

app-lynx 在原生 LynxView 运行需要与 web-core 预览完全不同的网络/认证通道：

1. **web-core（dev 预览）**：JS 直接 fetch，走 dev server 代理的相对路径（`/pixiv-api`、`/pixiv-oauth`）；access_token 在 JS 内存。
2. **原生 LynxView**：无 dev proxy；access_token 按主项目 ADR-0037 约束应 Java 堆隔离（JS 零知）。

真机实测（OPPO R11s）暴露了三层断裂：JS 相对路径请求在原生报 `no scheme`；`globalThis.NativeModules` 探测失效；NativeModule 回调传 null 参数导致 `CallbackImpl` 崩溃。

## 决策

### 1. 原生环境探测：`NativeModules` 双通道（裸全局 + globalThis）

lynx runtime 的 `NativeModules` 是**全局内置对象**（官方文档 `declare let NativeModules` 直接引用），**不在 `globalThis` 上**（真机 99900 证明）。所有探测统一用 `isNativeMode()` / `getNativeModules()`：

```ts
export function isNativeMode(): boolean {
  return typeof NativeModules !== "undefined" || !!globalThis.NativeModules
}
```

### 2. NativeModule 回调契约：禁止 null 参数

`com.lynx.react.bridge.CallbackImpl` 对 null 参数抛异常（`JavaOnlyArray.of(null)` 崩，真机实测）→ **成功回调传 `cb()` / `cb(value)`，错误回调传 `cb(errMsg)`（单参 string）**；JS 侧用「首参空串 = 无错误」约定（`err` 为空串/undefined 视为成功）。

涉及 Module：`PictelioSecureStorage`、`PictelioApp`、`PictelioAuth`、`PictelioApi`（均遵守该契约）。

### 3. 原生模式 URL 直连（绝对 URL）

`rewriteUrl` / `shouldAttachAuth` 原生分支：相对 API 路径拼 `https://app-api.pixiv.net` 前缀，OAuth 用 `PIXIV_AUTH_BASE`；`/pixiv-img` 相对路径**原样透传**（由原生 `PictelioImageService` 重写）。web-core 分支保持 dev proxy 相对路径不变。

### 4. access_token Java 堆隔离（PictelioAuth / PictelioApi）

- **PictelioAuth.loginWithRefreshToken**：Native OAuth 交换（复用 `PixivApiPlugin.oauthTokenExchange`），access_token 只写 Java 堆（`PixivApiPlugin.accessToken`），回调仅返回 userId/userName/account/profileImageUrls/newRefreshToken——**JS 永不持有 access_token**。
- **PictelioApi.request**：JS 传 method/path/body，Java 附加 Bearer + Referer/UA + 401 自动刷新；回调第三参携带轮换后的 refresh_token（JS 持久化 Keystore，避免旧 token 硬失败）。
- **登出清堆**：`logout()` 调 `PictelioAuth.clearTokens` 清 Java 堆。
- **登录失败分级**：仅凭证类错误（err 含「凭证」/「invalid」）标永久失效；网络/解析类允许重试。
- **webview 零回归**：`executeRequest` 增加 `RefreshTokenRotationListener`（webview 传 notify lambda 保留 `refreshTokenRotated` 事件，Lynx 传 null）。

## 验证

- 单测：app-lynx 54（含原生分支转发/4xx 分类/JS 零知/登录成败/logout 清堆/轮换持久化）；android 全量单测 + assembleDebug
- 真机：`lynx-flow-check.sh` 全自动 PASS（Native OAuth 登录 → API 转发 → 图片）
- security-review 无阻塞（无 token 泄漏路径、无 token 日志——注：lynx 框架 method_invoker 日志会打印方法参数含 refresh_token，debug 构建可见，非本项目引入，release 可关 verbose）

## 相关

- 提交：`b9fe2c7`（URL/NativeModules 探测）、`d3f5aa1`（callback 去 null）、`619a728` + `d199c28`（#53 token 隔离）
- 研究：`docs/research/lynx-android-brownfield-integration.md` §4
- 术语：`glossary-app-lynx-native.md`

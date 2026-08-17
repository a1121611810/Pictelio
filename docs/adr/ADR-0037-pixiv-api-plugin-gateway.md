# ADR 0037: PixivApiPlugin 网关架构

## 状态

已接受（2026-07-29）

## 背景

Pictelio 的通信架构存在三个问题：

1. **access_token 在 JS 内存中明文** — `client.ts` 将 token 存在模块级变量中，WebView XSS 可窃取
2. **图片首次加载产生 3 次 JS 堆拷贝** — `fetch → Blob → FileReader → base64 → JSBridge → 写盘`
3. **API 请求有三条路径** — `CapacitorHttp` / `PictelioHttp (DoH DNS)` / `fetch` (Vite 代理)

旧架构：

```
JS → CapacitorHttp / PictelioHttp / fetch → Pixiv API
JS → fetch → Blob → FileReader → base64 → JSBridge → 写盘（图片）
```

## 决策

将所有 Pixiv API 请求和图片下载统一由 Java 侧完成，前端只通过 JSBridge 传递请求参数和 URL 字符串。

### PixivApiPlugin 网关

新建 Android Capacitor 插件 `PixivApiPlugin`，作为前端与 Pixiv API 的唯一网关：

- **API 请求**：`PixivApi.request({ method, path, params, body })` → Java 注入 Bearer token → OkHttp 发送 → 返回 JSON 字符串
- **401 自动刷新**：Java 侧检测 401 → 内部用 refresh_token 交换新 token → 重试一次。`synchronized` + `isRefreshing` 标志防止并发刷新风暴
- **access_token 管理**：存储在 Java `volatile` 字段中，**永不返回给 JS**
- **refresh_token 管理**：首次登录时由 JS 传入，存入 SharedPreferences，后续轮换在 Java 侧完成

### 图片管道

- **预缓存**：`PixivApi.prefetchImage({ url })` → Java 侧 OkHttp 下载（注入 Referer）→ 直接写入磁盘缓存目录 → 二进制不进 JS 堆
- **渲染**：`<img src="/pixiv-img/xxx">` → `shouldInterceptRequest` 拦截 → 先查磁盘缓存 → 未命中则从 CDN 下载并流式返回 + 后台写缓存
- **缓存文件名**：统一使用 `Base64.encodeToString(url.getBytes(), URL_SAFE | NO_PADDING | NO_WRAP)`

### client.ts 简化

- 删除 `CapacitorHttp`、`PictelioHttp`、`useDnsOverride` 三条路径
- 删除 `accessToken`/`refreshAuth`/`rewriteUrl` 等约 120 行废弃代码
- 保留 GET 请求去重（`inflightGetRequests`）、错误分类（`classifyError`）
- DEV 模式保留 `devAccessToken` + `fetch` + Vite 代理路径，`import.meta.env.DEV` 编译期分隔

### 安全策略

- **access_token**：仅 Java 堆可见，JS bundle 中零引用（`import.meta.env.DEV` 保护死代码消除）
- **refresh_token**：首次登录过 JS，后续轮换在 Java SharedPreferences 中
- **OAuth 凭证**：仅存在于 Java 字节码（`OAuthConfig.java`，由 `credentials.json5` 自动生成）
- **PluginCall**：异步回调中使用 `bridge.saveCall()`/`bridge.releaseCall()` 确保生命周期安全

## 影响

### 正面

| 维度 | 变化 |
|------|------|
| 安全性 | access_token 零次进入 JS 堆 |
| 内存 | 图片二进制零字节进 JS 堆，每 20 张图省 ~18MB 瞬时峰值 |
| 可维护性 | API 请求从 3 条路径 → 1 条，`client.ts` -120 行 |
| 架构清晰度 | 前端只传 path/URL 字符串，Java 处理所有 HTTP 逻辑 |

### 负面

- 图片首次加载需要先经过 `prefetchImage`（JSBridge）通知 Java 下载，比旧架构多一次 JSBridge 往返（~0.3ms）
- `shouldInterceptRequest` 缓存检查增加磁盘 I/O（但命中后零网络）
- 需要维护两套 access_token：Java 堆（PixivApiPlugin）+ JS `devAccessToken`（仅 DEV 模式）

## 替代方案

### 方案 A：WebMessageChannel（已拒绝）
Capacitor 插件生态完全依赖 `@JavascriptInterface`，改用 WebMessageChannel 会导致 4 个现存插件全部失效，且国内厂商 WebView 兼容性不确定。

### 方案 B：Worker + Transferable（已拒绝）
Pictelio 的 JSBridge 数据（0.1-50KB JSON）远小于 Transferable 的适用区间（MB+ 二进制），且 Capacitor bridge 只接受 JSON，Transferable ArrayBuffer 仍需 JSON 序列化。

### 方案 C：evaluateJavascript（已拒绝）
单向通道，无法满足双向通信需求，且字符串拼接有注入风险。

## 与现有 ADR 的关系

- 废弃 [ADR-0002](0002-ssrf-url-whitelist-strategy.md)（PictelioHttp 白名单不再需要）
- 废弃 [ADR-0004](0004-401-concurrent-retry-promise-queue.md)（JS 侧 401 刷新移至 Java）
- 废弃 `docs/adr/ADR-0090-image-cache-three-layer.md` 中 JS 侧下载→base64→写盘的路径
- 保留 `docs/adr/0014-l1-image-cache-key-set.md`（L1 key set 仍用于 JS 侧加载标记

## 术语表

| 术语 | 定义 |
|------|------|
| PixivApiPlugin | Java Capacitor 插件，Pixiv API 请求的唯一网关 |
| prefetchImage | Java 侧图片预缓存方法，二进制不进 JS 堆 |
| devAccessToken | 仅 DEV 模式使用的 JS 侧 access_token，生产构建被 Oxc minifier 消除 |
| shouldInterceptRequest | Android WebViewClient 方法，拦截图片请求并代理到 Pixiv CDN |
| OAuthUtils | Java 共享工具类（md5Hex、urlEncode、URLSearchParams） |

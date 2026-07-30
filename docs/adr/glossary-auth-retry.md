# 认证重试与 Token 生命周期 — 术语表

## 核心术语

| 术语 | 定义 |
|------|------|
| **tokenReady** | 一个 Promise barrier，在首次 token 刷新完成后 resolve。所有 API 请求在 `nativeExecuteRequest` 入口处 await 此 barrier。确保 token 就绪前没有请求到达 Pixiv API。 |
| **authPermanentFailure** | 一个布尔标记，在 token 刷新失败（refresh_token 无效/过期）时设为 `true`。标记后后续请求立即失败，不发送网络请求。 |
| **refreshPromise** | 一个 Promise，代表正在进行的 token 刷新操作。用于并发 401 去重：第一个遇到 401 的请求创建此 promise，后续 401 请求等待同一个 promise。 |
| **onUnauthorized** | `authStore` 注册的回调。`client` 层在收到 UNAUTHORIZED 错误时调用。内部执行 `performRefresh`（token refres h）或 `logout`（refresh_token 也无效时）。 |
| **401 concurrent dedup** | 多个请求同时收到 401 时，仅第一个触发 token 刷新，其余等待 `refreshPromise`。防止单次使用型 refresh_token 被多次消费导致失效。 |
| **exec()** | `nativeExecuteRequest` 内部的异步函数，封装实际的 HTTP 请求逻辑（含 URL 重写、header 注入、状态码分 类）。不包含重试逻辑。 |
| **retry-once** | UNAUTHORIZED 错误处理策略：token 刷新成功后对原始请求重试一次。重试再次失败时直接抛出错误，不进入二次刷新循环。 |

## 请求执行流程

```
nativeExecuteRequest(path)
  │
  ├── 1. 检查 authPermanentFailure → true → 立即 throw "认证已失效"
  │
  ├── 2. await tokenReady → 等待首次 token 刷新完成
  │
  ├── 3. exec() → 发送真实 HTTP 请求
  │
  └── 4. catch UNAUTHORIZED:
        ├── refreshPromise 已存在 → await 已有 promise（并发去重）
        ├── refreshPromise 不存在 → 创建新 promise：
        │     onUnauthorized() → performRefresh
        │       ├── 成功 → resolve promise → retry exec()
        │       └── 失败 → logout():
        │           ├── authPermanentFailure = true
        │           ├── tokenReady = Promise.resolve()（解锁等待者）
        │           ├── queryClient.clear()
        │           └── isLoggedIn(false) → __root.tsx 检测到 → 跳转 /login
        └── 重试后再次失败 → throw err（不二次重试）
```

## 状态标记生命周期

```
应用启动
  │
  ├── authPermanentFailure = false
  ├── tokenReady = Promise.resolve()（默认已就绪）
  │
  ├── initializeAuth():
  │     ├── tokenReady = new Promise (未 resolve)
  │     ├── performRefresh(token)
  │     │     ├── 成功 → resolve tokenReady
  │     │     └── 失败 → logout():
  │     │           ├── authPermanentFailure = true
  │     │           ├── tokenReady = Promise.resolve()
  │     │           └── queryClient.clear()
  │     └── resolve tokenReady
  │
  └── 正常运行期间:
        └── token 过期
              └── API 返回 401/400 OAuth
                    ├── onUnauthorized → performRefresh
                    │     ├── 成功 → retry request ✓
                    │     └── 失败 → logout() → 跳转登录页
                    └── refreshPromise 管理并发 401
```

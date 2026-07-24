# ADR 0028: 消除 auth.ts / pkceAuth.ts 中的 OAuth 传输层重复

## 状态

已批准 — 立即执行

## 分类

重构

## 日期

2026-07-17

## 背景

`auth.ts` 与 `pkceAuth.ts` 的 DEV 模式分支各自独立实现了完整的 OAuth token HTTP 请求流程：

- SparkMD5 哈希计算（`X-Client-Time` + `X-Client-Hash` 头）
- `URLSearchParams` body 构建（`client_id`, `client_secret`, `get_secure_url`）
- `fetch` 调用（URL、headers、credentials 配置）
- 响应解析 + 错误处理
- `extractAuth()` 调用 + `setAccessToken()` 调用

`auth.ts:58-104` 与 `pkceAuth.ts:72-118` 约 **80 行**中 ~70 行完全一致，仅 `grant_type` 和额外参数（`refresh_token` vs `code`+`code_verifier`+`redirect_uri`）不同。

## 决策

### D1: 抽取共享的 oauthFetch 辅助函数

创建 `oauthFetch(params)` 函数，接受 `grant_type` 和 `bodyParams` 对象，处理所有公共逻辑：

```typescript
async function oauthFetch(
  grantType: string,
  extraParams: Record<string, string>,
): Promise<PixivAuthResponse> {
  // SparkMD5, X-Client-Time/Hash headers, URLSearchParams, fetch, error handling, extractAuth, setAccessToken
}
```

### D2: 保留 extractAuth 的差异

- `auth.ts` 的 `extractAuth` 返回 `{ accessToken, refreshToken, user }`
- `pkceAuth.ts` 的 `extractAuth` 返回 `{ accessToken, refreshToken }`
- 统一为完整版本，pkceAuth 侧忽略 `user` 字段

### D3: 模块职责保持不变

- `auth.ts` 仍导出 `refreshToken()` 和 `exchangeCodeForToken()`
- `pkceAuth.ts` 仍导出 `generatePKCE()` 和 `exchangeCode()`
- `oauthFetch` 作为内部共享函数，不对外暴露

## 后果

### 正面
- 消除 ~40 行重复代码
- OAuth 头部构造单点维护
- 未来凭证轮换或哈希算法升级只需改一处

### 负面
- 多一个内部函数，调用栈深一层

### 风险
低。纯提取重构，不改变外部 API 行为。

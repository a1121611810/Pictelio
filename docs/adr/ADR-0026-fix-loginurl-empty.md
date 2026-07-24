# ADR 0026: 修复 Login.tsx loginUrl 为空字符串的 Bug

## 状态

已批准 — 立即执行

## 分类

修复

## 日期

2026-07-17

## 背景

`Login.tsx`（`packages/app/src/routes/Login.tsx`）第 214 行以 `loginUrl=""` 硬编码空字符串调用 `OAuthWebView`。`OAuthWebView` 将空 loginUrl 透传给 `OAuthPlugin.startOAuth({ loginUrl })`，导致 Android Native OAuth WebView 加载空白页，PKCE OAuth 登录流程完全不可用——用户只能使用 refresh_token 方式登录。

与此同时，`handleOAuthStart`（第 44 行）已正确调用 `generatePKCE()` 生成 PKCE 参数并保存 `codeVerifier`，但从未基于这些参数构建实际的 OAuth 授权 URL。所需的凭据（`loginUrl`、`clientId`、`redirectUri`）已在 `credentials.json5` 中定义，并通过 `__PUBLIC_CONFIG__` / `__CREDENTIALS__` 编译时常量注入。

## 决策

### D1: 在 handleOAuthStart 中构建 OAuth 授权 URL

在 PKCE 参数生成后，构建完整的 Pixiv OAuth 授权 URL：

```
{__PUBLIC_CONFIG__.loginUrl}?client_id={clientId}&code_challenge={codeChallenge}&code_challenge_method=S256&response_type=code&redirect_uri={redirectUri}
```

参数来源：
- `clientId`：从 `__CREDENTIALS__` 获取（DEV 分支引用，生产 tree-shake 消除）
- `codeChallenge`：`generatePKCE()` 返回值
- `code_challenge_method`：固定 `S256`
- `response_type`：固定 `code`
- `redirectUri`：从 `__PUBLIC_CONFIG__` 获取

### D2: 将 loginUrl 作为响应式信号传递

新增 `loginUrlSignal`（`createSignal("")`），`handleOAuthStart` 生成 URL 后调用 `setLoginUrl(url)`，将 `loginUrl()` 传递给 `<OAuthWebView loginUrl={loginUrl()} />`。

### 不涉足的范围

- `generatePKCE` 接口保持不变
- `OAuthWebView` 接口保持不变
- Web（非 Native）路径不受影响

## 后果

### 正面
- Android Native OAuth 登录流程恢复正常
- 授权 URL 与 credentials.json5 保持同步

### 负面
- Login.tsx 新增一个 `createSignal` 状态变量

### 风险
低。修复范围小，仅涉及 URL 拼接逻辑。

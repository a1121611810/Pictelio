# 待改进项

本文件记录项目中已识别但尚未实施的体验改进与已知问题，便于后续单独跟进。

## 代理/网络错误反馈未闭环

**状态**: 已实施（2026-08，ErrorDisplay 落地 + 全路径 proxy.on 覆盖）  
**提出时间**: 2026-07-15  
**相关文件**:
- `packages/app/src/api/client.ts` — `classifyError`、`extractPixivErrorMessage`
- `packages/app/src/api/types.ts` — `ApiErrorType`、`ApiError`
- `packages/app/vite.config.ts` — `server.proxy` 错误处理
- `packages/app/src/routes/Login.tsx` — 登录错误展示
- `packages/app/src/stores/bookmarkStore.ts` — 收藏页错误映射示例
- `packages/app/src/stores/feedStore.ts` — Feed 页错误处理
- `packages/app/src/routes/IllustDetail.tsx`、`NovelDetail.tsx`、`PersonalCenter.tsx`、`UserIllusts.tsx` — 其他页面
- `packages/app/src/components/ErrorDisplay.tsx` — 待新建

### 问题描述

当前应用在代理失败或网络异常时，错误没有被一致地、可操作地传递给用户：

1. **Vite 代理层错误处理不一致**
   - `/pixiv-api` 和 `/pixiv-www` 已配置 `proxy.on("error")`，代理失败时返回统一的 `proxy_error` JSON。
   - `/pixiv-oauth`、`/pixiv-img`、`/pixiv-re`、`/pixiv-nl` **未配置**同样的错误处理。

2. **错误消息不够具体**
   - `client.ts` 的 `classifyError` 把代理失败归类为 `NETWORK` 或 `SERVER`，消息为"网络不可用，请检查连接"或"服务器错误"。
   - 用户无法从提示中得知具体应检查本地代理（默认 `127.0.0.1:10808`）是否运行。

3. **UI 层缺少统一的错误状态展示**
   - `Login.tsx` 和 `bookmarkStore.error()` 有基础错误提示。
   - 但 Feed、收藏、详情等页面大多只有 loading 状态，请求失败时静默失败或仅在 console 报错。

### 设计方案（已确认）

#### 1. 代理配置 — 全部 4 个缺失路径补上 `proxy.on("error")`

| 路径 | 行为 |
|---|---|
| `/pixiv-oauth` | 返回 `proxy_error` JSON，OAuth 失败时显示明确指引 |
| `/pixiv-img` | 返回 `proxy_error` JSON，仅 console.warn，不阻塞用户 |
| `/pixiv-re` | 同上 |
| `/pixiv-nl` | 同上 |

统一格式：
```json
{ "error": "proxy_error", "message": "代理连接失败，请检查网络或代理状态" }
```

#### 2. `ApiErrorType` — 新增 `PROXY` 枚举

在 `api/types.ts` 中新增 `PROXY = "PROXY"`。

`client.ts` 的 `classifyError` 检测响应体 `error === "proxy_error"`：
- 返回 `{ type: ApiErrorType.PROXY, message: "本地代理连接失败（127.0.0.1:10808），请检查代理软件是否运行" }`
- 不修改 `extractPixivErrorMessage`（保持仅解析 Pixiv 原生格式）

#### 3. `ErrorDisplay` 组件 — 统一错误展示

新建 `src/components/ErrorDisplay.tsx`：
- 接收 `ApiError` 对象 + `onRetry` 回调
- 按 `ApiError.type` 渲染不同操作指引：

| 类型 | 指引文字 | 按钮 |
|---|---|---|
| `PROXY` | "本地代理连接失败（127.0.0.1:10808），请检查代理软件是否运行" | "检查代理设置" → 打开扫描页面 |
| `NETWORK` | "网络连接失败，请检查网络后重试" | "重试" |
| `UNAUTHORIZED` | "登录已过期，请重新登录" | "重新登录" → 跳转 `/login` |
| `RATE_LIMIT` | "请求过于频繁，请稍后重试" | "重试" |
| `SERVER` | "服务器错误，请稍后重试" | "重试" |
| `FORBIDDEN` | "没有权限访问该内容" | 无按钮 |
| `UNKNOWN` | 原始错误消息 | "重试" |

#### 4. 全页面接入

所有错误展示改用 `ErrorDisplay` + `ApiError.type` 分类：
- **Login.tsx**: 替换当前 `setError(err.message)`
- **feedStore.ts**: 替换所有 `setState("error", msg)` → 存储 `ApiError` 对象
- **bookmarkStore.ts**: 替换 `includes()` 字符串匹配 → 用 `error.type`
- **IllustDetail.tsx / NovelDetail.tsx / PersonalCenter.tsx / UserIllusts.tsx**: 新增错误状态渲染

### 质量约束

- 不得引入新依赖
- 代理路径配置保持同 pattern 重复（不抽取抽象层）
- 错误分类不依赖字符串匹配
- 遵循 Fluent Design 2 tokens 设计规范

### 实施顺序

1. `ApiErrorType` 新增 `PROXY`
2. `client.ts` — `classifyError` 识别 `proxy_error`
3. `vite.config.ts` — 补全 4 个缺失路径的 `proxy.on("error")`
4. 新建 `ErrorDisplay.tsx` 组件
5. 接入 Feed 页（`feedStore.ts` + `Feed.tsx`）
6. 接入 Bookmarks 页（`bookmarkStore.ts` + `Bookmarks.tsx`）
7. 接入 Login 页（`Login.tsx`）
8. 接入 IllustDetail、NovelDetail、PersonalCenter、UserIllusts 等剩余页面

### 实施记录（2026-08）

- `src/components/ErrorDisplay.tsx` 已落地，被 Login / IllustDetail / NovelDetail 等页面采用。
- `ApiErrorType.PROXY` 枚举已实现（`api/types.ts`），`client.ts` 的 `classifyError` 已识别 `proxy_error` 载荷。
- `vite.config.ts` 的 `/pixiv-oauth`、`/pixiv-img`、`/pixiv-re`、`/pixiv-nl` 四个路径均已补 `proxy.on("error")`，统一返回 `proxy_error` JSON。
- 本文件保留为历史设计记录。

### 优先级判断

这是一个真实的体验缺口，但不是功能 bug：当代理和 token 都正常时，当前流程完全可用。作为**体验优化**单独排期处理。

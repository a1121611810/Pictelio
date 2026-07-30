# ADR 0041: Token Barrier — 认证就绪前阻塞 API 请求

## 状态

已接受（2026-07-30）

## 背景

### 问题

页面刷新后，`recommendedStore` 的 `createInfiniteQuery` 在模块加载时（`enabled: true`）自动开始 fetch，此时 `access_token` 尚未就绪（`initializeAuth()` 中的 `performRefresh` 正在执行）。请求到达 Pixiv API 后返回 401，触发 UNAUTHORIZED 重试流程，导致：

1. 每次刷新页面时，所有推荐请求先失败一次（401），再等待 token 刷新，再重试 — 整体延迟增加一倍
2. token 刷新失败后，后续请求继续发送，全部返回 400/401，浪费网络和计算资源
3. 骨架屏被这些请求延迟遮挡 — 请求失败→重试→成功的时间线比正常多了一轮 RTT

### 术语

参见 `docs/adr/glossary-auth-retry.md`。

### 约束

- **请求管道纯净**：API 请求层不应了解 UI 组件的生命周期。`tokenReady` barrier 是唯一允许的"前置条件阻塞"。
- **非模糊性**：`authPermanentFailure` 标记设置后，后续请求立即以同步错误终止，不产生网络流量。
- **可测试性**：barrier 和 failure 标记都是可 mock 的模块级变量，通过 Vitest 单元测试验证。

## 决策

### 决策 1：tokenReady Promise Barrier

在 `client.ts` 的 `devAuth` 对象中新增 `tokenReady: Promise<void>`。

- 初始值：`Promise.resolve()`（未认证时不需要等待）
- `initializeAuth()` 开始 token 刷新时：替换为 `new Promise(resolve => ...)`
- `performRefresh` 成功后：resolve 此 promise
- `logout()` 时：替换为 `Promise.resolve()`（解锁在等待的请求，让它们快速失败）

`nativeExecuteRequest` 入口处：
```ts
if (devAuth.authPermanentFailure) throw new Error("...");
await devAuth.tokenReady;
```

### 决策 2：authPermanentFailure 永久失效标记

在 `devAuth` 中新增 `authPermanentFailure: boolean`。

- 初始值：`false`
- `logout()` 时：设为 `true`
- `nativeExecuteRequest` 入口处检查：如果为 `true`，同步 throw Error，不产生网络请求

与 `queryClient.clear()` 配合：`clear()` 取消在途请求，`authPermanentFailure` 阻止新请求。

### 决策 3：requestAnimationFrame 延迟数据加载

`RecommendedFeed`、`FollowFeed`、`BookmarksFeed` 的 `onMount` 中的 `ensureLoaded` 调用改为：

```ts
onMount(() => {
  abortController = new AbortController();
  requestAnimationFrame(() => {
    ensureLoaded(abortController.signal);
  });
});
```

让骨架屏在当前帧渲染到屏幕后，下一帧再发起数据请求。

### 决策 4：不修改 refreshPromise 的并发 401 去重

`refreshPromise` 的并发 401 去重逻辑已在上一轮修复（commit `4f5e818`）中实现。本次 ADR 不改变此机制，仅补充 `tokenReady` 和 `authPermanentFailure`。

## 后果

### 正面

- Token 就绪前零请求到达 Pixiv API，消除"先 401 再重试"的延迟
- Token 刷新失败后零后续请求，认证失效立即可感知
- 骨架屏在数据加载前渲染到屏幕，消除"请求后显示"的视觉延迟
- 三个修复互不依赖，可独立验证

### 反面

- `tokenReady` 在 `initializeAuth` 完成之前阻塞所有 API 请求。如果 `initializeAuth` 因网络问题卡住，所有页面将无法加载数据。超时由 `initializeAuth` 内部的 `tryAsync` 保障（底层 fetch 有浏览器默认超时 `connectTimeout`）。
- `authPermanentFailure` 标记在登出后不会自动恢复（需要重新登录）。这是预期行为 — 重新登录时页面刷新，状态重新初始化。

### 兼容性

- 不影响现有 401 重试逻辑（`refreshPromise` 并发去重继续生效）
- 不影响 TanStack Query 的 `enabled` / `gcTime` 机制
- 不影响 native（Capacitor）请求路径 — `tokenReady` 和 `authPermanentFailure` 在 `nativeExecuteRequest` 入口处检查，覆盖 Web 和 native 两种请求模式

## 实施计划

1. `client.ts` — `devAuth` 新增 `tokenReady` 和 `authPermanentFailure`；`nativeExecuteRequest` 入口处添加检查和 await
2. `authStore.ts` — `initializeAuth` 中设置 `tokenReady` barrier；`logout` 中设置 `authPermanentFailure` 并解锁 `tokenReady`
3. `RecommendedFeed.tsx`、`FollowFeed.tsx`、`BookmarksFeed.tsx` — `onMount` 中 `ensureLoaded` 包一层 `requestAnimationFrame`

## 决策 5（补充）：Web 模式 Token 存在性检查

### 背景

登录页（`/login`）刷新时，`tokenReady` barrier 只在存在 refresh_token 时设置。登录页没有 token，所以 barrier 保持 `Promise.resolve()`，不阻挡任何请求。`recommendedStore` 的 `createInfiniteQuery` 在模块加载时自动 fetch，到达 `nativeExecuteRequest` 后直接通过 barrier，发送 HTTP 请求后收到 400。

### 决策

在 `nativeExecuteRequest` 入口的第三道防线（`authPermanentFailure` → `tokenReady` → token existence check）：

```ts
// Web 模式且没有 access_token → 快速失败，不发送请求
if (!isNative && !devAccessToken) {
  const err: ApiError = { type: ApiErrorType.UNAUTHORIZED, message: "未登录" };
  throw err;
}
```

位置在 `authPermanentFailure` 检查之后、`tokenReady` await 之后。原因：`authPermanentFailure` 优先（永久失效覆盖一切），`tokenReady` 同步跨请求（就绪后统一放行），token 存在性检查是当前会话的准入条件。

### 效果

- 登录页刷新：零 API 请求（Token 存在性检查直接拒绝）
- 已登录刷新：`tokenReady` 等待 token 就绪，token 就绪后 `devAccessToken` 有值，检查通过
- 不影响 native 路径（`isNative` 为 true 时跳过此检查）

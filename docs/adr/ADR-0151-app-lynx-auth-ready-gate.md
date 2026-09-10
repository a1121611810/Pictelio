# ADR-0151: app-lynx 认证就绪门（首帧数据请求等待 token 恢复）

- 状态：accepted
- 日期：2026-09-11
- 关联：ADR-0138（vue-router 迁移 / 全局守卫鉴权 bootstrap 放行）、ADR-0050（refresh_token 持久化与启动恢复）、ADR-0150（页级首载骨架——本决策防其被误判为错误）、`packages/app-lynx/CONTEXT.md`（新增词条：认证就绪门）
- 来源：用户报告「刷新页面先闪『未登录，请先登录』红字，应先显示骨架」+ `/diagnosing-bugs` 诊断

## 背景

刷新 / 冷启动时，`Recommended` 等页面在 `onMounted` 立即取数；Vue 的 `onMounted` **子组件先于父组件**，而 `restoreToken()`（读 IndexedDB/Keystore → OAuth 换 access_token）由 `App.vue onMounted → initRouter()` 触发——页面首帧请求因此**早于**登录态恢复。

Web 模式下 `api/client.ts` 在无 `access_token` 时同步抛 `未登录，请先登录`（UNAUTHORIZED）；页级首载三态（ADR-0150）中 `hasError` 先于 `!settled`，于是「恢复中」被当作「已失败」→ 渲染红字错误、替换骨架。原生模式 access_token 在 Java 堆、client 不查 JS token，不受影响（问题仅 Web/预览端）。

## 决策

1. **client 增加认证就绪门**：Web 模式无 token 的请求先请 provider 触发并等待 `restoreToken()` 落定（上限 10s），再判定是否真未登录；仅确实无可用 token 才抛 UNAUTHORIZED。
2. **provider 由 authStore 注册**（`setAuthReadyProvider(() => useAuthStore().restoreToken())`）——client 不反向依赖 store，注册发生在模块加载期、调用发生在请求期。
3. **`restoreToken()` 在飞去重**：首帧多路请求共享同一次 OAuth 交换，避免并发恢复风暴。
4. **保留原有语义**：真未登录仍抛 UNAUTHORIZED，由 `initRouter` 收敛 replace 到 `/login`；守卫 bootstrap 放行（ADR-0138）不变。
5. 原生模式不经此门。

## 被考虑的方案

- **页面逐个 `await ensureAuth()` 前置**：覆盖不全（9+ 个取数页），后续新页易漂移；否决。
- **三态层把「未登录」视作 loading**：掩盖真实语义，且恢复成功后不会自动重取；否决。
- **守卫 `await restoreToken`**：违背「先渲染后加载」（ADR-0138 已否决同类）；否决。
- **不设超时、无限等恢复**：恢复挂起会把请求永久拖住；否决（加 10s 上限）。

## 后果

**正面**：刷新 / 冷启动不再闪「未登录」红字，骨架保持到 token 就绪；一处修复覆盖全部取数页。
**负面 / 代价**：首帧数据请求被恢复时延推迟（通常 <1s）；client 与 authStore 之间新增一个注册式回调耦合（已入 CONTEXT「认证就绪门」）；恢复失败时仍会先渲染一帧错误再由 `initRouter` 收敛到登录页。

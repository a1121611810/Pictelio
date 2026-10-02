# Spec: app-lynx dev livereload 插件

> 🚫 **状态：已撤下（2026-10-02，维护者裁定）。功能未交付，代码已删除。**
>
> 本 spec 记录了一个**从未工作过**的功能，以及它为什么能连续四层「静默失败」。
> 保留全文作为案例，不作为实现依据。**任何引用本 spec 的代码都已移除**
> （`rspeedy-plugin-livereload.ts` / `livereload-client.ts` /
> `livereload-client.entry.ts` / `livereload-client.test.ts`）。
>
> **撤下理由**：该功能依赖的传输通道由 rspeedy / vue-lynx 把持，不是本仓的配置旋钮；
> 为一个 dev-only 便利功能去伸进它们内部（或自建常驻连接），代价与收益不成比例。
> 详见 [issue #919](https://github.com/a1121611810/Pictelio/issues/919) 与
> [ADR-0215](../adr/ADR-0215-fail-safe-aux-mechanisms.md) §证据。
>
> **可复用的教训（四层静默 no-op，每层都无日志无报错、测试全绿）**：
> 1. 插件解构了 rsbuild 根本不提供的 `isWeb` ⇒ `!isWeb` 恒真 ⇒ 插件恒早退，
>    client 从未被注入（**已修过**，产物 0 处 → 6 处）；
> 2. 注入的是裸 client 模块，但它导出 `init()` 却刻意不自动调用，
>    而**注入方从没调过** ⇒ WebSocket 从不打开（**已修过**）；
> 3. client 依赖的 `/rsbuild-hmr` 端点 404；
> 4. 即便前三层都对，**该通道在当前 rspeedy（0.13.6 / rsbuild 1.7.3）上根本不存在**
>    —— 真实 WS 握手 `socket hang up (1006)`，注入 `dev:{hmr:true,liveReload:true}`
>    仍 404，而同端口 `/main.web.bundle` 返回 200。
>
> ⚠️ 本 spec 的 §2「rspeedy dev server **已存在的** ws 通道」**这个前提从未成立**，
> 验收条件 2（保存后自动刷新）当初就没被执行过。
> **读 spec 时要分清「设计意图」与「已验证事实」** —— 后者需要在当前依赖版本上重新取证。
>
> ⚠️ 另有一条方法论教训：判断「端点不存在」时，`curl` 拿到 **404** 不足以定论 ——
> **很多服务器对 WS-only 路由的普通 GET 就返回 404**（curl 根本没完成 Upgrade 握手）。
> 必须用真实 WebSocket 客户端握手才能判。我第一版就栽在这里。

> 阶段：to-spec（Grill 已确认方案 D）
> 范围：packages/app-lynx / rspeedy 插件 + lynx.config.ts 注册
> 关联：诊断结论（vue-lynx 插件硬禁用 web HMR/liveReload）
> ⚠️ 上述「关联」诊断**只说对了一半**：vue-lynx 确实在 web 端短路，但真正让功能
> 失效的是**传输通道本身不存在**，与 vue-lynx 无关（实测：vue-lynx 的 dist 里
> 没有任何 hmr/liveReload 赋值）。

## 1. 背景与目标

vue-lynx 插件在 web 环境硬禁用 HMR + liveReload（`!isWeb` 短路），导致 lynx dev 在浏览器中保存后无任何自动刷新机制。本插件在**不改 vue-lynx 源码**的前提下，通过自定义 rspeedy 插件实现「保存后浏览器自动刷新」。

## 2. 方案

新增 `packages/app-lynx/rspeedy-plugin-livereload.ts`：

- **entry 注入**：在 web 环境 entry 前注入 `import './livereload-client'`
- **ws 连接**：livereload-client 连接 `ws://<host>:<port>/rsbuild-hmr`（rspeedy dev server 已存在的 ws 通道）
- **刷新信号**：监听 ws 消息，收到 `hash` / `ok` 消息后执行 `window.location.reload()`
- **去抖**：如果 500ms 内收到多个消息，只刷新一次

`lynx.config.ts` 注册插件（仅 dev 模式）：

```ts
plugins: [
  // ... 现有插件
  _isDev && require('./rspeedy-plugin-livereload'),
].filter(Boolean)
```

## 3. 文件清单

- 新增：`packages/app-lynx/rspeedy-plugin-livereload.ts`
- 新增：`packages/app-lynx/livereload-client.ts`（被注入的 client 代码）
- 修改：`packages/app-lynx/lynx.config.ts`（注册插件）

## 4. 验收条件

1. `pnpm dev:app-lynx` 启动后，浏览器打开 `http://127.0.0.1:3001/__web_preview?casename=main.web.bundle`
2. 修改任意 `.vue` 文件保存 → 浏览器自动刷新（无需手动 F5）
3. `pnpm check:app-lynx` 通过
4. `pnpm test:app-lynx` 通过（新增 livereload-client 单测）
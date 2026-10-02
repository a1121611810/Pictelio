# Spec: app-lynx dev livereload 插件

> ⚠️⚠️ **状态：未交付 —— 本 spec 的核心前提从未成立。验收条件 2 从未被执行过。**
>
> 2026-10-02 复查（issue [#919](https://github.com/a1121611810/Pictelio/issues/919)）实测：
>
> | 检查 | 结果 |
> |---|---|
> | `curl http://127.0.0.1:3000/rsbuild-hmr` | **404** |
> | 真实 WS 握手 `ws://127.0.0.1:3000/rsbuild-hmr` | **socket hang up (1006)** |
> | `curl http://127.0.0.1:3000/main.web.bundle` | 200（dev server 本身活着） |
> | 注入 `dev: { hmr: true, liveReload: true }` 后重测 | 仍 404 |
>
> **§2 声称「rspeedy dev server 已存在的 ws 通道」在本仓当前版本
> （rspeedy 0.13.6 / rsbuild 1.7.3）上根本不存在。**
> 路径本身没抄错 —— rsbuild 默认 `dev.client.path = '/rsbuild-hmr'`，
> 且 rspeedy 的 dev 插件正是把该 pathname 传给
> `@lynx-js/webpack-dev-transport/client` —— 是服务端不提供。
>
> 共四层静默 no-op，逐层实测（前两层已修，后两层未修）：
> 1. `isWeb` 恒 `undefined` ⇒ 插件恒早退，client 从未注入（已修，#912）
> 2. 注入的是裸 client 模块，**从未调用 `init()`** ⇒ WS 从不打开（已修）
> 3. client 依赖的 `/rsbuild-hmr` 端点 404（未修）
> 4. 即便前三层都对，该通道**在本版本上不存在**（未修）
>
> **下文原样保留，作为「当初为什么觉得它能工作」的记录。**
> 任何引用本 spec 的代码（`lynx.config.ts` / `rspeedy-plugin-livereload.ts` /
> `livereload-client.ts` / `livereload-client.test.ts`）都请连带读这段状态。

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
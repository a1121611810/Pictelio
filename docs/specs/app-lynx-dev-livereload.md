# Spec: app-lynx dev livereload 插件

> 阶段：to-spec（Grill 已确认方案 D）
> 范围：packages/app-lynx / rspeedy 插件 + lynx.config.ts 注册
> 关联：诊断结论（vue-lynx 插件硬禁用 web HMR/liveReload）

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
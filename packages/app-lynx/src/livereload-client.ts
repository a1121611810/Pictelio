// app-lynx dev livereload client（spec: docs/specs/app-lynx-dev-livereload.md）
// 背景：vue-lynx 插件在 web 环境硬禁用 HMR/liveReload（!isWeb 短路），
// 导致 lynx dev 在浏览器中保存后无任何自动刷新机制。
// 本 client 被 rspeedy-plugin-livereload.ts 注入到 web entry，
// 连接 rspeedy dev server 的 ws 通道，收到编译完成信号后执行 window.location.reload()。
//
// 注入方式：rspeedy-plugin-livereload.ts 在 web entry 前 prepend
// 平台约束：ADR-0123 hit-testing —— 本文件是纯逻辑无 UI，不涉及 pointer-events
// 竞态防护：scheduleReload 去抖（500ms 内多个消息只刷新一次）
//
// ⚠️⚠️ **端到端仍未跑通 —— 第三层阻断（2026-10-02 实测，见 ADR-0215 §证据）
//
// 本 client 依赖 `ws://<host>/rsbuild-hmr` 收重建信号。**该端点在 rspeedy dev
// server 上返回 404** —— rspeedy 配置里 `hmr: false`，rsbuild 因此**根本不创建**
// 这个 socket（路径常量存在于 @rsbuild/core，但 socket 只在 hmr 开启时挂载）。
// 同端口的 `/rsbuild-dev-server` 返回 200，证明 dev server 本身活着、只是没有 HMR 通道。
//
// ⇒ 前两层已修（① 插件恒早退：#912；② 只 import 不调 init()：本次），
//    但**传输层不存在**，本 client 仍然收不到任何消息、页面仍不会自动刷新。
//    换传输层（开 hmr / 换通道）是设计决策，见 issue #916。
//
// 实测记录（本次逐层验证）：
//   修复①前：web 产物里 client 0 处
//   修复①后：web 产物里 client 6 处 —— 但页面**不刷新**
//   修复②后：仍然**不刷新**（console 无新条目、无顶层导航）

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reloadTimer: ReturnType<typeof setTimeout> | null = null

function getWsUrl(): string {
  const loc = window.location
  const protocol = loc.protocol === 'https:' ? 'wss' : 'ws'
  const host = loc.hostname
  const port = loc.port
  return `${protocol}://${host}:${port}/rsbuild-hmr`
}

function connect(): void {
  ws = new WebSocket(getWsUrl())

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(String(event.data))
      // rspeedy/rspack dev server 发送的消息类型：
      // { type: 'hash' } / { type: 'ok' } / { type: 'warnings' } / { type: 'errors' }
      if (data.type === 'hash' || data.type === 'ok') {
        scheduleReload()
      }
    } catch {
      // 非 JSON 消息忽略
    }
  }

  ws.onclose = () => {
    // 断线 2s 后重连
    reconnectTimer = setTimeout(connect, 2000)
  }

  ws.onerror = () => {
    ws?.close()
  }
}

function scheduleReload(): void {
  // 去抖：500ms 内多个消息只刷新一次
  if (reloadTimer) return
  reloadTimer = setTimeout(() => {
    reloadTimer = null
    window.location.reload()
  }, 500)
}

// 不立即 connect()（避免 module-level 副作用在 happy-dom 下崩）
// 由注入方（rspeedy-plugin-livereload.ts）显式调用 init()
export function init(): void {
  connect()
}
